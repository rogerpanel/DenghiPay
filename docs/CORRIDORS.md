# Corridors

Four corridors run today, and they are not all the same kind of thing. The
transfer code cannot tell them apart — that is the point of corridors being data
— so the difference is written down here and enforced by a check that runs on
every corridor read.

| Corridor | Collect                        | Deliver                | Class              | Status                              |
| -------- | ------------------------------ | ---------------------- | ------------------ | ----------------------------------- |
| RU→NG    | RUB in Russia, via a partner   | NGN to a bank account  | Inbound remittance | Simulated. Blocked on OPEN_ITEMS B1 |
| RU→GH    | RUB in Russia, via a partner   | GHS to a mobile wallet | Inbound remittance | Simulated. Blocked on B1 and B4     |
| NG→GH    | NGN inside Nigeria, to a NUBAN | GHS to a mobile wallet | Intra-African      | Simulated. Blocked on B6            |
| GH→NG    | GHS inside Ghana, wallet debit | NGN to a bank account  | Intra-African      | Simulated. Blocked on B6            |

BY→NG and BY→GH exist as rows and are disabled, awaiting a Belarusian
collection partner.

## The two classes, and why the distinction is load-bearing

**Inbound remittance (RU→).** We collect in Russia through a licensed Russian
partner, and the money arrives in Nigeria or Ghana as an inbound cross-border
remittance — an activity the destination partner's own IMTO authorisation
already covers. Our regulatory weight sits at the origin, and the open question
is who that Russian partner is.

**Intra-African (NG→, GH→).** Both ends are domestic. We take naira from a
person who is _in Nigeria_ and pay cedis to a person who is _in Ghana_.
Collecting money from the public inside Nigeria is a CBN-licensed activity in
its own right; debiting mobile-money wallets inside Ghana sits under the Bank of
Ghana's payment-systems regime. Neither is implied by holding an
inbound-remittance arrangement.

And neither direction implies the other. **NG→GH does not authorise GH→NG.**
They are two corridors with two collection licences, and the fact that they look
symmetrical on a diagram is exactly why it is worth stating.

`BUILD_PLAN` Part 8 defers additional corridors until the first one is live and
reconciled. This work runs ahead of that deliberately, at the CEO's direction,
because the product question — can MoraPay carry intra-African flows at all? —
is worth answering with a working demonstration rather than an estimate. What it
does **not** do is move the regulatory position: nothing here can move a real
naira or a real cedi.

## How that is enforced

`packages/domain/src/corridors/licensing.ts` names the authorisation each leg
rests on:

| Authorisation            | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `RU_COLLECTION_PARTNER`  | A licensed Russian partner collects RUB on our behalf         |
| `BY_COLLECTION_PARTNER`  | The same, for Belarus                                         |
| `NG_DOMESTIC_COLLECTION` | CBN authorisation to collect naira from the public in Nigeria |
| `GH_DOMESTIC_COLLECTION` | Bank of Ghana authorisation to debit cedi wallets in Ghana    |
| `NG_PAYOUT_RAIL`         | A licensed rail crediting Nigerian bank accounts              |
| `GH_PAYOUT_RAIL`         | A licensed rail crediting Ghanaian mobile-money wallets       |

With `LIVE_FUNDS_ENABLED=false` the check is a no-op: a simulated corridor moves
no money and needs no licence, which is what lets both directions be built and
shown today. With live funds on, a corridor is readable only if **every**
authorisation it rests on is named in `LIVE_CORRIDOR_AUTHORISATIONS`. There is
no wildcard and no skip flag; the only way through is to write the specific
name, which is a sentence a reviewer can ask for evidence of.

Observed behaviour with live funds on:

