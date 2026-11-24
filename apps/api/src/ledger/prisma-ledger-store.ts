import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireCurrencyCode } from '@morapay/domain';
import {
  Account,
  AccountSpec,
  AccountType,
  AppendInput,
  AppendResult,
  BalanceSnapshot,
  IdempotencyConflictError,
  LedgerEntry,
  LedgerStore,
  LedgerTransaction,
  Partition,
  PostingReason,
  accountCode,
  assertAccountCurrency,
} from '@morapay/ledger';
import { PrismaService } from '../common/prisma.service';
import { toMoney } from '../common/money.util';

/**
 * PostgreSQL implementation of the ledger port (ADR 0003).
 *
 * Two guarantees the port demands, and how they are met here:
 *
 *  1. **Atomicity** — the transaction row and all of its entries are written in
 *     one database transaction. The balance trigger is `DEFERRABLE INITIALLY
 *     DEFERRED`, so it fires once at COMMIT with every entry visible.
 *  2. **Idempotency under concurrency** — `ledger_transaction.idempotency_key`
 *     carries a unique index. Two concurrent appends with one key means one
 *     INSERT succeeds and the other gets a unique-violation, which is caught
 *     and resolved to the winner's row. No advisory locks, no read-then-write
 *     race.
 */
@Injectable()
export class PrismaLedgerStore implements LedgerStore {
  constructor(private readonly prisma: PrismaService) {}

  async getAccountByCode(code: string): Promise<Account | null> {
    const row = await this.prisma.ledgerAccount.findUnique({ where: { code } });
    return row === null ? null : toAccount(row);
  }

  async getAccountById(id: string): Promise<Account | null> {
    const row = await this.prisma.ledgerAccount.findUnique({ where: { id } });
    return row === null ? null : toAccount(row);
  }

  async listAccounts(): Promise<readonly Account[]> {
    const rows = await this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
    return rows.map(toAccount);
  }

  /**
   * Get the account with this code, creating it if it does not exist.
   *
   * Prisma's `upsert` is not atomic against a concurrent insert of the same
   * code: two callers can both find nothing and both try to create, and one
   * gets a unique-constraint violation. Postgres is right to refuse — the
   * constraint is what guarantees one account per code — so the fix is to treat
   * that refusal as the other caller having won, and read their row.
   *
   * This is not theoretical and it is not only about two requests. A
   * same-currency transfer resolves its source and destination user-payable
   * accounts to the *same code*, and `accountsFor` resolves them in one
   * `Promise.all` — so a single XOF→XOF transfer raced against itself and
   * failed at collection with an internal error. Fourteen corridors in the mesh
   * are same-currency, and none existed before the Paycrest markets.
   */
  async ensureAccount(spec: AccountSpec): Promise<Account> {
    assertAccountCurrency(spec.type, spec.currency);
    const code = accountCode(spec.type, spec.currency, spec.scope);
    try {
      const row = await this.prisma.ledgerAccount.upsert({
        where: { code },
        update: {},
        create: {
          code,
          type: spec.type,
          currency: spec.currency,
          partition: spec.partition,
          ownerRef: spec.ownerRef ?? null,
        },
      });
      return toAccount(row);
    } catch (error) {
      if (!isUniqueViolation(error, 'code')) throw error;
      // Somebody else created it between our read and our write. Their row is
      // the same account by definition — the code determines type, currency and
      // scope — so returning it is correct rather than merely tolerable.
      const existing = await this.prisma.ledgerAccount.findUnique({ where: { code } });
      if (existing === null) throw error;
      return toAccount(existing);
    }
  }

  async append(input: AppendInput): Promise<AppendResult> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const transaction = await tx.ledgerTransaction.create({
          data: {
            reason: input.draft.reason,
            description: input.draft.description,
            occurredAt: input.draft.occurredAt,
            reference: input.draft.reference,
            idempotencyKey: input.idempotencyKey,
            fingerprint: input.fingerprint,
            metadata: input.draft.metadata ?? {},
          },
        });

        await tx.ledgerEntry.createMany({
          data: input.draft.entries.map((entry) => ({
            transactionId: transaction.id,
            accountId: entry.accountId,
            direction: entry.direction,
            amountMinorUnits: entry.amount.minorUnits,
            currency: entry.amount.currency,
            memo: entry.memo ?? null,
          })),
        });

