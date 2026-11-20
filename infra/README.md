# Infrastructure

Neutral-tier hosting on Hetzner (BUILD_PLAN 12.4), with the residency
partitions elsewhere. This directory holds everything needed to stand the
platform up, and the reasoning behind the parts that look arbitrary.

## What lives where

| Tier    | Contents                                                                     | Where                                           |
| ------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Neutral | API, saga workers, sender PWA, back office, ledger, Redis, observability, CI | Hetzner                                         |
| RU      | Russian-resident sender PII, KYC documents                                   | In-country provider (152-FZ)                    |
| NG      | Nigerian payment transaction data, recipient PII                             | Nigeria-resident (CBN localisation, 1 Jan 2027) |
| GH      | Ghanaian recipient PII                                                       | Ghana or a compliant regional host              |

The Hetzner host runs **no** Russian sender PII and **no** Nigerian payment
data. It holds tokenised references and the ledger. That separation is why
`apps/api/src/partitions/` exists and why CI fails a build that imports across
a boundary.

## Provisioning a Hetzner server

Tested against Ubuntu 24.04 on a CPX31 (4 vCPU, 8 GB). The pilot does not need
more; see ADR 0003 for why.

```bash
# 1. Create the server with an SSH key, no password authentication.
hcloud server create \
  --name morapay-prod-1 \
  --type cpx31 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key "$SSH_KEY_NAME" \
  --network morapay-private

# 2. Firewall: deny by default, and expose exactly three ports.
hcloud firewall create --name morapay-edge
hcloud firewall add-rule morapay-edge --direction in --protocol tcp --port 22  --source-ips "$OFFICE_CIDR"
hcloud firewall add-rule morapay-edge --direction in --protocol tcp --port 80  --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule morapay-edge --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall apply-to-resource morapay-edge --type server --server morapay-prod-1
```

SSH is restricted to the office range. Port 22 open to the world is how a
server with a perfect application ends up compromised.

### Host hardening

```bash
ssh root@<ip> 'bash -s' < infra/scripts/harden-host.sh
```

That script does the following, and each line is there for a reason:

- creates a `deploy` user with a key and no password, and disables root SSH;
- sets `PasswordAuthentication no` — a key-only server cannot be brute-forced;
- installs and enables `unattended-upgrades` for security patches;
- installs `fail2ban` with the sshd jail;
- enables the host firewall as a second layer behind the Hetzner one;
- installs Docker from the official repository, not the distribution's;
- turns on private networking so the database and Redis are never on a public
  interface.

### First deployment

```bash
ssh deploy@<ip>
sudo mkdir -p /opt/morapay && sudo chown deploy:deploy /opt/morapay
git clone https://github.com/rogerpanel/MoraPay /opt/morapay
cd /opt/morapay

# Secrets come from the vault, never from a file in the repository.
sudo install -m 600 /dev/stdin /opt/morapay/.env.production <<'ENV'
IMAGE_TAG=...
DATABASE_URL=...
JWT_ACCESS_SECRET=...
ENV

docker compose --env-file .env.production -f infra/compose/production.yml up -d --wait
```

## DNS and TLS (12.5)

Three names, three certificates:

| Name                     | Serves      |
| ------------------------ | ----------- |
| `morapay.<domain>`       | sender PWA  |
| `api.morapay.<domain>`   | API         |
| `admin.morapay.<domain>` | back office |

```bash
# Issue certificates once; the certbot container renews them twice a day.
docker compose -f infra/compose/production.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d morapay.example -d api.morapay.example -d admin.morapay.example \
  --email ops@morapay.example --agree-tos --no-eff-email
```

Also required, and easy to forget:

- a **CAA** record naming Let's Encrypt, so no other authority can issue for the
  domain;
- **HSTS** with `preload` — already set by nginx, but the domain has to be
  submitted to the preload list separately;
- staging on its own subdomain with `noindex` **and** HTTP basic auth, so a
  half-finished screen never appears in a search result.

## Backups and disaster recovery (12.7)

```bash
# Nightly, per partition, encrypted before it leaves the host.
0 2 * * * BACKUP_AGE_RECIPIENT=age1... /opt/morapay/infra/scripts/backup.sh neutral
0 3 * * * BACKUP_AGE_RECIPIENT=age1... /opt/morapay/infra/scripts/backup.sh ru
```

The DoD is not "backups run". It is a **timed restore into a clean
environment**, performed monthly, with the number written down:

```bash
infra/scripts/restore.sh /var/backups/morapay/morapay-neutral-<stamp>.dump.age \
  postgresql://morapay:...@restore-test:5432/morapay_restore_test
```

The restore script prints the elapsed time and re-runs the ledger invariant
against the restored data. Both go in `docs/DISASTER_RECOVERY.md`. A backup
nobody has restored is a hypothesis, not a backup.

## Local development

```bash
pnpm stack:up      # Compose where a daemon exists, native Postgres/Redis otherwise
pnpm db:migrate
pnpm seed && pnpm demo:seed
pnpm dev
```

## Files

| Path                        | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `compose/local.yml`         | Postgres, Redis, Mailhog, MinIO for development                         |
| `compose/production.yml`    | The neutral tier: API, apps, Redis, nginx, certbot, Prometheus, Grafana |
| `docker/api.Dockerfile`     | Multi-stage, non-root, healthchecked API image                          |
| `docker/web.Dockerfile`     | Builds either front end via `ARG APP`                                   |
| `nginx/`                    | TLS termination, security headers, rate limits, per-host routing        |
| `observability/`            | Prometheus scrape config and the on-call alert rules                    |
| `scripts/backup.sh`         | Encrypted per-partition backup with an offsite copy                     |
| `scripts/restore.sh`        | Timed restore that verifies the ledger afterwards                       |
| `scripts/harden-host.sh`    | Everything above, as a script                                           |
| `scripts/smoke-transfer.sh` | End-to-end corridor test against a running API                          |
| `scripts/check-*.sh`        | The guardrail checks CI runs                                            |
