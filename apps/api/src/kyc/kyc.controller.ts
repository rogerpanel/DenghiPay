import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { KycTier } from '@morapay/domain';
import {
  KycCaseResponse,
  KycRequirementsResponse,
  KycSubmitRequest,
  kycSubmitRequestSchema,
} from '@morapay/contracts';
import { KycService } from './kyc.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';
import { PrismaService } from '../common/prisma.service';

/**
 * KYC endpoints.
 *
 * Only `JwtAuthGuard` here, not `VerifiedUserGuard`: verifying identity is how
 * an account becomes able to move money, so requiring that it already can would
 * be circular. Email verification is still required — the guard on the
 * financial endpoints is what enforces that.
 */
@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('requirements/:tier')
  async requirements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tier') tier: string,
  ): Promise<KycRequirementsResponse> {
    const parsed = Number.parseInt(tier, 10);
    const target = (Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 3) : 1) as KycTier;
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { piiPartition: true },
    });
    return this.kyc.requirements(target, record.piiPartition);
  }

  @Get('cases')
  async cases(@CurrentUser() user: AuthenticatedUser): Promise<{ cases: KycCaseResponse[] }> {
    return { cases: await this.kyc.casesFor(user.id) };
  }

  @Post('submit')
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(kycSubmitRequestSchema)) body: KycSubmitRequest,
  ): Promise<KycCaseResponse> {
    return this.kyc.submit(user.id, body);
  }
}
