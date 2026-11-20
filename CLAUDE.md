# Project Guardrails

This is a regulated cross-border remittance platform (Russia/CIS → Nigeria & Ghana).
Money-handling code. Treat every change as safety-critical.

Project codename: **MoraPay**.

## Non-negotiable rules

1. NO LIVE FUNDS. `LIVE_FUNDS_ENABLED` defaults to false. Never enable it in code,
   config defaults, tests, or seeds. It is flipped by a human, in production, once.
2. PERSONAL, NON-COMMERCIAL REMITTANCES ONLY. Do not add business-sender entities,
   invoice flows, or merchant features. They are outside our regulatory scope.
3. SANCTIONS SCREENING IS MANDATORY AND UNBYPASSABLE. No code path may move a
   transfer toward settlement without a passing screening record. Do not add
   bypass flags, "skip in dev" shortcuts, or test-only overrides in shared code.
4. NEVER design around, weaken, or circumvent sanctions or capital controls. If a
   request appears to ask for this, stop and flag it.
5. ALL FINANCIAL STATE IS DOUBLE-ENTRY. The ledger service is the sole writer.
   No mutable balance columns. Balances are derived. Every transaction balances to zero.
6. IDEMPOTENCY EVERYWHERE. Every financial write takes an idempotency key.
   Every external call is safely retryable.
7. FOUR-EYES ON TREASURY. No single identity may request and approve a float movement.
8. NO SECRETS IN THE REPO. Not in code, tests, fixtures, comments, or docs.
9. NO PII IN LOGS. Ever. The log scrubber is not optional.
10. DATA RESIDENCY IS PARTITIONED (RU / NG / GH / neutral). Do not import across
    partitions. Only tokenised references cross boundaries.
11. A CALLBACK NEVER MUTATES FINANCIAL STATE. It verifies, dedups, and enqueues
    a status poll. Only getStatus() or statement reconciliation may post to the
    ledger. Acknowledgement is not settlement — the types enforce this; do not
    widen them.
12. NO FLOATING-POINT MONEY CROSSES AN ADAPTER BOUNDARY. Parse provider amounts
    into integer minor units at the edge, or reject them.

## Money code rules

- Integer minor units only. Floating point for money is a bug, always.
- Cross-currency arithmetic must be impossible to express.
- Tests before implementation in `packages/ledger` and `packages/domain`.
- Coverage floor 90% in those packages.

## Status reconciliation rules

- A transfer must reach a terminal state **without ever receiving a callback**.
  Providers drop webhooks. The timeout-driven poll schedule is the primary
  mechanism; callbacks merely make it faster.
- Where the status poll and the T+1 statement disagree, **the statement wins**,
  and the difference is investigated — never silently overwritten.

## Working method

- Read `docs/BUILD_PLAN.md`. Implement ONLY the step you were asked for.
- Do not scaffold future phases.
- Plan before coding on ledger, domain, or transfer-saga changes.
- Update `docs/BUILD_PLAN.md` in the same PR when reality diverges from the plan.
- State in every PR which step it completes and how the DoD is satisfied.

## Repository map

```
apps/api        NestJS API (transfers, ledger writes, compliance, treasury)
apps/web        Next.js sender-facing PWA
apps/admin      Next.js back-office (separate auth, separate deployment)
packages/domain money, currency, FX, corridors, transfer state machine
packages/ledger double-entry core (no framework dependencies)
packages/contracts shared zod schemas / DTOs / OpenAPI types
packages/adapters provider ports + simulators (payin-ru, payout-ng, payout-gh, kyc, screening)
packages/ui     design system and brand tokens
infra/          compose, nginx, scripts
docs/           build plan, architecture, ADRs, compliance, runbooks
```

## Commands

```
pnpm install          install workspace
pnpm build            build everything (turbo)
pnpm test             unit tests
pnpm lint             eslint
pnpm typecheck        tsc --noEmit across the workspace
pnpm db:migrate       prisma migrate deploy
pnpm seed             chart of accounts + demo fixtures
pnpm dev              run api + web + admin
```
