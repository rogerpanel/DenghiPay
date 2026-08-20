# Build Plan

**Cross-border remittance platform · Russia/CIS → Nigeria & Ghana**

|               |                                 |
| ------------- | ------------------------------- |
| Document type | Living engineering build plan   |
| Audience      | Claude Code and human engineers |
| Status        | v0.1 — evolves every phase      |
| Working name  | **MoraPay**                     |

> CONFIDENTIAL WORKING DOCUMENT · LIVING DRAFT · NOT LEGAL ADVICE

---

## Part 0 — How to use this document

1. Create the GitHub repository (private).
2. Commit this file to `docs/BUILD_PLAN.md`.
3. Commit the guardrails block from Part 7 to `CLAUDE.md` at the repository root. Claude Code reads this automatically on every session — it is how the compliance rules survive context loss.
4. Work **one step at a time**. Each numbered step below = one branch = one pull request.
5. A step is not complete until its **Definition of Done (DoD)** passes in CI.
6. When reality diverges from this plan (it will), update this file in the same PR that causes the divergence. The plan is version-controlled for exactly that reason.

**Instruction to Claude Code:** Do not skip ahead. Do not scaffold future phases "while you're in there." Complete the current step, open the PR, stop.

---

## Part 1 — Hard guardrails (non-negotiable)

These are architectural constraints, not preferences. They are encoded in `CLAUDE.md` and enforced in code and CI.

| #   | Guardrail                                                                                                                                                                                            | Enforcement                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **No live third-party funds** move until a licensed partner agreement and written sanctions/licensing legal opinions are in place. Until then the system runs against sandboxes and simulators only. | Environment gate: `LIVE_FUNDS_ENABLED` defaults `false`; production deploy blocked by a manual approval gate.                            |
| G2  | **Personal, non-commercial remittances only** at launch. Business flows are out of scope of the OFAC carve-out and the IMTO permissible set.                                                         | Domain model has no business-sender entity in v1; API rejects flagged commercial-purpose transfers.                                      |
| G3  | **Sanctions screening is non-bypassable.** Every sender, recipient and counterparty is screened at onboarding and per transaction.                                                                   | Screening is a required step in the transfer saga; no code path may transition a transfer to `SETTLING` without a passing screen record. |
| G4  | **No designated (SDN) counterparties, banks or wallet addresses**, ever.                                                                                                                             | Blocklist enforced at the adapter layer; on-chain address screening before any treasury movement.                                        |
| G5  | **Every money movement is double-entry, idempotent and auditable.** No mutable balance columns.                                                                                                      | Ledger service is the only writer of financial state; balances are derived, never stored as an editable field.                           |
| G6  | **Four-eyes on treasury.** No single human or service account can move float.                                                                                                                        | Approval workflow with distinct approver identity; enforced server-side.                                                                 |
| G7  | **No secrets in the repository.** Ever.                                                                                                                                                              | `gitleaks` in pre-commit and CI; CI fails the build on any hit.                                                                          |
| G8  | **Data residency partitioned from day one** (Russia / Nigeria / Ghana / neutral).                                                                                                                    | Repository-level separation of PII stores; CI check forbids cross-partition imports.                                                     |

---

## Part 2 — Repository, tooling and conventions

### 2.1 Stack

| Layer         | Choice                                             | Note                                        |
| ------------- | -------------------------------------------------- | ------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                        | Matches existing team convention            |
| Frontend      | Next.js (App Router), TypeScript, PWA              | Mobile-first, low-bandwidth first           |
| Backend       | NestJS, TypeScript, REST                           | Modular, guard-based RBAC                   |
| ORM           | Prisma                                             | Migrations under version control            |
| Primary DB    | PostgreSQL 16                                      | Per-jurisdiction instances                  |
| Ledger        | TigerBeetle (evaluate) or Postgres double-entry v1 | See Phase 1                                 |
| Cache/queue   | Redis + BullMQ                                     | Saga orchestration, rate limits             |
| Container     | Docker + Docker Compose                            | Compose → k8s only when scale demands       |
| CI/CD         | GitHub Actions → GHCR                              | Image registry is GitHub Container Registry |
| Observability | Prometheus, Grafana, Sentry, structured JSON logs  | Audit log is separate and append-only       |

### 2.2 Repository layout

