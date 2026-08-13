import {
  CallbackTrigger,
  CorridorId,
  CurrencyCode,
  IdempotencyKey,
  Money,
  PayinAcknowledgement,
  PayinMethod,
  PayinOutcome,
  ProviderId,
  ProviderRef,
} from '@morapay/domain';
import { DateRange, RawCallback, StatementLine } from './payout-provider';

/**
 * The pay-in port (BUILD_PLAN 6.1).
 *
 * This is the leg the Paycrest deck assumes someone else has already built —
 * see TECHNICAL_ARCHITECTURE §1.1. Until a Russian licensed partner fills that
 * role, the only implementation is the simulator, and that is enough to build
 * and test the entire lifecycle.
 */
export interface PayinProvider {
  readonly id: ProviderId;
  readonly supportedCorridors: readonly CorridorId[];
  readonly supportedMethods: readonly PayinMethod[];

  /**
   * Ask the provider to collect from the sender. Returns instructions the
   * sender can act on and an acknowledgement — not a receipt of funds.
   */
  initiatePayin(req: PayinRequest, idempotencyKey: IdempotencyKey): Promise<PayinAcknowledgement>;

  /** Authoritative. Safe to call repeatedly. */
  getStatus(ref: ProviderRef): Promise<PayinOutcome>;

  parseCallback(raw: RawCallback): Promise<CallbackTrigger>;

  fetchStatement(window: DateRange): Promise<StatementLine[]>;
}

export interface PayinRequest {
  readonly corridorId: CorridorId;
  readonly method: PayinMethod;
  readonly amount: Money<CurrencyCode>;
  readonly reference: string;
  /** Tokenised sender reference. Never a name — this crosses a partition boundary. */
  readonly senderToken: string;
}
