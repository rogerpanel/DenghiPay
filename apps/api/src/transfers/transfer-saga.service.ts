import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue, Worker } from 'bullmq';
import {
  CurrencyCode,
  PayinMethod,
  TransferState,
  asCorridorId,
  asIdempotencyKey,
  asProviderRef,
  isSettled,
} from '@morapay/domain';
import { ProviderRegistry } from '@morapay/adapters';
import {
  LedgerService,
  accountCode,
  floatCode,
  payinConfirmed,
  postPayoutResult,
  settlementOut,
  twoSided,
} from '@morapay/ledger';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { TransfersService } from './transfers.service';
import { ScreeningService } from '../compliance/screening.service';
import { RecipientsService } from '../recipients/recipients.service';
import { MetricsService } from '../common/metrics.service';
import { toMoney } from '../common/money.util';

/**
 * Transfer saga (BUILD_PLAN 5.2).
 *
 * The load-bearing rule from TECHNICAL_ARCHITECTURE §5: **a transfer must reach
 * a terminal state without ever receiving a callback.** The cron-driven poll
 * schedule below is therefore the primary mechanism. The BullMQ queue exists so
 * that a callback can make a poll happen *sooner* — it never makes one happen
 * that would not have happened anyway.
 *
 * Every step is idempotent. Ledger writes carry a deterministic idempotency key
 * derived from the transfer id and the step, so replaying a step after a crash
 * returns the original posting rather than duplicating it. That is what makes
 * killing the worker mid-settlement safe.
 */

const POLL_QUEUE = 'transfer-poll';

/** Exponential backoff, capped, then a stuck-transfer alert. */
const POLL_SCHEDULE_SECONDS = [5, 10, 20, 40, 80, 160, 300, 300, 300, 600];
const STUCK_AFTER_ATTEMPTS = POLL_SCHEDULE_SECONDS.length;

/**
 * States the sweeper picks up, because the saga is what moves them on.
 *
 * `PAYOUT_CONFIRMED` belongs here and was missing. It needs no provider call —
 * the money has arrived and the ledger knows — but it still needs the final
 * COMPLETE, and a state absent from this list is never swept, so a transfer
 * interrupted between PAYOUT_SETTLED and COMPLETE stopped there permanently.
 * The list read as "states awaiting a provider answer"; what it has to mean is
 * "states the saga can still move".
 */
export const SWEPT_STATES: readonly TransferState[] = [
  'AWAITING_PAYIN',
  'PAYIN_CONFIRMED',
  'SETTLING',
  'PAYOUT_INITIATED',
  'PAYOUT_CONFIRMED',
];

/**
 * States waiting on somebody outside the saga, deliberately not swept.
 *
 * A quote waits on the sender; a compliance hold waits on an officer. Sweeping
 * these would spin every ten seconds against a decision no amount of polling
 * produces, and would crowd out transfers the saga can actually move.
 *
 * This, `SWEPT_STATES` and the domain's `TERMINAL_STATES` together account for
 * every state exactly once, which the spec asserts. A new state then has to be
 * classified rather than falling into the gap PAYOUT_CONFIRMED fell into.
 */
export const UNSWEPT_STATES: readonly TransferState[] = [
  'DRAFT',
  'QUOTED',
  'COMPLIANCE_PENDING',
  'ON_HOLD',
  // Refunds are driven inline by `refund()` rather than by the sweeper. Adding
  // them here would need `advance` to resume one, which it cannot yet do.
  'REFUNDING',
];

