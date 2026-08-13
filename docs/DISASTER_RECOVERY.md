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
timed, with the result recorded here. **This table is empty because no rehearsal
has been performed.** It is a gate for the pilot, not for the demonstration.

| Date | Partition | Backup | Elapsed | Ledger balanced | Performed by | Notes            |
| ---- | --------- | ------ | ------- | --------------- | ------------ | ---------------- |
| —    | —         | —      | —       | —               | —            | No rehearsal yet |

A backup nobody has restored is a hypothesis. Until there is a row in this
table, assume the backups do not work.

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