```
LIVE_CORRIDOR_AUTHORISATIONS=                                   → no corridors offered
LIVE_CORRIDOR_AUTHORISATIONS=NG_DOMESTIC_COLLECTION,GH_PAYOUT_RAIL
                                                                 → NG-GH only
                                                                   GH-NG refused, log names
                                                                   GH_DOMESTIC_COLLECTION, NG_PAYOUT_RAIL
LIVE_CORRIDOR_AUTHORISATIONS=ALL                                 → refuses to boot
```

The check runs in `CorridorsService`, so it covers the sender-facing catalogue,
every quote, and the confirmation step — a quote outlives the check that priced
it, so the corridor is re-read at confirmation rather than trusted from before.

## What each corridor collects with

Collection is the part that differs most, and it is not symmetrical.

- **Russia** — SBP push, QR, card, or a virtual account. The sender originates
  the payment.
- **Nigeria** — a dedicated ten-digit NUBAN the sender pushes to. Card is
  deliberately absent: a card-funded remittance is a chargeback exposure we are
  not taking on.
- **Ghana** — a mobile-money debit. This one runs the other way round: we ask
  the network to debit the sender's wallet and they approve a prompt on their
  handset. That makes it the only rail that needs the sender's own account
  details, so the wallet is captured at verification, stored in the GH
  partition, and read into the outbound provider call at the moment of
  collection — never written to the neutral tier. Approval prompts get dropped
  often enough that the instructions carry the operator's USSD short code as a
  fallback.

A transfer whose Ghanaian sender has no verified wallet on file fails with
`NO_COLLECTION_WALLET` rather than sitting in `AWAITING_PAYIN` forever.

## Residency

A sender must be where the collection happens. Someone in Lagos cannot hand over
rubles, so RU→NG is neither offered to them nor accepted from them —
`CORRIDOR_RESIDENCY_MISMATCH`. Personal data follows the same line: Nigerian and
Ghanaian senders are held in `partition_ng` and `partition_gh`, in their own
stores, with the identifiers those jurisdictions actually use (a BVN, a Ghana
Card). Belarus is the one exception, holding its senders in the RU store under
the same regime.

Screening is unchanged and unbypassable in every direction. `screeningSubject`
returns null for a residency with no store behind it, and the compliance gate
treats an absent subject as unscreenable.

## Rates

There is no deep direct NGN/GHS market; both legs cross the dollar in practice.
The feed therefore carries `NGN:GHS` and `GHS:NGN` as explicit observations
computed from the dollar cross, rather than pivoting through USD inside the
quote engine. Crossing once, at the feed, keeps the quote to a single rounding
step and a single staleness window, and avoids the ledger holding a USD leg for
a transfer that never touches a dollar. The two directions are separate
observations, not a rate and its reciprocal, because that is how they will
arrive from a real feed — each with its own spread.

## Limits

NGN and GHS are now send currencies, so they have tier rows of their own,
anchored to the local regimes rather than converted from the ruble rows: NGN
follows the shape of the CBN's three-tier KYC regime; GHS follows the Bank of
Ghana's mobile-money tiers, which are stated as daily aggregates, so the
per-transfer cap is set at the daily figure. The numbers are placeholders the
compliance officer owns. What is not a placeholder is that the rows exist:
`checkLimits` refuses a currency it has no row for, so an unlisted send currency
fails closed.

## Adding the next one

A French-speaking corridor is the stated next step. The work is:

1. A row in `CORRIDORS` (seed) and the country in `CountryCode`.
2. A currency in the registry, a `SEND_CURRENCY` entry, and tier limit rows.
3. `FEE_REVENUE`, `FLOAT_*`, `SUSPENSE` and `PARTNER_RECEIVABLE` accounts in
   that currency — the saga looks them up by code and a missing one stops a
   transfer dead.
4. Rate pairs in both directions.
5. A collection rail, and if it pulls rather than waits to be pushed to, the
   account to debit in that country's partition.
6. A sender store in the new partition, plus its screening projection.
7. Authorisation names in `licensing.ts`, and the honest answer to what they
   require.

Step 7 is the one that takes months. The other six take a day.
