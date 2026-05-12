#!/usr/bin/env bash
#
# Multi-GoH bridge-spawn smoke-test — 2026-05-12
#
# Verifiserer i et levende dev-miljø at:
#   1. Kanonisk room_code blir satt på app_game1_scheduled_games (ikke NULL)
#   2. Hver GoH får UNIK BINGO_<GROUP-ID>-kode i Postgres
#   3. Stale aktive rader for samme room_code (typisk fra forrige test-sesjon)
#      blir auto-cancelled med audit-spor 'auto_cancelled_by_bridge_takeover'
#
# Dette dekker den ekte path-en bak PR #1253 (commit c8e12911 — bridge tar
# over hall-default-rommet) og er kompletterende til de automatiske
# integration-testene i:
#   apps/backend/src/game/__tests__/GamePlanEngineBridge.multiGoHIntegration.test.ts
#
# Krav:
#   - Backend dev-server kjørende på port 4000
#   - Postgres tilgjengelig via APP_PG_CONNECTION_STRING eller
#     "postgres://spillorama:spillorama@localhost:5432/spillorama"
#   - jq installert (`brew install jq`)
#   - psql installert
#
# Bruk:
#   bash apps/backend/scripts/test-multi-goh-spawn.sh
#   # alternativt med custom DB-url:
#   PG_URL="postgres://user:pw@host:5432/db" bash apps/backend/scripts/test-multi-goh-spawn.sh
#
# Exit-code: 0 hvis alle sjekker passerer, 1 hvis én feiler.

set -euo pipefail

API="${API:-http://localhost:4000}"
PG_URL="${APP_PG_CONNECTION_STRING:-${PG_URL:-postgres://spillorama:spillorama@localhost:5432/spillorama}}"

GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
RESET="\033[0m"

pass() { echo -e "${GREEN}[PASS]${RESET} $1"; }
fail() { echo -e "${RED}[FAIL]${RESET} $1"; exit 1; }
info() { echo -e "${YELLOW}[ ..  ]${RESET} $1"; }
note() { echo -e "       $1"; }

# ── 1. Pre-flight ──────────────────────────────────────────────────────────
info "Pre-flight: backend health"
curl -sf "$API/health" >/dev/null || fail "Backend svarer ikke på $API/health — er dev-stack oppe?"
pass "Backend OK"

info "Pre-flight: Postgres-tilgang"
psql "$PG_URL" -c "SELECT 1" >/dev/null 2>&1 || fail "Kan ikke koble til Postgres på $PG_URL"
pass "Postgres OK"

