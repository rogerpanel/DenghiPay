import { CurrencyCode, Money, PayoutOutcome, TransferId } from '@morapay/domain';
import { DraftEntry, DraftTransaction, PostingReason } from './transaction';
import { LedgerError } from './errors';

/**
 * Posting builders — the ledger side of TECHNICAL_ARCHITECTURE §2.4.
 *
 * Each function returns a `DraftTransaction`; none of them touch storage. The
 * point of keeping them pure is that a test can assert the shape of every
 * posting without a database, and a reviewer can see the debits and credits in
 * one screen.
 */

export interface PayinConfirmedInput {
  readonly transferId: TransferId | string;
  readonly occurredAt: Date;
  /** Account codes, resolved by the caller. */
  readonly floatAccountId: string;
  readonly userPayableAccountId: string;
  readonly feeRevenueAccountId: string;
  /** What the sender actually paid: send amount + fixed fee. */
  readonly totalReceived: Money<CurrencyCode>;
  /** The fee component of that payment. */
  readonly fee: Money<CurrencyCode>;
}

/**
 * Pay-in confirmed: money arrives in our RUB float, and we owe the sender the
 * send amount. The fee is ours the moment we receive it.
 *
 *   DR FLOAT (send ccy)  total received
 *     CR USER_PAYABLE     send amount
 *     CR FEE_REVENUE      fee
 */
export function payinConfirmed(input: PayinConfirmedInput): DraftTransaction {
  const sendAmount = input.totalReceived.subtract(input.fee);
  if (sendAmount.isNegative) {
    throw new LedgerError('Fee exceeds the amount received', 'FEE_EXCEEDS_RECEIPT');
  }

  const entries: DraftEntry[] = [
    { accountId: input.floatAccountId, direction: 'DEBIT', amount: input.totalReceived },
    { accountId: input.userPayableAccountId, direction: 'CREDIT', amount: sendAmount },
  ];
  if (input.fee.isPositive) {
    entries.push({ accountId: input.feeRevenueAccountId, direction: 'CREDIT', amount: input.fee });
  }

  return {
    reason: 'PAYIN_CONFIRMED',
    description: `Pay-in confirmed for transfer ${String(input.transferId)}`,
    occurredAt: input.occurredAt,
    reference: String(input.transferId),
    entries,
  };
}

export interface SettlementOutInput {
  readonly transferId: TransferId | string;
  readonly occurredAt: Date;
  readonly sourceFloatAccountId: string;
  readonly partnerReceivableAccountId: string;
  readonly amount: Money<CurrencyCode>;
}

/**
 * Settlement, leg one: value leaves the source float and becomes a receivable
 * from the settlement partner.
 *
 *   DR PARTNER_RECEIVABLE   amount (source currency)
 *     CR FLOAT (send ccy)     amount
 */
export function settlementOut(input: SettlementOutInput): DraftTransaction {
  return {
    reason: 'SETTLEMENT_OUT',
    description: `Settlement out for transfer ${String(input.transferId)}`,
    occurredAt: input.occurredAt,
    reference: String(input.transferId),
    entries: [
      { accountId: input.partnerReceivableAccountId, direction: 'DEBIT', amount: input.amount },
      { accountId: input.sourceFloatAccountId, direction: 'CREDIT', amount: input.amount },
    ],
  };
}

export interface SettlementInInput {
  readonly transferId: TransferId | string;
  readonly occurredAt: Date;
  readonly destinationFloatAccountId: string;
  readonly partnerReceivableAccountId: string;
  /** Value arriving in the destination currency. */
  readonly amount: Money<CurrencyCode>;
}

/**
 * Settlement, leg two: value lands in the destination float, clearing the
 * receivable in that currency.
 *
 * Two transactions rather than one is deliberate. A single transaction with
 * rubles on one side and naira on the other would not balance in any currency,
 * and "balancing" it would mean inventing an exchange rate inside the ledger.
 */
