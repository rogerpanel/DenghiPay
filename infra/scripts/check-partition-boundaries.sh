#!/usr/bin/env bash
# Guardrail G8 / BUILD_PLAN 12.1, enforced in CI.
#
# Data residency is partitioned: RU, NG, GH and a neutral tier. Only tokenised,
# non-identifying references cross a boundary. This script fails the build if
# neutral-tier code imports from a partition module, or if one partition imports
# from another.
set -euo pipefail

fail=0
PARTITION_ROOT="apps/api/src/partitions"

if [ ! -d "$PARTITION_ROOT" ]; then
  echo "OK: no partition modules present yet."
  exit 0
fi

echo "→ neutral-tier code must not import partition modules directly"
# Everything outside partitions/ and outside the partition gateway may not reach in.
offenders=$(grep -rn --include='*.ts' -E "from ['\"].*partitions/(ru|ng|gh)/" apps packages 2>/dev/null \
  | grep -v "^${PARTITION_ROOT}/" \
  | grep -v "partition-gateway" || true)
if [ -n "$offenders" ]; then
  echo "$offenders"
  echo "FAIL: partition internals are reachable outside the partition gateway."
  fail=1
fi

echo "→ partitions must not import each other"
for a in ru ng gh; do
  for b in ru ng gh; do
    [ "$a" = "$b" ] && continue
    offenders=$(grep -rn --include='*.ts' -E "from ['\"].*partitions/${b}/" "${PARTITION_ROOT}/${a}" 2>/dev/null || true)
    if [ -n "$offenders" ]; then
      echo "$offenders"
      echo "FAIL: partition ${a} imports from partition ${b}."
      fail=1
    fi
  done
done

if [ "$fail" -eq 0 ]; then
  echo "OK: partition boundaries intact."
fi
exit "$fail"
