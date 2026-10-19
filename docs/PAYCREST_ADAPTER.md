# Paycrest adapter

BUILD_PLAN step **7.3a**. What exists, how to use the key on the server today,
and what still stands between this adapter and a first live payout.

> **Paycrest has no sandbox.** Every API key it issues is a live key on real
> networks. Nothing in this document creates an order, and nothing should until
> the funding decision in §4 is made.

---

## 1 · What is built

`packages/adapters/src/paycrest/` implements the existing `PayoutProvider` port
against Paycrest's **v2 Sender API** (`https://api.paycrest.io/v2`), written from
Paycrest's published OpenAPI document and Sender API guide
(github.com/paycrest/docs, `openapi-v2.yaml`).

| Port operation     | Paycrest call                               | Notes                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveRecipient` | `POST /verify-account`                      | Returns the name the institution holds. Paycrest answers `"OK"` with no name for some rails (KES M-Pesa); that is reported as UNSUPPORTED, never as a guessed name.                                       |
| `initiatePayout`   | `GET /sender/orders`, `POST /sender/orders` | Looks for an existing order with our idempotency key first, then creates one **in the recipient's currency** (`amountIn: "fiat"`), then hands the deposit to the funder. Returns an acknowledgement only. |
| `getStatus`        | `GET /sender/orders/{id}`                   | The only place an outcome comes from. Mapping in §5.                                                                                                                                                      |
| `parseCallback`    | webhook                                     | Verifies `X-Paycrest-Signature`, returns a trigger to poll. Never an outcome.                                                                                                                             |
| `fetchStatement`   | `GET /sender/orders?direction=offramp`      | Orders that reached the recipient in the window, with the fiat recomputed from token × rate, rounded down.                                                                                                |

Countries: **Nigeria (NGN), Kenya (KES), Uganda (UGX), Tanzania (TZS)** — the
four Agreement No. 04 is accepted against. UGX has no minor unit; the adapter
sends USh 1,000,000 as `"1000000"`, and a test pins it.

Money safety, as the guardrails require:

- **No floating point.** v2 sends numbers as strings; the JSON reader quotes any
  number that arrives bare before parsing, so no amount is ever a JavaScript
  `number`. Amounts become integer minor units or are rejected.
- **Acknowledgement is not settlement.** `fulfilled` — Paycrest's provider
  saying it paid — is still PENDING. SETTLED starts at `validated`.
- **A transfer finishes without webhooks.** Polling `getStatus` is enough;
  webhooks only make it faster.
- **Nothing logged.** The client never logs a request or response; both carry
  account numbers and names.

API wiring: `PAYCREST_ENABLED=true` registers the adapter (§3). The callback
endpoint is `POST /webhooks/paycrest/callback`.

## 2 · Using the key on the server now

Put the credentials in the server's `.env`. It is gitignored and mode 600, and
it is the only place they go: never the repository, a chat or a ticket.

```bash
cd ~/MoraPay
nano .env
#   PAYCREST_API_KEY=<API key>
#   PAYCREST_API_SECRET=<API secret>
#   PAYCREST_ENABLED=false          ← leave false for now
```

Then run the **read-only probe** inside the API container, which already loads
`.env`:

```bash
docker compose -f infra/compose/server.yml exec api \
  node packages/adapters/dist/paycrest/probe.js
```

It never creates an order. For each of the four countries it prints:

- whether the key can see the currency;
- Paycrest's decimal places next to ours, with **MISMATCH** shown if they differ (stop if one appears);
- the live off-ramp rate for 10 USDT;
- every institution code.

At the end it prints a skeleton for `PAYCREST_INSTITUTIONS`. To check one
account name:

```bash
docker compose -f infra/compose/server.yml exec api \
  node packages/adapters/dist/paycrest/probe.js verify GTBINGLA 0123456789
```

The resolved name prints to your terminal only. Do not paste it anywhere.

### Filling `PAYCREST_INSTITUTIONS`

Paycrest names a bank or wallet by its own code (a SWIFT code, or one ending in
`PC`, e.g. `SAFAKEPC` for Safaricom M-Pesa). MoraPay stores the Nigerian NIP
bank code and a network name. The table maps one to the other. It is one line of
JSON in `.env`:

```
PAYCREST_INSTITUTIONS={"bank":{"NG":{"058":"GTBINGLA","011":"FBNINGLA"}},"mobileMoney":{"KE":{"MPESA":"SAFAKEPC"}}}
```

Take every right-hand value from the probe's output, never from memory. A
recipient whose bank or network is missing is refused as UNSUPPORTED before
anything is sent. The API checks the table's shape at boot, even with the flag
off.

## 3 · What `PAYCREST_ENABLED=true` does today

| Setting                   | Required when enabled | Default                       |
| ------------------------- | --------------------- | ----------------------------- |
| `PAYCREST_API_KEY`        | yes                   | —                             |
| `PAYCREST_API_SECRET`     | yes                   | —                             |
| `PAYCREST_REFUND_ADDRESS` | yes                   | — (our wallet on the network) |
| `PAYCREST_TOKEN`          | no                    | `USDT` (or `USDC`)            |
| `PAYCREST_NETWORK`        | no                    | `base`                        |
| `PAYCREST_BASE_URL`       | no                    | `https://api.paycrest.io/v2`  |
| `PAYCREST_INSTITUTIONS`   | no                    | `{}`                          |

