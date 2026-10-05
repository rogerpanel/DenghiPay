# AML/CFT policy — working draft

> **Status: draft, written alongside the code rather than after it
> (BUILD_PLAN 13.2).** This is a licensing input and an engineering
> specification at the same time. It has not been reviewed by counsel or by an
> appointed compliance officer, and it is not legal advice. Where it describes
> a control as implemented, the implementation is named so a reviewer can check
> the claim.

## 1. Scope

MoraPay carries **personal, non-commercial remittances** from Russia and
Belarus to Nigeria and Ghana. Business senders, invoice settlement and merchant
flows are out of scope and are not expressible in the domain model: the
transfer purpose is a closed enumeration with no commercial member
(`packages/domain/src/transfer/transfer.ts`), and the API rejects anything
outside it.

## 2. Governance

| Role                                     | Responsibility                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Compliance officer (**to be appointed**) | Owns this policy, the tier limits, screening thresholds and every case decision |
| Treasury operator                        | Requests float movements; may never approve their own                           |
| Support                                  | Operational intervention with mandatory reason codes; no compliance authority   |
| Administrator                            | Platform administration. **Explicitly cannot decide a compliance case**         |

The last row is a deliberate control. `StaffRolesGuard` requires
`COMPLIANCE_OFFICER` for case decisions and does not accept `ADMIN`, so
segregation of duties survives someone being made an administrator.

## 3. Customer due diligence

Four tiers. Tier 0 can hold an account and move nothing — registration is not a
financial action, and separating the two keeps "verified email" and "verified
identity" from collapsing into one flag.

| Tier | Verification                            | Per transfer | Daily       | Monthly     |
| ---- | --------------------------------------- | ------------ | ----------- | ----------- |
| 0    | Email only                              | —            | —           | —           |
| 1    | Identity document                       | 15 000 ₽     | 30 000 ₽    | 100 000 ₽   |
| 2    | Document, migration status, liveness    | 100 000 ₽    | 300 000 ₽   | 1 000 000 ₽ |
| 3    | Enhanced due diligence, source of funds | 600 000 ₽    | 1 000 000 ₽ | 5 000 000 ₽ |

Limits are placeholders pending the risk assessment; they are configuration
(`packages/domain/src/compliance/limits.ts`) and the compliance officer owns
the numbers. They are enforced **server-side only** — the app may show a hint,
but the decision is made in `LimitsService`.

### Foreign-national onboarding

Our senders are predominantly African students and workers resident in Russia.
The document set reflects what they actually hold:

- national passport (never a Russian internal passport);
- migration card;
- residence registration;
- and one of: work patent, work permit, study visa, or residence permit.

`MockKycProvider.requiredDocuments` encodes this per residency and tier, and a
study visa satisfies the same requirement as a work permit.

## 4. Sanctions and PEP screening

Screened at onboarding, on profile change, and **per transfer** — sender and
recipient both. Counterparty accounts and on-chain addresses are screened
before any treasury movement.

The control is non-bypassable by construction:

- there is no `skip`, `force` or environment-conditional path in
  `ScreeningService`;
- `assertClear()` reads the **persisted** screening records and throws unless
  both sender and recipient hold a `CLEAR` result;
- the transfer saga calls it immediately before the first movement toward the
  recipient;
- a CI check fails any build introducing a bypass flag.

A provider outage does not mean "clear". It is recorded as `ERROR` and blocks
the transfer, because an unavailable screening provider is an unscreened
transfer.

**Positive hits** route to the compliance queue and block. A case is decided by
a named officer with a written reason; clearing a case re-screens rather than
assuming. Nothing times out into a clear.

## 5. Transaction monitoring

Implemented in `LimitsService.velocitySignals`:

| Signal            | Threshold                                                      |
| ----------------- | -------------------------------------------------------------- |
| Transfer count    | 10 or more in 24 hours                                         |
| Recipient fan-out | 8 or more distinct recipients in 7 days                        |
| Structuring       | 3 or more transfers in a band just below a reporting threshold |
| Sudden escalation | more than 10× the sender's recent average                      |

Each opens a compliance case. Thresholds are configuration and the compliance
officer owns them.

## 6. Record keeping

- **Ledger**: append-only, double-entry. `UPDATE` and `DELETE` are rejected by
  the database. Balances are derived, never stored as an editable field.
- **Audit log**: append-only and hash-chained. Each row carries the hash of the
  row before it, so altering history breaks every subsequent hash;
  `GET /admin/audit/verify` recomputes the chain from genesis.
- **Transfer events**: every state change has exactly one row, with the actor.
- **Retention**: five years from the end of the relationship, per the stricter
  of the applicable regimes, subject to counsel.

## 7. Data protection and residency

Personal data lives in the jurisdiction that requires it: Russian sender data
under 152-FZ, Nigerian payment data under the CBN localisation requirement
effective 1 January 2027, Ghanaian recipient data in Ghana or a compliant
regional host. The neutral tier holds tokenised references only, and a CI check
fails any build that imports across a partition boundary.

Personal data never reaches logs. A recursive scrubber redacts by key name and
by value shape on every log call, with a test that asserts a worst-case payload
reaches stdout with nothing identifying in it.

## 8. Reporting

Suspicious activity reporting follows the requirements of each jurisdiction and
is the compliance officer's decision, not an automated one. The platform
provides volume-by-corridor reporting with CSV export and the full audit trail
behind any case.

## 9. Training and review

Annual training for everyone with a back-office role, and on appointment. This
policy is reviewed annually, on any material change to a corridor or partner,
and after any incident that touches it.

---

**Open dependencies:** appointment of the compliance officer; counsel's
opinions on sanctions exposure and on custody (see `docs/OPEN_ITEMS.md` D2);
selection of a screening vendor to replace the mock.
