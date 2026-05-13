#!/usr/bin/env bash
# pre-commit-fragility-check.sh — vanntett enforcement av FRAGILITY_LOG-lese
#
# Tobias-direktiv 2026-05-13: "Det må bli vanntett nå."
#
# Sjekker hver staged fil mot FRAGILITY_LOG.md. Hvis filen er nevnt i en
# F-NN-entry, MÅ commit-message inneholde `[context-read: F-NN]`-marker.
# Manglende = commit blokkert.
#
# Aktiveres ved at .husky/pre-commit kaller dette scriptet.
# Bypasses med `git commit --no-verify` (men da må commit-message inkludere
# `[bypass-fragility-check: <begrunnelse>]`).
#
# Bash 3.2-kompatibel (PITFALLS §5.8): denne fila er en thin wrapper som
# delegerer logikken til `scripts/check-fragility-comprehension.mjs`. Den
# opprinnelige bash-implementasjonen brukte `declare -A` (bash 4) som ikke
# fungerer på macOS' default bash 3.2. Wrappersjikt-mønsteret matcher
# `.husky/pre-commit-comprehension.sh`.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
FRAGILITY_LOG="$REPO_ROOT/docs/engineering/FRAGILITY_LOG.md"
COMMIT_MSG_FILE="${1:-$REPO_ROOT/.git/COMMIT_EDITMSG}"
VERIFIER_SCRIPT="$REPO_ROOT/scripts/check-fragility-comprehension.mjs"

# Skip hvis FRAGILITY_LOG ikke finnes (eldre branches, klean state)
if [ ! -f "$FRAGILITY_LOG" ]; then
  exit 0
fi

# Fail-soft hvis Node ikke er installert (matcher mønster fra comprehension-hook)
if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  Node ikke funnet — fragility-sjekken hoppes over."
  exit 0
fi

# Fail-soft hvis verifier-scriptet ikke finnes (forward-compat)
if [ ! -f "$VERIFIER_SCRIPT" ]; then
  exit 0
fi

# Bypass-environment-variabel for emergency (Node-scriptet håndterer det også,
# men vi sjekker her for en raskere exit-vei uten å starte Node)
if [ "${FRAGILITY_BYPASS:-0}" = "1" ]; then
  echo "⚠️  FRAGILITY_BYPASS=1 satt — sjekken hoppes over. Begrunn i commit-message."
  exit 0
fi

# Delegér til Node-scriptet
exec node "$VERIFIER_SCRIPT" --commit-msg "$COMMIT_MSG_FILE"