The API refuses to boot with the flag on and a key, secret or refund address
missing. With them set, Paycrest is **registered but disabled**:

- It appears in `GET /simulator/scenarios` as `paycrest DISABLED`, and its
  webhook endpoint verifies and records callbacks.
- It carries **no payouts**. The simulators keep serving Nigeria, Kenya, Uganda
  and Tanzania.

The reason is §4. This was verified on a running API: signed callbacks were
accepted, a replay was deduplicated, forged and unsigned ones were refused with
401, and the registry showed Paycrest disabled.

## 4 · The decision that unlocks payouts: who funds an order

A Paycrest off-ramp order is **paid in stablecoin**. Creating one returns a
receive address and an `amountToTransfer`, which is the order amount plus fees.
Paycrest pays the recipient in fiat only after that much USDT arrives at that
address before `validUntil`. There is no "pay in naira" for this direction.

Whoever sends that USDT therefore holds a virtual asset, however briefly. That
is **Model B** in [`DESIGN_STABLECOIN_RAIL.md`](DESIGN_STABLECOIN_RAIL.md), with
its VASP registration and Travel Rule questions. It is a regulatory decision,
not an engineering one, so the adapter does not make it:

- Funding is a port, `PaycrestOrderFunder`. The repository ships only
  `refusingFunder`.
- The adapter refuses to create an order it cannot fund.
- The API keeps Paycrest out of routing while the funder refuses
  (`canFundPayouts`).

A real funder needs:

1. A wallet holding USDT on the chosen network.
2. Code that sends exactly `amountToTransfer`, with `memo` when Paycrest gives
   one, before `validUntil`.
3. Screening of the receive address.
4. The ledger treatment in `DESIGN_STABLECOIN_RAIL.md` §4.

It also needs counsel's answer under open item B2. That work is a phase of its
own, not part of this adapter.

## 5 · Status mapping

From Paycrest's transaction lifecycle:
`initiated → deposited → pending → fulfilling → validated → settling → settled`,
with `refunding → refunded` and `initiated → expired` as the failure paths.

| Paycrest                                                       | MoraPay   | Why                                                                                  |
| -------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `validated`, `settling`, `settled`                             | SETTLED   | `validated` is Paycrest's "provider confirmed successful fiat delivery"              |
| `initiated`, `deposited`, `pending`, `fulfilling`, `fulfilled` | PENDING   | Nothing has reached the recipient that Paycrest has confirmed                        |
| `refunding`                                                    | PENDING   | The payout failed, but the refund has not landed; we refund the sender on `refunded` |
| `expired`                                                      | FAILED    | No deposit arrived before `validUntil`                                               |
| `refunded`                                                     | FAILED    | Deposit returned to our refund address                                               |
| `cancelled`                                                    | FAILED    |                                                                                      |
| anything else                                                  | **error** | Surfaced as a contract violation, never guessed                                      |

## 6 · To confirm on the first live order

Each item is from the published documentation, but was not observed on the wire
because this environment cannot reach Paycrest's API:

- [ ] `GET /sender/orders/{id}` returns `amount` in **token** units even when the order was created with `amountIn: "fiat"`. `fetchStatement` relies on this: `amount × rate` should equal the fiat we asked for, to within one minor unit.
- [ ] `reference` is stored and returned on list items. The retry check depends on it, because Paycrest documents no rule that refuses a duplicate reference.
- [ ] Webhook events arrive as `payment_order.<status>` with `data.id` and `data.status`. The dedup key is `<order id>:<event>`.
- [ ] Decimal places per currency match ours (the probe checks this): NGN, KES and TZS have 2; UGX has 0.
- [ ] Mobile numbers: we send international format without `+` (e.g. `2547…`). Paycrest says it normalises local and E.164 numbers server-side, so check one with the probe's `verify`.
- [ ] The webhook URL is registered in the Paycrest dashboard as `<API public URL>/webhooks/paycrest/callback`.

## 7 · What remains for 7.3a's definition of done

The plan's DoD was "sandbox payout confirmed and reconciled". With no sandbox,
it becomes **one live nominal payout per country, confirmed and reconciled**.
That needs, in order:

1. The funding decision (§4) and a funder.
2. The Company's own Paycrest key, issued after the company check (KYB). Isaac's
   temporary key belongs to his account and should not move the Company's money.
3. The institution table, filled from the probe.
4. Counsel's sign-off under B2.

Live funds on MoraPay stay off throughout. `LIVE_FUNDS_ENABLED` and the
corridor licence gate are unaffected by anything here.
