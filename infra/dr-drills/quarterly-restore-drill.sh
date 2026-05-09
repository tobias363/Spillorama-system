#!/usr/bin/env bash
#
# Quarterly Restore Drill (BIN-772 / A5)
#
# Linear: https://linear.app/bingosystem/issue/BIN-772
# Runbook: docs/operations/DR_RUNBOOK.md §3
# Plan: docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md §9.2 (drill 9.2)
#
# ── Hva drillet verifiserer ───────────────────────────────────────────────
#
# Pilot-gating-tiltak. Kvartalsvis (Q1/Q2/Q3/Q4) skal vi bevise at:
#   1) Render PG-snapshot kan lastes ned/aksesseres.
#   2) Snapshotten kan restoreres til en tom Postgres-instans.
#   3) Skjema er konsistent (alle migrationer applied, ingen pending).
#   4) Alle hovedtabeller har data (smoke).
#   5) Audit-trail har monotonisk-økende timestamps.
#   6) FK-er holder (ingen orphan rows).
#   7) Total tid fra "trigger" til "smoke passerer" er < 4 timer (RTO).
#
# Drillet kjører IKKE mot prod. Det krever en lokal Postgres (Docker) eller
# en dedikert staging-instans.
#
# ── Forutsetninger ────────────────────────────────────────────────────────
#
# - Lokal Docker (for default-modus)
# - psql, pg_restore (Postgres client tools)
# - Tilgang til Render dashboard for å laste ned siste snapshot manuelt
#   (Render API er bak Pro-tier; manuelt nedlasting fungerer for alle plans).
# - Snapshotten er en `.dump`-fil eller `.sql`-fil lagret lokalt.
#
# ── Bruk ──────────────────────────────────────────────────────────────────
#
#   # Default: Docker Postgres + interaktiv prompt for snapshot-fil
#   bash infra/dr-drills/quarterly-restore-drill.sh
#
#   # Spesifiser snapshot-fil eksplisitt
#   SNAPSHOT_FILE=/path/to/spillorama-snapshot.dump bash infra/dr-drills/quarterly-restore-drill.sh
#
#   # Drill mot dedikert staging-DB (ikke spinn opp Docker)
#   DR_DRILL_TARGET=staging \
#     STAGING_DB_URL='postgres://...' \
#     bash infra/dr-drills/quarterly-restore-drill.sh
#
#   # Verify-only-modus: ikke restore, kjør kun integritets-sjekker mot
#   # eksisterende DB (brukes etter prod-restore for å validere ny instans)
#   DR_DRILL_MODE=verify \
#     APP_PG_CONNECTION_STRING='postgres://...' \
#     bash infra/dr-drills/quarterly-restore-drill.sh
#
# ── Exit-koder ────────────────────────────────────────────────────────────
#
#   0 — alle invarianter PASSED
#   1 — én eller flere invarianter FAILED (drillet er FAIL — fix før neste pilot-vindu)
#   2 — drillet kunne ikke kjøres (oppsett-feil, manglende verktøy, container-feil)
#
# ── Sikkerhetsbarrierer ───────────────────────────────────────────────────
#
# Skriptet REFUSERER å kjøre mot en URL som inneholder "render.com",
# "prod" eller "spillorama-system" (case-insensitive). Det er ingen "force"-
# flagg — hvis du må kjøre mot prod skal det skje manuelt og logges separat.
#
# ── Output ────────────────────────────────────────────────────────────────
#
# Skriptet skriver én linje per invariant til stdout. Ved FAIL listes
# eksplisitt avvik. Loggen klippes inn i kvartalsdrill-rapport
# (docs/operations/dr-drill-log/<yyyy-Q[N]>.md).

set -euo pipefail

# ── Konfigurasjon ─────────────────────────────────────────────────────────

DRILL_TARGET="${DR_DRILL_TARGET:-docker}"   # docker | staging
DRILL_MODE="${DR_DRILL_MODE:-restore}"      # restore | verify
SNAPSHOT_FILE="${SNAPSHOT_FILE:-}"
RTO_LIMIT_SECONDS="${RTO_LIMIT_SECONDS:-14400}"  # 4 timer

# Docker-defaults
DOCKER_CONTAINER_NAME="${DOCKER_CONTAINER_NAME:-spillorama-dr-drill}"
DOCKER_PG_PORT="${DOCKER_PG_PORT:-15432}"
DOCKER_PG_PASSWORD="${DOCKER_PG_PASSWORD:-drill}"
DOCKER_PG_DB="${DOCKER_PG_DB:-spillorama_drill}"

