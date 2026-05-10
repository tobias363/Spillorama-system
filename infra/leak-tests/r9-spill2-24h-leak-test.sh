#!/usr/bin/env bash
#
# R9 Spill 2 perpetual-loop 24-timers leak-test (BIN-819).
#
# Linear: https://linear.app/bingosystem/issue/BIN-819
# Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.5
#
# ── Hva testen verifiserer ────────────────────────────────────────────────
#
# Spill 2 (rocket) er ETT globalt perpetual-rom som auto-restarter ny runde
# 30 sek etter forrige runde slutter (PerpetualRoundService.ts). Testen
# verifiserer at en backend-instans som kjører Spill 2 kontinuerlig i opptil
# 24 timer (åpningstid 11:00–21:00 × N) IKKE akkumulerer leaks i:
#
#   1) Heap-størrelse — RSS / heap-used skal vokse < 10 % over test-perioden.
#      (Akseptabel grense fordi GC-kompaktering har naturlig fluktuasjon.)
#   2) Open file-descriptors — skal være stabil (±10 %) etter warmup.
#   3) DB-connection-pool — ingen "connection limit reached"-feil.
#   4) Redis-connections — ingen ubegrenset opening uten close.
#   5) Socket.IO connected clients — match aktivt-mock-player-tall.
#
# ── Forutsetninger ────────────────────────────────────────────────────────
#
# Lokal Docker, jq, curl, node22+. Kjør fra repo-rot:
#
#   bash infra/leak-tests/r9-spill2-24h-leak-test.sh
#
# Konfigurasjon via env:
#   DURATION_HOURS       — antall timer å kjøre (default 24, smoke 1)
#   SAMPLE_INTERVAL_S    — sekunder mellom samples (default 3600 = 1 t)
#   HEAP_SNAPSHOTS       — komma-separert liste i timer for heap-snap (default "0,6,12,18,24")
#   MOCK_PLAYER_COUNT    — antall samtidige mock-spillere (default 5, max 12)
#   ADMIN_PASSWORD       — admin-passord (default Spillorama123!)
#   HEAP_GROWTH_LIMIT_PCT— maks heap-vekst % før FAIL (default 10)
#   FD_GROWTH_LIMIT_PCT  — maks fd-vekst % før FAIL (default 10)
#
# ── Smoke-modus (verifisere infrastrukturen uten å kjøre 24t) ────────────
#
#   DURATION_HOURS=1 SAMPLE_INTERVAL_S=300 HEAP_SNAPSHOTS="0,1" \
#     bash infra/leak-tests/r9-spill2-24h-leak-test.sh
#
#   Dette verifiserer at scriptet, mock-trafikken og snapshot-helperen
#   fungerer end-to-end uten å investere et helt døgn.
#
# ── Exit-koder ────────────────────────────────────────────────────────────
#
#   0 — alle invarianter PASSED (leak-fri innenfor toleranse)
#   1 — én eller flere invarianter FAILED (potensielt leak; rapporter sak)
#   2 — testen kunne ikke kjøres (oppsett-feil, container-feil, osv.)

set -euo pipefail

# ── Stier og oppsett ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAIN_COMPOSE="$REPO_ROOT/docker-compose.yml"
SNAPSHOT_HELPER="$SCRIPT_DIR/heap-snapshot-helper.mjs"

BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-spillorama-backend}"
ADMIN_EMAIL="${ADMIN_EMAIL:-tobias@nordicprofil.no}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Spillorama123!}"

DURATION_HOURS="${DURATION_HOURS:-24}"
SAMPLE_INTERVAL_S="${SAMPLE_INTERVAL_S:-3600}"
HEAP_SNAPSHOTS="${HEAP_SNAPSHOTS:-0,6,12,18,24}"
MOCK_PLAYER_COUNT="${MOCK_PLAYER_COUNT:-5}"
HEAP_GROWTH_LIMIT_PCT="${HEAP_GROWTH_LIMIT_PCT:-10}"
FD_GROWTH_LIMIT_PCT="${FD_GROWTH_LIMIT_PCT:-10}"

