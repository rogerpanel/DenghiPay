import { CurrencyCode } from '@morapay/domain';
import { Account, AccountType, Partition } from './accounts';
import { DraftTransaction, LedgerEntry, LedgerTransaction } from './transaction';

export interface AccountSpec {
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly partition: Partition;
  readonly scope?: string;
  readonly ownerRef?: string | null;
}

export interface AppendInput {
  readonly draft: DraftTransaction;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
}

export interface AppendResult {
  readonly transaction: LedgerTransaction;
  /** True when the key had already been used with the same fingerprint. */
  readonly replayed: boolean;
}

export interface BalanceSnapshot {
  readonly accountId: string;
  readonly minorUnits: bigint;
  /** Entries up to and including this global sequence are folded in. */
  readonly throughSequence: number;
  readonly computedAt: Date;
}

/**
 * The persistence port.
 *
 * The ledger core knows nothing about Postgres, Prisma or TigerBeetle. An
 * implementation must guarantee two things, and the tests in this package hold
 * it to both:
 *
 *  1. `append` is atomic — either the transaction and all of its entries are
 *     visible, or none of them are.
 *  2. `append` is idempotent under concurrency — a hundred simultaneous calls
 *     with one idempotency key produce exactly one transaction.
 */
export interface LedgerStore {
  getAccountByCode(code: string): Promise<Account | null>;
  getAccountById(id: string): Promise<Account | null>;
  ensureAccount(spec: AccountSpec): Promise<Account>;
  listAccounts(): Promise<readonly Account[]>;

  append(input: AppendInput): Promise<AppendResult>;

  getTransactionById(id: string): Promise<LedgerTransaction | null>;
  listTransactions(filter?: {
    readonly reference?: string;
    readonly limit?: number;
  }): Promise<readonly LedgerTransaction[]>;

  entriesForAccount(accountId: string): Promise<readonly LedgerEntry[]>;

  getSnapshot(accountId: string): Promise<BalanceSnapshot | null>;
  putSnapshot(snapshot: BalanceSnapshot): Promise<void>;
}
