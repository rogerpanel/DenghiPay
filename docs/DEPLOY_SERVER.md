# Deploying to the Hetzner server from Windows

For the demonstration server that has no domain yet. Every command below runs
in Windows `cmd` — no WSL, no extra tooling. Windows 10 and 11 ship OpenSSH, so
`ssh` and `ssh-keygen` are already there.

Substitute your server's address for `<IP>` throughout.

## 1 · Reach the server

```cmd
ssh root@<IP>
```

If that refuses your key, the key you selected when creating the server is not
the one `ssh` is offering. Point at it explicitly:

```cmd
ssh -i %USERPROFILE%\.ssh\id_ed25519 root@<IP>
```

## 2 · Harden it, before anything else is on it

Still in `cmd`, from your clone of the repository:

```cmd
ssh root@<IP> "bash -s" < infra\scripts\harden-host.sh
```

This creates a `deploy` user, installs Docker, turns on the firewall and
`fail2ban`, and disables root login and password authentication.

It will not disable root login unless the `deploy` user has a key to get back in
with — it copies root's `authorized_keys` across automatically, and refuses to
touch the ssh configuration at all if there is nothing to copy. That guard is
there because the alternative is being locked out of a server you created ten
minutes ago.

**Keep this window open** until you have proved the next command works:

```cmd
ssh deploy@<IP>
```

Only close the root session once that succeeds.

## 3 · Let the server read the private repository

The server needs its own read-only credential. Do not copy your personal key
onto it, and do not paste a personal access token: a deploy key is scoped to one
repository, is read-only, and is revoked by deleting one line in a settings
page.

On the server, as `deploy`:

```bash
ssh-keygen -t ed25519 -C "denghipay-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. In GitHub: **rogerpanel/MoraPay → Settings → Deploy
keys → Add deploy key**. Give it a name, paste the key, and **leave "Allow write
access" unticked** — the server only ever reads.

Then, still on the server:

```bash
ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # expect: "successfully authenticated"
git clone git@github.com:rogerpanel/MoraPay.git
cd MoraPay
git checkout claude/morapay-development-t9e1ga
```

## 4 · Deploy

```bash
infra/scripts/server-deploy.sh
```

The first run takes a few minutes: it builds the API and both front ends from
source on the server, generates a `.env` with fresh secrets, creates the
database, runs migrations, seeds the chart of accounts and the demonstration
data, starts everything, and then checks it.

It does not finish quietly on failure. It waits for both front ends, confirms
each one can reach the API **through its own origin**, and confirms the ledger
reports itself balanced. Those checks are the point: a page that renders proves
nothing, because the failure this arrangement exists to prevent is a front end
that loads perfectly and then fails every request.

To redeploy after a change:

```bash
cd ~/MoraPay && git pull && infra/scripts/server-deploy.sh
```

Safe to repeat. The database survives; transfer history and the ledger are not
touched beyond running migrations.

### If the build runs out of memory

Unlikely on 16 GB, but if the Next build is killed, give Docker more room:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

## 5 · Open the ports

The hardening script's firewall allows 80 and 443. The back office is on 8080,
so allow that too — on the server:

```bash
sudo ufw allow 8080/tcp comment 'back office'
```

And in the Hetzner console, if you created a cloud firewall, add the same rule
there. It sits in front of the host, so a rule missing from it blocks traffic
before `ufw` ever sees it — which looks exactly like the application being down.

---

# Viewing it without a domain

## The quick way: by IP

```
Sender app     http://<IP>
Back office    http://<IP>:8080
```

Sign in as `chidi@demo.morapay.local` / `morapay-demo-2026`, or
`compliance@morapay.local` / `morapay-local-staff-2026`.

This works because both front ends are built to call `/api` on whatever origin
served them, rather than a hard-coded host. The same build works on the IP today
and on `denghipay.com` later, with no rebuild.

**Be clear about what plain HTTP costs**, because it is not only cosmetic:

- Passwords cross the network in the clear. The seeded accounts are fictional
  and the rails are simulated, so nothing real is exposed — but do not use a
  password here that you use anywhere else.
- The browser will not install the app to a home screen and the service worker
  will not register, because both need a secure context. The offline behaviour
  cannot be tested at all.
- Chrome and Safari will mark the site "Not secure" in the address bar. In front
  of a CEO that is a distraction you do not need.

## The better way: real HTTPS, still without a domain

You can have a genuine, publicly-trusted certificate today, because
`sslip.io` resolves any IP-shaped hostname to that IP, and Let's Encrypt will
issue for it:

```
62.238.23.185.sslip.io   →   62.238.23.185
```

That is a real hostname, so it gets a real certificate, so the browser is
satisfied, the install prompt appears, and the offline shell can be tested. It
costs nothing and needs no registrar.

The production compose file already contains nginx and certbot for exactly this
shape. Point them at the `sslip.io` name instead of the domain, issue, and swap
the name for `denghipay.com` when DNS is ready — the runbook for that swap is
[`runbooks/change-domain.md`](runbooks/change-domain.md).

**Two limits worth knowing before you rely on it.** Let's Encrypt rate-limits
certificates per registered domain, and `sslip.io` is one registered domain
shared by everyone using the trick — so issuance can fail for reasons that have
nothing to do with you. And the hostname contains the IP, so it changes if the
server does. It is right for a demonstration and wrong for a pilot.

## The third way, if the server is the problem

If you want testers on the application before the server is sorted at all,
`pnpm demo:preview` on a laptop plus a Cloudflare tunnel gives HTTPS in about a
minute. See [`PREVIEW.md`](PREVIEW.md). The server is the better answer once it
is running, because it stays up when the laptop closes.

---

## What this deployment is not

`infra/compose/server.yml` builds from source, ships its own PostgreSQL, and
publishes plain HTTP. That is the right set of trades for a demonstration box
with no domain, and the wrong set for production.

`infra/compose/production.yml` is the other one: tagged images from the
registry, TLS terminated in nginx, PostgreSQL supplied rather than assumed, and
Prometheus and Grafana alongside. Move to it when there is a domain — and note
that `LIVE_FUNDS_ENABLED` stays false in both until the legal opinions and
partner agreements in [`OPEN_ITEMS.md`](OPEN_ITEMS.md) exist. Neither file can
turn it on; that is a deliberate human act in production, once.
