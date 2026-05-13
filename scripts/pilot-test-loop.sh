#!/usr/bin/env bash
#
# Pilot-flow test-loop — Tobias-direktiv 2026-05-13.
#
# Kjør hele Spill 1 pilot-flyt-testen ende-til-ende mot kjørende dev-stack.
# På failure: dump siste BUY-DEBUG-output + Playwright-error så du kan se
# eksakt hva som gikk galt UTEN å åpne trace.zip eller video.webm.
#
# Bruk:
#   bash scripts/pilot-test-loop.sh         # kjør én gang
#   bash scripts/pilot-test-loop.sh --loop  # kjør i loop til SIGINT (Ctrl+C)
#
# Forutsetning:
#   dev:all må kjøre på port 4000 med ENABLE_BUY_DEBUG=1 satt.
#
#   cd /Users/tobiashaugen/Projects/Spillorama-system
#   ENABLE_BUY_DEBUG=1 npm run dev:nuke
#
# Hva scriptet logger på fail:
#   - Siste 5 [BUY-DEBUG]-meldinger (klient-side)
#   - Siste 5 [buy-api]-responser (server-status)
#   - Playwright failure-melding
#   - Snippet fra error-context.md
#   - Sti til screenshot, video, trace

set -euo pipefail

cd "$(dirname "$0")/.."

# Farger
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
CYAN="\033[36m"
RESET="\033[0m"

LOOP_MODE="false"
if [[ "${1:-}" == "--loop" ]]; then
  LOOP_MODE="true"
fi

info()    { echo -e "${BLUE}[ ..  ]${RESET} $1"; }
ok()      { echo -e "${GREEN}[ ok  ]${RESET} $1"; }
fail()    { echo -e "${RED}[fail!]${RESET} $1"; }
warn()    { echo -e "${YELLOW}[warn]${RESET} $1"; }
header()  { echo -e "${CYAN}═════${RESET} ${CYAN}$1${RESET} ${CYAN}═════${RESET}"; }

# Sjekk at backend kjører
if ! curl -fsS "http://localhost:4000/health" >/dev/null 2>&1; then
  fail "Backend ikke tilgjengelig på http://localhost:4000/health"
  fail "Kjør først: ENABLE_BUY_DEBUG=1 npm run dev:nuke"
  exit 1
fi
ok "Backend er live på port 4000"

# Avhengig av om vi er i worktree eller hovedrepo, finn playwright-binary
if [[ -x "/Users/tobiashaugen/Projects/Spillorama-system/node_modules/.bin/playwright" ]]; then
  PLAYWRIGHT_BIN="/Users/tobiashaugen/Projects/Spillorama-system/node_modules/.bin/playwright"
elif [[ -x "node_modules/.bin/playwright" ]]; then
  PLAYWRIGHT_BIN="node_modules/.bin/playwright"
else
  fail "playwright-binary ikke funnet. Kjør 'npm install' først."
  exit 1
fi
info "Playwright: $PLAYWRIGHT_BIN"

OUTPUT_DIR="tests/e2e/__output__"

