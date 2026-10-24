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

# Prisma's connection strings carry `?schema=`, which libpq does not know:
# pg_dump stops with `invalid URI query parameter: "schema"`. Every DATABASE_URL
# this project generates has it — .env.example and server-deploy.sh both — so
# without this every backup fails. Strip the parameters libpq rejects and keep
# the ones it needs, sslmode above all.
strip_prisma_params() {
  local url="$1" base="${1%%\?*}" query="" keep=""
  [ "$url" = "$base" ] && { printf '%s' "$url"; return; }
  query="${url#*\?}"
  local IFS='&' pair
  for pair in $query; do
    case "${pair%%=*}" in
      schema | connection_limit | pool_timeout | connect_timeout | socket_timeout | pgbouncer) ;;
      *) keep="${keep:+$keep&}$pair" ;;
    esac
  done
  printf '%s%s' "$base" "${keep:+?$keep}"
}
URL="$(strip_prisma_params "$URL")"

mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/morapay-$PARTITION-$STAMP.dump.age"

# A failed dump must not leave something that looks like a backup. Without
# this, a half-written .age file sits in the directory looking exactly like the
# real thing, and the next person to need it discovers the truth at the worst
# possible time.
cleanup_partial() {
  [ -f "$TARGET" ] && rm -f "$TARGET" "$TARGET.sha256"
  echo "✗ backup failed; removed the partial file at $TARGET" >&2
}
trap cleanup_partial ERR

echo "→ dumping $PARTITION"
# Custom format: parallel restore, selective restore, and it compresses.
pg_dump --format=custom --no-owner --no-acl --compress=9 "$URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$TARGET"

# An empty database still dumps to a few hundred bytes of header, so a floor
# this low only catches the case that matters: a dump that produced nothing at
# all while the pipeline reported success.
MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"
ACTUAL_BYTES="$(stat -c %s "$TARGET" 2>/dev/null || stat -f %z "$TARGET")"
if [ "$ACTUAL_BYTES" -lt "$MIN_BYTES" ]; then
  echo "✗ the backup is only ${ACTUAL_BYTES} bytes, below the ${MIN_BYTES}-byte floor." >&2
  echo "  That is an empty dump reported as a success. Refusing to keep it." >&2
  exit 1
fi

trap - ERR
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
