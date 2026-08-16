import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  KycTier,
  SENDER_FACING_STATUS,
  TransferEvent,
  TransferState,
  formatTransferReference,
  isPersonalPurpose,
  residencyPermitsOrigin,
  transition,
} from '@morapay/domain';
import { CreateTransferRequest, TransferResponse } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { CorridorsService } from '../quoting/corridors.service';
import { QuotesService } from '../quoting/quotes.service';
import { RecipientsService, namesLookAlike } from '../recipients/recipients.service';
import { LimitsService } from '../compliance/limits.service';
import { ScreeningService } from '../compliance/screening.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../common/metrics.service';
import { OutboxService } from '../notifications/outbox.service';
import { moneyDtoFrom, toMoney } from '../common/money.util';

export interface TransitionActor {
  readonly type: 'USER' | 'STAFF' | 'SYSTEM' | 'PROVIDER';
  readonly id: string | null;
}

/**
 * Transfer lifecycle (BUILD_PLAN 5.1–5.5).
 *
 * `applyEvent` is the only method in the codebase that changes a transfer's
 * state. It runs the domain state machine, refuses illegal transitions, and
 * writes an append-only event row — so the DoD "no state reachable by two
 * different code paths without a recorded event" holds by construction.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuotesService,
    private readonly corridors: CorridorsService,
    private readonly recipients: RecipientsService,
    private readonly limits: LimitsService,
    private readonly screening: ScreeningService,
    private readonly compliance: ComplianceService,
    private readonly partitions: PartitionGateway,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Create a transfer from a quote.
   *
   * The order of operations is the compliance gate from
   * TECHNICAL_ARCHITECTURE §2.2: quote → confirm → **screen** → pay-in. There is
   * no path from here to `AWAITING_PAYIN` that does not pass through screening.
   */
  async create(
    userId: string,
    input: CreateTransferRequest,
    idempotencyKey: string,
  ): Promise<TransferResponse> {
    const replay = await this.findIdempotentReplay(userId, idempotencyKey, input);
    if (replay !== null) return replay;

    if (!isPersonalPurpose(input.purpose)) {
      // Guardrail G2. Unreachable through the typed contract; enforced anyway,
      // because the contract is not the only caller a service ever gets.
      throw new BadRequestException({
        code: 'COMMERCIAL_PURPOSE_REJECTED',
        message: 'MoraPay carries personal, non-commercial remittances only',
      });
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const recipient = await this.recipients.get(userId, input.recipientId);
    const quote = await this.quotes.consume(userId, input.quoteId);

    // Re-check the corridor at the moment of confirmation, not only when the
    // quote was priced. A quote outlives the check that produced it, and this
    // is the last point before a transfer starts moving toward pay-in — so if
    // an authorisation lapsed in between, it stops here. Throws when live funds
    // are on and the corridor's licences are not declared held.
    const corridor = await this.corridors.get(quote.corridorId);

    // The sender confirms the name the institution returned, not the one they
    // typed. If those have drifted apart since the enquiry, stop.
    if (
      recipient.resolvedName === null ||
      !namesLookAlike(input.confirmedRecipientName, recipient.resolvedName)
    ) {
      throw new BadRequestException({
        code: 'RECIPIENT_NAME_MISMATCH',
        message:
          'The name you confirmed does not match the account. Check the recipient details and try again.',
      });
    }

    // A sender has to be where the collection happens. The web app already
    // only offers corridors that start where they live, but the app is not the
    // only caller a service ever gets, and the failure without this check is
    // ugly: a payable quote in a currency the sender cannot produce, and a
    // pay-in provider with no way to reach them.
    if (!residencyPermitsOrigin(user.piiPartition, corridor.sourceCountry)) {
      throw new ForbiddenException({
        code: 'CORRIDOR_RESIDENCY_MISMATCH',
        message: 'That corridor is not available from your country of residence',
      });
    }

    if (recipient.country !== corridor.destinationCountry) {
      throw new BadRequestException({
        code: 'CORRIDOR_RECIPIENT_MISMATCH',
        message: 'That recipient is not reachable on the corridor you quoted',
      });
    }

    // A corridor collects on the rails it has. NG→GH takes a naira push to a
    // NUBAN; GH→NG debits a cedi wallet. Accepting a method the corridor does
    // not offer produces a pay-in the provider will reject, several steps
    // later, with a message about the wrong thing.
    if (!corridor.payinMethods.includes(input.payinMethod)) {
      throw new BadRequestException({
        code: 'PAYIN_METHOD_UNAVAILABLE',
        message: `That corridor collects by ${corridor.payinMethods.join(' or ')}`,
      });
    }

    const decision = await this.limits.check(userId, quote.sendAmount, user.kycTier as KycTier);
    if (!decision.allowed) {
      throw new ForbiddenException({
        code: 'LIMIT_EXCEEDED',
        message:
          decision.upgradeTo === null
            ? 'This amount is above the limit for your account.'
            : `This amount is above your tier ${user.kycTier} limit. Verify to tier ${decision.upgradeTo} to send more.`,
        window: decision.window,
        limitMinorUnits: decision.limitMinorUnits.toString(),
        upgradeTo: decision.upgradeTo,
      });
    }

    const transfer = await this.prisma.transfer.create({
      data: {
        reference: formatTransferReference(randomBytes(6).toString('hex')),
        userId,
        quoteId: quote.id,
        corridorId: quote.corridorId,
        recipientId: recipient.id,
        state: 'DRAFT',
        purpose: input.purpose,
        sendMinorUnits: quote.sendAmount.minorUnits,
        sendCurrency: quote.sendAmount.currency,
        totalToPayMinorUnits: quote.totalToPay.minorUnits,
        feeMinorUnits: quote.fixedFee.minorUnits,
        recipientMinorUnits: quote.recipientAmount.minorUnits,
        recipientCurrency: quote.recipientAmount.currency,
        payinMethod: input.payinMethod,
      },
    });

    await this.prisma.idempotencyRecord.create({
      data: {
        scope: `transfer:create:${userId}`,
        key: idempotencyKey,
        requestFingerprint: fingerprintOf(input),
        responseSnapshot: { transferId: transfer.id },
      },
    });

    await this.quotes.markConsumed(quote.id);

    // Track the FX exposure this quote lock created (BUILD_PLAN 4.4).
    await this.prisma.fxPosition.create({
      data: {
        transferId: transfer.id,
        sellCurrency: quote.sendAmount.currency,
        sellMinorUnits: quote.sendAmount.minorUnits,
        buyCurrency: quote.recipientAmount.currency,
        buyMinorUnits: quote.recipientAmount.minorUnits,
      },
    });

    await this.applyEvent(transfer.id, 'QUOTE_ISSUED', { type: 'USER', id: userId });
    await this.applyEvent(transfer.id, 'CONFIRM', { type: 'USER', id: userId });

    await this.runComplianceGate(transfer.id, userId, user.piiToken, user.piiPartition, recipient);

    return this.get(userId, transfer.id);
  }

  /**
   * The compliance gate (guardrail G3).
   *
   * Screens the sender and the recipient, applies the velocity rules, and only
   * then allows the transfer toward pay-in. A hit opens a case and holds the
   * transfer; nothing times out into a clear.
   */
  private async runComplianceGate(
    transferId: string,
    userId: string,
    senderToken: string,
    senderPartition: string,
    recipient: { id: string; resolvedName: string | null; maskedAccount: string; piiToken: string },
  ): Promise<void> {
    const senderSubject = await this.partitions.screeningSubject(senderToken, senderPartition);

    const senderResult = await this.screening.screen(
      {
        kind: 'SENDER',
        subjectRef: senderToken,
        fullName: senderSubject?.fullName ?? 'UNKNOWN SENDER',
        ...(senderSubject === null
          ? {}
          : { dateOfBirth: senderSubject.dateOfBirth, nationality: senderSubject.nationality }),
      },
      transferId,
    );

    const recipientResult = await this.screening.screen(
      {
        kind: 'RECIPIENT',
        subjectRef: recipient.piiToken,
        fullName: recipient.resolvedName ?? 'UNKNOWN RECIPIENT',
      },
      transferId,
    );

    const transfer = await this.prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    const velocity = await this.limits.velocitySignals(
      userId,
      toMoney(transfer.sendMinorUnits, transfer.sendCurrency),
    );

    const blocking = senderResult.blocking || recipientResult.blocking || velocity.triggered;

    if (blocking) {
      await this.applyEvent(transferId, 'SCREEN_HIT', { type: 'SYSTEM', id: null });
      await this.compliance.openCase({
        type:
          velocity.triggered && !senderResult.blocking && !recipientResult.blocking
            ? 'VELOCITY'
            : 'SCREENING_HIT',
        summary: velocity.triggered
          ? `Velocity rules triggered: ${velocity.reasons.join('; ')}`
          : `Screening hit (sender ${senderResult.topScore}, recipient ${recipientResult.topScore})`,
        userId,
        transferId,
        detail: {
          senderScreeningId: senderResult.recordId,
          recipientScreeningId: recipientResult.recordId,
          senderScore: senderResult.topScore,
          recipientScore: recipientResult.topScore,
          velocity: velocity.detail,
          velocityReasons: velocity.reasons,
        },
      });
      return;
    }

    await this.applyEvent(transferId, 'SCREEN_CLEAR', { type: 'SYSTEM', id: null });
  }

  /**
   * The account a pull-based collection rail debits, for this sender.
   *
   * Mirrors `RecipientsService.detailsForPayout` on the other leg: personal
   * data comes out of the residency partition, is handed straight to a
   * provider, and is never persisted in the neutral tier. Null means this
   * sender's residency collects by push and there is nothing to debit.
   */
  async collectionAccountFor(
    userId: string,
  ): Promise<{ method: 'MOBILE_MONEY'; msisdn: string; network: string } | null> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { piiToken: true, piiPartition: true },
    });
    return this.partitions.senderCollectionAccount(user.piiToken, user.piiPartition);
  }

  /**
   * The single writer of transfer state.
   *
   * Illegal transitions throw before anything is persisted, and every accepted
   * transition writes an append-only event row in the same database
   * transaction as the state change.
   */
  async applyEvent(
    transferId: string,
    event: TransferEvent,
    actor: TransitionActor,
    detail: Record<string, unknown> = {},
  ): Promise<TransferState> {
    const current = await this.prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      select: { state: true, corridorId: true, reference: true, userId: true },
    });

    const from = current.state as TransferState;
    const to = transition(from, event); // throws IllegalTransitionError

    await this.prisma.$transaction([
      this.prisma.transfer.update({
        where: { id: transferId },
        data: {
          state: to,
          ...(to === 'COMPLETED' || to === 'REFUNDED' || to === 'FAILED'
            ? { completedAt: new Date() }
            : {}),
        },
      }),
      this.prisma.transferEvent.create({
        data: {
          transferId,
          fromState: from,
          toState: to,
          event,
          actorType: actor.type,
          actorId: actor.id,
          detail: detail as object,
        },
      }),
    ]);

    this.metrics.transferTransitioned(current.corridorId, to);

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: `TRANSFER_${event}`,
      subjectType: 'TRANSFER',
      subjectId: transferId,
      before: { state: from },
      after: { state: to },
    });

    await this.notifySender(current.userId, current.reference, to);

    return to;
  }

  private async notifySender(
    userId: string,
    reference: string,
    state: TransferState,
  ): Promise<void> {
    const notifiable: TransferState[] = [
      'AWAITING_PAYIN',
      'PAYIN_CONFIRMED',
      'PAYOUT_INITIATED',
      'COMPLETED',
      'ON_HOLD',
      'REFUNDED',
      'FAILED',
    ];
    if (!notifiable.includes(state)) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user === null) return;

    await this.outbox.notifyTransferUpdate({
      email: user.email,
      reference,
      senderStatus: SENDER_FACING_STATUS[state],
    });
  }

  // ------------------------------------------------------------------ reads

  async get(userId: string, transferId: string): Promise<TransferResponse> {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id: transferId },
      include: { recipient: true, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (transfer === null || transfer.userId !== userId) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'No such transfer' });
    }
    return toResponse(transfer);
  }

  async getByReference(reference: string) {
    return this.prisma.transfer.findUnique({
      where: { reference },
      include: { recipient: true, events: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async list(userId: string, limit = 20): Promise<TransferResponse[]> {
    const rows = await this.prisma.transfer.findMany({
      where: { userId },
      include: { recipient: true, events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toResponse);
  }

  async cancel(userId: string, transferId: string, reason: string): Promise<TransferResponse> {
    const transfer = await this.prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    if (transfer.userId !== userId) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'No such transfer' });
    }
    if (transfer.state !== 'AWAITING_PAYIN') {
      throw new BadRequestException({
        code: 'TRANSFER_NOT_CANCELLABLE',
        message:
          'A transfer can only be cancelled before payment. Once we have your money it becomes a refund.',
      });
    }

    await this.prisma.transfer.update({
      where: { id: transferId },
      data: { failureCode: 'CANCELLED_BY_SENDER', failureReason: reason },
    });
    await this.applyEvent(transferId, 'PAYIN_TIMEOUT', { type: 'USER', id: userId }, { reason });
    return this.get(userId, transferId);
  }

  // ---------------------------------------------------------- idempotency

  private async findIdempotentReplay(
    userId: string,
    key: string,
    input: CreateTransferRequest,
  ): Promise<TransferResponse | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope: `transfer:create:${userId}`, key } },
    });
    if (existing === null) return null;

    if (existing.requestFingerprint !== fingerprintOf(input)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'That idempotency key was already used with a different request',
      });
    }

    const snapshot = existing.responseSnapshot as { transferId?: string } | null;
    if (snapshot?.transferId === undefined) return null;
    return this.get(userId, snapshot.transferId);
  }
}

