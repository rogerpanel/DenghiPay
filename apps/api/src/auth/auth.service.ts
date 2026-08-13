import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { LoginRequest, RegisterRequest, SessionResponse } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { AuditService } from '../audit/audit.service';
import { pseudonymise, randomToken, sha256, tokenise } from '../common/crypto.util';
import { OutboxService } from '../notifications/outbox.service';

/**
 * Argon2id parameters.
 *
 * OWASP's current guidance: 19 MiB, two iterations, one degree of parallelism.
 * These are deliberately explicit rather than left to library defaults, because
 * a library default that changes underneath us changes our security posture
 * without a commit.
 */
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2, // Argon2id
} as const;

export interface RequestContext {
  readonly ip?: string;
  readonly userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(input: RegisterRequest, context: RequestContext): Promise<SessionResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing !== null) {
      // Deliberately the same message a duplicate would produce anyway. We do
      // not confirm or deny which addresses hold accounts.
      throw new ConflictException({
        code: 'REGISTRATION_FAILED',
        message: 'That account could not be created. If it already exists, sign in instead.',
      });
    }

    const passwordHash = await argonHash(input.password, ARGON_OPTIONS);
    const piiToken = tokenise(
      this.config.TOKENISATION_SALT,
      'usr',
      `${input.email}:${randomUUID()}`,
    );

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        locale: input.locale,
        piiPartition: input.residencyCountry === 'BY' ? 'RU' : input.residencyCountry,
        piiToken,
        roles: ['SENDER'],
        status: 'PENDING_VERIFICATION',
        kycTier: 0,
      },
    });

    await this.issueEmailVerification(user.id, input.email);

    await this.audit.record({
      actorType: 'USER',
      actorId: user.id,
      action: 'USER_REGISTERED',
      subjectType: 'USER',
      subjectId: user.id,
      ipHash:
        context.ip === undefined ? null : pseudonymise(this.config.TOKENISATION_SALT, context.ip),
      after: { status: user.status, kycTier: user.kycTier, locale: user.locale },
    });

    return this.issueSession(user.id, context);
  }

  async login(input: LoginRequest, context: RequestContext): Promise<SessionResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    // Always spend the cost of a verification, whether or not the account
    // exists, so response time does not enumerate accounts.
    const referenceHash =
      user?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9yY2VkVmVyaWZpY2F0aW9uUGFkZGluZw';
    const passwordOk = await argonVerify(referenceHash, input.password).catch(() => false);

    if (user === null || !passwordOk) {
      if (user !== null) {
        await this.recordFailedLogin(user.id, user.failedLoginCount);
      }
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Too many failed attempts. Try again later.',
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
      await this.audit.record({
        actorType: 'USER',
        actorId: user.id,
        action: 'LOGIN_BLOCKED',
        subjectType: 'USER',
        subjectId: user.id,
        reason: user.status,
      });
      throw new UnauthorizedException({
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'This account is not available. Contact support.',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: user.id,
      action: 'LOGIN_SUCCEEDED',
      subjectType: 'USER',
      subjectId: user.id,
      ipHash:
        context.ip === undefined ? null : pseudonymise(this.config.TOKENISATION_SALT, context.ip),
    });

    return this.issueSession(user.id, context);
  }

  private async recordFailedLogin(userId: string, currentCount: number): Promise<void> {
    const nextCount = currentCount + 1;
    // Five strikes, then fifteen minutes. Enough to stop credential stuffing,
    // short enough that a genuine user is not locked out of their money for long.
    const lockedUntil = nextCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: nextCount, ...(lockedUntil === null ? {} : { lockedUntil }) },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'LOGIN_FAILED',
      subjectType: 'USER',
      subjectId: userId,
      after: { failedLoginCount: nextCount, locked: lockedUntil !== null },
    });
  }

  /**
   * Rotate a refresh token (BUILD_PLAN 2.2).
   *
   * Presenting a token that has already been used means either a replay or a
   * theft, and we cannot tell which. Both are handled the same way: the entire
   * session family is revoked, so the legitimate holder is logged out and the
   * thief gains nothing.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<SessionResponse> {
    const tokenHash = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (session === null) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Session not found',
      });
    }

    if (session.usedAt !== null || session.revokedAt !== null) {
      await this.revokeFamily(session.familyId, 'REFRESH_TOKEN_REUSE');
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        subjectType: 'USER',
        subjectId: session.userId,
        reason: 'A used or revoked refresh token was presented; the session family was revoked',
      });
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'This session has been ended for your security. Sign in again.',
      });
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Session expired' });
    }

    const rotated = await this.issueSession(session.userId, context, session.familyId);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { usedAt: new Date() },
    });
    return rotated;
  }

  async logout(userId: string, refreshToken: string | undefined): Promise<void> {
    if (refreshToken === undefined) {
      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
      });
    } else {
      const session = await this.prisma.session.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      if (session !== null) {
        await this.revokeFamily(session.familyId, 'LOGOUT');
      }
    }
    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'LOGOUT',
      subjectType: 'USER',
      subjectId: userId,
    });
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private async issueSession(
    userId: string,
    context: RequestContext,
    familyId: string = randomUUID(),
  ): Promise<SessionResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        roles: user.roles,
        tier: user.kycTier,
        verified: user.emailVerifiedAt !== null,
        status: user.status,
      },
      { expiresIn: this.config.JWT_ACCESS_TTL_SECONDS },
    );

    const refreshToken = randomToken(48);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.JWT_REFRESH_TTL_SECONDS * 1000),
        userAgentHash:
          context.userAgent === undefined
            ? null
            : pseudonymise(this.config.TOKENISATION_SALT, context.userAgent),
        ipHash:
          context.ip === undefined ? null : pseudonymise(this.config.TOKENISATION_SALT, context.ip),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: this.config.JWT_ACCESS_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        kycTier: user.kycTier,
        locale: user.locale as 'ru' | 'en' | 'fr',
        emailVerified: user.emailVerifiedAt !== null,
      },
    };
  }

  async issueEmailVerification(userId: string, email: string): Promise<void> {
    const token = randomToken(32);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const link = `${this.config.WEB_PUBLIC_URL}/verify?token=${token}`;
    await this.outbox.enqueue({
      channel: 'EMAIL',
      recipient: email,
      kind: 'EMAIL_VERIFICATION',
      subject: 'Confirm your MoraPay email address',
      body:
        `Welcome to MoraPay.\n\n` +
        `Confirm your email address to start sending money:\n${link}\n\n` +
        `This link expires in 24 hours. If you did not create an account, ignore this message.`,
      metadata: { userId },
    });
  }

  /**
   * Verify an email address. Until this succeeds the account is
   * PENDING_VERIFICATION and every financial endpoint returns 403
   * (BUILD_PLAN 2.1 DoD).
   */
  async verifyEmail(token: string): Promise<{ verified: true }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
    });

    if (record === null || record.consumedAt !== null || record.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'That confirmation link is invalid or has expired',
      });
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      }),
    ]);

    await this.audit.record({
      actorType: 'USER',
      actorId: record.userId,
      action: 'EMAIL_VERIFIED',
      subjectType: 'USER',
      subjectId: record.userId,
      after: { status: 'ACTIVE' },
    });

    return { verified: true };
  }

  static async hashPassword(password: string): Promise<string> {
    return argonHash(password, ARGON_OPTIONS);
  }

  static async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argonVerify(hash, password).catch(() => false);
  }
}
