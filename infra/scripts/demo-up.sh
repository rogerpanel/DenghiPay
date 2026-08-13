#!/usr/bin/env bash
# Bring up the whole demonstration stack, in the right order, and prove it.
#
# `pnpm dev` is for development. This is for standing in front of someone: it
# serves the production build of both front ends, which is what they will
# actually be shown, and it does not hand back control until it has fetched
# every page's stylesheet and confirmed the API answers.
#
# The ordering matters, which is the reason this script exists rather than a
# list of commands in a document. `next start` resolves asset filenames from the
# build that existed when it started. Rebuild underneath a running server and
# the HTML it serves will reference content-hashed chunks that are no longer on
# disk; the stylesheet 404s and the application renders as unstyled text — with
# no error in the console, because from the browser's point of view nothing went
# wrong. Build first, start second, verify third.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-3001}"
LOG_DIR="${LOG_DIR:-/tmp/morapay}"
ACTION="${1:-up}"

case "$ACTION" in
  up | reset | down) ;;
  *)
    echo "usage: $0 [up|reset|down]" >&2
    exit 64
    ;;
esac

mkdir -p "$LOG_DIR"

# Is anything answering HTTP on this port?
#
# Deliberately not `lsof` or `ss`. Both are unavailable or blind in enough
# environments — containers with a restricted /proc among them — that a check
# built on either reports "nothing is listening" about a server that is happily
# serving traffic. A TCP connection is the portable question, and it is also
# the question that matters: not "does a process exist" but "does this port
# answer".
port_answers() {
  local port="$1"
  curl -s -o /dev/null -m 2 "http://localhost:$port/" 2>/dev/null
  # 0 = answered, 7 = connection refused, 28 = timed out. Anything else (a 404,
  # a redirect, a hang-up mid-body) still means something is on the other end.
  [ "$?" != 7 ]
}

# Free a port, whoever holds it.
#
# Killing only the PIDs this script recorded is not enough, and the failure is
# a quiet one: a server left over from an earlier session keeps the port, the
# new one exits with EADDRINUSE into a log nobody reads, and every check below
# passes — against the stale process. The verification then certifies the wrong
# build. Ports are the resource that matters, so ports are what we clear.
free_port() {
  local port="$1"
  port_answers "$port" || return 0
  local pids
  pids="$( (lsof -t -i ":$port" -sTCP:LISTEN 2>/dev/null || true) | tr '\n' ' ')"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi
  for _ in $(seq 20); do
    port_answers "$port" || return 0
    sleep 0.5
  done
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
  sleep 1
}

stop_all() {
  for name in api web admin; do
    local pidfile="$LOG_DIR/$name.pid"
    [ -f "$pidfile" ] || continue
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  done
  free_port "$API_PORT"
  free_port "$WEB_PORT"
  free_port "$ADMIN_PORT"
  echo "→ stopped"
}

if [ "$ACTION" = "down" ]; then
  stop_all
  exit 0
fi

