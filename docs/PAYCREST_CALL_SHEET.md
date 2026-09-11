# Paycrest call sheet

One page to keep open during the call. Ordered by what kills the deal soonest,
split by who can actually answer it.

The background reasoning is in `DECISION_STABLECOIN_ROUTE.md`; the full
technical list to send their engineer afterwards is
`PARTNER_INTEGRATION_SPEC.md`. This is the version you talk from.

---

## If the meeting is short, ask these three

**1. Which direction do you actually do — and through which API?**

Your published Sender API guide has described stablecoin-to-fiat (offramp)
only, with fiat-to-stablecoin (onramp) listed as coming later. Noblocks
clearly does NGN→USDT today. So: is naira collection available through the
same Sender API we would integrate against, or only inside the Noblocks front
end?

> **Why it matters:** offramp-only means you can deliver XAF in Cameroon but
> cannot collect the naira in Nigeria — half the corridor.
>
> **Worry if:** the answer is "through Noblocks". That means depending on
> their consumer app rather than an API.

**2. Who is the provision node, and who does KYC on them?**

The person who actually hands over the naira is a provision node. Do you
onboard and screen them? Can you tell us, per transaction, which entity
fulfilled it? What happens if one turns out to be sanctioned?

> **Why it matters:** our screening obligation does not stop at our own
> customer. "Non-custodial" protects you; it does not answer a regulator
> asking who received our customer's money.
>
> **Worry if:** the answer is that the network is permissionless and they
> don't know. That is a legal-opinion blocker, not a detail.

**3. Committed liquidity, or best-effort?**

Your app showed "up to ₦8,437 available right now" against a ₦20,000 request.
Is there a tier where someone commits to fill, or is every order best-effort
against whatever depth exists that minute?

> **Why it matters:** we lock a rate for 90 seconds and publish corridor
> minimums and maximums. We cannot quote against a pool that might not be
> there.
>
> **Worry if:** there's no committed tier at any price.

---

## For the manager — commercial and regulatory

4. **What is your regulatory status in each market you'd settle for us** —
   and where does your obligation end and ours begin?
5. **Which corridors are live today**, with a real customer, versus
   integrated-and-activating? We have now built all fifteen: Nigeria, Ghana,
   South Africa, Cameroon, Benin, DR Congo, Republic of the Congo, Uganda,
   Kenya, Tanzania, Zambia, The Gambia, Niger, Mali and Senegal — 210
   corridors, both directions, every one refused by our licence gate until
   somebody holds the authorisation.

   Ask for the coverage matrix as **country × collection × payout × live or
   planned, with dates**. Collection and payout are separate questions in every
   one of those markets and a single "we cover Kenya" answers neither.

   Two things to check they have right, because they are the two most people
   get wrong:

   - **CD and CG are two countries.** Kinshasa spends Congolese francs under
     the BCC; Brazzaville spends CFA francs under the BEAC, alongside Cameroon.
     If their matrix has one row called "Congo", find out which.
   - **XOF is four countries, not one.** Benin, Niger, Mali and Senegal share
     the currency and the central bank and still need four approvals. Ask which
     of the four they are actually authorised in.

   **The most valuable single answer on this call:** of the thirty
   authorisations our mesh needs — a collection and a payout in each of fifteen
   markets — how many do you already hold? That is what a partnership would
   actually be buying, and it is worth more than the API.

6. **What does the $3,000 actually buy** — a licence, source code, or your
   engineer's time? Is the code already public? Does it convey any liquidity,
   licence or provider relationship? _(Expect no to the last three.)_
7. **Is sandbox/test API access included**, or is that the $3,000?
8. **Pricing** — fee per transaction, and is the FX spread disclosed or
   embedded? We show our margin to the sender separately, so a spread we
   cannot see is a product problem before it is a cost one.
9. **Limits** — per transaction, per day, per corridor. What happens at the
   limit: refusal, or hold?
10. **Failure and return** — how does a failed XAF payout come back, on what
    timetable, and do fees return with it?
11. **Support** — a named technical contact, an escalation path, and a shared
    channel with your engineers. Worth more than an SLA document.
12. **What do you need from us** to onboard? Get that list now; it is what
    turns the last two weeks into six.

_Lower priority for intra-African, but still on the list:_ does your
correspondent bank accept Russia-origin flows, confirmed in writing by the
correspondent rather than by you — and who fills the Russian collection role
your deck assigns to a bank?

---

## For the engineer — technical

13. **Sandbox credentials and API docs** — how soon? We have an adapter
    running in days once we can call something.
14. **Name enquiry in Cameroon** — do you resolve an MTN or Orange wallet
    (`237` + nine digits) to a registered name before payout? Cost per call?
    Rate limits? _We will not ship a corridor without this._
15. **Idempotency** — does the payout call take a client-supplied key? Header
    name, retention window, and what happens on a duplicate key with a
    different body. _(A 409 is the right answer.)_
16. **Webhook signing** — scheme, header name, and is the signature over the
    raw body byte-for-byte? Is there a timestamp header? **Is there a stable
    unique event id per delivery?**

    > The event id is the one people forget. Without it we cannot deduplicate
    > replays, and we fall back to polling for you.

17. **Your complete status enum** — not the happy path. Which values are
    terminal, and **can any of them reverse after being terminal?**
18. **Decimals, in writing, per currency.** XAF, XOF **and UGX** have no minor
    unit. Is twenty-five thousand francs `25000` or `2500000` in your payload?
    _A partner sending one and a partner sending the other are a hundredfold
    apart and both look plausible in a test._

    Ugandan shillings are the one to pin down hardest: UGX has no minor unit
    while the Kenyan and Tanzanian shillings either side of it have two, so a
    partner who handles East Africa with one code path has probably got one of
    the three wrong and does not know it. Ask for a worked example in all
    three.

19. **Same-currency transfers.** Do you support XOF Senegal → XOF Mali, and
    what rate do you apply? There is no exchange, so the only correct answer is
    one — if they quote a spread on it, that is a fee wearing a rate's
    clothing and we would be passing it to a customer as an exchange rate.
20. **Statements** — T+1 file or endpoint? Format, timezone, cut-off. "We
    email a CSV" is a real answer; it changes our runbook rather than
    blocking us.
21. **Sandbox scenarios** — can we force a settle, a pending-then-settle, an
    acknowledged-then-failed, a name enquiry that finds nothing, and a
    reversal after settlement?
22. **Fill times** — p50 and p99, not "usually 30 seconds". And the largest
    single NG order filled in the last 30 days.

---

## Two things to tell them

**We do not need your webhooks to be reliable.** Our transfers reach a
terminal state on a poll schedule with no callback at all. Webhooks only make
it faster. Most integrations break on the opposite assumption — saying this
early removes their biggest delivery risk and tends to earn immediate credit
with an engineer.

**Acknowledgement is not settlement, in our types.** A 200 on the payout call
means you have the instruction, not that the recipient has money. Only a
status read or the statement moves our ledger.

---

## Do not agree to on the call

- Going live before the legal opinions exist. The licence gate in our code
  will refuse the corridor anyway — that is what it is for.
- That their non-custodial model covers our obligations. It covers theirs.
- Buying the app. Ask for API access instead.

---

## Close with

_"Send sandbox credentials and the API docs to our engineer, and the coverage
matrix with dates for anything not yet live. We'll come back with a working
adapter."_

Then write down the same day, in `OPEN_ITEMS.md`: what they confirmed, what
they promised and by when, and **anything they were vague about**. Vagueness
in a first meeting is data, and it is the thing most likely to be forgotten by
the second one.
