#!/usr/bin/env bash
# Run every enabled corridor end to end, and assert the ledger still balances.
#
# This is the evidence for BUILD_PLAN 4.3a: the whole mesh completes, in every
# direction, against simulated rails. It takes a few minutes — each transfer
# waits on the poll schedule — so it is a deliberate exercise rather than
# something to run on every save.
#
#   infra/scripts/smoke-all-corridors.sh
#
# Start from a clean database. Sending limits aggregate over real history and
# these runs are large relative to the tier-2 caps, so a second pass over the
# same database will start refusing transfers with LIMIT_EXCEEDED — the limits
# engine working, not a regression:
#
#   pnpm demo:reset && infra/scripts/smoke-all-corridors.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API="${API:-http://localhost:4000}"

# Every African country is both an origin and a destination: fifteen countries,
# 210 corridors. South Africa joined the left-hand side in 4.3c, when exchange
# control was built — outward rand payments carry a BoP category and count
# against the sender's allowance, which smoke-transfer.sh declares.
#
# COUNTRIES can be narrowed to run a subset:
#
#   COUNTRIES="NG GH ZA" infra/scripts/smoke-all-corridors.sh
#
# CYCLE=1 runs a single loop through every country instead of the full mesh —
# fifteen transfers rather than 210, with each country appearing once as an
# origin and once as a destination. That is the version to run routinely; the
# full mesh is an hour and will exhaust the tier-2 daily caps partway through,
# which is the limits engine working and not a regression.
read -r -a COUNTRY_LIST <<<"${COUNTRIES:-NG GH ZA CM BJ CD CG UG KE TZ ZM GM NE ML SN}"
ORIGINS=("${COUNTRY_LIST[@]}")
DESTINATIONS=("${COUNTRY_LIST[@]}")

CORRIDORS=()
if [ "${CYCLE:-0}" = "1" ]; then
  n=${#COUNTRY_LIST[@]}
  for ((i = 0; i < n; i++)); do
    CORRIDORS+=("${COUNTRY_LIST[i]}-${COUNTRY_LIST[(i + 1) % n]}")
  done
else
  for origin in "${ORIGINS[@]}"; do
    for destination in "${DESTINATIONS[@]}"; do
      [ "$origin" = "$destination" ] && continue
      CORRIDORS+=("${origin}-${destination}")
    done
  done
fi
echo "→ ${#CORRIDORS[@]} corridors"


PASSED=()
FAILED=()

for corridor in "${CORRIDORS[@]}"; do
  printf '\033[1m%-8s\033[0m ' "$corridor"

  # Each corridor gets its own idempotency space and its own sender, so the
  # runs are independent; a failure in one does not invalidate the rest.
  if output=$(CORRIDOR="$corridor" "$ROOT/infra/scripts/smoke-transfer.sh" 2>&1); then
    recipient=$(echo "$output" | grep -E '^   recipient ' | head -1 | sed 's/^   recipient *//')
    send=$(echo "$output" | grep -E '^   send ' | head -1 | sed 's/^   send *//')
    printf '\033[32m%s\033[0m  %s → %s\n' "COMPLETED" "$send" "$recipient"
    PASSED+=("$corridor")
  else
    reason=$(echo "$output" | grep -E 'FAIL|error|code' | head -1)
    printf '\033[31m%s\033[0m  %s\n' "FAILED" "$reason"
    FAILED+=("$corridor")
  fi
done

echo ""
echo "passed: ${#PASSED[@]}    failed: ${#FAILED[@]}"
[ ${#FAILED[@]} -gt 0 ] && printf '  failed: %s\n' "${FAILED[*]}"

echo ""
echo "Ledger invariant across every currency:"
curl -sS "$API/health/ledger"
echo

# A corridor that completes while the ledger drifts is worse than one that
# fails, so the exit status covers both.
balanced=$(curl -sS "$API/health/ledger" | grep -o '"balanced":true' || true)
if [ -z "$balanced" ]; then
  echo "✗ the ledger does not report itself balanced" >&2
  exit 1
fi
[ ${#FAILED[@]} -eq 0 ] || exit 1
echo "✓ every corridor completed and the ledger nets to zero in every currency"
