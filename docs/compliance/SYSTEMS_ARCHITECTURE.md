# Systems architecture description — working draft

> **Status: draft (BUILD_PLAN 13.2).** Written for a licensing submission,
> where the reader is a regulator rather than an engineer. The technical
> companion is `docs/TECHNICAL_ARCHITECTURE.md`.

## 1. What the system does

MoraPay accepts a personal remittance from a sender resident in Russia or
Belarus, converts it, and delivers it to a bank account in Nigeria or a
mobile-money wallet in Ghana. It does not hold customer balances, issue
accounts, or offer any service other than the transfer itself.

## 2. Components

| Component          | Responsibility                                                                                | Hosting      |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------ |
| Sender application | Onboarding, identity verification, quoting, initiating and tracking transfers                 | Neutral tier |
| API and workers    | All business logic, the compliance gate, the transfer lifecycle                               | Neutral tier |
| Ledger             | Double-entry record of every movement                                                         | Neutral tier |
| Back office        | Compliance, operations, treasury, reporting. Separate application and separate authentication | Neutral tier |
| Residency stores   | Personal data, in the jurisdiction that requires it                                           | RU / NG / GH |
| Provider adapters  | Normalised integration with pay-in and payout partners                                        | Neutral tier |

## 3. Data residency

| Partition | Contents                                                                     | Location                                        |
| --------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| RU        | Sender identity, KYC documents                                               | In-country provider (152-FZ)                    |
| NG        | Nigerian payment data, recipient identity                                    | Nigeria-resident (CBN localisation, 1 Jan 2027) |
| GH        | Ghanaian recipient identity                                                  | Ghana or a compliant regional host              |
| Neutral   | Ledger, transfer records with tokenised references, audit log, observability | Hetzner (Germany)                               |

Only tokenised, non-identifying references cross a boundary. A token is a
keyed hash: deterministic, so the neutral tier can join on it; irreversible
without the key, so the neutral tier learns nothing from it. An automated check
fails any software build that would move personal data across a boundary.

## 4. The lifecycle of a transfer

1. The sender requests a quote. The quote shows the mid-market rate, our
   margin and our fee separately, is signed, and expires within two minutes.
2. Before the sender commits, the destination institution is asked which name
   it holds for the account. The sender confirms **that** name.
3. On confirmation, sender and recipient are screened against sanctions and PEP
   lists. A hit blocks the transfer and creates a case for a compliance
   officer. There is no path past this step.
4. The sender pays. We learn that the money arrived by asking the collecting
   institution, not by being told.
5. Value is settled to the destination currency. Every movement is recorded as
   a balanced double-entry transaction.
6. The payout is submitted. The provider's acknowledgement is recorded as an
   acknowledgement; only a subsequent status enquiry, or the next day's
   statement, establishes that money reached the recipient.
7. On confirmation, our obligation is discharged. On failure, the funds return
   to the sender, including our fee.

## 5. Controls a reviewer is likely to ask about

**Can a transfer bypass sanctions screening?** No. The function that advances a
transfer toward settlement reads the stored screening records and refuses
unless both parties hold a passing result. There is no override, no
environment-conditional path, and an automated check fails any build that adds
one.

**Can money be created or destroyed by a software defect?** The database
refuses to commit any transaction whose debits and credits do not balance in
every currency, and refuses modification or deletion of any historical entry.
Balances are computed from entries; there is no stored balance to corrupt. A
scheduled job recomputes every account from the first entry and alerts on any
disagreement.

**Can one person move company funds?** No. A float movement requires a request
from one identity and an approval from a different one. This is enforced in the
application, in the accounting layer, and by a database constraint.

**Can a payment be duplicated by a retry?** No. Every financial write carries
an idempotency key derived from the transfer, so repetition returns the
original result rather than creating a second movement.

**Can a forged message from a partner move money?** No. Inbound partner
notifications are authenticated, checked for freshness and de-duplicated, and
even a valid one changes nothing: it causes us to ask the partner for status,
which we would have done anyway. Only our own enquiry, or the partner's
statement, changes financial state.

**Is there a record of who did what?** Yes. Every administrative action is
recorded with the actor, a written reason and the before and after state, in an
append-only log where each entry carries a cryptographic hash of the previous
one. Altering any historical entry invalidates every entry after it, and the
system can demonstrate this on demand.

## 6. Business continuity

Encrypted backups per partition, nightly, with an offsite copy. Restores are
rehearsed monthly into a clean environment and timed, and the rehearsal
verifies that the restored ledger still balances. Recovery objectives and the
most recent rehearsal are recorded in `docs/DISASTER_RECOVERY.md`.

## 7. Current status

The platform operates against partner **simulators**. No third-party funds
move, and the software cannot be configured to move them without an explicit
production change made by a person after the go-live conditions are satisfied:
signed partner agreements, written legal opinions on sanctions and licensing, a
remediated penetration test, a rehearsed restore, an appointed compliance
officer, and four-eyes verified in production.
