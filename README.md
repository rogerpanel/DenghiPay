# MoraPay

Cross-border remittance platform. Russia/CIS → Nigeria & Ghana.

> **Status: pre-pilot engineering build.** No live third-party funds move.
> `LIVE_FUNDS_ENABLED` defaults to `false` and every provider integration runs
> against a simulator until partner agreements and written legal opinions are in
> place (guardrail G1). See [`CLAUDE.md`](./CLAUDE.md) for the full guardrail set.

|                     |                                                                            |
| ------------------- | -------------------------------------------------------------------------- |
| Build plan          | [`docs/BUILD_PLAN.md`](./docs/BUILD_PLAN.md)                               |
| Architecture        | [`docs/TECHNICAL_ARCHITECTURE.md`](./docs/TECHNICAL_ARCHITECTURE.md)       |
| Decisions           | [`docs/adr/`](./docs/adr/)                                                 |
| Guardrails          | [`CLAUDE.md`](./CLAUDE.md)                                                 |
| Demo script         | [`docs/DEMO.md`](./docs/DEMO.md)                                           |
| Corridors           | [`docs/CORRIDORS.md`](./docs/CORRIDORS.md)                                 |
| FX rates            | [`docs/FX_RATES.md`](./docs/FX_RATES.md)                                   |
| Open items          | [`docs/OPEN_ITEMS.md`](./docs/OPEN_ITEMS.md)                               |
| Partners            | [`docs/PARTNER_PAYCREST.md`](./docs/PARTNER_PAYCREST.md)                   |
| Integration         | [`docs/PARTNER_INTEGRATION_SPEC.md`](./docs/PARTNER_INTEGRATION_SPEC.md)   |
| Decisions in flight | [`docs/DECISION_STABLECOIN_ROUTE.md`](./docs/DECISION_STABLECOIN_ROUTE.md) |
| Feature gap         | [`docs/FEATURE_GAP_LEMFI.md`](./docs/FEATURE_GAP_LEMFI.md)                 |

## Getting started

From a clean clone to a running application. Target is under fifteen minutes;
most of it is the dependency install.

```bash
# 1. Node 22 and pnpm 10
nvm use                      # reads .nvmrc
corepack enable

# 2. Install
pnpm install

# 3. Configuration — placeholders only, nothing real
cp .env.example .env

# 4. Dependencies: PostgreSQL 16 and Redis
#    Uses Docker Compose when a daemon is available, native services otherwise.
pnpm stack:up

# 5. Schema and seed data
pnpm db:migrate
pnpm seed                    # chart of accounts, corridors, rates
pnpm demo:seed               # demo users, recipients, a sanctioned test identity

# 6. Build the shared packages, then run everything
pnpm build
pnpm dev
```

| Service     | URL                              | Notes                                     |
| ----------- | -------------------------------- | ----------------------------------------- |
| Sender PWA  | http://localhost:3000            | mobile-first, install as an app           |
| Back office | http://localhost:3001            | separate authentication, separate session |
| API         | http://localhost:4000            | REST                                      |
| API docs    | http://localhost:4000/docs       | OpenAPI, generated from the contracts     |
| Health      | http://localhost:4000/health     | liveness and dependency checks            |
| Metrics     | http://localhost:4000/metrics    | Prometheus                                |
| Mail outbox | http://localhost:3001/dev/outbox | verification links in local development   |

Demo credentials and a click-through script are in [`docs/DEMO.md`](./docs/DEMO.md).

## Repository layout

```
apps/api          NestJS API, saga workers, provider callbacks
apps/web          Next.js sender-facing PWA
apps/admin        Next.js back office — separate app, separate auth, separate deploy
packages/domain   Money, currency, FX, corridors, transfer state machine
packages/ledger   Double-entry core. No framework dependencies.
packages/contracts Shared zod schemas and OpenAPI types
packages/adapters Provider ports and simulators (pay-in RU, payout NG/GH, KYC, screening)
packages/ui       Design system and brand tokens
infra/            Compose files, nginx, deployment and operational scripts
docs/             Build plan, architecture, ADRs, compliance drafts, runbooks
```

## Commands

| Command                        | What it does                                              |
| ------------------------------ | --------------------------------------------------------- |
| `pnpm build`                   | Build every package and app, in dependency order          |
| `pnpm test`                    | Unit and integration tests                                |
| `pnpm test:cov`                | Tests with coverage floors (90% on `domain` and `ledger`) |
| `pnpm lint`                    | ESLint across the workspace                               |
| `pnpm typecheck`               | `tsc --noEmit` everywhere                                 |
| `pnpm db:migrate`              | Apply Prisma migrations                                   |
| `pnpm seed`                    | Chart of accounts, corridors, rate fixtures               |
| `pnpm demo:seed`               | Demo users and recipients for the walkthrough             |
| `pnpm openapi`                 | Regenerate `docs/api/openapi.json`                        |
| `pnpm stack:up` / `stack:down` | Local PostgreSQL, Redis, Mailhog, MinIO                   |

## Working on this codebase

Read `CLAUDE.md` first. The rules in it are not style preferences — several of
them are the difference between a licensable platform and one that is not.

The ones that catch people out:

- **Money is never a float.** `Money` holds integer minor units and cannot be
  constructed from a non-integer number. `parseFloat` is banned by lint rule.
- **An acknowledgement is not a settlement.** A provider returning "Success" to
  a submission means it received the request. Only `getStatus()` or the T+1
  statement produces a `PayoutOutcome`, and only a `PayoutOutcome` can be posted
  to the ledger. The types enforce it; do not widen them.
- **A callback never mutates financial state.** It verifies, dedups, and enqueues
  a status poll. That is the whole handler.
- **The ledger is the only writer of financial state.** A PR that changes a
  balance anywhere else gets rejected.

## Licence

Proprietary. All rights reserved. See [`LICENSE`](./LICENSE).
