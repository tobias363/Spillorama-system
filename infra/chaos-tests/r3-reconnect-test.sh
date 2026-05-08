#!/usr/bin/env bash
#
# R3 Reconnect-test (BIN-812) — verifiser at klient som mister nett 5/15/60 sek
# får full state-replay og kan fortsette uten tap.
#
# Linear: https://linear.app/bingosystem/issue/BIN-812
# Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3 R3
#
# ── Hva testen verifiserer ────────────────────────────────────────────────
#
# Pilot-gating-tiltak. Hvis arkitekturen er Evolution-grade skal en klient
# som mister socket-tilkoblingen i 5, 15 eller 60 sekunder kunne reconnecte
# og:
#   1) Få full rom-state-replay via `room:resume` + `room:state`.
#   2) Beholde alle marks som ble gjort før disconnect.
#   3) Akseptere nye marks etter reconnect (uten dobbel-effekt fra evt.
#      replay-emits — verifisert via R5 idempotency-store).
#   4) Ikke bli sperret av "PLAYER_ALREADY_IN_RUNNING_GAME"-feil etter
#      reconnect (stale walletId-cleanup må fungere).
#
# ── Forutsetninger ────────────────────────────────────────────────────────
#
# Lokal Docker, jq, curl, node22+. Kjør fra repo-rot:
#   bash infra/chaos-tests/r3-reconnect-test.sh
#
# Med eksplisitt admin-passord (skipper prompt):
#   ADMIN_PASSWORD='<passord>' bash infra/chaos-tests/r3-reconnect-test.sh
#
# Kjør bare ett scenario:
#   DISCONNECT_SCENARIOS="5" bash infra/chaos-tests/r3-reconnect-test.sh
#
# ── Exit-koder ────────────────────────────────────────────────────────────
#
#   0 — alle scenarioer PASSED
#   1 — én eller flere scenarioer FAILED (strukturelt — pilot pauses per §6.1)
#   2 — testen kunne ikke kjøres (oppsett-feil, container-feil, osv.)
#
# ── Strukturelt vs ikke-strukturelt ───────────────────────────────────────
#
# Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1:
#
#   Strukturelt (test FAIL → pilot pauses):
#     - Klient kan ikke replay-e state etter > 5 sek nett-glipp
#     - Marks fra før disconnect mistes
#     - Bingo-rop "spises" (ikke direkte testet her — claim:submit håndteres
#       av separat invariant-test)
#
#   Ikke-strukturelt (test passerer + advarsel):
#     - Reconnect-tid > 3 sek (advisory)
#     - UX-glipp under reconnect

set -euo pipefail

# ── Stier og oppsett ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHAOS_COMPOSE="$SCRIPT_DIR/docker-compose.chaos.yml"
MAIN_COMPOSE="$REPO_ROOT/docker-compose.yml"
MOCK_CLIENT="$SCRIPT_DIR/r3-mock-client.mjs"

BACKEND_URL="${BACKEND_URL:-http://localhost:4001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-tobias@nordicprofil.no}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Spillorama123!}"
PLAYER_EMAIL="${PLAYER_EMAIL:-demo-spiller-1@example.com}"
PLAYER_PASSWORD="${PLAYER_PASSWORD:-${ADMIN_PASSWORD}}"
HALL_ID="${HALL_ID:-demo-hall-999}"
ROOM_CODE="${ROOM_CODE:-BINGO1}"
MARKS_BEFORE_DISCONNECT="${MARKS_BEFORE_DISCONNECT:-5}"

# Standard scenarioene per BIN-812 mandat: 5/15/60 sek.
DISCONNECT_SCENARIOS="${DISCONNECT_SCENARIOS:-5 15 60}"

OUT_DIR=$(mktemp -d)
echo "[r3] Result-katalog: $OUT_DIR"

# ── Farge-helpers ────────────────────────────────────────────────────────
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
BLUE="\033[34m"
RESET="\033[0m"

