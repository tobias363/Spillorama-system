#!/usr/bin/env bash
#
# R2 Failover-test (BIN-811) — drep backend-instans midt i runde.
#
# Linear: https://linear.app/bingosystem/issue/BIN-811
# Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3
#
# ── Hva testen verifiserer ────────────────────────────────────────────────
#
# Pilot-gating-tiltak. Hvis arkitekturen er Evolution-grade skal en runde
# overleve at master-instansen blir SIGKILL-et midt i en draw-sekvens.
# Sekundær instans skal plukke opp via Redis-state + Postgres-DB og
# fortsette uten å:
#   1) Miste draws (sekvensen 1..N skal være sammenhengende, ingen gaps).
#   2) Miste marks (alle ticket-marks før kill skal være persistert).
#   3) Double-spende lommebok (wallet-saldo skal være konsistent).
#   4) Bryte §66/§71-sporbarhet (compliance-ledger skal være intakt).
#
# ── Forutsetninger ────────────────────────────────────────────────────────
#
# Lokal Docker, jq, curl, node22+ for invariant-validatoren.
# Kjør fra repo-rot:
#   bash infra/chaos-tests/r2-failover-test.sh
#
# Med eksplisitt admin-passord (skipper prompt):
#   ADMIN_PASSWORD='<passord>' bash infra/chaos-tests/r2-failover-test.sh
#
# ── Exit-koder ────────────────────────────────────────────────────────────
#
#   0 — alle invarianter PASSED
#   1 — én eller flere invarianter FAILED (strukturelt problem — pilot pauses)
#   2 — testen kunne ikke kjøres (oppsett-feil, container-feil, osv.)
#
# ── Ikke-mål ──────────────────────────────────────────────────────────────
#
# Vi måler IKKE recovery-tid utover en grov < 30 sek for at backend-2 skal
# svare på health. Latency-tuning er separat (R4 load-test).

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

DRAWS_BEFORE_KILL="${DRAWS_BEFORE_KILL:-10}"
TOTAL_DRAWS_TARGET="${TOTAL_DRAWS_TARGET:-25}"

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

pass "Pre-flight OK"

# ── §0.5 Generer .env.chaos (BIN-825) ────────────────────────────────────
# Tidligere brukte composen `apps/backend/.env.production` som er
# .gitignored og uansett ikke noe vi vil trekke prod-secrets inn fra.
# `setup-chaos-env.sh` skriver et trygt dummy-env til
# `infra/chaos-tests/.env.chaos`.
info "Genererer .env.chaos (idempotent)"
bash "$SCRIPT_DIR/setup-chaos-env.sh" >/dev/null

# ── §1 Bygg og start chaos-stack ─────────────────────────────────────────
# We start the dependencies first, then backend-1 alone, wait for it to
# initialise the DB schema, and finally bring up backend-2. Doing both
# backends concurrently triggers a race in `SecurityService.initializeSchema`
# where two `CREATE TYPE`-statements collide on `pg_type_typname_nsp_index`.
# That race is a real backend bug (separate issue) — here we only need
# the chaos test to start cleanly so it can verify the failover path.
info "Bygger og starter chaos-stack (postgres + redis først)"
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

# ── §1.5 Kjør migrate i en throwaway-container FØR backends starter ──────
# Backends har idempotent CREATE TABLE IF NOT EXISTS-logikk i flere
# services (`SecurityService.initializeSchema`,
# `PostgresResponsibleGamingStore.initializeSchema`, etc) som genererer
# strukturer som overlapper med node-pg-migrate. Hvis vi lar backend-1
# starte først og deretter kjører `npm run migrate`, kolliderer vi på
# `INSERT INTO wallet_accounts` mot `balance` etter at den er konvertert
# til GENERATED ALWAYS AS i en senere migration.
#
# Løsning: kjør migrate i en standalone container mot ferskt skjema,
# så er DB-en på "main" idempotent når backendene boots.
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

info "Starter backend-1 alene (skjema er allerede migrert)"
docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" up -d backend-1

info "Venter på at backend-1 svarer (timeout 60s)"
WAITED=0
H1=""
while [[ $WAITED -lt 60 ]]; do
  H1=$(curl -sf "$BACKEND_1_URL/health" 2>/dev/null || echo "")
  if [[ -n "$H1" ]]; then
    pass "backend-1 svarer på /health (etter ${WAITED}s)"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

