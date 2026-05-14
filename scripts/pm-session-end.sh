#!/usr/bin/env bash
# pm-session-end.sh — interaktiv sesjons-slutt-verifikasjon
#
# Tobias-direktiv 2026-05-14 IMMUTABLE:
# "Hver PM tar over med samme kunnskapsnivå som den som avslutter."
#
# Dette scriptet tvinger avsluttende PM gjennom de 9 obligatoriske
# trinnene i docs/operations/PM_SESSION_END_CHECKLIST.md.
#
# Ved suksess skrives `.pm-session-end-confirmed.txt` til repo-rot som
# bevis på passert sesjons-slutt-prosedyre. Filen inkluderer hash av
# de skrevne handoff- og knowledge-export-filene + main-SHA.
#
# CLI:
#   bash scripts/pm-session-end.sh                  # interaktiv runner
#   bash scripts/pm-session-end.sh --validate       # hard-check at filer eksisterer (exit 1 hvis ikke)
#   bash scripts/pm-session-end.sh --status         # human-readable status

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIRMATION_FILE="${REPO_ROOT}/.pm-session-end-confirmed.txt"
TODAY="$(date +%Y-%m-%d)"
HANDOFF_FILE="${REPO_ROOT}/docs/operations/PM_HANDOFF_${TODAY}.md"
KNOWLEDGE_EXPORT_FILE="${REPO_ROOT}/docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_${TODAY}.md"

# Allow override for "session2" / "_PART2" naming
HANDOFF_GLOB="${REPO_ROOT}/docs/operations/PM_HANDOFF_${TODAY}*.md"
KNOWLEDGE_GLOB="${REPO_ROOT}/docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_${TODAY}*.md"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── CLI parsing ───────────────────────────────────────────────────────
MODE="interactive"
case "${1:-}" in
  --validate) MODE="validate" ;;
  --status)   MODE="status" ;;
  "")         MODE="interactive" ;;
  *)
    echo "Usage: $0 [--validate|--status]"
    exit 2
    ;;
esac

# ── Helpers ───────────────────────────────────────────────────────────

# Sjekk om handoff-fil for i dag finnes (med glob for session2/PART2)
handoff_exists() {
  ls $HANDOFF_GLOB 2>/dev/null | head -1 | grep -q . && return 0 || return 1
}

knowledge_exists() {
  ls $KNOWLEDGE_GLOB 2>/dev/null | head -1 | grep -q . && return 0 || return 1
}

# Hash av en fil — første 12 chars av SHA-256
file_hash() {
  local file="$1"
  if [ -f "$file" ]; then
    shasum -a 256 "$file" | awk '{print substr($1, 1, 12)}'
  else
    echo "missing"
  fi
}

# Sjekk om confirmation-fil er gyldig (≤ 1 dag gammel)
confirmation_valid() {
  if [ ! -f "$CONFIRMATION_FILE" ]; then return 1; fi
  local age_days
  if [[ "$OSTYPE" == "darwin"* ]]; then
    local mtime=$(stat -f %m "$CONFIRMATION_FILE")
    local now=$(date +%s)
    age_days=$(( (now - mtime) / 86400 ))
  else
    age_days=$(( ($(date +%s) - $(stat -c %Y "$CONFIRMATION_FILE")) / 86400 ))
  fi
  [ "$age_days" -le 1 ]
}

prompt_yn() {
  local msg="$1"
  local answer
  while true; do
    printf "${BLUE}%s${NC} [y/n]: " "$msg"
    read -r answer
    case "$answer" in
      y|Y|yes) return 0 ;;
      n|N|no)  return 1 ;;
      *) echo "Svar y eller n." ;;
    esac
  done
}

