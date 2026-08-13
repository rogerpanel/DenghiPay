# Runbook — changing the domain

**Short answer: yes, and it stays cheap right up until a partner is
integrated.** After that it stops being an engineering task and becomes a
change request on someone else's schedule.

Deploy on whatever name you have. Move to the kept one later. Just do it before
step 3 below becomes true.

## What the cost depends on

| When you change it                      | What it costs                                           |
| --------------------------------------- | ------------------------------------------------------- |
| Before any partner integration          | An afternoon, entirely in our control                   |
| After a partner holds our callback URL  | Their change-control process — weeks, and a re-test     |
| After real users have installed the PWA | They must reinstall; the old installation stops working |

The middle row is the one that matters. A licensed partner does not repoint a
webhook because we asked nicely on a Tuesday. It is a change request, it is
scheduled, and it is usually re-tested in their sandbox first. Callback URLs are
also frequently pinned in a partner's own allowlist alongside our signing key
and source IPs, so all three move together.

**So: pick the permanent domain before the first partner integration, not
before the first deployment.** Those are months apart, and only the second one
is urgent.

## Make the images domain-agnostic first

One change removes most of the work, and it is the same mechanism as
`pnpm demo:preview`.

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time, so a
front-end image built for `api.old-domain` keeps calling `api.old-domain`
forever. Change the domain and you must rebuild and redeploy both front ends —
a CI run, a new image tag, and a deployment, for what is otherwise a
configuration edit.

Build with `NEXT_PUBLIC_API_URL=/api` instead and the browser calls whatever
origin served the page, which the front end forwards to the API server-side.
The images then contain no domain at all, a domain change never touches them,
and the `api.` subdomain stops being needed — two DNS records and two
certificates instead of three.

The trade is that the API is no longer separately addressable from outside,
which matters only if a partner needs to reach it directly. Partner callbacks
do, so keep `api.` published for `/webhooks/` even when the front ends use the
proxy.

## The change itself

Everything below is in the repository; none of it is discovered at 2am.

1. **DNS.** Point the new records at the same server IP. Leave the old records
   in place — deleting them before certificates are re-issued is the usual way
   to be locked out mid-change.

2. **Certificates.** Issue for the new names before switching anything:

   ```bash
   docker compose -f infra/compose/production.yml run --rm certbot \
     certonly --webroot -w /var/www/certbot \
     -d new-domain -d admin.new-domain -d api.new-domain
   ```

3. **nginx.** In `infra/nginx/conf.d/morapay.conf`, change `server_name`, the
   two `ssl_certificate` paths per block, and the `connect-src` entry in the
   Content-Security-Policy header. The CSP is the one people forget: miss it and
   every page loads and then fails every request, with the reason visible only in
   the browser console.

4. **Environment.** `API_CORS_ORIGINS`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`,
   `ADMIN_PUBLIC_URL`. `API_PUBLIC_URL` builds the links in outbound email, so a
   stale value sends verification links to a host that no longer answers.

5. **CI.** `.github/workflows/deploy.yml` health-checks and smoke-tests against
   the domain by name.

6. **The OpenAPI document.** `pnpm openapi` regenerates the server URL.

7. **Front-end images.** Only if you did not adopt the same-origin proxy above.
   Rebuild both with the new `NEXT_PUBLIC_API_URL` and redeploy.

8. **Partners.** Their consoles, their timeline. Start here, not last: the
   others take an afternoon and this one does not.

## Afterwards

- Keep the old domain and redirect it. It costs a few euros a year and it
  catches bookmarks, email links already sent, and anyone still on a cached DNS
  answer.
- **Do not** serve the application on both names at once for longer than the
  redirect needs. Two origins means two PWA installations, two service-worker
  caches and two sets of sessions, and a user who has one of each will report
  bugs neither of you can reproduce.
- Confirm `GET /health/ledger` still reports `balanced: true` on the new name,
  and run `infra/scripts/smoke-transfer.sh` against it. A domain change should
  not be able to affect the ledger, and confirming that takes a minute.
