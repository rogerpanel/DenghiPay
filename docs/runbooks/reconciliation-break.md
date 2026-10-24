# Runbook — reconciliation break

**Alert:** `ReconciliationBreaks`
**Severity:** ticket (page if it involves more than one transfer, or repeats)
**Meaning:** our ledger and a partner statement disagree.

## The rule that decides everything below

**The statement wins.** Where the poll and the statement disagree, the statement
is authoritative and the difference is investigated — never silently written
over our own record. That rule is in `CLAUDE.md` because it is the one people
are tempted to break under time pressure.

## The four break types

Back office → Treasury → Reconciliation → the run with a non-zero break count.

### `MISSING_IN_LEDGER` — on their statement, not in our books

Money moved that we did not book. The serious one.

1. Find the transfer by the provider reference.
2. If a transfer exists but the posting does not, the saga failed between the
   provider call and the ledger write. Re-drive it; the idempotency key makes
   this safe.
3. If no transfer exists at all, this is a payment we did not initiate.
   Escalate immediately — either the partner has mixed up an account, or
   someone has our credentials.

### `MISSING_IN_STATEMENT` — in our books, not on their statement

Usually timing: a movement late in the window lands on the next statement.

1. Check the value date against the window boundary.
2. If it is still absent from the following statement, treat it as a failed
   movement and ask the partner to confirm in writing.

### `AMOUNT_MISMATCH`

Almost always a fee the partner deducted at source and we booked gross.

1. Confirm the fee arrangement in the partner agreement.
2. If the deduction is contractual, the adapter should be booking it — that is
   a code change, not an operational correction.
3. If it is not contractual, raise it with the partner. Do not absorb it.

### `DUPLICATE_STATEMENT_LINE`

The partner reported one movement twice. Confirm with them before doing
anything: matching it once and ignoring the second would hide a genuine
duplicate payment if that is what it turns out to be.

## Closing a break

A break becomes a suspense item with an age. Resolve it in the back office with
a written note. If a correcting entry is needed, it is a **new posting with its
own reason** — the ledger is append-only and nothing is edited.

Watch the ageing: anything past seven days shows red, and a suspense item that
survives a month is a control failure, not a backlog.
