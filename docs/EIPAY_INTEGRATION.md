# eipay — handover review, server integration and test report

eipay is the Paycrest app the developers delivered under Agreement No. 04
(repository `Dprof-in-tech/eipay`, reviewed at commit `0023755`, 14 Nov 2026).
It is a standalone Next.js application with its own database (hosted
Supabase), wallets (Privy), identity checks (Smile ID, Dojah) and SMS (Twilio,
KudiSMS). It runs on the MoraPay server as **its own service**, sharing nothing
with MoraPay: not the database, not Redis, not the `.env`.

Status: **integration testing, testers only.** The app holds live provider keys
— Paycrest has no sandbox — so the public address asks for the testers' login
until the go-live checklist in §6 is signed.

Related: `docs/PAYCREST_ADAPTER.md` (MoraPay's own Paycrest adapter, which
stays the route for MoraPay corridors), `infra/scripts/server-deploy.sh`,
`infra/scripts/eipay-check.sh`.

---

## 1. Handover review against Annex 1

Reviewed 18 Nov 2026 by reading the repository; nothing in it was run except
its own build and test suite.

| Annex 1 item                      | Result                                    | Evidence                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete source in a repository   | **Yes**                                   | `Dprof-in-tech/eipay`, 410 tracked files, migrations in `supabase/migrations`.                                                                                                                       |
| Builds from its own instructions  | **Yes**                                   | `pnpm install --frozen-lockfile && pnpm build` succeeds with placeholder configuration (the same values its CI uses).                                                                                |
| Tests                             | **Yes**                                   | `pnpm test`: 41 suites, 433 tests, all passing.                                                                                                                                                      |
| Deployment guide                  | **Yes**, with one gap                     | `docs/deployment-guide.md` (systemd/PM2/nginx). Its Docker option needs `output: "standalone"`, which the code does not set; we use our own Dockerfile and `next start`, so their code is unchanged. |
| No secrets in the repository      | **Yes** in git; **No** in the handover    | Git tracks only `.env.example`. The Drive zip, however, carried the live `.env`, including wallet private keys. See §2.                                                                              |
| Component and licence list        | **Missing**                               | Not in `docs/`. Needed, together with the upstream licence (§1.2).                                                                                                                                   |
| Settlement statement (Clause 3.3) | **Present, but contradicted by the code** | `docs/settlement-statement.md`. See §1.1.                                                                                                                                                            |
| Integration map (Clause 3.5)      | **Yes**                                   | `docs/runbook-and-rebranding.md` Part 3.                                                                                                                                                             |

### 1.1 The settlement statement does not match the code

The statement declares that the Company holds no keys and no customer value at
any moment, and that sanctions screening is integrated. The code shows:

1. **Company-held private keys.** `SPONSOR_EVM_WALLET_PRIVATE_KEY` (gas
   sponsorship and the nTZS relayer, `app/lib/bundler/chains.ts`),
   `CASHBACK_WALLET_PRIVATE_KEY` (referral rewards, `app/api/referral/claim`)
   and a `PRIVATE_KEY` fallback. These are Company hot wallets.
2. **Customer value through a Company wallet.** `docs/ntzs-integration.md` §5:
   with `NTZS_JIT_ENABLED`, the user's USDC goes to the "eipay relayer / smart
   wallet", is swapped to nTZS on Uniswap, and is sent to the nTZS treasury. For
   that interval a Company-controlled key controls customer value.
3. **Server-side signing authority.** `app/lib/privy.ts` installs
   `PRIVY_WALLET_AUTH_PRIVATE_KEY` as a Privy authorisation key, which lets the
   server sign for wallets that delegate to it. The statement says this is
   "cryptographically impossible".
4. **No sanctions screening.** Statement §5 says screening is integrated. No
   call to a screening or watch-list service exists in the code; the word
   appears only in the Terms and Privacy pages. Smile ID and Dojah verify
   identity; they are not run as sanctions screening here.

Either the statement is corrected to describe these, or the code is changed to
match it. Counsel's view on custody needs the corrected version.

### 1.2 Other findings

- **Operator named in the legal pages is COGEL SARL** (71 mentions in
  `app/components/TermsOfService.tsx`, also the Privacy Policy, French versions
  included). The developers have since said (18 Nov) that COGEL SARL, a company
  in the DR Congo under the Clients' ownership, is the entity Paycrest verified
  (see §1.3), and that the legal pages are optional extras. The pages, the
  Paycrest verification and every service account must name the same operating
  entity; which one that is (COGEL SARL or LLC "Expat Groupe") is the Clients'
  decision, with counsel.
