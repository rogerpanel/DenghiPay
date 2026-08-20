import { randomUUID } from 'node:crypto';
import {
  CallbackTrigger,
  CorridorId,
  CurrencyCode,
  IdempotencyKey,
  Money,
  PayoutAcknowledgement,
  PayoutOutcome,
  ProviderId,
  ProviderRef,
  RecipientDetails,
  RecipientResolution,
  asProviderId,
  asProviderRef,
} from '@morapay/domain';
import {
  DateRange,
  PayoutProvider,
  PayoutRequest,
  RawCallback,
  RecipientQuery,
  StatementLine,
} from '../ports/payout-provider';
import { SCENARIOS, Scenario, scenarioFor } from './scenarios';
import { normaliseProviderAmount } from '../callback/signature';

interface SimulatedPayout {
  readonly providerRef: ProviderRef;
  readonly scenario: Scenario;
  readonly amount: Money<CurrencyCode>;
  readonly reference: string;
  readonly recipientIdentifier: string;
  readonly submittedAt: Date;
  pollCount: number;
  institutionRef: string | null;
  settledAt: Date | null;
  failure: { code: string; reason: string; retryable: boolean } | null;
}

/** Deterministic pseudo-names so the same account always resolves to the same person. */
const NAME_POOL = [
  'ADEBAYO OKONKWO',
  'CHIAMAKA NWOSU',
  'IBRAHIM MUSA',
  'FUNMILAYO ADEYEMI',
  'KWAME MENSAH',
  'AMA BOATENG',
  'YAW ASANTE',
  'ABENA OWUSU',
];

const NG_BANKS: Readonly<Record<string, string>> = {
  '044': 'Access Bank',
  '058': 'Guaranty Trust Bank',
  '011': 'First Bank of Nigeria',
  '057': 'Zenith Bank',
  '033': 'United Bank for Africa',
  '221': 'Stanbic IBTC Bank',
  '070': 'Fidelity Bank',
};

/**
 * South African universal branch codes. Unlike a Nigerian bank code, these
 * identify the bank rather than a branch — South Africa moved to universal
 * codes precisely so a payer need not know which branch holds the account.
 */
const ZA_BANKS: Readonly<Record<string, string>> = {
  '632005': 'Absa Bank',
  '051001': 'Standard Bank',
  '250655': 'First National Bank',
  '198765': 'Nedbank',
  '470010': 'Capitec Bank',
  '580105': 'Investec Bank',
};

const GH_NETWORKS: Readonly<Record<string, string>> = {
  MTN: 'MTN Mobile Money',
  TELECEL: 'Telecel Cash',
  AIRTELTIGO: 'AirtelTigo Money',
};

const CM_NETWORKS: Readonly<Record<string, string>> = {
  MTN: 'MTN Mobile Money Cameroun',
  ORANGE: 'Orange Money Cameroun',
};

const BJ_NETWORKS: Readonly<Record<string, string>> = {
  MTN: 'MTN MoMo B\u00e9nin',
  MOOV: 'Moov Money B\u00e9nin',
  CELTIIS: 'Celtiis Cash',
};

/**
 * What each destination market can be paid into.
 *
 * `banks` and `networks` are mutually exclusive per market today: Nigeria and
 * South Africa credit bank accounts, the other three credit wallets. Keeping
 * both fields on every market rather than a discriminated union is deliberate
 * — Ghana already has bank rails we do not use, and adding them later should
 * be a table entry rather than a type change.
 */
interface PayoutMarketProfile {
  readonly banks: Readonly<Record<string, string>>;
  readonly networks: Readonly<Record<string, string>>;
  /** The switch whose reference appears on the beneficiary's statement. */
  readonly switchName: string;
  /** Required shape of a wallet number, where the market pays wallets. */
  readonly msisdnPattern: RegExp | null;
  readonly msisdnHint: string;
}

export type PayoutMarket = 'NG' | 'GH' | 'ZA' | 'CM' | 'BJ';

