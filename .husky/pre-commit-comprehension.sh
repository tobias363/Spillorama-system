#!/usr/bin/env bash
# pre-commit-comprehension.sh — vanntett enforcement av COMPREHENSION-blokk
#
# Tobias-direktiv 2026-05-13: "[context-read: F-NN]-tagger er kun en
# lese-bekreftelse, ikke en comprehension-bekreftelse. Vi trenger heuristisk
# validering som tvinger paraphrase."
#
# Tier-3 i autonomi-pyramiden:
#   - Tier 1: FRAGILITY_LOG (manuell katalog over fragile filer)
#   - Tier 2: pre-commit-fragility-check.sh (krever [context-read: F-NN])
#   - Tier 3: pre-commit-comprehension.sh (krever ## Comprehension-blokk
#             som paraphraserer entry-en)
#
# Aktiveres via `.husky/pre-commit` etter pre-commit-fragility-check.sh.
#
# Wrapper rundt scripts/verify-context-comprehension.mjs som gjør:
#   1. Sjekker at Node er tilgjengelig
#   2. Henter commit-message fra .git/COMMIT_EDITMSG (eller arg)
#   3. Delegerer validering til Node-scriptet
#
# Bypass:
#   - Commit-message inkluderer [comprehension-bypass: <begrunnelse min 20 tegn>]
#   - COMPREHENSION_BYPASS=1 git commit ...
#   - --no-verify (skipper hele pre-commit, ikke bare denne hooken)
#
# Performance:
#   - < 50ms hvis commit-message ikke har [context-read:] eller [comprehension-bypass:]
#   - < 1s ellers (heuristisk validering uten API-kall)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
COMMIT_MSG_FILE="${1:-$REPO_ROOT/.git/COMMIT_EDITMSG}"
VERIFIER_SCRIPT="$REPO_ROOT/scripts/verify-context-comprehension.mjs"

# Fail-soft hvis Node ikke er installert (matcher mønster fra fragility-check)
if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  Node ikke funnet — comprehension-sjekken hoppes over."
  exit 0
fi

# Fail-soft hvis script-en ikke finnes (forward-compat for branches uten det)
if [ ! -f "$VERIFIER_SCRIPT" ]; then
  exit 0
fi

# Env-bypass
if [ "${COMPREHENSION_BYPASS:-0}" = "1" ]; then
  echo "⚠️  COMPREHENSION_BYPASS=1 satt — sjekken hoppes over. Begrunn i commit-message."
  exit 0
fi

# Fail-soft hvis commit-message-fil ikke finnes (uvanlig, men beskytter mot rare git-states)
if [ ! -f "$COMMIT_MSG_FILE" ]; then
  exit 0
fi

# Delegér til Node-scriptet
node "$VERIFIER_SCRIPT" --commit-msg "$COMMIT_MSG_FILE"
