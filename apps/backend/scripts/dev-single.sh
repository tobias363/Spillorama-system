#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_PATTERN="$ROOT_DIR/node_modules/.bin/tsx watch src/index.ts"

existing_watchers="$(pgrep -f "$WATCH_PATTERN" || true)"
if [[ -n "$existing_watchers" ]]; then
  echo "[dev:single] Stopping existing backend watcher(s):"
  echo "$existing_watchers"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
  done <<< "$existing_watchers"
  sleep 0.5
fi

if lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev:single] Port 4000 is already in use:"
  lsof -nP -iTCP:4000 -sTCP:LISTEN
  echo "[dev:single] Stop process above, then run again."
  exit 1
fi

cd "$ROOT_DIR"
exec ./node_modules/.bin/tsx watch src/index.ts
