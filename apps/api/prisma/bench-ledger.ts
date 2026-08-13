/**
 * Ledger write benchmark (BUILD_PLAN 1.6, ADR 0003).
 *
 * Measures the real write path — `PrismaLedgerStore.append` — so the number
 * includes the things that actually cost: a database round trip, the insert of
 * a transaction and its entries, and the deferred constraint trigger that
 * recomputes debits against credits per currency at COMMIT. A benchmark that
 * bypassed the trigger would measure a system we do not run.
 *
 * ## Where it writes
 *
 * Ledger tables are append-only; the migration rejects UPDATE and DELETE. A
 * benchmark therefore cannot clean up after itself, so by default this refuses
 * to run against the database in `DATABASE_URL` and requires an explicit
 * `BENCH_DATABASE_URL` pointing at a scratch database. Set `BENCH_ALLOW_DIRTY=1`
 * to override — the postings balance, so the ledger stays valid either way, but
 * a demonstration ledger full of benchmark noise is nobody's idea of a good
 * afternoon.
 *
 *   createdb -O morapay morapay_bench
 *   psql -U morapay -d morapay_bench -f infra/scripts/init-partitions.sql
 *   DATABASE_URL=postgresql://…/morapay_bench pnpm db:migrate
 *   BENCH_DATABASE_URL=postgresql://…/morapay_bench pnpm --filter @morapay/api run bench:ledger
 */
import { PrismaClient } from '@prisma/client';
import { Money, requireCurrencyCode } from '@morapay/domain';
import { DraftTransaction, fingerprintDraft } from '@morapay/ledger';
import { PrismaLedgerStore } from '../src/ledger/prisma-ledger-store';
import type { PrismaService } from '../src/common/prisma.service';

const TOTAL = Number(process.env.BENCH_TRANSACTIONS ?? 2_000);
const CONCURRENCIES = (process.env.BENCH_CONCURRENCY ?? '1,4,8,16,32')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

interface Measurement {
  readonly concurrency: number;
  readonly transactions: number;
  readonly elapsedMs: number;
  readonly perSecond: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function main(): Promise<void> {
  const benchUrl = process.env.BENCH_DATABASE_URL;
  const allowDirty = process.env.BENCH_ALLOW_DIRTY === '1';

  if (benchUrl === undefined && !allowDirty) {
    console.error(
      [
        'Refusing to write benchmark transactions into the database in DATABASE_URL.',
        'Ledger tables are append-only, so this cannot be undone.',
        '',
        'Point BENCH_DATABASE_URL at a scratch database, or set BENCH_ALLOW_DIRTY=1',
        'if you genuinely want the noise in this one. See the header of this file.',
      ].join('\n'),
    );
    process.exitCode = 64;
    return;
  }

  const prisma =
    benchUrl === undefined
      ? new PrismaClient()
      : new PrismaClient({ datasources: { db: { url: benchUrl } } });
  const store = new PrismaLedgerStore(prisma as unknown as PrismaService);

  // Two float accounts in one currency: the smallest posting that is still a
  // real double-entry transaction, so the measurement is of the write path and
  // not of whatever business logic assembled the entries.
  const rub = requireCurrencyCode('RUB');
  const debit = await store.ensureAccount({
    type: 'FLOAT_RUB',
    currency: rub,
    partition: 'NEUTRAL',
    scope: 'BENCH_A',
  });
  const credit = await store.ensureAccount({
    type: 'FLOAT_RUB',
    currency: rub,
    partition: 'NEUTRAL',
    scope: 'BENCH_B',
  });

  const amount = Money.fromMinorUnits(100_00n, rub);
  const runStamp = `${process.pid}-${process.hrtime.bigint()}`;

  const draftFor = (n: number): DraftTransaction => ({
    reason: 'FLOAT_PREFUNDING',
    description: `benchmark ${n}`,
    occurredAt: new Date(),
    reference: null,
    entries: [
      { accountId: debit.id, direction: 'DEBIT', amount },
      { accountId: credit.id, direction: 'CREDIT', amount },
    ],
  });

  // Warm the connection pool and the query plan cache, or the first run pays
  // for both and reads as a false result.
  for (let n = 0; n < 20; n += 1) {
    const draft = draftFor(n);
    await store.append({
      draft,
      idempotencyKey: `bench:warmup:${runStamp}:${n}`,
      fingerprint: fingerprintDraft(draft),
    });
  }

  const measurements: Measurement[] = [];

  for (const concurrency of CONCURRENCIES) {
    const latencies: number[] = [];
    let issued = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const n = issued;
        issued += 1;
        if (n >= TOTAL) return;
        const draft = draftFor(n);
        const started = process.hrtime.bigint();
        await store.append({
          draft,
          idempotencyKey: `bench:${runStamp}:c${concurrency}:${n}`,
          fingerprint: fingerprintDraft(draft),
        });
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
    };

    const startedAt = process.hrtime.bigint();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    latencies.sort((a, b) => a - b);
    measurements.push({
      concurrency,
      transactions: latencies.length,
      elapsedMs: round(elapsedMs),
      perSecond: round((latencies.length / elapsedMs) * 1000),
      p50Ms: round(percentile(latencies, 0.5)),
      p95Ms: round(percentile(latencies, 0.95)),
      p99Ms: round(percentile(latencies, 0.99)),
    });

    console.log(
      `concurrency ${String(concurrency).padStart(3)} · ` +
        `${latencies.length} tx in ${round(elapsedMs)} ms · ` +
        `${round((latencies.length / elapsedMs) * 1000)} tx/s · ` +
        `p50 ${round(percentile(latencies, 0.5))} ms · ` +
        `p95 ${round(percentile(latencies, 0.95))} ms · ` +
        `p99 ${round(percentile(latencies, 0.99))} ms`,
    );
  }

  // Prove the trigger was live for the whole run: if a single transaction had
  // been unbalanced it would have raised, but state the invariant anyway so the
  // output is self-contained evidence rather than an assurance.
  const [imbalance] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM (
       SELECT transaction_id
       FROM public.ledger_entry
       GROUP BY transaction_id, currency
       HAVING sum(CASE WHEN direction = 'DEBIT' THEN amount_minor_units ELSE -amount_minor_units END) <> 0
     ) AS unbalanced`,
  );

  const version = await prisma.$queryRawUnsafe<Array<{ version: string }>>(
    'SELECT version() AS version',
  );

  console.log('');
  console.log(
    JSON.stringify(
      {
        postgres: version[0]?.version ?? 'unknown',
        node: process.version,
        transactionsPerRun: TOTAL,
        entriesPerTransaction: 2,
        unbalancedTransactions: Number(imbalance?.count ?? 0n),
        measurements,
      },
      null,
      2,
    ),
  );

  if (Number(imbalance?.count ?? 0n) !== 0) {
    console.error('Unbalanced transactions found. The benchmark result is not trustworthy.');
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