DURATION_S=$((DURATION_HOURS * 3600))
SAMPLES_DIR=""
MOCK_PID=""

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
  info "Cleanup — stopping mock-traffic + chaos-stack"
  if [[ -n "${MOCK_PID:-}" ]]; then
    kill -TERM "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  # Vi stopper IKKE main-stack hvis det allerede kjørte før testen — kun
  # hvis vi startet den selv.
  if [[ "${WE_STARTED_STACK:-0}" == "1" ]]; then
    docker-compose -f "$MAIN_COMPOSE" down >/dev/null 2>&1 || true
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── §0 Pre-flight ────────────────────────────────────────────────────────
info "Pre-flight: jq + curl + docker + node"
command -v jq >/dev/null || { fail "jq mangler — brew install jq"; exit 2; }
command -v curl >/dev/null || { fail "curl mangler"; exit 2; }
command -v docker >/dev/null || { fail "docker mangler"; exit 2; }
command -v node >/dev/null || { fail "node mangler"; exit 2; }

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon kjører ikke"
  exit 2
fi

if [[ ! -f "$SNAPSHOT_HELPER" ]]; then
  fail "Mangler heap-snapshot-helper: $SNAPSHOT_HELPER"
  exit 2
fi

pass "Pre-flight OK"
info "Konfigurasjon: duration=${DURATION_HOURS}t, sample-interval=${SAMPLE_INTERVAL_S}s, mock-players=$MOCK_PLAYER_COUNT"

# ── §1 Sørg for at backend kjører ────────────────────────────────────────
WE_STARTED_STACK=0
if curl -sf "$BACKEND_URL/health" >/dev/null 2>&1; then
  pass "Backend allerede oppe på $BACKEND_URL"
else
  info "Starter docker-compose stack (postgres + redis + backend)"
  docker-compose -f "$MAIN_COMPOSE" up -d --build
  WE_STARTED_STACK=1

  info "Venter på at backend blir healthy (timeout 120s)"
  WAITED=0
  while [[ $WAITED -lt 120 ]]; do
    if curl -sf "$BACKEND_URL/health" >/dev/null 2>&1; then
      pass "Backend healthy etter ${WAITED}s"
      break
    fi
    sleep 3
    WAITED=$((WAITED + 3))
  done
  if [[ $WAITED -ge 120 ]]; then
    fail "Backend ble aldri healthy"
    docker-compose -f "$MAIN_COMPOSE" logs --tail=50 backend || true
    exit 2
  fi
fi

# Verifiser at vi finner backend-containeren (vi trenger docker exec for FD-count
# og pool-stats). Containere kan ha ulike navn avhengig av docker-compose-versjon.
if ! docker inspect "$BACKEND_CONTAINER" >/dev/null 2>&1; then
  # Forsøk å finne containeren via compose-prosjekt-navn
  CANDIDATE=$(docker ps --filter "label=com.docker.compose.service=backend" --format '{{.Names}}' | head -1)
  if [[ -n "$CANDIDATE" ]]; then
    info "Bytter BACKEND_CONTAINER til $CANDIDATE (auto-discovered)"
    BACKEND_CONTAINER="$CANDIDATE"
  else
    warn "Fant ikke backend-container '$BACKEND_CONTAINER' — FD/pool-metrics blir hoppet over"
  fi
fi

# ── §2 Migrate + seed pilot-data ─────────────────────────────────────────
info "Migrerer DB + seeder demo-pilot-day"
if docker exec "$BACKEND_CONTAINER" npm --prefix /app run migrate >/dev/null 2>&1; then
  pass "Migrering OK"
else
  warn "Migrate feilet eller var unødvendig — fortsetter"
fi

if docker exec -e DEMO_SEED_PASSWORD="$ADMIN_PASSWORD" "$BACKEND_CONTAINER" \
    node /app/dist/scripts/seed-demo-pilot-day.js >/dev/null 2>&1; then
  pass "Seed OK"
else
  warn "Seed feilet eller allerede kjørt — fortsetter"
fi

# ── §3 Login + sjekk at Spill 2-perpetual er aktivt ──────────────────────
info "Admin-login"
LOGIN_RESP=$(curl -sf -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>&1) \
  || { fail "Login feilet"; exit 2; }
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // empty')
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { fail "Ingen access-token i login-respons"; exit 2; }
pass "Login OK"

# ── §4 Sett opp samples-katalog ──────────────────────────────────────────
SAMPLES_DIR=$(mktemp -d -t r9-leak-test.XXXXXXXX)
info "Samples-katalog: $SAMPLES_DIR"
echo "[]" > "$SAMPLES_DIR/samples.json"

