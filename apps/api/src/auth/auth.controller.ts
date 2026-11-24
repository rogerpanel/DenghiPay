import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { DEFAULT_TIER_LIMITS, KycTier, limitsFor, sendCurrencyFor } from '@morapay/domain';
import {
  CountryCodeDto,
  MeResponse,
  RegisterRequest,
  SessionResponse,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  verifyEmailRequestSchema,
} from '@morapay/contracts';
import { AuthService } from './auth.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard } from './guards';
import { zodBody } from '../common/zod.pipe';
import { PrismaService } from '../common/prisma.service';
import { APP_CONFIG } from '../config/tokens';
import type { AppConfig } from '../config/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  async register(
    @Body(zodBody(registerRequestSchema)) body: RegisterRequest,
    @Req() request: Request,
  ): Promise<SessionResponse> {
    return this.auth.register(body, contextOf(request));
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodBody(loginRequestSchema)) body: { email: string; password: string },
    @Req() request: Request,
  ): Promise<SessionResponse> {
    return this.auth.login(body, contextOf(request));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(zodBody(refreshRequestSchema)) body: { refreshToken: string },
    @Req() request: Request,
  ): Promise<SessionResponse> {
    return this.auth.refresh(body.refreshToken, contextOf(request));
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body(zodBody(verifyEmailRequestSchema)) body: { token: string },
  ): Promise<{ verified: true }> {
    return this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  async resendVerification(@CurrentUser() user: AuthenticatedUser): Promise<{ queued: true }> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.emailVerifiedAt === null) {
      await this.auth.issueEmailVerification(record.id, record.email);
    }
    // Always 202, whether or not anything was sent: the response must not
    // reveal whether an address is already verified.
    return { queued: true };
  }

  /**
   * The caller's own confirmation link, for a deployment with no mail server.
   *
   * A demonstration still has to let a real person finish signing up, and until
   * `MAIL_TRANSPORT=smtp` is configured nothing is delivered. The alternative
   * people reach for is exposing the whole outbox — which on a public demo
   * hands every visitor every pending user's verification token, and a
   * verification token is enough to take over an account before its owner
   * reaches it.
   *
   * So this is scoped to the authenticated caller and returns only their own
   * link, and it refuses outright once live funds are on: a real deployment
   * delivers mail, and a link served over an API is not delivery.
   */
  @Get('verification-link')
  @UseGuards(JwtAuthGuard)
  async verificationLink(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ available: boolean; link: string | null; reason: string | null }> {
    if (this.config.LIVE_FUNDS_ENABLED) {
      throw new ForbiddenException({
        code: 'MAILBOX_SHORTCUT_DISABLED',
        message: 'Confirmation links are delivered by email, not served by the API',
      });
    }
    if (this.config.MAIL_TRANSPORT === 'smtp') {
      // Mail is genuinely being sent, so the shortcut would only teach a
      // demonstration audience the wrong thing about how signing up works.
      return {
        available: false,
        link: null,
        reason: 'This deployment sends confirmation emails. Check your inbox.',
      };
    }

    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.emailVerifiedAt !== null) {
      return { available: false, link: null, reason: 'This address is already confirmed.' };
    }

    const message = await this.prisma.outboxMessage.findFirst({
      where: {
        kind: 'EMAIL_VERIFICATION',
        metadata: { path: ['userId'], equals: user.id },
      },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    const link =
      message === null
        ? null
        : (/https?:\/\/\S+\/verify\?token=\S+/.exec(message.body)?.[0] ?? null);
    return {
      available: link !== null,
      link,
      reason: link === null ? 'No confirmation link has been issued yet. Send it again.' : null,
    };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { refreshToken?: string },
  ): Promise<void> {
    await this.auth.logout(user.id, body?.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const tier = record.kycTier as KycTier;
    // Judged in the sender's own currency. Reading the ruble row for a Ghanaian
    // sender happened to give the right answer for "can they transfer at all",
    // and the wrong one for every amount.
    const residencyCountry = record.piiPartition as CountryCodeDto;
    const limits = limitsFor(tier, sendCurrencyFor(residencyCountry), DEFAULT_TIER_LIMITS);
    const canTransfer =
      record.emailVerifiedAt !== null &&
      record.status === 'ACTIVE' &&
      limits !== undefined &&
      limits.perTransferMinorUnits > 0n;

    return {
      id: record.id,
      email: record.email,
      status: record.status,
      kycTier: tier,
      locale: record.locale as 'ru' | 'en' | 'fr',
      emailVerified: record.emailVerifiedAt !== null,
      residencyCountry,
      capabilities: {
        canQuote: record.emailVerifiedAt !== null,
        canTransfer,
        nextKycTier: tier < 3 ? ((tier + 1) as KycTier) : null,
      },
    };
  }
}

function contextOf(request: Request): { ip?: string; userAgent?: string } {
  const forwarded = request.headers['x-forwarded-for'];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ??
    request.socket.remoteAddress ??
    undefined;
  const userAgent = request.headers['user-agent'];
  return {
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}
