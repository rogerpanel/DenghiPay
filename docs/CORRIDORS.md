# Corridors

214 corridors exist; 212 are enabled. They are not all the same kind of thing,
and the transfer code cannot tell them apart — that is the point of corridors
being data — so the difference is written down here and enforced by a check
that runs on every corridor read.

## The map

**Fifteen African countries, each sending to the other fourteen: 210
corridors.** Plus four inbound from Russia and Belarus.

| Country       | Code | Currency | Minor unit | Collection      | Payout       |
| ------------- | ---- | -------- | ---------- | --------------- | ------------ |
| Nigeria       | NG   | NGN      | 2          | Virtual account | Bank (NIP)   |
| Ghana         | GH   | GHS      | 2          | Mobile money    | Mobile money |
| South Africa  | ZA†  | ZAR      | 2          | Virtual account | Bank         |
| Cameroon      | CM   | XAF      | **0**      | Mobile money    | Mobile money |
| Benin         | BJ   | XOF      | **0**      | Mobile money    | Mobile money |
| DR Congo      | CD   | CDF      | 2          | Mobile money    | Mobile money |
| Rep. of Congo | CG   | XAF      | **0**      | Mobile money    | Mobile money |
| Uganda        | UG   | UGX      | **0**      | Mobile money    | Mobile money |
| Kenya         | KE   | KES      | 2          | Mobile money    | Mobile money |
| Tanzania      | TZ   | TZS      | 2          | Mobile money    | Mobile money |
| Zambia        | ZM   | ZMW      | 2          | Mobile money    | Mobile money |
| The Gambia    | GM   | GMD      | 2          | Mobile money    | Mobile money |
| Niger         | NE   | XOF      | **0**      | Mobile money    | Mobile money |
| Mali          | ML   | XOF      | **0**      | Mobile money    | Mobile money |
| Senegal       | SN   | XOF      | **0**      | Mobile money    | Mobile money |

† Subject to exchange control — see below.

Inbound: RU→NG and RU→GH are enabled. BY→NG and BY→GH exist as rows and are
disabled, awaiting a Belarusian collection partner.

The mesh is generated, not listed, from `AFRICAN_COUNTRIES` in the domain. The
corridor seed, the provider registry in `app.module.ts` and the licence gate
all read that one array, so a corridor cannot exist without a rail behind it
and a new country cannot reach two of the three.

### Four things about this map that are easy to get wrong

**There are two Congos.** CD is the Democratic Republic (Kinshasa, Congolese
franc, Banque Centrale du Congo). CG is the Republic (Brazzaville, Central
African CFA franc, BEAC, alongside Cameroon). Different countries, different
central banks, adjacent codes, and the same word in conversation. They are
named by their capitals everywhere a person picks one, because picking the
wrong one files the sender in the wrong jurisdiction and quotes them the wrong
currency — and every screen after that looks entirely normal.

**Five currencies have no minor unit.** XAF, XOF and UGX are whole units:
25 000 XOF is twenty-five thousand francs, not two hundred and fifty. UGX is
the one to watch, because Kenya above it and Tanzania below it both have two
decimals, so a table of East African shillings is a trap. `currency.spec.ts`
asserts every exponent rather than trusting them.

**A currency union is not a licensing union.** XOF covers Benin, Niger, Mali
and Senegal under one central bank, and XAF covers Cameroon and the Republic of
the Congo. That is one float to fund, and still four separate collection
authorisations — the licence gate wants each country named.

**Fourteen corridors are same-currency.** The four XOF countries sending to
each other and the two XAF ones. There is no exchange, so the rate is exactly
one and the FX margin is zero; the fixed fee is the only charge. See
`rates.service.ts` — the identity is returned without consulting the feed,
because no feed will ever quote XOF/XOF.

## South Africa: exchange control

South Africa was receive-only until 4.3c, because sending out of it is not just
another licence — it is a different product. Every outward payment is reported
under a balance-of-payments category code and measured against the sender's
annual allowance. That is now built, in `packages/domain/src/compliance/
exchange-control.ts`, as a regime keyed by origin country rather than as
South-Africa-shaped code:

| Piece                 | Where                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| The regime, as data   | `exchangeControlFor(country)` in the domain package                                                             |
| Category codes        | `regime.categories` — 416 gift, 417 migrant worker, 418 maintenance, 419 family support, 420 study, 421 medical |
| Allowances            | `DISCRETIONARY` (R1m, no tax clearance) and `INVESTMENT` (R10m, tax clearance required)                         |
| The decision          | `checkDeclaration()` — pure, fifteen tests                                                                      |
| Enforcement           | `ExchangeControlService.assertMayProceed()`, called before a transfer row exists                                |
| The record            | `public.exchange_control_declaration`, one row per transfer                                                     |
| The sender's step     | The declaration card in the send flow                                                                           |
| The Authorised Dealer | `/exchange-control` in the back office — extract, CSV, mark-as-reported                                         |

