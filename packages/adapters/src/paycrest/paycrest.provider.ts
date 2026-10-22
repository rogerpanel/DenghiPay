import { createHmac, timingSafeEqual } from 'node:crypto';
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
  getCurrency,
} from '@morapay/domain';
import {
  DateRange,
  PayoutProvider,
  PayoutRequest,
  RawCallback,
  RecipientQuery,
  StatementLine,
} from '../ports/payout-provider';
import { ProviderContractViolation } from '../callback/signature';
import { PaycrestApiError, PaycrestClient, PaycrestOrder, cleanPaycrestCredential } from './client';
import { decimalToMinorUnits, fiatMinorForToken, formatMinorUnits, parseDecimal } from './decimal';
import { parseJsonExact } from './json';

export const PAYCREST_PROVIDER_ID = 'paycrest';

/**
 * The countries Paycrest pays out in for this engagement, and the currency each
 * settles in. Agreement No. 04, Annex 1, is accepted against exactly these four.
 */
export const PAYCREST_PAYOUT_CURRENCIES = {
  NG: 'NGN',
  KE: 'KES',
  UG: 'UGX',
  TZ: 'TZS',
} as const satisfies Record<string, CurrencyCode>;
export type PaycrestCountry = keyof typeof PAYCREST_PAYOUT_CURRENCIES;

/** The stablecoins an order may be funded with. Both carry six decimals in our ledger. */
export const PAYCREST_TOKENS = ['USDT', 'USDC'] as const;
export type PaycrestToken = (typeof PAYCREST_TOKENS)[number];

/** Networks Paycrest's v2 API accepts for an off-ramp deposit. */
export const PAYCREST_NETWORKS = [
  'ethereum',
  'base',
  'bnb-smart-chain',
  'lisk',
  'celo',
  'arbitrum-one',
  'polygon',
  'starknet',
  'tron',
  'solana',
] as const;
export type PaycrestNetwork = (typeof PAYCREST_NETWORKS)[number];

const TOKEN_EXPONENT = 6;

/**
 * Our recipient details → Paycrest's institution codes.
 *
 * Paycrest names a bank or wallet by its own code — a SWIFT code, or a code
 * ending in `PC` (e.g. `SAFAKEPC`, Safaricom M-Pesa) — not by the Nigerian NIP
 * code or the network name we store. Nothing is guessed: the table is filled
 * from `GET /institutions/{currency}` (the probe prints it), and a recipient
 * whose bank or network is not in it is refused as UNSUPPORTED before any money
 * moves.
 */
export interface PaycrestInstitutionMap {
  /** country → our bank code → Paycrest code */
  readonly bank?: Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>;
  /** country → our network code (MPESA, MTN, …) → Paycrest code */
  readonly mobileMoney?: Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>;
}

/**
 * Who sends the stablecoin to a Paycrest order.
 *
 * A Paycrest off-ramp order is paid by sending `amountToTransfer` of the token
 * to the order's receive address. Whoever funds it therefore holds a virtual
 * asset, however briefly — "Model B" in docs/DESIGN_STABLECOIN_RAIL.md, a
 * regulatory decision rather than an engineering one. So the adapter does not
 * do it: funding is this port, the repository ships only the implementation that
 * refuses, and the API keeps Paycrest out of payout routing until a real one is
 * supplied.
 */
export interface PaycrestOrderFunder {
  /** False means "do not route payouts here at all". */
  readonly available: boolean;
  fund(instruction: PaycrestFundingInstruction): Promise<{ readonly txHash: string }>;
}

export interface PaycrestFundingInstruction {
  readonly orderId: string;
  readonly receiveAddress: string;
  readonly network: string;
  readonly token: string;
  /** Exactly what Paycrest asked for: amount + senderFee + transactionFee. */
  readonly amountToTransfer: string;
  /** The same, in token minor units (six decimals). */
  readonly amountMinor: bigint;
  /** Must accompany the deposit when present, or Paycrest cannot credit it. */
  readonly memo: string | null;
  readonly validUntil: Date | null;
}

