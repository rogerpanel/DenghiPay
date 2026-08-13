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

echo "→ decrypting and restoring into $TARGET_URL"
age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$BACKUP" \
  | pg_restore --dbname "$TARGET_URL" --no-owner --no-acl --clean --if-exists --jobs 4

END="$(date +%s)"
ELAPSED=$(( END - START ))

echo ""
echo "→ verifying the restored ledger balances"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT currency,
       SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor_units ELSE -amount_minor_units END) AS net
  FROM ledger_entry
 GROUP BY currency;
SQL

echo ""
echo "Restore complete in ${ELAPSED}s."
echo "Record this in docs/DISASTER_RECOVERY.md:"
echo "  date        $(date -u +%Y-%m-%d)"
echo "  source      $(basename "$BACKUP")"
echo "  elapsed     ${ELAPSED}s"
echo "  net-per-currency must be zero in every row above"
