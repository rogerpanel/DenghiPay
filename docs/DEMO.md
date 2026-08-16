# Demonstration walkthrough

A scripted twenty-minute run through the platform in a browser, for showing to
the CEO. Everything below works today against simulators; no partner
credentials, no live funds, no real money.

## The two things that say "demo", and how to present them

Everything in the application is the real product. Two things on screen are
not, and rather than hiding them, point at them — they are the answer to the
question the CEO is actually asking, which is _what is left_.

**The orange banner: "Demonstration environment — no real money moves."**

Say: _"That banner is not decoration and I did not put it there for today. It
is driven by a single flag, `LIVE_FUNDS_ENABLED`, which is false and cannot be
turned on by a deployment, a configuration file or an engineer in a hurry. It
is flipped once, by a person, in production, after the legal opinions and the
partner agreements exist. When that happens the banner removes itself — nobody
has to remember."_

It is worth being seen. A platform that cannot tell you whether it is handling
real money is a platform nobody should trust with any.

**The "Simulate the payment" button on the transfer screen.**

Say: _"This is where the Russian pay-in partner plugs in. Today the sender sees
real payment instructions — an SBP deep link, or a QR code, or an account and a
reference — and this button stands in for the bank telling us the money
arrived. It is the one place in the sender's journey that is not the finished
thing, and the API refuses that endpoint outright once live funds are enabled."_

Then the useful follow-up: everything downstream of that button — screening,
the ledger postings, settlement, the payout, the poll schedule, the refund on
failure — is finished and is what you are about to watch.

Those two are the whole gap on the sender's side. Not a list of unbuilt
features: two named integrations, both blocked on commercial agreements rather
than on engineering (`docs/OPEN_ITEMS.md` B1 and B3).

---

## Before you start

```bash
pnpm install
cp .env.example .env
pnpm demo:reset        # first run, and before the meeting — see below
```

`demo:reset` and `demo:up` do the same thing, in this order: start PostgreSQL
and Redis, migrate, seed, build, serve the production build of both front ends,
and then check the three things that decide whether a demonstration goes well —
that every service answers, that each page's stylesheet actually loads, and
that the ledger reports `balanced: true`. Either exits non-zero and says why if
a check fails, so a problem surfaces now rather than on the screen.
`pnpm demo:down` stops everything.

**Use `demo:reset` before the meeting; `demo:up` for everything else.** The
difference is that `reset` drops the database first. It matters because sending
limits are aggregated over real transfer history, and that history persists:
`chidi@demo.morapay.local` is tier 2, capped at ₽ 300 000,00 a day, so after
three rehearsals of the ₽ 100 000,00 main thread the fourth run is refused with
_"above your tier 2 limit"_ partway through. That is the limits engine working
exactly as designed, at the worst possible moment. Starting from a clean
database is the only way to know where you are.

> `demo:reset` destroys all local data — transfers, ledger, everything. It is
> for the local demonstration database and nothing else. `prisma migrate reset`
> will ask an AI agent for explicit human consent before running, which is
> deliberate; run it yourself.

Run one of them fresh before the meeting even if the stack is already up.
Rebuilding underneath a running server leaves it serving HTML that points at
stylesheet chunks that no longer exist — the pages still return 200 and render
as unstyled text. Both scripts rebuild and restart in the right order, free the
ports of anything left over from an earlier session, confirm the process they
started is the one answering, and check the stylesheets. Each of those exists
because it went wrong once.

> `pnpm dev` is the development alternative — same URLs, hot reload, slower
> pages and a development overlay. Use it while working, not while presenting.

**To put it in front of other people** — testers on their own phones, rather
than a walkthrough on your screen — use `pnpm demo:preview` and see
[`docs/PREVIEW.md`](PREVIEW.md). It builds the front ends to call the API
through their own origin, which is what lets a device other than this one use
the application at all.

| Screen                    | URL                                    |
| ------------------------- | -------------------------------------- |
| Sender app                | http://localhost:3000                  |
| Back office               | http://localhost:3001                  |
| API documentation         | http://localhost:4000/docs             |
| Ledger invariant          | http://localhost:4000/health/ledger    |
| Mail outbox (development) | http://localhost:4000/simulator/outbox |

**Accounts.** Sender password `morapay-demo-2026`, staff password
`morapay-local-staff-2026`.