export class PaycrestFundingUnavailable extends Error {
  constructor() {
    super(
      'No funding source is configured for Paycrest orders. Funding means holding a ' +
        'stablecoin (Model B, docs/DESIGN_STABLECOIN_RAIL.md); it needs a decision, not a flag.',
    );
    this.name = 'PaycrestFundingUnavailable';
  }
}

export const refusingFunder: PaycrestOrderFunder = {
  available: false,
  fund: async () => {
    throw new PaycrestFundingUnavailable();
  },
};

/** A webhook whose signature does not verify. The controller answers 401. */
export class PaycrestSignatureError extends Error {
  constructor() {
    super('Paycrest webhook signature did not verify');
    this.name = 'PaycrestSignatureError';
  }
}

/**
 * Paycrest order status → our outcome, from Paycrest's transaction lifecycle:
 *
 *   initiated → deposited → pending → fulfilling → validated → settling → settled
 *                                    ↘ refunding → refunded          initiated → expired
 *
 * SETTLED from `validated` on, because `validated` is Paycrest's "the provider
 * has confirmed successful fiat delivery"; what follows is the provider being
 * paid on-chain, which is not our concern. Everything before it is PENDING —
 * including `fulfilled`, an internal "the provider says it paid", because
 * acknowledgement is not settlement. `refunding` is also PENDING: the payout has
 * failed but the refund has not landed, and our refund to the sender waits for
 * `refunded`. A status not in this table is a contract violation and is
 * surfaced, never mapped to whichever outcome looks likely.
 */
const SETTLED_STATUSES = new Set(['validated', 'settling', 'settled']);
const PENDING_STATUSES = new Set([
  'initiated',
  'deposited',
  'pending',
  'fulfilling',
  'fulfilled',
  'refunding',
]);
const FAILED_STATUSES: Readonly<Record<string, string>> = {
  expired: 'The order expired without a deposit',
  refunded: 'Paycrest could not pay the recipient and returned the deposit',
  cancelled: 'The order was cancelled',
};

export interface PaycrestPayoutOptions {
  readonly client: PaycrestClient;
  /** Verifies webhook signatures. Never sent anywhere. */
  readonly apiSecret: string;
  readonly token: PaycrestToken;
  readonly network: PaycrestNetwork;
  /** Where Paycrest returns the token if an order cannot be fulfilled. Ours. */
  readonly refundAddress: string;
  readonly corridors: readonly CorridorId[];
  readonly institutions: PaycrestInstitutionMap;
  readonly funder?: PaycrestOrderFunder;
  readonly now?: () => Date;
  /** How many pages of recent orders to search for a reference. */
  readonly referenceScanPages?: number;
  /** How many pages of orders a statement may read. */
  readonly statementScanPages?: number;
}

export class PaycrestPayoutProvider implements PayoutProvider {
  readonly id: ProviderId = asProviderId(PAYCREST_PROVIDER_ID);
  readonly supportedCorridors: readonly CorridorId[];

  private readonly client: PaycrestClient;
  private readonly funder: PaycrestOrderFunder;
  private readonly now: () => Date;

  constructor(private readonly options: PaycrestPayoutOptions) {
    this.client = options.client;
    this.funder = options.funder ?? refusingFunder;
    this.now = options.now ?? (() => new Date());
    this.supportedCorridors = options.corridors.filter((id) =>
      Object.keys(PAYCREST_PAYOUT_CURRENCIES).some((country) => String(id).endsWith(`-${country}`)),
    );
  }

  /** True when a payout could actually be funded. The registry routes on this. */
  get canFundPayouts(): boolean {
    return this.funder.available;
  }

  async resolveRecipient(req: RecipientQuery): Promise<RecipientResolution> {
    const institution = this.institutionFor(req.recipient);
    if (institution === null) {
      return {
        _tag: 'UNSUPPORTED',
        reason: 'This bank or network is not yet mapped to a Paycrest institution',
      };
    }
    try {
      const name = await this.client.verifyAccount(institution, accountIdentifier(req.recipient));
      if (name === null) {
        return {
          _tag: 'UNSUPPORTED',
          reason: 'Paycrest cannot confirm the account holder name for this institution',
        };
      }
      return { _tag: 'RESOLVED', resolvedName: name, institution };
    } catch (error) {
      if (error instanceof PaycrestApiError && error.httpStatus >= 400 && error.httpStatus < 500) {
        return { _tag: 'NOT_FOUND', reason: 'The institution did not recognise this account' };
      }
      throw error;
    }
  }

