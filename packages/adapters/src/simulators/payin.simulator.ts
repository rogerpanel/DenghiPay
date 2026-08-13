import { randomUUID } from 'node:crypto';
import {
  CallbackTrigger,
  CorridorId,
  CurrencyCode,
  IdempotencyKey,
  Money,
  PayinAcknowledgement,
  PayinInstructions,
  PayinMethod,
  PayinOutcome,
  ProviderId,
  ProviderRef,
  asProviderId,
  asProviderRef,
} from '@morapay/domain';
import { PayinProvider, PayinRequest } from '../ports/payin-provider';
import { DateRange, RawCallback, StatementLine } from '../ports/payout-provider';

interface SimulatedPayin {
  readonly providerRef: ProviderRef;
  readonly amount: Money<CurrencyCode>;
  readonly reference: string;
  readonly method: PayinMethod;
  readonly createdAt: Date;
  readonly autoConfirmAt: Date | null;
  paidAt: Date | null;
  institutionRef: string | null;
  failure: { code: string; reason: string; retryable: boolean } | null;
}

export interface PayinSimulatorOptions {
  /**
   * Seconds after which an unpaid pay-in confirms itself, so a demo runs
   * without anyone tabbing to a second window. Null disables it, in which case
   * `markPaid` is the only way funds arrive — which is what the automated tests
   * use, because a test that depends on wall-clock time is a flaky test.
   */
  readonly autoConfirmAfterSeconds: number | null;
}

/**
 * Russian pay-in simulator (BUILD_PLAN 6.1).
 *
 * Models SBP push, QR and virtual-account credit, including the awkward parts:
 * duplicate webhooks, dropped webhooks, and a delay between the sender pressing
 * "pay" in their bank app and the money actually being there.
 *
 * This is the leg no partner currently fills (TECHNICAL_ARCHITECTURE §1.1). It
 * stays a simulator until that is a signed agreement rather than a slide.
 */
export class PayinSimulator implements PayinProvider {
  readonly id: ProviderId = asProviderId('payin-ru-sim');
  readonly supportedMethods: readonly PayinMethod[] = ['SBP', 'QR', 'CARD', 'VIRTUAL_ACCOUNT'];

  private readonly payins = new Map<string, SimulatedPayin>();
  private readonly byIdempotencyKey = new Map<string, ProviderRef>();

  constructor(
    readonly supportedCorridors: readonly CorridorId[],
    private readonly options: PayinSimulatorOptions = { autoConfirmAfterSeconds: 12 },
  ) {}

  async initiatePayin(
    req: PayinRequest,
    idempotencyKey: IdempotencyKey,
  ): Promise<PayinAcknowledgement> {
    const existing = this.byIdempotencyKey.get(String(idempotencyKey));
    if (existing !== undefined) {
      const payin = this.payins.get(String(existing));
      return {
        _tag: 'ACKNOWLEDGED',
        providerRef: existing,
        receivedAt: payin?.createdAt ?? new Date(),
        instructions: this.instructionsFor(existing, req),
      };
    }

    const providerRef = asProviderRef(`RU-SIM-${randomUUID().slice(0, 12).toUpperCase()}`);
    const now = new Date();
    this.payins.set(String(providerRef), {
      providerRef,
      amount: req.amount,
      reference: req.reference,
      method: req.method,
      createdAt: now,
      autoConfirmAt:
        this.options.autoConfirmAfterSeconds === null
          ? null
          : new Date(now.getTime() + this.options.autoConfirmAfterSeconds * 1000),
      paidAt: null,
      institutionRef: null,
      failure: null,
    });
    this.byIdempotencyKey.set(String(idempotencyKey), providerRef);

    return {
      _tag: 'ACKNOWLEDGED',
      providerRef,
      receivedAt: now,
      instructions: this.instructionsFor(providerRef, req),
    };
  }

