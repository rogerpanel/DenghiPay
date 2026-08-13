# Running it for real users, before the domain and the server

Four ways to put the working application in front of real people today. They
differ in who can reach it and in whether the browser treats it as a secure
context — which decides whether you are testing the product or only most of it.

All of them run the same build, against the same simulated partner rails, with
`LIVE_FUNDS_ENABLED` false. No real money moves in any of them.

## The constraint that decides which one you want

The sender application is a PWA. Installing it to a home screen, the offline
shell and the service worker all require a **secure context** — HTTPS, or
`localhost`. Browsers make no exception for a local IP address:
`navigator.serviceWorker` simply does not exist on `http://192.168.x.x`, so the
install prompt never appears and the app runs as an ordinary web page.

That matters here more than it would elsewhere. Senders on patchy mobile data
are much of the point, so "does it install, and does it survive a dead signal"
is a real part of the experience being tested.

| Option             | Who can reach it         | Secure context    | Set-up                 |
| ------------------ | ------------------------ | ----------------- | ---------------------- |
| 1 · This machine   | You                      | Yes (`localhost`) | Nothing                |
| 2 · Same network   | Anyone on the same wi-fi | **No**            | Nothing                |
| 3 · Tunnel         | Anyone, anywhere         | **Yes**           | One binary, no account |
| 4 · A server by IP | Anyone, anywhere         | No, until DNS     | A VPS, about €4/month  |

**For genuine user testing, use option 3.** It is the only one before DNS that
gives you HTTPS, and it takes about a minute.

---

## 1 · On this machine

```bash
pnpm demo:reset
```

Sender app on <http://localhost:3000>, back office on
<http://localhost:3001>. Full PWA behaviour, because `localhost` counts as
secure. Good for you; useless for anyone else.

## 2 · Anyone on the same network

```bash
pnpm demo:preview
```

Prints the address to open from a phone on the same wi-fi. The build differs
from option 1 in exactly one value, and it is the one that matters:

`NEXT_PUBLIC_API_URL` is inlined into the client bundle when it is built, so the
usual `http://localhost:4000` means a phone opening the app calls **itself** on
port 4000 and every request fails — after the page has rendered perfectly, which
is what makes it confusing. `demo:preview` builds with `/api` instead, so the
browser calls whatever origin served the page, and the front end forwards it to
the API server-side. `demo:preview` will not finish until it has confirmed that
round trip actually works.

The API is deliberately not exposed. It stays on the loopback interface and is
reached only through the front end, so a preview opens two ports rather than
three.

**Expect this to fail on guest and corporate wi-fi**, which usually isolate
clients from each other. Tethering the phone to the machine's hotspot works when
the office network will not. And, per the constraint above, no PWA install.

## 3 · Anyone, anywhere — recommended

Start option 2, then put a tunnel in front of the sender app's port. Each of
these gives you an HTTPS URL you can send to a tester on another continent:

```bash
# Cloudflare — no account needed for a quick tunnel
cloudflared tunnel --url http://localhost:3000

# ngrok — free account, more stable URLs
ngrok http 3000

# Nothing to install, if you have ssh
ssh -R 80:localhost:3000 nokey@localhost.run
```

Only port 3000 needs tunnelling; the API is behind the same origin. For the back
office, run a second tunnel on 3001.

Because the tunnel terminates TLS, the app is in a secure context: the install
prompt appears, the service worker registers, and the offline shell can be
tested by putting the phone into airplane mode mid-session. This is the closest
thing to the real product available before DNS.

Two things to hold in mind. The URL changes every time you restart a quick
tunnel, so send it fresh rather than expecting testers to bookmark it. And a
tunnel is a public address — anyone with the link reaches your demonstration
data. That is acceptable for simulated rails and fictional senders; it would not
be once anything real is in the database.

## 4 · A server, reachable by IP

You do not need a domain to rent a server. A Hetzner CX22 is a few euros a month
and answers on its IP address immediately, which is enough to keep a preview up
between sessions instead of tied to a laptop:

```bash
infra/scripts/harden-host.sh                 # firewall, ssh, unattended upgrades
IMAGE_TAG=<tag> docker compose -f infra/compose/production.yml up -d
```

Reached by IP over plain HTTP it is not a secure context, so it has option 2's
limitation. It becomes the real thing the moment a domain points at it: the
compose file, nginx configuration and certificate renewal are already written
and committed, and issuing certificates is the only remaining step.

If you are going to buy the server anyway, buying it now and pointing a cheap
domain at it later costs nothing extra and skips options 2 and 3 entirely.

---

## What testers should be asked to do

The three seeded senders exercise different paths, and the interesting feedback
comes from the second and third as much as the first.

| Account                      | What it demonstrates                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `chidi@demo.morapay.local`   | The main thread — verified, can send today                 |
| `ama@demo.morapay.local`     | Tier 0. Hits the limit and is offered the upgrade          |
| `blocked@demo.morapay.local` | Matches the screening list. Held for review, never settles |

Password `morapay-demo-2026` for all three. The back office is
`compliance@morapay.local` or `treasury@morapay.local`, password
`morapay-local-staff-2026`.

Worth watching for specifically, because these are the decisions we would change
on the strength of what testers do:

- **Does the pricing breakdown help or overwhelm?** We show the mid-market rate,
  our rate and the margin separately (decision D1). The competing model hides the
  margin inside the rate. If testers find it noisy, that is a real finding.
- **Do they read the resolved recipient name?** The partner returns the real name
  and the sender confirms _that_, not what they typed. If they click through
  without reading, the control is not working, and this is the failure that costs
  a real person their money.
- **What do they do while a transfer is settling?** The state is honest rather
  than optimistic, which is correct and may still feel slow.
- **Russian, English or French?** The locale switch is in Settings. Watch which
  one they choose without being prompted.

## Resetting between sessions

Sending limits accumulate over real transfer history, so a shared preview drifts
toward "above your tier 2 limit" as testers use it. `pnpm demo:reset` clears it —
and destroys everything in the local database, which is fine here and would not
be later.
