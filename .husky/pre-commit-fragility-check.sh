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

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
FRAGILITY_LOG="$REPO_ROOT/docs/engineering/FRAGILITY_LOG.md"
COMMIT_MSG_FILE="${1:-$REPO_ROOT/.git/COMMIT_EDITMSG}"

# Skip hvis FRAGILITY_LOG ikke finnes (eldre branches, klean state)
if [ ! -f "$FRAGILITY_LOG" ]; then
  exit 0
fi

# Bypass-environment-variabel for emergency
if [ "${FRAGILITY_BYPASS:-0}" = "1" ]; then
  echo "⚠️  FRAGILITY_BYPASS=1 satt — sjekken hoppes over. Begrunn i commit-message."
  exit 0
fi

# Hent staged filer
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Parse FRAGILITY-entries — bygg map { F-NN → [files...] }
declare -A FRAGILITY_MAP=()
declare -a CURRENT_FILES=()
CURRENT_FID=""

while IFS= read -r line; do
  if [[ "$line" =~ ^"## F-"([0-9]+) ]]; then
    # Flush forrige entry
    if [ -n "$CURRENT_FID" ] && [ ${#CURRENT_FILES[@]} -gt 0 ]; then
      FRAGILITY_MAP[$CURRENT_FID]="${CURRENT_FILES[*]}"
    fi
    CURRENT_FID="F-${BASH_REMATCH[1]}"
    CURRENT_FILES=()
  elif [[ "$line" =~ \*\*Filer:\*\*[[:space:]]*(.+) ]]; then
    # Parse file-refs fra "**Filer:** path/to/file.ts:line-range"
    files_line="${BASH_REMATCH[1]}"
    # Extract paths (anything that looks like path/segment/file.ext)
    while [[ "$files_line" =~ \`([a-zA-Z0-9_/.-]+\.(ts|tsx|js|jsx|md|yml|yaml|sh|sql|json)) ]]; do
      CURRENT_FILES+=("${BASH_REMATCH[1]}")
      files_line="${files_line#*${BASH_REMATCH[1]}}"
    done
  fi
done < "$FRAGILITY_LOG"

# Flush siste entry
if [ -n "$CURRENT_FID" ] && [ ${#CURRENT_FILES[@]} -gt 0 ]; then
  FRAGILITY_MAP[$CURRENT_FID]="${CURRENT_FILES[*]}"
fi

# Sjekk hver staged fil mot FRAGILITY_MAP
declare -A REQUIRED_FIDS=()
while IFS= read -r staged; do
  for fid in "${!FRAGILITY_MAP[@]}"; do
    for fragile in ${FRAGILITY_MAP[$fid]}; do
      # Match enten exact eller prefix (for directory-baserte entries)
      if [[ "$staged" == "$fragile"* ]] || [[ "$fragile" == "$staged"* ]]; then
        REQUIRED_FIDS[$fid]=1
        break
      fi
    done
  done
done <<< "$STAGED_FILES"

# Hvis ingen FRAGILITY-entries matcher, exit 0
if [ ${#REQUIRED_FIDS[@]} -eq 0 ]; then
  exit 0
fi

# Hent commit-message
COMMIT_MSG=""
[ -f "$COMMIT_MSG_FILE" ] && COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Sjekk for `[context-read: F-NN]`-markers
MISSING_FIDS=()
for fid in "${!REQUIRED_FIDS[@]}"; do
  if ! echo "$COMMIT_MSG" | grep -qE "\[context-read:[^]]*${fid}"; then
    # Check også for bypass-marker
    if ! echo "$COMMIT_MSG" | grep -qE "\[bypass-fragility-check:[^]]+\]"; then
      MISSING_FIDS+=("$fid")
    fi
  fi
done

if [ ${#MISSING_FIDS[@]} -gt 0 ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  🛑 FRAGILITY-CHECK FEILET                                       ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Filer du staged matcher FRAGILITY_LOG-entries. Du MÅ bekrefte at du"
  echo "har lest dem ved å inkludere markører i commit-message:"
  echo ""
  for fid in "${MISSING_FIDS[@]}"; do
    echo "  [context-read: $fid]"
  done
  echo ""
  echo "Eksempel-commit-message:"
  echo ""
  echo "    fix(scope): kort beskrivelse"
  echo ""
  echo "    [context-read: ${MISSING_FIDS[0]}]"
  echo ""
  echo "    Lengre forklaring..."
  echo ""
  echo "Detaljer om F-NN-entries:"
  echo "  $FRAGILITY_LOG"
  echo ""
  echo "For emergency-bypass (dokumenter i commit-message):"
  echo "  [bypass-fragility-check: <begrunnelse>]"
  echo ""
  echo "ELLER:"
  echo "  FRAGILITY_BYPASS=1 git commit ..."
  echo ""
  exit 1
fi

echo "✅ FRAGILITY-check passert (${#REQUIRED_FIDS[@]} entries verifisert)"
exit 0