```
/
├── CLAUDE.md                   ← guardrails (Part 7)
├── README.md
├── docs/
│   ├── BUILD_PLAN.md           ← this file
│   ├── adr/                    ← architecture decision records
│   ├── compliance/             ← AML policy, risk assessment, BCP drafts
│   └── api/                    ← OpenAPI specs
├── apps/
│   ├── web/                    ← Next.js sender-facing PWA
│   ├── admin/                  ← back-office (separate app, separate auth)
│   └── api/                    ← NestJS
├── packages/
│   ├── ledger/                 ← double-entry core, no framework deps
│   ├── domain/                 ← money, currency, FX, transfer state machine
│   ├── contracts/              ← shared DTOs, zod schemas, OpenAPI types
│   ├── ui/                     ← design system, brand tokens
│   ├── config/                 ← eslint, tsconfig, tailwind presets
│   └── adapters/
│       ├── payin-ru/           ← Russian partner-bank / SBP adapters
│       ├── payout-ng/          ← Nigeria payout partner adapters
│       ├── payout-gh/          ← Ghana payout partner adapters
│       ├── kyc/                ← Smile ID, Sumsub
│       └── screening/          ← sanctions/PEP, on-chain
├── infra/
│   ├── compose/                ← local, staging, prod compose files
│   ├── nginx/
│   └── scripts/                ← backup, restore, migrate, seed
└── .github/
    ├── workflows/
    └── CODEOWNERS
```

### 2.3 Git strategy

- `main` — protected, always deployable, tagged releases only.
- `develop` — integration branch.
- `feat/<scope>-<short-desc>`, `fix/…`, `chore/…` — one step per branch.
- Conventional Commits enforced by `commitlint`.
- Branch protection on `main`: require PR, require 1 approval, require all status checks, no force push, no deletion, require linear history, require signed commits.
- Squash-merge to keep history readable.

### 2.4 Required CI checks (every PR)

`lint` · `typecheck` · `unit tests` · `integration tests (testcontainers: Postgres + Redis)` · `build` · `gitleaks` · `CodeQL` · `dependency audit` · `docker build`

Coverage floor: **90%** on `packages/ledger` and `packages/domain` (money code), 70% elsewhere.

---

## Part 3 — Phased build

Each step: branch → implement → tests → PR → merge.

### Phase 0 — Bootstrap (Steps 0.1–0.6)

**0.1 Initialise repository.** Create private repo, add `.gitignore`, `LICENSE` (proprietary), `README.md`, `CLAUDE.md`, this build plan. Configure branch protection and CODEOWNERS.
_DoD:_ Repo exists, `main` protected, `CLAUDE.md` present.

**0.2 Monorepo skeleton.** pnpm workspace + Turborepo; `apps/*` and `packages/*` with `package.json` and `tsconfig`. TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
_DoD:_ `pnpm install && pnpm build` succeeds from clean clone.

**0.3 Code quality gates.** ESLint, Prettier, commitlint, husky pre-commit (lint-staged + gitleaks), `.editorconfig`, `.nvmrc`.
_DoD:_ A commit containing a fake AWS key is rejected locally.

**0.4 CI pipeline.** GitHub Actions: the check matrix from §2.4. Cache pnpm and Turbo.
_DoD:_ All checks green on a trivial PR; a deliberately failing test blocks merge.

**0.5 Local environment.** `infra/compose/local.yml` — Postgres, Redis, Mailhog, MinIO. `.env.example` with every variable documented and no real values. `pnpm dev` boots the stack.
_DoD:_ A new engineer goes clone → running app in under 15 minutes, documented in README.

**0.6 ADR process.** `docs/adr/0001-record-architecture-decisions.md` plus a template.
_DoD:_ ADR 0001 and 0002 (monorepo choice) merged.

### Phase 1 — Money and ledger core (Steps 1.1–1.7)

This is the foundation. Get it wrong and everything above it is unsafe.

**1.1 Money primitives.** `packages/domain`: `Money` value object — integer minor units only, **never floating point**. Currency registry (RUB, NGN, GHS, USD) with correct exponents. Arithmetic that refuses cross-currency operations. Serialisation to/from string.
_DoD:_ Property-based tests prove associativity, no precision loss, and that `Money` cannot be constructed from a float.

**1.2 Ledger schema.** `packages/ledger`: accounts, entries, transactions. Append-only. Every transaction balances to zero. Account types: `USER_PAYABLE`, `FLOAT_RUB`, `FLOAT_NGN`, `FLOAT_GHS`, `TREASURY_USD`, `FEE_REVENUE`, `FX_PNL`, `PARTNER_RECEIVABLE`, `SUSPENSE`.
_DoD:_ Attempting to persist an unbalanced transaction throws; enforced at the database level with a constraint or trigger, not only in application code.