const MARKETS: Readonly<Record<PayoutMarket, PayoutMarketProfile>> = {
  NG: {
    banks: NG_BANKS,
    networks: {},
    switchName: 'NIP',
    msisdnPattern: null,
    msisdnHint: '',
  },
  ZA: {
    banks: ZA_BANKS,
    networks: {},
    switchName: 'BANKSERV',
    msisdnPattern: null,
    msisdnHint: '',
  },
  GH: {
    banks: {},
    networks: GH_NETWORKS,
    switchName: 'GHIPSS',
    msisdnPattern: /^233\d{9}$/,
    msisdnHint: 'a Ghanaian mobile number (233 then nine digits)',
  },
  CM: {
    banks: {},
    networks: CM_NETWORKS,
    switchName: 'GIMAC',
    msisdnPattern: /^237\d{9}$/,
    msisdnHint: 'a Cameroonian mobile number (237 then nine digits)',
  },
  BJ: {
    banks: {},
    networks: BJ_NETWORKS,
    switchName: 'GIM-UEMOA',
    msisdnPattern: /^229\d{8,10}$/,
    msisdnHint: 'a Beninese mobile number (229 then eight to ten digits)',
  },
};

/**
 * Payout simulator for Nigeria (NIP bank credit) and Ghana (mobile money).
 *
 * It exists so the entire transfer lifecycle runs locally with zero external
 * dependencies (BUILD_PLAN 7.1 DoD) and so the failure modes in
 * TECHNICAL_ARCHITECTURE §1.2 are reachable in a test rather than theoretical.
 */
export class PayoutSimulator implements PayoutProvider {
  readonly id: ProviderId;
  private readonly payouts = new Map<string, SimulatedPayout>();
  private readonly byIdempotencyKey = new Map<string, ProviderRef>();
  private readonly callbacksEmitted: CallbackTrigger[] = [];

  constructor(
    id: string,
    readonly supportedCorridors: readonly CorridorId[],
    private readonly market: PayoutMarket,
  ) {
    this.id = asProviderId(id);
  }

  private get profile(): PayoutMarketProfile {
    return MARKETS[this.market];
  }

  async resolveRecipient(req: RecipientQuery): Promise<RecipientResolution> {
    const identifier = identifierOf(req.recipient);
    const scenario = scenarioFor(identifier);

    if (scenario === SCENARIOS.NAME_NOT_FOUND) {
      return {
        _tag: 'NOT_FOUND',
        reason: 'No account matches that number at the selected institution',
      };
    }
    if (scenario === SCENARIOS.UNSUPPORTED_INSTITUTION) {
      return { _tag: 'UNSUPPORTED', reason: 'This institution is not reachable on this rail' };
    }

    const { banks, networks, msisdnPattern, msisdnHint } = this.profile;

    if (req.recipient.method === 'BANK_ACCOUNT') {
      const institution = banks[req.recipient.bankCode];
      if (institution === undefined) {
        return {
          _tag: 'UNSUPPORTED',
          reason: `Unknown bank code ${req.recipient.bankCode} for ${this.market}`,
        };
      }
      return { _tag: 'RESOLVED', resolvedName: pseudoName(identifier), institution };
    }

    // The same brand is a different licensee in every country, so a network is
    // only meaningful alongside its market. Looking it up in this market's own
    // table is what makes "TELECEL" in Benin an error rather than a payout that
    // is accepted and then never arrives.
    const institution = networks[req.recipient.network];
    if (institution === undefined) {
      return {
        _tag: 'UNSUPPORTED',
        reason: `${req.recipient.network} does not operate in ${this.market}`,
      };
    }
    if (msisdnPattern !== null && !msisdnPattern.test(req.recipient.msisdn)) {
      return { _tag: 'NOT_FOUND', reason: `That is not ${msisdnHint}` };
    }
    return { _tag: 'RESOLVED', resolvedName: pseudoName(identifier), institution };
  }

