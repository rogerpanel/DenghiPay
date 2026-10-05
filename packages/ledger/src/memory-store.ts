import { randomUUID } from 'node:crypto';
import { Account } from './accounts';
import { accountCode, assertAccountCurrency } from './accounts';
import { IdempotencyConflictError } from './errors';
import { AccountSpec, AppendInput, AppendResult, BalanceSnapshot, LedgerStore } from './store';
import { LedgerEntry, LedgerTransaction } from './transaction';

/**
 * Reference implementation of `LedgerStore`, in memory.
 *
 * It exists to run the ledger contract tests without a database, and to make
 * the atomicity and idempotency requirements concrete: every `append` runs
 * through a single-slot mutex, which is what the Postgres implementation gets
 * from a serialisable transaction plus a unique index on the idempotency key.
 */
export class InMemoryLedgerStore implements LedgerStore {
  private readonly accounts = new Map<string, Account>();
  private readonly accountsByCode = new Map<string, Account>();
  private readonly transactions = new Map<string, LedgerTransaction>();
  private readonly byIdempotencyKey = new Map<string, { id: string; fingerprint: string }>();
  private readonly entriesByAccount = new Map<string, LedgerEntry[]>();
  private readonly snapshots = new Map<string, BalanceSnapshot>();
  private sequence = 0;
  private tail: Promise<unknown> = Promise.resolve();

  async getAccountByCode(code: string): Promise<Account | null> {
    return this.accountsByCode.get(code) ?? null;
  }

  async getAccountById(id: string): Promise<Account | null> {
    return this.accounts.get(id) ?? null;
  }

  async listAccounts(): Promise<readonly Account[]> {
    return [...this.accounts.values()];
  }

  async ensureAccount(spec: AccountSpec): Promise<Account> {
    assertAccountCurrency(spec.type, spec.currency);
    const code = accountCode(spec.type, spec.currency, spec.scope);
    const existing = this.accountsByCode.get(code);
    if (existing !== undefined) return existing;

    const account: Account = {
      id: randomUUID(),
      code,
      type: spec.type,
      currency: spec.currency,
      partition: spec.partition,
      ownerRef: spec.ownerRef ?? null,
    };
    this.accounts.set(account.id, account);
    this.accountsByCode.set(code, account);
    this.entriesByAccount.set(account.id, []);
    return account;
  }

  /** Serialised so concurrent callers cannot interleave the check and the write. */
  async append(input: AppendInput): Promise<AppendResult> {
    const run = this.tail.then(
      () => this.appendUnsafe(input),
      () => this.appendUnsafe(input),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async appendUnsafe(input: AppendInput): Promise<AppendResult> {
    const seen = this.byIdempotencyKey.get(input.idempotencyKey);
    if (seen !== undefined) {
      if (seen.fingerprint !== input.fingerprint) {
        throw new IdempotencyConflictError(input.idempotencyKey);
      }
      const existing = this.transactions.get(seen.id);
      if (existing === undefined) {
        throw new Error(`Ledger inconsistency: transaction ${seen.id} missing`);
      }
      return { transaction: existing, replayed: true };
    }

    const transactionId = randomUUID();
    const entries: LedgerEntry[] = input.draft.entries.map((entry) => ({
      ...entry,
      id: randomUUID(),
      transactionId,
      sequence: ++this.sequence,
    }));

    const transaction: LedgerTransaction = {
      id: transactionId,
      reason: input.draft.reason,
      description: input.draft.description,
      occurredAt: input.draft.occurredAt,
      recordedAt: new Date(),
      reference: input.draft.reference,
      idempotencyKey: input.idempotencyKey,
      entries,
      metadata: input.draft.metadata ?? {},
    };

    this.transactions.set(transactionId, transaction);
    this.byIdempotencyKey.set(input.idempotencyKey, {
      id: transactionId,
      fingerprint: input.fingerprint,
    });
    for (const entry of entries) {
      const list = this.entriesByAccount.get(entry.accountId);
      if (list === undefined) {
        throw new Error(`Ledger inconsistency: unknown account ${entry.accountId}`);
      }
      list.push(entry);
    }

    return { transaction, replayed: false };
  }

  async getTransactionById(id: string): Promise<LedgerTransaction | null> {
    return this.transactions.get(id) ?? null;
  }

  async listTransactions(
    filter: { readonly reference?: string; readonly limit?: number } = {},
  ): Promise<readonly LedgerTransaction[]> {
    let all = [...this.transactions.values()].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    );
    if (filter.reference !== undefined) {
      all = all.filter((t) => t.reference === filter.reference);
    }
    return filter.limit === undefined ? all : all.slice(0, filter.limit);
  }

  async entriesForAccount(accountId: string): Promise<readonly LedgerEntry[]> {
    return [...(this.entriesByAccount.get(accountId) ?? [])];
  }

  async allEntries(): Promise<readonly LedgerEntry[]> {
    return [...this.entriesByAccount.values()].flat().sort((a, b) => a.sequence - b.sequence);
  }

  async getSnapshot(accountId: string): Promise<BalanceSnapshot | null> {
    return this.snapshots.get(accountId) ?? null;
  }

  async putSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    this.snapshots.set(snapshot.accountId, snapshot);
  }

  /** Test-only: corrupt a snapshot so the drift detector has something to find. */
  corruptSnapshotForTest(accountId: string, minorUnits: bigint): void {
    const existing = this.snapshots.get(accountId);
    if (existing === undefined) throw new Error(`No snapshot for ${accountId}`);
    this.snapshots.set(accountId, { ...existing, minorUnits });
  }
}
