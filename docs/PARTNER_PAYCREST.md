# Paycrest — what to show, what to ask, what to request

A working sheet for the conversation with the Paycrest partnership manager.
Three sections in the order the meeting will actually run: what we show, what
we need to find out, and what we ask them to do next.

> The single most important thing to hold in mind: **the Paycrest deck is
> addressed to a bank, not to an application.** Every role in it is labelled
> "Your Role (Russian Bank Partner)" — provide virtual accounts, provide
> stablecoin liquidity, provide PSP access. We are not that bank. Signing with
> Paycrest does not close that gap; it makes closing it urgent. Go into the
> meeting knowing that, and one of the questions below is aimed squarely at it.

---

## 1 · What to show him

Lead with the fact that the integration work is already done against their
shape. That changes the conversation from "we have an idea" to "we have a
counterparty who is ready to test", which is a different queue at their end.

**Show the working product.** Sender app and back office are live on the
demonstration server. Twenty intra-African corridors plus the two Russian ones
run end to end, and the ledger closes to zero in six currencies. Let him click
it rather than describing it — `docs/DEMO.md` is the script.

**Show the provider port.** This is the thing that will actually interest an
integrations engineer. `packages/adapters/src/ports/payout-provider.ts` — five
operations that every payout rail reduces to:

| Operation          | What it does                                      |
| ------------------ | ------------------------------------------------- |
| `resolveRecipient` | Name enquiry before the sender commits            |
| `initiatePayout`   | Submit, with an idempotency key                   |
| `getStatus`        | The authoritative answer, safe to call repeatedly |
| `parseCallback`    | Verify and normalise a webhook                    |
| `fetchStatement`   | Batch file for T+1 reconciliation                 |

Say what the type signatures refuse to allow, because it tells him we have
integrated with a payment rail before:

- `initiatePayout` returns an **acknowledgement**, never an outcome.
- `parseCallback` returns a **trigger**, never an outcome.
- Only `getStatus` and `fetchStatement` can produce something our ledger will
  post. **Acknowledgement is not settlement**, and our types enforce it.

The practical consequence, which is worth saying out loud: _we do not need
their webhooks to be reliable._ A transfer reaches a terminal state on the poll
schedule alone. Webhooks make it faster and nothing more. Most integrations
break on exactly this assumption, so it is a good thing to be explicit about.

**Show the compliance posture.** Sanctions screening on every sender and
recipient, unbypassable in code. Double-entry ledger, no mutable balances, the
statement wins over the poll on any disagreement. Tiered KYC. A hash-chained
audit log. A licence gate that refuses to move live funds on any corridor whose
authorisations are not explicitly declared as held — and today none are, which
is why nothing real moves yet.

**Show that live funds are off, deliberately.** `LIVE_FUNDS_ENABLED` is false
and there is no code path that can flip it. That is a feature to a partner's
risk team, not an apology.

---

## 2 · What to ask him

Ordered by how badly a late "no" would hurt. Ask the top three first even if
the meeting is short.

### The three that can end the partnership

**1. Does your correspondent bank accept Russia-origin flows — confirmed in
writing by the correspondent, not by you?**

This is the question most likely to kill the whole arrangement, and the one
most likely to be answered optimistically by someone in a commercial role. A
partner saying "we can handle it" is not the same as their correspondent bank
saying so. Ask for it in writing, and ask _which_ correspondent, because the
answer can change when they reroute.

**2. The deck assigns virtual accounts, RUB collection and RUB→stablecoin
conversion to "the Russian bank partner". Who is that, in your live corridors
today — and can you introduce us?**

This is the gap. Either they have such a partner and can introduce us, or they
expect us to bring one. Both answers are useful; ambiguity is not. If they can
introduce one, that is more valuable to us than the payout leg itself.

**3. What is your regulatory status in each market you would settle for us,
and who holds the customer-facing obligation?**

Their non-custodial model protects _their_ position. It does not create ours.
We collect from senders and therefore need authorisation on our own leg
regardless. Confirm we agree on where their obligation ends and ours begins.

### Coverage and corridors

4. **Which corridors are live today versus "integrated and activating"?** The
   deck says 62 countries; the live list we have is Nigeria, Kenya, Uganda,
   Tanzania, Argentina. We need Nigeria now and Ghana next. **Ghana is not on
   the live list — when is it, and is that a date or a hope?**
5. Do you support **Ghana mobile money** (MTN, Telecel, AirtelTigo) or only
   bank accounts? Our Ghana leg is wallet-first.
6. Do you cover **South Africa, Cameroon and Benin** — and if so, bank or
   wallet? We have all three built. XAF and XOF are separate central banks
   despite the parity; confirm they treat them as two.
