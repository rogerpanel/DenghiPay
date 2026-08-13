# Risk assessment — working draft

> **Status: draft (BUILD_PLAN 13.2).** Not reviewed by counsel or an appointed
> compliance officer. Not legal advice. Scores are a starting point for that
> review, not a conclusion.

Inherent risk, then the control, then what is left. A control that is planned
rather than built is marked as such, because a risk assessment that credits
intentions is worthless.

## 1. Corridor and geography

| Risk                                                               | Inherent | Control                                                                                                        | Status                                     | Residual               |
| ------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------- |
| Russia-origin funds face sanctions exposure at correspondent banks | **High** | Personal remittances only; every party screened; written legal opinions required before any live movement (G1) | Screening built; opinions **outstanding**  | High until B2 closes   |
| Nigeria: high-risk jurisdiction for fraud typologies               | Medium   | Name enquiry before commitment; velocity rules; per-transfer screening                                         | Built                                      | Low-medium             |
| Ghana: mobile-money misdirection                                   | Medium   | MSISDN and network validation; name enquiry against the wallet                                                 | Built                                      | Low                    |
| Corridor closure by a partner's correspondent bank at short notice | **High** | Dual-sourcing designed in; provider registry supports failover                                                 | Registry built; second rail **not signed** | High until B3/B4 close |

## 2. Customer

| Risk                                              | Inherent    | Control                                                                                   | Status                                                          | Residual   |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| Sanctioned or designated person opens an account  | **High**    | Screening at onboarding, before a tier is granted, and per transfer; hits block and queue | Built, non-bypassable                                           | Low        |
| Identity fraud using another person's documents   | Medium-high | Tiered KYC with liveness at tier 2; provider-agnostic port                                | Built against a mock; **real vendor outstanding**               | Medium     |
| Structuring below reporting thresholds            | Medium      | Band detection across a sender's recent transfers; opens a case                           | Built                                                           | Low-medium |
| Money mule networks — many senders, one recipient | Medium      | Recipient fan-out signal                                                                  | Built (per sender). **Cross-sender fan-in is not yet detected** | Medium     |
| PEP exposure                                      | Medium      | PEP list included in screening; hits queue for review                                     | Built                                                           | Low        |

Cross-sender fan-in is the honest gap in this table: we detect one sender
reaching many recipients, not many senders converging on one recipient. It is
tracked and needs a data model that spans senders.

## 3. Product

| Risk                                            | Inherent | Control                                                                               | Status | Residual |
| ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | ------ | -------- |
| Commercial use disguised as personal remittance | Medium   | No business entity in the domain; closed purpose enumeration; per-sender limits       | Built  | Low      |
| Misdirected funds, unrecoverable once settled   | **High** | Name enquiry before the sender commits, with the resolved name shown for confirmation | Built  | Low      |
| Sender misled about cost                        | Medium   | Full decomposition of fee and FX margin, before and at confirmation                   | Built  | Low      |

## 4. Operational and technical

| Risk                                   | Inherent    | Control                                                                                                                           | Status                                     | Residual   |
| -------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| Double payout on retry                 | **High**    | Deterministic idempotency keys end to end; provider-level idempotency; acknowledgement and outcome are distinct types             | Built and tested                           | Low        |
| Money created or destroyed by a defect | **High**    | Double-entry with a database constraint trigger; append-only; balances derived; drift detector; alert on imbalance                | Built and tested                           | Low        |
| Callback forgery or replay             | Medium-high | HMAC-SHA256 over raw bytes, constant-time, ±300s freshness, event-id dedup; callbacks never write financial state                 | Built, conformance suite                   | Low        |
| Provider drops a webhook               | Medium      | Poll schedule is primary; a transfer reaches a terminal state without ever receiving a callback                                   | Built and tested                           | Low        |
| Internal fraud on float                | **High**    | Four-eyes enforced in the service, the posting builder and a database constraint; every action audit-logged with actor and reason | Built                                      | Low        |
| Reconciliation break hides a loss      | Medium      | Daily T+1 reconciliation; the statement is authoritative; unmatched items age visibly                                             | Built                                      | Low-medium |
| Personal data exposure                 | **High**    | Residency partitioning; tokenised cross-boundary references; log scrubber; field encryption; TLS 1.2+                             | Built; **penetration test outstanding**    | Medium     |
| Key compromise                         | High        | Separate keys per purpose and per application; rotation procedure in the incident runbook                                         | Rotation documented; **vault outstanding** | Medium     |

## 5. Concentration

Single points of failure today, all commercial rather than technical:

- one pay-in partner (none signed — B1);
- one payout partner per corridor;
- one settlement rail.

The provider registry, the port abstraction and the contract tests exist
specifically so that adding a second of each is an adapter, not a rebuild. The
risk is that it has not been done yet, not that it would be hard.

## 6. Overall

**Inherent risk: high.** Cross-border remittance from a sanctions-exposed
origin is a high-risk activity, and no amount of engineering changes that.

**Residual risk after the controls that are built: medium**, dominated by three
items that are not engineering problems: the licensed pay-in partner, the legal
opinions, and the appointment of a compliance officer.

Reviewed annually, on any material corridor or partner change, and after any
incident.
