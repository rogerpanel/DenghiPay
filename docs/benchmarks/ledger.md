# Ledger write benchmark

Satisfies BUILD_PLAN 1.6 — the requirement that the Postgres-versus-TigerBeetle
decision in [ADR 0003](../adr/0003-postgres-double-entry-ledger.md) rest on
measured numbers. Reproduce with:

```bash
BENCH_DATABASE_URL=postgresql://…/morapay_bench pnpm --filter @morapay/api run bench:ledger
```

## What is measured

`PrismaLedgerStore.append` — the same code path the API uses. Each iteration
opens a database transaction, inserts one `ledger_transaction` row and two
`ledger_entry` rows, and commits. The commit fires the deferred constraint
trigger that recomputes debits against credits per currency, so the trigger's
cost is inside every number below. Nothing is stubbed and nothing is batched.

## Run of 2026-08-13

| Environment                           |                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Host                                  | 4 vCPU Intel Xeon @ 2.80 GHz, 15 GB RAM — a development container, **not production hardware** |
| PostgreSQL                            | 16.13, on the same host as the client, default configuration                                   |
| Node                                  | v22.22.2                                                                                       |
| Workload                              | 2 000 transactions per concurrency level, 2 entries each                                       |
| Unbalanced transactions after the run | 0                                                                                              |

| Concurrency | Throughput (tx/s) | p50 (ms) | p95 (ms) | p99 (ms) |
| ----------- | ----------------- | -------- | -------- | -------- |
| 1           | 241.8             | 3.98     | 4.92     | 6.89     |
| 4           | 733.7             | 5.22     | 7.01     | 10.29    |
| 8           | 891.1             | 8.63     | 12.25    | 15.31    |
| 16          | **938.0**         | 16.66    | 22.51    | 26.07    |
| 32          | 919.4             | 34.24    | 41.34    | 45.19    |

Throughput plateaus at 16 concurrent writers on 4 vCPUs and does not improve at
32 — past that point latency rises roughly linearly with concurrency while
throughput does not, which is queueing, not capacity. 16 is therefore the useful
figure for this host.

## What it means for the decision

Pilot demand, from ADR 0003: about 5 000 transfers a day, four to six ledger
transactions each, so roughly 30 000 transactions a day. Spread over a working
day that is under one write per second; with a peak-hour multiple of ten, under
10 tx/s.

Measured capacity on a 4-vCPU development container is **938 tx/s** — around a
hundred times peak pilot demand, on hardware smaller than anything we would run
in production. The margin is not a close call, which is exactly the finding the
ADR needed: TigerBeetle would be solving a problem we do not have, at the cost of
a second datastore to back up, restore and explain to an auditor.

At p99, a ledger write costs 26 ms at the throughput knee. A transfer books four
to six of them across its whole lifecycle, spread over minutes, so the ledger is
nowhere near the dominant term in transfer latency — the provider call is.

## Caveats, so nobody over-reads this

- **Development-container hardware.** Real numbers will differ. BUILD_PLAN 13.4
  requires a re-run on production hardware before the go-live gate; that row does
  not exist in this table yet.
- **Client and database on one host.** No network hop. A managed database in
  another availability zone adds a round trip to every write, which will hurt the
  single-writer figure most.
- **Two entries per transaction.** Real postings carry two or three. Assume the
  three-entry case is proportionally slower on the entry insert; the transaction
  overhead and the trigger do not change.
- **An empty table.** These tables are append-only and grow forever. The insert
  path is index-append, so growth should cost little, but "should" is not
  "measured" — re-run this against a table with a year of simulated volume before
  relying on the number for capacity planning.

## History

| Date       | Host                 | Peak tx/s | Notes                        |
| ---------- | -------------------- | --------- | ---------------------------- |
| 2026-08-13 | 4 vCPU dev container | 938       | First run. Decision baseline |
| —          | Production hardware  | —         | Required by BUILD_PLAN 13.4  |
