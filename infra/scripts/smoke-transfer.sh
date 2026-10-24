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
# CORRIDOR selects the leg. 214 exist: four inbound and a full African mesh.
#
#   RU-NG, RU-GH, BY-NG, BY-GH   rubles collected in Russia or Belarus
#   <A>-<B> for any two of        NG GH ZA CM BJ CD CG UG KE TZ ZM GM NE ML SN
#                                 — 210 corridors, every country to every other
#
# Each origin has its own demo sender, because a corridor is only offered to
# someone who lives where the collection happens. A ZA-* leg additionally
# carries an exchange-control declaration, without which the API refuses it.
#
# The simulator picks its behaviour from the last four digits of the recipient
# identifier, so the same scenario suffixes work on every corridor:
#
#   CORRIDOR=RU-NG infra/scripts/smoke-transfer.sh 0123456789 COMPLETED
#   CORRIDOR=RU-GH infra/scripts/smoke-transfer.sh 233241116666 REFUNDED
#   CORRIDOR=NG-ZA infra/scripts/smoke-transfer.sh
#   CORRIDOR=BJ-CM infra/scripts/smoke-transfer.sh
#   CORRIDOR=KE-TZ infra/scripts/smoke-transfer.sh
#   CORRIDOR=UG-GM infra/scripts/smoke-transfer.sh
#
# `infra/scripts/smoke-all-corridors.sh` runs every enabled corridor in turn.
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

# The recipient shape follows the destination; the sender, the amount and the
# collection rail follow the origin. Both are read off the corridor id rather
# than listed per corridor: fifteen countries is 210 pairs, and a table of
# thirty entries is the only version of this anyone can check.
DESTINATION="${CORRIDOR##*-}"

# Wallet destinations: msisdn, network, declared name. Thirteen of the fifteen.
# The numbers match the demo recipients and the domain's MSISDN_FORMAT — note
# Gambia is seven national digits and Niger and Mali are eight, against nine
# everywhere else.
case "$DESTINATION" in
  GH) W_MSISDN=233241234567; W_NETWORK=MTN;      W_NAME="KWAME MENSAH" ;;
  CM) W_MSISDN=237671234567; W_NETWORK=MTN;      W_NAME="MARIE NGONO" ;;
  BJ) W_MSISDN=22997123456;  W_NETWORK=MTN;      W_NAME="KOSSI DOSSOU" ;;
  CD) W_MSISDN=243812345678; W_NETWORK=MPESA;    W_NAME="AMANI KABILA" ;;
  CG) W_MSISDN=242061234567; W_NETWORK=MTN;      W_NAME="BRICE MAKAYA" ;;
  UG) W_MSISDN=256772345678; W_NETWORK=MTN;      W_NAME="SARAH NAKATO" ;;
  KE) W_MSISDN=254712345678; W_NETWORK=MPESA;    W_NAME="AMINA WANJIRU" ;;
  TZ) W_MSISDN=255754123456; W_NETWORK=MPESA;    W_NAME="NEEMA MWAKALINGA" ;;
  ZM) W_MSISDN=260971234567; W_NETWORK=MTN;      W_NAME="CHANDA MULENGA" ;;
  GM) W_MSISDN=2207012345;   W_NETWORK=AFRICELL; W_NAME="FATOU JALLOW" ;;
  NE) W_MSISDN=22790123456;  W_NETWORK=AIRTEL;   W_NAME="HADIZA SOULEY" ;;
  ML) W_MSISDN=22376123456;  W_NETWORK=ORANGE;   W_NAME="MOUSSA TRAORE" ;;
  SN) W_MSISDN=221771234567; W_NETWORK=ORANGE;   W_NAME="AMADOU DIOP" ;;
  *)  W_MSISDN=""; W_NETWORK=""; W_NAME="" ;;
esac

case "$DESTINATION" in
  NG)
    ACCOUNT="${1:-0123456789}"
    DECLARED="ADEBAYO OKONKWO"
    BANK_CODE="${BANK_CODE:-058}"
    DETAILS_FOR() {
      printf '{"method":"BANK_ACCOUNT","country":"NG","accountNumber":"%s","bankCode":"%s","declaredName":"%s"}' \
        "$ACCOUNT" "$BANK_CODE" "$1"
    }
    ;;
  ZA)
    # A South African universal branch code identifies the bank, not a branch.
    ACCOUNT="${1:-1234567890}"
    DECLARED="THABO MOLEFE"
    BANK_CODE="${BANK_CODE:-470010}"
    DETAILS_FOR() {
      printf '{"method":"BANK_ACCOUNT","country":"ZA","accountNumber":"%s","bankCode":"%s","declaredName":"%s"}' \
        "$ACCOUNT" "$BANK_CODE" "$1"
    }
    ;;
  *)
    if [ -z "$W_MSISDN" ]; then
      echo "unknown destination in CORRIDOR '$CORRIDOR'" >&2
      exit 64
    fi
    ACCOUNT="${1:-$W_MSISDN}"
    DECLARED="$W_NAME"
    NETWORK="${NETWORK:-$W_NETWORK}"
    DETAILS_FOR() {
      printf '{"method":"MOBILE_MONEY","country":"%s","msisdn":"%s","network":"%s","declaredName":"%s"}' \
        "$DESTINATION" "$ACCOUNT" "$NETWORK" "$1"
    }
    ;;
esac

ORIGIN="${CORRIDOR%%-*}"

