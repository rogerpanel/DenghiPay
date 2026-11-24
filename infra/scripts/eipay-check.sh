#!/usr/bin/env bash
# Integration checks for eipay on this server, after
#   TLS=1 EIPAY=1 infra/scripts/server-deploy.sh
#
# Run from the MoraPay repository root, as the user who deployed:
#
#   infra/scripts/eipay-check.sh
#
# Asks for the testers' password (or reads EIPAY_TEST_PASSWORD). Every check is
# read-only: it fetches pages and live rate quotes, and posts unsigned calls to
# the two callback paths to prove they are rejected. It creates no order, moves
# no money and prints no key.
#
# The result is written to ../eipay-check-<UTC time>.txt, outside the
# repository, for the integration report (docs/EIPAY_INTEGRATION.md §5). The
# report records what this printed; it is not filled in by hand.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PUBLIC_HOST="${PUBLIC_HOST:-$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')}"
HOST="${EIPAY_HOSTNAME:-eipay.${PUBLIC_HOST}.sslip.io}"
BASE="https://${HOST}"
USER_NAME="$(grep -E '^EIPAY_TEST_USER=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
[ -n "$USER_NAME" ] || { echo "✗ no EIPAY_TEST_USER in .env; deploy with EIPAY=1 first" >&2; exit 1; }
if [ -z "${EIPAY_TEST_PASSWORD:-}" ]; then
  read -rsp "Testers' password for ${USER_NAME}: " EIPAY_TEST_PASSWORD; echo
fi
AUTH=(-u "${USER_NAME}:${EIPAY_TEST_PASSWORD}")

OUT="$(cd "$ROOT/.." && pwd)/eipay-check-$(date -u +%Y%m%dT%H%M%SZ).txt"
pass=0; fail=0
log() { echo "$*" | tee -a "$OUT"; }
ok()  { pass=$((pass + 1)); log "PASS  $*"; }
bad() { fail=$((fail + 1)); log "FAIL  $*"; }

log "eipay integration checks"
log "time (UTC)      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "address         ${BASE}"
log "MoraPay commit  $(git rev-parse --short HEAD)"
EIPAY_SRC="${EIPAY_SRC:-$(cd "$ROOT/.." && pwd)/eipay}"
log "eipay commit    $(git -C "$EIPAY_SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
log ""

# 1. Running, and the MoraPay services still healthy next to it.
# Asked of Docker directly: `docker compose ps` needs the deploy script's
# environment (POSTGRES_PASSWORD, the origins) to read the compose file, and
# without it prints nothing, which reported a healthy stack as all stopped.
state="$(docker ps --filter label=com.docker.compose.project=morapay \
  --format '{{.Label "com.docker.compose.service"}} {{.State}}' 2>/dev/null)"
for s in eipay caddy api web admin postgres redis; do
  if echo "$state" | grep -qx "$s running"; then ok "service $s running"; else bad "service $s not running"; fi
done
if curl -s -m 8 "https://${PUBLIC_HOST}.sslip.io/api/health/ledger" | grep -q '"balanced":true'; then
  ok "MoraPay ledger still balanced"
else
  bad "MoraPay ledger health not confirmed"
fi

# 2. HTTPS and the testers' gate.
code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE/")"
[ "$code" = "401" ] && ok "no login → 401 (gate in place, certificate trusted)" || bad "no login → ${code}, expected 401"
hdrs="$(curl -s -o /dev/null -D - -m 10 -u "${USER_NAME}:wrong-password" "$BASE/" | tr -d '\r')"
code="$(echo "$hdrs" | awk 'NR==1{print $2}')"
if [ "$code" = "401" ] && ! echo "$hdrs" | grep -qi '^set-cookie: eipay_tester='; then
  ok "wrong password → 401, and no gate cookie"
else
  bad "wrong password → ${code}$(echo "$hdrs" | grep -qi '^set-cookie: eipay_tester=' && echo ', WITH the gate cookie')"