- **Licence.** `LICENSE` says "proprietary, copyright eipay", while the Terms
  say eipay "was developed using an open-source codebase", and the README's
  wording and contribution links (Paycrest's contribution guide and developer
  Telegram) point to Paycrest's open-source _Noblocks_ app. The developers must name the
  upstream project and its licence, and confirm they can assign what the
  Agreement says the Company buys.
- **nTZS webhook fails open.** `app/api/webhooks/ntzs/route.ts` skips the
  signature check when `NTZS_WEBHOOK_SECRET` is unset; on the server it
  answered 200 to an unsigned empty call (24 Nov). The deploy script refuses
  nTZS without its secret, and the route stays behind the testers' gate.
- **KYC limits in `.env.example`** are test values: USD 10 a month with no KYC
  (tier 0), and USD 0.5 / 1 / 2 for tiers 1–3. Production values come from
  counsel.
- **Personal data abroad.** KYC documents and profiles live in hosted
  Supabase; Sentry and Brevo also receive data. The Supabase region and the
  processing agreements are needed for Nigeria's NDPA 2023 and Kenya's DPA 2019.
- **Russian-language users.** The app switches to Russian for Moscow-timezone
  browsers. Paying with digital currency is restricted in Russia (259-FZ);
  counsel should say whether Russian residents may use it.
- **Guest refunds go to a hard-coded address.** A failed guest order is
  refunded to `NEXT_PUBLIC_GUEST_REFUND_ADDRESS`, and when that is unset to
  `0x2B4f…d3be`, written into `app/pages/TransactionPreview.tsx` and
  `app/api/v1/payment-orders/route.ts`. The developers state (18 Nov) that it
  is a developer's personal wallet and that no refund has been sent to it. The
  deploy script refuses to run without the Company's own address. A customer's
  refund landing in a Company wallet is also custody (§1.1).
- **Amounts as JavaScript numbers.** Fine inside eipay, but none of that code
  can be lifted into MoraPay's adapters (CLAUDE.md rule 12).
- `rogerpanel/eipay-client` and `rogerpanel/eipay-api` (Vite, NestJS,
  Firebase) are a different, earlier codebase, not this handover.
- **CI is red on `main`, but not because of the code.** The `migrate` job runs
  `supabase db push` with no database address configured; the build and test
  jobs pass. Database migrations are therefore not applied automatically.

### 1.3 Accounts, and the Paycrest Sender Business Agreement

The developers' own service accounts (Privy, Supabase, Alchemy, KudiSMS,
Smile ID, Dojah, Vercel) belong to an entity of theirs and are not handed
over; the Company opens its own, set up from the handover documents (the
developers declined a joint setup session, 18 Nov). Setting eipay up from those
documents alone is itself the Annex 1 "deploys from its docs" test; gaps found
on the way go in the report.

Gaps found so far in `docs/deployment-guide.md` §9 (the background
reconciler), each of which would leave it silently doing nothing:

- It says the cron job comes from `20261014000000_catch_up_schema.sql`; neither
  migration creates one. It has to be scheduled by hand, after enabling the
  `pg_cron` and `pg_net` extensions.
- Its `cron.schedule` example sends no `x-reconcile-secret` header, and the
  function answers 401 to any call without it
  (`supabase/functions/reconcile-pending-orders/index.ts`).
- The function also needs the `RECONCILE_CRON_SECRET` and `AGGREGATOR_URL`
  secrets (it throws without the latter); only `PAYCREST_SENDER_KEY` is
  documented. `supabase/config.toml` is the only place the secret is mentioned.
- Privy's dashboard settings (login methods, allowed domains) are not listed;
  the code fixes only the embedded EVM wallet and the chains.

The Paycrest account was handed over. It is verified (KYB) under COGEL SARL
with the developers' help, and its login email is a third party's, which could
not yet be removed from the team. Paycrest's standard **Sender Business
Agreement** applies, generated automatically when the KYB was approved. It is
not the separately negotiated, signed agreement Agreement No. 04 anticipates:
it names no parties, carries no signature and is accepted by use. What it puts
on the Sender Business, that is COGEL SARL:

| Clause          | Effect                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2–3.3, 8.2(b) | Everything given in the KYB must be true and complete, nothing material withheld, and updated promptly when it changes; otherwise Paycrest may terminate at once. |
| 4.1             | **Sole** responsibility for KYC/AML/CFT on every end user, transaction monitoring, licences in every country served, and sanctions compliance.                    |
| 5.1–5.2         | Unlimited liability and indemnity for end users' transactions, including anything done on the account before the agreement's effective date.                      |
| 6               | Paycrest's liability capped at USD 100.                                                                                                                           |
| 7               | Paycrest may ask for the AML/KYC policies and evidence of compliance.                                                                                             |
| 9               | Delaware law, binding arbitration.                                                                                                                                |

