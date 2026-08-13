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

mkdir -p "$LOG_DIR"

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

echo "→ migrations and seed"
pnpm db:migrate >"$LOG_DIR/migrate.log" 2>&1
pnpm seed >"$LOG_DIR/seed.log" 2>&1
pnpm demo:seed >"$LOG_DIR/demo-seed.log" 2>&1

echo "→ build (before anything is started, deliberately)"
pnpm build >"$LOG_DIR/build.log" 2>&1 || {
  echo "✗ build failed; see $LOG_DIR/build.log" >&2
  exit 1
}

echo "→ starting"
(cd "$ROOT/apps/api" && nohup node dist/main.js >"$LOG_DIR/api.log" 2>&1 & echo $! >"$LOG_DIR/api.pid")
(cd "$ROOT/apps/web" && nohup pnpm exec next start -p "$WEB_PORT" >"$LOG_DIR/web.log" 2>&1 & echo $! >"$LOG_DIR/web.pid")
(cd "$ROOT/apps/admin" && nohup pnpm exec next start -p "$ADMIN_PORT" >"$LOG_DIR/admin.log" 2>&1 & echo $! >"$LOG_DIR/admin.pid")

wait_for "http://localhost:$API_PORT/health" 200 90 || { echo "✗ API did not come up; see $LOG_DIR/api.log" >&2; exit 1; }
wait_for "http://localhost:$WEB_PORT/login" 200 90 || { echo "✗ sender app did not come up; see $LOG_DIR/web.log" >&2; exit 1; }
wait_for "http://localhost:$ADMIN_PORT/login" 200 90 || { echo "✗ back office did not come up; see $LOG_DIR/admin.log" >&2; exit 1; }

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