**1.3 Idempotency.** Every write accepts an idempotency key; replay returns the original result without duplicating effects. Keys stored with request fingerprint.
_DoD:_ Test fires 100 concurrent identical requests; exactly one transaction is created.

**1.4 Balance derivation.** Balances computed from entries, with a materialised snapshot for performance plus a verification job that recomputes from genesis and alerts on drift.
_DoD:_ Drift detector catches a manually corrupted snapshot.

**1.5 Chart of accounts + seed.** Seed script creating the account tree per jurisdiction.
_DoD:_ `pnpm seed` produces a balanced, reproducible ledger.

**1.6 Ledger engine ADR.** Benchmark Postgres double-entry vs TigerBeetle at realistic volume. Decide and record.
_DoD:_ ADR merged with benchmark numbers, not vibes.
_Status: done._ `docs/adr/0003-postgres-double-entry-ledger.md`, with measured results in `docs/benchmarks/ledger.md` — 938 tx/s at the throughput knee against peak pilot demand under 10 tx/s. Reproduce with `pnpm --filter @morapay/api run bench:ledger`. Must be re-run on production hardware before the go-live gate (13.4).

**1.7 Reconciliation primitives.** Interfaces for external-statement ingestion and matching; unmatched items land in `SUSPENSE` and raise an alert.
_DoD:_ Simulated partner statement with one missing and one duplicate line is correctly flagged.

### Phase 2 — Identity, auth, RBAC (Steps 2.1–2.5)