  async initiatePayout(
    req: PayoutRequest,
    idempotencyKey: IdempotencyKey,
  ): Promise<PayoutAcknowledgement> {
    // Refuse before anything is sent: an order nobody can fund is one Paycrest
    // will expire, and the sender's money would wait on it for nothing.
    if (!this.funder.available) throw new PaycrestFundingUnavailable();

    const fiat = this.fiatCurrencyFor(req.recipient);
    if (req.amount.currency !== fiat) {
      throw new ProviderContractViolation(
        `Paycrest pays ${req.recipient.country} in ${fiat}; the payout was in ${req.amount.currency}`,
      );
    }
    const institution = this.institutionFor(req.recipient);
    if (institution === null) {
      throw new ProviderContractViolation('Recipient institution is not mapped for Paycrest');
    }

    // Idempotency. Paycrest stores our reference but does not promise to refuse a
    // second order with the same one, so look first: a retry after a timeout must
    // find the order the first attempt created, not create and fund another.
    const reference = String(idempotencyKey);
    const existing = await this.findByReference(reference);
    if (existing !== null) return this.acknowledge(existing);

    // Denominated in the recipient's currency, exactly: Paycrest converts, and
    // the recipient is paid what the transfer promised.
    const order = await this.client.createOfframpOrder({
      amount: formatMinorUnits(req.amount.minorUnits, getCurrency(fiat).exponent),
      amountIn: 'fiat',
      reference,
      source: {
        type: 'crypto',
        currency: this.options.token,
        network: this.options.network,
        refundAddress: this.options.refundAddress,
      },
      destination: {
        type: 'fiat',
        currency: fiat,
        recipient: {
          institution,
          accountIdentifier: accountIdentifier(req.recipient),
          accountName: req.recipient.declaredName,
          memo: req.narration,
        },
      },
    });

    if (order.deposit === null) {
      throw new ProviderContractViolation('Paycrest created an order without a receive address');
    }

    await this.funder.fund({
      orderId: order.id,
      receiveAddress: order.deposit.receiveAddress,
      network: order.deposit.network ?? this.options.network,
      token: order.deposit.currency ?? this.options.token,
      amountToTransfer: order.deposit.amountToTransfer,
      amountMinor: decimalToMinorUnits(order.deposit.amountToTransfer, TOKEN_EXPONENT),
      memo: order.deposit.memo,
      validUntil: order.deposit.validUntil === null ? null : new Date(order.deposit.validUntil),
    });

    return this.acknowledge(order);
  }

  async getStatus(ref: ProviderRef): Promise<PayoutOutcome> {
    return this.outcomeOf(await this.client.getOrder(String(ref)));
  }

  /**
   * Verify, deduplicate, and say "poll this order". Nothing more.
   *
   * Paycrest signs the raw body with HMAC-SHA256 under the API secret and sends
   * the lowercase hex digest in `X-Paycrest-Signature`. Its guide is specific:
   * trim and lowercase the header, trim the secret, and compare the hex *text*
   * in constant time. It sends no timestamp, so there is no freshness check —
   * which costs nothing here: a replayed trigger only causes a poll we would
   * have made anyway, and dedup absorbs it.
   */
  async parseCallback(raw: RawCallback): Promise<CallbackTrigger> {
    const presented = header(raw.headers, 'x-paycrest-signature');
    if (
      presented === null ||
      !verifyPaycrestSignature(this.options.apiSecret, raw.rawBody, presented)
    ) {
      throw new PaycrestSignatureError();
    }

    const body = parseJsonExact(raw.rawBody.toString('utf8'));
    const envelope =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const data =
      typeof envelope.data === 'object' && envelope.data !== null
        ? (envelope.data as Record<string, unknown>)
        : {};
    const id = typeof data.id === 'string' && data.id !== '' ? data.id : null;
    const status = typeof data.status === 'string' ? data.status.toLowerCase() : null;
    const event = typeof envelope.event === 'string' ? envelope.event : null;
    if (id === null || (status === null && event === null)) {
      throw new ProviderContractViolation('Paycrest webhook carried no order id or status');
    }

    return {
      _tag: 'TRIGGER',
      providerRef: asProviderRef(id),
      // One trigger per order per transition: a redelivery of the same event
      // dedups; the next transition does not.
      eventId: `${id}:${event ?? status}`,
      observedAt: this.now(),
    };
  }

