# Mail setup — making the confirmation email arrive

The confirmation email is built and works. What it needs is a provider.

This page is the whole of it: what is already in place, the six environment
variables that turn delivery on, and the three ways it goes wrong.

---

## What is already built

| Piece                                                        | Where                                 |
| ------------------------------------------------------------ | ------------------------------------- |
| Message written inside the transaction that creates the user | `OutboxService`                       |
| Token stored as a hash, never in plain text                  | `email_verification_token.token_hash` |
| Delivery, with claim-before-send                             | `MailDeliveryService.drain()`         |
| Retry with exponential backoff                               | 30s, 1m, 2m, 4m, 8m, then stop        |
| Both a plain-text and an HTML part                           | `htmlFrom()`                          |
| Undeliverable queue for a human                              | `GET /health/mail`                    |

The transactional outbox is the reason this is worth trusting: the verification
link is durable in the database before any network call is attempted, so a
provider outage delays mail rather than losing it.

**Verified end to end** against an SMTP server: register → message claimed and
sent → token read back out of the delivered body → `POST /auth/verify-email` →
account `ACTIVE`. 643 queued messages drained with zero failures.

---

## Turning it on

Six variables. Nothing else changes.

```bash
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example-provider.com
SMTP_PORT=587
SMTP_USER=<provider username>
SMTP_PASSWORD=<provider password or API key>
MAIL_FROM="MoraPay <no-reply@yourdomain.com>"
```

The API **refuses to boot** if `MAIL_TRANSPORT=smtp` and any of `SMTP_HOST`,
`SMTP_USER` or `SMTP_PASSWORD` is missing, or if `MAIL_FROM` is still the
placeholder. That is deliberate: a transport pointed at nowhere is the quietest
failure in the system.

On the demonstration server, put them in the `.env` the compose file reads, then
`docker compose up -d api`. Confirm with:

```bash
curl -s https://your-host/health/mail
```

`{"transport":"smtp","deliverable":true,"pending":0,"stuck":0}` is what you want.

### Provider values

Any SMTP provider works. These are the ones whose free tiers suit a pilot; the
usernames are what each provider actually expects, which is the part people get
wrong.

| Provider   | `SMTP_HOST`                         | `SMTP_USER`          | `SMTP_PASSWORD` |
| ---------- | ----------------------------------- | -------------------- | --------------- |
| Resend     | `smtp.resend.com`                   | `resend`             | API key         |
| SendGrid   | `smtp.sendgrid.net`                 | `apikey` (literally) | API key         |
| Mailgun    | `smtp.mailgun.org`                  | full SMTP login      | SMTP password   |
| Postmark   | `smtp.postmarkapp.com`              | server API token     | same token      |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | SMTP username        | SMTP password   |

Check the provider's own documentation for the current host and port — these
move, and the provider's dashboard is the authority, not this table.

---

## The three ways it goes wrong

**1 · Nothing is configured.** `MAIL_TRANSPORT` defaults to `outbox`:
registration succeeds, the message is stored, and nothing is sent. This is the
one the demonstration server had. It now shows up as `mail_deliverable: false`
in `GET /health/ready`, and `GET /health/mail` says so in words.

While in this state the sender app offers the confirmation link in the page
instead of pretending an email was sent. That shortcut is scoped to the signed-in
caller, returns only their own link, disables itself the moment SMTP is
configured, and **refuses outright once live funds are on** — a link served over
an API is not delivery. For the same reason the API will not boot with live funds
enabled and no mail transport.

**2 · Hetzner blocks the port.** Hetzner Cloud blocks outbound **25 and 465** by
default on new accounts, for roughly the first month, and will unblock them on
request once an invoice has been paid. **587 is not blocked**, so use 587 — every
provider in the table above supports it. If you see connection timeouts to your
provider, this is almost certainly why.

**3 · The domain is not authorised to send.** Mail that leaves will land in spam
without DNS records. Your provider gives you the exact values; you add them at
your registrar:

- **SPF** — authorises the provider to send as your domain.
- **DKIM** — signs the mail so the recipient can verify it was not altered.
- **DMARC** — tells recipients what to do when SPF or DKIM fails. Start at
  `p=none` and read the reports before tightening.

`MAIL_FROM` must be at a domain you control and have authorised. A `From` address
at a domain you do not own is the fastest way to be classified as spam
permanently.

---

## Diagnosing a customer who says no email arrived

```bash
curl -s https://your-host/health/mail
```

- `deliverable: false` → nothing is being sent. Configure SMTP.
- `stuck > 0` → delivery is failing. `lastFailureReason` carries the provider's
  own words, which is usually enough (authentication, rate limit, rejected
  sender).
- `pending` high and falling → it is working; the queue is draining.
- all zero and the customer still has nothing → the mail was accepted by the
  provider. Check the provider's own log and the customer's spam folder. This is
  where SPF and DKIM usually turn out to be the answer.

The endpoint deliberately carries no recipients and no message bodies. A
verification token is enough to take over an account, and a recipient address is
personal data (guardrail G9), so neither is exposed on a diagnostic endpoint.

---

## What is deliberately not built

**A second, HTTP-API transport.** Resend, SendGrid, Postmark and Mailgun all
have HTTPS APIs that would sidestep SMTP ports entirely. It is maybe eighty
lines. It is not built because 587 is open on Hetzner and every provider above
supports it, so it would be a second delivery path to maintain for no capability
we lack. Worth revisiting only if a host blocks 587 too.

**Mail for the back office.** Staff accounts are created by the seed and their
passwords are handed over directly. No staff flow sends mail.