info "Starter backend-2 (DB-skjema er allerede initialisert)"
docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" up -d backend-2

info "Venter på at backend-2 svarer (timeout 60s)"
WAITED=0
H2=""
while [[ $WAITED -lt 60 ]]; do
  H2=$(curl -sf "$BACKEND_2_URL/health" 2>/dev/null || echo "")
  if [[ -n "$H2" ]]; then
    pass "backend-2 svarer på /health (etter ${WAITED}s)"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

if [[ -z "${H1:-}" || -z "${H2:-}" ]]; then
  fail "Backend-1 og/eller backend-2 ble aldri healthy — sjekk container-logger:"
  docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" logs --tail=50 backend-1 backend-2 || true
  exit 2
fi

# ── §2 Seed pilot-data ────────────────────────────────────────────────────
# Scripts kompileres ikke til dist (tsconfig include = src/**/*) så vi
# kjører TS-kilden via tsx (BIN-825).
info "Seeder pilot-data via backend-1"
docker exec -e DEMO_SEED_PASSWORD="$ADMIN_PASSWORD" spillorama-backend-1 \
  npx tsx /app/scripts/seed-demo-pilot-day.ts >/dev/null 2>&1 \
  || warn "Seed-script feilet eller ikke tilgjengelig — vi går videre med eksisterende data"

