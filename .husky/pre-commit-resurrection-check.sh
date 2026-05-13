#!/usr/bin/env bash
# pre-commit-resurrection-check.sh — Bug-resurrection detector (2026-05-13)
#
# Scanner staged endringer mot HEAD. Hvis du modifiserer linjer som SIST
# ble endret av en `fix(...)`-commit innenfor de siste 30 dagene, og
# commit-meldingen ikke har `[resurrection-acknowledged: <grunn>]`, blir
# commit'en blokkert.
#
# Bakgrunn (FRAGILITY_LOG, PITFALLS_LOG): Spillorama-pilot mai 2026 hadde
# et "2 skritt frem 1 tilbake"-problem. Agenter introduserte gamle bugs
# på nytt ved å redigere kode som nettopp var fikset. Denne hook'en tvinger
# eksplisitt bekreftelse.
#
# Bypass-mekanismer:
#   1. RESURRECTION_BYPASS=1 git commit ...      # env-var
#   2. [resurrection-acknowledged: <grunn>]      # acknowledgment i commit-msg
#   3. git commit --no-verify ...                # siste utvei
#
# Se docs/engineering/BUG_RESURRECTION_DETECTOR.md for full dokumentasjon.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$REPO_ROOT/scripts/scan-blame-for-recent-fixes.mjs"
GIT_DIR="$(git rev-parse --git-dir)"
COMMIT_MSG_FILE="${1:-$GIT_DIR/COMMIT_EDITMSG}"

# Skip hvis scriptet ikke finnes (eldre branches, fresh-clone uten merge)
if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

# Bypass via env-var (emergency)
if [ "${RESURRECTION_BYPASS:-0}" = "1" ]; then
  echo "⚠️  RESURRECTION_BYPASS=1 satt — sjekken hoppes over. Begrunn i commit-message."
  exit 0
fi

# Run detector in quiet mode against staged changes.
# Pass commit-msg-file explicitly so detector kan sjekke for acknowledgment.
node "$SCRIPT" --staged --quiet --commit-msg-file "$COMMIT_MSG_FILE"
EXIT=$?

case $EXIT in
  0)
    exit 0
    ;;
  1)
    # Resurrection-candidates funnet uten acknowledgment.
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  ⛔ BUG-RESURRECTION DETECTOR — commit blokkert                  ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    # Re-kjør detektoren UTEN --quiet for å vise full rapport
    node "$SCRIPT" --staged --commit-msg-file "$COMMIT_MSG_FILE" || true
    echo ""
    echo "Hva gjør jeg nå?"
    echo ""
    echo "  1. Sjekk om endringen din REELT er en re-introduksjon av en"
    echo "     allerede-fixet bug. Hvis ja: rull tilbake endringen din og"
    echo "     les fix-commit'en med 'git show <sha>' først."
    echo ""
    echo "  2. Hvis du fikser EN ANNEN bug i samme region, legg til"
    echo "     i commit-meldingen:"
    echo ""
    echo "       [resurrection-acknowledged: <begrunnelse>]"
    echo ""
    echo "     Eksempel:"
    echo ""
    echo "       fix(spill1): handle WebSocket disconnect during draw"
    echo ""
    echo "       [resurrection-acknowledged: PR #1267 fikset socket-disconnect"
    echo "        etter game-end; jeg fikser disconnect DURING draw — sibling-bug]"
    echo ""
    echo "  3. Emergency-bypass (sjelden, dokumenter):"
    echo "       RESURRECTION_BYPASS=1 git commit ..."
    echo ""
    echo "Detaljer: docs/engineering/BUG_RESURRECTION_DETECTOR.md"
    echo ""
    exit 1
    ;;
  *)
    # Script-feil — fail-open, men logg
    echo "⚠️  pre-commit-resurrection-check.sh: detector returnerte exit $EXIT"
    echo "    (script-feil, IKKE bug-resurrection). Tillater commit."
    exit 0
    ;;
esac
