import { CurrencyCode, IdempotencyKey, Money } from '@morapay/domain';
import { Account } from './accounts';
import { deriveBalance, verifySnapshot, SnapshotVerification } from './balances';
import { AccountNotFoundError } from './errors';
import { AccountSpec, LedgerStore } from './store';
import {
  DraftTransaction,
  LedgerTransaction,
  fingerprintDraft,
  validateDraft,
} from './transaction';

/**
 * The only writer of financial state (guardrail G5).
 *
 * Nothing else in the system inserts a ledger row. Services that need money to
 * move build a `DraftTransaction` and hand it here with an idempotency key.
 */
export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  /**
   * Post a balanced transaction.
   *
   * Replay with the same key and the same content returns the original
   * transaction and touches nothing. Replay with the same key and different
   * content is a conflict, raised by the store.
   */
  async post(
    draft: DraftTransaction,
    idempotencyKey: IdempotencyKey | string,
  ): Promise<LedgerTransaction> {
    validateDraft(draft);
    const result = await this.store.append({
      draft,
      idempotencyKey: String(idempotencyKey),
      fingerprint: fingerprintDraft(draft),
    });
    return result.transaction;
  }

  /** Post and report whether this call did the work or found it already done. */
  async postWithReplayFlag(
    draft: DraftTransaction,
    idempotencyKey: IdempotencyKey | string,
  ): Promise<{ transaction: LedgerTransaction; replayed: boolean }> {
    validateDraft(draft);
    return this.store.append({
      draft,
      idempotencyKey: String(idempotencyKey),
      fingerprint: fingerprintDraft(draft),
    });
  }

  async ensureAccount(spec: AccountSpec): Promise<Account> {
    return this.store.ensureAccount(spec);
  }

  async accountByCode(code: string): Promise<Account> {
    const account = await this.store.getAccountByCode(code);
    if (account === null) throw new AccountNotFoundError(code);
    return account;
  }

  /** Derived balance. There is no stored, mutable alternative to this. */
  async balanceOf(code: string): Promise<Money<CurrencyCode>> {
    const account = await this.accountByCode(code);
    const entries = await this.store.entriesForAccount(account.id);
    return deriveBalance(account, entries);
  }

  async balanceOfAccount(account: Account): Promise<Money<CurrencyCode>> {
    return deriveBalance(account, await this.store.entriesForAccount(account.id));
  }

  async transactionsFor(reference: string): Promise<readonly LedgerTransaction[]> {
    return this.store.listTransactions({ reference });
  }

  /**
   * Refresh the materialised snapshot for one account.
   * Returns the verification so a caller can alert on drift it just corrected.
   */
  async refreshSnapshot(account: Account): Promise<SnapshotVerification | null> {
    const entries = await this.store.entriesForAccount(account.id);
    const throughSequence = entries.reduce((max, e) => (e.sequence > max ? e.sequence : max), 0);
    const existing = await this.store.getSnapshot(account.id);
    const verification = existing === null ? null : verifySnapshot(account, entries, existing);

    await this.store.putSnapshot({
      accountId: account.id,
      minorUnits: deriveBalance(account, entries).minorUnits,
      throughSequence,
      computedAt: new Date(),
    });

    return verification;
  }

  /**
   * The drift detector (BUILD_PLAN 1.4). Recomputes every account from genesis
   * and reports every disagreement, rather than stopping at the first.
   */
  async detectDrift(): Promise<readonly SnapshotVerification[]> {
    const accounts = await this.store.listAccounts();
    const results: SnapshotVerification[] = [];
    for (const account of accounts) {
      const snapshot = await this.store.getSnapshot(account.id);
      if (snapshot === null) continue;
      const entries = await this.store.entriesForAccount(account.id);
      results.push(verifySnapshot(account, entries, snapshot));
    }
    return results;
  }
}
