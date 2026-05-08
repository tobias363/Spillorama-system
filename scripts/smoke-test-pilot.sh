#!/usr/bin/env bash
#
# Post-deploy smoke-test — Spillorama-system pilot (2026-05-08)
#
# Player-facing API verification that runs after each deploy. Walks the
# core read-paths a real bingo player hits when opening the web shell:
# health → login → identity → wallet → halls → games → room health.
#
# Differs from `apps/backend/scripts/pilot-smoke-test.sh` (admin-focused
# seed verification) and `apps/backend/scripts/e2e-smoke-test.ts` (22-step
# admin/agent day-flow). This script only exercises endpoints a player
# can reach with a Bearer token from `/api/auth/login` — no admin/agent
# privilege required.
#
# Pilot context: per the live-room robustness mandate
# (`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.4 R7
# / BIN-814), every deploy must verify per-room health before declaring
# the rollout green. This script encodes that gate.
#
# Requirements:
#   - bash 4+, curl, jq, awk (all standard on macOS + Linux)
#   - A reachable backend (default http://localhost:4000)
#   - Test player credentials (TEST_USER_EMAIL + TEST_USER_PASSWORD)
#
# Usage:
#   bash scripts/smoke-test-pilot.sh                       # local dev (default URL)
#   bash scripts/smoke-test-pilot.sh https://api.example   # explicit URL
#   bash scripts/smoke-test-pilot.sh --json                # machine-readable output
#   bash scripts/smoke-test-pilot.sh https://api.example --json
#
# Environment variables:
#   TEST_USER_EMAIL      — required. Player login (e.g. demo-spiller-1@…)
#   TEST_USER_PASSWORD   — required. Plaintext password (use single-quotes
#                          if it contains special chars).
#   SMOKE_TIMEOUT_SEC    — optional. Per-request timeout (default 15).
#   SMOKE_HALL_ID        — optional. Override hallId for room-health probes.
#                          Default: first hallId from /api/halls.
#
# Exit codes:
#   0 — all steps passed.
#   1 — at least one step failed (check stderr / JSON for `failedStep`).
#   2 — invalid arguments (e.g. missing env vars).
#
# Norwegian operations doc: docs/operations/SMOKE_TEST_PILOT.md
#

set -uo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────
# We accept the BASE_URL as a positional argument (any non-flag arg) and
# `--json` as a boolean flag. Order between them is irrelevant.
BASE_URL="http://localhost:4000"
JSON_MODE=false
HELP_MODE=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    --help|-h) HELP_MODE=true ;;
    --*) echo "Unknown flag: $arg" >&2; exit 2 ;;
    *) BASE_URL="$arg" ;;
  esac
done

if [[ "$HELP_MODE" == "true" ]]; then
  # Print the header comment as help (everything between line 1 and the
  # first blank line after `set -uo pipefail`).
  sed -n '1,/^set -uo pipefail$/p' "$0" | sed 's/^# \{0,1\}//; /^$/d; /^!\/usr/d'
  exit 0
fi

# Strip trailing slashes from base URL so "$BASE/path" works regardless.
BASE_URL="${BASE_URL%/}"

# ── Environment validation ────────────────────────────────────────────────
TEST_USER_EMAIL="${TEST_USER_EMAIL:-}"
TEST_USER_PASSWORD="${TEST_USER_PASSWORD:-}"
SMOKE_TIMEOUT_SEC="${SMOKE_TIMEOUT_SEC:-15}"
SMOKE_HALL_ID="${SMOKE_HALL_ID:-}"