export function settlementIn(input: SettlementInInput): DraftTransaction {
  return {
    reason: 'SETTLEMENT_IN',
    description: `Settlement in for transfer ${String(input.transferId)}`,
    occurredAt: input.occurredAt,
    reference: String(input.transferId),
    entries: [
      { accountId: input.destinationFloatAccountId, direction: 'DEBIT', amount: input.amount },
      { accountId: input.partnerReceivableAccountId, direction: 'CREDIT', amount: input.amount },
    ],
  };
}

export interface FxDifferenceInput {
  readonly transferId: TransferId | string;
  readonly occurredAt: Date;
  readonly partnerReceivableAccountId: string;
  readonly fxPnlAccountId: string;
  /** Positive when settlement returned more than expected. */
  readonly difference: Money<CurrencyCode>;
}

/**
 * The residue between what we expected settlement to yield and what it did.
 * It is booked explicitly rather than absorbed into a float, because a float
 * that quietly absorbs FX differences hides a broken rate feed.
 */
export function fxDifference(input: FxDifferenceInput): DraftTransaction {
  const gain = input.difference.isPositive;
  const amount = input.difference.abs();
  if (amount.isZero) {
    throw new LedgerError('Refusing to post a zero FX difference', 'ZERO_POSTING');
  }
  return {
    reason: 'FX_DIFFERENCE',
    description: `FX ${gain ? 'gain' : 'loss'} on transfer ${String(input.transferId)}`,
    occurredAt: input.occurredAt,
    reference: String(input.transferId),
    entries: gain
      ? [
          { accountId: input.partnerReceivableAccountId, direction: 'DEBIT', amount },
          { accountId: input.fxPnlAccountId, direction: 'CREDIT', amount },
        ]
      : [
          { accountId: input.fxPnlAccountId, direction: 'DEBIT', amount },
          { accountId: input.partnerReceivableAccountId, direction: 'CREDIT', amount },
        ],
  };
}

export interface PayoutResultInput {
  readonly transferId: TransferId | string;
  readonly occurredAt: Date;
  readonly userPayableAccountId: string;
  readonly destinationFloatAccountId: string;
  /** What the sender is owed, in the send currency. */
  readonly userPayableAmount: Money<CurrencyCode>;
  /** What left the destination float, in the destination currency. */
  readonly payoutAmount: Money<CurrencyCode>;
}

/**
 * Post the result of a payout.
 *
 * The signature is the enforcement point for TECHNICAL_ARCHITECTURE §3.2: the
 * `outcome` parameter is a `PayoutOutcome`, so an acknowledgement — which is
 * what a provider returns from `initiatePayout`, and what a callback carries —
 * will not type-check here. The double-credit bug becomes a compile error.
 */
export function postPayoutResult(
  outcome: PayoutOutcome,
  input: PayoutResultInput,
): DraftTransaction[] {
  switch (outcome._tag) {
    case 'PENDING':
      // Nothing has happened yet. Posting anything now is the bug we are avoiding.
      return [];

    case 'SETTLED':
      return [
        {
          reason: 'PAYOUT_CONFIRMED',
          description: `Payout confirmed for transfer ${String(input.transferId)} (${outcome.institutionRef})`,
          occurredAt: outcome.settledAt,
          reference: String(input.transferId),
          metadata: {
            providerRef: String(outcome.providerRef),
            institutionRef: outcome.institutionRef,
          },
          entries: [
            {
              accountId: input.userPayableAccountId,
              direction: 'DEBIT',
              amount: input.userPayableAmount,
            },
            {
              accountId: input.destinationFloatAccountId,
              direction: 'CREDIT',
              amount: input.userPayableAmount,
            },
          ],
        },
      ];

    case 'FAILED':
      // Nothing to post. `USER_PAYABLE` was credited at pay-in and is only
      // debited on a SETTLED outcome, so a failed payout leaves the liability
      // exactly where it already was: we still owe the sender. The value sits
      // in the destination float until the refund path moves it back, which is
      // a separate, approved transaction (BUILD_PLAN 5.4, 7.4).
      //
      // Posting a "reversal" here would be the double-credit bug wearing a
      // different hat: it would imply the payout had first been posted.
      return [];
  }
}

