#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[candy-backend-sync] Missing command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

BACKEND_BASE_URL="${CANDY_BACKEND_BASE_URL:-}"
ADMIN_EMAIL="${CANDY_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${CANDY_ADMIN_PASSWORD:-}"
CANDYGAME_PUBLIC_URL="${CANDYGAME_PUBLIC_URL:-https://candygame-9q3h.onrender.com}"
CANDY_API_BASE_URL="${CANDY_API_BASE_URL:-${BACKEND_BASE_URL}}"
CANDY_ALLOW_PRODUCTION_API_BASE_URL="${CANDY_ALLOW_PRODUCTION_API_BASE_URL:-false}"
PRODUCTION_CANDY_API_BASE_URL="https://bingosystem-3.onrender.com"

if [[ -z "${BACKEND_BASE_URL}" ]]; then
  echo "[candy-backend-sync] Missing CANDY_BACKEND_BASE_URL." >&2
  exit 1
fi
if [[ -z "${ADMIN_EMAIL}" || -z "${ADMIN_PASSWORD}" ]]; then
  echo "[candy-backend-sync] Missing CANDY_ADMIN_EMAIL or CANDY_ADMIN_PASSWORD." >&2
  exit 1
fi
if [[ -z "${CANDY_API_BASE_URL}" ]]; then
  echo "[candy-backend-sync] Missing CANDY_API_BASE_URL." >&2
  exit 1
fi

BASE_URL="${BACKEND_BASE_URL%/}"
launch_url="${CANDYGAME_PUBLIC_URL%/}"
api_base_url="${CANDY_API_BASE_URL%/}"

allow_production_api_base_url="$(printf '%s' "${CANDY_ALLOW_PRODUCTION_API_BASE_URL}" | tr '[:upper:]' '[:lower:]')"
if [[ "${allow_production_api_base_url}" != "true" ]]; then
  if [[ "${BASE_URL}" == "${PRODUCTION_CANDY_API_BASE_URL}" || "${api_base_url}" == "${PRODUCTION_CANDY_API_BASE_URL}" ]]; then
    echo "[candy-backend-sync] Refusing direct production target (${PRODUCTION_CANDY_API_BASE_URL})." >&2
    echo "[candy-backend-sync] Set CANDY_ALLOW_PRODUCTION_API_BASE_URL=true only when promoting staging-validated release." >&2
    exit 1
  fi
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

api_request() {
  local method="$1"
  local endpoint="$2"
  local payload="${3:-}"
  local auth_header="${4:-}"

  local -a curl_args
  curl_args=(-sS --retry 3 --retry-all-errors --connect-timeout 10 -w $'\n%{http_code}' -X "$method" "${BASE_URL}${endpoint}" -H "Content-Type: application/json" --cookie "${COOKIE_JAR}" --cookie-jar "${COOKIE_JAR}")
  if [[ -n "${auth_header}" ]]; then
    curl_args+=(-H "${auth_header}")
  fi
  if [[ -n "${payload}" ]]; then
    curl_args+=(-d "${payload}")
  fi

  local response
  response="$(curl "${curl_args[@]}")"
  HTTP_BODY="${response%$'\n'*}"
  HTTP_CODE="${response##*$'\n'}"
}

assert_http_ok() {
  local context="$1"
  local expected_code="$2"
  if [[ "${HTTP_CODE}" != "${expected_code}" ]]; then
    echo "[candy-backend-sync] ${context} expected HTTP ${expected_code}, got ${HTTP_CODE}" >&2
    echo "[candy-backend-sync] Response body: ${HTTP_BODY}" >&2
    exit 1
  fi
  if ! jq -e . >/dev/null 2>&1 <<<"${HTTP_BODY}"; then
    echo "[candy-backend-sync] ${context} returned invalid JSON." >&2
    echo "[candy-backend-sync] Response body: ${HTTP_BODY}" >&2
    exit 1
  fi
  local ok
  ok="$(jq -r '.ok // false' <<<"${HTTP_BODY}")"
  if [[ "${ok}" != "true" ]]; then
    echo "[candy-backend-sync] ${context} returned ok=false" >&2
    echo "[candy-backend-sync] Response body: ${HTTP_BODY}" >&2
    exit 1
  fi
}