# Late-bound: we don't fail on missing creds for `--help`. For real runs
# we require both. The hallId is optional (auto-discovered).
missing_env=()
[[ -z "$TEST_USER_EMAIL" ]] && missing_env+=("TEST_USER_EMAIL")
[[ -z "$TEST_USER_PASSWORD" ]] && missing_env+=("TEST_USER_PASSWORD")
if [[ ${#missing_env[@]} -gt 0 ]]; then
  if [[ "$JSON_MODE" == "true" ]]; then
    printf '{"ok":false,"error":"missing-env","missing":["%s"]}\n' \
      "$(IFS=','; echo "${missing_env[*]}")" >&2
  else
    echo "ERROR: missing required env: ${missing_env[*]}" >&2
    echo "       see scripts/smoke-test-pilot.sh --help" >&2
  fi
  exit 2
fi

# Tool requirements — fail fast if missing.
for tool in curl jq awk; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    if [[ "$JSON_MODE" == "true" ]]; then
      printf '{"ok":false,"error":"missing-tool","tool":"%s"}\n' "$tool" >&2
    else
      echo "ERROR: required tool not on PATH: $tool" >&2
    fi
    exit 2
  fi
done

# ── State (mutated as steps execute) ──────────────────────────────────────
TOKEN=""
USER_ID=""
WALLET_ID=""
HALL_ID=""
TOTAL_STARTED_NS="$(date +%s%N 2>/dev/null || echo 0)"
declare -a STEP_RESULTS=()
FAILED_STEP=""
FAILED_REASON=""

# ── Output helpers ────────────────────────────────────────────────────────
# Human output uses ANSI colors when stdout is a TTY; falls back to plain
# text when piped to a file (so logs aren't littered with escape sequences).
if [[ -t 1 ]] && [[ "$JSON_MODE" == "false" ]]; then
  C_GREEN="\033[32m"
  C_RED="\033[31m"
  C_DIM="\033[2m"
  C_BOLD="\033[1m"
  C_RESET="\033[0m"
else
  C_GREEN=""
  C_RED=""
  C_DIM=""
  C_BOLD=""
  C_RESET=""
fi

human() {
  # Emit only when not in JSON mode.
  [[ "$JSON_MODE" == "true" ]] && return 0
  printf '%b\n' "$*"
}

# ── Step runner ───────────────────────────────────────────────────────────
# Each step is a function returning 0 on success, non-zero on fail. The
# runner records duration (ms) and a one-line summary into STEP_RESULTS.
# Entries are JSON objects so the final JSON-mode output can dump them
# verbatim (no quoting gymnastics).
run_step() {
  local step_name="$1"
  shift
  local started_ns
  started_ns="$(date +%s%N 2>/dev/null || echo 0)"
  local capture_file
  capture_file="$(mktemp -t smoke-pilot-step.XXXXXX)"
  local rc=0
  if "$@" >"$capture_file" 2>&1; then
    rc=0
  else
    rc=$?
  fi
  local ended_ns duration_ms
  ended_ns="$(date +%s%N 2>/dev/null || echo 0)"
  if [[ "$started_ns" != "0" && "$ended_ns" != "0" ]]; then
    duration_ms=$(( (ended_ns - started_ns) / 1000000 ))
  else
    duration_ms=0
  fi

  local detail
  detail="$(tr -d '\r' <"$capture_file" | tail -n 5 | tr '\n' ' ' | sed 's/  */ /g; s/ *$//')"
  rm -f "$capture_file"

  if [[ $rc -eq 0 ]]; then
    human "${C_GREEN}[OK]${C_RESET}   $step_name ${C_DIM}(${duration_ms}ms)${C_RESET}"
    STEP_RESULTS+=("$(jq -c -n \
      --arg name "$step_name" \
      --arg status "ok" \
      --argjson durationMs "$duration_ms" \
      '{name:$name, status:$status, durationMs:$durationMs}')")
    return 0
  fi

  # Failure: record reason and stop. Human mode prints the captured
  # stderr (last few lines); JSON mode embeds it in the final blob.
  human "${C_RED}[FAIL]${C_RESET} $step_name ${C_DIM}(${duration_ms}ms)${C_RESET}: $detail"
  FAILED_STEP="$step_name"
  FAILED_REASON="$detail"
  STEP_RESULTS+=("$(jq -c -n \
    --arg name "$step_name" \
    --arg status "fail" \
    --arg reason "$detail" \
    --argjson durationMs "$duration_ms" \
    '{name:$name, status:$status, durationMs:$durationMs, reason:$reason}')")
  return 1
}

# ── HTTP helpers ──────────────────────────────────────────────────────────
# Status-line is split off via curl's `-w "%{http_code}"` trick. We never
# use `curl --fail` because we want to see the body of 4xx/5xx responses
# for diagnostics. `${@:+"$@"}` expands extra-headers only when at least
# one is set — avoids tripping `set -u` when callers pass zero headers.
http_get() {
  local url="$1"
  local out_file="$2"
  shift 2
  local code
  code="$(curl --silent --show-error \
    --max-time "$SMOKE_TIMEOUT_SEC" \
    --output "$out_file" \
    --write-out "%{http_code}" \
    ${@:+"$@"} \
    "$url" 2>&1)" || {
      echo "curl failed: $code"
      return 1
    }
  if [[ "$code" != "200" ]]; then
    echo "HTTP $code from GET $url: $(head -c 200 "$out_file" 2>/dev/null)"
    return 1
  fi
  return 0
}

http_post() {
  local url="$1"
  local out_file="$2"
  local body_json="$3"
  shift 3
  local code
  code="$(curl --silent --show-error \
    --max-time "$SMOKE_TIMEOUT_SEC" \
    --output "$out_file" \
    --write-out "%{http_code}" \
    -H "Content-Type: application/json" \
    ${@:+"$@"} \
    --data "$body_json" \
    "$url" 2>&1)" || {
      echo "curl failed: $code"
      return 1
    }
  if [[ "$code" != "200" ]]; then
    echo "HTTP $code from POST $url: $(head -c 200 "$out_file" 2>/dev/null)"
    return 1
  fi
  return 0
}

# Shared per-step body file. Allocated once at script-start, reused per
# step (truncated by curl's --output redirect). Cleaner than per-step
# mktemp + trap RETURN, which fought with `set -u` on RETURN-trap
# expansion.
RESPONSE_BODY="$(mktemp -t smoke-pilot-body.XXXXXX)"
trap 'rm -f "$RESPONSE_BODY"' EXIT

# ── Steps ─────────────────────────────────────────────────────────────────

step_health() {
  http_get "$BASE_URL/health" "$RESPONSE_BODY" || return 1
  if ! jq -e '.ok == true' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "expected ok:true in /health body, got: $(jq -c '.' "$RESPONSE_BODY" 2>/dev/null | head -c 200)"
    return 1
  fi
  return 0
}

step_login() {
  # Build payload with jq so passwords containing quotes/`$` survive.
  local payload
  payload="$(jq -n \
    --arg email "$TEST_USER_EMAIL" \
    --arg password "$TEST_USER_PASSWORD" \
    '{email:$email, password:$password}')"
  http_post "$BASE_URL/api/auth/login" "$RESPONSE_BODY" "$payload" || return 1
  # Real backend returns `{ok:true, data:{accessToken,...}}`. If 2FA is
  # enabled for this account the response has `requires2FA:true` instead;
  # smoke-tests must use a non-2FA account.
  if ! jq -e '.ok == true' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "login returned non-ok: $(jq -c '.' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  TOKEN="$(jq -r '.data.accessToken // empty' "$RESPONSE_BODY")"
  USER_ID="$(jq -r '.data.user.id // empty' "$RESPONSE_BODY")"
  WALLET_ID="$(jq -r '.data.user.walletId // empty' "$RESPONSE_BODY")"
  if [[ -z "$TOKEN" ]]; then
    echo "no accessToken in login response (2FA enabled?): $(jq -c '.data' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  return 0
}

step_auth_me() {
  http_get "$BASE_URL/api/auth/me" "$RESPONSE_BODY" -H "Authorization: Bearer $TOKEN" || return 1
  if ! jq -e '.ok == true and (.data.id // empty | length > 0)' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "auth/me missing user id: $(jq -c '.data' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  # Cross-check: id from /me must match id from /login.
  local me_id
  me_id="$(jq -r '.data.id' "$RESPONSE_BODY")"
  if [[ -n "$USER_ID" && "$me_id" != "$USER_ID" ]]; then
    echo "auth/me id ($me_id) != login id ($USER_ID)"
    return 1
  fi
  return 0
}

step_wallet_me() {
  http_get "$BASE_URL/api/wallet/me" "$RESPONSE_BODY" -H "Authorization: Bearer $TOKEN" || return 1
  # Shape per apps/backend/src/routes/wallet.ts:79 — `{account:{...}, transactions:[]}`.
  if ! jq -e '.ok == true and (.data.account.balance != null)' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "wallet/me missing account.balance: $(jq -c '.data' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  return 0
}

step_halls() {
  http_get "$BASE_URL/api/halls" "$RESPONSE_BODY" -H "Authorization: Bearer $TOKEN" || return 1
  if ! jq -e '.ok == true and (.data | type == "array") and (.data | length >= 1)' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "halls list empty or wrong shape: $(jq -c '.data | type, length' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  # Cache the first hallId for the room-health probe (unless caller pinned one).
  if [[ -z "$SMOKE_HALL_ID" ]]; then
    HALL_ID="$(jq -r '.data[0].id // empty' "$RESPONSE_BODY")"
  else
    HALL_ID="$SMOKE_HALL_ID"
  fi
  if [[ -z "$HALL_ID" ]]; then
    echo "no hallId resolved (data[0].id missing)"
    return 1
  fi
  return 0
}

step_games() {
  http_get "$BASE_URL/api/games" "$RESPONSE_BODY" -H "Authorization: Bearer $TOKEN" || return 1
  if ! jq -e '.ok == true and (.data | type == "array")' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "games list wrong shape: $(jq -c '.data | type' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  # Verify Spill 1, 2, 3 (slugs `bingo`, `rocket`, `monsterbingo`) are all
  # present. Per docs/architecture/SPILLKATALOG.md these are the three
  # main games that must be enabled for every pilot deploy.
  local missing
  missing="$(jq -r '
    (["bingo","rocket","monsterbingo"] - [.data[].slug]) | join(",")
  ' "$RESPONSE_BODY")"
  if [[ -n "$missing" ]]; then
    echo "games list missing required slugs: $missing"
    return 1
  fi
  return 0
}

step_spill1_health() {
  # Public endpoint — no auth, but rate-limited 60/min/IP.
  http_get "$BASE_URL/api/games/spill1/health?hallId=$HALL_ID" "$RESPONSE_BODY" || return 1
  # `status` may be ok|degraded|down. We treat `ok` and `degraded` as
  # acceptable for a smoke-test (smoke-test runs immediately after deploy
  # — Redis adapter takes a few seconds to warm up, and `degraded` during
  # that window is normal). Only `down` fails.
  local status
  status="$(jq -r '.data.status // empty' "$RESPONSE_BODY")"
  if [[ -z "$status" ]]; then
    echo "spill1 health missing status: $(jq -c '.' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  if [[ "$status" == "down" ]]; then
    echo "spill1 health=down for hall=$HALL_ID: $(jq -c '.data' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  return 0
}

step_rooms() {
  # /api/rooms is technically public (no Bearer required); we send the
  # token anyway so the request matches what a logged-in player would do.
  http_get "$BASE_URL/api/rooms" "$RESPONSE_BODY" -H "Authorization: Bearer $TOKEN" || return 1
  # Empty list is fine — between rounds there are no active rooms.
  if ! jq -e '.ok == true and (.data | type == "array")' "$RESPONSE_BODY" >/dev/null 2>&1; then
    echo "rooms list wrong shape: $(jq -c '.data | type' "$RESPONSE_BODY" | head -c 200)"
    return 1
  fi
  return 0
}

# ── Main ──────────────────────────────────────────────────────────────────
human "${C_BOLD}smoke-test-pilot${C_RESET} → $BASE_URL"
human "${C_DIM}user=$TEST_USER_EMAIL  timeout=${SMOKE_TIMEOUT_SEC}s${C_RESET}"
human ""

# Steps 1-3 are independent prerequisites; steps 4-7 require a successful
# login. We bail at the first failure so the failed step is unambiguous
# in the JSON output (no cascading "skipped" rows).
overall_status=0

if ! run_step "GET /health" step_health; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "POST /api/auth/login" step_login; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "GET /api/auth/me" step_auth_me; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "GET /api/wallet/me" step_wallet_me; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "GET /api/halls" step_halls; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "GET /api/games" step_games; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "GET /api/games/spill1/health" step_spill1_health; then overall_status=1; fi
if [[ $overall_status -eq 0 ]] && ! run_step "GET /api/rooms" step_rooms; then overall_status=1; fi

# ── Output summary ────────────────────────────────────────────────────────
TOTAL_ENDED_NS="$(date +%s%N 2>/dev/null || echo 0)"
if [[ "$TOTAL_STARTED_NS" != "0" && "$TOTAL_ENDED_NS" != "0" ]]; then
  total_ms=$(( (TOTAL_ENDED_NS - TOTAL_STARTED_NS) / 1000000 ))
else
  total_ms=0
fi

if [[ "$JSON_MODE" == "true" ]]; then
  # JSON mode: machine-readable single-line output for Slack/PagerDuty.
  # Use jq's `--slurpfile` indirection by piping the joined steps to
  # `jq -s` which collects them into an array.
  steps_array="$(printf '%s\n' "${STEP_RESULTS[@]}" | jq -s '.')"
  jq -n -c \
    --arg baseUrl "$BASE_URL" \
    --arg failedStep "$FAILED_STEP" \
    --arg failedReason "$FAILED_REASON" \
    --argjson ok "$([[ $overall_status -eq 0 ]] && echo true || echo false)" \
    --argjson totalDurationMs "$total_ms" \
    --argjson steps "$steps_array" \
    '{
      ok: $ok,
      baseUrl: $baseUrl,
      totalDurationMs: $totalDurationMs,
      steps: $steps,
      failedStep: (if $failedStep == "" then null else $failedStep end),
      failedReason: (if $failedReason == "" then null else $failedReason end)
    }'
else
  human ""
  if [[ $overall_status -eq 0 ]]; then
    human "${C_GREEN}${C_BOLD}smoke-test PASSED${C_RESET} ${C_DIM}(${total_ms}ms total)${C_RESET}"
  else
    human "${C_RED}${C_BOLD}smoke-test FAILED${C_RESET} ${C_DIM}(${total_ms}ms total)${C_RESET}"
    human "  failed step: ${C_BOLD}${FAILED_STEP}${C_RESET}"
    human "  reason:      ${FAILED_REASON}"
  fi
fi

exit $overall_status