fi
hdrs="$(curl -s -o /dev/null -D - -m 20 "${AUTH[@]}" "$BASE/" | tr -d '\r')"
code="$(echo "$hdrs" | awk 'NR==1{print $2}')"
gate="$(echo "$hdrs" | grep -i '^set-cookie: eipay_tester=' | sed -E 's/^[^:]*: (eipay_tester=[^;]*).*/\1/' | head -1)"
[ "$code" = "200" ] && ok "tester login → home page 200" || bad "tester login → ${code}, expected 200"
# Once signed in, the browser carries the gate cookie instead of the password,
# so the sign-in box does not come back (infra/caddy/eipay.caddy).
if [ -n "$gate" ]; then
  code="$(curl -s -o /dev/null -m 20 -w '%{http_code}' -b "$gate" "$BASE/")"
  [ "$code" = "200" ] && ok "gate cookie alone → 200 (no repeated sign-in)" || bad "gate cookie alone → ${code}, expected 200"
else
  bad "tester login set no gate cookie; the sign-in box will keep coming back"
fi
code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -b 'eipay_tester=0000' "$BASE/")"
[ "$code" = "401" ] && ok "forged gate cookie → 401" || bad "forged gate cookie → ${code}, expected 401"
code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://${HOST}/")"
case "$code" in 301|308) ok "plain HTTP redirects to HTTPS (${code})" ;; *) bad "plain HTTP → ${code}, expected a redirect" ;; esac
code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://${PUBLIC_HOST}:${EIPAY_LOCAL_PORT:-3002}/" 2>/dev/null)"
if [ "$code" = "000" ]; then
  ok "eipay's own port is not reachable from the public address (only through the gate)"
else
  bad "eipay answers on http://${PUBLIC_HOST}:${EIPAY_LOCAL_PORT:-3002} (${code}): the gate can be bypassed"
fi

# 3. Live Paycrest rates through eipay's own API. Read-only quotes.
for cur in NGN KES UGX TZS; do
  body="$(curl -s -m 25 "${AUTH[@]}" "$BASE/api/v1/rates?token=USDT&amount=10&currency=${cur}&network=polygon")"
  if echo "$body" | grep -q '"success":true'; then
    rate="$(echo "$body" | grep -oE '"rate":"?[0-9.]+' | head -1)"
    ok "rate USDT→${cur} on polygon quoted (${rate})"
  else
    bad "rate USDT→${cur} on polygon: $(echo "$body" | head -c 160)"
  fi
done

# 4. Callback paths.
post_unsigned() {
  curl -s -o /dev/null -D - -m 10 -X POST -H 'content-type: application/json' --data '{}' "$BASE$1"
}
#    Smile ID's callback: reachable without the gate, refusing an unsigned call.
#    A 5xx means Smile ID is not configured yet: it fails closed, which is safe.
hdrs="$(post_unsigned /api/kyc/smile-id/callback)"
code="$(echo "$hdrs" | tr -d '\r' | awk 'NR==1{print $2}')"
if echo "$hdrs" | grep -qi '^www-authenticate: basic'; then
  bad "Smile ID callback is behind the testers' gate; Smile ID could not reach it"
elif [ "${code:-0}" -ge 400 ] 2>/dev/null; then
  ok "Smile ID callback open to the provider and refuses an unsigned call (${code}$([ "$code" -ge 500 ] && echo ', not configured yet'))"
else
  bad "Smile ID callback answered ${code:-nothing} to an unsigned call"
fi
#    nTZS webhook: unused while Tanzania goes through Paycrest, and it accepts
#    unsigned calls without NTZS_WEBHOOK_SECRET, so it must not be open.
hdrs="$(post_unsigned /api/webhooks/ntzs)"
code="$(echo "$hdrs" | tr -d '\r' | awk 'NR==1{print $2}')"
if echo "$hdrs" | grep -qi '^www-authenticate: basic'; then
  ok "nTZS webhook is behind the testers' gate"
elif [ "${code:-0}" -ge 400 ] 2>/dev/null; then
  ok "nTZS webhook refuses an unsigned call (${code})"
else
  bad "nTZS webhook answered ${code:-nothing} to an unsigned call from outside"
fi

log ""
log "result          ${pass} passed, ${fail} failed"
log "written to      ${OUT}"
log ""
log "Still to do by hand, recorded in docs/EIPAY_INTEGRATION.md §5: wallet sign-in,"
log "KYC tier 1, one small off-ramp per country with its Paycrest order id and tx hash."
[ "$fail" -eq 0 ]
