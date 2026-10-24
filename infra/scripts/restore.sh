#!/usr/bin/env bash
# Restore, and time it (BUILD_PLAN 12.7).
#
# The DoD for step 12.7 is not "backups exist" — it is that a full restore into
# a clean environment has been performed and timed, with the result recorded in
# docs/. This script does the restore and prints the number that goes in the
# document. Run it monthly.
#
#   usage: restore.sh <backup-file.age> <target-database-url>
set -euo pipefail

BACKUP="${1:?usage: restore.sh <backup-file.age> <target-database-url>}"
TARGET_URL="${2:?usage: restore.sh <backup-file.age> <target-database-url>}"
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is not set}"

if [[ "$TARGET_URL" == *"morapay?"* ]] || [[ "$TARGET_URL" == *"/morapay" ]]; then
  echo "REFUSING: that looks like the production database." >&2
  echo "Restore into a clean database and switch over deliberately." >&2
  exit 1
fi

START="$(date +%s)"

if [ -f "$BACKUP.sha256" ]; then
  echo "→ verifying checksum"
  sha256sum --check "$BACKUP.sha256"
fi

# Decrypt to a file rather than piping. `pg_restore --jobs` cannot read a
# custom-format archive from standard input — it needs to seek — and fails with
# "parallel restore from standard input is not supported". Piping and
# parallelism are mutually exclusive, and on a database of any size the
# parallelism is worth more.
#
# The cost is plaintext personal data on disk for the length of the restore, so
# it goes in a private directory that is removed however this script exits.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/morapay-restore.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "→ decrypting"
age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$WORK/dump.pgc" "$BACKUP"

echo "→ restoring into $TARGET_URL"
pg_restore --dbname "$TARGET_URL" --no-owner --no-acl --clean --if-exists \
  --jobs "${RESTORE_JOBS:-4}" "$WORK/dump.pgc"

END="$(date +%s)"
ELAPSED=$(( END - START ))

echo ""
echo "→ what was restored"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'ledger_account' AS table, count(*) FROM ledger_account
UNION ALL SELECT 'ledger_transaction', count(*) FROM ledger_transaction
UNION ALL SELECT 'ledger_entry', count(*) FROM ledger_entry
UNION ALL SELECT 'transfer', count(*) FROM transfer
UNION ALL SELECT 'audit_event', count(*) FROM audit_event;
SQL

# An empty ledger also balances, so "every currency nets to zero" on its own
# says nothing about whether the restore worked. Assert there is something
# there first, then assert it balances. Two questions, two checks.
ACCOUNTS="$(psql "$TARGET_URL" -tA -c 'SELECT count(*) FROM ledger_account')"
if [ "$ACCOUNTS" -eq 0 ]; then
  echo "✗ the restored database has no ledger accounts. That is an empty restore," >&2
  echo "  not a balanced one — an empty ledger balances trivially." >&2
  exit 1
fi

echo ""
echo "→ verifying the restored ledger balances"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT currency,
       SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor_units ELSE -amount_minor_units END) AS net
  FROM ledger_entry
 GROUP BY currency;
SQL

UNBALANCED="$(psql "$TARGET_URL" -tA -c "
  SELECT count(*) FROM (
    SELECT currency FROM ledger_entry GROUP BY currency
     HAVING sum(CASE WHEN direction = 'DEBIT' THEN amount_minor_units
                     ELSE -amount_minor_units END) <> 0
  ) AS u")"
if [ "$UNBALANCED" -ne 0 ]; then
  echo "✗ ${UNBALANCED} currencies do not net to zero in the restored data." >&2
  echo "  Do not switch over to this restore. Investigate before anything else." >&2
  exit 1
fi
echo "✓ every currency nets to zero, across ${ACCOUNTS} accounts"

echo ""
echo "Restore complete in ${ELAPSED}s."
echo "Record this in docs/DISASTER_RECOVERY.md:"
echo "  date        $(date -u +%Y-%m-%d)"
echo "  source      $(basename "$BACKUP")"
echo "  elapsed     ${ELAPSED}s"
echo "  net-per-currency must be zero in every row above"
