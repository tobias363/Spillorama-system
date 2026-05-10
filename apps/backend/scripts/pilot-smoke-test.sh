#!/usr/bin/env bash
#
# Pilot-flow smoke-test — 2026-05-08
#
# Verifiserer at backend-API svarer riktig for pilot-flowen som er beskrevet
# i docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md. Bruk denne FØR du
# kjører den manuelle browser-flyten — så finner du auth-/seed-/route-feil
# før du har klikket gjennom 4 incognito-vinduer.
#
# Krav:
#   - jq installert (`brew install jq`)
#   - Backend dev-server kjørende på port 4000
#   - Demo-data seedet (npm --prefix apps/backend run seed:demo-pilot-day)
#
# Bruk:
#   bash apps/backend/scripts/pilot-smoke-test.sh
#   # eller med eksplisitt passord (unngår prompt):
#   ADMIN_PASSWORD='<passord>' bash apps/backend/scripts/pilot-smoke-test.sh
#
# Exit-code: 0 hvis alle sjekker passerer, 1 hvis én feiler.

set -euo pipefail

API="${API:-http://localhost:4000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-tobias@nordicprofil.no}"

# Farger for terminal-output
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
RESET="\033[0m"

pass() { echo -e "${GREEN}[PASS]${RESET} $1"; }
fail() { echo -e "${RED}[FAIL]${RESET} $1"; exit 1; }
info() { echo -e "${YELLOW}[ ..  ]${RESET} $1"; }

# 2026-05-10: macOS bash 3.2 + curl 8.7.1 har en kjent bug der `$(curl ...)`
# returnerer truncated body (typisk "20" istedenfor JSON) ved sekvensielle
# admin-API-kall. Hverken `cat`, `--no-buffer`, eller `--http1.0` fikser det
# konsekvent. Workaround: skriv curl-output til fil først, kjør jq direkte
# mot filen. `jq -r '...' /path/file` capturer korrekt via `$()`.
#
# Bruksmønster:
#   curl_to_file "$API/api/admin/game-catalog" "$CURL_TMP/catalog.json"
#   COUNT=$(jq -r '.data.entries | length' "$CURL_TMP/catalog.json")
#
# Bruk `mktemp -d` og rens via trap.
CURL_TMP=$(mktemp -d -t pilot-smoke.XXXXX)
trap "rm -rf '$CURL_TMP'" EXIT

curl_to_file() {
  local url="$1"
  local outfile="$2"
  curl -sf -H "Authorization: Bearer $TOKEN" "$url" -o "$outfile"
}

# ── §0.1 Health check ──────────────────────────────────────────────────────
info "Health check ($API/health)"
HEALTH=$(curl -sf "$API/health" 2>&1) || fail "Health endpoint svarer ikke. Er backend kjørende på $API?"
echo "$HEALTH" | jq -e '.status == "ok" or .ok == true' >/dev/null 2>&1 \
  || fail "Health response uventet: $HEALTH"
pass "Backend health OK"

# ── §0.2 Admin login ───────────────────────────────────────────────────────
info "Login som $ADMIN_EMAIL"
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -r -s -p "Admin-passord for $ADMIN_EMAIL: " ADMIN_PASSWORD
  echo
fi

LOGIN_RESP=$(curl -sf -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>&1) \
  || fail "Login feilet — sjekk passord og at brukeren finnes."

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // empty')
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || fail "Ingen accessToken i login-response: $LOGIN_RESP"
pass "Admin login OK (token: ${TOKEN:0:12}…)"

AUTH=(-H "Authorization: Bearer $TOKEN")

# ── §0.3 Game-katalog ──────────────────────────────────────────────────────
info "GET /api/admin/game-catalog"
curl_to_file "$API/api/admin/game-catalog" "$CURL_TMP/catalog.json" \
  || fail "Game-catalog endpoint feilet."

CATALOG_COUNT=$(jq -r '.data.entries | length // 0' "$CURL_TMP/catalog.json")
[[ "$CATALOG_COUNT" -ge 1 ]] || fail "Game-catalog er tom (forventet ≥ 1 entry, fikk $CATALOG_COUNT)."
pass "Game-katalog inneholder $CATALOG_COUNT entries"

# Sjekk at bingo-slug finnes
BINGO_PRESENT=$(jq -r '[.data.entries[] | select(.slug=="bingo")] | length' "$CURL_TMP/catalog.json")
[[ "$BINGO_PRESENT" -ge 1 ]] || fail "Bingo-slug mangler i game-katalog."
pass "Bingo (Spill 1) finnes i katalog"

# ── §0.4 Hall-grupper ──────────────────────────────────────────────────────
info "GET /api/admin/hall-groups"
curl_to_file "$API/api/admin/hall-groups" "$CURL_TMP/groups.json" \
  || fail "Hall-groups endpoint feilet."

# 2026-05-10 fix: Endpoint returns { ok: true, data: { groups: [...], count: N } }
# — bug i tidligere versjon brukte .data | length som returnerer 2 (antall keys
# i wrapper-objektet) heller enn faktisk groups-count.
GROUP_COUNT=$(jq -r '.data.groups | length // 0' "$CURL_TMP/groups.json")
[[ "$GROUP_COUNT" -ge 1 ]] || fail "Ingen hall-grupper funnet — kjør seed-demo-pilot-day først."
pass "Antall hall-grupper: $GROUP_COUNT"

# Print groups + member counts
jq -r '.data.groups[] | "  - \(.name) (id=\(.id))"' "$CURL_TMP/groups.json"