  /**
   * Returns an acknowledgement. Note what it does not return: any indication of
   * whether money moved. That question is only answerable by `getStatus`.
   */
  async initiatePayout(
    req: PayoutRequest,
    idempotencyKey: IdempotencyKey,
  ): Promise<PayoutAcknowledgement> {
    const existing = this.byIdempotencyKey.get(String(idempotencyKey));
    if (existing !== undefined) {
      const payout = this.payouts.get(String(existing));
      return {
        _tag: 'ACKNOWLEDGED',
        providerRef: existing,
        receivedAt: payout?.submittedAt ?? new Date(),
      };
    }

    const identifier = identifierOf(req.recipient);
    const scenario = scenarioFor(identifier);
    const providerRef = asProviderRef(
      `${this.market}-SIM-${randomUUID().slice(0, 12).toUpperCase()}`,
    );

    this.payouts.set(String(providerRef), {
      providerRef,
      scenario,
      amount: req.amount,
      reference: req.reference,
      recipientIdentifier: identifier,
      submittedAt: new Date(),
      pollCount: 0,
      institutionRef: null,
      settledAt: null,
      failure: null,
    });
    this.byIdempotencyKey.set(String(idempotencyKey), providerRef);

    return {
      _tag: 'ACKNOWLEDGED',
      // §1.2 issue 10: some providers have no reference at submit time. We still
      // return ours, because our own idempotency key is what the ledger keys on.
      providerRef,
      receivedAt: new Date(),
    };
  }

  async getStatus(ref: ProviderRef): Promise<PayoutOutcome> {
    const payout = this.payouts.get(String(ref));
    if (payout === undefined) {
      return {
        _tag: 'FAILED',
        providerRef: ref,
        code: 'UNKNOWN_REFERENCE',
        reason: 'No payout with that reference',
        retryable: false,
      };
    }

    payout.pollCount += 1;

    if (payout.failure !== null) {
      return { _tag: 'FAILED', providerRef: ref, ...payout.failure };
    }
    if (payout.settledAt !== null) {
      return {
        _tag: 'SETTLED',
        providerRef: ref,
        institutionRef: payout.institutionRef ?? 'SIM-UNKNOWN',
        settledAt: payout.settledAt,
      };
    }

    switch (payout.scenario) {
      case SCENARIOS.ACK_THEN_FAIL:
        payout.failure = {
          code: 'DEBIT_FAILED',
          reason: 'Acknowledged by the switch, then rejected by the beneficiary institution',
          retryable: false,
        };
        return { _tag: 'FAILED', providerRef: ref, ...payout.failure };

      case SCENARIOS.TERMINAL_FAILURE:
        payout.failure = {
          code: 'ACCOUNT_CLOSED',
          reason: 'Beneficiary account is closed',
          retryable: false,
        };
        return { _tag: 'FAILED', providerRef: ref, ...payout.failure };

      case SCENARIOS.SLOW_SETTLE:
        if (payout.pollCount < 3) {
          return { _tag: 'PENDING', providerRef: ref };
        }
        return this.settle(payout);

      case SCENARIOS.FLOAT_AMOUNT: {
        // The provider reports the amount as a JSON float. Parsing it at the
        // boundary is what stops it propagating (guardrail 12).
        const asFloat = Number(payout.amount.minorUnits) / 100;
        try {
          normaliseProviderAmount(asFloat);
        } catch {
          payout.failure = {
            code: 'PROVIDER_CONTRACT',
            reason: `Provider reported a non-integer amount (${asFloat}); refusing to guess precision`,
            retryable: false,
          };
          return { _tag: 'FAILED', providerRef: ref, ...payout.failure };
        }
        return this.settle(payout);
      }

      default:
        return this.settle(payout);
    }
  }

  private settle(payout: SimulatedPayout): PayoutOutcome {
    payout.settledAt = new Date();
    payout.institutionRef = `${this.profile.switchName}-${randomUUID().slice(0, 10).toUpperCase()}`;
    return {
      _tag: 'SETTLED',
      providerRef: payout.providerRef,
      institutionRef: payout.institutionRef,
      settledAt: payout.settledAt,
    };
  }

  /**
   * Normalise an inbound callback into a trigger.
   *
   * The body deliberately carries a FreshPay-shaped `Status` / `Trans_Status`
   * pair, and this method deliberately ignores both. A callback tells us that
   * something changed. It does not tell us what.
   */
  async parseCallback(raw: RawCallback): Promise<CallbackTrigger> {
    const body = JSON.parse(raw.rawBody.toString('utf8')) as Record<string, unknown>;
    const providerRef = String(body.Financial_Institution_id ?? body.provider_ref ?? '');
    const eventId = String(body.event_id ?? body.EventId ?? '');
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
    for (const payout of this.payouts.values()) {
      if (payout.settledAt === null) continue;
      if (payout.settledAt < window.start || payout.settledAt > window.end) continue;
      lines.push({
        providerRef: payout.providerRef,
        amount: payout.amount,
        valueDate: payout.settledAt,
        description: `Payout ${payout.reference}`,
        institutionRef: payout.institutionRef,
      });
    }
    return lines;
  }