function fingerprintOf(input: CreateTransferRequest): string {
  return [input.quoteId, input.recipientId, input.payinMethod, input.purpose].join('|');
}

export function toResponse(transfer: {
  id: string;
  reference: string;
  state: string;
  corridorId: string;
  purpose: string;
  sendMinorUnits: bigint;
  sendCurrency: string;
  feeMinorUnits: bigint;
  totalToPayMinorUnits: bigint;
  recipientMinorUnits: bigint;
  recipientCurrency: string;
  payinMethod: string;
  payinInstructions: unknown;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  recipient: {
    id: string;
    maskedAccount: string;
    resolvedName: string | null;
    country: string;
    method: string;
  };
  events: Array<{ event: string; fromState: string; toState: string; createdAt: Date }>;
}): TransferResponse {
  const state = transfer.state as TransferState;
  return {
    id: transfer.id,
    reference: transfer.reference,
    state,
    senderStatus: SENDER_FACING_STATUS[state],
    corridorId: transfer.corridorId,
    purpose: transfer.purpose as TransferResponse['purpose'],
    sendAmount: moneyDtoFrom(transfer.sendMinorUnits, transfer.sendCurrency),
    fee: moneyDtoFrom(transfer.feeMinorUnits, transfer.sendCurrency),
    totalToPay: moneyDtoFrom(transfer.totalToPayMinorUnits, transfer.sendCurrency),
    recipientAmount: moneyDtoFrom(transfer.recipientMinorUnits, transfer.recipientCurrency),
    recipient: {
      id: transfer.recipient.id,
      maskedAccount: transfer.recipient.maskedAccount,
      resolvedName: transfer.recipient.resolvedName,
      country: transfer.recipient.country,
      method: transfer.recipient.method,
    },
    payinMethod: transfer.payinMethod as TransferResponse['payinMethod'],
    payinInstructions: (transfer.payinInstructions ??
      null) as TransferResponse['payinInstructions'],
    failureCode: transfer.failureCode,
    failureReason: transfer.failureReason,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
    completedAt: transfer.completedAt?.toISOString() ?? null,
    timeline: transfer.events.map((event) => ({
      event: event.event,
      fromState: event.fromState as TransferState,
      toState: event.toState as TransferState,
      senderStatus: SENDER_FACING_STATUS[event.toState as TransferState],
      at: event.createdAt.toISOString(),
    })),
  };
}
