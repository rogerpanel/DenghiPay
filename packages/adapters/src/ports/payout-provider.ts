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
} from '@morapay/domain';

/**
 * The payout port (TECHNICAL_ARCHITECTURE §3.1).
 *
 * Every provider we will meet — Paycrest, Fincra, a FreshPay-shaped aggregator —
 * reduces to these five operations. Normalising them here is what lets us swap
 * or dual-source a rail without touching transfer logic.
 *
 * Note what the signatures refuse to allow:
 *   - `initiatePayout` returns an acknowledgement, never an outcome;
 *   - `parseCallback` returns a trigger, never an outcome;
 *   - only `getStatus` and `fetchStatement` produce something the ledger accepts.
 */
export interface PayoutProvider {
  readonly id: ProviderId;
  readonly supportedCorridors: readonly CorridorId[];

  /** Resolve recipient identity before the sender commits. */
  resolveRecipient(req: RecipientQuery): Promise<RecipientResolution>;

  /** Submit. Returns an acknowledgement — never a settlement. */
  initiatePayout(
    req: PayoutRequest,
    idempotencyKey: IdempotencyKey,
  ): Promise<PayoutAcknowledgement>;

  /** The authoritative source. Safe to call repeatedly. */
  getStatus(ref: ProviderRef): Promise<PayoutOutcome>;

  /** Verify and normalise an inbound webhook. Never returns an outcome. */
  parseCallback(raw: RawCallback): Promise<CallbackTrigger>;

  /** Batch statement for T+1 reconciliation. */
  fetchStatement(window: DateRange): Promise<StatementLine[]>;
}

export interface RecipientQuery {
  readonly corridorId: CorridorId;
  readonly recipient: RecipientDetails;
}

export interface PayoutRequest {
  readonly corridorId: CorridorId;
  readonly recipient: RecipientDetails;
  readonly amount: Money<CurrencyCode>;
  /** Our reference, shown on the recipient's statement where the rail allows it. */
  readonly reference: string;
  readonly narration: string;
}

export interface RawCallback {
  readonly rawBody: Buffer;
  readonly timestamp: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

export interface StatementLine {
  readonly providerRef: ProviderRef;
  readonly amount: Money<CurrencyCode>;
  readonly valueDate: Date;
  readonly description: string;
  readonly institutionRef: string | null;
}
