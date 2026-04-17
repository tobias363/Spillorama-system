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
  echo "[deploy-backend] Lastet env fra: $RELEASE_ENV_FILE"
fi

RENDER_DEPLOY_HOOK_URL="${RENDER_DEPLOY_HOOK_URL:-}"
RENDER_HEALTHCHECK_URL="${RENDER_HEALTHCHECK_URL:-}"
RENDER_DEPLOY_WAIT_FOR_HEALTH="${RENDER_DEPLOY_WAIT_FOR_HEALTH:-false}"
RENDER_DEPLOY_REQUIRE_HOOK="${RENDER_DEPLOY_REQUIRE_HOOK:-false}"
RENDER_DEPLOY_REQUIRE_HEALTHCHECK_URL="${RENDER_DEPLOY_REQUIRE_HEALTHCHECK_URL:-false}"
RENDER_DEPLOY_WAIT_TIMEOUT_SECONDS="${RENDER_DEPLOY_WAIT_TIMEOUT_SECONDS:-600}"
RENDER_DEPLOY_POLL_INTERVAL_SECONDS="${RENDER_DEPLOY_POLL_INTERVAL_SECONDS:-10}"
RENDER_DEPLOY_CURL_RETRIES="${RENDER_DEPLOY_CURL_RETRIES:-3}"

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

echo "[deploy-backend] Repo: $ROOT_DIR"

if [[ -z "$RENDER_DEPLOY_HOOK_URL" ]]; then
  if is_true "$RENDER_DEPLOY_REQUIRE_HOOK"; then
    echo "[deploy-backend] RENDER_DEPLOY_HOOK_URL er påkrevd men mangler." >&2
    exit 1
  fi
  echo "[deploy-backend] RENDER_DEPLOY_HOOK_URL er ikke satt. Hopper over manuell trigger."
  exit 0
fi

echo "[deploy-backend] Trigger Render deploy hook..."
curl -fsS \
  --retry "$RENDER_DEPLOY_CURL_RETRIES" \
  --retry-all-errors \
  --connect-timeout 10 \
  -X POST \
  "$RENDER_DEPLOY_HOOK_URL" >/dev/null
echo "[deploy-backend] Deploy hook trigget."

if ! is_true "$RENDER_DEPLOY_WAIT_FOR_HEALTH"; then
  echo "[deploy-backend] Venting på healthcheck er av (RENDER_DEPLOY_WAIT_FOR_HEALTH=false)."
  exit 0
fi

if [[ -z "$RENDER_HEALTHCHECK_URL" ]]; then
  if is_true "$RENDER_DEPLOY_REQUIRE_HEALTHCHECK_URL"; then
    echo "[deploy-backend] RENDER_HEALTHCHECK_URL er påkrevd men mangler." >&2
    exit 1
  fi
  echo "[deploy-backend] RENDER_HEALTHCHECK_URL mangler, kan ikke vente på health."
  exit 0
fi

echo "[deploy-backend] Venter på health: $RENDER_HEALTHCHECK_URL"
start_ts="$(date +%s)"

while true; do
  if curl -fsS "$RENDER_HEALTHCHECK_URL" >/dev/null; then
    echo "[deploy-backend] Healthcheck OK."
    exit 0
  fi

  now_ts="$(date +%s)"
  elapsed="$((now_ts - start_ts))"
  if (( elapsed >= RENDER_DEPLOY_WAIT_TIMEOUT_SECONDS )); then
    echo "[deploy-backend] Timeout etter ${RENDER_DEPLOY_WAIT_TIMEOUT_SECONDS}s uten grønn healthcheck." >&2
    exit 1
  fi

  sleep "$RENDER_DEPLOY_POLL_INTERVAL_SECONDS"
done