7. Can you settle **intra-African** legs (NG→GH, ZA→NG) or only inbound from
   outside Africa? A large part of our product is African-origin.

### The integration itself

8. **API documentation, sandbox credentials, and a Postman collection** — how
   soon? We can have an adapter running against a sandbox in days, not weeks,
   because the port already exists. The full technical list to hand their
   integration engineer is [`PARTNER_INTEGRATION_SPEC.md`](PARTNER_INTEGRATION_SPEC.md).
9. **Do you offer name enquiry / account-name resolution** before payout? We
   show the recipient's real name to the sender before they commit, and we will
   not ship a corridor without it.
10. **Idempotency:** does `initiatePayout` accept a client-supplied idempotency
    key, and what is its retention window? What happens on a duplicate key with
    a _different_ body?
11. **Webhook signing:** what scheme, which header, and is the signature over
    the raw body? Do you support replay protection with a timestamp? (We verify
    signature and freshness and dedup, and we still never post to the ledger
    from a callback.)
12. **Statements:** is there a T+1 batch file or reconciliation endpoint? What
    format, what timezone, and what is the cut-off? This is how we settle
    disagreements, so "we'll send a CSV by email" is a real answer but it
    changes our runbook.
13. **Status model:** what are your terminal states, and can a payout move
    _out_ of a state we would treat as final? Any state that can reverse after
    we have posted to the ledger needs to be named now.
14. **Rate feed:** will you quote us a **dealable** rate we can price off, with
    a timestamp and a hold window? This removes basis risk entirely — we would
    quote what you will fill at. If yes, this is worth more to us than a few
    basis points of pricing.

### Commercials and operations

15. **Pricing:** fee per transaction, FX spread, and whether the spread is
    disclosed or embedded. We show the mid-market rate and our margin
    separately to the sender, so an embedded spread we cannot see is a product
    problem, not only a cost one.
16. **Settlement:** what pre-funding do you require, in what currency, and what
    is the float turnaround? This drives our treasury module directly.
17. **Limits:** per transaction, per day, per recipient. And what happens at
    the limit — refusal, or hold?
18. **Failure handling:** how are failed payouts returned, on what timetable,
    and do fees come back? Our refund path is built and needs to match theirs.
19. **Support:** named technical contact, escalation path, and target response
    time for a stuck payout. Ask for a Slack or Telegram channel with their
    engineers — this is worth more than an SLA document.
20. **Uptime and incident history:** what is their published availability, and
    what was their last significant incident? A partner who answers this openly
    is a better partner than one who has never had an incident.

---

## 3 · What to request

Concrete asks, so the meeting ends with actions rather than goodwill.

1. **Sandbox credentials and API documentation.** The first ask, and the
   cheapest for them to grant. Everything else can proceed in parallel once we
   have this.
2. **A named technical contact** and a shared channel with their engineers.
3. **The correspondent bank's written position on Russia-origin flows** — from
   the correspondent, not a summary from Paycrest.
4. **An introduction to their Russian pay-in partner**, if one exists.
5. **A written coverage matrix**: country, currency, payout method, live or
   planned, with dates for the planned ones.
6. **Their commercial terms in writing**, including whether the FX spread is
   disclosed.
7. **A pilot scope**: one corridor (NG), a small number of transfers, capped
   value, with both sides' compliance teams in the loop. Small enough that
   nobody needs a committee to approve it.
8. **Their due-diligence pack requirement** — what they will need _from us_ to
   onboard. Getting that list early is what stops the last two weeks becoming
   six.

---

## 4 · What not to say

Two traps, both easy to walk into when a partner is enthusiastic.

**Do not agree to go live before the blocking items exist.** Legal opinions,
the Russian partner, the correspondent's written position, the collection
licences, an appointed compliance officer. `docs/OPEN_ITEMS.md` is the list.
Enthusiasm from a partner is not a substitute for any of them, and the licence
gate in the code will refuse the corridor regardless — which is the point of
having built it that way.

**Do not let their non-custodial model be described as covering our
obligations.** It covers theirs. We hold sender funds (ADR 0004), so client
money handling is our question to answer with our own counsel.

---

## 5 · After the meeting

Write down, the same day, in `docs/OPEN_ITEMS.md`:

- what they confirmed, with names and dates;
- what they promised, and by when;
- anything they were vague about — vagueness in a first meeting is data, and it
  is the thing most likely to be forgotten by the second one.

If sandbox credentials arrive, the next engineering step is a
`PaycrestPayoutProvider` implementing the existing port. Nothing in the
transfer saga, the ledger or the corridors changes — that is what the port is
for, and it is the reason this integration is days of work rather than a
project.
