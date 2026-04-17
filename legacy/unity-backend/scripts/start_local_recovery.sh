#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.recovery}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Manglende env-fil: $ENV_FILE" >&2
  exit 1
fi

cd "$ROOT"

export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-4010}"
export DB_CONNECTION_TYPE="${DB_CONNECTION_TYPE:-production}"
export DB_MODE="${DB_MODE:-production}"
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret}"
export JWT_SECRET="${JWT_SECRET:-dev-secret}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-dev-refresh-secret}"

export DOTENV_CONFIG_PATH="$ENV_FILE"

exec npx -y -p node@18 -p npm@10 node -r dotenv/config index.js
