# Decision brief — the stablecoin route, buying an app, and contractor access

Three questions came out of the Paycrest engineering call. They are separable
and only one of them is urgent, so they are answered separately here.

| Question                                      | Short answer                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Route NGN→USDT→XAF through Paycrest/Noblocks? | Possible and interesting. It is a **second regulated business**, not an integration task. Needs a legal opinion before any build. |
| Buy the Paycrest app for $3,000?              | **No.** It buys the part we are strongest at and none of the parts we lack. Ask for sandbox API access instead — normally free.   |
| Give their engineer scoped access?            | **Yes**, and the boundary already exists in the code. Details in §4.                                                              |

---

## 1 · What the protocol in the diagram actually is

The architecture shared on the call is a **peer-to-peer liquidity network with
on-chain escrow**:

```
Sender → Gateway (escrow contract) → Aggregator nodes → Provision nodes → local providers
```

A sender's funds are locked in an escrow contract. Aggregator nodes match the
order to **provision nodes** — independent participants who hold local fiat,
pay the recipient in-country, and then claim the stablecoin out of escrow.

That is a genuinely clever design and it solves a real problem: it reaches
countries where we will never hold our own licence, because the last mile is
somebody local who already can. For a business that wants to go global, that
is the interesting part and it should not be dismissed.

It also changes what we are, in four ways that need to be said plainly.

### 1.1 It makes us a crypto business as well as a remittance business

NGN → USDT → XAF means stablecoins are in the middle of a customer's money.
Whether or not we ever "hold" them in a wallet we control, we are transmitting
value in a virtual asset. That triggers:

- **VASP registration** in most jurisdictions that have a regime, and a live,
  moving question in Nigeria specifically;
- **The FATF Travel Rule** (Recommendation 16) — originator and beneficiary
  information must travel with the transfer above threshold, which is a
  technical obligation on us, not on the protocol;
- A second set of conversations with the same regulators we are already
  talking to about remittance.

This does **not replace** B2, B6 or B7 in `OPEN_ITEMS.md`. It adds to them.
Anybody who describes this as "just another payout rail" has not priced it.

### 1.2 The provision node is an AML counterparty we do not control

Guardrail 3: sanctions screening is mandatory and unbypassable. Today we screen
the sender and we screen the recipient, and no transfer moves toward settlement
without a passing record.

In this model the entity that actually hands over naira is a **provision node**
— a third party we do not onboard, do not screen, and cannot see. If one is a
designated person or is laundering, our customer's transfer went through them.

"Non-custodial" is a real protection **for the protocol operator**. It is not a
protection for us, and it is not an answer to a regulator asking who received
our customer's money.

**This is the single question to put to counsel.** It is an extension of
OPEN_ITEMS B2 and it should be added to that engagement rather than run
separately.

### 1.3 Liquidity depth is not settlement capacity

The screenshot from the call is the best evidence available and it makes the
point better than any argument: a sender asked to convert **₦20,000** and the
app answered **"Up to ₦8,437 available right now."**

Our quote engine locks a rate for ninety seconds and our corridors publish a
minimum and a maximum send. A pool whose depth varies minute to minute cannot
back a quote unless somebody commits to fill it.

Ask their engineer, specifically:

- What happens to an order the pool can only **partially** fill?
- Is there a **committed** liquidity tier, or is every order best-effort?
- What is the p50 and **p99** fill time, not the "usually 30s" on the marketing
  page? Our poll schedule copes with slow; our customers cope less well.
- What is the largest single order filled in the NG pool in the last 30 days?

### 1.4 The rate is not the official rate

The same screenshot implies roughly **1,365 NGN/USDT**, against the ~1,455
NGN/USD anchor in our own feed. P2P rates often beat the official rate, and
commercially that is a point in favour — it is why this liquidity exists.

It is also precisely the number that is _not_ the official rate, which matters
for anything we have to report. Worth understanding before it becomes a
reconciliation argument, not after.

### 1.5 Check which direction they actually do

Paycrest's own integration guide has been describing the Sender API as
**stablecoin-to-fiat (offramp) only**, with fiat-to-stablecoin (onramp) listed
as forthcoming. That date has long passed and Noblocks visibly performs
NGN→USDT today, so onramp plainly exists in some form — but possibly through
the P2P provision-node network rather than through the Sender API a partner
integrates against.

This matters directly for NG→CM. Offramp-only would mean they can deliver XAF
in Cameroon but **cannot collect the naira in Nigeria**, which is exactly the
leg `PARTNER_INTEGRATION_SPEC.md` §1 says to pin down first.

**Ask:** which API does the NGN collection leg use, is it the same Sender API,
and is it generally available or still limited to the Noblocks front end?

### 1.6 It does not solve Russia

The RUB collection leg (OPEN_ITEMS B1) is untouched by any of this. Worth
saying because a stablecoin route can look, in a diagram, as though it solves
everything.

### Recommendation

Not "no". **"Yes, as a second rail, after a legal opinion, and priced as a
second regulated product."** Sequence it behind a boring licensed rail rather
than instead of one — see §3.

---

## 2 · The $3,000

Ask what it actually conveys before anything else. At that price it is almost
certainly one of: an integration and setup fee, a source drop of a front end,
or a white-label skin. Any of those may be fine — but they are different things
and only one of them is an asset.

The specific questions:

1. **What is being sold** — a licence, source code, or someone's time?
2. **Is it already publicly available?** Much of this ecosystem is open source.
   If the code is public, the $3,000 is buying their engineer's hours, which is
   a reasonable thing to buy and should be called that.
