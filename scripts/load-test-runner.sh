#!/usr/bin/env bash
#
# R4 Load-test runner (BIN-817).
#
# Linear: https://linear.app/bingosystem/issue/BIN-817
# Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.5 R4
# Runbook: docs/operations/R4_LOAD_TEST_RUNBOOK.md
#
# Wrapper rundt `infra/load-tests/spill1-1000-clients.mjs` med pre-flight,
# seed-helper og resultatsamling.
#
# ── Usage ────────────────────────────────────────────────────────────────
#
#   bash scripts/load-test-runner.sh smoke        # 50 VUs, ~5 min
#   bash scripts/load-test-runner.sh stress       # 200 VUs, ~10 min
#   bash scripts/load-test-runner.sh full         # 1000 VUs, ~60 min (staging)
#   bash scripts/load-test-runner.sh seed         # Seed N test-spillere
#
# Med custom backend:
#   BACKEND_URL=https://staging.spillorama.no bash scripts/load-test-runner.sh full
#
# ── Exit-koder ───────────────────────────────────────────────────────────
#
#   0 — alle SLA møtt
#   1 — én eller flere SLA-violations
#   2 — oppsett-feil (backend nede, manglende node, manglende seed)
#   3 — uventet exception

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOAD_TEST_DIR="$REPO_ROOT/infra/load-tests"
RUNNER="$LOAD_TEST_DIR/spill1-1000-clients.mjs"
SEED_SCRIPT="$LOAD_TEST_DIR/seed-load-test-players.ts"
CONFIG_FILE="$LOAD_TEST_DIR/spill1-load-config.json"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/r4-load-test-results}"
BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"

# ── Farger ───────────────────────────────────────────────────────────────
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
BLUE="\033[34m"
RESET="\033[0m"

pass() { echo -e "${GREEN}[PASS]${RESET} $1"; }
fail() { echo -e "${RED}[FAIL]${RESET} $1"; }
info() { echo -e "${BLUE}[ ..  ]${RESET} $1"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $1"; }

# ── Kommandoer ───────────────────────────────────────────────────────────
COMMAND="${1:-smoke}"
shift || true

case "$COMMAND" in
  smoke|stress|full)
    : # OK
    ;;
  seed)
    info "Seeding load-test players"
    if ! command -v npx >/dev/null; then
      fail "npx ikke funnet"
      exit 2
    fi
    cd "$REPO_ROOT/apps/backend"
    npx tsx "$SEED_SCRIPT" "$@"
    exit 0
    ;;
  -h|--help|help)
    sed -n '3,30p' "$0"
    exit 0
    ;;
  *)
    fail "Ukjent kommando: $COMMAND"
    sed -n '11,16p' "$0"
    exit 2
    ;;
esac

# ── Pre-flight ───────────────────────────────────────────────────────────
info "Pre-flight: node + curl"
command -v node >/dev/null || { fail "node mangler — install node 22+"; exit 2; }
command -v curl >/dev/null || { fail "curl mangler"; exit 2; }

NODE_VERSION="$(node -v 2>/dev/null || echo "v0.0.0")"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed -nE 's/v([0-9]+)\..*/\1/p')"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  fail "Node 22+ kreves (har $NODE_VERSION)"
  exit 2
fi

if [[ ! -f "$RUNNER" ]]; then
  fail "Mangler runner: $RUNNER"
  exit 2
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  fail "Mangler config: $CONFIG_FILE"
  exit 2
fi

info "Backend URL: $BACKEND_URL"
if ! curl -sf "$BACKEND_URL/health" >/dev/null 2>&1; then
  fail "Backend ikke healthy på $BACKEND_URL/health"
  warn "Start lokal stack: docker-compose up -d  (eller: npm run dev:all)"
  exit 2
fi
pass "Backend healthy"

# Verifiser at socket.io-client er installert.
# Vi MÅ kjøre node fra repo-rot (cwd) så bare-import "socket.io-client" finner
# top-level node_modules. NODE_PATH virker IKKE for ESM bare-imports.
cd "$REPO_ROOT"
if ! node -e "import('socket.io-client').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
  fail "socket.io-client mangler. Kjør fra repo-rot: npm install"
  exit 2
fi
pass "socket.io-client tilgjengelig"

mkdir -p "$OUTPUT_DIR"
info "Output dir: $OUTPUT_DIR"

# ── Pre-seed sjekk ───────────────────────────────────────────────────────
info "Sjekker at load-test-spillere er seedet"
# Trekk ut prefix + count fra config
VU_COUNT="$(node -e "
const c = require('$CONFIG_FILE').scenarios['$COMMAND'];
console.log(c?.vuCount ?? 0);
")"
TARGET_HALL="$(node -e "
const c = require('$CONFIG_FILE').scenarios['$COMMAND'];
console.log(c?.targetHallId ?? '');
")"

if [[ "$VU_COUNT" -gt 100 ]]; then
  warn "Scenario kjører $VU_COUNT VUs — verifiser at minst $VU_COUNT spillere er seedet på $TARGET_HALL"
  warn "Hvis ikke seedet, kjør: bash scripts/load-test-runner.sh seed --count=$VU_COUNT --hallId=$TARGET_HALL"
  warn ""
  read -t 10 -p "  Fortsett? (y/N) " -r REPLY || REPLY="n"
  echo
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    info "Avbrutt av bruker"
    exit 2
  fi
fi

# ── Memory-pre-flight (1000 VUs trenger ~2-3 GB) ─────────────────────────
if [[ "$VU_COUNT" -ge 500 ]]; then
  AVAIL_MB="$(node -e "console.log(Math.floor(require('os').freemem() / 1024 / 1024))")"
  if [[ "$AVAIL_MB" -lt 4000 ]]; then
    warn "Bare ${AVAIL_MB} MB ledig RAM — anbefaler ≥ 4000 MB for $VU_COUNT VUs"
    warn "Forsøk å kjøre på staging eller dedikert host."
  fi
fi

# ── Kjør runneren ────────────────────────────────────────────────────────
info "Starter load-test scenario=$COMMAND vu=$VU_COUNT"
START_TS="$(date +%s)"

LOG_FILE="$OUTPUT_DIR/r4-$COMMAND-$(date +%Y%m%d-%H%M%S).log"

# Vi kjører fra repo-rot så `import "socket.io-client"` finner top-level
# node_modules (ESM bare-imports respekterer ikke NODE_PATH).
cd "$REPO_ROOT"

set +e
NODE_OPTIONS="--max-old-space-size=4096" \
  BACKEND_URL="$BACKEND_URL" \
  SCENARIO="$COMMAND" \
  CONFIG_FILE="$CONFIG_FILE" \
  OUTPUT_DIR="$OUTPUT_DIR" \
  node "$RUNNER" 2>&1 | tee "$LOG_FILE"
RC=${PIPESTATUS[0]}
set -e

DURATION=$(( $(date +%s) - START_TS ))

case "$RC" in
  0)
    pass "R4 load-test PASSED (scenario=$COMMAND, ${DURATION}s)"
    pass "Resultat-rapport: $OUTPUT_DIR"
    ;;
  1)
    fail "R4 load-test FAILED — SLA-violations (scenario=$COMMAND, ${DURATION}s)"
    fail "Se rapport: $OUTPUT_DIR"
    ;;
  2)
    fail "R4 load-test ABORT — oppsett-feil (scenario=$COMMAND)"
    ;;
  *)
    fail "R4 load-test fatal RC=$RC (scenario=$COMMAND)"
    ;;
esac

exit $RC
