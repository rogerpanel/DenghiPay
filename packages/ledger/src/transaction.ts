import { CurrencyCode, Money } from '@morapay/domain';
import { InvalidEntryError, UnbalancedTransactionError } from './errors';

export type Direction = 'DEBIT' | 'CREDIT';

export interface DraftEntry {
  readonly accountId: string;
  readonly direction: Direction;
  /** Always positive. The direction carries the sign. */
  readonly amount: Money<CurrencyCode>;
  readonly memo?: string;
}

export interface LedgerEntry extends DraftEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly sequence: number;
}

/**
 * Why a set of entries exists. Kept as a closed list so reporting can group by
 * it and so an unexpected value is a review conversation, not a new category
 * appearing in production.
 */
export const POSTING_REASONS = [
  'PAYIN_CONFIRMED',
  'SETTLEMENT_OUT',
  'SETTLEMENT_IN',
  'FX_DIFFERENCE',
  'PAYOUT_CONFIRMED',
  'PAYOUT_FAILED',
  'REFUND_EXECUTED',
  'FLOAT_PREFUNDING',
  'SUSPENSE_ENTRY',
  'SUSPENSE_RESOLUTION',
  'GENESIS',
] as const;

export type PostingReason = (typeof POSTING_REASONS)[number];

export interface DraftTransaction {
  readonly reason: PostingReason;
  readonly description: string;
  readonly occurredAt: Date;
  readonly entries: readonly DraftEntry[];
  /** Correlation to the business object: a transfer id, a prefunding id. */
  readonly reference: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface LedgerTransaction {
  readonly id: string;
  readonly reason: PostingReason;
  readonly description: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly reference: string | null;
  readonly idempotencyKey: string;
  readonly entries: readonly LedgerEntry[];
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Validate a draft before anything touches storage.
 *
 * Three rules, all of them load-bearing:
 *   - at least two entries, because one entry is not double-entry;
 *   - every amount strictly positive, because a negative debit is a credit
 *     written confusingly;
 *   - debits equal credits **per currency**, because a transaction that
 *     "balances" by netting rubles against naira balances nothing.
 *
 * The database enforces the same invariant with a trigger (BUILD_PLAN 1.2 DoD).
 * This function exists so the error arrives with a useful message, not so the
 * database can trust the application.
 */
export function validateDraft(draft: DraftTransaction): void {
  if (draft.entries.length < 2) {
    throw new InvalidEntryError('A ledger transaction needs at least two entries');
  }

  for (const entry of draft.entries) {
    if (!entry.amount.isPositive) {
      throw new InvalidEntryError(
        `Entry on ${entry.accountId} has non-positive amount ${entry.amount.toString()}; ` +
          'use the direction to express the sign',
      );
    }
  }

  const totals = new Map<CurrencyCode, { debit: bigint; credit: bigint }>();
  for (const entry of draft.entries) {
    const current = totals.get(entry.amount.currency) ?? { debit: 0n, credit: 0n };
    if (entry.direction === 'DEBIT') {
      current.debit += entry.amount.minorUnits;
    } else {
      current.credit += entry.amount.minorUnits;
    }
    totals.set(entry.amount.currency, current);
  }

  for (const [currency, { debit, credit }] of totals) {
    if (debit !== credit) {
      throw new UnbalancedTransactionError(currency, debit, credit);
    }
  }
}

/** Deterministic fingerprint of a draft, used to detect idempotency conflicts. */
export function fingerprintDraft(draft: DraftTransaction): string {
  const entries = draft.entries
    .map((e) => `${e.accountId}|${e.direction}|${e.amount.minorUnits}|${e.amount.currency}`)
    .slice()
    .sort()
    .join(';');
  return [draft.reason, draft.reference ?? '', draft.occurredAt.toISOString(), entries].join('#');
}

/** Sum of the debit side, per currency — the "size" of a transaction. */
export function transactionTotals(
  transaction: Pick<LedgerTransaction, 'entries'> | DraftTransaction,
): ReadonlyMap<CurrencyCode, bigint> {
  const totals = new Map<CurrencyCode, bigint>();
  for (const entry of transaction.entries) {
    if (entry.direction !== 'DEBIT') continue;
    totals.set(
      entry.amount.currency,
      (totals.get(entry.amount.currency) ?? 0n) + entry.amount.minorUnits,
    );
  }
  return totals;
}
