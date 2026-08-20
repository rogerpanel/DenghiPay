# Corridors

Twenty-four corridors exist; twenty-two are enabled. They are not all the same
kind of thing, and the transfer code cannot tell them apart — that is the point
of corridors being data — so the difference is written down here and enforced by
a check that runs on every corridor read.

## The map

**Origins (5).** Nigeria, Ghana, South Africa, Cameroon, Benin — plus Russia on
the inbound corridors. **Destinations (5).** The same five.

| ↓ from / to → | NG  | GH  | ZA  | CM  | BJ  |
| ------------- | --- | --- | --- | --- | --- |
| **NG**        | —   | ✓   | ✓   | ✓   | ✓   |
| **GH**        | ✓   | —   | ✓   | ✓   | ✓   |
| **ZA**        | ✓†  | ✓†  | —   | ✓†  | ✓†  |
| **CM**        | ✓   | ✓   | ✓   | —   | ✓   |
| **BJ**        | ✓   | ✓   | ✓   | ✓   | —   |

† Subject to exchange control — see below.

Twenty intra-African corridors, plus RU→NG and RU→GH. BY→NG and BY→GH exist as
rows and are disabled, awaiting a Belarusian collection partner.

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
`CORRIDOR_RESIDENCY_MISMATCH`. Registration offers RU, BY, NG, GH, ZA, CM and
BJ — ZA joined in 4.3c along with `partition_za`'s sender store, which holds the
identity number and exchange-control status the declaration needs.

Personal data follows the same line. Six partitions, deliberately asymmetric:

| Partition      | Senders | Recipients | Identifier held          |
| -------------- | ------- | ---------- | ------------------------ |
| `partition_ru` | ✓       | —          | Passport, migration card |
| `partition_ng` | ✓       | ✓          | BVN                      |
| `partition_gh` | ✓       | ✓          | Ghana Card               |
| `partition_za` | —       | ✓          | —                        |
| `partition_cm` | ✓       | ✓          | CNI number               |
| `partition_bj` | ✓       | ✓          | NPI number               |

Belarus is the one place where partition and country differ: BY senders live in
the RU store under the same regime.

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
all twenty ordered pairs from it, rather than listing them by hand — twenty
hand-written rates would be twenty chances for one to disagree with its own
reciprocal by more than a spread, discovered at a treasury reconciliation.

Crossing once, at the feed, keeps each quote to a single rounding step and a
single staleness window, and avoids the ledger holding a USD leg for a transfer
that never touches a dollar. XAF:XOF derives to exactly `1.000000`, which is the
peg showing through.

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
