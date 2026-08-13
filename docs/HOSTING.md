# What to buy

Sizing for the Hetzner box. Prices below are USD per month excluding VAT, read
from the Hetzner console for Helsinki on 2026-08-13. They change; the reasoning
does not.

## What actually runs on it

The Hetzner server is the **neutral tier**, not the whole system.
`TECHNICAL_ARCHITECTURE` §2.5 puts the RU, NG and GH partitions in their own
jurisdictions, and Hetzner has no region in any of the three. It hosts no
Russian sender PII and no Nigerian payment data; only tokenised references
reach it.

That is a legal constraint rather than a preference — 152-FZ requires personal
data of Russian citizens to be stored on servers in Russia, and no amount of
server sizing changes it. It also means this box is smaller than a
"host everything" box would be, and that a Russian host is a separate purchase
later, not part of this decision.

From `infra/compose/production.yml`, on this server:

| Service            | Steady memory | Note                                                    |
| ------------------ | ------------- | ------------------------------------------------------- |
| PostgreSQL 16      | 1.5–2 GB      | Not in the compose file — see below                     |
| API + saga workers | 0.5–1 GB      | Node; the poll schedule is the busy part                |
| Sender app (Next)  | 0.3–0.5 GB    |                                                         |
| Back office (Next) | 0.3–0.5 GB    |                                                         |
| Redis              | 0.25 GB       | Queues only; the saga resumes from PostgreSQL           |
| Prometheus         | 0.5–1 GB      | Grows with retention. The largest surprise on this list |
| Grafana            | 0.25 GB       |                                                         |
| nginx, certbot     | negligible    |                                                         |
| OS + Docker        | 0.5–1 GB      |                                                         |
| **Total**          | **~5–6 GB**   | Before headroom                                         |

**PostgreSQL is not in the production compose file.** It expects `DATABASE_URL`
to point somewhere. Hetzner has no managed PostgreSQL, so in practice it runs on
this same host, and the sizing above assumes that. If you later move it to its
own server, this box drops by about 2 GB and gains a network hop on every ledger
write.

## The recommendation

**CX33 — 4 vCPU, 8 GB, 80 GB, $9.99 plus $0.60 for the IPv4 address.**

It is the smallest box that fits the list above without swapping, and swapping a
database is how a healthy system starts looking mysteriously slow. CX23's 4 GB
does not fit.

### CX33 against CPX32, at list price

Both are 4 vCPU and 8 GB. The relevant lines, Helsinki:

| Type     | vCPU | RAM   | SSD    | Per month | Notes                            |
| -------- | ---- | ----- | ------ | --------- | -------------------------------- |
| CX23     | 2    | 4 GB  | 40 GB  | $6.49     | Too little memory                |
| **CX33** | 4    | 8 GB  | 80 GB  | **$9.99** | **Buy this**                     |
| CX43     | 8    | 16 GB | 160 GB | $18.49    | If you want to stop thinking     |
| CPX32    | 4    | 8 GB  | 160 GB | $41.99    | Same cores and RAM, 4× the price |

CPX32 costs **four times** CX33 for the same core count and the same memory. The
differences are 160 GB of disk instead of 80 GB, and newer AMD silicon.

Neither is worth $32 a month here. Disk is the weaker argument: at pilot volume
the neutral tier writes on the order of tens of megabytes a day, so 80 GB is
comfortably more than a year, and a Hetzner volume attaches later without
downtime if that changes. The faster core is the weaker argument still — see
below.

If the extra money is genuinely available, **CX43 is the better spend than
CPX32**: double the cores and double the memory of CPX32, for less than half the
price. But it is headroom you have no measurement suggesting you need.

**Do not size this on CPU.** The measured ledger benchmark is 938 writes per
second on four shared vCPUs, against a peak pilot demand under ten per second
(`docs/benchmarks/ledger.md`). CPU is about a hundred times oversupplied at
pilot volume, so paying a premium for faster cores buys nothing this workload
can use. Memory and disk are the binding constraints; the reason to have 4 vCPU
at all is `pnpm build` and the occasional Prometheus query.

One caveat on the Cost-Optimized line, which the console states plainly: it runs
on older hardware generations with **limited availability**. That is fine for a
single pilot server. It is worth remembering if the plan later calls for several
identical machines, because the type may not be orderable when you want the
second one.

### When live funds are switched on, move to dedicated vCPU

The shared-vCPU lines are genuinely fine for staging and a pilot. The argument
for a dedicated-vCPU type at go-live is not throughput, it is variance: a shared
vCPU loses time to whoever else is on the host, and two things here care. The
p99 on a money path is one. The other is `BUILD_PLAN` 13.4, which requires the
ledger benchmark re-run on production hardware — and a number that moves with
someone else's neighbour is not a number you can hold anyone to.

That is a resize rather than a migration, so starting on CX33 costs nothing in
rework.

## The operating system

Pick **Ubuntu 24.04 LTS** unless something specifically requires newer.

`infra/scripts/harden-host.sh` is written and tested against 24.04. It now
detects the case where Docker has not yet published an apt repository for a
brand-new Ubuntu codename and falls back automatically, so a newer release will
not leave you with a half-hardened host — but 24.04 is the path that has
actually been exercised, and a server is not where you want to be the first
person to try something.

## Also buy

- **Backups — tick the box.** It is 20% of the server price, so about $2 a month
  on CX33, and it is unticked by default in the create form. Hetzner's snapshots
  are for rebuilding a host rather than for the ledger, so they are in addition
  to, not instead of, the encrypted `age` dumps `DISASTER_RECOVERY.md` requires;
  `infra/scripts/backup.sh` writes those to a Storage Box for a few dollars more.
- **A volume, later, not now.** 80 GB is comfortable for a pilot, and volumes
  attach and grow without downtime, so there is no reason to pre-buy.
- **The Hetzner firewall,** to restrict port 22 to known addresses. It is free,
  it sits in front of the host rather than on it, and it is the last item the
  hardening script deliberately leaves to a human.

## Where

**Helsinki, Falkenstein or Nuremberg.** All three are EU, so data protection is
one regime, and all three sit reasonably between Russia and West Africa.
Helsinki is the closest to Russian senders and is a good default. Falkenstein is
the largest and the most likely to have capacity in an awkward size.

Do not pick Singapore or the US locations for this corridor. Both are worse for
both ends, and the US adds an unhelpful jurisdiction to a platform whose
sanctions posture is already the hard part.

## What this does not cover

The RU, NG and GH partitions. Those need hosts in their own jurisdictions and
are `OPEN_ITEMS.md` P8. Today they are separate schemas on the same PostgreSQL
instance, and the application already addresses them separately, so moving each
one is a connection string rather than a rewrite. It is still a separate
purchase, a separate legal question, and it is not this server.