        return transaction.id;
      });

      const transaction = await this.getTransactionById(created);
      if (transaction === null) {
        throw new Error(`Ledger inconsistency: transaction ${created} vanished after commit`);
      }
      return { transaction, replayed: false };
    } catch (error) {
      if (isUniqueViolation(error, 'idempotency_key', 'idempotencyKey')) {
        return this.resolveReplay(input);
      }
      throw error;
    }
  }

  /**
   * Someone else won the race, or this is a genuine retry. Either way the
   * question is the same: was it the same request?
   */
  private async resolveReplay(input: AppendInput): Promise<AppendResult> {
    const existing = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: true },
    });
    if (existing === null) {
      throw new Error(
        `Idempotency key ${input.idempotencyKey} collided but no transaction is visible`,
      );
    }
    if (existing.fingerprint !== input.fingerprint) {
      throw new IdempotencyConflictError(input.idempotencyKey);
    }
    return { transaction: toTransaction(existing), replayed: true };
  }

  async getTransactionById(id: string): Promise<LedgerTransaction | null> {
    const row = await this.prisma.ledgerTransaction.findUnique({
      where: { id },
      include: { entries: { orderBy: { sequence: 'asc' } } },
    });
    return row === null ? null : toTransaction(row);
  }

  async listTransactions(
    filter: { readonly reference?: string; readonly limit?: number } = {},
  ): Promise<readonly LedgerTransaction[]> {
    const rows = await this.prisma.ledgerTransaction.findMany({
      where: filter.reference === undefined ? {} : { reference: filter.reference },
      include: { entries: { orderBy: { sequence: 'asc' } } },
      orderBy: { recordedAt: 'asc' },
      take: filter.limit ?? 200,
    });
    return rows.map(toTransaction);
  }

  async entriesForAccount(accountId: string): Promise<readonly LedgerEntry[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { accountId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map(toEntry);
  }

  async allEntries(): Promise<readonly LedgerEntry[]> {
    const rows = await this.prisma.ledgerEntry.findMany({ orderBy: { sequence: 'asc' } });
    return rows.map(toEntry);
  }

  async getSnapshot(accountId: string): Promise<BalanceSnapshot | null> {
    const row = await this.prisma.ledgerBalanceSnapshot.findUnique({ where: { accountId } });
    return row === null
      ? null
      : {
          accountId: row.accountId,
          minorUnits: row.minorUnits,
          throughSequence: Number(row.throughSequence),
          computedAt: row.computedAt,
        };
  }

  async putSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    await this.prisma.ledgerBalanceSnapshot.upsert({
      where: { accountId: snapshot.accountId },
      update: {
        minorUnits: snapshot.minorUnits,
        throughSequence: BigInt(snapshot.throughSequence),
        computedAt: snapshot.computedAt,
      },
      create: {
        accountId: snapshot.accountId,
        minorUnits: snapshot.minorUnits,
        throughSequence: BigInt(snapshot.throughSequence),
        computedAt: snapshot.computedAt,
      },
    });
  }
}

function toAccount(row: {
  id: string;
  code: string;
  type: string;
  currency: string;
  partition: string;
  ownerRef: string | null;
}): Account {
  return {
    id: row.id,
    code: row.code,
    type: row.type as AccountType,
    currency: requireCurrencyCode(row.currency),
    partition: row.partition as Partition,
    ownerRef: row.ownerRef,
  };
}

function toEntry(row: {
  id: string;
  transactionId: string;
  accountId: string;
  direction: string;
  amountMinorUnits: bigint;
  currency: string;
  sequence: bigint;
  memo: string | null;
}): LedgerEntry {
  return {
    id: row.id,
    transactionId: row.transactionId,
    accountId: row.accountId,
    direction: row.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT',
    amount: toMoney(row.amountMinorUnits, row.currency),
    sequence: Number(row.sequence),
    ...(row.memo === null ? {} : { memo: row.memo }),
  };
}

function toTransaction(row: {
  id: string;
  reason: string;
  description: string;
  occurredAt: Date;
  recordedAt: Date;
  reference: string | null;
  idempotencyKey: string;
  metadata: Prisma.JsonValue;
  entries: Array<Parameters<typeof toEntry>[0]>;
}): LedgerTransaction {
  return {
    id: row.id,
    reason: row.reason as PostingReason,
    description: row.description,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    reference: row.reference,
    idempotencyKey: row.idempotencyKey,
    entries: row.entries.map(toEntry),
    metadata: (row.metadata ?? {}) as Record<string, string>,
  };
}

/**
 * Was this a unique-constraint violation on one of the named columns?
 *
 * Takes every acceptable spelling because Prisma reports the target as either
 * the database column or the model field depending on the driver and the
 * constraint — `idempotency_key` in one and `idempotencyKey` in the other. The
 * alternatives used to be an unconditional `|| t.includes('idempotencyKey')`,
 * which meant a caller asking about any other column also matched an
 * idempotency-key violation and could swallow it.
 */
function isUniqueViolation(error: unknown, ...fields: readonly string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const targets = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return targets.some((t) => fields.some((field) => t.includes(field)));
}
