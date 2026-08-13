# Open items

What stands between this codebase and a first live transfer. Kept short and
honest: each item has an owner, a date and a definition of done, or it is not on
this list.

Status as at 2026-08-13.

## Blocking — nothing moves without these

| #   | Item                                                                                                                                              | Type           | Owner | Why it blocks                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | **A Russian licensed partner for the pay-in leg**                                                                                                 | Commercial     | CEO   | The Paycrest deck assigns virtual accounts, RUB collection and the RUB→stablecoin conversion to "the Russian bank partner". We are the application, not that bank. No pay-in, no product. Engineering proceeds against the simulator (BUILD_PLAN 6.1) and is not waiting.            |
| B2  | **Written legal opinions** — sanctions exposure, Russian structuring under 161-FZ, Nigerian and Ghanaian licensing, **and client-money handling** | Legal          | CEO   | Guardrail G1 keeps `LIVE_FUNDS_ENABLED` false until these exist. This is not an engineering gate we can choose to relax. Client-money handling was added on 2026-08-13: ADR 0004 settled that we hold sender funds, which makes it our licensing question rather than the partner's. |
| B3  | **A payout partner with confirmed Russia-origin acceptance**                                                                                      | Commercial     | CEO   | Their correspondent bank must accept Russia-origin flows, confirmed in writing by the correspondent, not assumed by the partner. This is the question most likely to end a partnership late — ask it first (TECHNICAL_ARCHITECTURE §6 question 9).                                   |
| B4  | **Ghana payout rail**                                                                                                                             | Commercial     | CEO   | Ghana is not in Paycrest's live coverage. Fincra's EPSP or equivalent. The corridor and the simulator are built; the rail is not signed.                                                                                                                                             |
| B5  | **A compliance officer, appointed and trained**                                                                                                   | Organisational | CEO   | Named in the go-live gate. The compliance queue is built and has nobody to staff it.                                                                                                                                                                                                 |

## Needed before a pilot, not before a demo

| #   | Item                                                    | Type           | Note                                                                                                                             |
| --- | ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P1  | External penetration test                               | Security       | Book it now; remediation time is the unknown, not the test                                                                       |
| P2  | Timed restore drill                                     | Operations     | `infra/scripts/restore.sh` prints the number; it goes in `docs/DISASTER_RECOVERY.md`                                             |
| P3  | Production secrets in a vault                           | Security       | The application already refuses to boot without them; today they come from a file                                                |
| P4  | Real KYC provider (Smile ID / Sumsub)                   | Integration    | An adapter behind an existing port. The mock and the real provider satisfy the same interface                                    |
| P5  | Real screening provider (ComplyAdvantage / World-Check) | Integration    | Same shape. The mock list is fictional and says so                                                                               |
| P6  | A real FX rate feed                                     | Integration    | The simulated feed is anchored to the reference deck's numbers                                                                   |
| P7  | Load test at 10× expected pilot volume                  | Engineering    | BUILD_PLAN 13.4                                                                                                                  |
| P8  | Residency partitions in their own jurisdictions         | Infrastructure | Today they are separate schemas; the application already addresses them separately, so this is a connection string per partition |

## Decisions we would like from the CEO

| #   | Question                                                                                                        | What we did in the meantime                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | ~~**How much of the FX spread do we surface?**~~ **Answered 2026-08-13: full transparency.**                    | Ships as built: mid-market rate, our rate, and the margin in both money and basis points, on the pricing screen. No change required.                                                                                                                                                                                                  |
| D2  | ~~**Do we hold sender funds, or is the partner custodian throughout?**~~ **Answered 2026-08-13: we hold them.** | Ratified in [ADR 0004](adr/0004-morapay-holds-sender-funds.md). The partner is never custodian; funds are released only once the sender's conditions and the partner's confirmation are both satisfied. No migration follows — this is what was built. **Client-money handling must now be raised explicitly with counsel under B2.** |
| D3  | **Dual-rail routing policy** once two payout partners exist                                                     | Corridor, then declared priority, with health-based failover. Cost-based routing is a comparator swap.                                                                                                                                                                                                                                |
| D4  | **Launch corridor order**                                                                                       | RU→NG and RU→GH are built and enabled; BY→NG and BY→GH are seeded but disabled, awaiting a Belarusian pay-in partner.                                                                                                                                                                                                                 |
| D5  | **Tier limits**                                                                                                 | Placeholders in `packages/domain/src/compliance/limits.ts`, pending the risk assessment. The compliance officer owns these numbers, not engineering.                                                                                                                                                                                  |
| D6  | **Fee and margin levels**                                                                                       | 150,00 ₽ fixed and 150 bps on RU→NG, 175 bps on RU→GH. Configuration, not code.                                                                                                                                                                                                                                                       |

## What we would need from you to go faster

Status as at 2026-08-13: the CEO has confirmed that the domain, the Hetzner
server, partner sandbox credentials and brand assets **do not exist yet** and
will be procured once the project is approved. Nothing below blocks the
demonstration — it runs entirely on localhost against simulators — and none of
it blocks engineering, which continues against the simulator per BUILD_PLAN
6.1. They block only the move off localhost.

| #   | Item                                                        | Status                     | What it unblocks                                                                      |
| --- | ----------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **The domain name**                                         | Awaiting approval          | DNS, TLS certificates, the CAA record, and a staging URL that is not `localhost`      |
| 2   | **Hetzner account access**, or a project we can be added to | Awaiting approval          | Anyone being able to open the application from their own browser, on their own device |
| 3   | **Partner sandbox credentials** — even read-only            | Awaiting partner selection | Replacing a simulator with a real adapter behind the same port                        |
| 4   | **Brand assets** — a logo file, if one exists               | Awaiting approval          | Nothing technical. The current mark is built from the brand tokens in the build plan  |
| 5   | ~~Decisions on D1 and D2~~                                  | **Answered 2026-08-13**    | Both settled; see the decisions table above and ADR 0004                              |

Items 1 and 2 are the only reason the demonstration is a localhost URL rather
than a link. Everything needed to deploy is already written and committed:
`infra/compose/production.yml`, the nginx configuration, `harden-host.sh`, the
backup and restore scripts, and the deployment runbook. Provisioning is
roughly an afternoon once there is a server and a name to point at it.
