import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CancelTransferRequest,
  CreateTransferRequest,
  ExchangeControlInfo,
  TransferResponse,
  cancelTransferRequestSchema,
  createTransferRequestSchema,
  idempotencyKeySchema,
} from '@morapay/contracts';
import { TransfersService } from './transfers.service';
import { TransferSagaService } from './transfer-saga.service';
import { ExchangeControlService } from '../compliance/exchange-control.service';
import { CorridorsService } from '../quoting/corridors.service';
import { PrismaService } from '../common/prisma.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard, VerifiedUserGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';

/**
 * Transfer API (BUILD_PLAN 5.5).
 *
 * `VerifiedUserGuard` sits on the whole controller: every endpoint here moves
 * money or reads money, and an unverified account gets 403 from all of them
 * (BUILD_PLAN 2.1 DoD).
 */
@Controller('transfers')
@UseGuards(JwtAuthGuard, VerifiedUserGuard)
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly saga: TransferSagaService,
    private readonly exchangeControl: ExchangeControlService,
    private readonly corridors: CorridorsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * What this sender must declare on a given corridor, and what is left of
   * their allowance.
   *
   * Served per corridor because most corridors need none of it: `required:
   * false` and nulls everywhere is the ordinary answer. The send flow asks
   * before showing the confirmation step, so a South African sender sees the
   * declaration and everyone else does not.
   *
   * The remaining figure is what **we** can see. An allowance is personal and
   * spans every provider, so the number shown is a ceiling on what we know
   * about, not on what the sender has actually used. The wording in the app
   * says so, and the API says so here.
   */
  @Get('exchange-control')
  async exchangeControlInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Query('corridorId') corridorId: string,
  ): Promise<ExchangeControlInfo> {
    const none: ExchangeControlInfo = {
      required: false,
      regimeCountry: null,
      regimeCountryName: null,
      authority: null,
      reportedBy: null,
      categories: [],
      allowanceYear: null,
      annualMinorUnits: null,
      remainingMinorUnits: null,
      usedThroughUsMinorUnits: null,
      declaredElsewhereMinorUnits: null,
      currency: null,
    };
    if (corridorId === undefined || corridorId === '') return none;

    const corridor = await this.corridors.get(corridorId);
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { piiToken: true, piiPartition: true },
    });
    const status = await this.exchangeControl.allowanceStatus(
      user.id,
      record.piiToken,
      record.piiPartition,
      corridor.sourceCountry,
    );
    if (status === null) return none;

    return {
      required: true,
      regimeCountry: status.regime.country,
      regimeCountryName: status.regime.countryName,
      authority: status.regime.authority,
      reportedBy: status.regime.reportedBy,
      categories: status.regime.categories.map((c) => ({
        code: c.code,
        label: c.label,
        allowance: c.allowance,
      })),
      allowanceYear: status.year,
      annualMinorUnits: status.annualMinorUnits.toString(),
      remainingMinorUnits: status.remainingMinorUnits.toString(),
      usedThroughUsMinorUnits: status.usage.throughUsMinorUnits.toString(),
      declaredElsewhereMinorUnits: status.usage.declaredElsewhereMinorUnits.toString(),
      currency: status.regime.currency,
    };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createTransferRequestSchema)) body: CreateTransferRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<TransferResponse> {
    // Guardrail 6: every financial write takes an idempotency key. There is no
    // server-generated fallback, because a fallback is not idempotent.
    const parsed = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header of at least 8 characters with every transfer',
      });
    }

    const transfer = await this.transfers.create(user.id, body, parsed.data);

    // Kick the saga so pay-in instructions appear without waiting for the next
    // scheduled poll. If this fails, the poll schedule still gets there.
    void this.saga.advance(transfer.id).catch(() => undefined);

    return this.transfers.get(user.id, transfer.id);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<{ transfers: TransferResponse[]; nextCursor: null }> {
    const parsed = Number.parseInt(limit ?? '20', 10);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    return { transfers: await this.transfers.list(user.id, take), nextCursor: null };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TransferResponse> {
    return this.transfers.get(user.id, id);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(cancelTransferRequestSchema)) body: CancelTransferRequest,
  ): Promise<TransferResponse> {
    return this.transfers.cancel(user.id, id, body.reason);
  }
}
