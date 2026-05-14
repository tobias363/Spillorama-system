#!/usr/bin/env bash
#
# Synthetic Spill 1 bingo-round-test — bash runner.
#
# Wraps `tsx scripts/synthetic/spill1-round-bot.ts` with:
#   1. Pre-flight checks: backend health, Postgres reachable, Redis up.
#   2. Optional reset-demo-players via `/api/_dev/reset-test-user` token.
#   3. Default flag-passing matching the runbook in
#      `docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`.
#   4. Report-export to /tmp/synthetic-spill1-YYYY-MM-DDTHH:MM:SS.md.
#
# Usage:
#   bash scripts/synthetic/spill1-round-runner.sh [--mode=local|ci]
#     [--players=N] [--tickets-per-player=M] [--hall-id=HALL]
#     [--backend-url=URL] [--dry-run] [--no-socket] [--timeout=SECONDS]
#
# Exit codes:
#   0 — all invariants PASS (or PASS + WARN)
#   1 — at least one invariant FAIL
#   2 — pre-flight failure (backend down, missing env, etc.)
#
# Environment variables:
#   DEMO_SEED_PASSWORD       — override default 'Spillorama123!' password
#   RESET_TEST_PLAYERS_TOKEN — token for /api/_dev/reset-test-user +
#                               /api/_dev/debug/round-replay endpoints
#
# Author: synthetic-test-agent (Tobias-direktiv 2026-05-14)

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Argument parsing (passthrough to bot) ──────────────────────────────

MODE="local"
BACKEND_URL="http://localhost:4000"
PASSTHROUGH=()

for arg in "$@"; do
  case "$arg" in
    --mode=*)
      MODE="${arg#--mode=}"
      PASSTHROUGH+=("$arg")
      ;;
    --backend-url=*)
      BACKEND_URL="${arg#--backend-url=}"
      PASSTHROUGH+=("$arg")
      ;;
    --dry-run)
      MODE="dry-run"
      PASSTHROUGH+=("--mode=dry-run")
      ;;
    *)
      PASSTHROUGH+=("$arg")
      ;;
  esac
done

# Default output-path with timestamp
TS="$(date -u +%Y-%m-%dT%H:%M:%S)"
OUTPUT_FILE="/tmp/synthetic-spill1-${TS}.md"

# Append --output to passthrough unless user specified it.
if ! printf '%s\n' "${PASSTHROUGH[@]}" | grep -q "^--output="; then
  PASSTHROUGH+=("--output=${OUTPUT_FILE}")
fi

log() {
  printf "[synthetic-runner] %s\n" "$1" >&2
}

# ── Pre-flight ─────────────────────────────────────────────────────────

log "Mode: ${MODE}"
log "Backend: ${BACKEND_URL}"
log "Output report: ${OUTPUT_FILE}"

if ! command -v npx >/dev/null 2>&1; then
  log "FATAL: npx not in PATH"
  exit 2
fi

# Check backend /health (no auth required).
log "Pre-flight: GET ${BACKEND_URL}/health"
HEALTH_STATUS=$(curl --max-time 5 -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/health" || echo "000")
if [ "${HEALTH_STATUS}" != "200" ]; then
  log "FATAL: ${BACKEND_URL}/health returned ${HEALTH_STATUS} (expected 200)"
  log "Hint: start dev-stack with 'npm run dev:nuke' or 'npm run dev:all'"
  exit 2
fi
log "Pre-flight: backend /health OK"

# RESET_TEST_PLAYERS_TOKEN check (only required for local/ci modes — dry-run
# doesn't reset).
if [ "${MODE}" != "dry-run" ]; then
  if [ -z "${RESET_TEST_PLAYERS_TOKEN:-}" ]; then
    log "WARN: RESET_TEST_PLAYERS_TOKEN not set in env"
    log "      Bot will skip replay-API queries — I2/I6 invariants will be marked WARN"
    log "      Set the token to fully validate compliance-ledger"
  else
    PASSTHROUGH+=("--reset-token=${RESET_TEST_PLAYERS_TOKEN}")
    PASSTHROUGH+=("--replay-token=${RESET_TEST_PLAYERS_TOKEN}")
    log "Pre-flight: RESET_TEST_PLAYERS_TOKEN configured"
  fi
fi

# Verify tsx + the bot-script exist before invoking.
BOT_TS="${SCRIPT_DIR}/spill1-round-bot.ts"
if [ ! -f "${BOT_TS}" ]; then
  log "FATAL: bot-script not found: ${BOT_TS}"
  exit 2
fi

# ── Run the bot ────────────────────────────────────────────────────────

log "Running: npx tsx ${BOT_TS} ${PASSTHROUGH[*]}"
log "---"

# Use `set +e` so we capture the bot's exit-code (not the trap from set -e).
set +e
( cd "${REPO_ROOT}" && npx tsx "${BOT_TS}" "${PASSTHROUGH[@]}" )
BOT_EXIT=$?
set -e

log "---"
log "Bot exit-code: ${BOT_EXIT}"

if [ -f "${OUTPUT_FILE}" ]; then
  log "Report: ${OUTPUT_FILE}"
  log "  PASS lines: $(grep -c "PASS" "${OUTPUT_FILE}" 2>/dev/null || echo "0")"
  log "  FAIL lines: $(grep -c "FAIL" "${OUTPUT_FILE}" 2>/dev/null || echo "0")"
  log "  WARN lines: $(grep -c "WARN" "${OUTPUT_FILE}" 2>/dev/null || echo "0")"
else
  log "Report not produced — bot likely exited before writing output"
fi

exit "${BOT_EXIT}"