# Wait for a URL to answer with an expected status. Returns non-zero on timeout
# rather than hanging, because a demonstration that hangs is worse than one that
# fails while there is still time to fix it.
wait_for() {
  local url="$1" want="${2:-200}" tries="${3:-60}"
  for _ in $(seq "$tries"); do
    if [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" || echo 000)" = "$want" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# The check that would have caught the stale-build failure: fetch a page, pull
# out the stylesheet it references, and fetch that too. A 200 on the page alone
# proves nothing — the page renders either way.
verify_styled() {
  local label="$1" url="$2"
  local html css
  html="$(curl -s -m 10 "$url")"
  css="$(printf '%s' "$html" | grep -o '/_next/static/css/[A-Za-z0-9._-]*\.css' | head -1)"
  if [ -z "$css" ]; then
    echo "✗ $label: no stylesheet referenced by $url" >&2
    return 1
  fi
  local origin status
  origin="$(printf '%s' "$url" | cut -d/ -f1-3)"
  status="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$origin$css" || echo 000)"
  if [ "$status" != "200" ]; then
    echo "✗ $label: stylesheet $css returned $status — the page will render unstyled." >&2
    echo "  The server is serving an older build than the one on disk. Restart it." >&2
    return 1
  fi
  echo "✓ $label styled ($css)"
}

stop_all

echo "→ dependencies"
bash "$ROOT/infra/scripts/local-stack.sh" up

if [ "$ACTION" = "reset" ]; then
  # Sending limits are aggregated over real transfer history, which persists.
  # Rehearse the walkthrough three times on one database and the fourth run
  # meets "above your tier 2 limit" partway through the main thread — the
  # limits engine working exactly as designed, at the worst possible moment.
  # Resetting is the only way to start from a known position.
  echo "→ resetting the database (transfer history and ledger will be discarded)"
  pnpm db:reset >"$LOG_DIR/reset.log" 2>&1 || {
    echo "✗ reset failed; see $LOG_DIR/reset.log" >&2
    exit 1
  }
fi

echo "→ migrations and seed"
pnpm db:migrate >"$LOG_DIR/migrate.log" 2>&1
pnpm seed >"$LOG_DIR/seed.log" 2>&1
pnpm demo:seed >"$LOG_DIR/demo-seed.log" 2>&1

echo "→ build (before anything is started, deliberately)"
pnpm build >"$LOG_DIR/build.log" 2>&1 || {
  echo "✗ build failed; see $LOG_DIR/build.log" >&2
  exit 1
}

# Nothing may still hold a port at this point. If something does, `next start`
# fails with EADDRINUSE at the bottom of a log file while the old server keeps
# answering, and every check below then certifies whatever was already running.
# Refusing here, by name, is worth more than the seconds it costs.
for entry in "sender app:$WEB_PORT" "back office:$ADMIN_PORT" "API:$API_PORT"; do
  port="${entry##*:}"
  if port_answers "$port"; then
    echo "✗ port $port (${entry%%:*}) is still answering after the stop step." >&2
    echo "  Another instance is probably running. Stop it with 'pnpm demo:down'," >&2
    echo "  or set WEB_PORT / ADMIN_PORT / API_PORT to use different ports." >&2
    exit 1
  fi
done

echo "→ starting"
(cd "$ROOT/apps/api" && nohup node dist/main.js >"$LOG_DIR/api.log" 2>&1 & echo $! >"$LOG_DIR/api.pid")
(cd "$ROOT/apps/web" && nohup pnpm exec next start -p "$WEB_PORT" >"$LOG_DIR/web.log" 2>&1 & echo $! >"$LOG_DIR/web.pid")
(cd "$ROOT/apps/admin" && nohup pnpm exec next start -p "$ADMIN_PORT" >"$LOG_DIR/admin.log" 2>&1 & echo $! >"$LOG_DIR/admin.pid")

# Confirm the process we launched is still alive before trusting the port. A
# server that died on startup leaves the port to whatever held it before, and
# an HTTP check alone cannot tell the two apart.
#
# There is no separate "is the process alive" check, and that is deliberate.
# `pnpm exec` hands off to a child, so the launcher's PID stops meaning
# anything within seconds — a PID check calls a healthy server dead. The
# guarantee comes from the step above instead: every port was proven silent
# before anything was started, so whatever answers now is what this run
# started. The HTTP checks below are then sufficient on their own.
wait_for "http://localhost:$API_PORT/health" 200 120 || { echo "✗ API did not come up; see $LOG_DIR/api.log" >&2; tail -5 "$LOG_DIR/api.log" >&2; exit 1; }
wait_for "http://localhost:$WEB_PORT/login" 200 120 || { echo "✗ sender app did not come up; see $LOG_DIR/web.log" >&2; tail -5 "$LOG_DIR/web.log" >&2; exit 1; }
wait_for "http://localhost:$ADMIN_PORT/login" 200 120 || { echo "✗ back office did not come up; see $LOG_DIR/admin.log" >&2; tail -5 "$LOG_DIR/admin.log" >&2; exit 1; }

echo "→ verifying"
verify_styled "sender app" "http://localhost:$WEB_PORT/login"
verify_styled "back office" "http://localhost:$ADMIN_PORT/login"

if curl -s -m 10 "http://localhost:$API_PORT/health/ledger" | grep -q '"balanced":true'; then
  echo "✓ ledger balanced"
else
  echo "✗ ledger reports an imbalance — do not demonstrate until this is understood." >&2
  exit 1
fi

cat <<EOF

  Sender app          http://localhost:$WEB_PORT
  Back office         http://localhost:$ADMIN_PORT
  API documentation   http://localhost:$API_PORT/docs
  Ledger invariant    http://localhost:$API_PORT/health/ledger
  Mail outbox         http://localhost:$API_PORT/simulator/outbox

  Logs in $LOG_DIR · stop with: pnpm demo:down
EOF
