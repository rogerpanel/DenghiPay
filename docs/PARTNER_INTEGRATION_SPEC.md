# What we need from a payment partner

Hand this to the integration engineer, not the commercial contact. It is
provider-neutral — the same list applies to Paycrest, Fincra or anyone else —
and it is written against the ports the code already has, so an adapter that
satisfies it drops in without touching transfer logic, the ledger or corridors.

The worked example throughout is **Nigeria → Cameroon**, because it is the one
that shows the shape of the problem clearly.

---

## 1 · NG→CM is three jobs, not one

This is the first thing to establish, and most conversations skip it.

| Leg                     | What it means                                             | Our port          |
| ----------------------- | --------------------------------------------------------- | ----------------- |
| **Collect in Nigeria**  | Take NGN from the sender — a ten-digit NUBAN they push to | `PayinProvider`   |
| **Convert**             | NGN → XAF, at a rate somebody has to be willing to fill   | rate feed / float |
| **Pay out in Cameroon** | Credit an MTN or Orange wallet in XAF, over GIMAC         | `PayoutProvider`  |

A partner may do one, two or all three, and the answer is usually **not all
three**. Establish which before anything else, because:

- **Collecting inside Nigeria is a separate licensed activity** from paying out
  into it. A partner whose Nigerian business is payout may have no ability to
  collect, and their CBN authorisation may not cover it.
- **Cameroon is a different regulator again.** BEAC/COBAC, not the CBN, and
  XAF wallet debits are their own permission. Ask specifically for Cameroon
  rather than accepting "we cover Central Africa".

**Ask, in these words:** _For NG→CM, which of these three do you do today, in
production, with a live customer?_ Anything answered as "we can support that"
rather than "we do that" is a roadmap item, and roadmap items should be dated.

---

## 2 · The five operations

Every rail we have ever met reduces to these. We need each one, per leg.
Where a partner has no equivalent, we need to know that now rather than at
integration.

| Operation          | What it must do                                               | What it must **not** do                          |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------ |
| `resolveRecipient` | Return the name the institution holds for a wallet or account | Guess, or echo back the name we sent             |
| `initiatePayout`   | Accept a payout instruction plus **our** idempotency key      | Return a settled status                          |
| `getStatus`        | The authoritative state, safe to call repeatedly              | Rate-limit us out of the only source of truth    |
| `parseCallback`    | A signed webhook we can verify and deduplicate                | Be the thing that tells us money moved           |
| `fetchStatement`   | A batch file or endpoint for T+1 reconciliation               | Disagree with `getStatus` without us finding out |

Three of these carry a rule that is not negotiable at our end, and it is worth
saying plainly because it is unusual and it makes their life easier:

**Acknowledgement is not settlement.** `initiatePayout` returning `200` means
they have the instruction. It does not mean the recipient has money, and our
types will not let it mean that. Only `getStatus` and the statement can move our
ledger.

**We do not need their webhooks to be reliable.** A transfer reaches a terminal
state on our poll schedule with no callback at all. Webhooks make it faster;
they are never load-bearing. Most integrations break on the opposite assumption,
so tell them this — it removes their biggest delivery risk.

**Where the poll and the statement disagree, the statement wins**, and the
difference is investigated rather than overwritten.

---

## 3 · Recipient resolution (name enquiry)

We show the sender the name the network holds **before** they commit. We will
not ship a corridor without it — money sent to the wrong wallet cannot be
recovered, and the name check is the only thing standing between a typo and a
permanent loss.

For Cameroon we need:

- An endpoint taking an MSISDN (`237` + nine digits) and a network (MTN, Orange)
- Returning the registered name, or a clean "no such wallet"
- Latency budget: it sits in front of a button a person is waiting on

**Ask:** does name enquiry cost per call, and is it rate-limited? If it is
metered we need to know before we put it on every recipient screen.

---

## 4 · Money on the wire

Guardrail: **no floating-point money crosses an adapter boundary.** We parse
provider amounts into integer minor units at the edge, or reject the payload.

We need, in writing:

1. **Representation** — integer minor units, or a decimal string? Either is
   fine. A JSON number that has been through a float is not.
2. **Rounding** — direction and where it is applied.
3. **Decimal places per currency, explicitly.**

Point 3 is the one that bites on this corridor. **XAF has no minor unit.**
`25000` XAF is twenty-five thousand francs, not two hundred and fifty. A
partner who sends `"25000.00"` for XAF and a partner who sends `"2500000"` are
a hundredfold apart, and both look plausible in a test. Get their answer for
XAF and XOF specifically, in writing, and we will assert it in the adapter.

