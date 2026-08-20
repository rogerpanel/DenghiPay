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

/** Where the money is collected from, which decides the rails and the wording. */
export type PayinMarket = 'RU' | 'NG' | 'GH' | 'ZA' | 'CM' | 'BJ';

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

const DEFAULT_OPTIONS: PayinSimulatorOptions = { autoConfirmAfterSeconds: 12 };

/** The collection rails each market actually offers. */
const METHODS_BY_MARKET: Readonly<Record<PayinMarket, readonly PayinMethod[]>> = {
  RU: ['SBP', 'QR', 'CARD', 'VIRTUAL_ACCOUNT'],
  // Nigeria collects by push to a dedicated NUBAN. Card is deliberately absent:
  // a card-funded remittance is a chargeback exposure we are not taking on.
  NG: ['VIRTUAL_ACCOUNT'],
  // Ghana collects by debiting a mobile-money wallet. Bank transfer exists too,
  // but wallets are where the money is.
  GH: ['MOBILE_MONEY'],
  // South Africa collects by EFT push to a dedicated account. Wallets exist but
  // bank transfer is where the volume is, and a push rail keeps the sender's
  // own bank in the loop — which matters under exchange control, because their
  // Authorised Dealer sees the payment leave.
  ZA: ['VIRTUAL_ACCOUNT'],
  // Cameroon and Benin are wallet-first markets by a wide margin. Both collect
  // the same way Ghana does: we request the debit, the holder approves it on
  // their handset.
  CM: ['MOBILE_MONEY'],
  BJ: ['MOBILE_MONEY'],
};

/** What the receiving switch calls its own reference, per market. */
const SWITCH_PREFIX: Readonly<Record<PayinMarket, string>> = {
  RU: 'SBP',
  NG: 'NIP',
  GH: 'GHIPSS',
  ZA: 'BANKSERV',
  CM: 'GIMAC',
  BJ: 'GIM-UEMOA',
};

/**
 * The short code a payer dials when the approval prompt never arrives, by
 * market and network.
 *
 * These are the operators' published self-service codes. **Confirm each one
 * with the operator before a pilot** — they change, they differ by handset
 * region, and a wrong code turns a recoverable stall into a support call. The
 * simulator is not the place that gets this wrong; a printed demo screen is.
 */
const USSD_FALLBACK: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  GH: { MTN: '*170#', TELECEL: '*110#', AIRTELTIGO: '*110#' },
  CM: { MTN: '*126#', ORANGE: '#150#' },
  BJ: { MTN: '*880#', MOOV: '*855#', CELTIIS: '*800#' },
};

function ussdFallbackFor(market: PayinMarket, network: string): string {
  return USSD_FALLBACK[market]?.[network] ?? '*000#';
}

/**
 * Pay-in simulator (BUILD_PLAN 6.1).
 *
 * One class, five markets, and two collection shapes between them. Russia and
 * Nigeria **wait to be pushed to** — an SBP link, a QR, or a dedicated account
 * the sender transfers into. Ghana, Cameroon and Benin **pull**: we request a
 * debit against a named wallet and its holder approves the prompt on their own
 * handset. Every market models the awkward parts — duplicate webhooks, dropped
 * webhooks, and a delay between the sender pressing "pay" and the money
 * actually being there.
 *
 * The Russian leg is the one no partner currently fills
 * (TECHNICAL_ARCHITECTURE §1.1). The four African legs are unfilled for a
 * different reason: collecting from the public inside those countries is a
 * licensed activity in its own right and we hold none of those licences (see
 * `assertCorridorMayMoveLiveFunds`). All five stay simulators until those are
 * signed agreements rather than slides.
 */
export class PayinSimulator implements PayinProvider {
  readonly id: ProviderId;
  readonly supportedMethods: readonly PayinMethod[];

  private readonly payins = new Map<string, SimulatedPayin>();
  private readonly byIdempotencyKey = new Map<string, ProviderRef>();

  constructor(
    id: string,
    readonly supportedCorridors: readonly CorridorId[],
    private readonly market: PayinMarket,
    private readonly options: PayinSimulatorOptions = DEFAULT_OPTIONS,
  ) {
    this.id = asProviderId(id);
    this.supportedMethods = METHODS_BY_MARKET[market];
  }

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