3. **Who owns modifications** we make?
4. **What ongoing support** comes with it, and for how long?
5. **Does it convey any liquidity, any licence, or any provider relationship?**
   (Expect: no, no and no.)

### Why the answer is still no

**It buys the part we are strongest at.** Noblocks is a swap interface. We
already have a sender app, a back office, a double-entry ledger, a hash-chained
audit log, unbypassable screening, tiered KYC, exchange-control declarations,
four-eyes treasury and twenty working corridors. Buying a second front end adds
nothing we lack.

**It buys none of the parts we lack** — which are, in order: a Russian
collection partner, written legal opinions, domestic collection licences, a
compliance officer, and liquidity.

**What we actually want from Paycrest is a rail, not a codebase.** API access
is the ask.

On whether that access should cost anything: for **Fincra** this is documented
and self-serve — they publish a sandbox with its own base URL
(`sandboxapi.fincra.com`), test keys issued from the dashboard, and simulated
card and mobile-money flows, at no stated cost. See
[Sandbox (Test)](https://docs.fincra.com/docs/sandbox-environment),
[Environments](https://docs.fincra.com/docs/api-environments) and
[Authentication](https://docs.fincra.com/docs/authentication).

For **Paycrest** we have not been able to confirm it. Their published
integration guide describes retrieving an API key and secret from a Sender
Dashboard, with no fee mentioned
([Sender API Integration](https://docs.paycrest.io/implementation-guides/sender-api-integration)),
but that is not the same as a documented free sandbox, and it should be asked
rather than assumed. If they will not give test access without $3,000, that is
itself information about how the partnership will go.

**Spend the $3,000 on the legal opinion instead**, if it is going to be spent.
That is the thing standing between us and a live transfer.

---

## 3 · Multi-provider: Fincra, Paycrest, the South African route

Yes — and this is where the architecture is genuinely well placed. Adding a
provider is an adapter behind an existing port; nothing in the transfer saga,
the ledger or the corridors changes. Dual-sourcing was always the intent.

Suggested sequence, cheapest regulatory surface first:

**1 · Fincra for NG and GH.** Regulated, boring, IMTO plus EPSP, and it fits
the model we already have with **no new regulatory category**. This is the one
that gets a real transfer moving soonest. It also directly closes OPEN_ITEMS
B4 (the Ghana payout rail).

**2 · South Africa** already has its own answer: an Authorised Dealer
relationship or an ADLA licence (B8). The exchange-control capability is built
and waiting on that relationship, not on engineering.

**3 · Paycrest/stablecoin as a second rail**, once counsel has answered §1.2,
for destinations where a licensed correspondent is not realistic. This is where
it earns its place — not as a replacement for a licensed rail into Nigeria,
where one is obtainable.

What the code needs for multi-provider, when we get there:

- Provider selection per corridor — the registry already does this
- **Failover**: when provider A cannot fill, try B. New, and contained
- Per-provider reconciliation, because each statement is its own source of truth

None of that is large. It is a phase, not a rewrite.

---

## 4 · Giving their engineer access

Your instinct is right, and the boundary you want already exists in the code.
An engineer implementing a payment rail never needs to see the ledger.

### What they get

| Access                                                                                                   | Why                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A **fork**, or a branch with protection — never direct write to `main`                                   | Every change arrives as a PR you merge           |
| `packages/adapters/src/<provider>/**` — a new folder that is theirs                                      | Where an adapter lives                           |
| The port interfaces, **read-only**                                                                       | `PayoutProvider`, `PayinProvider` — five methods |
| A **sandbox deployment**: `LIVE_FUNDS_ENABLED=false`, its own database, seeded demo data, no real people | Somewhere to test                                |
| **Their own** Paycrest sandbox credentials                                                               | Never ours, and never in the repo                |

### What they never get

- `packages/ledger/`, `packages/domain/` — money primitives and the ledger
- `apps/api/src/transfers/` — the saga
- `apps/api/src/compliance/` — screening, exchange control
- `infra/`, `.github/`, `CLAUDE.md` — deployment and the guardrails themselves
- The production or demonstration server, at any level
- Any real customer data. There is none in the sandbox and there must never be

### Why this works rather than being wishful

**The port is the boundary.** `PayoutProvider` is five methods. An adapter
satisfying it cannot reach the ledger, because nothing in the interface exposes
it — that is what the port was built for, and this is the first time it has had
to do this particular job.

**CODEOWNERS already carves out the money-critical paths**, and CI already
enforces the guardrails on every pull request: the live-funds default check,
the partition-boundary check, secret scanning, coverage floors on `ledger` and
`domain`. A contributor cannot merge a change that weakens those without it
being visible in review.

**Acknowledgement is not settlement, in the types.** Even a hostile adapter
cannot post to the ledger — `initiatePayout` returns an acknowledgement, and
only `getStatus` and the statement produce something the ledger accepts.

### What to put in writing before granting anything

- IP assignment for work done on our repository
- Confidentiality, and no export of data or code
- That they use their own sandbox credentials, never ours
- That the engagement is for the adapter, named explicitly

### One thing to enable on GitHub

Branch protection on the working branch: require a pull request, require review
from a code owner, require CI to pass. CODEOWNERS is already written; it does
nothing until branch protection is switched on.

---

## Summary

Take the sandbox credentials, not the app. Put the provision-node counterparty
question to counsel as part of B2. Do Fincra first because it moves real money
soonest with no new regulatory category. Give the engineer a fork scoped to one
adapter folder, with branch protection on, and never a server. And keep the
$3,000 for the legal opinion — that is the thing actually standing between this
codebase and a first live transfer.