**2.1 User model and registration.** Email + strong password (Argon2id), email verification required before any financial action. User states: `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `CLOSED`.
_DoD:_ Unverified user receives 403 on every financial endpoint.

**2.2 Session and tokens.** Short-lived access JWT + rotating refresh token with reuse detection; server-side revocation.
_DoD:_ Replaying a used refresh token invalidates the whole session family.

**2.3 RBAC.** Roles: `SENDER`, `RECIPIENT`, `SUPPORT`, `COMPLIANCE_OFFICER`, `TREASURY_OPERATOR`, `ADMIN`. NestJS guards per role and per resource ownership.
_DoD:_ Authorisation test matrix — every role × every endpoint — passes with explicit expected outcomes.

**2.4 Segregation of duties.** A user holding `TREASURY_OPERATOR` cannot also approve their own treasury request; `COMPLIANCE_OFFICER` actions are logged separately.
_DoD:_ Self-approval attempt rejected server-side and audit-logged.

**2.5 Audit log.** Append-only, tamper-evident (hash chain), separate store. Covers auth events, treasury movements, compliance decisions, admin actions.
_DoD:_ Modifying a historical audit row breaks chain verification and alerts.

### Phase 3 — KYC, screening and limits (Steps 3.1–3.5)

**3.1 KYC adapter interface.** Provider-agnostic port; implementations for Smile ID (NG/GH) and Sumsub (RU/global) behind it. Mock provider for local and CI.
_DoD:_ Swapping providers requires no change outside `packages/adapters/kyc`.

**3.2 Tiered KYC.** Tier 0 (registration, no transfers) → Tier 1 (light ID, low cap) → Tier 2 (full document + liveness) → Tier 3 (enhanced due diligence, source of funds). Limits per tier, per currency, daily/monthly/rolling.
_DoD:_ Transfer exceeding tier cap is rejected with an upgrade prompt; limits enforced server-side only.

**3.3 Foreign-national onboarding (Russia).** Support the realistic document set for African students and workers: passport, migration card, registration, patent/work permit where applicable. Do not assume a Russian internal passport.
_DoD:_ Onboarding completes end-to-end with a non-Russian document set in the mock provider.

**3.4 Sanctions and PEP screening.** Screening adapter (ComplyAdvantage / World-Check shape). Screen at onboarding, on profile change, and per transfer. Positive hits route to a compliance queue and block the transfer. Guardrail G3.
_DoD:_ Seeded test identity matching a mock SDN entry cannot transact under any code path; attempt is logged.

**3.5 Velocity and fraud rules.** Rule engine: transaction count, value, recipient fan-out, device/IP anomalies, structuring detection (amounts just under thresholds).
_DoD:_ Simulated structuring pattern triggers a compliance alert.

### Phase 4 — FX and quoting (Steps 4.1–4.4)

**4.1 Rate ingestion.** Pluggable rate sources with staleness detection. If rates are stale beyond threshold, quoting halts — it does not guess.
_DoD:_ Stale feed disables quoting and raises an alert rather than serving a bad rate.

**4.2 Quote engine.** Given send amount + corridor: compute FX rate, margin, fixed fee, recipient amount. Full transparency — sender sees every component. Quotes are signed, short-lived (60–120s), single-use.
_DoD:_ Expired or reused quote is rejected; recipient amount is exactly reproducible from the quote record.

**4.3 Corridor configuration.** Corridors as data, not code: RU→NG, RU→GH (+ BY→NG, BY→GH). Per-corridor limits, fees, enabled payout methods, operating hours.
_DoD:_ Adding a corridor requires only configuration and a migration.

**4.3a Intra-African corridors (added 2026-08-16, out of plan order).** NG→GH and GH→NG, both directions, built at the CEO's direction ahead of the Part 8 deferral so the product question could be answered with a working demonstration rather than an estimate. Both complete end to end against simulators with the ledger closing to zero in NGN and GHS.

The DoD above held only partly, and the exception is the interesting part. The corridor rows really were configuration — but these corridors put a **sender** inside Nigeria and Ghana for the first time, and there were no sender stores in those partitions, no naira or cedi tier limits, no `FEE_REVENUE:GHS` account, no NGN/GHS rate pair and no domestic collection rail. Those are not corridor configuration; they are what a new _origin_ costs. The claim is now stated more precisely: adding a corridor to an existing origin is configuration; adding an origin is a phase.

These two are also a different regulatory class from everything above them — domestic collection at both ends rather than an inbound remittance — so they carry a licence gate that the enabled flag alone could not express. See `docs/CORRIDORS.md`, and OPEN_ITEMS B6.
_DoD:_ Both directions reach COMPLETED with no callback; the ledger balances in both currencies; with live funds on and the licences undeclared, neither corridor is reachable.

**4.3b Pan-African mesh (added 2026-08-17, out of plan order).** South Africa, Cameroon and Benin, taking the intra-African mesh to **sixteen corridors** across four origins and five destinations. Every one completes end to end against simulators with the ledger closing to zero in all six currencies (`infra/scripts/smoke-all-corridors.sh`).

Three things about these countries were new, and two of them changed what got built:

- **The CFA francs have no decimals.** XAF and XOF carry an exponent of zero, so `minorUnits` counts whole francs. They are also at par with each other via a shared euro peg — which is a fact about the peg, not a licence to substitute one for the other, since BEAC and BCEAO are separate central banks.
- **South Africa receives and does not send.** Outward transfers from South Africa fall under SARB exchange control, which needs balance-of-payments reporting and allowance tracking that this codebase does not model. Rather than build an origin that could not lawfully run, there is no ZA collection authorisation and no ZA sender store, and the licence gate _throws_ for a ZA-origin corridor rather than finding nothing missing. Tracked as OPEN_ITEMS B8. **Superseded by 4.3c**, which built the capability; the throw survives for a country the map has never heard of.
- **French was already there.** All three locales have shipped since the sender PWA, so the francophone markets needed translations of new strings, not a new i18n layer.

Step 4.3a claimed adding an origin is a phase while adding a corridor is configuration. Doing it three more times bore that out and cost one refactor that should have happened earlier: the ledger's float account types carried the currency in the type name (`FLOAT_RUB`, `FLOAT_NGN`, `FLOAT_GHS`) beside a currency column holding the same fact. That is now one `FLOAT` type keyed by currency, migrated in place with balances untouched, so a seventh currency costs nothing.

Two latent defects surfaced and were fixed: name enquiry chose a payout provider by fabricating an `RU-` corridor id from the recipient's country, and recipients were filed by payout **method**, which would have put a Johannesburg bank account in the Nigerian partition.
_DoD:_ All sixteen corridors reach COMPLETED; the ledger nets to zero in NGN, GHS, ZAR, XAF, XOF and RUB; a ZA-origin corridor cannot be described, let alone seeded.

**4.3c Exchange control, and South Africa as an origin (added 2026-08-20, out of plan order).** Step 4.3b left South Africa receive-only and tracked the reason as OPEN_ITEMS B8: sending out of it is not another licence but a different product, because every outward payment is reported under a balance-of-payments category and measured against the sender's annual allowance. That product is now built, and the mesh is **twenty intra-African corridors** across five origins and five destinations.

The regime is data keyed by origin country, not South-Africa-shaped code: `exchangeControlFor('ZA')` returns the authority, the reporting party, the adult age, the published category codes and the allowance ceilings, and `checkDeclaration()` decides against them as a pure function. Adding a second country with capital controls is a table entry and a set of tests, not a second implementation.

Four decisions in it are load-bearing and are argued in `docs/CORRIDORS.md`:

- **The allowance is personal and spans every provider**, so our own tally is a floor and never a ceiling. The sender declares what they used elsewhere, we count it, and the app says plainly that the remaining figure is what we can see rather than what is left. Treating our own total as authoritative would confidently permit a breach.
- **A declaration of use elsewhere is a running total, not an increment**, so usage takes the maximum of what has been declared rather than the sum — summing would punish an honest sender for declaring twice.
- **Only residents are supported.** Temporary and non-residents have different allowances; an unset status is a refusal, not a default.
- **We do not file — the Authorised Dealer does.** The extract joins a declaration to a name and an identity number in memory when it is produced, is never persisted, and is restricted to `COMPLIANCE_OFFICER`; an administrator is deliberately excluded. A declaration with no identity behind it is surfaced as a problem rather than dropped from the file.

Enforcement runs **before** a transfer row exists, so a payment that may not proceed leaves a refusal in the audit log rather than a transfer record of an attempt that was never permissible. Every refusal is audited with its reason; a missing or unknown category is a 400 and an exhausted allowance is a 403, because they are different problems.

Two money-display defects surfaced while wiring the sender's step and were fixed: the send flow parsed typed amounts at a hardcoded two decimals, which multiplied a CFA sender's transfer by a hundred, and the KYC screen formatted tier limits the same way. Both now take the precision from the server rather than assuming it.

What remains outstanding for South Africa is the licence, not the capability. `ZA_DOMESTIC_COLLECTION` — an Authorised Dealer relationship or an ADLA licence — is not held, and every number in the regime is marked in the source as a placeholder pending that Dealer's confirmation. B8 accordingly narrows from a product gap to a licence.
_DoD:_ All twenty intra-African corridors reach COMPLETED with the ledger at zero in every currency; a ZA-origin transfer with no category is refused with 400 and one that would breach the allowance with 403; the declaration reaches the back office joined to the sender's identity, and can be marked as reported.

**4.4 FX exposure tracking.** Every quote lock creates a tracked position; unhedged exposure is reported per currency in real time.
_DoD:_ Treasury dashboard shows live open exposure by currency.

### Phase 5 — Transfer lifecycle (Steps 5.1–5.5)

**5.1 State machine.** `DRAFT → QUOTED → COMPLIANCE_PENDING → AWAITING_PAYIN → PAYIN_CONFIRMED → SETTLING → PAYOUT_INITIATED → PAYOUT_CONFIRMED → COMPLETED`, with `FAILED`, `REFUNDING`, `REFUNDED`, `ON_HOLD`. Transitions explicit and total; illegal transitions throw.
_DoD:_ Exhaustive transition test; no state reachable by two different code paths without a recorded event.

**5.2 Saga orchestration.** Durable orchestration with compensating actions (BullMQ or a workflow engine). Every external call is retryable and idempotent. Partial failure never leaves money unaccounted.
_DoD:_ Chaos test — kill the worker mid-settlement — resumes correctly with no double payout and no lost funds.

**5.3 Ledger integration.** Each transition posts the correct double-entry set. Funds sit in `USER_PAYABLE` until payout confirmation.
_DoD:_ Ledger balances to zero after every simulated lifecycle including all failure paths.

**5.4 Refunds and reversals.** Explicit refund path with its own approval and ledger entries. No silent reversal.
_DoD:_ Refund produces mirrored entries and a distinct audit trail.

**5.5 Transfer API.** OpenAPI-documented endpoints: create quote, confirm transfer, get status, list transfers, cancel.
_DoD:_ Generated OpenAPI spec committed; contract tests pass against it.

### Phase 6 — Pay-in adapters, Russia (Steps 6.1–6.3)

Built against **simulators first** — no partner credentials required to make progress.

**6.1 Pay-in port + simulator.** Interface covering initiate, webhook confirmation, status query, reconcile. Simulator models SBP/QR and card behaviour including delays, failures and duplicate webhooks.
_DoD:_ Full transfer lifecycle runs locally with zero external dependencies.

**6.2 Webhook security.** Signature verification, replay protection, idempotent handling, out-of-order tolerance.
_DoD:_ Unsigned, replayed and out-of-order webhooks are all handled safely.

**6.3 Partner-bank adapter (when contracted).** Implement against the actual partner-bank/agent API. Behind a feature flag; disabled until G1 is satisfied.
_DoD:_ Sandbox transaction completes; production path remains flag-disabled.
_Status:_ **Commercial blocker.** See Technical Architecture §1.1 — this role is currently unfilled. Tracked with an owner and a date, not as a coding task.

### Phase 7 — Payout adapters, Nigeria & Ghana (Steps 7.1–7.4)

**7.1 Payout port + simulator.** Interface: name enquiry, initiate payout, status, reversal. Simulator covers NIP bank credit (NG) and mobile money (GH: MoMo, Telecel, AirtelTigo) plus realistic failure modes, including the FreshPay failure catalogue (Technical Architecture §1.2).
_DoD:_ Both corridors complete end-to-end locally.

**7.2 Recipient validation.** Nigeria: account number + bank code with name enquiry before debit. Ghana: MSISDN + network validation. Show the resolved recipient name for sender confirmation — this single feature prevents most misdirected transfers.
_DoD:_ Mismatched name enquiry blocks the transfer and prompts the sender.

**7.3 Payout partner adapter (when contracted).** Split into **7.3a Paycrest (Nigeria)** and **7.3b Fincra (Nigeria + Ghana)**. Dual-source from first live transaction. Feature-flagged per G1.
_DoD:_ Sandbox payout confirmed and reconciled.

**7.4 Payout failure handling.** Failed payouts return funds to `USER_PAYABLE` and trigger sender notification plus a support task. Never silently retried into a duplicate.
_DoD:_ Duplicate-payout test proves impossibility under retry storm.

### Phase 8 — Treasury and reconciliation (Steps 8.1–8.4)

**8.1 Float management.** Per-currency float accounts with low-balance thresholds and alerts. Prefunding requests as first-class objects.
_DoD:_ Float dropping below threshold raises an alert before payouts start failing.

**8.2 Four-eyes treasury workflow.** Request → review → approve → execute, with distinct identities at each stage (G6).
_DoD:_ Same-user request-and-approve is rejected server-side.

**8.3 Daily reconciliation job.** Automated reconciliation of internal ledger against partner statements; unmatched items to `SUSPENSE` with an ageing report.
_DoD:_ Injected discrepancy is detected within one cycle and reported.

**8.4 Settlement adapter (treasury layer).** Abstract the settlement rail behind a port so the primary rail can change without touching transfer logic. All counterparty addresses/accounts screened per G4.
_DoD:_ Rail can be swapped in configuration; screening cannot be bypassed.

### Phase 9 — Back-office / admin (Steps 9.1–9.4)

Separate application, separate authentication, separate deployment. Never share a session with the customer app.

- **9.1 Compliance console** — review queue, KYC decisions, screening hits, EDD notes, case history.
- **9.2 Operations console** — transfer search, status, manual intervention with mandatory reason codes, refund initiation.
- **9.3 Treasury console** — float positions, FX exposure, prefunding, approval queue.
- **9.4 Reporting** — regulatory report scaffolding (volumes, corridors, suspicious activity), CSV/PDF export.

_DoD (all):_ Every admin action is audit-logged with actor, reason and before/after state.

### Phase 10 — Sender-facing web app (Steps 10.1–10.7)

Mobile-first is a hard requirement, not a preference. Target a low-end Android device on a 3G connection.

- **10.1 Design system** — brand tokens (Part 4), typography scale, spacing, components. Dark mode from the start.
- **10.2 Performance budget** — enforce in CI: initial JS ≤ 150KB gzipped, LCP < 2.5s on simulated 3G/low-end mobile. Budget breach fails the build.
- **10.3 Onboarding flow** — register, verify email, tiered KYC with camera capture that degrades gracefully on poor connections.
- **10.4 Send flow** — recipient selection, amount entry with live quote, transparent fee breakdown, name-enquiry confirmation, pay-in instructions.
- **10.5 Tracking** — live transfer status with clear, non-technical states; push/email/SMS notification hooks.
- **10.6 i18n** — Russian, English, French from day one via translation tables (not hardcoded strings). Structure supports later Hausa/Yoruba/Igbo/Twi without refactor.
- **10.7 PWA + offline tolerance** — installable, service-worker caching, graceful offline messaging, resumable flows after connection loss.

_DoD:_ Full send journey completes on a throttled low-end device profile in CI (Lighthouse budget enforced).

### Phase 11 — Security and observability hardening (Steps 11.1–11.7)

- **11.1 Secrets management** — vault/KMS integration, zero secrets in env files in production.
- **11.2 Encryption** — TLS everywhere, encryption at rest, field-level encryption and tokenisation for PII.
- **11.3 Rate limiting and abuse protection** — per-IP, per-user, per-endpoint; bot protection on registration.
- **11.4 Observability** — Prometheus metrics, Grafana dashboards, Sentry, structured logs with correlation IDs. PII must never enter logs — enforced by a log scrubber with tests.
- **11.5 Alerting** — on-call alerts for stuck transfers, float thresholds, reconciliation breaks, screening backlog, error-rate spikes.
- **11.6 Security review** — dependency audit, OWASP ASVS checklist, external penetration test booked before any live funds.
- **11.7 Callback security conformance suite** — forged signature, replayed event, stale timestamp, malformed cipher, duplicate delivery, out-of-order delivery. All must fail closed. _(Added by Technical Architecture §7.)_

_DoD:_ Log-scrubbing test proves no PII field can reach stdout.

### Phase 12 — Infrastructure and deployment (Steps 12.1–12.7)

**12.1 Data-residency partition (do this before provisioning).**

| Partition | Contents                                                             | Hosting                                         |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| RU        | Russian-resident sender PII, KYC documents                           | In-country provider (152-FZ)                    |
| NG        | Nigerian payment transaction data, recipient PII                     | Nigeria-resident (CBN localisation, 1 Jan 2027) |
| GH        | Ghanaian recipient PII                                               | Ghana or compliant regional host                |
| Neutral   | Ledger references (tokenised), app servers, CI, admin, observability | Hetzner                                         |

Only tokenised, non-identifying references cross partitions.
_DoD:_ CI check fails any import that would move PII across a partition boundary.

- **12.2 Dockerisation** — multi-stage builds, non-root users, minimal base images, healthchecks, image scanning in CI.
- **12.3 Compose environments** — `local`, `staging`, `production` with Nginx reverse proxy, TLS termination, security headers.
- **12.4 Hetzner provisioning (neutral tier)** — server(s), firewall (deny by default), SSH key-only access, fail2ban, automatic security updates, private networking. Document in `infra/`.
- **12.5 Domain and TLS** — DNS, Let's Encrypt with auto-renewal, HSTS, CAA records, staging on a separate subdomain with `noindex` and basic auth.
- **12.6 CD pipeline** — merge to `main` → build image → push to GHCR → deploy to staging automatically → **manual approval gate** → production. Blue-green or rolling with health-check gating and one-command rollback.
- **12.7 Backup and DR** — automated encrypted Postgres backups (per partition), offsite copy, **monthly tested restore**, documented RPO/RTO, runbook in `docs/`.

_DoD:_ A full restore from backup into a clean environment is performed and timed, with the result recorded in `docs/`.

### Phase 13 — Pilot readiness (Steps 13.1–13.5)

- **13.1** Partner sandbox integrations live end-to-end (pay-in + payout).
- **13.2** Compliance documentation drafted in `docs/compliance/`: AML/CFT policy, risk assessment, BCP, systems architecture description. These are licensing inputs — write them alongside the code, not after.
- **13.3** Runbooks: incident response, stuck transfer, failed payout, reconciliation break, partner outage, security incident.
- **13.4** Load test at 10× expected pilot volume; verify ledger integrity under concurrency.
- **13.5** **Go-live gate** — all must be true: partner agreements signed · legal opinions received (sanctions, RU structuring, NG/GH licensing) · penetration test remediated · DR restore tested · compliance officer appointed and trained · four-eyes verified in production · `LIVE_FUNDS_ENABLED` flipped by explicit human approval only.

---

## Part 4 — Brand tokens (golden orange / white)

Bright golden orange fails contrast against white for text — it is a decorative colour only. Use the darker ramp for anything a user must read.

```css
:root {
  /* Brand ramp */
  --brand-50: #fff8ec;
  --brand-100: #ffefd1;
  --brand-300: #fbc96b;
  --brand-500: #f5a623; /* signature golden orange — fills, graphics, large shapes only (2.0:1 on white — NOT for text) */
  --brand-600: #d98a0b; /* hover / borders */
  --brand-700: #b36a00; /* large text ≥24px, UI components, icons (4.2:1 on white — AA large + AA non-text) */
  --brand-800: #a85c00; /* body text on white (4.8:1 — WCAG AA) */
  --brand-900: #6b3a00; /* headings, high emphasis */

  /* Neutrals */
  --white: #ffffff;
  --ink: #1a1a1a; /* body text (16.1:1) */
  --ink-muted: #5c5c5c;
  --border: #e6e6e6;

  /* Semantic */
  --success: #1b7f4b;
  --warning: #b36a00;
  --danger: #b3261e;
}
```

**Rules:** `--brand-500` on white only for shapes, illustrations and large decorative elements — never text, never icon-only controls. Buttons: `--brand-500` fill with `--ink` or white text (verify the specific pairing). Text links on white: `--brand-800`. Dark mode: desaturate toward `--brand-300`/`--brand-500` on dark surfaces and re-verify every pairing — do not assume the light-mode ramp inverts cleanly.

---

## Part 5 — Immediate GitHub setup checklist

- [ ] Create private repository
- [ ] Add `CLAUDE.md` (Part 7) and `docs/BUILD_PLAN.md` (this file)
- [ ] Branch protection on `main`: PR required, 1 approval, all checks, linear history, signed commits, no force push
- [ ] Enable: Dependabot alerts + security updates, secret scanning + push protection, CodeQL
- [ ] Create `develop` branch
- [ ] Add `CODEOWNERS`
- [ ] Configure GitHub Environments: `staging` (auto-deploy), `production` (required reviewers)
- [ ] Add repository secrets placeholders — never real values in code
- [ ] Enable GHCR for the repository
- [ ] Create issue labels: `phase-0` … `phase-13`, `compliance-gate`, `money-critical`
- [ ] Open milestone per phase

---

## Part 6 — Working rhythm with Claude Code

- One step per session where possible. Start with: _"Read CLAUDE.md and docs/BUILD_PLAN.md. Implement step X.Y only."_
- Require a plan before code on any step touching `packages/ledger`, `packages/domain`, or the transfer saga.
- Tests before implementation on all money-handling code.
- Every PR description must state which step it completes and how the DoD is met.
- Update `BUILD_PLAN.md` in the same PR whenever reality diverges.
- Reject any PR that touches financial state outside the ledger service.

---

## Part 7 — `CLAUDE.md` starter content

See `CLAUDE.md` at the repository root. It carries rules 1–10 from this plan plus rules 11–12 added by the Technical Architecture (callbacks never mutate financial state; no floating-point money crosses an adapter boundary).

---

## Part 8 — What this plan deliberately defers

Native mobile apps · own IMTO/PSP licence applications · ~~additional corridors~~ · business/SME senders · agent networks · cash pickup · card issuing · Kubernetes · advanced ML fraud scoring · PAPSS integration.

**Additional corridors moved out of this list on 2026-08-16.** NG→GH and GH→NG are built (step 4.3a). The deferral's reasoning still stands and is worth restating rather than deleting: building a corridor is not the same as opening one, and the intra-African pair adds _more_ regulatory surface than the ruble corridors, not less, because it makes us a domestic collector in two more countries. The licence gate in `licensing.ts` is what keeps the code ahead of the paperwork without the paperwork being skipped. The French-speaking corridors landed in 4.3b. The next candidate is a country with a materially different regime again — Kenya or Côte d'Ivoire — and is not started.

Each becomes a phase when the preceding gate is cleared. Adding any of them earlier increases regulatory surface before there is a working, reconciled corridor to protect.

---

## Change log

| Version | Date       | Change                                                                                                                                                                                                                             |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1    | —          | Initial build plan                                                                                                                                                                                                                 |
| v0.2    | 2026-08-13 | Committed to repository. Working name set to MoraPay. Step 6.3 marked as commercial blocker, 7.3 split into 7.3a/7.3b, step 11.7 added — all per Technical Architecture §7. Divergence notes recorded in `docs/DIVERGENCE_LOG.md`. |
| v0.3    | 2026-08-13 | Step 1.6 closed with a real benchmark (`docs/benchmarks/ledger.md`) rather than a reasoned estimate. Production-hardware re-run folded into the 13.4 gate.                                                                         |
