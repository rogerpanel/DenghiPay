# How a rate is determined

Someone asked the obvious question — the dollar moves every day, and these
currencies move with it, so where does the number on the quote screen come
from, and could a model work it out from public sources? This is the answer,
including the part where the answer is "please do not do that".

## What happens today

Four steps, and only the first one is about the outside world.

**1. Observe.** A `RateSource` produces observations for a currency pair, each
stamped with when it was seen. Today the configured source is
`SimulatedRateSource`, anchored to the numbers in the reference deck so a demo
shows figures a reader can check. `RATE_SOURCE` selects it; `ecb` and `partner`
are declared and not implemented.

**2. Cross once, at the feed.** The feed holds one number per currency —
`USD_ANCHOR`, units per dollar — and every pair is derived from it. Five
origins into five destinations is twenty ordered pairs, and typing them by hand
guarantees that eventually one disagrees with its own reciprocal by more than a
spread, and nobody notices until a treasury reconciliation. The dollar is the
pivot because it is what the underlying rails actually trade against.

The CFA francs are the exception that proves it: XAF and XOF sit at a fixed
euro peg, 655.957 to the euro, carried to the dollar. They are identical
numbers and still listed twice, because the parity is a fact about today's peg
rather than a licence to treat one currency as the other.

**3. Refuse to guess.** An observation has a maximum age (`RATE_MAX_AGE_MS`,
120 seconds by default). Past it, the quote engine does not extrapolate, does
not fall back to the last known value, and does not widen the spread to cover
its uncertainty. It returns `RATE_UNAVAILABLE` and the sender is told we cannot
price this right now. A stale rate that still produces a quote is a promise we
may not be able to keep, and we would find out at settlement.

**4. Lock, and show the whole thing.** A quote fixes a rate for
`QUOTE_TTL_SECONDS` (90 by default) and creates a tracked FX position. The
sender sees the mid-market rate, our rate, the margin in both money and basis
points, and what they would have received at mid. Nothing is hidden inside the
rate — that was a deliberate decision (OPEN_ITEMS D1), and it is why the
breakdown has seven rows instead of one.

## Replacing the simulated feed

Only step 1 changes. `RateSource` is a port with one method; a real feed is an
adapter behind it, and nothing in the quote engine, the ledger or the corridors
knows the difference. That is the whole reason the seam exists.

What a real feed has to be, in order of how often it is got wrong:

| Requirement      | Why                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Dealable**     | A rate you can transact at, not a rate someone published. See below.                                       |
| **Timestamped**  | The staleness rule is the safety property. A feed without an observation time cannot be checked.           |
| **Attributable** | When treasury asks why a transfer filled 40 bps away from the quote, the answer names a source and a time. |
| **Contractual**  | An SLA and a support number. A free endpoint has neither, and the day it changes shape is a Tuesday.       |

Realistic sources, in the order we would actually approach them:

- **Our own settlement partners.** Paycrest, Fincra, or whoever fills the leg,
  quoting the rate they will fill at. This is the best answer for the corridors
  they cover, because it removes basis risk entirely: we quote what we can get.
- **A commercial FX data provider.** Refinitiv, Bloomberg, OANDA, Xe. Dealable
  interbank data with a contract behind it, for corridors no partner covers.
- **Central banks, for reference only.** The CBN, the Bank of Ghana, the SARB
  and the BEAC/BCEAO publish official rates. These matter for reporting and
  for sanity-checking a partner's quote. They are frequently not the rate
  anybody can transact at — Nigeria has spent years with a visible gap between
  the official and market naira — so they belong in reconciliation, not pricing.

## On predicting the rate with a model

The question was whether an AI model could read the daily rate from Google or
similar and apply it. Two different things are hiding in that question, and
they deserve opposite answers.

### Scraping a public source: no

Not because it is technically hard — it is easy, which is the trap.

- **It is not dealable.** The number on a search page is indicative. Quoting a
  sender a rate nobody will fill at means we absorb the difference on every
  transfer, in whichever direction hurts. That is not a pricing strategy; it is
  an unbudgeted trading position taken by accident.
- **It has no timestamp you can trust,** so the staleness rule — the thing that
  makes us refuse rather than guess — silently stops working.
- **It has no contract.** When the markup changes at 3am, quoting breaks, or
  worse, quietly returns a wrong number.
- **It is against the terms of service** of every provider worth scraping, and
  a regulated firm arguing about scraping terms during a licensing review is
  not a position to volunteer for.
- **It cannot be explained to a regulator or an auditor.** "Where did this rate
  come from?" has to have an answer better than a scraper and a search page.

### Predicting tomorrow's rate: no, and this one is more dangerous

A model that forecasts FX and prices off the forecast is running a proprietary
trading book funded by customer remittances. Being right for a month is the bad
outcome, because it builds confidence before the position that ends it. We
carry FX exposure only for the seconds between locking a quote and settling it
— that is what step 4 tracks — and the correct instinct about that window is to
shrink it, not to bet inside it.

### Where a model genuinely earns its place

There is real work here, and it is all _around_ the rate rather than instead of
it:

- **Anomaly detection on the feed.** A rate that jumps 8% between observations
  is either a devaluation or a broken feed, and treating the second as the
  first is how a day's margin disappears in an hour. A model that flags "this
  does not look like this pair's usual behaviour" and halts quoting for it is
  straightforwardly worth building. It fails safe: the worst case is refusing
  to quote for a few minutes.
- **Margin recommendation, with a human deciding.** Our fixed 200 bps ignores
  that a corridor at 09:00 on a Monday and one at 23:00 on a Sunday carry
  different settlement risk. A model can propose a margin per corridor per time
  band; the compliance and treasury owners approve the schedule. The output is
  a proposal a person signs, not a live number.
- **Float forecasting.** Predicting how much naira we need pre-positioned in
  Lagos on Friday is a genuine forecasting problem where being wrong is
  expensive but not dangerous, and it is exactly what the treasury module
  exists to act on.
- **Reconciliation triage.** Where the T+1 statement disagrees with our record,
  ranking the breaks by how likely each is to be a real loss is useful and
  bounded. The statement still wins; the model only decides what a human looks
  at first.

The distinction that runs through all four: a model may decide **what to look
at**, **what to propose**, or **when to stop**. It may not decide what a
customer is charged. That number comes from a source we can name, at a time we
recorded, that somebody will actually fill at.

## Practical answer for the pilot

1. Sign the settlement partners (OPEN_ITEMS B1, B3, B4). Ask each for their
   rate feed as part of the same conversation — it costs nothing at that point
   and is expensive to retrofit.
2. Implement a `PartnerRateSource` per partner behind the existing port. The
   staleness rule, the quote engine and the ledger are untouched.
3. Add a commercial provider as the second source, and cross-check: two sources
   disagreeing by more than a threshold halts quoting on that pair. Two
   independent sources is also what makes the anomaly detector above worth
   having, because it can then say which one moved.
4. Keep the central-bank rates for the reconciliation report and for the
   exchange-control filings, where the official rate is the one the regulator
   expects to see.

Nothing above changes a line of the quote engine. That is the point of the
port, and it is why the honest answer to "can we get real rates in?" is "yes,
in an afternoon, once somebody will sell us one."
