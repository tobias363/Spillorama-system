#!/usr/bin/env bash
#
# `npm run dev:sync` — light-touch dev-resync uten å drepe servere.
#
# Bruk når PM nettopp har merget en PR mens du er midt i test-sesjon, og
# du vil hente den nye source-koden uten å miste pågående spill-state
# (Docker/Postgres/Redis/backend/admin-web/game-client beholdes kjørende).
#
# Forskjell fra `dev:nuke`:
#   - dev:nuke: drep alle prosesser → pull → build → restart alt
#   - dev:sync: pull → build → behold prosesser (preview-pages og
#               admin-web HMR plukker opp endringene automatisk)
#
# Tobias-bug 2026-05-15: i en lang test-sesjon dev:nuke'r man én gang
# tidlig og tester. PM merger flere PR-er underveis. Tobias så stale
# preview-pages fordi `public/web/games/*.html` er en GITIGNORED build-
# artifact som kun oppdateres når build kjører. Dette scriptet løser
# det med minimal-friction kommando som ikke avbryter testing.
#
# Bruk:
#   npm run dev:sync          # standard: pull + build alle preview-pages
#   npm run dev:sync -- --no-pull   # bare rebuild (hvis main allerede pulled)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Farger
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[sync]${NC} $1"; }
warn() { echo -e "${YELLOW}[sync]${NC} $1"; }
error() { echo -e "${RED}[sync]${NC} $1" >&2; }

SKIP_PULL=false
for arg in "$@"; do
  case "$arg" in
    --no-pull) SKIP_PULL=true ;;
  esac
done

# ── §1 Pull fersk main ──────────────────────────────────────────────────
if [[ "$SKIP_PULL" == "false" ]]; then
  CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '(detached)')"
  if [[ "$CURRENT_BRANCH" != "main" ]]; then
    warn "Ikke på main (er på '$CURRENT_BRANCH'). Hopper over pull."
    warn "Bytt manuelt om ønskelig: git checkout main && git pull"
  else
    info "Pull fra origin/main…"
    git fetch origin main --quiet
    LOCAL_SHA="$(git rev-parse HEAD)"
    REMOTE_SHA="$(git rev-parse origin/main)"
    if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
      info "Allerede synkron med origin/main ($LOCAL_SHA)"
    else
      git pull --rebase --autostash origin main 2>&1 | tail -3
      info "Pulled $LOCAL_SHA → $(git rev-parse HEAD)"
    fi
  fi
else
  info "--no-pull: hopper over git pull"
fi

# ── §2 Rebuild game-client + alle preview-pages ─────────────────────────
info "Bygger game-client + preview-pages (npm run build:games)…"
BUILD_START=$(date +%s)
npm run build:games 2>&1 | tail -8
BUILD_END=$(date +%s)
info "Bygd på $((BUILD_END - BUILD_START))s"

# ── §3 Verifiser preview-pages er friske ────────────────────────────────
info "Verifiserer preview-pages er bygd…"
for page in bong-design premie-design kjopsmodal-design dev-overview preview visual-harness; do
  FILE="apps/backend/public/web/games/${page}.html"
  if [[ -f "$FILE" ]]; then
    SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null)
    info "  ✓ ${page}.html (${SIZE} bytes)"
  else
    warn "  ✗ ${page}.html MANGLER"
  fi
done

# ── §4 Sjekk om backend kjører — hvis ja, refresh er nok ────────────────
if curl -s --max-time 2 http://localhost:4000/health >/dev/null 2>&1; then
  info ""
  info "Backend kjører fortsatt — bare refresh nettleseren."
  info "Preview-pages: http://localhost:4000/web/games/bong-design.html"
else
  warn ""
  warn "Backend ikke responsivt på :4000 — kjør 'npm run dev:nuke' for full restart."
fi

info "✅ Sync ferdig"