---

## 5 · Idempotency

Every financial write we make carries an idempotency key. We need:

- **A client-supplied key accepted on `initiatePayout`** — header or field, and
  the exact name
- **Its retention window.** A key that expires in an hour is not much use
  against a retry the next morning
- **The behaviour on a duplicate key with a different body.** The right answer
  is a `409`, not silently honouring the first or the second

Without a client-supplied key we can still integrate, but the adapter has to
carry a reconciliation step to detect double-submission, and that should be a
deliberate decision rather than a discovery.

---

## 6 · Webhooks — the part that usually goes wrong

We verify, deduplicate, and enqueue a status poll. We never post to the ledger
from a callback. What we need in order to verify one:

| Requirement     | Detail                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| **Signature**   | Scheme (HMAC-SHA256 or similar), the header name, and the shared secret  |
| **Signed over** | The **raw request body**, byte for byte — not a re-serialised object     |
| **Timestamp**   | A header we can use to reject stale deliveries; tell us your clock skew  |
| **Event id**    | A stable unique id per event. **Required** — without one we cannot dedup |
| **Retries**     | How many, over what interval, and whether the event id stays the same    |
| **Source IPs**  | So we can allowlist, and so you can tell us when they change             |

The event id is the one people forget. A webhook without a stable identifier
cannot be replay-protected, so if their design has none, we fall back to
polling for that provider and we should know that now.

---

## 7 · Status model

We need their **complete** status enum, not the happy path, and for each value:

- Is it terminal?
- **Can it change after being terminal?** A payout that goes `SETTLED` and later
  reverses is not a rare edge case in African rails, and if it can happen we
  need to model it rather than discover it in a reconciliation.
- What does the customer-facing failure reason look like, and is it safe to
  show a sender?

Map their values to ours: pending, settled, failed, returned.

---

## 8 · FX, for the conversion leg

Two workable shapes. We need to know which:

**They quote.** A dealable NGN→XAF rate with a timestamp and a hold window, and
a quote id passed to the payout call. This is the better arrangement — it
removes basis risk entirely, because we quote the sender what the partner will
actually fill at. Ask for: endpoint, hold duration, and what happens when a
quote expires mid-flight.

**We pre-fund.** We hold XAF with them and they pay out from our balance. Then
we need: balance endpoints, funding instructions, settlement cut-offs, and the
minimum float. This drives our treasury module directly.

Either way, ask whether the **FX spread is disclosed or embedded**. We show the
sender the mid-market rate and our margin separately — an embedded spread we
cannot see is a product problem before it is a cost problem.

---

## 9 · Reconciliation

- A T+1 statement: file or endpoint, format, **timezone**, and cut-off time
- One row per movement with their reference, the amount, the value date and the
  institution reference
- How corrections and reversals appear in it

"We can email you a CSV" is a real answer. It changes our runbook rather than
blocking us, and it is better to know than to assume an API exists.

---

## 10 · Sandbox

Credentials on day one, before commercials are finished if possible — the
adapter is days of work once we can call something.

We need to be able to force, in sandbox:

- A payout that settles immediately
- One that stays pending across several polls, then settles
- One that is acknowledged and then **fails** — the case that must produce an
  automatic refund at our end
- A name enquiry that finds nothing
- A reversal after settlement, if their model allows one

Our simulators already produce all of these, which is why the whole lifecycle is
testable today with no partner at all. Matching them in their sandbox is what
lets us prove the adapter rather than hope for it.

---

## 11 · What we give them

Worth offering, because it shortens their side:

- **Our egress IP**, for their allowlist
- **A webhook endpoint** with signature verification, replay protection and
  deduplication already built
- **A test account** in our demonstration environment so their engineer can see
  where their responses surface
- Our reference format (`MP-XXXX-XXXX`) for their statements, so a break is
  traceable from either side

---

## Summary — the ask in one paragraph

_For NG→CM: can you collect NGN in Nigeria, convert to XAF, and credit an MTN or
Orange wallet in Cameroon — and which of those three do you do in production
today? If yes, we need sandbox credentials, API docs, your webhook signing
scheme with a per-event id, your full status enum including whether a terminal
state can reverse, your decimal handling for XAF confirmed in writing, whether
`initiatePayout` takes our idempotency key, and whether you can quote us a
dealable NGN→XAF rate. Our side is already built against a port with exactly
five operations, so the adapter is days rather than a project._
