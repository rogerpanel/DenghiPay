# ADR 0004 — MoraPay holds sender funds; the partner is never custodian

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** CEO (decision), Engineering (implementation)
- **Resolves:** `docs/OPEN_ITEMS.md` D2

## Context

Open item D2 asked whether we hold sender funds at any point, or whether the
partner is custodian from collection through to payout. It is not a
presentation question. Whoever holds the money owes it to the sender, appears
on the sender's claim if the other side fails, and carries the licensing
consequence of holding client funds. The account tree, the transfer state
machine and our regulatory position all follow from the answer.

The reference model in the source deck is ambiguous about it, assigning
collection and conversion to "the Russian bank partner" without saying whose
liability the money is in between.

Engineering built against the conservative reading pending the decision, so
this ADR ratifies what exists rather than describing a change.

## Decision

**We hold the funds. The partner is not custodian at any point.**

Concretely, and in the order it happens:

1. The sender pays in. The money lands in our float and we book a liability to
   the sender for the send amount — `DR FLOAT_RUB / CR USER_PAYABLE`, with the
   fee recognised as revenue on receipt. From this moment the sender's claim is
   against us.
2. The sender's conditions must be satisfied before anything moves toward the
   recipient: KYC tier, sending limits, and a passing sanctions screen for both
   the sender and the recipient. `TransferSaga.settle` calls
   `screening.assertClear` before the first settlement posting, and that call
   reads persisted screening records rather than trusting an in-memory flag.
3. The partner's conditions must also be satisfied: the destination is
   confirmed to exist and to be reachable by the partner's own name enquiry,
   and the sender confirms the resolved name — not the name they typed — before
   the transfer is created.
4. Only then do we release: settlement moves value out of our float, discharges
   the sender liability, and the payout instruction is submitted.

Money is never released on an acknowledgement. Only `getStatus()` or statement
reconciliation may post a payout result to the ledger, and the types enforce it
— `postPayoutResult` accepts a `PayoutOutcome` and nothing else, so an
acknowledgement cannot be passed where a settlement is expected.

The receiving direction follows the same rule in mirror. We do not treat a
recipient as paid because a provider said it accepted the instruction; the
transfer reaches `COMPLETED` on a confirmed outcome, and a provider that goes
quiet is resolved by the poll schedule or by the T+1 statement, never by
assumption.

## Alternatives considered

**Partner as custodian throughout.** Fewer licensing questions for us, and no
client-money holding to account for. Rejected because it makes the sender's
claim run against an entity they never contracted with, leaves us unable to
refund from our own position when a payout fails, and — decisively — it is not
what we intend commercially: we want the release decision, and the release
decision belongs to whoever holds the money.

**Custody switching mid-flight** — ours at collection, theirs after settlement
out. This is arguably the most accurate description of the mechanics, since
`PARTNER_RECEIVABLE` really is a claim on them. Rejected as a _framing_, not as
mechanics: the ledger already models that receivable honestly. What we reject
is treating the switch as discharging our obligation to the sender. We owe the
sender until the recipient is paid or the sender is refunded, whichever comes
first, and the state machine has no path that ends otherwise.

## Consequences

- **The account tree stands as built.** `USER_PAYABLE` is our liability and is
  discharged only by settlement or refund. No migration follows from this ADR.
- **Client-money handling is in scope for counsel.** Holding sender funds is
  the licensing question, and it is now definitively ours to answer rather than
  the partner's. This belongs in the legal opinions tracked as `OPEN_ITEMS.md`
  B2 and must be raised explicitly rather than inferred from this document.
- **Refunds are always possible from our own position.** Because the money is
  ours to move, a failed payout refunds the sender without waiting for the
  partner to return anything. That is why every failure scenario in the smoke
  test reaches `REFUNDED` with the books balanced.
- **One gap to close when a real partner exists.** The partner's confirmation
  today is the name enquiry performed when the recipient is saved, not a
  pre-flight check taken at the moment of release. For a recipient saved weeks
  earlier this is a stale confirmation. Real partners differ in whether they
  offer a re-validation call and what it costs, so the re-check belongs in the
  first real payout adapter (`OPEN_ITEMS.md` B3/B4) rather than being invented
  against a simulator now. Until then the window is bounded by the fact that
  settlement and payout submission happen within one saga run.