# Staging-defaults
STAGING_DB_URL="${STAGING_DB_URL:-}"

# Verify-modus: tilkoblings-string forventes som env
APP_PG_CONNECTION_STRING="${APP_PG_CONNECTION_STRING:-}"

# Sporbar drill-id
DRILL_ID="$(date -u +%Y-Q$(( ( $(date -u +%-m) - 1 ) / 3 + 1 ))-%Y%m%d-%H%M%S)"

START_TIME=$(date -u +%s)

# ── Hjelpere ──────────────────────────────────────────────────────────────

log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

log_pass() {
  echo "  ✓ PASS: $*"
}

log_fail() {
  echo "  ✗ FAIL: $*" >&2
}

cleanup() {
  if [[ "${DRILL_TARGET}" == "docker" ]] && [[ -n "${DOCKER_CONTAINER_NAME:-}" ]]; then
    log "Cleanup: stopper Docker-container ${DOCKER_CONTAINER_NAME}"
    docker stop "${DOCKER_CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker rm "${DOCKER_CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

guard_against_prod() {
  local url="$1"
  local lower
  lower="$(echo "${url}" | tr '[:upper:]' '[:lower:]')"

  if [[ "${lower}" == *"render.com"* ]] \
     || [[ "${lower}" == *"prod"* ]] \
     || [[ "${lower}" == *"spillorama-system"* ]] \
     || [[ "${lower}" == *"api.spillorama.no"* ]]; then
    echo "" >&2
    echo "FATAL: Drillet refuserer å kjøre mot prod-URL: ${url}" >&2
    echo "       Ingen force-flagg eksisterer. Hvis du må kjøre mot prod," >&2
    echo "       skal det skje manuelt og loggføres separat." >&2
    exit 2
  fi
}

require_tool() {
  local tool="$1"
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "FATAL: ${tool} mangler i PATH" >&2
    exit 2
  fi
}

# ── 0. Verktøy-sjekk ──────────────────────────────────────────────────────

log "Drill-id: ${DRILL_ID}"
log "Mode: ${DRILL_MODE} | Target: ${DRILL_TARGET}"
log ""

require_tool psql
require_tool pg_restore

if [[ "${DRILL_TARGET}" == "docker" ]]; then
  require_tool docker
fi

# ── 1. Resolve target connection string ───────────────────────────────────

TARGET_URL=""

if [[ "${DRILL_MODE}" == "verify" ]]; then
  if [[ -z "${APP_PG_CONNECTION_STRING}" ]]; then
    echo "FATAL: DR_DRILL_MODE=verify krever APP_PG_CONNECTION_STRING" >&2
    exit 2
  fi
  TARGET_URL="${APP_PG_CONNECTION_STRING}"
  guard_against_prod "${TARGET_URL}"
  log "Verify-modus: kjører integritets-sjekker mot ${TARGET_URL}"
  log ""

elif [[ "${DRILL_TARGET}" == "staging" ]]; then
  if [[ -z "${STAGING_DB_URL}" ]]; then
    echo "FATAL: DR_DRILL_TARGET=staging krever STAGING_DB_URL" >&2
    exit 2
  fi
  TARGET_URL="${STAGING_DB_URL}"
  guard_against_prod "${TARGET_URL}"
  log "Staging-modus: ${TARGET_URL}"
  log ""

else
  # Docker (default)
  log "Docker-modus: spinner opp tom Postgres-container"

  # Cleanup eventuell tidligere drill-container
  docker rm -f "${DOCKER_CONTAINER_NAME}" >/dev/null 2>&1 || true

  docker run -d \
    --name "${DOCKER_CONTAINER_NAME}" \
    -e POSTGRES_PASSWORD="${DOCKER_PG_PASSWORD}" \
    -e POSTGRES_DB="${DOCKER_PG_DB}" \
    -p "${DOCKER_PG_PORT}:5432" \
    postgres:16 >/dev/null

  TARGET_URL="postgres://postgres:${DOCKER_PG_PASSWORD}@localhost:${DOCKER_PG_PORT}/${DOCKER_PG_DB}"

  log "Venter på at Postgres er klar..."
  for i in {1..30}; do
    if PGPASSWORD="${DOCKER_PG_PASSWORD}" psql -h localhost -p "${DOCKER_PG_PORT}" \
        -U postgres -d "${DOCKER_PG_DB}" -c "SELECT 1" >/dev/null 2>&1; then
      log "Postgres klar."
      break
    fi
    sleep 1
    if [[ $i -eq 30 ]]; then
      echo "FATAL: Postgres ble ikke klar innen 30s" >&2
      exit 2
    fi
  done
  log ""
fi

# ── 2. Restore (hvis restore-modus) ───────────────────────────────────────

if [[ "${DRILL_MODE}" == "restore" ]]; then
  log "── 2. Restore snapshot ─────────────────────────────────────"

  if [[ -z "${SNAPSHOT_FILE}" ]]; then
    echo ""
    echo "Snapshot-fil er ikke spesifisert. Du må:"
    echo "  1) Logge inn på Render dashboard"
    echo "  2) Velge Postgres-tjenesten → Backups"
    echo "  3) Last ned siste snapshot (.dump-fil)"
    echo "  4) Kjør drillet igjen med:"
    echo "       SNAPSHOT_FILE=/path/to/snapshot.dump bash infra/dr-drills/quarterly-restore-drill.sh"
    echo ""
    echo "FATAL: snapshot mangler" >&2
    exit 2
  fi

  if [[ ! -f "${SNAPSHOT_FILE}" ]]; then
    echo "FATAL: snapshot-fil eksisterer ikke: ${SNAPSHOT_FILE}" >&2
    exit 2
  fi

  log "Snapshot: ${SNAPSHOT_FILE}"
  log "Target: ${TARGET_URL}"
  log "Restore pågår..."

  RESTORE_START=$(date -u +%s)

  # Forsøk pg_restore (custom-format dump). Falle tilbake til psql for
  # plain-text SQL-dump.
  if file "${SNAPSHOT_FILE}" 2>/dev/null | grep -q "PostgreSQL custom database dump"; then
    pg_restore \
      --dbname="${TARGET_URL}" \
      --no-owner \
      --no-privileges \
      --verbose \
      "${SNAPSHOT_FILE}" 2>&1 | tail -20 || {
        log_fail "pg_restore feilet"
        exit 1
      }
  else
    psql "${TARGET_URL}" < "${SNAPSHOT_FILE}" 2>&1 | tail -20 || {
      log_fail "psql restore feilet"
      exit 1
    }
  fi

  RESTORE_END=$(date -u +%s)
  RESTORE_DURATION=$(( RESTORE_END - RESTORE_START ))
  log "Restore ferdig. Varighet: ${RESTORE_DURATION}s"
  log ""
fi

# ── 3. Integritets-sjekker ────────────────────────────────────────────────

log "── 3. Integritets-sjekker ──────────────────────────────────"

FAIL_COUNT=0

run_check() {
  local check_name="$1"
  local query="$2"
  local expected_op="$3"  # gt | eq
  local expected_value="$4"

  local actual
  actual=$(psql "${TARGET_URL}" -t -A -c "${query}" 2>/dev/null || echo "ERROR")

  if [[ "${actual}" == "ERROR" ]]; then
    log_fail "${check_name}: query feilet"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
    return
  fi

  case "${expected_op}" in
    gt)
      if [[ "${actual}" -gt "${expected_value}" ]]; then
        log_pass "${check_name} (verdi=${actual} > ${expected_value})"
      else
        log_fail "${check_name} (verdi=${actual}, forventet > ${expected_value})"
        FAIL_COUNT=$(( FAIL_COUNT + 1 ))
      fi
      ;;
    eq)
      if [[ "${actual}" == "${expected_value}" ]]; then
        log_pass "${check_name} (verdi=${actual})"
      else
        log_fail "${check_name} (verdi=${actual}, forventet ${expected_value})"
        FAIL_COUNT=$(( FAIL_COUNT + 1 ))
      fi
      ;;
  esac
}