Consequences for this integration:

- **Sanctions screening and transaction monitoring are contractual
  obligations**, not only MoraPay guardrails. eipay has neither (§1.1).
- **The KYB file must describe the business as it will actually run:** the
  operating entity, every beneficial owner with their real address, the people
  operating the account, the countries served, and the login email. A change of
  owner, operator or contact is an update owed to Paycrest under 3.2(c).
- **Anything already run through this account is COGEL SARL's liability**
  (5.1). The Order History tab shows whether the developers' public copy used
  it; if it did, that copy must stop using it now, independently of payment.

## 2. Before eipay goes on the server: the leaked keys

The Drive zip contained eipay's live `.env`. Anyone who had the link has the
keys, including wallet private keys that can spend whatever those wallets hold.

1. Set the Drive file (original and every copy) to **Restricted**.
2. Move all funds out of the sponsor, cashback and any `PRIVATE_KEY` wallet into
   new wallets, today.
3. Replace every key the file held: Paycrest sender key, Privy app secret and
   wallet authorisation key, Supabase secret key, `ENCRYPTION_KEY` (with the
   re-encryption step in their runbook), `INTERNAL_API_KEY`, nTZS, Smile ID,
   Dojah, Twilio, KudiSMS, Brevo, Alchemy, LI.FI.
4. From now on a handover is repository access plus `.env.example`.

The new values go in one place only: `/root/DenghiPay/eipay.env` on the server.

## 3. Running it on the server

One-time. The Hetzner console garbles long pasted or typed strings, so tokens
and keys go through PowerShell (`ssh`/`scp` as `deploy`), and the console only
moves files.

1. **The code.** Clone into `/root/DenghiPay/eipay`, either from GitHub with
   access to the private repository, or from a `git bundle` copied up with
   `scp` (`git clone -b main /home/deploy/eipay.bundle eipay`).
2. **The keys.** Fill in `infra/eipay.env.template` on a PC. It lists every
   value, where in which dashboard to find it, and safe settings for the test
   phase. Save it as `eipay.env`, then:

   ```
   scp -i "$env:USERPROFILE\.ssh\denghipay" eipay.env deploy@62.238.23.185:~/
   ```

   and in the console, as root:

   ```
   mv /home/deploy/eipay.env /root/DenghiPay/eipay.env
   chown root:root /root/DenghiPay/eipay.env
   chmod 600 /root/DenghiPay/eipay.env
   ```

The deploy script writes the values that follow from the deployment itself
(`APP_URL`, `NEXT_PUBLIC_APP_URL`, `SMILE_ID_CALLBACK_URL`, `PRIVY_JWKS_URL`)
and generates `INTERNAL_API_KEY`, `ENCRYPTION_KEY` and
`INJECTED_SESSION_SECRET` once. It strips Notepad's line endings.

In Privy, add `https://eipay.62.238.23.185.sslip.io` to the allowed domains.
The reconciliation worker (`supabase/functions/reconcile-pending-orders`) runs
in the Supabase project, not on this server; deploy it there.

Then, every time:

```
cd /root/DenghiPay/DenghiPay && git pull && TLS=1 EIPAY=1 infra/scripts/server-deploy.sh
```

The script refuses to build if the checkout contains an `.env`, if `eipay.env`
is missing, inside a repository, or not mode 600, if a required key is empty,
or if nTZS is configured without its webhook secret. The env file reaches the
build as a BuildKit secret, so no key is written into an image layer.

On first run it prints the **testers' password once**. Give it only to the
named testers. To issue a new one, delete the two `EIPAY_TEST_*` lines from
`.env` and re-run.

A run without `EIPAY=1` takes eipay off the public address again (MoraPay is
unaffected either way).

When the real domain exists: point it at the server, put it in
`NEXT_PUBLIC_APP_URL`/`APP_URL` and Privy, and run with
`EIPAY_HOSTNAME=<domain>` added.

## 4. The testers' gate

Everything at the eipay address asks for the testers' login (Caddy basic
authentication, `infra/caddy/eipay.caddy`), except the Smile ID callback, which
checks Smile ID's own signature. The nTZS webhook stays behind the gate while
Tanzania goes through Paycrest, because it accepts unsigned calls when nTZS is
not configured. eipay's own port is bound to the server's loopback, so the gate
cannot be walked around.