  /**
   * Orders that reached the recipient in the window, at the fiat they delivered.
   *
   * Paycrest's order carries the token amount and the rate, not the fiat paid,
   * so the fiat is recomputed — rounded down, never up — and the reconciler
   * compares it with what the transfer promised.
   */
  async fetchStatement(window: DateRange): Promise<StatementLine[]> {
    const lines: StatementLine[] = [];
    const pages = this.options.statementScanPages ?? 20;
    for (let page = 1; page <= pages; page++) {
      const orders = await this.client.listOrders(page, 100);
      for (const order of orders) {
        if (!SETTLED_STATUSES.has(order.status)) continue;
        const at = order.updatedAt === null ? null : new Date(order.updatedAt);
        if (at === null || at < window.start || at >= window.end) continue;
        lines.push(this.statementLine(order, at));
      }
      const oldest = orders.at(-1);
      const oldestAt = oldest?.createdAt == null ? null : new Date(oldest.createdAt);
      if (orders.length < 100 || (oldestAt !== null && oldestAt < window.start)) break;
    }
    return lines;
  }

  // ---------------------------------------------------------------- helpers

  private acknowledge(order: PaycrestOrder): PayoutAcknowledgement {
    return { _tag: 'ACKNOWLEDGED', providerRef: asProviderRef(order.id), receivedAt: this.now() };
  }

  private outcomeOf(order: PaycrestOrder): PayoutOutcome {
    const providerRef = asProviderRef(order.id);
    if (SETTLED_STATUSES.has(order.status)) {
      return {
        _tag: 'SETTLED',
        providerRef,
        institutionRef: order.txHash ?? order.id,
        settledAt: order.updatedAt === null ? this.now() : new Date(order.updatedAt),
      };
    }
    if (PENDING_STATUSES.has(order.status)) return { _tag: 'PENDING', providerRef };
    const reason = FAILED_STATUSES[order.status];
    if (reason !== undefined) {
      return {
        _tag: 'FAILED',
        providerRef,
        code: `PAYCREST_${order.status.toUpperCase()}`,
        reason,
        retryable: false,
      };
    }
    throw new ProviderContractViolation(
      `Paycrest reported an unknown order status "${order.status}"`,
    );
  }

  private statementLine(order: PaycrestOrder, valueDate: Date): StatementLine {
    const currency = Object.values(PAYCREST_PAYOUT_CURRENCIES).find(
      (c) => c === order.fiatCurrency,
    );
    if (currency === undefined) {
      throw new ProviderContractViolation(
        `Paycrest order ${order.id} paid out in a currency this adapter does not serve`,
      );
    }
    if (order.rate === null) {
      throw new ProviderContractViolation(`Paycrest order ${order.id} settled without a rate`);
    }
    const fiatMinor = fiatMinorForToken(
      decimalToMinorUnits(order.amount, TOKEN_EXPONENT),
      TOKEN_EXPONENT,
      parseDecimal(order.rate),
      getCurrency(currency).exponent,
    );
    return {
      providerRef: asProviderRef(order.id),
      amount: Money.fromMinorUnits(fiatMinor, currency),
      valueDate,
      description: `Paycrest order ${order.id}`,
      institutionRef: order.txHash,
    };
  }

