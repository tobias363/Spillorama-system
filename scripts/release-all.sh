#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_RELEASE_ENV_FILE="$ROOT_DIR/scripts/release.env"
RELEASE_ENV_FILE="${RELEASE_ENV_FILE:-$DEFAULT_RELEASE_ENV_FILE}"

if [[ -f "$RELEASE_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$RELEASE_ENV_FILE"
  set +a
  echo "[release-all] Lastet env fra: $RELEASE_ENV_FILE"
fi

RELEASE_COMMIT="${SYSTEM_RELEASE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
RELEASE_VERSION="${SYSTEM_RELEASE_VERSION:-$(date -u +"%Y%m%d-%H%M%S")-$RELEASE_COMMIT}"
RUN_BACKEND_CHECK="${RUN_BACKEND_CHECK:-true}"
RUN_BACKEND_DEPLOY="${RUN_BACKEND_DEPLOY:-true}"
RUN_ROOT_CHECK_ALL="${RUN_ROOT_CHECK_ALL:-false}"

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

echo "[release-all] Release: $RELEASE_VERSION ($RELEASE_COMMIT)"

export SYSTEM_RELEASE_VERSION="$RELEASE_VERSION"
export SYSTEM_RELEASE_COMMIT="$RELEASE_COMMIT"

if is_true "$RUN_BACKEND_CHECK"; then
  echo "[release-all] Kjører backend check..."
  npm --prefix "$ROOT_DIR/apps/backend" run check
fi

if is_true "$RUN_ROOT_CHECK_ALL"; then
  echo "[release-all] Kjører samlet sjekk (npm run check:all)..."
  npm --prefix "$ROOT_DIR" run check:all
fi

if is_true "$RUN_BACKEND_DEPLOY"; then
  echo "[release-all] Trigger backend deploy..."
  bash "$ROOT_DIR/infra/deploy-backend.sh"
fi

echo "[release-all] Ferdig."
