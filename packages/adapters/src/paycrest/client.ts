import { ProviderContractViolation } from '../callback/signature';
import { parseJsonExact } from './json';

/**
 * Paycrest's Sender API, v2 (`https://api.paycrest.io/v2`).
 *
 * Written against Paycrest's published OpenAPI document (`openapi-v2.yaml` in
 * github.com/paycrest/docs) and its Sender API integration guide. v2 is the
 * current API; v1 is legacy. What v2 changed that matters here: every number is
 * a string on the wire, and an off-ramp order may be denominated in the fiat the
 * recipient receives (`amountIn: "fiat"`), so the adapter never divides by a rate.
 *
 * Anything this file reads from a response that the published schema does not
 * pin down is listed in docs/PAYCREST_ADAPTER.md as "to confirm on the first
 * live order". The client does transport and shape only — no money arithmetic,
 * no status interpretation, and no logging: requests and responses both carry
 * account numbers and names.
 */

export const PAYCREST_DEFAULT_BASE_URL = 'https://api.paycrest.io/v2';

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface PaycrestClientOptions {
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

/** Paycrest answered, and the answer was "no". */
export class PaycrestApiError extends Error {
  constructor(
    readonly httpStatus: number,
    /** Paycrest's own message. May name an account; never log it verbatim. */
    readonly providerMessage: string,
  ) {
    super(`Paycrest returned HTTP ${httpStatus}`);
    this.name = 'PaycrestApiError';
  }
}

/** An off-ramp order. Every value is the exact text Paycrest sent. */
export interface PaycrestOrder {
  readonly id: string;
  readonly status: string;
  /** Token amount the order settles, before fees. */
  readonly amount: string;
  /** Fiat per token. */
  readonly rate: string | null;
  readonly senderFee: string;
  readonly transactionFee: string;
  readonly reference: string | null;
  readonly txHash: string | null;
  /** The fiat the recipient is paid in (`destination.currency`). */
  readonly fiatCurrency: string | null;
  readonly institution: string | null;
  /** Where the stablecoin must be sent (`providerAccount`). Absent on list items Paycrest trims. */
  readonly deposit: {
    readonly receiveAddress: string;
    readonly network: string | null;
    readonly currency: string | null;
    /** amount + senderFee + transactionFee — the exact deposit. */
    readonly amountToTransfer: string;
    readonly validUntil: string | null;
    /** When present the deposit must carry it, or Paycrest cannot credit it. */
    readonly memo: string | null;
  } | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface PaycrestInstitution {
  readonly code: string;
  readonly name: string;
  readonly type: string;
}

export interface PaycrestCurrency {
  readonly code: string;
  readonly name: string;
  /** Paycrest's own count of decimal places, as text. Compared with ours, never assumed. */
  readonly decimals: string | null;
}

export interface OfframpOrderBody {
  /** Fiat amount, exact decimal text in the recipient's currency. */
  readonly amount: string;
  readonly amountIn: 'fiat';
  readonly reference: string;
  readonly source: {
    readonly type: 'crypto';
    readonly currency: string;
    readonly network: string;
    readonly refundAddress: string;
  };
  readonly destination: {
    readonly type: 'fiat';
    readonly currency: string;
    readonly recipient: {
      readonly institution: string;
      readonly accountIdentifier: string;
      readonly accountName: string;
      readonly memo: string;
    };
  };
}

export class PaycrestClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: PaycrestClientOptions) {
    this.baseUrl = (options.baseUrl || PAYCREST_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async currencies(): Promise<readonly PaycrestCurrency[]> {
    const data = await this.request('GET', '/currencies');
    return asArray(data, 'currencies').map((row) => ({
      code: str(row, 'code'),
      name: optStr(row, 'name') ?? '',
      decimals: optStr(row, 'decimals'),
    }));
  }

  async institutions(currency: string): Promise<readonly PaycrestInstitution[]> {
    const data = await this.request('GET', `/institutions/${encodeURIComponent(currency)}`);
    return asArray(data, 'institutions').map((row) => ({
      code: str(row, 'code'),
      name: optStr(row, 'name') ?? '',
      type: optStr(row, 'type') ?? 'unknown',
    }));
  }

  /**
   * The off-ramp ("sell") rate — fiat per token — for `tokenAmount` on
   * `network`, or `null` when no provider is quoting that side.
   */
  async sellRate(
    network: string,
    token: string,
    tokenAmount: string,
    fiat: string,
  ): Promise<string | null> {
    const path =
      `/rates/${encodeURIComponent(network)}/${encodeURIComponent(token)}/` +
      `${encodeURIComponent(tokenAmount)}/${encodeURIComponent(fiat)}?side=sell`;
    const data = await this.request('GET', path);
    const sell = isRecord(data) && isRecord(data.sell) ? data.sell : null;
    return sell === null ? null : optStr(sell, 'rate');
  }

  /**
   * Name enquiry. The name the institution holds, or `null` when Paycrest
   * accepts the account but has no name to give (it answers `"OK"` — KES M-Pesa,
   * for one).
   */
  async verifyAccount(institution: string, accountIdentifier: string): Promise<string | null> {
    const data = await this.request('POST', '/verify-account', { institution, accountIdentifier });
    if (typeof data !== 'string') return null;
    const name = data.trim();
    return name === '' || name.toUpperCase() === 'OK' ? null : name;
  }

  async createOfframpOrder(body: OfframpOrderBody): Promise<PaycrestOrder> {
    return readOrder(await this.request('POST', '/sender/orders', body));
  }

  async getOrder(id: string): Promise<PaycrestOrder> {
    return readOrder(await this.request('GET', `/sender/orders/${encodeURIComponent(id)}`));
  }

  /** Off-ramp orders, newest first. */
  async listOrders(page: number, pageSize: number): Promise<readonly PaycrestOrder[]> {
    const data = await this.request(
      'GET',
      `/sender/orders?page=${page}&pageSize=${pageSize}&direction=offramp`,
    );
    const orders = isRecord(data) ? data.orders : undefined;
    return asArray(orders ?? [], 'orders').map(readOrder);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        // Trimmed: a key pasted into .env through a console can carry a stray
        // carriage return, and Node refuses the whole request over it.
        'API-Key': this.options.apiKey.trim(),
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    let envelope: unknown;
    try {
      // v2 sends numbers as strings already; the exact parser is the guarantee
      // for any field that slips through as a JSON number.
      envelope = parseJsonExact(text);
    } catch {
      throw new PaycrestApiError(response.status, 'response was not JSON');
    }

    const status = isRecord(envelope) ? envelope.status : undefined;
    const message =
      isRecord(envelope) && typeof envelope.message === 'string' ? envelope.message : '';
    if (response.status < 200 || response.status >= 300 || status !== 'success') {
      throw new PaycrestApiError(response.status, message);
    }
    return (envelope as Record<string, unknown>).data;
  }
}

// ---------------------------------------------------------------- readers

function readOrder(raw: unknown): PaycrestOrder {
  if (!isRecord(raw)) throw new ProviderContractViolation('Paycrest order was not an object');
  const destination = isRecord(raw.destination) ? raw.destination : {};
  const recipient = isRecord(destination.recipient) ? destination.recipient : {};
  const account = isRecord(raw.providerAccount) ? raw.providerAccount : null;
  const receiveAddress = account === null ? null : optStr(account, 'receiveAddress');
  return {
    id: str(raw, 'id'),
    status: str(raw, 'status').toLowerCase(),
    amount: str(raw, 'amount'),
    rate: optStr(raw, 'rate'),
    senderFee: optStr(raw, 'senderFee') ?? '0',
    transactionFee: optStr(raw, 'transactionFee') ?? '0',
    reference: optStr(raw, 'reference'),
    txHash: optStr(raw, 'txHash'),
    fiatCurrency: optStr(destination, 'currency'),
    institution: optStr(recipient, 'institution'),
    deposit:
      account === null || receiveAddress === null
        ? null
        : {
            receiveAddress,
            network: optStr(account, 'network'),
            currency: optStr(account, 'currency'),
            amountToTransfer: str(account, 'amountToTransfer'),
            validUntil: optStr(account, 'validUntil'),
            memo: optStr(account, 'memo'),
          },
    createdAt: optStr(raw, 'createdAt') ?? optStr(raw, 'timestamp'),
    updatedAt: optStr(raw, 'updatedAt') ?? optStr(raw, 'timestamp'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown, what: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new ProviderContractViolation(`Paycrest ${what} response was not a list`);
  }
  return value.filter(isRecord);
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value === '') {
    throw new ProviderContractViolation(`Paycrest response is missing "${key}"`);
  }
  return value;
}

function optStr(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : null;
}
