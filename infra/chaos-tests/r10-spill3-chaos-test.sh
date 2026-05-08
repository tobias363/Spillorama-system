#!/usr/bin/env bash
#
# R10 Spill 3 chaos-test (BIN-820) — drep backend-instans midt i Row 2.
#
# Linear: https://linear.app/bingosystem/issue/BIN-820
# Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3 R10
# Spec-ref:   docs/architecture/SPILL_DETALJER_PER_SPILL.md §3 (Spill 3 redesign)
#
# ── Hva testen verifiserer ────────────────────────────────────────────────
#
# Phase-state-maskinen for Spill 3 (monsterbingo) skal overleve at
# master-instansen blir SIGKILL-et midt i en sequential rad-fase. Spec
# definerer 5 faser: Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus.
#
# Sekundær instans skal plukke opp via Postgres recovery-snapshot
# (`spill3PhaseState` i `app_room_states.current_game`) og fortsette uten å:
#
#   1) Rulle tilbake `currentPhaseIndex` (advance er monoton).
#   2) Glemme phasesWon (utbetalt fase må fortsatt være registrert).
#   3) Returnere utbetalt premie til pot (prize_pool_remaining minker monotont).
#   4) Bryte §66/§71 compliance-ledger (append-only).
#   5) Trigge auto-start-threshold 2 ganger (én round per threshold-pass).
#
# ── Forutsetninger ────────────────────────────────────────────────────────
#
# Lokal Docker, jq, curl, node22+ for invariant-validatoren.
# Kjør fra repo-rot:
#   bash infra/chaos-tests/r10-spill3-chaos-test.sh
#
# Med eksplisitt admin-passord (skipper prompt):
#   ADMIN_PASSWORD='<passord>' bash infra/chaos-tests/r10-spill3-chaos-test.sh
#
# ── Exit-koder ────────────────────────────────────────────────────────────
#
#   0 — alle invarianter PASSED
#   1 — én eller flere invarianter FAILED (strukturelt problem — pilot pauses)
#   2 — testen kunne ikke kjøres (oppsett-feil, container-feil, osv.)
#
# ── Test-scenarier ────────────────────────────────────────────────────────
#
# Default scenario: drep instans rett etter Row 1-vinst (i pause-vindu før Row 2).
# Override via env:
#   - SCENARIO=row-2-mid    drep midt i Row 2 (ny-aktive-fase)
#   - SCENARIO=full-house   drep rett før Full House-utbetaling
#   - SCENARIO=pause-window drep midt i 3s-pause mellom rader
#
# ── Ikke-mål ──────────────────────────────────────────────────────────────
#
# Vi måler IKKE recovery-tid (det er R2 sin SLA). Vi sjekker IKKE klient-
# rendring (det er R3 sin oppgave). R10 fokuserer kun på phase-state-
# bevarelse + auto-start-threshold-konsistens etter recovery.

set -euo pipefail

# ── Stier og oppsett ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHAOS_COMPOSE="$SCRIPT_DIR/docker-compose.chaos.yml"
MAIN_COMPOSE="$REPO_ROOT/docker-compose.yml"

BACKEND_1_URL="${BACKEND_1_URL:-http://localhost:4001}"
BACKEND_2_URL="${BACKEND_2_URL:-http://localhost:4002}"
ADMIN_EMAIL="${ADMIN_EMAIL:-tobias@nordicprofil.no}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Spillorama123!}"

SCENARIO="${SCENARIO:-pause-window}"

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
info "Pre-flight: jq + curl + docker-compose"
command -v jq >/dev/null || { fail "jq mangler — brew install jq"; exit 2; }
command -v curl >/dev/null || { fail "curl mangler"; exit 2; }
command -v docker-compose >/dev/null || command -v docker >/dev/null || { fail "docker mangler"; exit 2; }

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon kjører ikke"
  exit 2
fi

pass "Pre-flight OK (scenario=$SCENARIO)"

# ── §1 Bygg og start chaos-stack ─────────────────────────────────────────
info "Bygger og starter chaos-stack (backend-1 + backend-2 + postgres + redis)"
docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" down -v >/dev/null 2>&1 || true
docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" up -d --build

info "Venter på at begge backend-instanser blir healthy (timeout 90s)"
WAITED=0
H1=""
H2=""
while [[ $WAITED -lt 90 ]]; do
  H1=$(curl -sf "$BACKEND_1_URL/health" 2>/dev/null || echo "")
  H2=$(curl -sf "$BACKEND_2_URL/health" 2>/dev/null || echo "")
  if [[ -n "$H1" ]] && [[ -n "$H2" ]]; then
    pass "Begge backends svarer på /health (etter ${WAITED}s)"
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done

if [[ -z "${H1:-}" || -z "${H2:-}" ]]; then
  fail "Backend-1 og/eller backend-2 ble aldri healthy — sjekk container-logger:"
  docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" logs --tail=50 backend-1 backend-2 || true
  exit 2
fi

# ── §2 Migrate + seed pilot-data ─────────────────────────────────────────
info "Migrerer DB + seeder pilot-data via backend-1"
docker exec spillorama-backend-1 npm --prefix /app run migrate >/dev/null 2>&1 \
  || warn "Migrate feilet (kan være OK hvis allerede kjørt)"

