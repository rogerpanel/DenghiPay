# Engineering rules for external contractors

The rules any engineer outside the core team agrees to before touching this
repository. They are the contractual Annex 3 of every integration engagement,
kept here so the text is one thing rather than a copy per contract, and so a
future engineer can read what they are signing up to before anyone drafts a
contract.

Every rule below is enforced somewhere mechanical — in CI, in `CODEOWNERS`, or
in the shape of the provider ports. A rule enforced mechanically is still a rule.
The point of writing them down is that a contractor signs them, so a breach is a
breach of contract and not a code-review comment.

---

## A. Status

This platform handles money and personal data under regulation. These are
conditions of the engagement, not preferences. A breach of Section C or D is a
material breach of the engagement.

## B. What a contractor is granted

| Access                                                | Terms                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A fork of the repository, or a protected branch of it | Every change arrives as a pull request. No write access to the main branch. The contractor never merges.             |
| `packages/adapters/src/<provider>/`                   | The contractor's directory. All adapter code lives here.                                                             |
| `docs/partners/<provider>/`                           | The contractor's documentation directory.                                                                            |
| `packages/adapters/src/ports/`                        | **Read-only.** The shape of the boundary is a decision about the whole system.                                       |
| The rest of the repository                            | Read-only, for context. No changes outside the two directories above except one registration line agreed in writing. |
| A sandbox deployment                                  | Non-production, its own database, synthetic demo data, `LIVE_FUNDS_ENABLED=false`, no real people.                   |
| Provider test-environment credentials                 | The contractor's own. Never ours, never production, never in the repository or any shared document.                  |

## C. What a contractor is never granted — the protected paths

- `packages/ledger/`, `packages/domain/` — money primitives and the ledger
- `apps/api/src/transfers/` — the transfer lifecycle
- `apps/api/src/ledger/`, `apps/api/src/treasury/` — ledger persistence, treasury
- `apps/api/src/compliance/` — screening, limits, exchange control
- `apps/api/src/partitions/` — personal-data partitions
- `infra/`, `.github/`, `CLAUDE.md`, `docs/BUILD_PLAN.md` — deployment and the guardrails themselves
- The production environment and the demonstration server, at any level
- Any environment, database, export or file containing customer data. There is none in the sandbox and there must never be.

An attempt to reach any of these, by any means, is a material breach whether or
not it succeeds.

## D. Money-safety rules

Each is drawn from `CLAUDE.md`. They apply in every deliverable and every
environment.

- **D1 · No live funds.** Enabled once, by a human, in production. No deliverable sets, defaults or documents `LIVE_FUNDS_ENABLED` as true — in code, configuration, tests, seeds or examples.
- **D2 · Screening is unbypassable.** No code path moves a transfer toward settlement without a passing screening record. No bypass flag, "skip in dev" shortcut, or test-only override in shared code.
- **D3 · Never around sanctions or capital controls.** Nothing is designed to weaken or circumvent screening, exchange control, limits or reporting. A request to do so is refused and reported.
- **D4 · Personal remittances only.** No business-sender, invoice, merchant or bill-payment feature. They are outside our regulatory scope.
- **D5 · The ledger is the sole writer of financial state.** An adapter never posts to the ledger, never holds a balance, never computes one.
- **D6 · Idempotency everywhere.** Every financial submission carries our idempotency key; every external call is safely retryable.
- **D7 · A callback never mutates financial state.** `parseCallback` verifies, deduplicates and returns a trigger to poll. Only `getStatus` and `fetchStatement` produce outcomes. The types enforce this and are not widened.
- **D8 · Acknowledgement is not settlement.** A 200 from a provider means the instruction was received. Nothing is settled until `getStatus` or the statement says so.
- **D9 · The statement wins.** Where a poll and the T+1 statement disagree, the statement is the truth and the difference is surfaced, never overwritten.
- **D10 · No floating-point money.** Integer minor units. Provider amounts are parsed to integers at the edge or rejected. Cross-currency arithmetic is not expressible.
- **D11 · Decimals per currency are asserted, not assumed.** XAF, XOF and UGX have no minor unit; USDT has six. The adapter asserts what the provider confirmed in writing.
- **D12 · No personal data in logs.** No name, account, wallet, address, email or document number in any log, error, fixture, commit message or issue.
- **D13 · Data residency is partitioned.** Only tokenised references cross a partition boundary. An adapter never reads a partition.
- **D14 · No secrets in the repository.** Not in code, tests, fixtures, comments, docs or history. A committed secret is an incident and is rotated immediately.
- **D15 · A transfer must reach a terminal state without any callback.** The poll schedule is primary. An adapter that only works when webhooks arrive is defective.
- **D16 · Tests before merge; coverage holds.** Every PR passes the full suite, lint, type-check and both CI guardrail checks. Coverage floors in `ledger` and `domain` are not the contractor's to change.

## E. Working method

- All work on the contractor's fork or branch, submitted as pull requests that say what changed and why. No force-pushes to shared branches.
- Every PR reviewed by a code owner before merge. The contractor does not merge.
- CI green: build, tests, lint, type-check, guardrail checks.
- No change to the ports, any protected path, or any dependency version outside the contractor's directories without a written change request.
- Commits carry no AI-model identifiers, no personal data, no credentials.

## F. Incidents

Notify immediately and within 24 hours; written report within 48 hours.
"Incident" includes a suspected compromise of any credential or device;
discovering customer data anywhere; a secret committed to the repository; any
request from any person to weaken a control; and any provider behaviour that
could cause the platform to record a settlement that has not occurred.

## G. Credentials and offboarding

- Own test credentials only, stored outside the repository, never shared.
- On departure: all access revoked; local copies of the repository, sandbox data and all our information deleted within 10 days and confirmed in writing.
- Any credential the contractor has ever seen is treated as compromised on departure and rotated.

---

## What makes this real

`CODEOWNERS` already carves out the protected paths and the port directory.
The two CI checks (`check-live-funds-default.sh`,
`check-partition-boundaries.sh`) run on every pull request. None of it takes
effect until **branch protection is enabled** on the working branch with
"require review from Code Owners" — see `DECISION_STABLECOIN_ROUTE.md` §4.
Enable that before granting anyone access, and add the contractor's handle to
their adapter directory in `CODEOWNERS` when the engagement starts.
