#!/usr/bin/env bash
# Which Paycrest routes eipay can quote right now, per network — read-only.
#
#   infra/scripts/eipay-routes.sh
#
# Asks eipay's own rates endpoint on the server's loopback port (inside the
# testers' gate, so no password), for a 5-unit quote:
#   sell — stablecoin → fiat payout   (the off-ramp, and leg 2 of a remit)
#   buy  — fiat → stablecoin          (the on-ramp, and leg 1 of a remit)
# A rate means Paycrest has a provider for that route on that network now;
# anything else is printed as Paycrest's message. No order is created.
#
# Why it exists: eipay routes every cross-border remit through USDC on Base
# (hard-coded), and in October Base had payout providers only for NGN.
set -uo pipefail

PORT="${EIPAY_LOCAL_PORT:-3002}"
BASE_URL="http://127.0.0.1:${PORT}/api/v1/rates"
NETWORKS="${NETWORKS:-base polygon arbitrum-one bnb-smart-chain}"

curl -s -m 5 -o /dev/null "http://127.0.0.1:${PORT}/" || {
  echo "✗ eipay is not answering on 127.0.0.1:${PORT}; is it deployed?" >&2; exit 1; }

quote() { # side token currency network
  local body rate
  body="$(curl -s -m 25 "${BASE_URL}?token=$2&amount=5&currency=$3&network=$4&side=$1")"
  rate="$(echo "$body" | grep -oE '"rate": *"?[0-9.]+' | head -1 | sed -E 's/"rate": *"?//')"
  if echo "$body" | grep -qE '"success": *true' && [ -n "$rate" ]; then
    printf '%-12s' "$rate"
  else
    printf '%-12s' "none"
    echo "$body" | grep -oE '"(error|message)": *"[^"]{0,70}' | head -1 | sed -E 's/^"(error|message)": *"/      ↳ /' >> "$NOTES"
  fi
}

NOTES="$(mktemp)"; trap 'rm -f "$NOTES"' EXIT
echo "eipay routes via Paycrest, $(date -u +%Y-%m-%dT%H:%MZ), 5-unit quotes"
echo
printf '%-17s %-6s %-6s' "network" "side" "token"
for c in NGN KES UGX TZS; do printf '%-12s' "$c"; done; echo
for n in $NETWORKS; do
  for t in USDC USDT; do
    printf '%-17s %-6s %-6s' "$n" "sell" "$t"
    for c in NGN KES UGX TZS; do quote sell "$t" "$c" "$n"; done; echo
  done
  printf '%-17s %-6s %-6s' "$n" "buy" "USDC"
  for c in NGN KES UGX TZS; do quote buy USDC "$c" "$n"; done; echo
done
if [ -s "$NOTES" ]; then echo; echo "Paycrest's messages for the gaps (first of each):"; sort -u "$NOTES" | head -12; fi
echo
echo "A remit (e.g. NGN → UGX) needs 'buy' for the source currency and 'sell' for the"
echo "destination currency on the SAME network. eipay currently uses base for both."