export interface RefundInput {
  readonly transferId: TransferId | string;
  readonly occurredAt: Date;
  readonly userPayableAccountId: string;
  readonly sourceFloatAccountId: string;
  readonly amount: Money<CurrencyCode>;
  readonly approvedBy: string;
  readonly reasonCode: string;
}

/**
 * Refund: our liability to the sender is discharged out of the source float.
 * Mirrored entries, its own reason code, its own approver — never a silent
 * reversal of the original posting (BUILD_PLAN 5.4).
 */
export function refundExecuted(input: RefundInput): DraftTransaction {
  return {
    reason: 'REFUND_EXECUTED',
    description: `Refund for transfer ${String(input.transferId)} (${input.reasonCode})`,
    occurredAt: input.occurredAt,
    reference: String(input.transferId),
    metadata: { approvedBy: input.approvedBy, reasonCode: input.reasonCode },
    entries: [
      { accountId: input.userPayableAccountId, direction: 'DEBIT', amount: input.amount },
      { accountId: input.sourceFloatAccountId, direction: 'CREDIT', amount: input.amount },
    ],
  };
}

export interface PrefundingInput {
  readonly prefundingId: string;
  readonly occurredAt: Date;
  readonly floatAccountId: string;
  readonly treasuryAccountId: string;
  readonly amount: Money<CurrencyCode>;
  readonly requestedBy: string;
  readonly approvedBy: string;
}

/** Treasury prefunding. Four-eyes is enforced before this is ever called. */
export function floatPrefunding(input: PrefundingInput): DraftTransaction {
  if (input.requestedBy === input.approvedBy) {
    throw new LedgerError(
      'Four-eyes violation: requester and approver are the same identity',
      'FOUR_EYES_VIOLATION',
    );
  }
  return {
    reason: 'FLOAT_PREFUNDING',
    description: `Prefunding ${input.prefundingId}`,
    occurredAt: input.occurredAt,
    reference: input.prefundingId,
    metadata: { requestedBy: input.requestedBy, approvedBy: input.approvedBy },
    entries: [
      { accountId: input.floatAccountId, direction: 'DEBIT', amount: input.amount },
      { accountId: input.treasuryAccountId, direction: 'CREDIT', amount: input.amount },
    ],
  };
}

export interface TwoSidedInput {
  readonly reason: PostingReason;
  readonly description: string;
  readonly occurredAt: Date;
  readonly reference: string | null;
  readonly debitAccountId: string;
  readonly creditAccountId: string;
  readonly amount: Money<CurrencyCode>;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * A single-currency, two-entry posting.
 *
 * The transfer saga composes cross-currency movement out of these, one per
 * currency, rather than writing a mixed-currency transaction. See the posting
 * sequence in docs/TECHNICAL_ARCHITECTURE.md §2.4: rubles and naira never meet
 * inside one transaction, because such a transaction balances in no currency
 * at all.
 */
export function twoSided(input: TwoSidedInput): DraftTransaction {
  if (!input.amount.isPositive) {
    throw new LedgerError('Refusing to post a zero or negative amount', 'ZERO_POSTING');
  }
  return {
    reason: input.reason,
    description: input.description,
    occurredAt: input.occurredAt,
    reference: input.reference,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    entries: [
      { accountId: input.debitAccountId, direction: 'DEBIT', amount: input.amount },
      { accountId: input.creditAccountId, direction: 'CREDIT', amount: input.amount },
    ],
  };
}

export interface SuspenseInput {
  readonly reference: string;
  readonly occurredAt: Date;
  readonly suspenseAccountId: string;
  readonly counterpartyAccountId: string;
  readonly amount: Money<CurrencyCode>;
  readonly note: string;
}

/** Anything unmatched lands here, and an alert goes with it. */
export function suspenseEntry(input: SuspenseInput): DraftTransaction {
  return {
    reason: 'SUSPENSE_ENTRY',
    description: `Unmatched item: ${input.note}`,
    occurredAt: input.occurredAt,
    reference: input.reference,
    entries: [
      { accountId: input.suspenseAccountId, direction: 'DEBIT', amount: input.amount },
      { accountId: input.counterpartyAccountId, direction: 'CREDIT', amount: input.amount },
    ],
  };
}