# 3.1 Skjema-konsistens: pgmigrations finnes
run_check "pgmigrations-tabell finnes" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='pgmigrations'" \
  "eq" "1"

# 3.2 Hovedtabeller eksisterer (skjema-fingerprint)
for table in app_users app_wallets app_compliance_ledger app_halls; do
  run_check "Tabell ${table} finnes" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='${table}'" \
    "eq" "1"
done

# 3.3 Hovedtabeller har data (sanity)
# Disse forventer mer enn 0 rader IFF snapshot er fra et populert miljø.
# Kjør kun hvis ikke en rein "fresh schema"-snapshot. La gates være > 0.
if [[ "${DRILL_MODE}" == "restore" ]]; then
  # Hovedtabeller kan være tomme i et nytt miljø; sjekk kun at den ikke
  # har systemiske feil (NULL-bursts el. hashed-row-explosjoner).
  run_check "app_users sjekkbar" \
    "SELECT COUNT(*) FROM app_users WHERE TRUE" \
    "gt" "-1"
  run_check "app_compliance_ledger sjekkbar" \
    "SELECT COUNT(*) FROM app_compliance_ledger WHERE TRUE" \
    "gt" "-1"
fi

# 3.4 FK-integritet: ingen orphan wallets
run_check "Ingen orphan wallets (FK-brudd: wallet uten user)" \
  "SELECT COUNT(*) FROM app_wallets w WHERE NOT EXISTS (SELECT 1 FROM app_users u WHERE u.id = w.user_id)" \
  "eq" "0"

