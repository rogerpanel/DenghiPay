#!/usr/bin/env bash
# Encrypted PostgreSQL backup, per partition (BUILD_PLAN 12.7).
#
# Encrypted before it leaves the host, because a backup of a remittance database
# is the same personal data as the database — and it usually lives somewhere
# with fewer controls.
#
#   usage: backup.sh <partition>            # neutral | ru | ng | gh
#   env:   BACKUP_DIR, BACKUP_AGE_RECIPIENT, OFFSITE_TARGET, RETENTION_DAYS
set -euo pipefail

PARTITION="${1:?usage: backup.sh <neutral|ru|ng|gh>}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/morapay}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

case "$PARTITION" in
  neutral) URL="${DATABASE_URL:?DATABASE_URL is not set}" ;;
  ru)      URL="${DATABASE_URL_RU:?DATABASE_URL_RU is not set}" ;;
  ng)      URL="${DATABASE_URL_NG:?DATABASE_URL_NG is not set}" ;;
  gh)      URL="${DATABASE_URL_GH:?DATABASE_URL_GH is not set}" ;;
  *) echo "unknown partition: $PARTITION" >&2; exit 64 ;;
esac

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set — refusing to write an unencrypted backup}"

mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/morapay-$PARTITION-$STAMP.dump.age"

echo "→ dumping $PARTITION"
# Custom format: parallel restore, selective restore, and it compresses.
pg_dump --format=custom --no-owner --no-acl --compress=9 "$URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$TARGET"

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "→ wrote $TARGET ($SIZE)"

# A checksum recorded next to the file, so a restore can prove it read what was
# written rather than a truncated copy.
sha256sum "$TARGET" > "$TARGET.sha256"

if [ -n "${OFFSITE_TARGET:-}" ]; then
  echo "→ copying offsite"
  rclone copy "$TARGET" "$OFFSITE_TARGET" --checksum
  rclone copy "$TARGET.sha256" "$OFFSITE_TARGET" --checksum
fi

echo "→ pruning local backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -name "morapay-$PARTITION-*.dump.age*" -mtime "+$RETENTION_DAYS" -delete

echo "OK  $PARTITION backup complete at $STAMP"
