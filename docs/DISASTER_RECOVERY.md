# Disaster recovery

## Objectives

| Partition                          | RPO        | RTO     | Rationale                                                                                                                               |
| ---------------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Neutral (ledger, transfers, audit) | 15 minutes | 2 hours | The ledger is the record of what we owe. Losing 24 hours of it is unrecoverable in a way that losing 24 hours of most databases is not. |
| RU / NG / GH (personal data)       | 24 hours   | 8 hours | Personal data changes rarely after onboarding. A day's loss means re-verifying a handful of people.                                     |

The 15-minute neutral RPO needs continuous archiving, not nightly dumps.
Nightly `pg_dump` is what exists today, so **the current neutral RPO is 24
hours**. Closing that gap is a WAL-archiving change and is tracked in
`docs/OPEN_ITEMS.md` P2.

## What is backed up

- All four PostgreSQL databases, encrypted with `age` before leaving the host.
- Vault secrets — separately, under their own control, never in these backups.
- Not: container images (rebuildable from a tagged commit) or Redis (queue
  state; the saga resumes from PostgreSQL).

## Procedure

```bash
# Nightly, per partition.
BACKUP_AGE_RECIPIENT=age1... infra/scripts/backup.sh neutral
BACKUP_AGE_RECIPIENT=age1... infra/scripts/backup.sh ru

# Monthly rehearsal, into a clean database — never the live one.
BACKUP_AGE_IDENTITY=/path/to/key infra/scripts/restore.sh \
  /var/backups/morapay/morapay-neutral-<stamp>.dump.age \
  postgresql://morapay:...@restore-test:5432/morapay_restore_test
```

The restore script verifies the checksum, restores, re-runs the ledger
invariant against the restored data, and prints the elapsed time.

## Rehearsal log

BUILD_PLAN 12.7 requires a full restore into a clean environment, performed and
timed, with the result recorded here.

| Date       | Partition | Backup                     | Elapsed | Ledger balanced           | Rows restored                                 | Notes                                                       |
| ---------- | --------- | -------------------------- | ------- | ------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| 2026-08-16 | neutral   | `morapay-neutral-…204609Z` | < 1 s   | Yes — RUB, NGN, GHS all 0 | 20 accounts, 39 txns, 84 entries, 7 transfers | First rehearsal. **Found two blocking defects** — see below |

**The elapsed time is not yet meaningful.** The database held one afternoon of
demonstration data, so under a second says nothing about a restore at pilot
volume. It becomes a real number when this is repeated against a database
carrying a year of simulated transfers, which is the same exercise as the load
test (BUILD_PLAN 13.4) and should be done in the same sitting.

### What the first rehearsal found

Both defects meant the backup and restore path had never worked, and neither
would have been discovered by inspection — only by running it.

**Every backup was empty, and reported success.** Prisma connection strings
carry `?schema=public`, which libpq does not accept: `pg_dump` stopped with
`invalid URI query parameter: "schema"` and left a 200-byte file that looked
like a backup. Every `DATABASE_URL` this project generates has that parameter —
`.env.example` and `server-deploy.sh` both. `backup.sh` now strips the
Prisma-only parameters, removes any partial file on failure, and refuses to keep
a dump below a size floor.

**The restore could not run at all.** `pg_restore --jobs 4` cannot read a
custom-format archive from standard input; it needs to seek, and stops with
`parallel restore from standard input is not supported`. The script piped
`age --decrypt` straight into it, so it failed every time. It now decrypts to a
private temporary directory, restores from the file, and removes the plaintext
however it exits.

**And the verification would have passed on an empty database.** "Every
currency nets to zero" is trivially true of a ledger with no rows, so a restore
that produced nothing would have looked like a clean one. The check now asserts
the restore is non-empty before asserting that it balances — two questions, two
checks — and prints the row counts so the result can be compared against the
source by eye.

A backup nobody has restored is a hypothesis. This one was wrong twice.

## Recovery scenarios

**Database lost, host intact.** Restore the most recent backup into a new
database, point `DATABASE_URL` at it, restart. Reconcile against partner
statements for the window between the backup and the failure — the partner's
record is authoritative for that gap.

**Host lost.** Provision a new server (`infra/scripts/harden-host.sh`), restore
each partition, redeploy the tagged image, re-issue certificates. Expect two
hours, most of it certificate issuance and DNS propagation.

**Region lost.** The partitions are already in different jurisdictions, so a
single-region loss takes out the neutral tier only — and the neutral tier is
the rebuildable part, given its backup.

**Ledger corruption suspected.** Do not restore first. Run
`GET /health/ledger` and the drift detector; the append-only constraints mean
corruption is far more likely to be a reasoning error than a data error.
Restoring over a correct ledger to fix a misunderstanding is the worse outcome.
