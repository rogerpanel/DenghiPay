# Stablecoin rail — what it actually takes

Can this application move naira to XAF through USDT, and back again?

**Not today.** But the answer is more useful than that, because the question
splits into two very different products and only one of them is an adapter.

---

## 1 · What already exists

Verified in the code rather than remembered:

| Piece                           | State                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USDT` as a currency            | Registered, **exponent 6**, so a six-decimal token cannot be confused with a two-decimal fiat                                                                               |
| `RUB:USDT`, `USDT:NGN` rates    | Present in the simulated feed, from the original deck's numbers                                                                                                             |
| On-chain counterparty screening | The screening port already takes an `accountIdentifier` "for treasury counterparties: the account or on-chain address (G4)", and the mock list holds a sanctioned `0x…DEAD` |
| Integer minor units at the edge | `normaliseProviderAmount` parses provider amounts into integers or rejects them (guardrail 12)                                                                              |

And what does **not** exist:

| Piece                   | State                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Corridors touching USDT | **Zero.** `SELECT count(*) FROM corridor WHERE source_currency='USDT' OR destination_currency='USDT'` → 0  |
| A USDT ledger position  | USDT is **not** in `LEDGER_CURRENCIES`, so there is no USDT float and the ledger cannot record holding any |
| Chain integration       | Nothing: no addresses stored, no transaction hashes, no confirmation depth, no reorg handling, no gas      |
| Travel Rule             | Not implemented                                                                                            |
| `TREASURY_USD`          | Fiat USD. Not a stablecoin, despite the name reading that way at a glance                                  |

So the money primitives are already correct for it — which is the expensive half
to get right — and none of the plumbing is there.

---

## 2 · The question that decides everything

A transfer in this system carries **exactly two currencies**: `sendCurrency` and
`recipientCurrency`. There is no intermediate leg, by design. So a naira-to-XAF
transfer settled through USDT has to resolve one of two ways, and they are
different businesses.

### Model A — the stablecoin is the provider's problem

Paycrest takes naira and delivers XAF. Whatever they do in the middle is theirs.
We implement the **existing** `PayoutProvider` port — the same five methods every
other rail reduces to — and USDT never appears in our ledger, our corridors or
our quotes.

- The transfer stays `NG-CM`. The sender sees naira in and francs out.
- One rate, one rounding step, one staleness window — exactly as now.
- No USDT float, so no inventory and no peg exposure.
- **Work: one adapter.** Days, once sandbox credentials exist.

What it still needs from counsel: we are instructing a payment that is settled in
a virtual asset, and the entity that hands over the francs is a provision node we
do not onboard. That is the question already recorded as the blocker in
`DECISION_STABLECOIN_ROUTE.md` §1.2 — it does not disappear in Model A, it just
stops being an engineering problem.

### Model B — we hold the USDT

We buy USDT with naira, hold it, then sell it for XAF. Now it is our position.

- USDT joins `LEDGER_CURRENCIES` and gets a float, a fee-revenue account, an FX
  P&L account, a suspense account and a settlement receivable — the same five
  every currency gets.
- **Two rate crossings, two rounding steps, two spreads.** This is the design
  `CORRIDORS.md` deliberately avoided: the feed crosses the dollar once so that a
  quote has a single rounding step and the ledger never holds a USD leg for a
  transfer that never touches a dollar. Model B reintroduces exactly that, with a
  token in place of the dollar.
- **Inventory and peg risk.** We are long USDT between the legs. Tether is not
  a currency board; "one dollar" is an issuer's representation, not an identity.
  The FX P&L account would start carrying something real rather than rounding.
- **VASP registration and the FATF Travel Rule** (Recommendation 16): originator
  and beneficiary information must travel with the transfer above threshold. That
  is an obligation on us, not on the protocol.
- On-chain screening becomes mandatory rather than latent: every address we send
  to or receive from, screened before it moves, under guardrail G3 and G4.
- **Work: a phase, plus a second regulatory category.** Not a rewrite — the port
  pattern holds — but not an adapter either.

**Ask Paycrest which one they are selling.** "Do you take my naira and deliver
XAF, or do I buy USDT from you and then sell it?" It is one sentence and it
decides whether this is days or a quarter.

---

## 3 · What changed now that Russia is out

Worth saying plainly, because it inverts the original argument.

The stablecoin route was attractive largely because it **routed around a
sanctioned banking corridor**. No correspondent bank wanted Russia-origin flows,
so a peer-to-peer network that never touched one was not an optimisation — it was
the only path.

In SWIFT-enabled markets that reason is gone. A licensed correspondent is
obtainable in the fifteen African countries; what stands in the way is thirty
authorisations (`OPEN_ITEMS.md` B9), not the absence of a rail. So stablecoins
become a **cost and speed choice**, competing against a boring licensed rail, and
they carry a VASP registration and Travel Rule obligations that the boring rail
does not.

That does not make them wrong. Settlement in minutes rather than T+1, and reach
into countries where we will never hold a licence, are real advantages. It makes
them a **second** rail to add once a first one works, which is the sequence
`DECISION_STABLECOIN_ROUTE.md` §3 already recommends: Fincra first because it
moves real money soonest with no new regulatory category.

---

## 4 · If we build it anyway

Which is a legitimate choice — the licence gate refuses every corridor until
somebody declares the authorisations held, so built-and-switched-off costs
nothing but engineering time, and having it ready changes a partner conversation.

The order that keeps each step independently verifiable:

1. **A port.** `StablecoinProvider` beside the existing two. Its shape follows
   from what a chain actually offers: quote a swap, submit it, read its status,
   read a confirmation depth. **Acknowledgement is not settlement** applies with
   more force here than anywhere — a submitted transaction is not a confirmed
   one, and a confirmed one can still be reorganised out.
2. **A simulator**, with the scenarios that actually happen: pending for many
   blocks, confirmed then reorganised, partial fill against a thin pool,
   slippage beyond tolerance, a sanctioned counterparty address.
3. **USDT in the ledger** with its float, and the two-leg posting. This is the
   step where the balance sheet starts telling the truth about a position we
   hold, and where `FX_PNL` starts earning its name.
4. **On-chain screening** wired to the existing port's `accountIdentifier`,
   refusing before anything moves.
5. **The saga**, handling a transfer whose middle is a swap — including the case
   the fiat rails never have: the first leg settled and the second cannot, so we
   are holding a token we did not want.
6. **Travel Rule** data on the originator and beneficiary, which is a contracts
   and compliance change, not a chain one.

Step 5 is the one to think hardest about. Every existing failure path ends either
with the recipient paid or the sender refunded in the currency they paid in.
"Holding USDT we cannot sell" is a third outcome the state machine has no state
for, and inventing one is the real design work in this document.

---

## 5 · Recommendation

**Model A, and ask Paycrest to confirm it is Model A.** It reaches the same
corridors, needs one adapter behind a port that already exists, keeps a single
rounding step, and leaves us with no token inventory and no VASP question of our
own. The provision-node counterparty question still goes to counsel either way.

**Model B only if Paycrest's answer forces it**, or once there is a commercial
reason worth a second regulated product — and then as a phase with its own
numbered steps, not folded into a corridor expansion.

Either way: the engineering is not what is between this codebase and a first live
transfer. Thirty authorisations are.