  // -------------------------------------------------------------- simulation

  /**
   * Build the callback body a partner would send, so the API's own webhook
   * endpoint can be exercised end to end — signature, dedup and all.
   */
  buildCallbackBody(ref: ProviderRef, eventId = randomUUID()): { body: string; eventId: string } {
    const payout = this.payouts.get(String(ref));
    return {
      eventId,
      body: JSON.stringify({
        // Shaped exactly like the FreshPay response in §6.2 of their spec:
        // an acknowledgement field that reads like an outcome, and an outcome
        // field that contradicts it. We ignore both.
        Status: 'Success',
        Trans_Status: payout?.failure !== null ? 'Failed' : 'Success',
        Financial_Institution_id: String(ref),
        event_id: eventId,
        Amount: payout === undefined ? '0' : payout.amount.toDecimalString(),
      }),
    };
  }

  /** How many callbacks this scenario should deliver, and in what order. */
  callbackPlanFor(ref: ProviderRef): { deliveries: number; outOfOrder: boolean } {
    const payout = this.payouts.get(String(ref));
    switch (payout?.scenario) {
      case SCENARIOS.DUPLICATE_CALLBACK:
        return { deliveries: 3, outOfOrder: true };
      case SCENARIOS.NO_CALLBACK:
        return { deliveries: 0, outOfOrder: false };
      default:
        return { deliveries: 1, outOfOrder: false };
    }
  }

  /** Test hook: inject a statement discrepancy for the reconciliation demo. */
  forgetForStatementTest(ref: ProviderRef): void {
    this.payouts.delete(String(ref));
  }

  recordedCallbacks(): readonly CallbackTrigger[] {
    return this.callbacksEmitted;
  }
}

function identifierOf(recipient: RecipientDetails): string {
  return recipient.method === 'BANK_ACCOUNT' ? recipient.accountNumber : recipient.msisdn;
}

function pseudoName(identifier: string): string {
  let hash = 0;
  for (const char of identifier) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  }
  return NAME_POOL[hash % NAME_POOL.length] ?? 'UNKNOWN BENEFICIARY';
}

export function createNigeriaPayoutSimulator(corridors: readonly CorridorId[]): PayoutSimulator {
  return new PayoutSimulator('payout-ng-sim', corridors, 'NG');
}

export function createGhanaPayoutSimulator(corridors: readonly CorridorId[]): PayoutSimulator {
  return new PayoutSimulator('payout-gh-sim', corridors, 'GH');
}

export function createSouthAfricaPayoutSimulator(
  corridors: readonly CorridorId[],
): PayoutSimulator {
  return new PayoutSimulator('payout-za-sim', corridors, 'ZA');
}

export function createCameroonPayoutSimulator(corridors: readonly CorridorId[]): PayoutSimulator {
  return new PayoutSimulator('payout-cm-sim', corridors, 'CM');
}

export function createBeninPayoutSimulator(corridors: readonly CorridorId[]): PayoutSimulator {
  return new PayoutSimulator('payout-bj-sim', corridors, 'BJ');
}

/**
 * The institutions each destination can pay into, for the recipient form.
 *
 * Served per country rather than as one NG-banks-plus-GH-networks pair, which
 * is what the API used to do and which quietly offered Ghanaian networks to
 * someone adding a Beninese wallet.
 */
export function institutionsForDestination(market: PayoutMarket): {
  banks: Array<{ code: string; name: string }>;
  networks: Array<{ code: string; name: string }>;
} {
  const profile = MARKETS[market];
  return {
    banks: Object.entries(profile.banks).map(([code, name]) => ({ code, name })),
    networks: Object.entries(profile.networks).map(([code, name]) => ({ code, name })),
  };
}

export { NG_BANKS, ZA_BANKS, GH_NETWORKS, CM_NETWORKS, BJ_NETWORKS };
