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
  TransferResponse,
  cancelTransferRequestSchema,
  createTransferRequestSchema,
  idempotencyKeySchema,
} from '@morapay/contracts';
import { TransfersService } from './transfers.service';
import { TransferSagaService } from './transfer-saga.service';
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
  ) {}

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