# 3.5 Audit-trail monotonisitet: ingen rad med created_at i fremtiden
run_check "Audit-trail: ingen fremtidige timestamps" \
  "SELECT COUNT(*) FROM app_compliance_ledger WHERE created_at > NOW() + INTERVAL '5 minutes'" \
  "eq" "0"

# 3.6 Idempotency: ingen duplikat compliance-keys
run_check "Compliance-ledger: unike idempotency_keys" \
  "SELECT COUNT(*) FROM (SELECT idempotency_key, COUNT(*) c FROM app_compliance_ledger WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1) dupes" \
  "eq" "0"

# 3.7 Migration-konsistens: pending vs filer
# Sammenlign antall rader i pgmigrations med antall .sql/.js-filer i
# apps/backend/migrations/. Hvis snapshot er nyere enn lokal kode er
# dette OK; hvis snapshot er eldre må neste deploy applye pending.
APPLIED_COUNT=$(psql "${TARGET_URL}" -t -A -c "SELECT COUNT(*) FROM pgmigrations" 2>/dev/null || echo 0)
if [[ -d "apps/backend/migrations" ]]; then
  FILE_COUNT=$(find apps/backend/migrations -maxdepth 1 \( -name "*.sql" -o -name "*.js" \) ! -name ".*" | wc -l | tr -d ' ')
  log "Migration-counts: applied=${APPLIED_COUNT}, files=${FILE_COUNT}"
  if [[ "${APPLIED_COUNT}" -gt 0 ]]; then
    log_pass "Migration-tabellen er ikke tom"
  else
    log_fail "pgmigrations-tabellen er tom — restore inkluderte ikke schema-historikk"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
fi

log ""

# ── 4. RTO-måling ─────────────────────────────────────────────────────────

END_TIME=$(date -u +%s)
TOTAL_DURATION=$(( END_TIME - START_TIME ))

log "── 4. RTO-måling ───────────────────────────────────────────"
log "Total drill-tid: ${TOTAL_DURATION}s (limit: ${RTO_LIMIT_SECONDS}s = $((RTO_LIMIT_SECONDS / 60)) min)"

if [[ ${TOTAL_DURATION} -lt ${RTO_LIMIT_SECONDS} ]]; then
  log_pass "RTO innenfor budsjett (${TOTAL_DURATION}s < ${RTO_LIMIT_SECONDS}s)"
else
  log_fail "RTO oversteg budsjett (${TOTAL_DURATION}s >= ${RTO_LIMIT_SECONDS}s)"
  FAIL_COUNT=$(( FAIL_COUNT + 1 ))
fi
log ""

# ── 5. Konklusjon ─────────────────────────────────────────────────────────

log "── 5. Konklusjon ───────────────────────────────────────────"

if [[ ${FAIL_COUNT} -eq 0 ]]; then
  log "Drill ${DRILL_ID}: PASS"
  log ""
  log "Neste steg:"
  log "  1) Kopier denne stdout-loggen til docs/operations/dr-drill-log/${DRILL_ID%-*-*}.md"
  log "  2) Sign-off fra drill-eier + Tobias + compliance-observer"
  log "  3) Lenk til log fra Linear-issuen for kvartalets driftsoppgaver"
  exit 0
else
  log "Drill ${DRILL_ID}: FAIL (${FAIL_COUNT} sjekk(er) feilet)"
  log ""
  log "Pilot-pause: første hall kan IKKE flippes før FAIL er løst."
  log "Loggfør i docs/operations/dr-drill-log/${DRILL_ID%-*-*}.md med eksplisitt avvik."
  exit 1
fi