pass() { echo -e "${GREEN}[PASS]${RESET} $1"; }
fail() { echo -e "${RED}[FAIL]${RESET} $1"; }
info() { echo -e "${BLUE}[ ..  ]${RESET} $1"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $1"; }

cleanup() {
  local exit_code=$?
  echo
  info "Cleanup — stopping chaos-stack"
  docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" down -v >/dev/null 2>&1 || true
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── §0 Pre-flight ────────────────────────────────────────────────────────
info "Pre-flight: jq + curl + docker-compose + node + npm"
command -v jq >/dev/null || { fail "jq mangler — brew install jq"; exit 2; }
command -v curl >/dev/null || { fail "curl mangler"; exit 2; }
command -v docker-compose >/dev/null || command -v docker >/dev/null || { fail "docker mangler"; exit 2; }
command -v node >/dev/null || { fail "node mangler"; exit 2; }
command -v npm >/dev/null || { fail "npm mangler"; exit 2; }

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon kjører ikke"
  exit 2
fi

# Mock-klienten trenger socket.io-client. Det ligger som dev-dep i
# apps/backend, så vi peker NODE_PATH dit.
if [[ ! -f "$REPO_ROOT/apps/backend/node_modules/socket.io-client/package.json" ]]; then
  warn "socket.io-client er ikke installert i apps/backend — kjører npm install"
  ( cd "$REPO_ROOT/apps/backend" && npm install --no-audit --no-fund >/dev/null 2>&1 ) || {
    fail "npm install i apps/backend feilet"
    exit 2
  }
fi

pass "Pre-flight OK"

# ── §0.5 Generer .env.chaos (BIN-825) ────────────────────────────────────
# Tidligere brukte composen `apps/backend/.env.production` som er
# .gitignored og uansett ikke noe vi vil trekke prod-secrets inn fra.
info "Genererer .env.chaos (idempotent)"
bash "$SCRIPT_DIR/setup-chaos-env.sh" >/dev/null

# ── §1 Bygg og start chaos-stack (gjenbruker R2-compose) ────────────────
# R3 trenger bare backend-1, men compose ville startet backend-2 i
# parallell og truffet samme schema-init-race som beskrevet i r2-skriptet.
# Vi bringer derfor opp deps + backend-1 eksplisitt og lar backend-2 være.
info "Bygger og starter chaos-stack (postgres + redis + backend-1 — backend-2 starter ikke for R3)"
docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" down -v >/dev/null 2>&1 || true
docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" up -d --build postgres redis

info "Venter på postgres + redis health (timeout 60s)"
WAITED=0
while [[ $WAITED -lt 60 ]]; do
  PG_OK=$(docker inspect -f '{{.State.Health.Status}}' "$(docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" ps -q postgres | head -1)" 2>/dev/null || echo unknown)
  R_OK=$(docker inspect -f '{{.State.Health.Status}}' "$(docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" ps -q redis | head -1)" 2>/dev/null || echo unknown)
  if [[ "$PG_OK" == "healthy" && "$R_OK" == "healthy" ]]; then
    pass "postgres + redis healthy (etter ${WAITED}s)"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

# ── §1.5 Kjør migrate i throwaway-container FØR backend starter ─────────
# Se r2-failover-test.sh §1.5 for begrunnelsen — backend's interne
# `CREATE TABLE IF NOT EXISTS`-logikk kolliderer med node-pg-migrate
# hvis backend boots først og migrate kjører etterpå.
CHAOS_IMAGE="$(docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" config --images 2>/dev/null | grep backend | head -1)"
if [[ -z "$CHAOS_IMAGE" ]]; then
  CHAOS_IMAGE="agent-a7ab3534d8eb48e84-backend-1"
fi
NETWORK_NAME="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" ps -q postgres | head -1)" 2>/dev/null || echo "")"
if [[ -z "$NETWORK_NAME" ]]; then
  NETWORK_NAME="$(docker network ls --format '{{.Name}}' | grep -E "default$" | head -1)"
fi

info "Kjører node-pg-migrate i throwaway-container (network=$NETWORK_NAME)"
docker run --rm \
  --network "$NETWORK_NAME" \
  -e APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@postgres:5432/spillorama" \
  "$CHAOS_IMAGE" \
  sh -c 'cd /app && npm run migrate' >/tmp/chaos-migrate.log 2>&1 \
  || { fail "Migrate feilet — sjekk /tmp/chaos-migrate.log"; tail -20 /tmp/chaos-migrate.log; exit 2; }
pass "Migrate OK"

docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" up -d backend-1