# ── Mode: --validate ──────────────────────────────────────────────────
if [ "$MODE" = "validate" ]; then
  errors=0

  if ! handoff_exists; then
    echo -e "${RED}✗${NC} Mangler PM_HANDOFF_${TODAY}*.md"
    errors=$((errors+1))
  fi

  if ! knowledge_exists; then
    echo -e "${RED}✗${NC} Mangler PM_SESSION_KNOWLEDGE_EXPORT_${TODAY}*.md"
    errors=$((errors+1))
  fi

  if ! confirmation_valid; then
    echo -e "${RED}✗${NC} .pm-session-end-confirmed.txt mangler eller er > 1 dag gammel"
    errors=$((errors+1))
  fi

  if [ "$errors" -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Session-end-gate passert. Klar for sesjons-slutt."
    exit 0
  else
    echo -e "${YELLOW}→${NC} Kjør interaktiv: bash scripts/pm-session-end.sh"
    exit 1
  fi
fi

# ── Mode: --status ────────────────────────────────────────────────────
if [ "$MODE" = "status" ]; then
  echo ""
  echo "=== Session-end status ==="
  echo "Dato: $TODAY"
  echo ""

  if handoff_exists; then
    f=$(ls $HANDOFF_GLOB | head -1)
    echo -e "${GREEN}✓${NC} PM_HANDOFF: $(basename $f) ($(file_hash $f))"
  else
    echo -e "${RED}✗${NC} PM_HANDOFF mangler — skriv $HANDOFF_FILE"
  fi

  if knowledge_exists; then
    f=$(ls $KNOWLEDGE_GLOB | head -1)
    echo -e "${GREEN}✓${NC} KNOWLEDGE_EXPORT: $(basename $f) ($(file_hash $f))"
  else
    echo -e "${RED}✗${NC} KNOWLEDGE_EXPORT mangler — skriv $KNOWLEDGE_EXPORT_FILE"
  fi

  if confirmation_valid; then
    echo -e "${GREEN}✓${NC} Confirmation-fil valid"
    cat "$CONFIRMATION_FILE" | head -3
  else
    echo -e "${YELLOW}!${NC} Confirmation-fil mangler eller er stale"
  fi
  echo ""
  exit 0
fi

# ── Mode: interactive (default) ───────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  PM Session END — interaktiv verifikasjon"
echo "  Dato: $TODAY"
echo "  Repo: $REPO_ROOT"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Tobias-direktiv 2026-05-14 IMMUTABLE:"
echo "  'Hver PM tar over med samme kunnskapsnivå som den som avslutter.'"
echo ""
echo "Følger 9 trinn fra PM_SESSION_END_CHECKLIST.md."
echo ""

# Trinn 1 — Verifiser PR-er
echo -e "${BLUE}── Trinn 1 — PR-status ──${NC}"
if command -v gh >/dev/null 2>&1; then
  echo "Åpne PR-er fra deg siste 24t:"
  gh pr list --author "@me" --state open --search "created:>=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d '1 day ago' +%Y-%m-%d)" --json number,title --limit 10 2>/dev/null || echo "(kunne ikke hente gh)"
else
  echo "(gh CLI ikke installert — skip)"
fi
prompt_yn "Trinn 1: Alle åpne PR-er er enten merget eller dokumentert i handoff?" || {
  echo -e "${YELLOW}→${NC} Merge eller dokumenter åpne PR-er først."
  exit 1
}
echo ""

# Trinn 2 — PM_HANDOFF eksisterer
echo -e "${BLUE}── Trinn 2 — PM_HANDOFF_${TODAY}.md ──${NC}"
if handoff_exists; then
  f=$(ls $HANDOFF_GLOB | head -1)
  echo -e "${GREEN}✓${NC} Finnes: $(basename $f)"
else
  echo -e "${RED}✗${NC} Mangler: $HANDOFF_FILE"
  echo "Skriv handoff først. Mal: kopier siste PM_HANDOFF og tilpass."
  echo "Min-seksjoner: TL;DR, hva levert, hva gjenstår, Tobias-direktiver, state, neste-PM-instrukser, telemetri."
  exit 1
fi
prompt_yn "Trinn 2: PM_HANDOFF dekker alle 7 seksjoner?" || exit 1
echo ""

# Trinn 3 — KNOWLEDGE_EXPORT eksisterer
echo -e "${BLUE}── Trinn 3 — PM_SESSION_KNOWLEDGE_EXPORT_${TODAY}.md ──${NC}"
if knowledge_exists; then
  f=$(ls $KNOWLEDGE_GLOB | head -1)
  echo -e "${GREEN}✓${NC} Finnes: $(basename $f)"
else
  echo -e "${RED}✗${NC} Mangler: $KNOWLEDGE_EXPORT_FILE"
  echo "Skriv knowledge-export. Mal: docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md"
  echo "Min-seksjoner: mandat, kunnskap-tilegnet, handlinger, anti-mønstre, open-questions, mental-handoff, endringslogg."
  exit 1
fi
prompt_yn "Trinn 3: KNOWLEDGE_EXPORT dekker alle 7 seksjoner inkl. mental hand-off §6?" || exit 1
echo ""

# Trinn 4-7 — Disipliner
echo -e "${BLUE}── Trinn 4-7 — Disipliner ──${NC}"
prompt_yn "Trinn 4: Hvis Tobias ga nye IMMUTABLE direktiver, er PM_ONBOARDING_PLAYBOOK oppdatert?" || {
  echo -e "${YELLOW}!${NC} Update PM_ONBOARDING_PLAYBOOK §2 før commit."
  exit 1
}
prompt_yn "Trinn 5: Hvis nye fallgruver oppdaget, er PITFALLS_LOG oppdatert?" || {
  echo -e "${YELLOW}!${NC} Add entry i passende § først."
  exit 1
}
prompt_yn "Trinn 6: Hvis agenter brukt, er AGENT_EXECUTION_LOG oppdatert?" || {
  echo -e "${YELLOW}!${NC} Add entries øverst i 'Entries (newest first)'."
  exit 1
}
prompt_yn "Trinn 7: Hvis fagkunnskap utvidet, er relevante skills oppdatert med v-bump?" || {
  echo -e "${YELLOW}!${NC} Update skill + bump frontmatter metadata.version."
  exit 1
}
echo ""

# Trinn 8 — Todos
echo -e "${BLUE}── Trinn 8 — Todos rene ──${NC}"
prompt_yn "Alle pending/in_progress todos er flyttet til PM_HANDOFF 'Åpne tasks for neste PM'?" || exit 1
echo ""

# Trinn 9 — Skriv confirmation-fil
echo -e "${BLUE}── Trinn 9 — Skriv confirmation-fil ──${NC}"
main_sha=$(git -C "$REPO_ROOT" rev-parse origin/main 2>/dev/null || echo "unknown")
handoff_file_path=$(ls $HANDOFF_GLOB | head -1)
knowledge_file_path=$(ls $KNOWLEDGE_GLOB | head -1)
handoff_hash=$(file_hash "$handoff_file_path")
knowledge_hash=$(file_hash "$knowledge_file_path")
pm_user=$(git -C "$REPO_ROOT" config user.name 2>/dev/null || echo "unknown")
pm_email=$(git -C "$REPO_ROOT" config user.email 2>/dev/null || echo "unknown")
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$CONFIRMATION_FILE" <<EOF
# PM Session END — confirmation-fil

Generert av scripts/pm-session-end.sh ved sesjons-slutt.
Bevis på at avsluttende PM har fullført alle 9 obligatoriske trinn.

Gyldig 1 dag (forventet at neste PM enten passerer ny gate ved sesjons-
start eller skriver ny confirmation-fil ved egen sesjons-slutt).

---

ISO_TIMESTAMP: $timestamp
PM_USER: $pm_user <$pm_email>
MAIN_SHA: $main_sha
DATE: $TODAY

HANDOFF_FILE: $(basename $handoff_file_path)
HANDOFF_HASH: $handoff_hash

KNOWLEDGE_EXPORT_FILE: $(basename $knowledge_file_path)
KNOWLEDGE_HASH: $knowledge_hash

TRINN_BEKREFTET:
- Trinn 1 — PR-status: bekreftet
- Trinn 2 — PM_HANDOFF eksisterer + dekker 7 seksjoner
- Trinn 3 — PM_SESSION_KNOWLEDGE_EXPORT eksisterer + dekker 7 seksjoner
- Trinn 4 — PM_ONBOARDING_PLAYBOOK status: bekreftet
- Trinn 5 — PITFALLS_LOG status: bekreftet
- Trinn 6 — AGENT_EXECUTION_LOG status: bekreftet
- Trinn 7 — Skills v-bump status: bekreftet
- Trinn 8 — Todos flyttet til handoff
- Trinn 9 — Denne fila skrevet

CHECKSUM: $(echo "$handoff_hash$knowledge_hash$main_sha" | shasum -a 256 | awk '{print substr($1, 1, 16)}')
EOF

echo -e "${GREEN}✓${NC} Confirmation-fil skrevet: $CONFIRMATION_FILE"
cat "$CONFIRMATION_FILE"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "${GREEN}  Session-end passert. Neste PM kan starte trygt.${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Neste skritt: commit $(basename $handoff_file_path) + $(basename $knowledge_file_path) + andre endringer."
echo ""
