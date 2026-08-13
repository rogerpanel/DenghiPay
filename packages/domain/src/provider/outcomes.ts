import { ProviderRef } from '../ids';

/**
 * The FreshPay bug, made unrepresentable (TECHNICAL_ARCHITECTURE §3.2).
 *
 * In the FreshPay spec `Status: "Success"` means "we received your request"
 * while `Trans_Status: "Failed"` carries the real outcome — both in the same
 * response body. Any integration that reads the first field credits customers
 * whose payments failed.
 *
 * Here an acknowledgement, a callback trigger and an outcome are three distinct
 * types with different discriminants. The ledger accepts only an outcome, so
 * passing an acknowledgement where settlement is expected is a compile error
 * rather than a double credit.
 *
 * These types live in `domain` rather than `adapters` so that `ledger` can
 * depend on them without depending on the adapter layer. See
 * docs/DIVERGENCE_LOG.md.
 */

/** Provider received the request. NO money has moved. */
export type PayoutAcknowledgement = {
  readonly _tag: 'ACKNOWLEDGED';
  readonly providerRef: ProviderRef;
  readonly receivedAt: Date;
};

/** Only ever produced by getStatus() or reconciliation. */
export type PayoutOutcome =
  | { readonly _tag: 'PENDING'; readonly providerRef: ProviderRef }
  | {
      readonly _tag: 'SETTLED';
      readonly providerRef: ProviderRef;
      readonly institutionRef: string;
      readonly settledAt: Date;
    }
  | {
      readonly _tag: 'FAILED';
      readonly providerRef: ProviderRef;
      readonly code: string;
      readonly reason: string;
      readonly retryable: boolean;
    };

/** A callback is a hint that something changed. Nothing more. */
export type CallbackTrigger = {
  readonly _tag: 'TRIGGER';
  readonly providerRef: ProviderRef;
  /** Dedup key. Required — a callback without one cannot be replay-protected. */
  readonly eventId: string;
  readonly observedAt: Date;
};

/** The same three-way split for the pay-in leg. */
export type PayinAcknowledgement = {
  readonly _tag: 'ACKNOWLEDGED';
  readonly providerRef: ProviderRef;
  readonly receivedAt: Date;
  /** What the sender needs in order to pay: an SBP link, a QR payload, an account. */
  readonly instructions: PayinInstructions;
};

export type PayinInstructions =
  | { readonly kind: 'SBP'; readonly deepLink: string; readonly expiresAt: Date }
  | { readonly kind: 'QR'; readonly payload: string; readonly expiresAt: Date }
  | {
      readonly kind: 'VIRTUAL_ACCOUNT';
      readonly accountNumber: string;
      readonly bankName: string;
      readonly reference: string;
    }
  | { readonly kind: 'CARD'; readonly redirectUrl: string; readonly expiresAt: Date };

export type PayinOutcome =
  | { readonly _tag: 'PENDING'; readonly providerRef: ProviderRef }
  | {
      readonly _tag: 'SETTLED';
      readonly providerRef: ProviderRef;
      readonly institutionRef: string;
      readonly settledAt: Date;
      /** Minor units actually received, as reported by the provider. */
      readonly receivedMinorUnits: bigint;
    }
  | {
      readonly _tag: 'FAILED';
      readonly providerRef: ProviderRef;
      readonly code: string;
      readonly reason: string;
      readonly retryable: boolean;
    };

export function isSettled(
  outcome: PayoutOutcome | PayinOutcome,
): outcome is Extract<PayoutOutcome | PayinOutcome, { _tag: 'SETTLED' }> {
  return outcome._tag === 'SETTLED';
}

export function isFailed(
  outcome: PayoutOutcome | PayinOutcome,
): outcome is Extract<PayoutOutcome | PayinOutcome, { _tag: 'FAILED' }> {
  return outcome._tag === 'FAILED';
}

export function isTerminalOutcome(outcome: PayoutOutcome | PayinOutcome): boolean {
  return outcome._tag !== 'PENDING';
}

/** Result of a name enquiry, shown to the sender before they commit. */
export type RecipientResolution =
  | {
      readonly _tag: 'RESOLVED';
      /** The name the institution holds. This is what the sender confirms. */
      readonly resolvedName: string;
      readonly institution: string;
    }
  | { readonly _tag: 'NOT_FOUND'; readonly reason: string }
  | { readonly _tag: 'UNSUPPORTED'; readonly reason: string };
