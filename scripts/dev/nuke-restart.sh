#!/usr/bin/env bash
#
# Nuclear restart for dev-stack — dreper ALT og starter rent.
#
# Bruk:
#   npm run dev:nuke              # via package.json
#   bash scripts/dev/nuke-restart.sh   # direkte
#
# Hva dette scriptet gjør (i rekkefølge):
#   1. Dreper alle node-prosesser relatert til Spillorama
#   2. Dreper alle prosesser på relevante porter
#      (4000, 4001, 4002, 4173, 5173, 5174, 5175)
#   3. Stopper alle Docker-containere relatert til Spillorama
#      (inkl. chaos-test-stacks fra worktrees + foreldreløse containers)
#   4. Pull fersk main
#   5. Kjører `npm run dev:all -- --reset-state` (fersh data)
#
# Hvorfor:
# --------
# Etter chaos-test-kjøring eller flere parallelle dev-sesjoner ender
# vi med stale node-prosesser, port-konflikter (EADDRINUSE) og
# foreldreløse Docker-containere fra worktree-isolasjon. Tobias-direktiv
# 2026-05-10: én kommando som rydder ALT slik vi ikke ender med å kopiere
# flere kommandoer hver gang.

set -e

cd "$(dirname "$0")/../.."

# Farger
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
RESET="\033[0m"

info() { echo -e "${BLUE}[ ..  ]${RESET} $1"; }
done_step() { echo -e "${GREEN}[done]${RESET} $1"; }
warn() { echo -e "${YELLOW}[warn]${RESET} $1"; }

echo
info "🔪 Nuclear restart — dreper alt + starter rent"
echo

# ── §1 Dreper alle Spillorama-relaterte node-prosesser ────────────────────

info "Dreper stale node-prosesser..."
ps aux \
  | grep -E "tsx watch|spillorama|dev:all|start-all\.mjs|@spillorama|node_modules/vite/bin" \
  | grep -v grep \
  | awk '{print $2}' \
  | xargs -r kill -9 2>/dev/null || true
done_step "node-prosesser drept"

# ── §2 Dreper prosesser på relevante porter ──────────────────────────────

info "Dreper prosesser på dev-porter (4000-4002, 4173, 5173-5175)..."
for PORT in 4000 4001 4002 4173 5173 5174 5175; do
  PIDS=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -n "$PIDS" ]]; then
    echo "    └─ port $PORT: kill $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
done
done_step "porter ryddet"

# ── §3 Stopper Spillorama Docker-containere ──────────────────────────────

info "Stopper Spillorama Docker-containere..."
CONTAINERS=$(docker ps --format '{{.Names}}' 2>/dev/null \
  | grep -E "spillorama|chaos|gallant-|agent-[a-f0-9]+" \
  || true)
if [[ -n "$CONTAINERS" ]]; then
  echo "$CONTAINERS" | while read -r name; do
    echo "    └─ stop $name"
    docker stop "$name" >/dev/null 2>&1 || true
  done
  done_step "Docker-containere stoppet"
else
  done_step "ingen relevante containere kjørte"
fi

# Vent til OS frigjør portene
sleep 1

# ── §4 Pull fersk main (uten å bytte branch hvis allerede på main) ───────

info "Synker hovedrepo med origin/main..."
git fetch origin main --quiet
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "(detached)")
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  warn "Hovedrepo er på branch '$CURRENT_BRANCH' (ikke main)"
  warn "Hopper over auto-pull. Bytt manuelt om ønskelig: git checkout main && git pull"
else
  git pull --rebase origin main 2>&1 | tail -3
  done_step "main pulled"
fi

# ── §5 Start dev-stack med fersh data ────────────────────────────────────

info "Starter dev-stack (Docker + Postgres + Redis + migrate + seed + backend + admin-web + game-client)..."
echo
echo -e "${YELLOW}─────────────────────────────────────────────────────────${RESET}"
echo -e "${YELLOW}  Ctrl+C dreper alt pent. Vent på status-tabellen.${RESET}"
echo -e "${YELLOW}─────────────────────────────────────────────────────────${RESET}"
echo

exec npm run dev:all -- --reset-state
