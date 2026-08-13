# Open items

What stands between this codebase and a first live transfer. Kept short and
honest: each item has an owner, a date and a definition of done, or it is not on
this list.

Status as at 2026-08-13.

## Blocking — nothing moves without these

| #   | Item                                                                                                               | Type           | Owner | Why it blocks                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **A Russian licensed partner for the pay-in leg**                                                                  | Commercial     | CEO   | The Paycrest deck assigns virtual accounts, RUB collection and the RUB→stablecoin conversion to "the Russian bank partner". We are the application, not that bank. No pay-in, no product. Engineering proceeds against the simulator (BUILD_PLAN 6.1) and is not waiting. |
| B2  | **Written legal opinions** — sanctions exposure, Russian structuring under 161-FZ, Nigerian and Ghanaian licensing | Legal          | CEO   | Guardrail G1 keeps `LIVE_FUNDS_ENABLED` false until these exist. This is not an engineering gate we can choose to relax.                                                                                                                                                  |
| B3  | **A payout partner with confirmed Russia-origin acceptance**                                                       | Commercial     | CEO   | Their correspondent bank must accept Russia-origin flows, confirmed in writing by the correspondent, not assumed by the partner. This is the question most likely to end a partnership late — ask it first (TECHNICAL_ARCHITECTURE §6 question 9).                        |
| B4  | **Ghana payout rail**                                                                                              | Commercial     | CEO   | Ghana is not in Paycrest's live coverage. Fincra's EPSP or equivalent. The corridor and the simulator are built; the rail is not signed.                                                                                                                                  |
| B5  | **A compliance officer, appointed and trained**                                                                    | Organisational | CEO   | Named in the go-live gate. The compliance queue is built and has nobody to staff it.                                                                                                                                                                                      |

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

| #   | Question                                                                          | What we did in the meantime                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **How much of the FX spread do we surface?**                                      | Full decomposition: mid-market rate, our rate, margin in money and in basis points. It is one function and one screen if you want it changed. The reference model hides the margin in the rate; we think transparency is the product, but it is your call.    |
| D2  | **Do we hold sender funds at any point, or is the partner custodian throughout?** | The ledger models `USER_PAYABLE` as our liability — the conservative reading. If counsel says the partner is custodian throughout, the account tree changes, not the code. This materially changes our regulatory position and should be answered by counsel. |
| D3  | **Dual-rail routing policy** once two payout partners exist                       | Corridor, then declared priority, with health-based failover. Cost-based routing is a comparator swap.                                                                                                                                                        |
| D4  | **Launch corridor order**                                                         | RU→NG and RU→GH are built and enabled; BY→NG and BY→GH are seeded but disabled, awaiting a Belarusian pay-in partner.                                                                                                                                         |
| D5  | **Tier limits**                                                                   | Placeholders in `packages/domain/src/compliance/limits.ts`, pending the risk assessment. The compliance officer owns these numbers, not engineering.                                                                                                          |
| D6  | **Fee and margin levels**                                                         | 150,00 ₽ fixed and 150 bps on RU→NG, 175 bps on RU→GH. Configuration, not code.                                                                                                                                                                               |

## What we would need from you to go faster

1. **The domain name**, so DNS, certificates and the CAA record can be set up
   and staging can move off localhost.
2. **Hetzner account access**, or a project we can be added to.
3. **Any partner sandbox credentials** you already hold — even a read-only
   sandbox lets us replace a simulator with the real adapter.
4. **The brand assets** — a logo file, if one exists. The current mark is
   built from the brand tokens in the build plan.
5. **A decision on D1 and D2.** Both change screens; D2 changes the account
   tree.
