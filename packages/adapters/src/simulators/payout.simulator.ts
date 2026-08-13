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

const GH_NETWORKS: Readonly<Record<string, string>> = {
  MTN: 'MTN Mobile Money',
  TELECEL: 'Telecel Cash',
  AIRTELTIGO: 'AirtelTigo Money',
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
    private readonly market: 'NG' | 'GH',
  ) {
    this.id = asProviderId(id);
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

    if (req.recipient.method === 'BANK_ACCOUNT') {
      const institution = NG_BANKS[req.recipient.bankCode];
      if (institution === undefined) {
        return { _tag: 'UNSUPPORTED', reason: `Unknown bank code ${req.recipient.bankCode}` };
      }
      return { _tag: 'RESOLVED', resolvedName: pseudoName(identifier), institution };
    }

    const institution = GH_NETWORKS[req.recipient.network];
    if (institution === undefined) {
      return { _tag: 'UNSUPPORTED', reason: `Unknown network ${req.recipient.network}` };
    }
    if (!/^233\d{9}$/.test(req.recipient.msisdn)) {
      return { _tag: 'NOT_FOUND', reason: 'MSISDN is not a valid Ghanaian mobile number' };
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
    payout.institutionRef = `${this.market === 'NG' ? 'NIP' : 'GHIPSS'}-${randomUUID()
      .slice(0, 10)
      .toUpperCase()}`;
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

export { NG_BANKS, GH_NETWORKS };