# ── §5 Start mock-trafikk (Spill 2 perpetual-loop) ───────────────────────
info "Starter $MOCK_PLAYER_COUNT mock-spillere mot Spill 2 (rocket)"
(
  cd "$REPO_ROOT" && \
    DEMO_SEED_PASSWORD="$ADMIN_PASSWORD" \
    node scripts/dev/mock-players.mjs \
      --count="$MOCK_PLAYER_COUNT" \
      --game=rocket \
      --backend="$BACKEND_URL" \
      --duration="$DURATION_S" \
      --quiet \
      > "$SAMPLES_DIR/mock-players.log" 2>&1
) &
MOCK_PID=$!
sleep 5
if ! kill -0 "$MOCK_PID" 2>/dev/null; then
  fail "Mock-spillere døde etter oppstart — sjekk log: $SAMPLES_DIR/mock-players.log"
  tail -30 "$SAMPLES_DIR/mock-players.log" || true
  exit 2
fi
pass "Mock-trafikk kjører (PID $MOCK_PID)"

# ── §6 Sample-funksjon ───────────────────────────────────────────────────
sample_state() {
  local label="$1"
  local out="$SAMPLES_DIR/sample-${label}.json"

  # Heap + RSS via Node /api/health-deep om eksisterende — ellers via
  # docker stats (RSS) og process.memoryUsage()-injection.
  local rss_mb heap_used_mb heap_total_mb fd_count
  local pg_active pg_idle redis_clients sock_clients

  rss_mb=$(docker stats --no-stream --format "{{.MemUsage}}" "$BACKEND_CONTAINER" 2>/dev/null \
    | awk '{print $1}' | sed 's/MiB//;s/GiB//' || echo "0")

  # Be backend om diagnostiske metrikker via en in-process snapshot.
  # Helperen tar et heap-snapshot HVIS label er i HEAP_SNAPSHOTS-listen.
  local snap_args=()
  IFS=',' read -ra SNAP_HOURS <<< "$HEAP_SNAPSHOTS"
  for h in "${SNAP_HOURS[@]}"; do
    if [[ "${label}" == "h${h}" ]]; then
      snap_args=(--snapshot)
      break
    fi
  done

  local helper_out
  helper_out=$(node "$SNAPSHOT_HELPER" --backend="$BACKEND_URL" \
    --token="$TOKEN" \
    --label="$label" \
    --out-dir="$SAMPLES_DIR" \
    "${snap_args[@]}" 2>&1) || helper_out='{"error":"helper-failed"}'

  heap_used_mb=$(echo "$helper_out" | jq -r '.heapUsedMb // 0')
  heap_total_mb=$(echo "$helper_out" | jq -r '.heapTotalMb // 0')
  fd_count=$(echo "$helper_out" | jq -r '.openFileDescriptors // 0')
  pg_active=$(echo "$helper_out" | jq -r '.dbPoolActive // 0')
  pg_idle=$(echo "$helper_out" | jq -r '.dbPoolIdle // 0')
  redis_clients=$(echo "$helper_out" | jq -r '.redisClients // 0')
  sock_clients=$(echo "$helper_out" | jq -r '.socketIoClients // 0')

  jq -n --arg label "$label" \
    --argjson rss "$rss_mb" \
    --argjson hu "$heap_used_mb" \
    --argjson ht "$heap_total_mb" \
    --argjson fd "$fd_count" \
    --argjson pgA "$pg_active" \
    --argjson pgI "$pg_idle" \
    --argjson rc "$redis_clients" \
    --argjson sc "$sock_clients" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{label:$label, ts:$ts, rssMb:$rss, heapUsedMb:$hu, heapTotalMb:$ht,
      openFds:$fd, dbPoolActive:$pgA, dbPoolIdle:$pgI,
      redisClients:$rc, socketIoClients:$sc}' \
    > "$out"

  # Append til samples.json
  jq -s '.[0] + [.[1]]' "$SAMPLES_DIR/samples.json" "$out" \
    > "$SAMPLES_DIR/samples.json.new" \
    && mv "$SAMPLES_DIR/samples.json.new" "$SAMPLES_DIR/samples.json"

  echo "$out"
}

# ── §7 Loop: ta én sample ved oppstart, deretter hver SAMPLE_INTERVAL_S ──
info "Tar baseline-sample (h0)"
sample_state "h0" >/dev/null