echo "[candy-backend-sync] Logging in admin user"
login_payload="$(jq -n --arg email "${ADMIN_EMAIL}" --arg password "${ADMIN_PASSWORD}" '{email:$email,password:$password}')"
api_request "POST" "/api/admin/auth/login" "${login_payload}"
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "[candy-backend-sync] admin login expected HTTP 200, got ${HTTP_CODE}" >&2
  echo "[candy-backend-sync] Response body: ${HTTP_BODY}" >&2
  exit 1
fi

auth_header=""
admin_token=""
if jq -e . >/dev/null 2>&1 <<<"${HTTP_BODY}"; then
  login_ok="$(jq -r '.ok // false' <<<"${HTTP_BODY}")"
  if [[ "${login_ok}" == "true" ]]; then
    admin_token="$(jq -r '.data.accessToken // empty' <<<"${HTTP_BODY}")"
  fi
fi

if [[ -n "${admin_token}" ]]; then
  auth_header="Authorization: Bearer ${admin_token}"
  echo "[candy-backend-sync] Using bearer token auth."
else
  echo "[candy-backend-sync] Login returned no usable token, trying cookie-session auth."
  api_request "GET" "/api/admin/candy-mania/settings" "" ""
  assert_http_ok "cookie session validation" "200"
fi

echo "[candy-backend-sync] Updating candy launch settings"
launch_patch_payload="$(jq -n --arg launchUrl "${launch_url}" --arg apiBaseUrl "${api_base_url}" '{settings:{launchUrl:$launchUrl,apiBaseUrl:$apiBaseUrl}}')"
api_request "PUT" "/api/admin/games/candy" "${launch_patch_payload}" "${auth_header}"
assert_http_ok "update candy launch settings" "200"

echo "[candy-backend-sync] Loading current candy drift settings"
api_request "GET" "/api/admin/candy-mania/settings" "" "${auth_header}"
assert_http_ok "get candy drift settings" "200"
current_auto_draw_interval_ms="$(jq -r '.data.autoDrawIntervalMs // empty' <<<"${HTTP_BODY}")"
if [[ -z "${current_auto_draw_interval_ms}" ]]; then
  echo "[candy-backend-sync] autoDrawIntervalMs missing from settings response." >&2
  exit 1
fi
if ! [[ "${current_auto_draw_interval_ms}" =~ ^[0-9]+$ ]]; then
  echo "[candy-backend-sync] autoDrawIntervalMs is not numeric: ${current_auto_draw_interval_ms}" >&2
  exit 1
fi

echo "[candy-backend-sync] Applying 30s start policy (preserving autoDrawIntervalMs=${current_auto_draw_interval_ms})"
drift_patch_payload="$(jq -n \
  --argjson autoDrawIntervalMs "${current_auto_draw_interval_ms}" \
  '{
    autoRoundStartEnabled: true,
    autoRoundStartIntervalMs: 30000,
    autoRoundMinPlayers: 1,
    autoDrawEnabled: true,
    autoDrawIntervalMs: $autoDrawIntervalMs
  }')"
api_request "PUT" "/api/admin/candy-mania/settings" "${drift_patch_payload}" "${auth_header}"
assert_http_ok "update candy drift settings" "200"

echo "[candy-backend-sync] Verifying applied settings"
api_request "GET" "/api/admin/candy-mania/settings" "" "${auth_header}"
assert_http_ok "verify candy drift settings" "200"

verified_interval="$(jq -r '.data.autoRoundStartIntervalMs // empty' <<<"${HTTP_BODY}")"
if [[ "${verified_interval}" != "30000" ]]; then
  echo "[candy-backend-sync] Expected autoRoundStartIntervalMs=30000, got ${verified_interval}" >&2
  exit 1
fi

verified_auto_start="$(jq -r '.data.autoRoundStartEnabled // false' <<<"${HTTP_BODY}")"
verified_auto_draw="$(jq -r '.data.autoDrawEnabled // false' <<<"${HTTP_BODY}")"
if [[ "${verified_auto_start}" != "true" || "${verified_auto_draw}" != "true" ]]; then
  echo "[candy-backend-sync] autoRoundStartEnabled/autoDrawEnabled not set to true." >&2
  exit 1
fi

echo "[candy-backend-sync] Verified launchUrl=${launch_url} apiBaseUrl=${api_base_url} autoRoundStartIntervalMs=${verified_interval}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "auto_round_start_interval_ms=${verified_interval}"
    echo "auto_draw_interval_ms=${current_auto_draw_interval_ms}"
    echo "launch_url=${launch_url}"
    echo "api_base_url=${api_base_url}"
  } >>"${GITHUB_OUTPUT}"
fi