run_once() {
  local iter="$1"
  header "Pilot-flow test — kjøring $iter"
  echo
  local log_file=$(mktemp)
  local exit_code=0

  "$PLAYWRIGHT_BIN" test --config=tests/e2e/playwright.config.ts > "$log_file" 2>&1 || exit_code=$?

  # Print kort output uansett resultat (siste 5 linjer typisk inneholder
  # "1 passed" eller "1 failed")
  echo "--- Playwright output (siste 8 linjer) ---"
  tail -8 "$log_file"
  echo

  if [[ "$exit_code" -eq 0 ]]; then
    ok "Test PASSED på kjøring $iter"
    rm -f "$log_file"
    return 0
  fi

  # Failure-diagnose
  fail "Test FAILED på kjøring $iter (exit $exit_code)"
  echo

  echo "${YELLOW}--- Siste 5 [BUY-DEBUG]-meldinger fra klient ---${RESET}"
  grep -E "BUY-DEBUG" "$log_file" | tail -5 || warn "(ingen BUY-DEBUG)"
  echo

  echo "${YELLOW}--- Siste 5 [buy-api]-responser ---${RESET}"
  grep -E "buy-api" "$log_file" | tail -5 || warn "(ingen buy-api responses)"
  echo

  echo "${YELLOW}--- Playwright failure-context ---${RESET}"
  grep -E "Error:|expected|received|toBeVisible|toHaveCount|toHaveText" "$log_file" | head -8 || warn "(ingen explicit error-tekst)"
  echo

  # Pek på artifacts
  if [[ -d "$OUTPUT_DIR" ]]; then
    echo "${YELLOW}--- Artifacts (åpne for visuell debug) ---${RESET}"
    # Finn nyeste test-dir
    local test_dir
    test_dir=$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | xargs -0 ls -dt 2>/dev/null | head -1 || true)
    if [[ -n "$test_dir" ]]; then
      echo "  Screenshot: $test_dir/test-failed-1.png"
      echo "  Video:      $test_dir/video.webm"
      echo "  Trace:      $test_dir/trace.zip"
      echo "  Vis trace: $PLAYWRIGHT_BIN show-trace $test_dir/trace.zip"
      if [[ -f "$test_dir/error-context.md" ]]; then
        echo
        echo "${YELLOW}--- error-context.md (kort) ---${RESET}"
        head -25 "$test_dir/error-context.md"
      fi
    fi
  fi
  echo

  # Fix-suggestion basert på hvilken assertion failet
  if grep -q "INVALID_TICKET_SPEC" "$log_file"; then
    echo "${CYAN}--- Forslag til fix ---${RESET}"
    echo "  Server avviste ticketSpec. Sjekk priceMultiplier-beregning i"
    echo "  packages/game-client/src/games/game1/logic/SocketActions.ts"
    echo "  (linje ~95). For Stor-bonger skal vi bruke priceMultiplier"
    echo "  direkte (3/6/9), ikke double small-multiplier (×2)."
  elif grep -q "LOSS_LIMIT_EXCEEDED" "$log_file"; then
    echo "${CYAN}--- Forslag til fix ---${RESET}"
    echo "  Test-spilleren har spist opp dagens tapsgrense (900 kr). Test"
    echo "  bruker pickAvailablePlayer() for rotasjon — sjekk om alle 12"
    echo "  demo-spillere har handlet > 700 kr. Kjør:"
    echo "    npm run dev:nuke  # reset alle wallets via seed"
  elif grep -q "PLAYER_ALREADY_IN_ROOM" "$log_file"; then
    echo "${CYAN}--- Forslag til fix ---${RESET}"
    echo "  Spilleren ligger fortsatt i GoH-rommet fra forrige kjøring."
    echo "  resetPilotState() i tests/e2e/helpers/rest.ts skal destroy-e"
    echo "  rommet — sjekk at admin-credentials fungerer."
  elif grep -q "Brett med per-brett-pris" "$log_file"; then
    echo "${CYAN}--- Forslag til fix ---${RESET}"
    echo "  TicketGridHtml.computePrice returnerer feil pris per brett."
    echo "  Sjekk packages/game-client/src/games/game1/components/TicketGridHtml.ts"
    echo "  computePrice() (linje ~373). Skal bruke lobby-ticket-types,"
    echo "  ikke state.ticketTypes."
  fi

  rm -f "$log_file"
  return "$exit_code"
}

if [[ "$LOOP_MODE" == "true" ]]; then
  warn "Loop-modus: kjører til SIGINT (Ctrl+C)"
  iter=1
  while true; do
    if run_once "$iter"; then
      echo
      info "Vent 5 sek før neste kjøring..."
      sleep 5
    else
      fail "Stopper loop pga failure. Fix bug og kjør på nytt."
      exit 1
    fi
    iter=$((iter + 1))
  done
else
  run_once "1"
fi
