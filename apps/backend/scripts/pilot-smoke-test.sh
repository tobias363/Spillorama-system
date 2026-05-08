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
CATALOG=$(curl -sf "${AUTH[@]}" "$API/api/admin/game-catalog" 2>&1) \
  || fail "Game-catalog endpoint feilet."

CATALOG_COUNT=$(echo "$CATALOG" | jq -r '.data.entries | length // 0')
[[ "$CATALOG_COUNT" -ge 1 ]] || fail "Game-catalog er tom (forventet ≥ 1 entry, fikk $CATALOG_COUNT)."
pass "Game-katalog inneholder $CATALOG_COUNT entries"

# Sjekk at bingo-slug finnes
BINGO_PRESENT=$(echo "$CATALOG" | jq -r '[.data.entries[] | select(.slug=="bingo")] | length')
[[ "$BINGO_PRESENT" -ge 1 ]] || fail "Bingo-slug mangler i game-katalog."
pass "Bingo (Spill 1) finnes i katalog"

# ── §0.4 Hall-grupper ──────────────────────────────────────────────────────
info "GET /api/admin/hall-groups"
GROUPS=$(curl -sf "${AUTH[@]}" "$API/api/admin/hall-groups" 2>&1) \
  || fail "Hall-groups endpoint feilet."

GROUP_COUNT=$(echo "$GROUPS" | jq -r '.data | length // 0')
[[ "$GROUP_COUNT" -ge 1 ]] || fail "Ingen hall-grupper funnet — kjør seed-demo-pilot-day først."
pass "Antall hall-grupper: $GROUP_COUNT"

# Print groups + member counts
echo "$GROUPS" | jq -r '.data[] | "  - \(.name) (id=\(.id))"'

# ── §0.5 Haller ────────────────────────────────────────────────────────────
info "GET /api/admin/halls"
HALLS=$(curl -sf "${AUTH[@]}" "$API/api/admin/halls" 2>&1) \
  || fail "Halls endpoint feilet."

HALL_COUNT=$(echo "$HALLS" | jq -r '.data | length // 0')
[[ "$HALL_COUNT" -ge 4 ]] || fail "Forventet ≥ 4 haller, fikk $HALL_COUNT. Seed mangler?"
pass "Antall haller: $HALL_COUNT"

# Print pilot-halls (demo-hall-001..004)
echo "$HALLS" | jq -r '.data[] | select(.id | startswith("demo-hall-")) | "  - \(.name) (id=\(.id), nr=\(.hallNumber // "?"))"'

PILOT_HALL_COUNT=$(echo "$HALLS" | jq -r '[.data[] | select(.id | startswith("demo-hall-"))] | length')
[[ "$PILOT_HALL_COUNT" -ge 4 ]] || fail "Forventet 4 demo-hall-* pilot-haller, fikk $PILOT_HALL_COUNT."
pass "4 pilot-haller (demo-hall-001..004) eksisterer"

# ── §0.6 Auth/me ────────────────────────────────────────────────────────────
info "GET /api/auth/me — verifiser at token virker"
ME=$(curl -sf "${AUTH[@]}" "$API/api/auth/me" 2>&1) || fail "auth/me feilet."
ROLE=$(echo "$ME" | jq -r '.data.role // empty')
[[ "$ROLE" == "ADMIN" || "$ROLE" == "admin" ]] || fail "Forventet ADMIN-rolle, fikk: $ROLE"
pass "Token gjelder ADMIN-bruker"

# ── §0.7 Eksisterende game-plans (advisory) ────────────────────────────────
info "GET /api/admin/game-plans — eksisterende planer"
PLANS=$(curl -sf "${AUTH[@]}" "$API/api/admin/game-plans?isActive=true" 2>&1) || true
PLAN_COUNT=$(echo "$PLANS" | jq -r '.data | length // 0' 2>/dev/null || echo 0)
echo "  Aktive game-plans: $PLAN_COUNT"

# ── §0.8 Spillere demo-spiller-1..12 ───────────────────────────────────────
info "Sjekk demo-spillere (advisory — kan finnes via spillere-endpoint)"
# Bruk admin-list-endpoint hvis tilgjengelig
PLAYER_CHECK=$(curl -sf "${AUTH[@]}" "$API/api/admin/players?limit=20" 2>&1) || true
DEMO_COUNT=$(echo "$PLAYER_CHECK" | jq -r '[.data.players[]? // empty | select(.email | startswith("demo-spiller-"))] | length' 2>/dev/null || echo 0)
if [[ "$DEMO_COUNT" -ge 4 ]]; then
  pass "Minst 4 demo-spillere eksisterer (fant $DEMO_COUNT)"
else
  echo -e "${YELLOW}[WARN]${RESET} Fant kun $DEMO_COUNT demo-spillere — sjekk seed-script"
fi

echo
echo -e "${GREEN}═══════════════════════════════════════════${RESET}"
echo -e "${GREEN}Smoke-test komplett — backend er klar.${RESET}"
echo -e "${GREEN}═══════════════════════════════════════════${RESET}"
echo
echo "Neste steg: følg PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md §1-§6."
echo
echo "Snarvei for å hente data du trenger underveis:"
echo "  GoH-id:       $(echo "$GROUPS" | jq -r '.data[0].id')"
echo "  Master hall:  demo-hall-001"
echo "  Andre haller: demo-hall-002, demo-hall-003, demo-hall-004"