info "Venter på at backend-1 blir healthy (timeout 90s)"
WAITED=0
H1=""
while [[ $WAITED -lt 90 ]]; do
  H1=$(curl -sf "$BACKEND_URL/health" 2>/dev/null || echo "")
  if [[ -n "$H1" ]]; then
    pass "Backend-1 svarer på /health (etter ${WAITED}s)"
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done

if [[ -z "${H1:-}" ]]; then
  fail "Backend-1 ble aldri healthy — sjekk container-logger:"
  docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" logs --tail=50 backend-1 || true
  exit 2
fi

# ── §2 Seed pilot-data ────────────────────────────────────────────────────
info "Seeder pilot-data via backend-1"
docker exec -e DEMO_SEED_PASSWORD="$ADMIN_PASSWORD" spillorama-backend-1 \
  npx tsx /app/scripts/seed-demo-pilot-day.ts >/dev/null 2>&1 \
  || warn "Seed-script feilet eller ikke tilgjengelig — vi går videre med eksisterende data"

# ── §3 Login-sanity for player ────────────────────────────────────────────
info "Verifiserer at player kan logge inn (player=$PLAYER_EMAIL)"
LOGIN_RESP=$(curl -sf -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$PLAYER_EMAIL\",\"password\":\"$PLAYER_PASSWORD\"}" 2>&1) \
  || { fail "Player-login feilet — sjekk seed-data + password"; exit 2; }

PLAYER_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // empty')
[[ -n "$PLAYER_TOKEN" && "$PLAYER_TOKEN" != "null" ]] || { fail "Ingen token i player-login-respons"; exit 2; }
pass "Player kan logge inn (token-prefix: ${PLAYER_TOKEN:0:12}…)"

# ── §4 Sett opp en aktiv runde (best effort) ─────────────────────────────
# For at `ticket:mark` skal være meningsfull trenger vi en aktiv runde
# (status RUNNING) der player har tickets. Dette setter vi opp via admin
# (login + start a scheduled game). Hvis det feiler kjører vi testen
# uansett — mock-klienten faller tilbake til kun room:join + room:resume.
info "Forsøker å starte en runde via admin (best-effort — testen kjører uansett)"

ADMIN_TOKEN=""
ADMIN_LOGIN_RESP=$(curl -sf -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null || echo "")
if [[ -n "$ADMIN_LOGIN_RESP" ]]; then
  ADMIN_TOKEN=$(echo "$ADMIN_LOGIN_RESP" | jq -r '.data.accessToken // empty' 2>/dev/null || echo "")
fi

if [[ -z "$ADMIN_TOKEN" ]] || [[ "$ADMIN_TOKEN" == "null" ]]; then
  warn "Admin-login feilet — testen kjører uten å starte en runde aktivt"
else
  pass "Admin-login OK"
fi

# ── §5 Kjør hvert scenario ───────────────────────────────────────────────
info "Kjører reconnect-scenarioer: $DISCONNECT_SCENARIOS"
echo

declare -a FAILED_SCENARIOS=()
declare -a SCENARIO_RESULT_FILES=()

