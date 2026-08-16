#!/usr/bin/env bash
# End-to-end smoke test against a running API.
#
# Drives the full journey the way the web app does — sign in, quote, name
# enquiry, confirm, pay, poll — and asserts the outcome at each step. This is
# the evidence for BUILD_PLAN 6.1 ("full transfer lifecycle runs locally with
# zero external dependencies") and 7.1 ("both corridors complete end to end").
#
#   usage: infra/scripts/smoke-transfer.sh [recipient-identifier] [expected-final-state]
#
# CORRIDOR selects the leg. Four run today:
#
#   RU-NG  rubles collected in Russia   → a ten-digit Nigerian NUBAN
#   RU-GH  rubles collected in Russia   → a Ghanaian wallet (233 + nine digits)
#   NG-GH  naira pushed to a NUBAN      → a Ghanaian wallet
#   GH-NG  a cedi wallet debited        → a Nigerian bank account
#
# The last two are the intra-African pair, and they use their own senders,
# because a corridor is only offered to someone who lives at its origin.
# The simulator picks its behaviour from the last four digits of the recipient
# identifier, so the same scenario suffixes work on every corridor:
#
#   CORRIDOR=RU-NG infra/scripts/smoke-transfer.sh 0123456789 COMPLETED
#   CORRIDOR=RU-GH infra/scripts/smoke-transfer.sh 233241116666 REFUNDED
#   CORRIDOR=NG-GH infra/scripts/smoke-transfer.sh
#   CORRIDOR=GH-NG infra/scripts/smoke-transfer.sh
#
# Sending limits aggregate over real transfer history, so repeated runs against
# one database eventually exhaust the sender's daily cap and the script stops
# with LIMIT_EXCEEDED — the limits engine working, not a regression. Either
# lower AMOUNT, or start from a clean database with `pnpm demo:reset`.
set -euo pipefail

API="${API:-http://localhost:4000}"
PASSWORD="${PASSWORD:-morapay-demo-2026}"
CORRIDOR="${CORRIDOR:-RU-NG}"
EXPECT="${2:-COMPLETED}"
BANK_CODE="${BANK_CODE:-058}"
NETWORK="${NETWORK:-MTN}"

# The recipient shape follows the destination; the sender, the amount and the
# collection rail follow the origin. Both are read off the corridor id rather
# than listed per corridor, so a new pair is two cases, not a rewrite.
DESTINATION="${CORRIDOR##*-}"
case "$DESTINATION" in
  NG)
    ACCOUNT="${1:-0123456789}"
    DECLARED="ADEBAYO OKONKWO"
    DETAILS_FOR() {
      printf '{"method":"BANK_ACCOUNT","country":"NG","accountNumber":"%s","bankCode":"%s","declaredName":"%s"}' \
        "$ACCOUNT" "$BANK_CODE" "$1"
    }
    ;;
  GH)
    ACCOUNT="${1:-233241234567}"
    DECLARED="KWAME MENSAH"
    DETAILS_FOR() {
      printf '{"method":"MOBILE_MONEY","country":"GH","msisdn":"%s","network":"%s","declaredName":"%s"}' \
        "$ACCOUNT" "$NETWORK" "$1"
    }
    ;;
  *)
    echo "unknown destination in CORRIDOR '$CORRIDOR' (expected a -NG or -GH corridor)" >&2
    exit 64
    ;;
esac

case "$CORRIDOR" in
  # A corridor is only offered to someone who lives at its origin, so each
  # origin has its own demo sender. Amounts are the sensible round number in
  # each currency, in minor units: 100 000,00 ₽, ₦50 000,00, GH₵500,00.
  RU-*)
    EMAIL="${EMAIL:-chidi@demo.morapay.local}"
    AMOUNT="${AMOUNT:-10000000}"
    PAYIN_METHOD="${PAYIN_METHOD:-SBP}"
    ;;
  NG-*)
    EMAIL="${EMAIL:-folake@demo.morapay.local}"
    AMOUNT="${AMOUNT:-5000000}"
    PAYIN_METHOD="${PAYIN_METHOD:-VIRTUAL_ACCOUNT}"
    ;;
  GH-*)
    EMAIL="${EMAIL:-kofi@demo.morapay.local}"
    AMOUNT="${AMOUNT:-50000}"
    PAYIN_METHOD="${PAYIN_METHOD:-MOBILE_MONEY}"
    ;;
  *)
    echo "unknown origin in CORRIDOR '$CORRIDOR'" >&2
    exit 64
    ;;
esac

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

# Tiny JSON reader: jqr "accessToken" or jqr "sendAmount.formatted"
#
# Prints nothing when the key is absent, rather than raising. The API answers
# errors with a different shape ({"code": "LIMIT_EXCEEDED", ...}), and a
# traceback about a missing 'reference' key tells you nothing about why; an
# empty result lets the caller's own `fail` print the response the API actually
# sent.
jqr() {
  python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    for key in sys.argv[1].split("."):
        d = d[key]
except (ValueError, KeyError, TypeError, IndexError):
    sys.exit(0)
print(d)
' "$1"
}

