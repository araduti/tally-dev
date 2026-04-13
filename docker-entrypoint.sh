#!/bin/sh
# =============================================================================
# Tally — Docker entrypoint
# =============================================================================
# Reads Docker secrets for Postgres and Redis passwords and constructs
# DATABASE_URL / REDIS_URL before starting the application.
#
# Secret files (mounted by Docker Compose secrets:):
#   /run/secrets/tally_postgres_password
#   /run/secrets/tally_redis_password
#
# If a secret file is absent the corresponding env var is left untouched,
# so plain DATABASE_URL / REDIS_URL values in .env still work for local dev.
#
# Tunable via environment variables (all have safe defaults):
#   TALLY_POSTGRES_USER   (default: tally)
#   TALLY_POSTGRES_DB     (default: tally)
#   TALLY_POSTGRES_HOST   (default: tally-postgres)
#   TALLY_POSTGRES_PORT   (default: 5432)
#   TALLY_REDIS_HOST      (default: tally-redis)
#   TALLY_REDIS_PORT      (default: 6379)
# =============================================================================
set -e

# ── Postgres ──────────────────────────────────────────────────────────────────
if [ -f /run/secrets/tally_postgres_password ]; then
  _pg_pass=$(cat /run/secrets/tally_postgres_password)
  _pg_user=${TALLY_POSTGRES_USER:-tally}
  _pg_db=${TALLY_POSTGRES_DB:-tally}
  _pg_host=${TALLY_POSTGRES_HOST:-tally-postgres}
  _pg_port=${TALLY_POSTGRES_PORT:-5432}
  export DATABASE_URL="postgresql://${_pg_user}:${_pg_pass}@${_pg_host}:${_pg_port}/${_pg_db}"
  unset _pg_pass _pg_user _pg_db _pg_host _pg_port
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
if [ -f /run/secrets/tally_redis_password ]; then
  _redis_pass=$(cat /run/secrets/tally_redis_password)
  _redis_host=${TALLY_REDIS_HOST:-tally-redis}
  _redis_port=${TALLY_REDIS_PORT:-6379}
  export REDIS_URL="redis://:${_redis_pass}@${_redis_host}:${_redis_port}"
  unset _redis_pass _redis_host _redis_port
fi

exec "$@"