Four things about it are deliberate and should not be "simplified" later.

**The allowance is personal, and it spans every provider.** Our own tally is a
floor, not a ceiling. The sender declares what they have already used elsewhere
this year, we count it, and the figure the app shows is labelled as what we can
see rather than as what is left. Treating our own total as authoritative would
confidently permit a payment that breaches the regulation.

**A declaration of what was used elsewhere is a running total, not an
increment.** Somebody who says "R200 000 elsewhere" on two transfers has used
R200 000, not R400 000, so `usage()` takes the **maximum** of what has been
declared rather than the sum. Summing would punish an honest sender for
declaring twice, which is the fastest way to teach people to under-declare.

**Only residents are supported.** Temporary residents and non-residents have
different allowances, and guessing which would be worse than refusing: an
unset or non-`RESIDENT` status is a 403, not a default.

**We do not file; the Authorised Dealer does.** The extract joins each
declaration to the sender's name and identity number, in memory, at the moment
it is produced. That join is never persisted, and the console that shows it is
restricted to `COMPLIANCE_OFFICER` — an administrator is deliberately excluded,
because the segregation that keeps them out of compliance decisions should keep
them out of compliance data too. A declaration whose partition holds no identity
is shown as a problem rather than skipped: a file with a silent gap in it is
worse than no file.

What is still outstanding is the licence, not the capability: collecting inside
South Africa needs an Authorised Dealer relationship or an ADLA licence, which
is `ZA_DOMESTIC_COLLECTION` in `LIVE_CORRIDOR_AUTHORISATIONS` and is not held.
Every number in the regime — both allowance ceilings, the adult age, the six
category codes — is marked in the source as a placeholder pending confirmation
by that Authorised Dealer.

## Currencies

| Currency | Decimals | Note                                                               |
| -------- | -------- | ------------------------------------------------------------------ |
| NGN      | 2        |                                                                    |
| GHS      | 2        |                                                                    |
| ZAR      | 2        | Origin and destination. Origin sends are under exchange control    |
| XAF      | **0**    | Central African CFA franc, BEAC. Pegged to the euro                |
| XOF      | **0**    | West African CFA franc, BCEAO. Same peg, therefore at par with XAF |

The CFA francs are the detail most likely to be got wrong. They have **no
subunit**: `minorUnits` counts whole francs, so `200_000n` is two hundred
thousand francs, and a limit copied across from a naira row without dividing by
a hundred is wrong by two orders of magnitude while still looking plausible.

They are also at par with each other, which is a fact about the peg and not a
licence to substitute one for the other. BEAC and BCEAO are separate central
banks; a Benin→Cameroon transfer is a real cross-border conversion that happens
to be 1:1, and the money type refuses to add XAF to XOF.

## The two regulatory classes

**Inbound remittance (RU→).** We collect in Russia through a licensed Russian
partner, and the money arrives as an inbound cross-border remittance, which the
destination partner's own IMTO authorisation covers. Our regulatory weight sits
at the origin, and the open question is who that Russian partner is.

**Intra-African (NG→, GH→, CM→, BJ→).** Both ends are domestic. We take naira
from a person who is _in Nigeria_ and pay cedis to a person who is _in Ghana_.
Collecting from the public inside Nigeria is a CBN-licensed activity in its own
right; so is debiting wallets under the Bank of Ghana's payment-systems regime,
under BEAC/COBAC in Cameroon, and under BCEAO in Benin. None of these is implied
by holding an inbound-remittance arrangement, and **none implies another**.
NG→GH does not authorise GH→NG; a BCEAO approval says nothing about BEAC even
though the currencies are at par.

## How that is enforced

`packages/domain/src/corridors/licensing.ts` names the authorisation each leg
rests on:

