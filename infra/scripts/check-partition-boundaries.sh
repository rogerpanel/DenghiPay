#!/usr/bin/env bash
# Guardrail G8 / BUILD_PLAN 12.1, enforced in CI.
#
# Data residency is partitioned: sixteen residencies plus a neutral tier. Only
# tokenised, non-identifying references cross a boundary. This script fails the
# build if neutral-tier code imports from a partition module, or if one country
# partition imports from another.
#
# The partition list is discovered from the directory rather than written here.
# It used to be a hardcoded "ru ng gh" and silently stopped covering ZA, CM and
# BJ the moment they were added — a check that quietly narrows as the thing it
# guards grows is worse than no check, because it still reports OK.
set -euo pipefail

fail=0
PARTITION_ROOT="apps/api/src/partitions"

if [ ! -d "$PARTITION_ROOT" ]; then
  echo "OK: no partition modules present yet."
  exit 0
fi

# Country partitions are the two-letter directories. `standard/` is deliberately
# not one: it is shared code serving ten schemas, and it is checked below on the
# same terms as any partition.
partitions=$(find "$PARTITION_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
  | grep -E '^[a-z]{2}$' | sort)

if [ -z "$partitions" ]; then
  echo "FAIL: no partition directories found under ${PARTITION_ROOT}."
  exit 1
fi
echo "→ partitions: $(echo "$partitions" | tr '\n' ' ')"

# Anything reachable from outside must go through the gateway. `standard` is in
# this list because a caller holding StandardPartitionRepository could address
# any of ten residencies directly.
guarded=$(printf '%s\nstandard\n' "$partitions" | paste -sd'|' -)

echo "→ neutral-tier code must not import partition modules directly"
# The seed scripts are the one exemption, and a narrow one: they populate the
# partitions on purpose, the same way the migrations create them, and they run
# only against a development database — the seed refuses to run at all when
# NODE_ENV is production. They were already writing to partition tables through
# raw Prisma delegates, which this check never saw; going through the shared
# repository instead means the fixtures and the application cannot disagree
# about which schema a residency belongs to. They did disagree, and ten
# countries' senders were written into partition_ru.
offenders=$(grep -rn --include='*.ts' -E "from ['\"].*partitions/(${guarded})/" apps packages 2>/dev/null \
  | grep -v "^${PARTITION_ROOT}/" \
  | grep -v "partition-gateway" \
  | grep -v "partitions.module" \
  | grep -vE "^apps/api/prisma/[a-z-]*seed\.ts:" || true)
if [ -n "$offenders" ]; then
  echo "$offenders"
  echo "FAIL: partition internals are reachable outside the partition gateway."
  fail=1
fi

echo "→ partitions must not import each other"
for a in $partitions; do
  for b in $partitions; do
    [ "$a" = "$b" ] && continue
    offenders=$(grep -rn --include='*.ts' -E "from ['\"].*partitions/${b}/" "${PARTITION_ROOT}/${a}" 2>/dev/null || true)
    if [ -n "$offenders" ]; then
      echo "$offenders"
      echo "FAIL: partition ${a} imports from partition ${b}."
      fail=1
    fi
  done
done

# A country partition must not reach into the shared repository either. The ten
# standard partitions have no directory of their own, so nothing here should
# ever match; it exists so that a hand-written partition cannot quietly start
# borrowing another residency's table through the shared delegate map.
echo "→ country partitions must not import the shared standard repository"
for a in $partitions; do
  offenders=$(grep -rn --include='*.ts' -E "from ['\"].*standard/" "${PARTITION_ROOT}/${a}" 2>/dev/null || true)
  if [ -n "$offenders" ]; then
    echo "$offenders"
    echo "FAIL: partition ${a} imports the shared standard repository."
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "OK: partition boundaries intact."
fi
exit "$fail"