START_TIME=$(date +%s)
NEXT_SAMPLE=$((START_TIME + SAMPLE_INTERVAL_S))
HOUR=1
while :; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  if [[ $ELAPSED -ge $DURATION_S ]]; then
    info "Test-perioden (${DURATION_HOURS}t) er ferdig"
    break
  fi
  if [[ $NOW -ge $NEXT_SAMPLE ]]; then
    info "Sampling h${HOUR} (etter ${ELAPSED}s)"
    sample_state "h${HOUR}" >/dev/null
    HOUR=$((HOUR + 1))
    NEXT_SAMPLE=$((NEXT_SAMPLE + SAMPLE_INTERVAL_S))
  fi
  # Mock-trafikk-vakt: hvis mock-prosessen dør, avbryt med klar feil
  if ! kill -0 "$MOCK_PID" 2>/dev/null; then
    fail "Mock-spiller-prosess døde under testen"
    tail -30 "$SAMPLES_DIR/mock-players.log" || true
    exit 2
  fi
  sleep 5
done

info "Tar avsluttende sample (h${DURATION_HOURS})"
sample_state "h${DURATION_HOURS}" >/dev/null

# ── §8 Analyse + invariant-sjekk ─────────────────────────────────────────
info "Analyserer samples"

ANALYSIS=$(node "$SNAPSHOT_HELPER" --analyze \
  --samples="$SAMPLES_DIR/samples.json" \
  --heap-growth-limit-pct="$HEAP_GROWTH_LIMIT_PCT" \
  --fd-growth-limit-pct="$FD_GROWTH_LIMIT_PCT")

echo "$ANALYSIS" | jq .
echo "$ANALYSIS" > "$SAMPLES_DIR/analysis.json"

# Eksporter også flat trend-CSV — gjør det enklere å plotte heatmap eller
# importere til Excel/Grafana. CSV-en er deterministisk ut fra samples.json.
node "$SNAPSHOT_HELPER" --csv \
  --samples="$SAMPLES_DIR/samples.json" \
  --out-csv="$SAMPLES_DIR/trends.csv" >/dev/null 2>&1 \
  && info "Trend-CSV: $SAMPLES_DIR/trends.csv" \
  || warn "Kunne ikke generere trends.csv (fortsetter — JSON-rapport finnes)"

OK=$(echo "$ANALYSIS" | jq -r '.ok')
HEAP_GROWTH=$(echo "$ANALYSIS" | jq -r '.heapGrowthPct')
FD_GROWTH=$(echo "$ANALYSIS" | jq -r '.fdGrowthPct')
ERRORS=$(echo "$ANALYSIS" | jq -r '.errors[]?' || true)

echo
if [[ "$OK" == "true" ]]; then
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
  echo -e "${GREEN} R9 SPILL 2 LEAK-TEST: PASSED${RESET}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════${RESET}"
  echo "  Heap-vekst: ${HEAP_GROWTH}% (grense ${HEAP_GROWTH_LIMIT_PCT}%)"
  echo "  FD-vekst:   ${FD_GROWTH}% (grense ${FD_GROWTH_LIMIT_PCT}%)"
  echo "  Samples:    $SAMPLES_DIR/samples.json"
  echo "  Analyse:    $SAMPLES_DIR/analysis.json"
  echo
  echo "  Anbefaling: produksjons-klar fra leak-perspektiv."
  echo "  Se docs/operations/R9_SPILL2_LEAK_TEST_RESULT.md for full rapport."
  exit 0
else
  echo -e "${RED}═══════════════════════════════════════════════════════════════${RESET}"
  echo -e "${RED} R9 SPILL 2 LEAK-TEST: FAILED${RESET}"
  echo -e "${RED}═══════════════════════════════════════════════════════════════${RESET}"
  echo "  Heap-vekst: ${HEAP_GROWTH}% (grense ${HEAP_GROWTH_LIMIT_PCT}%)"
  echo "  FD-vekst:   ${FD_GROWTH}% (grense ${FD_GROWTH_LIMIT_PCT}%)"
  echo
  if [[ -n "$ERRORS" ]]; then
    echo "  Feil-detaljer:"
    echo "$ERRORS" | sed 's/^/    - /'
  fi
  echo
  echo "  Samples:    $SAMPLES_DIR/samples.json"
  echo "  Analyse:    $SAMPLES_DIR/analysis.json"
  echo
  warn "Heap-snapshots i $SAMPLES_DIR/heap-h*.heapsnapshot kan analyseres"
  warn "i Chrome DevTools (Memory-tab → Load — sammenlign h0 vs h${DURATION_HOURS})."
  exit 1
fi