# ── §0.5 Haller ────────────────────────────────────────────────────────────
info "GET /api/admin/halls"
curl_to_file "$API/api/admin/halls" "$CURL_TMP/halls.json" \
  || fail "Halls endpoint feilet."

# /api/admin/halls returnerer .data som array (ikke wrapper), slik at .data | length er korrekt.
HALL_COUNT=$(jq -r '.data | length // 0' "$CURL_TMP/halls.json")
[[ "$HALL_COUNT" -ge 4 ]] || fail "Forventet ≥ 4 haller, fikk $HALL_COUNT. Seed mangler?"
pass "Antall haller: $HALL_COUNT"

# Print pilot-halls (demo-hall-001..004)
jq -r '.data[] | select(.id | startswith("demo-hall-")) | "  - \(.name) (id=\(.id), nr=\(.hallNumber // "?"))"' "$CURL_TMP/halls.json"

PILOT_HALL_COUNT=$(jq -r '[.data[] | select(.id | startswith("demo-hall-"))] | length' "$CURL_TMP/halls.json")
[[ "$PILOT_HALL_COUNT" -ge 4 ]] || fail "Forventet 4 demo-hall-* pilot-haller, fikk $PILOT_HALL_COUNT."
pass "4 pilot-haller (demo-hall-001..004) eksisterer"

# ── §0.6 Auth/me ────────────────────────────────────────────────────────────
info "GET /api/auth/me — verifiser at token virker"
curl_to_file "$API/api/auth/me" "$CURL_TMP/me.json" || fail "auth/me feilet."
ROLE=$(jq -r '.data.role // empty' "$CURL_TMP/me.json")
[[ "$ROLE" == "ADMIN" || "$ROLE" == "admin" ]] || fail "Forventet ADMIN-rolle, fikk: $ROLE"
pass "Token gjelder ADMIN-bruker"

# ── §0.7 Eksisterende game-plans (advisory) ────────────────────────────────
info "GET /api/admin/game-plans — eksisterende planer"
curl_to_file "$API/api/admin/game-plans?isActive=true" "$CURL_TMP/plans.json" || true
# /api/admin/game-plans returnerer { plans: [...], count: N } i .data.
if [[ -f "$CURL_TMP/plans.json" ]]; then
  PLAN_COUNT=$(jq -r '.data.plans | length // 0' "$CURL_TMP/plans.json" 2>/dev/null || echo 0)
else
  PLAN_COUNT=0
fi
echo "  Aktive game-plans: $PLAN_COUNT"

# ── §0.8 Spillere demo-spiller-* og demo-pilot-spiller-* ──────────────────
# 2026-05-10 fix: bruk /api/admin/players/search (faktisk endpoint) istedenfor
# /api/admin/players (som ikke finnes — fall-through til admin-web SPA og
# returnerer HTML).
info "Sjekk demo-spillere via /api/admin/players/search"
curl_to_file "$API/api/admin/players/search?query=demo-pilot-spiller&limit=20" "$CURL_TMP/pilot-players.json" || true
PILOT_DEMO_COUNT=0
if [[ -f "$CURL_TMP/pilot-players.json" ]]; then
  PILOT_DEMO_COUNT=$(jq -r '.data.count // 0' "$CURL_TMP/pilot-players.json" 2>/dev/null || echo 0)
fi

curl_to_file "$API/api/admin/players/search?query=demo-spiller&limit=20" "$CURL_TMP/demo-players.json" || true
DEMO_COUNT=0
if [[ -f "$CURL_TMP/demo-players.json" ]]; then
  DEMO_COUNT=$(jq -r '.data.count // 0' "$CURL_TMP/demo-players.json" 2>/dev/null || echo 0)
fi

if [[ "$PILOT_DEMO_COUNT" -ge 4 ]]; then
  pass "Minst 4 demo-pilot-spiller-* eksisterer (fant $PILOT_DEMO_COUNT)"
elif [[ "$DEMO_COUNT" -ge 4 ]]; then
  pass "Minst 4 demo-spiller-* eksisterer (fant $DEMO_COUNT)"
else
  echo -e "${YELLOW}[WARN]${RESET} Fant kun $DEMO_COUNT demo-spiller-* og $PILOT_DEMO_COUNT demo-pilot-spiller-* — sjekk seed-script"
fi

echo
echo -e "${GREEN}═══════════════════════════════════════════${RESET}"
echo -e "${GREEN}Smoke-test komplett — backend er klar.${RESET}"
echo -e "${GREEN}═══════════════════════════════════════════${RESET}"
echo
echo "Neste steg: følg PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md §1-§6."
echo
echo "Snarvei for å hente data du trenger underveis:"
# 2026-05-10 fix: .data.groups[] istedenfor .data[]; foretrekk demo-pilot-goh
# hvis den finnes, ellers første GoH.
PILOT_GOH_ID=$(jq -r '.data.groups[] | select(.id=="demo-pilot-goh") | .id' "$CURL_TMP/groups.json" 2>/dev/null)
if [[ -z "$PILOT_GOH_ID" || "$PILOT_GOH_ID" == "null" ]]; then
  PILOT_GOH_ID=$(jq -r '.data.groups[0].id // "(ingen)"' "$CURL_TMP/groups.json")
fi
echo "  GoH-id:       $PILOT_GOH_ID"
echo "  Master hall:  demo-hall-001"
echo "  Andre haller: demo-hall-002, demo-hall-003, demo-hall-004"