A tester signs in once; that response sets an HttpOnly, Secure cookie holding a
random gate token (`EIPAY_TEST_GATE_TOKEN`), valid 14 days, and requests with it
pass without asking again. Password-only basic authentication made the sign-in
box return every few clicks, because some requests (the app's service worker
among them) go out without the browser's cached credentials. The cookie is set
only on a response to a request that passed the password check.

The testers' password is drawn from letters and digits that cannot be misread
from a screen (no 0/O, 1/l/I), in groups of five, because the Hetzner console
cannot copy text and it is read off by eye.

The gate comes off with a reviewed change to `infra/caddy/eipay.caddy` that
cites the signed checklist in §6, not with an environment variable.

## 5. Integration test report

### 5.1 Automatic checks

After each deploy:

```
cd /root/DenghiPay/DenghiPay && infra/scripts/eipay-check.sh
```

It asks for the testers' password and checks, read-only: all services running
and the MoraPay ledger still balanced; HTTPS with a trusted certificate; the
gate refusing no login and a wrong password and admitting the testers; HTTP
redirecting to HTTPS; eipay's port unreachable from outside; live Paycrest
quotes through eipay for NGN, KES, UGX and TZS; and both callbacks reachable
without the gate yet rejecting an unsigned call. It writes the result to
`/root/DenghiPay/eipay-check-<time>.txt`. Attach that file to the report as it
was printed.

### 5.2 Checks by hand

Done by a named tester in the browser, each with the evidence noted. The
off-ramps are real payouts; keep them to the smallest amount each corridor
accepts and fund them from the account Clause 6.4 names.

| #   | Check                                          | Expected                                      | Result | Evidence                   |
| --- | ---------------------------------------------- | --------------------------------------------- | ------ | -------------------------- |
| 1   | Sign in with email (Privy embedded wallet)     | wallet address shown                          |        |                            |
| 2   | KYC tier 1 (phone OTP)                         | tier 1 shown                                  |        |                            |
| 3   | Recipient name check, a Nigerian bank account  | account name returned                         |        |                            |
| 4   | Off-ramp USDT → NGN                            | recipient paid                                |        | Paycrest order id, tx hash |
| 5   | Off-ramp → KES (M-Pesa)                        | recipient paid                                |        | order id, tx hash          |
| 6   | Off-ramp → UGX (MTN or Airtel)                 | recipient paid                                |        | order id, tx hash          |
| 7   | Off-ramp → TZS (Tigo, Airtel or Halopesa)      | recipient paid                                |        | order id, tx hash          |
| 8   | Order that cannot be fulfilled (wrong account) | refunded to the sender's wallet               |        | order id, refund tx        |
| 9   | Transaction history after a reload             | all of the above listed with the right status |        | screenshot                 |
| 10  | Status reaches its end with the browser closed | final status on return                        |        | order id                   |

### 5.3 Verdict

Fill in from 5.1 and 5.2 only. A row with no evidence is not a pass.
Acceptance of Milestone 2, and so the balance payment, is the Clients'
decision under the Agreement; this report is the evidence for it.

## 6. Go-live checklist (before the gate comes off)

Each item needs a name and a date.

| Item                                                                                                 | Owner                | Done |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ---- |
| All keys in §2 replaced; old wallets empty (sponsor wallet: reported emptied 18 Nov)                 | Developers           |      |
| Operating entity decided; legal pages, Paycrest KYB and service accounts all name it                 | Company / counsel    |      |
| Paycrest KYB file current (owners, addresses, operators, countries); third-party login email removed | Company              |      |
| Sender Business Agreement read and accepted by an authorised signatory of the Sender Business        | Company              |      |
| New Paycrest key in use; every older key revoked; developers' public copy no longer on this account  | Company              |      |
| AML/KYC and transaction-monitoring policies written (Sender Agreement §7)                            | Company / counsel    |      |
| Sanctions screening of sender and recipient before every order, blocking                             | Developers           |      |
| Settlement statement corrected to match the code (§1.1)                                              | Developers           |      |
| Counsel's written view: custody (§1.1), licences per country, Russian residents                      | Counsel              |      |
| Operator entity in Terms and Privacy corrected                                                       | Company / counsel    |      |
| Upstream licence named and cleared; component list delivered                                         | Developers           |      |
| Production KYC limits set                                                                            | Company / counsel    |      |
| Supabase region and data-processing agreements                                                       | Developers / Company |      |
| Real domain, monitoring, backups tested by a restore                                                 | Company              |      |
| Integration test report (§5) complete                                                                | Lead Engineer        |      |
| Go-live approved                                                                                     | Company (name, date) |      |