  private instructionsFor(providerRef: ProviderRef, req: PayinRequest): PayinInstructions {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    switch (req.method) {
      case 'SBP':
        return {
          kind: 'SBP',
          // Shaped like a real SBP payment link so the UI renders something honest.
          deepLink: `https://qr.nspk.ru/${String(providerRef).replace(/-/g, '').slice(0, 16)}?amount=${req.amount.minorUnits}&cur=RUB`,
          expiresAt,
        };
      case 'QR':
        return {
          kind: 'QR',
          payload: `ST00012|Name=MoraPay|PersonalAcc=SIMULATED|Sum=${req.amount.minorUnits}|Purpose=${req.reference}`,
          expiresAt,
        };
      case 'CARD':
        return {
          kind: 'CARD',
          redirectUrl: `https://simulator.morapay.invalid/card/${providerRef}`,
          expiresAt,
        };
      case 'VIRTUAL_ACCOUNT':
        return {
          kind: 'VIRTUAL_ACCOUNT',
          accountNumber: `40817810${String(providerRef).replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`,
          bankName: 'Simulated Partner Bank',
          reference: req.reference,
        };
    }
  }

  async getStatus(ref: ProviderRef): Promise<PayinOutcome> {
    const payin = this.payins.get(String(ref));
    if (payin === undefined) {
      return {
        _tag: 'FAILED',
        providerRef: ref,
        code: 'UNKNOWN_REFERENCE',
        reason: 'No pay-in with that reference',
        retryable: false,
      };
    }

    if (payin.failure !== null) {
      return { _tag: 'FAILED', providerRef: ref, ...payin.failure };
    }

    if (
      payin.paidAt === null &&
      payin.autoConfirmAt !== null &&
      new Date() >= payin.autoConfirmAt
    ) {
      this.markPaid(ref);
    }

    if (payin.paidAt === null) {
      return { _tag: 'PENDING', providerRef: ref };
    }

    return {
      _tag: 'SETTLED',
      providerRef: ref,
      institutionRef: payin.institutionRef ?? 'SBP-UNKNOWN',
      settledAt: payin.paidAt,
      receivedMinorUnits: payin.amount.minorUnits,
    };
  }

  async parseCallback(raw: RawCallback): Promise<CallbackTrigger> {
    const body = JSON.parse(raw.rawBody.toString('utf8')) as Record<string, unknown>;
    const providerRef = String(body.provider_ref ?? '');
    const eventId = String(body.event_id ?? '');
    if (providerRef === '' || eventId === '') {
      throw new Error('Callback is missing a provider reference or event id');
    }
    return {
      _tag: 'TRIGGER',
      providerRef: asProviderRef(providerRef),
      eventId,
      observedAt: new Date(),
    };
  }

  async fetchStatement(window: DateRange): Promise<StatementLine[]> {
    const lines: StatementLine[] = [];
    for (const payin of this.payins.values()) {
      if (payin.paidAt === null) continue;
      if (payin.paidAt < window.start || payin.paidAt > window.end) continue;
      lines.push({
        providerRef: payin.providerRef,
        amount: payin.amount,
        valueDate: payin.paidAt,
        description: `Pay-in ${payin.reference}`,
        institutionRef: payin.institutionRef,
      });
    }
    return lines;
  }

  // -------------------------------------------------------------- simulation

  /** The sender paid. This is what the demo panel and the tests call. */
  markPaid(ref: ProviderRef): boolean {
    const payin = this.payins.get(String(ref));
    if (payin === undefined || payin.paidAt !== null) return false;
    payin.paidAt = new Date();
    payin.institutionRef = `SBP-${randomUUID().slice(0, 10).toUpperCase()}`;
    return true;
  }

  /** The sender's bank declined, or they abandoned it. */
  markFailed(
    ref: ProviderRef,
    code = 'PAYIN_DECLINED',
    reason = 'Declined by the payer bank',
  ): boolean {
    const payin = this.payins.get(String(ref));
    if (payin === undefined || payin.paidAt !== null) return false;
    payin.failure = { code, reason, retryable: true };
    return true;
  }

  buildCallbackBody(ref: ProviderRef, eventId = randomUUID()): { body: string; eventId: string } {
    return {
      eventId,
      body: JSON.stringify({ provider_ref: String(ref), event_id: eventId, status: 'CHANGED' }),
    };
  }

  isKnown(ref: ProviderRef): boolean {
    return this.payins.has(String(ref));
  }
}
