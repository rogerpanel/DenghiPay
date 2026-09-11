import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { StaffSessionResponse } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { randomToken, sha256 } from '../common/crypto.util';

/**
 * Back-office authentication.
 *
 * Separate table, separate token store, separate signing key from the customer
 * application (BUILD_PLAN Phase 9: "Never share a session with the customer
 * app"). A customer access token presented to an admin endpoint fails signature
 * verification, not merely an authorisation check.
 */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(
    email: string,
    password: string,
    ipHash: string | null,
  ): Promise<StaffSessionResponse> {
    const staff = await this.prisma.staffUser.findUnique({ where: { email } });
    const referenceHash =
      staff?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9yY2VkVmVyaWZpY2F0aW9uUGFkZGluZw';
    const ok = await AuthService.verifyPassword(referenceHash, password);

    if (staff === null || !ok || staff.status !== 'ACTIVE') {
      await this.audit.record({
        actorType: 'STAFF',
        actorId: staff?.id ?? null,
        action: 'STAFF_LOGIN_FAILED',
        subjectType: 'STAFF',
        subjectId: staff?.id ?? null,
        ipHash,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.id,
      action: 'STAFF_LOGIN_SUCCEEDED',
      subjectType: 'STAFF',
      subjectId: staff.id,
      ipHash,
    });

    return this.issue(staff.id);
  }

  async refresh(refreshToken: string): Promise<StaffSessionResponse> {
    const session = await this.prisma.staffSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (session === null) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Session not found',
      });
    }
    if (session.usedAt !== null || session.revokedAt !== null) {
      await this.prisma.staffSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REFRESH_TOKEN_REUSE' },
      });
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'STAFF_REFRESH_TOKEN_REUSE_DETECTED',
        subjectType: 'STAFF',
        subjectId: session.staffId,
        reason: 'A used or revoked staff refresh token was presented',
      });
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'This session has been ended for your security. Sign in again.',
      });
    }
    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Session expired' });
    }

    const issued = await this.issue(session.staffId, session.familyId);
    await this.prisma.staffSession.update({
      where: { id: session.id },
      data: { usedAt: new Date() },
    });
    return issued;
  }

  async logout(staffId: string): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'STAFF_LOGOUT',
      subjectType: 'STAFF',
      subjectId: staffId,
    });
  }

  private async issue(
    staffId: string,
    familyId: string = randomUUID(),
  ): Promise<StaffSessionResponse> {
    const staff = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } });

    const accessToken = await this.jwt.signAsync(
      { sub: staff.id, roles: staff.roles, name: staff.displayName },
      {
        secret: this.config.ADMIN_JWT_ACCESS_SECRET,
        expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      },
    );

    const refreshToken = randomToken(48);
    await this.prisma.staffSession.create({
      data: {
        staffId: staff.id,
        familyId,
        tokenHash: sha256(refreshToken),
        // Staff sessions are deliberately shorter-lived than customer sessions:
        // a back-office token is worth more.
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: this.config.JWT_ACCESS_TTL_SECONDS,
      staff: {
        id: staff.id,
        email: staff.email,
        displayName: staff.displayName,
        roles: staff.roles,
      },
    };
  }
}
