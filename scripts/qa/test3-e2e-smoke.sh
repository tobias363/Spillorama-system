#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CANDY_API_BASE_URL:-}" ]]; then
  echo "[test3-e2e] Missing CANDY_API_BASE_URL"
  exit 1
fi

if [[ -z "${CANDY_TEST_ACCESS_TOKEN:-}" ]]; then
  echo "[test3-e2e] Missing CANDY_TEST_ACCESS_TOKEN"
  exit 1
fi

BASE_URL="${CANDY_API_BASE_URL%/}"

http_request() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local auth_header="${4:-}"

  local response
  local -a curl_args
  curl_args=(-sS -w $'\n%{http_code}' -X "$method" "$url" -H "Content-Type: application/json")
  if [[ -n "$auth_header" ]]; then
    curl_args+=(-H "$auth_header")
  fi
  if [[ -n "$payload" ]]; then
    curl_args+=(-d "$payload")
  fi
  response="$(curl "${curl_args[@]}")"

  HTTP_BODY="${response%$'\n'*}"
  HTTP_CODE="${response##*$'\n'}"
}

assert_json_ok() {
  local context="$1"
  local expected_code="${2:-}"
  local body="$3"
  local status="$4"

  if [[ -n "$expected_code" && "$status" != "$expected_code" ]]; then
    echo "[test3-e2e] ${context} expected HTTP ${expected_code}, got ${status}"
    echo "[test3-e2e] Body: ${body}"
    exit 1
  fi

  node -e '
const context = process.argv[1];
const body = process.argv[2];
try {
  JSON.parse(body);
} catch (error) {
  console.error(`[test3-e2e] ${context} returned non-JSON body`);
  console.error(body);
  process.exit(1);
}
' "$context" "$body"
}

echo "[test3-e2e] Health check"
http_request "GET" "${BASE_URL}/health" ""
assert_json_ok "health" "200" "$HTTP_BODY" "$HTTP_CODE"
node -e '
const parsed = JSON.parse(process.argv[1]);
if (!parsed.ok) process.exit(1);
' "$HTTP_BODY"

echo "[test3-e2e] Launch token issue"
http_request "POST" "${BASE_URL}/api/games/candy/launch-token" "{}" "Authorization: Bearer ${CANDY_TEST_ACCESS_TOKEN}"
assert_json_ok "launch-token" "200" "$HTTP_BODY" "$HTTP_CODE"

launch_token="$(node -e '
const parsed = JSON.parse(process.argv[1]);
if (!parsed.ok || !parsed.data || !parsed.data.launchToken) process.exit(1);
process.stdout.write(String(parsed.data.launchToken));
' "$HTTP_BODY")"

echo "[test3-e2e] Launch resolve (first consume)"
http_request "POST" "${BASE_URL}/api/games/candy/launch-resolve" "{\"launchToken\":\"${launch_token}\"}"
assert_json_ok "launch-resolve-first" "200" "$HTTP_BODY" "$HTTP_CODE"

node -e '
const parsed = JSON.parse(process.argv[1]);
if (!parsed.ok) process.exit(1);
if (!parsed.data || !parsed.data.accessToken || !parsed.data.hallId || !parsed.data.walletId) process.exit(1);
' "$HTTP_BODY"

echo "[test3-e2e] Launch resolve (second consume should fail)"
http_request "POST" "${BASE_URL}/api/games/candy/launch-resolve" "{\"launchToken\":\"${launch_token}\"}"
assert_json_ok "launch-resolve-second" "200" "$HTTP_BODY" "$HTTP_CODE"

node -e '
const parsed = JSON.parse(process.argv[1]);
if (parsed.ok) process.exit(1);
if (!parsed.error || parsed.error.code !== "INVALID_LAUNCH_TOKEN") process.exit(1);
' "$HTTP_BODY"

echo "[test3-e2e] PASS"