| Account                      | What it demonstrates                                     |
| ---------------------------- | -------------------------------------------------------- |
| `chidi@demo.morapay.local`   | Nigerian student in Moscow, KYC tier 2 — the main thread |
| `ama@demo.morapay.local`     | Tier 0 — the limit block and the upgrade prompt          |
| `blocked@demo.morapay.local` | Matches the mock sanctions list — guardrail G3           |
| `folake@demo.morapay.local`  | Lives in Lagos — sends naira to Ghana on NG→GH           |
| `kofi@demo.morapay.local`    | Lives in Accra — sends cedis to Nigeria on GH→NG         |
| `compliance@morapay.local`   | Compliance queue                                         |
| `treasury@morapay.local`     | Requests prefunding                                      |
| `treasury2@morapay.local`    | Approves it — the second pair of eyes                    |
| `support@morapay.local`      | Operations and refunds                                   |
| `admin@morapay.local`        | Reporting and the audit chain                            |

---

## Act 1 — A transfer that works (6 minutes)

**Sign in** at http://localhost:3000 as `chidi@demo.morapay.local`.

1. **Home.** Corridors, their fees and their margins, and recent transfers.
   Point out that the fee and the margin are published before anyone starts.

2. **Send → amount.** 100 000 ₽ on RU→NG. Press _Continue_.

   The quote appears with a live countdown. **This is the screen to linger on.**
   It shows, separately:

   | Line                                      | Roughly          |
   | ----------------------------------------- | ---------------- |
   | Amount to convert                         | ₽ 100 000.00     |
   | Our fee                                   | ₽ 150.00         |
   | Exchange-rate margin (1.50%)              | ₽ 1 500.00       |
   | **Total you pay us**                      | **₽ 1 650.00**   |
   | Mid-market rate                           | 18.91            |
   | Your rate                                 | 18.63            |
   | At the mid-market rate they would receive | ₦ 1 891 230.00   |
   | **Total to pay**                          | **₽ 100 150.00** |

   The reference deck this was designed against hides the margin inside the
   rate — "you set your own rates". We decompose it. A sender can work out
   exactly what we earn, which is the product decision worth defending in the
   room.

3. **Recipient.** Pick _Mum — Lagos_, or type account `0123456789` at Guaranty
   Trust Bank and press _Check the account_.

   The bank answers with the name it holds, and the sender confirms **that**
   name — not the one they typed. Money sent to a mistyped account number
   cannot be recovered once it settles; this one screen prevents the most
   common support case in this corridor.

4. **Review → Confirm and pay.** The transfer moves to _Waiting for your
   payment_ and shows SBP instructions.

5. **Press _Simulate the payment_.** Then watch the status without touching
   anything: payment received → converting → sending to your recipient →
   completed, with a timeline underneath.

   Worth saying out loud: the app is not being told what happened by the
   payment provider. It is **asking**. A callback only makes us ask sooner.

6. **Open http://localhost:4000/health/ledger.**

   ```json
   { "balanced": true, "byCurrency": { "RUB": "0", "NGN": "0" }, "driftingAccounts": 0 }
   ```

   Debits equal credits in every currency, across every account. The database
   itself refuses to commit a transaction where they do not.

---

## Act 2 — The failures, on purpose (5 minutes)

The account number selects the failure. The same numbers work every time.

| Account ending | What happens                                                   |
| -------------- | -------------------------------------------------------------- |
| `…0000`        | Name enquiry finds nothing — stopped before the sender commits |
| `…1111`        | Acknowledged, then failed — the transfer refunds itself        |
| `…2222`        | Pending across three polls, then settles                       |
| `…4444`        | No callback ever arrives; polling completes it anyway          |
| `…6666`        | Account closed — a permanent failure                           |

**Show `…1111`.** Send to _Test — acknowledged then failed_. The provider
accepts the payout and reports success on submission — and then the status poll
says it failed.

