# What to buy

Sizing for the Hetzner box. Prices are approximate and exclude VAT — check the
current list before ordering, because Hetzner revises it.

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

**CX32 — 4 vCPU, 8 GB, 80 GB, around €7/month.** That is the direct answer to
"a little better than CX22", and it is the right shape: 4 GB would swap under
the list above, and swapping a database is how a healthy system starts looking
mysteriously slow.

`CPX31` (4 AMD vCPU, 8 GB, 160 GB, around €9) is the same money for twice the
disk and a faster core. Take it if the €2 is irrelevant — the extra disk is
worth more than it sounds, because the ledger and the audit chain are
append-only and never shrink.

**Do not size this on CPU.** The measured ledger benchmark is 938 writes per
second on four shared vCPUs against a peak pilot demand under ten per second
(`docs/benchmarks/ledger.md`). CPU is roughly a hundred times oversupplied at
pilot volume. Memory and disk are the binding constraints, and the reason to buy
4 vCPU is `pnpm build` and the odd Prometheus query, not transfers.

### When live funds are switched on, move to dedicated vCPU

**CCX23 — 4 dedicated vCPU, 16 GB, 160 GB, around €30/month.**

The shared-vCPU lines are genuinely fine for staging and a pilot. The argument
for dedicated at go-live is not throughput, it is variance: a shared vCPU can
lose time to a neighbour, and two things here care about that. The p99 on a
money path is one. The other is `BUILD_PLAN` 13.4, which requires the ledger
benchmark re-run on production hardware — and a number that moves depending on
what someone else's server is doing is not a number you can hold anyone to.

This is a resize, not a migration: Hetzner rebuilds in place from a snapshot,
and the CX and CCX lines are compatible. So starting on CX32 costs nothing in
rework.

## Also buy

- **Backups, +20% of the server price.** Hetzner's own snapshots are for
  rebuilding a host, not for the ledger. `DISASTER_RECOVERY.md` requires
  encrypted `age` dumps off the host as well — a Storage Box is about €4/month
  and `infra/scripts/backup.sh` already targets one.
- **A volume, later, not now.** 80 GB is comfortable for a pilot. Volumes attach
  and grow without downtime, so there is no reason to pre-buy.

## Where

**Falkenstein or Nuremberg (Germany), or Helsinki (Finland).** All three are EU,
so GDPR is one regime, and all three sit reasonably between Russia and West
Africa. Helsinki is marginally closer to Russian senders; Falkenstein is the
largest and most likely to have capacity in the size you want. Do not pick
Singapore or the US locations for this corridor — both are worse for both ends,
and the US adds an unhelpful jurisdiction to a platform whose whole
sanctions posture is already the hard part.

## What this does not cover

The RU, NG and GH partitions. Those need hosts in their own jurisdictions and
are `OPEN_ITEMS.md` P8. Today they are separate schemas on the same PostgreSQL
instance, and the application already addresses them separately, so moving each
one is a connection string rather than a rewrite. It is still a separate
purchase, a separate legal question, and it is not this server.