say "1. Sign in as $EMAIL"
TOKEN=$(curl -sS -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jqr "accessToken")
[ -n "$TOKEN" ] || fail "no access token"
AUTH="authorization: Bearer $TOKEN"
echo "   signed in"

say "2. Name enquiry on $CORRIDOR for $ACCOUNT"
ENQUIRY=$(curl -sS -X POST "$API/recipients/name-enquiry" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"details\":$(DETAILS_FOR "$DECLARED")}")
STATUS=$(echo "$ENQUIRY" | jqr "status")
echo "   $STATUS"
if [ "$STATUS" != "RESOLVED" ]; then
  echo "   $(echo "$ENQUIRY" | jqr "reason")"
  [ "$EXPECT" = "NAME_NOT_FOUND" ] && { echo "   expected — the sender is stopped before committing"; exit 0; }
  fail "name enquiry did not resolve"
fi
RESOLVED=$(echo "$ENQUIRY" | jqr "resolvedName")
echo "   resolved to: $RESOLVED"

say "3. Save the recipient"
RECIPIENT_ID=$(curl -sS -X POST "$API/recipients" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"details\":$(DETAILS_FOR "$RESOLVED"),\"nickname\":\"Smoke test\"}" \
  | jqr "id")
echo "   $RECIPIENT_ID"

say "4. Quote $AMOUNT minor units on $CORRIDOR"
QUOTE=$(curl -sS -X POST "$API/quotes" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"corridorId\":\"$CORRIDOR\",\"sendMinorUnits\":\"$AMOUNT\"}")
QUOTE_ID=$(echo "$QUOTE" | jqr "id")
[ -n "$QUOTE_ID" ] || fail "no quote: $QUOTE"
echo "   send        $(echo "$QUOTE" | jqr "sendAmount.formatted")"
echo "   fixed fee   $(echo "$QUOTE" | jqr "fixedFee.formatted")"
echo "   fx margin   $(echo "$QUOTE" | jqr "fxMargin.formatted")  ($(echo "$QUOTE" | jqr "fxMarginBps") bps)"
echo "   total cost  $(echo "$QUOTE" | jqr "totalCost.formatted")"
echo "   mid rate    $(echo "$QUOTE" | jqr "midRate")"
echo "   our rate    $(echo "$QUOTE" | jqr "effectiveRate")"
echo "   recipient   $(echo "$QUOTE" | jqr "recipientAmount.formatted")"

say "5. Confirm the transfer"
TRANSFER=$(curl -sS -X POST "$API/transfers" -H "$AUTH" -H 'content-type: application/json' \
  -H "idempotency-key: smoke-$(date +%s)-$RANDOM" \
  -d "{\"quoteId\":\"$QUOTE_ID\",\"recipientId\":\"$RECIPIENT_ID\",\"payinMethod\":\"$PAYIN_METHOD\",\"purpose\":\"FAMILY_SUPPORT\",\"confirmedRecipientName\":\"$RESOLVED\"}")
REFERENCE=$(echo "$TRANSFER" | jqr "reference")
[ -n "$REFERENCE" ] || fail "no transfer: $TRANSFER"
echo "   $REFERENCE  state=$(echo "$TRANSFER" | jqr "state")  ($(echo "$TRANSFER" | jqr "senderStatus"))"

if [ "$EXPECT" = "ON_HOLD" ]; then
  STATE=$(echo "$TRANSFER" | jqr "state")
  [ "$STATE" = "ON_HOLD" ] || fail "expected ON_HOLD, got $STATE"
  echo "   blocked by the compliance gate, as expected (guardrail G3)"
  exit 0
fi

say "6. Sender pays (simulator)"
sleep 2
PAY=$(curl -sS -X POST "$API/simulator/payin/$REFERENCE/pay" -H "$AUTH")
echo "   $PAY"

say "7. Poll to a terminal state"
for i in $(seq 1 30); do
  STATE=$(curl -sS "$API/transfers" -H "$AUTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
t=[x for x in d['transfers'] if x['reference']=='$REFERENCE'][0]
print(t['state'])")
  printf '   %-2s %s\n' "$i" "$STATE"
  case "$STATE" in
    COMPLETED|REFUNDED|FAILED) break ;;
  esac
  sleep 2
done

say "Result"
if [ "$STATE" = "$EXPECT" ]; then
  echo "   $REFERENCE reached $STATE as expected"
else
  fail "$REFERENCE reached $STATE, expected $EXPECT"
fi

say "Ledger invariant"
curl -sS "$API/health/ledger"
echo