That pair is a real defect in a real provider's specification: `Status:
"Success"` alongside `Trans_Status: "Failed"`, in the same response body. An
integration that reads the first field credits a customer whose payment failed.

In this codebase an acknowledgement and an outcome are **different types**. The
function that posts to the ledger accepts only an outcome, so the bug is a
compile error, not a production incident. Watch the transfer refund itself —
including our fee. We do not keep a fee for a transfer we did not deliver.

**Then show `…0000`**: name enquiry returns nothing and the flow stops before
any money is committed.

---

## Act 2b — The other side of the map (4 minutes)

Everything so far has been money leaving Russia. This act is the second product:
transfers **between** African countries, both directions, with nothing Russian in
them at all.

1. Sign out and sign in as `folake@demo.morapay.local` — a Lagos resident.

   The corridor list is different. She is not offered RU→NG, because she has no
   way to hand over rubles; she is offered **NG→GH** and nothing else. This is
   worth pausing on: a sender is only shown corridors that start where they
   live, and the API refuses the others even if the request is hand-crafted.

2. Send ₦50 000 to _Sister — Kumasi_.

   The pay-in screen shows a **ten-digit NUBAN** to transfer to, not an SBP
   link. Nigeria collects by push to a dedicated account; the sender moves the
   money from their own bank.

3. Let it complete, then sign in as `kofi@demo.morapay.local` — Accra — and send
   GH₵500 to _Brother — Abuja_.

   The pay-in screen is different again: **no account to pay into**. Ghana
   collects by debiting the sender's own wallet, so the instruction is "check
   your phone and approve the request", with the operator's USSD short code
   underneath for when the prompt does not arrive. Point out that the wallet
   shown is _theirs_ — we are not revealing anything, we are confirming which
   account is about to be debited.

4. Back office → _Operations_ → the ledger view for either transfer. The
   postings are the same shape as the ruble ones, in naira and cedis.

**The question this act invites, and the honest answer.** Somebody will ask
whether this doubles the business. It roughly doubles the _addressable_ flow and
it more than doubles the regulatory surface: collecting naira inside Nigeria and
debiting wallets inside Ghana are licensed activities in their own right, and
neither is implied by the inbound-remittance arrangements the ruble corridors
need. NG→GH does not authorise GH→NG either — they are two licences, not one.

That is why the code carries a licence gate rather than a switch. With live funds
on, a corridor is only reachable if the specific authorisations behind it are
named in configuration; there is no wildcard and no override. Today none are
named, which is correct, and the demonstration works anyway because nothing here
moves real money. `docs/CORRIDORS.md` has the detail, and it is tracked as
OPEN_ITEMS B6.

---

## Act 3 — Compliance is not optional (4 minutes)

1. Sign out. Sign in as `blocked@demo.morapay.local` and send anything.

   It reaches **Under review** and stops. That sender's name matches an entry
   on the mock sanctions list.

2. Open the back office at http://localhost:3001 as `compliance@morapay.local`.

   The case is in the queue with the evidence: which list, what score, which
   programme. Type a reason — the field is mandatory — and clear or reject it.

   Two things to point out:

   - Clearing the case **re-screens** and writes a fresh record. The officer
     cleared a case; they did not clear the sanctions list.
   - Sign in as `admin@morapay.local` and try the same thing. An administrator
     **cannot** decide a compliance case. Segregation of duties survives
     someone being made an administrator.

3. In _Operations_, search the completed transfer and open it. The ledger
   postings are shown next to it — every debit and credit, in order. When
   someone asks "where is the money", this is the answer.

---

## Act 4 — Treasury and four eyes (3 minutes)

1. Sign in as `treasury@morapay.local` → _Treasury_. Float positions per
   currency, with low-watermark alerting, and open FX exposure.

2. Request prefunding: NGN, any amount, a reason.

3. The request appears with **"You requested this. Four-eyes: someone else has
   to approve it."** The approve button is not there.

4. Sign in as `treasury2@morapay.local` and approve it. Now it executes and
   posts to the ledger.

   The disabled button is a courtesy. The control is enforced three times: in
   the service, in the ledger posting builder, and by a `CHECK` constraint in
   the database. Each has to be defeated separately.

5. Press _Run NG_ under Reconciliation. The partner statement is fetched and
   matched against our ledger; anything unmatched becomes a suspense item with
   an age.

---

## Act 5 — The audit trail (2 minutes)

Sign in as `admin@morapay.local` → _Reporting_.

- Volume by corridor, with a CSV export — the shape a licensing submission
  needs.
- The audit trail: every action, every actor, every reason.
- Press **Verify the hash chain**. Each row carries the hash of the row before
  it, so altering any historical entry breaks every hash after it. The database
  also refuses `UPDATE` and `DELETE` on that table outright.

---

## If someone asks a hard question

**"Can this move real money today?"**
No, and that is deliberate. `LIVE_FUNDS_ENABLED` is false, every rail is a
simulator, and the flag is flipped once, by a human, in production, after the
go-live gate in `docs/BUILD_PLAN.md` §13.5 — partner agreements signed, legal
opinions received, penetration test remediated, restore drill done, compliance
officer appointed.

**"What is actually missing?"**
One commercial item, and it is the critical path: **a Russian licensed partner
for the pay-in leg.** The Paycrest deck we were given assigns that role to "the
Russian bank partner" — it presupposes someone else has already solved it. We
have not signed that partner. Everything above the pay-in leg is built and
tested; see `docs/OPEN_ITEMS.md`.

**"How long to go live once partners sign?"**
The integration work is an adapter behind an existing port — days, not months,
because the simulator and the real provider satisfy the same interface and the
same contract tests. The long poles are legal opinions, the penetration test
and the licensing conversations, none of which are engineering.

**"Is Ghana ready?"**
The corridor, the mobile-money flow and the payout simulator are built. Ghana
is not in Paycrest's live coverage, so it needs Fincra's EPSP or an equivalent.
That is a second partner conversation, not a second build.

---

## Resetting between runs

```bash
pnpm db:reset && pnpm seed && pnpm demo:seed
```
