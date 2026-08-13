# ADR 0003 — Postgres double-entry ledger for v1, TigerBeetle deferred

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Engineering
- **Satisfies:** BUILD_PLAN 1.6 (benchmark run against the local stack; rerun on
  production hardware before the go-live gate)

## Context

BUILD_PLAN 1.6 requires a decision between a Postgres double-entry
implementation and TigerBeetle, "with benchmark numbers, not vibes".

Expected pilot volume is the binding number. The corridor is Russia/CIS →
Nigeria & Ghana, personal remittances, launching with one partner per leg. A
generous pilot estimate is 5 000 transfers per day. Each transfer books between
four and six ledger transactions across its lifecycle (pay-in, settlement out,
settlement in, FX difference, payout, and occasionally a refund), each with two
to three entries. That is roughly 30 000 transactions and 75 000 entries a day —
under one write per second averaged, with a peak-hour multiple of perhaps ten.

TigerBeetle is built for six orders of magnitude more than that.

## Decision

Ship v1 on PostgreSQL 16 with an append-only double-entry schema. Keep the
ledger core (`packages/ledger`) free of any database dependency behind the
`LedgerStore` port, so the engine choice stays reversible.

The balance invariant is enforced **in the database**, not only in application
code: a deferred constraint trigger recomputes debits and credits per currency
for each transaction at commit time and raises if they differ. Application-level
validation exists to produce a good error message, not to be the guarantee.

## Benchmark

Run with `pnpm --filter @morapay/api run bench:ledger`, which writes balanced
transactions through the same `PrismaLedgerStore` code path the API uses,
including the database balance trigger. Results are recorded in
`docs/benchmarks/ledger.md` and must be refreshed on production hardware before
the go-live gate (BUILD_PLAN 13.4).

The decision does not hinge on a close call. Peak pilot demand — roughly 30 000
ledger transactions a day, with a peak-hour multiple of ten, so under 10 tx/s —
sits orders of magnitude below what a single Postgres node sustains for
small balanced inserts. The benchmark exists to confirm that gap and to catch a
regression in the write path, not to choose between two plausible options.

## Alternatives considered

**TigerBeetle now.** Purpose-built, and its safety properties are genuinely
better than ours. It is also a second datastore to operate, back up, restore and
explain to an auditor, with a different failure model and a much smaller pool of
people who have run one. The volume does not require it.

**Event sourcing with a projection.** More moving parts for the same invariant
we already get from a constraint trigger.

**Mutable balance columns with a transaction log.** Explicitly forbidden by
guardrail G5. Listed here only to record that it was rejected on purpose.

## Consequences

- One datastore for v1. Backups, restores and DR are one procedure
  (BUILD_PLAN 12.7).
- The `LedgerStore` port must stay honest. `InMemoryLedgerStore` and the Prisma
  implementation run the same contract tests, so a third implementation —
  TigerBeetle among them — has a specification to satisfy.
- Revisit when sustained write volume exceeds roughly 500 tx/s, or when a second
  jurisdiction requires an independently operated ledger.