@Injectable()
export class TransferSagaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferSagaService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly registry: ProviderRegistry,
    private readonly transfers: TransfersService,
    private readonly screening: ScreeningService,
    private readonly recipients: RecipientsService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.config.REDIS_URL };
    try {
      this.queue = new Queue(POLL_QUEUE, { connection });
      this.worker = new Worker(
        POLL_QUEUE,
        async (job) => {
          const { transferId } = job.data as { transferId: string };
          await this.advance(transferId);
        },
        { connection, concurrency: 4 },
      );
      this.worker.on('failed', (job, error) => {
        this.logger.error(`Saga job ${job?.id ?? 'unknown'} failed: ${error.message}`);
      });
    } catch (error) {
      // A missing Redis must not take the API down. The cron scheduler still
      // drives every transfer to completion; callbacks simply lose their
      // latency advantage.
      this.logger.warn(
        `Saga queue unavailable (${String(error)}); falling back to the poll schedule only`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Idempotent enqueue: one job per provider reference, as the architecture specifies. */
  async requestPoll(transferId: string, providerRef: string): Promise<void> {
    if (this.queue === null) return;
    await this.queue.add(
      'poll-provider-status',
      { transferId },
      { jobId: `poll:${providerRef}`, removeOnComplete: true, removeOnFail: 100 },
    );
  }

  /**
   * The poll schedule. Runs every ten seconds and picks up whatever is due.
   *
   * This is what makes dropped webhooks a non-event — and it is the only thing
   * that will ever come back for a transfer nobody is watching, so a state
   * missing from `SWEPT_STATES` is a transfer that stops forever.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async pollDueTransfers(): Promise<void> {
    const due = await this.prisma.transfer.findMany({
      where: {
        state: { in: [...SWEPT_STATES] },
        OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
      },
      select: { id: true },
      take: 25,
    });

    for (const { id } of due) {
      try {
        await this.advance(id);
      } catch (error) {
        this.logger.error(`Advancing transfer ${id} failed: ${String(error)}`);
      }
    }
  }

  /**
   * Move one transfer as far as it can go right now.
   *
   * Safe to call concurrently and repeatedly: each step checks the current
   * state, and every side effect is keyed idempotently.
   */
  async advance(transferId: string): Promise<TransferState> {
    const transfer = await this.prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true, corridor: true },
    });

    switch (transfer.state as TransferState) {
      case 'AWAITING_PAYIN':
        return this.awaitPayin(transfer);
      case 'PAYIN_CONFIRMED':
        return this.settle(transfer);
      case 'SETTLING':
        return this.initiatePayout(transfer);
      case 'PAYOUT_INITIATED':
        return this.pollPayout(transfer);
      case 'PAYOUT_CONFIRMED':
        // The recipient has the money and the ledger knows it; only the final
        // COMPLETE is missing. Reachable when something interrupted `pollPayout`
        // between applying PAYOUT_SETTLED and applying COMPLETE — two API
        // replicas advancing the same transfer and deadlocking will do it, and
        // that is an ordinary deployment rather than an exotic failure.
        //
        // Without this case the transfer sits at PAYOUT_CONFIRMED forever: the
        // switch falls through to `default`, which returns the state unchanged.
        // A delivered transfer that never reaches a terminal state is exactly
        // the failure the poll schedule exists to prevent.
        return this.completeDelivered(transfer);
      default:
        return transfer.state as TransferState;
    }
  }

  /**
   * Apply the final COMPLETE to a transfer whose payout has already settled.
   *
   * Posts nothing. The ledger entries were written when the payout settled, and
   * writing them again is not what is missing — this is only the state
   * transition and the clearing of the poll schedule.
   */
  private async completeDelivered(transfer: TransferRow): Promise<TransferState> {
    await this.transfers.applyEvent(transfer.id, 'COMPLETE', { type: 'SYSTEM', id: null });
    await this.prisma.transfer.update({
      where: { id: transfer.id },
      data: { nextPollAt: null },
    });
    return 'COMPLETED';
  }

  // ------------------------------------------------------------------ pay-in

  private async awaitPayin(transfer: TransferRow): Promise<TransferState> {
    const corridorId = asCorridorId(transfer.corridorId);
    const provider = this.registry.selectPayin(corridorId);
    if (provider === null) {
      this.logger.error(`No pay-in provider for corridor ${transfer.corridorId}`);
      return 'AWAITING_PAYIN';
    }

    // First visit: ask the provider to collect, and store the instructions the
    // sender needs. Keyed on the transfer id, so a retry returns the same
    // provider reference rather than opening a second collection.
    if (transfer.payinProviderRef === null) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: transfer.userId },
        select: { piiToken: true },
      });

      // Pull rails need an account to debit. It is the sender's own wallet, so
      // it is read from their residency partition here and handed straight to
      // the provider — never written to the neutral tier, and never fetched for
      // a push rail that has no use for it.
      const payer =
        transfer.payinMethod === 'MOBILE_MONEY'
          ? await this.transfers.collectionAccountFor(transfer.userId)
          : null;
      if (transfer.payinMethod === 'MOBILE_MONEY' && payer === null) {
        this.logger.error(
          `Transfer ${transfer.reference}: no collection wallet on file for this sender; ` +
            'the pay-in cannot be initiated until one is verified.',
        );
        await this.prisma.transfer.update({
          where: { id: transfer.id },
          data: {
            failureCode: 'NO_COLLECTION_WALLET',
            failureReason: 'No verified mobile-money wallet on file for this sender',
          },
        });
        await this.transfers.applyEvent(transfer.id, 'PAYIN_TIMEOUT', {
          type: 'SYSTEM',
          id: null,
        });
        return 'FAILED';
      }

      const ack = await provider.initiatePayin(
        {
          corridorId,
          method: transfer.payinMethod as PayinMethod,
          amount: toMoney(transfer.totalToPayMinorUnits, transfer.sendCurrency),
          reference: transfer.reference,
          senderToken: user.piiToken,
          ...(payer === null ? {} : { payer }),
        },
        asIdempotencyKey(`payin:${transfer.id}`),
      );

      await this.prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          payinProviderId: String(provider.id),
          payinProviderRef: String(ack.providerRef),
          payinInstructions: ack.instructions as unknown as object,
          nextPollAt: nextPollAt(0),
          pollAttempts: 0,
        },
      });
      return 'AWAITING_PAYIN';
    }

    const outcome = await provider.getStatus(asProviderRef(transfer.payinProviderRef));

    if (outcome._tag === 'PENDING') {
      await this.scheduleNextPoll(transfer, 'AWAITING_PAYIN');
      return 'AWAITING_PAYIN';
    }

    if (outcome._tag === 'FAILED') {
      await this.prisma.transfer.update({
        where: { id: transfer.id },
        data: { failureCode: outcome.code, failureReason: outcome.reason },
      });
      await this.transfers.applyEvent(transfer.id, 'PAYIN_TIMEOUT', {
        type: 'PROVIDER',
        id: transfer.payinProviderId,
      });
      return 'FAILED';
    }

    // Settled. Post the pay-in, then advance.
    const received = toMoney(outcome.receivedMinorUnits, transfer.sendCurrency);
    const expected = toMoney(transfer.totalToPayMinorUnits, transfer.sendCurrency);
    if (!received.equals(expected)) {
      // Under- or overpayment. The ledger records what actually arrived and the
      // difference goes to a human, because guessing here is how money is lost.
      this.logger.warn(
        `Transfer ${transfer.reference}: received ${received.toString()}, expected ${expected.toString()}`,
      );
    }

    const accounts = await this.accountsFor(transfer);
    await this.ledger.post(
      payinConfirmed({
        transferId: transfer.id,
        occurredAt: outcome.settledAt,
        floatAccountId: accounts.sourceFloat,
        userPayableAccountId: accounts.userPayableSource,
        feeRevenueAccountId: accounts.feeRevenue,
        totalReceived: received,
        fee: toMoney(transfer.feeMinorUnits, transfer.sendCurrency),
      }),
      `ledger:payin:${transfer.id}`,
    );
    this.metrics.ledgerPosted('PAYIN_CONFIRMED');

    await this.prisma.transfer.update({
      where: { id: transfer.id },
      data: { nextPollAt: new Date(), pollAttempts: 0 },
    });

    await this.transfers.applyEvent(transfer.id, 'PAYIN_RECEIVED', {
      type: 'PROVIDER',
      id: transfer.payinProviderId,
    });

    return this.advance(transfer.id);
  }

  // -------------------------------------------------------------- settlement

  /**
   * Settlement, in the send currency and then the destination currency.
   *
   * Guardrail G3 is enforced here, immediately before the first movement toward
   * the recipient: `assertClear` reads the persisted screening records and
   * throws unless both the sender and the recipient hold a CLEAR result.
   */
  private async settle(transfer: TransferRow): Promise<TransferState> {
    await this.screening.assertClear(transfer.id);

    const accounts = await this.accountsFor(transfer);
    const sendAmount = toMoney(transfer.sendMinorUnits, transfer.sendCurrency);
    const recipientAmount = toMoney(transfer.recipientMinorUnits, transfer.recipientCurrency);

    await this.transfers.applyEvent(transfer.id, 'SETTLEMENT_STARTED', {
      type: 'SYSTEM',
      id: null,
    });

    // Send currency: value leaves our float and becomes a receivable from the
    // settlement partner, which then discharges what we owe the sender.
    await this.ledger.post(
      settlementOut({
        transferId: transfer.id,
        occurredAt: new Date(),
        sourceFloatAccountId: accounts.sourceFloat,
        partnerReceivableAccountId: accounts.partnerReceivableSource,
        amount: sendAmount,
      }),
      `ledger:settle-out:${transfer.id}`,
    );

    await this.ledger.post(
      twoSided({
        reason: 'SETTLEMENT_OUT',
        description: `Sender liability discharged into settlement for ${transfer.reference}`,
        occurredAt: new Date(),
        reference: transfer.id,
        debitAccountId: accounts.userPayableSource,
        creditAccountId: accounts.partnerReceivableSource,
        amount: sendAmount,
      }),
      `ledger:discharge-source:${transfer.id}`,
    );

    // Destination currency: value arrives in the destination float, and we now
    // owe the recipient that amount.
    await this.ledger.post(
      twoSided({
        reason: 'SETTLEMENT_IN',
        description: `Settlement received for ${transfer.reference}`,
        occurredAt: new Date(),
        reference: transfer.id,
        debitAccountId: accounts.destinationFloat,
        creditAccountId: accounts.userPayableDestination,
        amount: recipientAmount,
      }),
      `ledger:settle-in:${transfer.id}`,
    );

    this.metrics.ledgerPosted('SETTLEMENT');
    return this.advance(transfer.id);
  }

  // ------------------------------------------------------------------ payout

  private async initiatePayout(transfer: TransferRow): Promise<TransferState> {
    const corridorId = asCorridorId(transfer.corridorId);
    const provider = this.registry.selectPayout(corridorId);
    if (provider === null) {
      this.logger.error(`No payout provider for corridor ${transfer.corridorId}`);
      await this.transfers.applyEvent(transfer.id, 'NO_LIQUIDITY', { type: 'SYSTEM', id: null });
      return 'REFUNDING';
    }

    const details = await this.recipients.detailsForPayout(transfer.recipientId);

    // The idempotency key is derived from the transfer, so a retry storm
    // reaches the provider as one payout (BUILD_PLAN 7.4 DoD).
    const ack = await provider.initiatePayout(
      {
        corridorId,
        recipient: details,
        amount: toMoney(transfer.recipientMinorUnits, transfer.recipientCurrency),
        reference: transfer.reference,
        narration: `MoraPay ${transfer.reference}`,
      },
      asIdempotencyKey(`payout:${transfer.id}`),
    );

    await this.prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        payoutProviderId: String(provider.id),
        payoutProviderRef: String(ack.providerRef),
        nextPollAt: nextPollAt(0),
        pollAttempts: 0,
      },
    });

    await this.transfers.applyEvent(transfer.id, 'PAYOUT_SUBMITTED', {
      type: 'PROVIDER',
      id: String(provider.id),
    });

    return 'PAYOUT_INITIATED';
  }

  /**
   * Poll the payout.
   *
   * The only place a payout outcome enters the system, and the only place the
   * ledger learns that money reached the recipient. A callback never gets here.
   */
  private async pollPayout(transfer: TransferRow): Promise<TransferState> {
    if (transfer.payoutProviderRef === null || transfer.payoutProviderId === null) {
      return 'PAYOUT_INITIATED';
    }
    const provider = this.registry.payoutById(transfer.payoutProviderId);
    if (provider === null) {
      this.logger.error(`Payout provider ${transfer.payoutProviderId} is not registered`);
      return 'PAYOUT_INITIATED';
    }

    const outcome = await provider.getStatus(asProviderRef(transfer.payoutProviderRef));

    if (outcome._tag === 'PENDING') {
      await this.scheduleNextPoll(transfer, 'PAYOUT_INITIATED');
      return 'PAYOUT_INITIATED';
    }

    const accounts = await this.accountsFor(transfer);

    if (isSettled(outcome)) {
      for (const draft of postPayoutResult(outcome, {
        transferId: transfer.id,
        occurredAt: outcome.settledAt,
        userPayableAccountId: accounts.userPayableDestination,
        destinationFloatAccountId: accounts.destinationFloat,
        userPayableAmount: toMoney(transfer.recipientMinorUnits, transfer.recipientCurrency),
        payoutAmount: toMoney(transfer.recipientMinorUnits, transfer.recipientCurrency),
      })) {
        await this.ledger.post(draft, `ledger:payout:${transfer.id}`);
      }
      this.metrics.ledgerPosted('PAYOUT_CONFIRMED');

      // The poll schedule is deliberately NOT cleared here. It is the only
      // thing that will come back for this transfer if the two events below do
      // not both land, and it used to be cleared first — so an interruption
      // between them left a delivered transfer at PAYOUT_CONFIRMED with nothing
      // scheduled to finish it. `advance` handles that state now, but only a
      // transfer the poller still looks at ever reaches `advance` again.
      await this.prisma.transfer.update({
        where: { id: transfer.id },
        data: { payoutInstitutionRef: outcome.institutionRef },
      });
      await this.closeFxPosition(transfer.id);

      await this.transfers.applyEvent(transfer.id, 'PAYOUT_SETTLED', {
        type: 'PROVIDER',
        id: transfer.payoutProviderId,
      });
      return this.completeDelivered(transfer);
    }

    // Failed. Nothing is posted for the failure itself — the liability is
    // already where it should be. The refund path moves the money back, with
    // its own approval and its own entries.
    await this.prisma.transfer.update({
      where: { id: transfer.id },
      data: { failureCode: outcome.code, failureReason: outcome.reason, nextPollAt: null },
    });
    await this.transfers.applyEvent(
      transfer.id,
      'PAYOUT_FAILED',
      { type: 'PROVIDER', id: transfer.payoutProviderId },
      { code: outcome.code, retryable: outcome.retryable },
    );

    return this.refund(transfer.id, 'PAYOUT_FAILED', outcome.code);
  }

  // ------------------------------------------------------------------ refund

  /**
   * Unwind a transfer that cannot be delivered (BUILD_PLAN 5.4, 7.4).
   *
   * Mirrors the settlement postings in both currencies and returns the sender's
   * money, including the fee — we do not keep a fee for a service we did not
   * perform. Every step is a distinct, reasoned posting; nothing is a silent
   * reversal.
   */
  async refund(transferId: string, reasonCode: string, detail: string): Promise<TransferState> {
    const transfer = await this.prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true, corridor: true },
    });
    const accounts = await this.accountsFor(transfer);
    const sendAmount = toMoney(transfer.sendMinorUnits, transfer.sendCurrency);
    const feeAmount = toMoney(transfer.feeMinorUnits, transfer.sendCurrency);
    const recipientAmount = toMoney(transfer.recipientMinorUnits, transfer.recipientCurrency);
    const occurredAt = new Date();

    // Destination currency: the naira never left, so the obligation to deliver
    // it closes against the float it came from.
    await this.ledger.post(
      twoSided({
        reason: 'REFUND_EXECUTED',
        description: `Settlement unwound for ${transfer.reference}`,
        occurredAt,
        reference: transfer.id,
        debitAccountId: accounts.userPayableDestination,
        creditAccountId: accounts.destinationFloat,
        amount: recipientAmount,
        metadata: { reasonCode },
      }),
      `ledger:refund-dest:${transfer.id}`,
    );

    // Send currency: the receivable comes back as float, and the liability to
    // the sender is re-established before it is discharged by the refund.
    await this.ledger.post(
      twoSided({
        reason: 'REFUND_EXECUTED',
        description: `Settlement returned for ${transfer.reference}`,
        occurredAt,
        reference: transfer.id,
        debitAccountId: accounts.sourceFloat,
        creditAccountId: accounts.partnerReceivableSource,
        amount: sendAmount,
        metadata: { reasonCode },
      }),
      `ledger:refund-return:${transfer.id}`,
    );

    await this.ledger.post(
      twoSided({
        reason: 'REFUND_EXECUTED',
        description: `Refund paid to sender for ${transfer.reference}`,
        occurredAt,
        reference: transfer.id,
        debitAccountId: accounts.partnerReceivableSource,
        creditAccountId: accounts.sourceFloat,
        amount: sendAmount,
        metadata: { reasonCode, detail },
      }),
      `ledger:refund-sender:${transfer.id}`,
    );

    if (feeAmount.isPositive) {
      await this.ledger.post(
        twoSided({
          reason: 'REFUND_EXECUTED',
          description: `Fee returned for ${transfer.reference}`,
          occurredAt,
          reference: transfer.id,
          debitAccountId: accounts.feeRevenue,
          creditAccountId: accounts.sourceFloat,
          amount: feeAmount,
          metadata: { reasonCode },
        }),
        `ledger:refund-fee:${transfer.id}`,
      );
    }

    this.metrics.ledgerPosted('REFUND_EXECUTED');
    await this.closeFxPosition(transfer.id);
    await this.transfers.applyEvent(
      transfer.id,
      'REFUND_EXECUTED',
      { type: 'SYSTEM', id: null },
      { reasonCode, detail },
    );
    return 'REFUNDED';
  }

  // ------------------------------------------------------------------ helpers

  private async scheduleNextPoll(transfer: TransferRow, state: TransferState): Promise<void> {
    const attempts = transfer.pollAttempts + 1;
    await this.prisma.transfer.update({
      where: { id: transfer.id },
      data: { pollAttempts: attempts, nextPollAt: nextPollAt(attempts) },
    });

    if (attempts >= STUCK_AFTER_ATTEMPTS) {
      // Past the schedule. This is the stuck-transfer alert (BUILD_PLAN 11.5).
      this.metrics.setStuckTransfers(transfer.corridorId, 1);
      this.logger.warn(
        `Transfer ${transfer.reference} is stuck in ${state} after ${attempts} polls`,
      );
    }
  }

  private async closeFxPosition(transferId: string): Promise<void> {
    await this.prisma.fxPosition.updateMany({
      where: { transferId, closedAt: null },
      data: { closedAt: new Date() },
    });
  }

  /**
   * Resolve every account this transfer touches, creating the per-user payable
   * accounts on demand.
   */
  private async accountsFor(transfer: TransferRow): Promise<{
    sourceFloat: string;
    destinationFloat: string;
    feeRevenue: string;
    userPayableSource: string;
    userPayableDestination: string;
    partnerReceivableSource: string;
  }> {
    const sendCurrency = transfer.sendCurrency as CurrencyCode;
    const destinationCurrency = transfer.recipientCurrency as CurrencyCode;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: transfer.userId },
      select: { piiToken: true },
    });

    const [
      sourceFloat,
      destinationFloat,
      feeRevenue,
      userPayableSource,
      userPayableDestination,
      partnerReceivableSource,
    ] = await Promise.all([
      this.ledger.accountByCode(floatCode(sendCurrency)),
      this.ledger.accountByCode(floatCode(destinationCurrency)),
      this.ledger.accountByCode(accountCode('FEE_REVENUE', sendCurrency)),
      this.ledger.ensureAccount({
        type: 'USER_PAYABLE',
        currency: sendCurrency,
        partition: 'NEUTRAL',
        scope: user.piiToken,
        ownerRef: user.piiToken,
      }),
      this.ledger.ensureAccount({
        type: 'USER_PAYABLE',
        currency: destinationCurrency,
        partition: 'NEUTRAL',
        scope: user.piiToken,
        ownerRef: user.piiToken,
      }),
      this.ledger.accountByCode(accountCode('PARTNER_RECEIVABLE', sendCurrency, 'SETTLEMENT')),
    ]);

    return {
      sourceFloat: sourceFloat.id,
      destinationFloat: destinationFloat.id,
      feeRevenue: feeRevenue.id,
      userPayableSource: userPayableSource.id,
      userPayableDestination: userPayableDestination.id,
      partnerReceivableSource: partnerReceivableSource.id,
    };
  }
}

function nextPollAt(attempts: number): Date {
  const seconds =
    POLL_SCHEDULE_SECONDS[Math.min(attempts, POLL_SCHEDULE_SECONDS.length - 1)] ?? 600;
  return new Date(Date.now() + seconds * 1000);
}

interface TransferRow {
  id: string;
  reference: string;
  userId: string;
  corridorId: string;
  state: string;
  sendMinorUnits: bigint;
  sendCurrency: string;
  totalToPayMinorUnits: bigint;
  feeMinorUnits: bigint;
  recipientMinorUnits: bigint;
  recipientCurrency: string;
  recipientId: string;
  payinMethod: string;
  payinProviderId: string | null;
  payinProviderRef: string | null;
  payoutProviderId: string | null;
  payoutProviderRef: string | null;
  pollAttempts: number;
}

export { POLL_QUEUE, POLL_SCHEDULE_SECONDS, STUCK_AFTER_ATTEMPTS };
