import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
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