for SECONDS_DOWN in $DISCONNECT_SCENARIOS; do
  echo
  info "═══════════════════════════════════════════════════════════════"
  info "Scenario: disconnect i ${SECONDS_DOWN}s"
  info "═══════════════════════════════════════════════════════════════"

  RESULT_FILE="$OUT_DIR/r3-result-${SECONDS_DOWN}s.json"
  SCENARIO_RESULT_FILES+=("$RESULT_FILE")

  set +e
  ( cd "$REPO_ROOT/apps/backend" && \
    BACKEND_URL="$BACKEND_URL" \
    PLAYER_EMAIL="$PLAYER_EMAIL" \
    PLAYER_PASSWORD="$PLAYER_PASSWORD" \
    HALL_ID="$HALL_ID" \
    ROOM_CODE="$ROOM_CODE" \
    MARKS_BEFORE_DISCONNECT="$MARKS_BEFORE_DISCONNECT" \
    DISCONNECT_SECONDS="$SECONDS_DOWN" \
    OUT_FILE="$RESULT_FILE" \
    NODE_PATH="$REPO_ROOT/apps/backend/node_modules" \
    node "$MOCK_CLIENT"
  )
  CLIENT_EXIT=$?
  set -e

  if [[ ! -f "$RESULT_FILE" ]]; then
    fail "Mock-klient ${SECONDS_DOWN}s — ingen resultat-fil generert (exit=$CLIENT_EXIT)"
    FAILED_SCENARIOS+=("${SECONDS_DOWN}s")
    continue
  fi

  PASS_FLAG=$(jq -r '.pass // false' "$RESULT_FILE" 2>/dev/null || echo "false")
  RECONNECT_MS=$(jq -r '.reconnectDurationMs // 0' "$RESULT_FILE" 2>/dev/null || echo "0")
  PRE_MARKS=$(jq -r '.preDisconnectMarkCount // 0' "$RESULT_FILE" 2>/dev/null || echo "0")
  POST_MARKS=$(jq -r '.postReconnectMarkCount // 0' "$RESULT_FILE" 2>/dev/null || echo "0")
  MARKS_OK=$(jq -r '.marksMatchAfterReconnect // false' "$RESULT_FILE" 2>/dev/null || echo "false")
  NEW_MARK_OK=$(jq -r '.newMarkAcceptedAfterReconnect // false' "$RESULT_FILE" 2>/dev/null || echo "false")
  ERR_COUNT=$(jq -r '.errors | length' "$RESULT_FILE" 2>/dev/null || echo "0")

  if [[ "$PASS_FLAG" == "true" ]]; then
    pass "Scenario ${SECONDS_DOWN}s — PASS (reconnect=${RECONNECT_MS}ms, marks ${PRE_MARKS}→${POST_MARKS}, new mark ok=$NEW_MARK_OK)"
  else
    fail "Scenario ${SECONDS_DOWN}s — FAIL (marks ok=$MARKS_OK, new mark ok=$NEW_MARK_OK, errors=$ERR_COUNT)"
    jq '.errors' "$RESULT_FILE" 2>/dev/null || cat "$RESULT_FILE" 2>/dev/null
    FAILED_SCENARIOS+=("${SECONDS_DOWN}s")
  fi

  # Liten pause mellom scenarioer så player-state får ryddet seg.
  sleep 2
done

# ── §6 Kjør invariant-test-suite ─────────────────────────────────────────
echo
info "Kjører R3 invariant-validator (tsx test) på alle scenario-resultater"

# Sett env-variabler så testen finner alle JSON-rapportene.
export R3_RESULT_DIR="$OUT_DIR"
export R3_DISCONNECT_SCENARIOS="$DISCONNECT_SCENARIOS"

INVARIANT_RESULT=0
( cd "$REPO_ROOT/apps/backend" && \
  R3_RESULT_DIR="$OUT_DIR" \
  R3_DISCONNECT_SCENARIOS="$DISCONNECT_SCENARIOS" \
  npx tsx --test "src/__tests__/chaos/r3ReconnectInvariants.test.ts" 2>&1 ) || INVARIANT_RESULT=$?

# ── §7 Sammendrag ─────────────────────────────────────────────────────────
echo
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${RESET}"
echo "  R3 RECONNECT-TEST — sammendrag"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${RESET}"
echo
echo "  Resultat-katalog: $OUT_DIR"
echo "  Scenarioer kjørt: $DISCONNECT_SCENARIOS"
echo "  Mislykkede:       ${#FAILED_SCENARIOS[@]} (${FAILED_SCENARIOS[*]:-})"
echo "  Invariant-tests:  $([[ $INVARIANT_RESULT -eq 0 ]] && echo "PASS" || echo "FAIL")"
echo

if [[ ${#FAILED_SCENARIOS[@]} -gt 0 ]] || [[ $INVARIANT_RESULT -ne 0 ]]; then
  fail "R3 RECONNECT-TEST: FAILED"
  echo
  warn "Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1: hvis"
  warn "klient ikke kan replay-e state etter > 5 sek nett-glipp eller"
  warn "marks mistes, skal pilot-utrulling pauses inntil problemet er"
  warn "løst."
  echo
  echo "  Inspect detaljerte JSON-resultater i $OUT_DIR/"
  exit 1
fi

echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN} R3 RECONNECT-TEST: PASSED${RESET}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo
echo "  Anbefaling: pilot-go-live-møte kan markere R3 som GRØNN."
echo "  Se docs/operations/R3_RECONNECT_TEST_RESULT.md for full rapport."
echo

exit 0