| Authorisation            | Meaning                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `RU_COLLECTION_PARTNER`  | A licensed Russian partner collects RUB on our behalf                                                                         |
| `BY_COLLECTION_PARTNER`  | The same, for Belarus                                                                                                         |
| `NG_DOMESTIC_COLLECTION` | CBN authorisation to collect naira from the public in Nigeria                                                                 |
| `GH_DOMESTIC_COLLECTION` | Bank of Ghana authorisation to debit cedi wallets in Ghana                                                                    |
| `CM_DOMESTIC_COLLECTION` | BEAC/COBAC authorisation to debit XAF wallets in Cameroon                                                                     |
| `BJ_DOMESTIC_COLLECTION` | BCEAO authorisation to debit XOF wallets in Benin                                                                             |
| `ZA_DOMESTIC_COLLECTION` | An Authorised Dealer relationship or an ADLA licence, under which rand is collected and outward payments are reported to SARB |
| `NG_PAYOUT_RAIL`         | A licensed rail crediting Nigerian bank accounts                                                                              |
| `GH_PAYOUT_RAIL`         | A licensed rail crediting Ghanaian mobile-money wallets                                                                       |
| `ZA_PAYOUT_RAIL`         | A licensed rail crediting South African bank accounts                                                                         |
| `CM_PAYOUT_RAIL`         | A licensed rail crediting Cameroonian wallets                                                                                 |
| `BJ_PAYOUT_RAIL`         | A licensed rail crediting Beninese wallets                                                                                    |

With `LIVE_FUNDS_ENABLED=false` the check is a no-op: a simulated corridor moves
no money and needs no licence, which is what lets every direction be built and
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

Collection differs most between markets, and it is not symmetrical. Two shapes:

**Push — the sender originates the payment.**

- **Russia** — SBP link, QR, card, or a virtual account.
- **Nigeria** — a dedicated ten-digit NUBAN. Card is deliberately absent: a
  card-funded remittance is a chargeback exposure we are not taking on.

**Pull — we request a debit and the holder approves it.**

- **Ghana, Cameroon, Benin** — mobile money. We ask the network to debit the
  sender's own wallet; they approve a prompt on their handset. This is the only
  shape that needs the sender's own account details, so the wallet is captured
  at verification, stored in that country's partition, and read into the
  outbound provider call at the moment of collection — never written to the
  neutral tier. Approval prompts get dropped often enough that the instructions
  carry the operator's USSD short code as a fallback.

  **Confirm those short codes with each operator before a pilot.** They change,
  and a wrong one turns a recoverable stall into a support call.

A transfer whose sender has no verified wallet on file fails with
`NO_COLLECTION_WALLET` rather than sitting in `AWAITING_PAYIN` forever.

Payout: Nigeria and South Africa credit bank accounts; Ghana, Cameroon and Benin
credit wallets. A South African universal branch code is six digits and
identifies the bank rather than a branch, which is why it is validated
separately from a three-digit Nigerian bank code.

Networks are country-scoped. MTN Ghana and MTN Cameroon are separate licensees
on separate switches, so `TELECEL` offered for a Beninese wallet is rejected at
the API boundary rather than accepted and never delivered.

## Residency

A sender must be where the collection happens. Someone in Lagos cannot hand over
rubles, so RU→NG is neither offered to them nor accepted from them —
`CORRIDOR_RESIDENCY_MISMATCH`. Registration offers every country the domain
knows, read from `COUNTRY_CODES` rather than from a list kept in the form. It
used to be a hand-written union, which is how South Africa stayed off the
registration screen for a while after `partition_za` gained its sender store and
the whole declaration flow was built behind it.

Appearing in that list is not permission to send. The licence gate decides that,
and today it refuses all 210 corridors — thirty distinct authorisations are
required and none is held.

Personal data follows the same line. **Sixteen partitions**, deliberately
asymmetric:

| Partition              | Senders | Recipients | Identity anchor held     |
| ---------------------- | ------- | ---------- | ------------------------ |
| `partition_ru`         | ✓       | —          | Passport, migration card |
| `partition_ng`         | ✓       | ✓          | BVN                      |
| `partition_gh`         | ✓       | ✓          | Ghana Card               |
| `partition_za`         | ✓       | ✓          | ID number, tax reference |
| `partition_cm`         | ✓       | ✓          | CNI number               |
| `partition_bj`         | ✓       | ✓          | NPI number               |
| `partition_cd` … `_sn` | ✓       | ✓          | National identity number |

The last row is ten schemas — CD, CG, UG, KE, TZ, ZM, GM, NE, ML, SN — and they
share one repository, `partitions/standard`. What makes them "standard" is
narrow: identity anchors on exactly one national identity number, and both legs
run over mobile money. The six above them each carry a field nobody else has,
which is why they stay hand-written.