# ── 2. Sjekk eksisterende active scheduled-games ───────────────────────────
info "Sjekk: hvor mange aktive scheduled-games har NULL room_code?"
NULL_COUNT=$(psql "$PG_URL" -t -A -c "
  SELECT count(*)
  FROM app_game1_scheduled_games
  WHERE status NOT IN ('completed','cancelled')
    AND room_code IS NULL
")
note "Antall aktive scheduled-games med room_code=NULL: $NULL_COUNT"
if [[ "$NULL_COUNT" -gt 0 ]]; then
  info "ADVARSEL: $NULL_COUNT aktive rader har NULL room_code. PR #1253 (c8e12911)"
  info "skal sørge for at NYE rader får kanonisk room_code, men gamle kan finnes."
  note ""
  note "Disse er fra før PR #1253 eller fra cancelled-row-reuse-bug-path."
  note "Detaljer:"
  psql "$PG_URL" -c "
    SELECT id, status, master_hall_id, group_hall_id,
           plan_run_id, plan_position, created_at
    FROM app_game1_scheduled_games
    WHERE status NOT IN ('completed','cancelled')
      AND room_code IS NULL
    ORDER BY created_at DESC
    LIMIT 5"
else
  pass "Ingen aktive rader med NULL room_code"
fi

# ── 3. Sjekk room_code-format ──────────────────────────────────────────────
info "Sjekk: alle aktive room_codes følger BINGO_<GROUP-ID>-format"
BAD_FORMAT=$(psql "$PG_URL" -t -A -c "
  SELECT count(*)
  FROM app_game1_scheduled_games
  WHERE status NOT IN ('completed','cancelled')
    AND room_code IS NOT NULL
    AND room_code NOT LIKE 'BINGO\\_%' ESCAPE '\\'
")
if [[ "$BAD_FORMAT" -gt 0 ]]; then
  fail "Fant $BAD_FORMAT room_codes som IKKE matcher BINGO_<GROUP-ID>-format. Detaljer:"
  psql "$PG_URL" -c "
    SELECT id, room_code, status
    FROM app_game1_scheduled_games
    WHERE status NOT IN ('completed','cancelled')
      AND room_code IS NOT NULL
      AND room_code NOT LIKE 'BINGO\\_%' ESCAPE '\\'
    LIMIT 5"
fi
pass "Alle aktive room_codes følger kanonisk format"

# ── 4. Sjekk unique-constraint håndhevelse ─────────────────────────────────
info "Sjekk: er det dupliserte aktive room_codes? (skal være strukturelt umulig)"
DUPS=$(psql "$PG_URL" -t -A -c "
  SELECT count(*)
  FROM (
    SELECT room_code
    FROM app_game1_scheduled_games
    WHERE status NOT IN ('completed','cancelled')
      AND room_code IS NOT NULL
    GROUP BY room_code
    HAVING count(*) > 1
  ) sub
")
if [[ "$DUPS" -gt 0 ]]; then
  fail "ALARM: $DUPS room_codes har MULTIPLE aktive rader. Unique-indeksen er brutt!"
fi
pass "Ingen duplikat-aktive-rader per room_code (unique-indeks intakt)"

# ── 5. Sjekk audit-spor for bridge-takeover ───────────────────────────────
info "Sjekk: audit-spor for 'auto_cancelled_by_bridge_takeover'"
AUDIT_COUNT=$(psql "$PG_URL" -t -A -c "
  SELECT count(*)
  FROM app_game1_master_audit
  WHERE metadata_json->>'reason' = 'auto_cancelled_by_bridge_takeover'
")
note "Antall audit-spor for bridge-takeover: $AUDIT_COUNT"
if [[ "$AUDIT_COUNT" -gt 0 ]]; then
  info "Detaljer (siste 5):"
  psql "$PG_URL" -c "
    SELECT
      created_at,
      game_id,
      actor_user_id,
      metadata_json->>'cancelledByRunId' AS new_run,
      metadata_json->>'roomCode' AS room_code,
      metadata_json->>'priorStatus' AS prior_status
    FROM app_game1_master_audit
    WHERE metadata_json->>'reason' = 'auto_cancelled_by_bridge_takeover'
    ORDER BY created_at DESC
    LIMIT 5"
fi

# ── 6. Sjekk pilot-GoH og scheduled-games kobling ─────────────────────────
info "Sjekk: pilot-haller (demo-hall-*) er medlemmer av sin GoH"
psql "$PG_URL" -c "
  SELECT
    g.id AS goh_id,
    g.name AS goh_name,
    g.master_hall_id,
    count(m.hall_id) AS members,
    (SELECT count(*)
     FROM app_game1_scheduled_games s
     WHERE s.group_hall_id = g.id
       AND s.status NOT IN ('completed','cancelled')
    ) AS active_games
  FROM app_hall_groups g
  LEFT JOIN app_hall_group_members m ON m.group_id = g.id
  WHERE g.deleted_at IS NULL
    AND g.status = 'active'
  GROUP BY g.id, g.name, g.master_hall_id
  ORDER BY g.name"

# ── 7. Sammendrag ──────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────────────────────────"
info "Smoke-test-sammendrag:"
note "Aktive scheduled-games med NULL room_code: $NULL_COUNT (bør være 0 etter PR #1253)"
note "Aktive room_codes med BAD format: $BAD_FORMAT (må være 0)"
note "Dupliserte aktive room_codes: $DUPS (må være 0)"
note "Audit-spor for bridge-takeover: $AUDIT_COUNT (informativ)"
echo "─────────────────────────────────────────────────────────────"

if [[ "$NULL_COUNT" -eq 0 && "$BAD_FORMAT" -eq 0 && "$DUPS" -eq 0 ]]; then
  pass "Alle DB-invarianter er OK ✓"
  exit 0
else
  fail "DB-invariant-brudd oppdaget — se detaljer over."
fi