    if (!this.supportedMethods.includes(req.method)) {
      throw new Error(
        `${String(this.id)} collects in ${this.market} and does not support ${req.method}; ` +
          `supported: ${this.supportedMethods.join(', ')}`,
      );
    }

    const providerRef = asProviderRef(
      `${this.market}-SIM-${randomUUID().slice(0, 12).toUpperCase()}`,
    );
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
    const digits = String(providerRef).replace(/\D/g, '');
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
        // A Nigerian NUBAN is ten digits; a Russian settlement account is
        // twenty and starts 40817810. Same rail, different shape — and getting
        // the shape wrong is how a demonstration stops looking real.
        if (this.market === 'ZA') {
          // A South African account number is nine to eleven digits, and the
          // branch code identifies the bank rather than a branch.
          return {
            kind: 'VIRTUAL_ACCOUNT',
            accountNumber: digits.padEnd(10, '0').slice(0, 10),
            bankName: 'Simulated Collection Bank (ZA) · branch 470010',
            reference: req.reference,
          };
        }
        return this.market === 'NG'
          ? {
              kind: 'VIRTUAL_ACCOUNT',
              accountNumber: digits.padEnd(10, '0').slice(0, 10),
              bankName: 'Simulated Collection Bank (NG)',
              reference: req.reference,
            }
          : {
              kind: 'VIRTUAL_ACCOUNT',
              accountNumber: `40817810${digits.padEnd(12, '0').slice(0, 12)}`,
              bankName: 'Simulated Partner Bank',
              reference: req.reference,
            };
      case 'MOBILE_MONEY': {
        // The wallet to debit. It is the sender's own number, so it arrives
        // from the partition gateway at the moment of the call and is never
        // persisted in the neutral tier; without it there is nothing to debit.
        if (req.payer === undefined || req.payer.method !== 'MOBILE_MONEY') {
          throw new Error(
            'A mobile-money pay-in needs the payer wallet. Resolve it from the ' +
              'sender partition before calling initiatePayin.',
          );
        }
        return {
          kind: 'MOBILE_MONEY',
          msisdn: req.payer.msisdn,
          network: req.payer.network,
          ussdFallback: ussdFallbackFor(this.market, req.payer.network),
          expiresAt,
        };
      }
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
      institutionRef: payin.institutionRef ?? `${SWITCH_PREFIX[this.market]}-UNKNOWN`,
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
    payin.institutionRef = `${SWITCH_PREFIX[this.market]}-${randomUUID().slice(0, 10).toUpperCase()}`;
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

export function createRussiaPayinSimulator(
  corridors: readonly CorridorId[],
  options: PayinSimulatorOptions = DEFAULT_OPTIONS,
): PayinSimulator {
  return new PayinSimulator('payin-ru-sim', corridors, 'RU', options);
}

export function createNigeriaPayinSimulator(
  corridors: readonly CorridorId[],
  options: PayinSimulatorOptions = DEFAULT_OPTIONS,
): PayinSimulator {
  return new PayinSimulator('payin-ng-sim', corridors, 'NG', options);
}

export function createGhanaPayinSimulator(
  corridors: readonly CorridorId[],
  options: PayinSimulatorOptions = DEFAULT_OPTIONS,
): PayinSimulator {
  return new PayinSimulator('payin-gh-sim', corridors, 'GH', options);
}

export function createSouthAfricaPayinSimulator(
  corridors: readonly CorridorId[],
  options: PayinSimulatorOptions = DEFAULT_OPTIONS,
): PayinSimulator {
  return new PayinSimulator('payin-za-sim', corridors, 'ZA', options);
}

export function createCameroonPayinSimulator(
  corridors: readonly CorridorId[],
  options: PayinSimulatorOptions = DEFAULT_OPTIONS,
): PayinSimulator {
  return new PayinSimulator('payin-cm-sim', corridors, 'CM', options);
}

export function createBeninPayinSimulator(
  corridors: readonly CorridorId[],
  options: PayinSimulatorOptions = DEFAULT_OPTIONS,
): PayinSimulator {
  return new PayinSimulator('payin-bj-sim', corridors, 'BJ', options);
}
