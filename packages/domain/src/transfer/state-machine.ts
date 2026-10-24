import { IllegalTransitionError } from '../errors';

/**
 * Transfer lifecycle (BUILD_PLAN 5.1, TECHNICAL_ARCHITECTURE §2.3).
 *
 * `PAYOUT_INITIATED` is deliberately distinct from `PAYOUT_CONFIRMED`.
 * Collapsing them is the FreshPay `Status`/`Trans_Status` bug expressed in
 * state: an acknowledgement is not a settlement.
 */
export const TRANSFER_STATES = [
  'DRAFT',
  'QUOTED',
  'COMPLIANCE_PENDING',
  'ON_HOLD',
  'AWAITING_PAYIN',
  'PAYIN_CONFIRMED',
  'SETTLING',
  'PAYOUT_INITIATED',
  'PAYOUT_CONFIRMED',
  'COMPLETED',
  'REFUNDING',
  'REFUNDED',
  'FAILED',
] as const;

export type TransferState = (typeof TRANSFER_STATES)[number];

export const TRANSFER_EVENTS = [
  'QUOTE_ISSUED',
  'CONFIRM',
  'QUOTE_EXPIRED',
  'SCREEN_CLEAR',
  'SCREEN_HIT',
  'OFFICER_CLEARED',
  'OFFICER_REJECTED',
  'PAYIN_RECEIVED',
  'PAYIN_TIMEOUT',
  'SETTLEMENT_STARTED',
  'PAYOUT_SUBMITTED',
  'NO_LIQUIDITY',
  'PAYOUT_SETTLED',
  'PAYOUT_FAILED',
  'COMPLETE',
  'REFUND_EXECUTED',
] as const;

export type TransferEvent = (typeof TRANSFER_EVENTS)[number];

/**
 * The transition table is the whole state machine. It is total in the sense
 * that every legal (state, event) pair appears exactly once and nothing else is
 * reachable — `transition` throws on anything absent.
 */
const TRANSITIONS: {
  readonly [S in TransferState]: Partial<Record<TransferEvent, TransferState>>;
} = {
  DRAFT: { QUOTE_ISSUED: 'QUOTED' },
  QUOTED: { CONFIRM: 'COMPLIANCE_PENDING', QUOTE_EXPIRED: 'FAILED' },
  COMPLIANCE_PENDING: { SCREEN_CLEAR: 'AWAITING_PAYIN', SCREEN_HIT: 'ON_HOLD' },
  ON_HOLD: { OFFICER_CLEARED: 'AWAITING_PAYIN', OFFICER_REJECTED: 'FAILED' },
  AWAITING_PAYIN: { PAYIN_RECEIVED: 'PAYIN_CONFIRMED', PAYIN_TIMEOUT: 'FAILED' },
  PAYIN_CONFIRMED: { SETTLEMENT_STARTED: 'SETTLING' },
  SETTLING: { PAYOUT_SUBMITTED: 'PAYOUT_INITIATED', NO_LIQUIDITY: 'REFUNDING' },
  PAYOUT_INITIATED: { PAYOUT_SETTLED: 'PAYOUT_CONFIRMED', PAYOUT_FAILED: 'REFUNDING' },
  PAYOUT_CONFIRMED: { COMPLETE: 'COMPLETED' },
  REFUNDING: { REFUND_EXECUTED: 'REFUNDED' },
  COMPLETED: {},
  REFUNDED: {},
  FAILED: {},
};

export const TERMINAL_STATES: readonly TransferState[] = ['COMPLETED', 'REFUNDED', 'FAILED'];

/**
 * States at or beyond which the sender's money is in our hands. Reaching any of
 * them without a passing screening record is a guardrail G3 violation.
 */
export const POST_COMPLIANCE_STATES: readonly TransferState[] = [
  'AWAITING_PAYIN',
  'PAYIN_CONFIRMED',
  'SETTLING',
  'PAYOUT_INITIATED',
  'PAYOUT_CONFIRMED',
  'COMPLETED',
];

export function isTerminal(state: TransferState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function nextState(from: TransferState, event: TransferEvent): TransferState | undefined {
  return TRANSITIONS[from][event];
}

export function canTransition(from: TransferState, event: TransferEvent): boolean {
  return nextState(from, event) !== undefined;
}

/** Apply an event. Illegal transitions throw — they are never silently ignored. */
export function transition(from: TransferState, event: TransferEvent): TransferState {
  const to = nextState(from, event);
  if (to === undefined) {
    throw new IllegalTransitionError(from, event);
  }
  return to;
}

export function allowedEvents(from: TransferState): readonly TransferEvent[] {
  return Object.keys(TRANSITIONS[from]) as TransferEvent[];
}

/**
 * Sender-facing labels (BUILD_PLAN 10.5 — "clear, non-technical states").
 * The i18n layer keys off these identifiers rather than the raw state, so
 * renaming an internal state never changes what a sender reads.
 */
export const SENDER_FACING_STATUS: Readonly<Record<TransferState, string>> = {
  DRAFT: 'draft',
  QUOTED: 'awaiting_confirmation',
  COMPLIANCE_PENDING: 'checking',
  ON_HOLD: 'under_review',
  AWAITING_PAYIN: 'awaiting_your_payment',
  PAYIN_CONFIRMED: 'payment_received',
  SETTLING: 'converting',
  PAYOUT_INITIATED: 'sending_to_recipient',
  PAYOUT_CONFIRMED: 'delivered',
  COMPLETED: 'completed',
  REFUNDING: 'refund_in_progress',
  REFUNDED: 'refunded',
  FAILED: 'failed',
};