# A corridor is only offered to someone who lives at its origin, so each origin
# has its own demo sender. Amounts are the sensible round number in each
# currency, in minor units — and that is the line to read twice: the CFA francs
# and the Ugandan shilling have NO minor unit, so 25000 there is twenty-five
# thousand francs, not two hundred and fifty. Dividing by a hundred is the
# classic error, and the result still looks like a plausible amount.
case "$ORIGIN" in
  RU|BY) EMAIL_DEFAULT=chidi@demo.morapay.local;  AMOUNT_DEFAULT=10000000;  RAIL=SBP ;;
  NG)    EMAIL_DEFAULT=folake@demo.morapay.local; AMOUNT_DEFAULT=5000000;   RAIL=VIRTUAL_ACCOUNT ;;
  GH)    EMAIL_DEFAULT=kofi@demo.morapay.local;   AMOUNT_DEFAULT=50000;     RAIL=MOBILE_MONEY ;;
  CM)    EMAIL_DEFAULT=marie@demo.morapay.local;  AMOUNT_DEFAULT=25000;     RAIL=MOBILE_MONEY ;;
  BJ)    EMAIL_DEFAULT=kossi@demo.morapay.local;  AMOUNT_DEFAULT=25000;     RAIL=MOBILE_MONEY ;;
  ZA)    EMAIL_DEFAULT=thandi@demo.morapay.local; AMOUNT_DEFAULT=50000;     RAIL=VIRTUAL_ACCOUNT ;;
  CD)    EMAIL_DEFAULT=amani@demo.morapay.local;  AMOUNT_DEFAULT=2500000;   RAIL=MOBILE_MONEY ;;
  CG)    EMAIL_DEFAULT=brice@demo.morapay.local;  AMOUNT_DEFAULT=25000;     RAIL=MOBILE_MONEY ;;
  # Whole shillings. UGX has no minor unit; its neighbours KES and TZS do.
  UG)    EMAIL_DEFAULT=sarah@demo.morapay.local;  AMOUNT_DEFAULT=100000;    RAIL=MOBILE_MONEY ;;
  KE)    EMAIL_DEFAULT=amina@demo.morapay.local;  AMOUNT_DEFAULT=500000;    RAIL=MOBILE_MONEY ;;
  TZ)    EMAIL_DEFAULT=neema@demo.morapay.local;  AMOUNT_DEFAULT=5000000;   RAIL=MOBILE_MONEY ;;
  ZM)    EMAIL_DEFAULT=chanda@demo.morapay.local; AMOUNT_DEFAULT=50000;     RAIL=MOBILE_MONEY ;;
  GM)    EMAIL_DEFAULT=fatou@demo.morapay.local;  AMOUNT_DEFAULT=150000;    RAIL=MOBILE_MONEY ;;
  NE)    EMAIL_DEFAULT=hadiza@demo.morapay.local; AMOUNT_DEFAULT=25000;     RAIL=MOBILE_MONEY ;;
  ML)    EMAIL_DEFAULT=moussa@demo.morapay.local; AMOUNT_DEFAULT=25000;     RAIL=MOBILE_MONEY ;;
  SN)    EMAIL_DEFAULT=amadou@demo.morapay.local; AMOUNT_DEFAULT=25000;     RAIL=MOBILE_MONEY ;;
  *)
    echo "unknown origin in CORRIDOR '$CORRIDOR'" >&2
    exit 64
    ;;
esac

EMAIL="${EMAIL:-$EMAIL_DEFAULT}"
AMOUNT="${AMOUNT:-$AMOUNT_DEFAULT}"
PAYIN_METHOD="${PAYIN_METHOD:-$RAIL}"

# South Africa became an origin in 4.3c. Every outward rand payment carries a
# balance-of-payments category and counts against the sender's annual
# allowance, so the create call needs a declaration block — a ZA-* transfer
# without one is refused with EXCHANGE_CONTROL_CATEGORY_REQUIRED, by design.
# 417, migrant worker remittance. Discretionary allowance, no tax clearance.
if [ "$ORIGIN" = "ZA" ]; then
  EXCHANGE_CONTROL_CATEGORY="${EXCHANGE_CONTROL_CATEGORY:-417}"
fi

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
# Only origins with an exchange-control regime carry a declaration. Sending an
# empty block on the others would fail validation rather than be ignored.
DECLARATION=""
if [ -n "${EXCHANGE_CONTROL_CATEGORY:-}" ]; then
  DECLARATION=",\"exchangeControl\":{\"categoryCode\":\"$EXCHANGE_CONTROL_CATEGORY\",\"declaredElsewhereMinorUnits\":\"${EXCHANGE_CONTROL_ELSEWHERE:-0}\",\"declarationAccepted\":true}"
  echo "   declared    BoP $EXCHANGE_CONTROL_CATEGORY, ${EXCHANGE_CONTROL_ELSEWHERE:-0} used elsewhere"
fi
TRANSFER=$(curl -sS -X POST "$API/transfers" -H "$AUTH" -H 'content-type: application/json' \
  -H "idempotency-key: smoke-$(date +%s)-$RANDOM" \
  -d "{\"quoteId\":\"$QUOTE_ID\",\"recipientId\":\"$RECIPIENT_ID\",\"payinMethod\":\"$PAYIN_METHOD\",\"purpose\":\"FAMILY_SUPPORT\",\"confirmedRecipientName\":\"$RESOLVED\"$DECLARATION}")
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