  private async findByReference(reference: string): Promise<PaycrestOrder | null> {
    const pages = this.options.referenceScanPages ?? 3;
    for (let page = 1; page <= pages; page++) {
      const orders = await this.client.listOrders(page, 50);
      const match = orders.find((order) => order.reference === reference);
      if (match !== undefined) return match;
      if (orders.length < 50) return null;
    }
    return null;
  }

  private fiatCurrencyFor(recipient: RecipientDetails): CurrencyCode {
    const currency = (PAYCREST_PAYOUT_CURRENCIES as Record<string, CurrencyCode>)[
      recipient.country
    ];
    if (currency === undefined) {
      throw new ProviderContractViolation(`Paycrest does not pay out in ${recipient.country}`);
    }
    return currency;
  }

  private institutionFor(recipient: RecipientDetails): string | null {
    const map = this.options.institutions;
    const code =
      recipient.method === 'BANK_ACCOUNT'
        ? map.bank?.[recipient.country]?.[recipient.bankCode]
        : map.mobileMoney?.[recipient.country]?.[recipient.network];
    return code ?? null;
  }
}

/**
 * Paycrest's webhook check, as its guide specifies it: HMAC-SHA256 of the raw
 * body under the trimmed secret, lowercase hex, compared as text in constant time
 * with the trimmed, lowercased header.
 */
export function verifyPaycrestSignature(
  secret: string,
  rawBody: Buffer,
  presented: string,
): boolean {
  const computed = Buffer.from(
    createHmac('sha256', cleanPaycrestCredential(secret))
      .update(rawBody)
      .digest('hex')
      .toLowerCase(),
    'utf8',
  );
  const candidate = Buffer.from(presented.trim().toLowerCase(), 'utf8');
  if (candidate.length !== computed.length) {
    // Same work either way, so a wrong length does not show up in timing.
    timingSafeEqual(computed, computed);
    return false;
  }
  return timingSafeEqual(candidate, computed);
}

/**
 * The institution table from configuration (`PAYCREST_INSTITUTIONS`), checked
 * at boot so a typo is a startup failure rather than every recipient in a
 * country quietly becoming UNSUPPORTED.
 */
export function parsePaycrestInstitutions(json: string): PaycrestInstitutionMap {
  let raw: unknown;
  try {
    raw = JSON.parse(json === '' ? '{}' : json);
  } catch {
    throw new Error('PAYCREST_INSTITUTIONS is not valid JSON');
  }
  const out: Record<'bank' | 'mobileMoney', Record<string, Record<string, string>>> = {
    bank: {},
    mobileMoney: {},
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('PAYCREST_INSTITUTIONS must be an object with "bank" and/or "mobileMoney"');
  }
  for (const [kind, byCountry] of Object.entries(raw)) {
    if (kind !== 'bank' && kind !== 'mobileMoney') {
      throw new Error(`PAYCREST_INSTITUTIONS has an unknown key "${kind}"`);
    }
    if (typeof byCountry !== 'object' || byCountry === null) {
      throw new Error(`PAYCREST_INSTITUTIONS.${kind} must be an object`);
    }
    for (const [country, codes] of Object.entries(byCountry)) {
      if (!(country in PAYCREST_PAYOUT_CURRENCIES)) {
        throw new Error(
          `PAYCREST_INSTITUTIONS.${kind} names ${country}, where Paycrest does not pay out`,
        );
      }
      if (typeof codes !== 'object' || codes === null) {
        throw new Error(`PAYCREST_INSTITUTIONS.${kind}.${country} must be an object`);
      }
      const entries = Object.entries(codes as Record<string, unknown>);
      for (const [ours, theirs] of entries) {
        if (typeof theirs !== 'string' || theirs === '') {
          throw new Error(
            `PAYCREST_INSTITUTIONS.${kind}.${country}.${ours} must be a Paycrest code`,
          );
        }
      }
      out[kind][country] = Object.fromEntries(entries) as Record<string, string>;
    }
  }
  return out;
}

function accountIdentifier(recipient: RecipientDetails): string {
  return recipient.method === 'BANK_ACCOUNT' ? recipient.accountNumber : recipient.msisdn;
}

function header(headers: RawCallback['headers'], name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string' && value !== '') return value;
  }
  return null;
}
