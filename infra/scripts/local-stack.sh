#!/usr/bin/env bash
# Bring the local dependencies up or down.
#
# Prefers Docker Compose. Falls back to natively installed PostgreSQL and Redis
# when no Docker daemon is reachable, which is the case in some sandboxes and on
# locked-down laptops — the point is that `pnpm dev` works either way.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/compose/local.yml"
ACTION="${1:-up}"

have_docker() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

native_up() {
  echo "→ Docker not available; starting native PostgreSQL and Redis"

  if command -v pg_ctlcluster >/dev/null 2>&1; then
    pg_isready -q 2>/dev/null || pg_ctlcluster 16 main start || true
  fi

  # Create the role and database if they are not there yet.
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='morapay'\"" 2>/dev/null \
    | grep -q 1 || su postgres -c "psql -c \"CREATE ROLE morapay LOGIN PASSWORD 'morapay' SUPERUSER\"" >/dev/null
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='morapay'\"" 2>/dev/null \
    | grep -q 1 || su postgres -c "createdb -O morapay morapay" >/dev/null

  PGPASSWORD=morapay psql -h 127.0.0.1 -U morapay -d morapay -q -f "$ROOT/infra/scripts/init-partitions.sql"

  if ! redis-cli ping >/dev/null 2>&1; then
    redis-server --daemonize yes --appendonly no
  fi

  echo "→ PostgreSQL ready on 5432, Redis ready on 6379"
}

native_down() {
  redis-cli shutdown nosave >/dev/null 2>&1 || true
  command -v pg_ctlcluster >/dev/null 2>&1 && pg_ctlcluster 16 main stop || true
  echo "→ native services stopped"
}

case "$ACTION" in
  up)
    if have_docker; then
      docker compose -f "$COMPOSE_FILE" up -d --wait
      echo "→ stack up: postgres:5432 redis:6379 mailhog:8025 minio:9001"
    else
      native_up
    fi
    ;;
  down)
    if have_docker; then
      docker compose -f "$COMPOSE_FILE" down
    else
      native_down
    fi
    ;;
  reset)
    if have_docker; then
      docker compose -f "$COMPOSE_FILE" down -v
      docker compose -f "$COMPOSE_FILE" up -d --wait
    else
      native_down; native_up
    fi
    ;;
  *)
    echo "usage: $0 [up|down|reset]" >&2
    exit 64
    ;;
esac
