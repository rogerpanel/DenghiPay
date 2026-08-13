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
  up | reset | preview | down) ;;
  *)
    echo "usage: $0 [up|reset|preview|down]" >&2
    exit 64
    ;;
esac

# `preview` is `up`, reachable from other devices.
#
# The difference is one build-time value. NEXT_PUBLIC_API_URL is inlined into
# the client bundle, so the usual `http://localhost:4000` means a phone opening
# the app calls *itself* on port 4000 and every request fails. Building with
# `/api` makes the browser call whatever origin served the page, and the
# rewrite in next.config.js forwards it to the API server-side.
#
# The API is deliberately not exposed. Only the two front-end ports need to be
# reachable; the API stays on the loopback interface and is reached through the
# proxy, so a preview opened to a network exposes two ports rather than three.
if [ "$ACTION" = "preview" ]; then
  export NEXT_PUBLIC_API_URL="/api"
  export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"
  BIND="0.0.0.0"
else
  BIND="127.0.0.1"
fi

# Best-effort LAN address, for printing. Several ways because none of them work
# everywhere: `hostname -I` is Linux-only, `ip route` needs iproute2, and a
# machine behind a VPN can report an address nobody else can reach — which is
# why the script prints it as something to try rather than as a fact.
lan_address() {
  local ip=""
  ip="$( (hostname -I 2>/dev/null || true) | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' | head -1)"
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip="$( (ip -4 route get 1.1.1.1 2>/dev/null || true) | grep -oE 'src [0-9.]+' | awk '{print $2}' | head -1)"
  fi
  if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  fi
  printf '%s' "$ip"
}

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
(cd "$ROOT/apps/web" && nohup pnpm exec next start -H "$BIND" -p "$WEB_PORT" >"$LOG_DIR/web.log" 2>&1 & echo $! >"$LOG_DIR/web.pid")
(cd "$ROOT/apps/admin" && nohup pnpm exec next start -H "$BIND" -p "$ADMIN_PORT" >"$LOG_DIR/admin.log" 2>&1 & echo $! >"$LOG_DIR/admin.pid")

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

if [ "$ACTION" = "preview" ]; then
  # The check that decides whether anyone else can actually use this. A page
  # that renders proves nothing here: the failure is that the bundle calls an
  # API host the visitor's device cannot reach, and the page renders perfectly
  # right up until the first request. So ask the API a real question through
  # the front end's own origin, exactly as a visitor's browser will.
  for entry in "sender app:$WEB_PORT" "back office:$ADMIN_PORT"; do
    port="${entry##*:}"
    if curl -s -m 10 "http://localhost:$port/api/health" | grep -q '"status"'; then
      echo "✓ ${entry%%:*} reaches the API through its own origin (/api)"
    else
      echo "✗ ${entry%%:*} cannot reach the API through /api — visitors would see" >&2
      echo "  a page that loads and then fails on every request. The build may" >&2
      echo "  predate this mode; remove .next and run again." >&2
      exit 1
    fi
  done

  LAN="$(lan_address)"
  cat <<EOF

  On this machine
    Sender app        http://localhost:$WEB_PORT
    Back office       http://localhost:$ADMIN_PORT

EOF
  if [ -n "$LAN" ]; then
    cat <<EOF
  From a phone or another device on the same network
    Sender app        http://$LAN:$WEB_PORT
    Back office       http://$LAN:$ADMIN_PORT

  If those do not open, the machine's firewall is blocking the ports, or the
  network isolates clients from each other — guest and corporate wi-fi usually
  do. Tether the phone to the machine's hotspot, or use a tunnel.

EOF
  else
    cat <<EOF
  A local network address could not be determined automatically. Find it with
  'hostname -I' (Linux), 'ipconfig getifaddr en0' (macOS) or 'ipconfig'
  (Windows), then open http://<that-address>:$WEB_PORT from the other device.

EOF
  fi
  cat <<EOF
  For testers who are not on this network, put a tunnel in front of port
  $WEB_PORT. Any of these work, and none of them need a domain:

    cloudflared tunnel --url http://localhost:$WEB_PORT
    ngrok http $WEB_PORT
    ssh -R 80:localhost:$WEB_PORT nokey@localhost.run

  The API is deliberately not exposed — it stays on the loopback interface and
  is reached through the front end, so the tunnel only ever needs one port.

  Logs in $LOG_DIR · stop with: pnpm demo:down
EOF
  exit 0
fi

cat <<EOF

  Sender app          http://localhost:$WEB_PORT
  Back office         http://localhost:$ADMIN_PORT
  API documentation   http://localhost:$API_PORT/docs
  Ledger invariant    http://localhost:$API_PORT/health/ledger
  Mail outbox         http://localhost:$API_PORT/simulator/outbox

  Logs in $LOG_DIR · stop with: pnpm demo:down
EOF
