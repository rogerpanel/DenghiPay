import { CurrencyCode, Money } from '@morapay/domain';
import { Account, NORMAL_BALANCE } from './accounts';
import { LedgerEntry } from './transaction';
import { BalanceDriftError } from './errors';
import { BalanceSnapshot } from './store';

/**
 * Balances are derived, never stored as an editable field (guardrail G5).
 *
 * A snapshot exists so a dashboard does not fold ten million entries on every
 * page load, but the snapshot is a cache: `verifySnapshot` recomputes from
 * genesis and refuses to let the two diverge quietly.
 */

/** Raw debit-minus-credit, before the account's normal side is applied. */
export function rawBalanceMinorUnits(entries: readonly LedgerEntry[]): bigint {
  let total = 0n;
  for (const entry of entries) {
    total += entry.direction === 'DEBIT' ? entry.amount.minorUnits : -entry.amount.minorUnits;
  }
  return total;
}

/**
 * Balance in the account's natural reading: positive means "more of what this
 * account is for". A credit-normal account (a liability such as USER_PAYABLE)
 * reads positive when we owe money.
 */
export function deriveBalance(
  account: Account,
  entries: readonly LedgerEntry[],
): Money<CurrencyCode> {
  for (const entry of entries) {
    if (entry.amount.currency !== account.currency) {
      throw new Error(
        `Entry in ${entry.amount.currency} found on ${account.currency} account ${account.code}`,
      );
    }
  }
  const raw = rawBalanceMinorUnits(entries);
  const signed = NORMAL_BALANCE[account.type] === 'DEBIT' ? raw : -raw;
  return Money.fromMinorUnits(signed, account.currency);
}

export function deriveBalanceThrough(
  account: Account,
  entries: readonly LedgerEntry[],
  throughSequence: number,
): Money<CurrencyCode> {
  return deriveBalance(
    account,
    entries.filter((e) => e.sequence <= throughSequence),
  );
}

export interface SnapshotVerification {
  readonly accountId: string;
  readonly ok: boolean;
  readonly snapshotMinorUnits: bigint;
  readonly derivedMinorUnits: bigint;
  readonly driftMinorUnits: bigint;
}

/**
 * Recompute from genesis and compare (BUILD_PLAN 1.4 DoD).
 *
 * Returns the comparison rather than throwing, so the verification job can
 * report every drifting account in one pass instead of stopping at the first.
 */
export function verifySnapshot(
  account: Account,
  entries: readonly LedgerEntry[],
  snapshot: BalanceSnapshot,
): SnapshotVerification {
  const derived = deriveBalanceThrough(account, entries, snapshot.throughSequence);
  const drift = snapshot.minorUnits - derived.minorUnits;
  return {
    accountId: account.id,
    ok: drift === 0n,
    snapshotMinorUnits: snapshot.minorUnits,
    derivedMinorUnits: derived.minorUnits,
    driftMinorUnits: drift,
  };
}

export function assertNoDrift(verification: SnapshotVerification): void {
  if (!verification.ok) {
    throw new BalanceDriftError(
      verification.accountId,
      verification.snapshotMinorUnits,
      verification.derivedMinorUnits,
    );
  }
}

/**
 * The whole-ledger invariant: across every account, debits equal credits in
 * every currency. If this ever fails, stop the world.
 */
export function ledgerIsBalanced(entries: readonly LedgerEntry[]): {
  readonly balanced: boolean;
  readonly byCurrency: ReadonlyMap<CurrencyCode, bigint>;
} {
  const byCurrency = new Map<CurrencyCode, bigint>();
  for (const entry of entries) {
    const delta = entry.direction === 'DEBIT' ? entry.amount.minorUnits : -entry.amount.minorUnits;
    byCurrency.set(entry.amount.currency, (byCurrency.get(entry.amount.currency) ?? 0n) + delta);
  }
  const balanced = [...byCurrency.values()].every((v) => v === 0n);
  return { balanced, byCurrency };
}