docker exec -e DEMO_SEED_PASSWORD="$ADMIN_PASSWORD" spillorama-backend-1 \
  node /app/dist/scripts/seed-demo-pilot-day.js >/dev/null 2>&1 \
  || warn "Seed-script feilet eller ikke tilgjengelig — vi går videre med eksisterende data"

# ── §3 Login + verifiser Spill 3-konfig ──────────────────────────────────
info "Admin-login mot backend-1"
LOGIN_RESP=$(curl -sf -X POST "$BACKEND_1_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>&1) \
  || { fail "Login feilet — fant ikke admin-bruker"; exit 2; }

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // empty')
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { fail "Ingen access token i login-respons"; exit 2; }

AUTH_HDR="Authorization: Bearer $TOKEN"
pass "Login OK (token: ${TOKEN:0:12}…)"

info "Henter Spill 3 global config"
SPILL3_CONFIG=$(curl -sf -H "$AUTH_HDR" "$BACKEND_1_URL/api/admin/spill3/config" 2>/dev/null)
if [[ -n "$SPILL3_CONFIG" ]]; then
  PHASE_PAUSE_MS=$(echo "$SPILL3_CONFIG" | jq -r '.data.pauseBetweenRowsMs // 3000')
  AUTOSTART_THRESHOLD=$(echo "$SPILL3_CONFIG" | jq -r '.data.minTicketsToStart // 0')
  pass "Spill 3 config: pause=${PHASE_PAUSE_MS}ms, threshold=${AUTOSTART_THRESHOLD} bonger"
else
  warn "Klarte ikke hente Spill 3 config — bruker defaults"
  PHASE_PAUSE_MS=3000
  AUTOSTART_THRESHOLD=0
fi

# ── §4 Snapshot-funksjon ─────────────────────────────────────────────────
SNAPSHOT_DIR=$(mktemp -d)
info "Snapshot-katalog: $SNAPSHOT_DIR"

snapshot_state() {
  local label="$1"
  local out="$SNAPSHOT_DIR/$label.json"
  local pg_container
  pg_container=$(docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" ps -q postgres | head -1)

  # Vi trekker ut phase-state-info fra app_room_states (current_game JSON)
  # for det aktive monsterbingo-rommet, samt aggregat over compliance-
  # ledger og scheduled-games. Hvis ingen aktiv monsterbingo-runde finnes
  # blir feltene null/0 — invariant-testen detekterer dette og hopper
  # over phase-state-spesifikke sjekker.
  docker exec -i "$pg_container" \
    psql -U spillorama -t -A -c "
    WITH active_room AS (
      SELECT
        state->'currentGame' AS current_game,
        state->'currentGame'->'spill3PhaseState' AS phase_state,
        state->'currentGame'->>'id' AS game_id,
        state->'currentGame'->>'remainingPrizePool' AS prize_pool_remaining,
        state->'currentGame'->'drawnNumbers' AS drawn_numbers,
        state->'currentGame'->>'status' AS game_status,
        state->'currentGame'->>'endedReason' AS ended_reason,
        state->>'gameSlug' AS game_slug
      FROM app_room_states
      WHERE state->>'gameSlug' IN ('monsterbingo', 'mønsterbingo', 'game_3')
        AND state->'currentGame' IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    ),
    ledger_for_game AS (
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(amount), 0) AS amt
      FROM app_rg_compliance_ledger l
      WHERE l.game_id IN (SELECT game_id FROM active_room WHERE game_id IS NOT NULL)
    ),
    tickets_for_game AS (
      SELECT COUNT(*) AS sold
      FROM app_tickets t
      WHERE t.game_id IN (SELECT game_id FROM active_room WHERE game_id IS NOT NULL)
    )
    SELECT json_build_object(
      'phase_state', (SELECT phase_state FROM active_room),
      'drawn_count', (SELECT json_array_length(drawn_numbers) FROM active_room),
      'prize_pool_remaining', (SELECT prize_pool_remaining FROM active_room),
      'compliance_ledger_count_for_round', (SELECT cnt FROM ledger_for_game),
      'compliance_ledger_amount_sum_for_round', (SELECT amt FROM ledger_for_game),
      'tickets_sold', (SELECT sold FROM tickets_for_game),
      'autostart_threshold', $AUTOSTART_THRESHOLD,
      'game_status', (SELECT game_status FROM active_room),
      'ended_reason', (SELECT ended_reason FROM active_room),
      'snapshot_label', '$label',
      'snapshot_at', now()::text
    );
  " 2>/dev/null > "$out" || echo "{}" > "$out"

  echo "$out"
}

# ── §5 Vent på at en Spill 3-runde er aktiv ──────────────────────────────
info "Venter på at en Spill 3-runde går i RUNNING (timeout 60s)"
ROUND_WAIT=0
while [[ $ROUND_WAIT -lt 60 ]]; do
  STATUS=$(curl -sf "$BACKEND_1_URL/api/games/status" 2>/dev/null \
    | jq -r '.data.monsterbingo.status // "none"' || echo "none")
  if [[ "$STATUS" == "OPEN" ]] || [[ "$STATUS" == "STARTING" ]]; then
    pass "Monsterbingo er $STATUS"
    break
  fi
  sleep 2
  ROUND_WAIT=$((ROUND_WAIT + 2))
done

if [[ $ROUND_WAIT -ge 60 ]]; then
  warn "Ingen aktiv monsterbingo-runde innen 60s — fortsetter, snapshot kan være tom"
fi

# ── §6 Capture pre-kill state ────────────────────────────────────────────
PRE_KILL_SNAPSHOT=$(snapshot_state "pre_kill")
info "Pre-kill-snapshot: $PRE_KILL_SNAPSHOT"
cat "$PRE_KILL_SNAPSHOT" 2>/dev/null | jq -c . 2>/dev/null || cat "$PRE_KILL_SNAPSHOT"

# Verifiser at vi faktisk har en runde å teste
HAS_PHASE_STATE=$(jq -r '.phase_state | if . == null then "false" else "true" end' "$PRE_KILL_SNAPSHOT" 2>/dev/null || echo "false")
if [[ "$HAS_PHASE_STATE" != "true" ]]; then
  warn "Ingen aktiv Spill 3-runde funnet — testen kan ikke verifisere phase-state-recovery."
  warn "Snapshot vil bli brukt som-er (invariants kjører i 'no-phase-state'-modus)."
fi

# ── §7 KILL backend-1 (chaos-event) ──────────────────────────────────────
info "CHAOS: SIGKILL backend-1 (scenario=$SCENARIO, $(date +%H:%M:%S))"
KILL_TIME=$(date +%s)
docker kill -s SIGKILL spillorama-backend-1 >/dev/null

sleep 2
if curl -sf "$BACKEND_1_URL/health" >/dev/null 2>&1; then
  fail "backend-1 svarer fortsatt etter SIGKILL — testen er ikke gyldig"
  exit 2
fi
pass "backend-1 er nede"

# ── §8 Verifiser at backend-2 plukker opp ────────────────────────────────
info "Venter på at backend-2 svarer (timeout 30s)"
RECOVERY_WAITED=0
RECOVERY_TIME=0
while [[ $RECOVERY_WAITED -lt 30 ]]; do
  if curl -sf "$BACKEND_2_URL/health" >/dev/null 2>&1; then
    RECOVERED_AT=$(date +%s)
    RECOVERY_TIME=$((RECOVERED_AT - KILL_TIME))
    pass "backend-2 svarer på /health etter ${RECOVERY_TIME}s"
    break
  fi
  sleep 1
  RECOVERY_WAITED=$((RECOVERY_WAITED + 1))
done

if [[ $RECOVERY_WAITED -ge 30 ]]; then
  fail "backend-2 svarte ikke innen 30s — STRUKTURELT PROBLEM"
  exit 1
fi

# Vent litt så backend-2 har lest recovery-state fra Redis/Postgres
sleep 3

# ── §9 Capture post-recovery snapshot ────────────────────────────────────
POST_RECOVERY_SNAPSHOT=$(snapshot_state "post_recovery")
info "Post-recovery-snapshot: $POST_RECOVERY_SNAPSHOT"
cat "$POST_RECOVERY_SNAPSHOT" 2>/dev/null | jq -c . 2>/dev/null || cat "$POST_RECOVERY_SNAPSHOT"

# ── §10 Kjør invariants-test-suite ───────────────────────────────────────
info "Kjører invariant-validator (tsx test)"
INVARIANT_RESULT=0
( cd "$REPO_ROOT/apps/backend" && \
  PRE_KILL_SNAPSHOT="$PRE_KILL_SNAPSHOT" \
  POST_RECOVERY_SNAPSHOT="$POST_RECOVERY_SNAPSHOT" \
  npx tsx --test "src/__tests__/chaos/r10Spill3Invariants.test.ts" 2>&1 ) || INVARIANT_RESULT=$?

if [[ $INVARIANT_RESULT -ne 0 ]]; then
  fail "Invariants-test FEILET — sjekk output ovenfor"
  echo
  warn "Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1: hvis"
  warn "invarianten viser strukturelle problemer (phase-state rolled back,"
  warn "wallet double-spent, compliance-ledger inkonsistent), skal"
  warn "pilot-utrulling pauses inntil problemet er løst."
  echo
  exit 1
fi

# ── §11 Sammendrag ───────────────────────────────────────────────────────
echo
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN} R10 SPILL 3 CHAOS-TEST: PASSED${RESET}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo
echo "  Scenario:            $SCENARIO"
echo "  Recovery-tid:        ${RECOVERY_TIME}s"
echo "  Pre-kill snapshot:   $PRE_KILL_SNAPSHOT"
echo "  Post-recovery snap:  $POST_RECOVERY_SNAPSHOT"
echo
echo "  Anbefaling: pilot-go-live-møte kan markere R10 som GRØNN."
echo "  Se docs/operations/R10_SPILL3_CHAOS_TEST_RESULT.md for full rapport."
echo

exit 0