**Sharing a repository is not sharing a jurisdiction.** The schemas stay
separate and in production stay separate instances; only the delegate lookup is
common. That lookup is the whole risk of the arrangement — a transposed pair
moves personal data across a border without breaking anything or throwing — so
it is asserted per country, in both directions, against a hand-written
expectation rather than a derived one, and the two Congos get an assertion of
their own.

Belarus is the one place where partition and country differ: BY senders live in
the RU store under the same regime. Nothing else falls through to a default —
the demo seed used to, and quietly wrote ten countries' senders into
`partition_ru`, which surfaced as "no collection wallet on file" at the far end
rather than as a residency breach where it happened.

Recipients are filed by **country**, not by payout method. Dispatching on method
was sufficient while Nigeria was the only bank destination; with South Africa
also crediting bank accounts it would have filed a Johannesburg account in the
Nigerian store — a residency breach no happy-path test would notice.

Screening is unchanged and unbypassable in every direction. `screeningSubject`
returns null for a residency with no store behind it, and the compliance gate
treats an absent subject as unscreenable.

## Rates

None of these pairs has a deep direct market; every one crosses the dollar in
practice. The feed therefore holds a **dollar anchor per currency** and derives
every ordered pair from it, rather than listing them by hand. That mattered at
twenty pairs and it is decisive at this size: eleven mesh currencies is 110
ordered pairs, and 110 hand-written rates would be 110 chances for one to
disagree with its own reciprocal by more than a spread — discovered at a
treasury reconciliation, months later.

Crossing once, at the feed, keeps each quote to a single rounding step and a
single staleness window, and avoids the ledger holding a USD leg for a transfer
that never touches a dollar. XAF:XOF derives to exactly `1.000000`, which is the
peg showing through.

A currency against **itself** is not in the feed and never will be. The
fourteen same-currency corridors take the identity rate directly from
`rateForQuoting`, which returns exactly one without a lookup: it cannot go
stale, it is attributed to no source, and it is never written to
`rate_observation` where something downstream could mistake it for a market
rate. Before those corridors existed, NE→ML halted with "no rate has ever been
observed for XOF/XOF" — the feed correctly reporting that nobody had ever asked
it for a rate that does not exist.

Rates are ingested at boot as well as every minute. Without the boot ingest
there is a gap of up to a minute after each deploy where the newest observation
is whatever the seed wrote — often already stale — and every quote is refused
with `RATE_UNAVAILABLE`. Halting on stale rates is correct; being in that state
because the process just started is not.

Where the numbers should come from once the simulated feed is replaced, what a
real feed has to satisfy, and why a model may flag an anomalous rate but must
never predict the one a customer is charged, is in
[`FX_RATES.md`](./FX_RATES.md).

## Limits

Every send currency has tier rows, anchored to its local regime rather than
converted from the ruble rows: NGN follows the CBN's three-tier KYC shape, GHS
the Bank of Ghana's mobile-money tiers, XAF and XOF the BEAC and BCEAO
electronic-money tiers. The numbers are placeholders the compliance officer
owns. What is not a placeholder is that the rows exist — `checkLimits` refuses a
currency it has no row for, so a currency without rows cannot be sent at all.
CDF, UGX, KES, TZS, ZMW and GMD gained rows with the Paycrest markets — UGX in
whole shillings, between two neighbours whose shillings have cents.
ZAR gained rows when South Africa became an origin. A rand sender is bounded
twice, by their KYC tier and by their exchange-control allowance, and the
tighter of the two wins; they answer different questions and neither substitutes
for the other.

## The ledger

Float, fee revenue, FX P&L, suspense and settlement receivable exist in all
seven ledger currencies. The float account type used to be `FLOAT_RUB`,
`FLOAT_NGN`, `FLOAT_GHS` — the currency baked into the type name beside a
currency column holding the same fact — which cost a new enum member and a new
branch in two helpers per country. It is now a single `FLOAT` type keyed by
currency, migrated in place so existing balances and entries were untouched.

## Adding the next one

1. A currency in the registry, with the right exponent, and a dollar anchor.
2. The country in `CountryCode` and `SEND_CURRENCY`; tier limit rows.
3. The currency in `LEDGER_CURRENCIES` — accounts are generated from it.
4. A partition schema, a migration, and sender/recipient repositories.
5. Collection and payout rails, plus the market profile (institutions, number
   format, switch name).
6. Origin and destination lists in the seed and `app.module.ts`.
7. Authorisation names in `licensing.ts`, and the honest answer to what they
   require.

Steps 1–6 take a day. Step 7 takes months, and for a country with exchange
controls it is not only paperwork — as South Africa shows, it can be a feature.