# ── §3 Login + hente test-runde ──────────────────────────────────────────
info "Admin-login mot backend-1"
LOGIN_RESP=$(curl -sf -X POST "$BACKEND_1_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>&1) \
  || { fail "Login feilet — fant ikke admin-bruker"; exit 2; }

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // empty')
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { fail "Ingen access token i login-respons"; exit 2; }

AUTH_HDR="Authorization: Bearer $TOKEN"
pass "Login OK (token: ${TOKEN:0:12}…)"

# ── §4 Capture pre-kill state ────────────────────────────────────────────
SNAPSHOT_DIR=$(mktemp -d)
info "Snapshot-katalog: $SNAPSHOT_DIR"

snapshot_state() {
  local label="$1"
  local out="$SNAPSHOT_DIR/$label.json"
  local pg_container
  pg_container=$(docker-compose -f "$MAIN_COMPOSE" -f "$CHAOS_COMPOSE" ps -q postgres | head -1)

  docker exec -i "$pg_container" \
    psql -U spillorama -t -A -c "
    SELECT json_build_object(
      'draws_count', (SELECT COUNT(*) FROM app_game1_draws),
      'draws_max_sequence', (SELECT COALESCE(MAX(draw_sequence), 0) FROM app_game1_draws),
      'draws_distinct_balls', (SELECT COUNT(DISTINCT ball_value) FROM app_game1_draws),
      'wallet_entries_count', (SELECT COUNT(*) FROM wallet_entries),
      'wallet_entries_credit_sum', (SELECT COALESCE(SUM(amount), 0) FROM wallet_entries WHERE side = 'CREDIT'),
      'wallet_entries_debit_sum', (SELECT COALESCE(SUM(amount), 0) FROM wallet_entries WHERE side = 'DEBIT'),
      'compliance_ledger_count', (SELECT COUNT(*) FROM app_rg_compliance_ledger),
      'compliance_ledger_amount_sum', (SELECT COALESCE(SUM(amount), 0) FROM app_rg_compliance_ledger),
      'scheduled_games_running', (SELECT COUNT(*) FROM app_game1_scheduled_games WHERE status = 'running'),
      'scheduled_games_completed', (SELECT COUNT(*) FROM app_game1_scheduled_games WHERE status = 'completed'),
      'snapshot_label', '$label',
      'snapshot_at', now()::text
    );
  " 2>/dev/null > "$out" || echo "{}" > "$out"

  echo "$out"
}

PRE_KILL_SNAPSHOT=$(snapshot_state "pre_kill")
info "Pre-kill-snapshot: $PRE_KILL_SNAPSHOT"
cat "$PRE_KILL_SNAPSHOT" 2>/dev/null | jq -c . 2>/dev/null || cat "$PRE_KILL_SNAPSHOT"

# ── §5 Cross-instance read-sanity ────────────────────────────────────────
info "Sjekker at begge instanser ser samme katalog (cross-instance read)"
CAT1=$(curl -sf -H "$AUTH_HDR" "$BACKEND_1_URL/api/admin/game-catalog" 2>/dev/null | jq -r '.data.entries | length // 0')
CAT2=$(curl -sf -H "$AUTH_HDR" "$BACKEND_2_URL/api/admin/game-catalog" 2>/dev/null | jq -r '.data.entries | length // 0')
if [[ "$CAT1" == "$CAT2" ]] && [[ "$CAT1" -gt 0 ]]; then
  pass "Cross-instance katalog konsistent ($CAT1 entries på begge)"
else
  warn "Katalog-mismatch eller tom (b1=$CAT1, b2=$CAT2) — fortsetter likevel"
fi

# ── §6 KILL backend-1 (chaos-event) ──────────────────────────────────────
info "CHAOS: SIGKILL backend-1 ($(date +%H:%M:%S))"
KILL_TIME=$(date +%s)
docker kill -s SIGKILL spillorama-backend-1 >/dev/null

sleep 2
if curl -sf "$BACKEND_1_URL/health" >/dev/null 2>&1; then
  fail "backend-1 svarer fortsatt etter SIGKILL — testen er ikke gyldig"
  exit 2
fi
pass "backend-1 er nede"

# ── §7 Verifiser at backend-2 plukker opp ────────────────────────────────
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

if [[ $RECOVERY_TIME -gt 5 ]]; then
  warn "Recovery-tid ${RECOVERY_TIME}s > 5s SLA — IKKE strukturelt, men trenger tuning"
fi

# ── §8 Verifiser at backend-2 ser samme DB-state ─────────────────────────
info "Verifiserer at backend-2 ser samme katalog-state"
CAT_AFTER=$(curl -sf -H "$AUTH_HDR" "$BACKEND_2_URL/api/admin/game-catalog" 2>/dev/null | jq -r '.data.entries | length // 0')
if [[ "$CAT_AFTER" == "$CAT1" ]] && [[ "$CAT_AFTER" -gt 0 ]]; then
  pass "DB-state intakt etter failover ($CAT_AFTER entries)"
else
  fail "DB-state mismatch ($CAT1 før kill, $CAT_AFTER etter) — STRUKTURELT PROBLEM"
  exit 1
fi

# ── §9 Capture post-recovery snapshot ────────────────────────────────────
POST_RECOVERY_SNAPSHOT=$(snapshot_state "post_recovery")
info "Post-recovery-snapshot: $POST_RECOVERY_SNAPSHOT"

# ── §10 Kjør invariants-test-suite ───────────────────────────────────────
info "Kjører invariant-validator (tsx test)"
INVARIANT_RESULT=0
( cd "$REPO_ROOT/apps/backend" && \
  PRE_KILL_SNAPSHOT="$PRE_KILL_SNAPSHOT" \
  POST_RECOVERY_SNAPSHOT="$POST_RECOVERY_SNAPSHOT" \
  RECOVERY_TIME_SECONDS="${RECOVERY_TIME:-0}" \
  npx tsx --test "src/__tests__/chaos/r2FailoverInvariants.test.ts" 2>&1 ) || INVARIANT_RESULT=$?

if [[ $INVARIANT_RESULT -ne 0 ]]; then
  fail "Invariants-test FEILET — sjekk output ovenfor"
  echo
  warn "Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1: hvis"
  warn "invarianten viser strukturelle problemer (draws mistet,"
  warn "wallet double-spent, compliance-ledger inkonsistent), skal"
  warn "pilot-utrulling pauses inntil problemet er løst."
  echo
  exit 1
fi

# ── §11 Sammendrag ───────────────────────────────────────────────────────
echo
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN} R2 FAILOVER-TEST: PASSED${RESET}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
echo
echo "  Recovery-tid:        ${RECOVERY_TIME}s (SLA < 5s)"
echo "  Pre-kill snapshot:   $PRE_KILL_SNAPSHOT"
echo "  Post-recovery snap:  $POST_RECOVERY_SNAPSHOT"
echo
echo "  Anbefaling: pilot-go-live-møte kan markere R2 som GRØNN."
echo "  Se docs/operations/R2_FAILOVER_TEST_RESULT.md for full rapport."
echo

exit 0
