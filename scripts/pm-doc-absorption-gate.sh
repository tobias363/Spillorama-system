#!/usr/bin/env bash
# pm-doc-absorption-gate.sh — hard gate for PM knowledge parity beyond handoffs.
#
# Verifies that a new PM has absorbed the canonical knowledge sources that are
# too broad for pm-checkpoint.sh alone: ADRs, PITFALLS sections, top domain
# skills, PM_SESSION_KNOWLEDGE_EXPORT files, and the newest agent execution log.
#
# Usage:
#   bash scripts/pm-doc-absorption-gate.sh
#   bash scripts/pm-doc-absorption-gate.sh --list
#   bash scripts/pm-doc-absorption-gate.sh --status
#   bash scripts/pm-doc-absorption-gate.sh --validate

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

CONFIRM_FILE="$REPO_ROOT/.pm-doc-absorption-confirmed.txt"
VALIDITY_DAYS="${PM_DOC_ABSORPTION_VALIDITY_DAYS:-7}"

TOP_SKILLS=(
  "spill1-master-flow"
  "wallet-outbox-pattern"
  "audit-hash-chain"
  "pm-orchestration-pattern"
  "live-room-robusthet-mandate"
  "pengespillforskriften-compliance"
  "spill2-perpetual-loop"
  "spill3-phase-state-machine"
)

if [[ -t 1 ]]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; BOLD=""; RESET=""
fi

print_header() {
  echo ""
  echo "${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════════╗${RESET}"
  echo "${BOLD}${BLUE}║  PM doc-absorpsjon — kunnskapsparitet-gate                      ║${RESET}"
  echo "${BOLD}${BLUE}║  Spillorama-system                                                ║${RESET}"
  echo "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

first_heading() {
  local file="$1"
  grep -m 1 -E '^# ' "$file" 2>/dev/null | sed 's/^# //' || basename "$file"
}

list_items() {
  local f

  find "$REPO_ROOT/docs/adr" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.md' -type f 2>/dev/null \
    | sort \
    | while IFS= read -r f; do
        printf 'ADR\t%s\t%s\n' "${f#"$REPO_ROOT/"}" "$(first_heading "$f")"
      done

  find "$REPO_ROOT/docs/operations" -maxdepth 1 -name 'PM_SESSION_KNOWLEDGE_EXPORT_*.md' -type f 2>/dev/null \
    | sort \
    | while IFS= read -r f; do
        printf 'KNOWLEDGE_EXPORT\t%s\t%s\n' "${f#"$REPO_ROOT/"}" "$(first_heading "$f")"
      done

  for skill in "${TOP_SKILLS[@]}"; do
    f="$REPO_ROOT/.claude/skills/$skill/SKILL.md"
    if [[ -f "$f" ]]; then
      printf 'SKILL\t%s\t%s\n' ".claude/skills/$skill/SKILL.md" "$skill"
    else
      printf 'SKILL_MISSING\t%s\t%s\n' ".claude/skills/$skill/SKILL.md" "$skill"
    fi
  done

  f="$REPO_ROOT/docs/engineering/PITFALLS_LOG.md"
  if [[ -f "$f" ]]; then
    grep -n -E '^## §[0-9]+' "$f" | while IFS=: read -r line title; do
      printf 'PITFALLS_SECTION\t%s:%s\t%s\n' "docs/engineering/PITFALLS_LOG.md" "$line" "$title"
    done
  fi

  f="$REPO_ROOT/docs/engineering/AGENT_EXECUTION_LOG.md"
  if [[ -f "$f" ]]; then
    printf 'AGENT_EXECUTION_LOG\t%s\t%s\n' "docs/engineering/AGENT_EXECUTION_LOG.md" "Top 30 newest entries"
  fi
}

item_count() {
  list_items | wc -l | tr -d ' '
}

confirmed_item_count() {
  if [[ ! -f "$CONFIRM_FILE" ]]; then
    echo 0
    return
  fi
  grep -m 1 '^\*\*Item-count:\*\*' "$CONFIRM_FILE" 2>/dev/null | sed -E 's/.*\*\*Item-count:\*\*[[:space:]]*([0-9]+).*/\1/' || echo 0
}

file_age_days() {
  local file="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    local file_epoch
    file_epoch=$(stat -f %m "$file" 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    echo $(( (now_epoch - file_epoch) / 86400 ))
  else
    local file_epoch
    file_epoch=$(stat -c %Y "$file" 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    echo $(( (now_epoch - file_epoch) / 86400 ))
  fi
}

validate_takeaway_text() {
  local text="$1"
  local compact
  compact="$(printf '%s' "$text" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
  local lowered
  lowered="$(printf '%s' "$compact" | tr '[:upper:]' '[:lower:]')"
  local chars
  chars=$(printf '%s' "$compact" | wc -c | tr -d ' ')

  if (( chars < 25 )); then
    return 1
  fi
  case "$lowered" in
    lest|ok|okay|ja|yes|done|read|bekreftet|"har lest"|"lest ok"|"ok lest")
      return 1
      ;;
  esac
  return 0
}

cmd_list() {
  print_header
  echo "${BOLD}Dokumenter/seksjoner som MÅ absorberes:${RESET}"
  echo ""
  local idx=0
  while IFS=$'\t' read -r kind path title; do
    idx=$((idx + 1))
    printf "  %2d. [%s] %s — %s\n" "$idx" "$kind" "$path" "$title"
  done < <(list_items)
  echo ""
  echo "${BOLD}Totalt: $idx items${RESET}"
}

validate_confirmation() {
  if [[ ! -f "$CONFIRM_FILE" ]]; then
    return 1
  fi
  local age_days
  age_days="$(file_age_days "$CONFIRM_FILE")"
  if (( age_days > VALIDITY_DAYS )); then
    return 1
  fi
  local expected_count
  local actual_count
  expected_count="$(item_count)"
  actual_count="$(confirmed_item_count)"
  [[ "$expected_count" == "$actual_count" ]]
}

cmd_status() {
  print_header
  if validate_confirmation; then
    local age_days
    age_days="$(file_age_days "$CONFIRM_FILE")"
    echo "${GREEN}✅ Doc-absorpsjon-bekreftelse er gyldig.${RESET}"
    echo "  Fil: $CONFIRM_FILE"
    echo "  Alder: ${age_days} dag(er)"
    echo "  Items: $(confirmed_item_count)"
    return 0
  fi
  echo "${RED}❌ Doc-absorpsjon-bekreftelse mangler, er utløpt, eller matcher ikke dagens dokumentsett.${RESET}"
  echo "  Forventet items nå: $(item_count)"
  echo "  Bekreftet items: $(confirmed_item_count)"
  echo ""
  echo "Kjør ${BOLD}bash scripts/pm-doc-absorption-gate.sh${RESET} interaktivt."
  return 1
}

cmd_run() {
  print_header

  if [[ ! -t 0 ]]; then
    echo "${RED}❌ Interaktiv TTY kreves for å samle takeaways.${RESET}"
    echo "Bruk --validate i CI/non-interactive contexts."
    exit 1
  fi

  local pm_id="${PM_DOC_ABSORPTION_PM_ID:-}"
  if [[ -z "$pm_id" ]]; then
    printf "${BOLD}Hvem er du?${RESET} (PM-id): "
    read -r pm_id
  fi
  if [[ -z "$pm_id" ]]; then
    pm_id="ukjent"
  fi

  local main_sha
  main_sha="$(git -C "$REPO_ROOT" rev-parse origin/main 2>/dev/null || git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
  local now_iso
  now_iso="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  local total
  total="$(item_count)"
  local tmp_file
  tmp_file="$(mktemp -t pm-doc-absorption-XXXXXX)"
  trap 'rm -f "$tmp_file"' EXIT

  {
    echo "# PM doc-absorpsjon-bekreftelse"
    echo ""
    echo "**Generert:** $now_iso"
    echo "**PM-identifier:** $pm_id"
    echo "**Main-SHA:** $main_sha"
    echo "**Item-count:** $total"
    echo "**Repo-rot:** $REPO_ROOT"
    echo ""
    echo "## Bekreftelse"
    echo ""
    echo "Jeg bekrefter at jeg har absorbert ADR-er, PITFALLS-seksjoner,"
    echo "topp-skills, PM_SESSION_KNOWLEDGE_EXPORT og AGENT_EXECUTION_LOG"
    echo "før første kodehandling."
    echo ""
    echo "## Takeaways"
    echo ""
  } > "$tmp_file"

  echo "${BOLD}Du må bekrefte $total knowledge-items.${RESET}"
  echo ""

  local idx=0
  while IFS=$'\t' read -r kind path title; do
    idx=$((idx + 1))
    echo "${BOLD}${BLUE}━━ [$idx/$total] [$kind] $path${RESET}"
    echo "${YELLOW}$title${RESET}"
    echo ""
    printf "${BOLD}Har du lest/absorbert dette itemet? (ja/nei):${RESET} "
    local confirmed
    read -r confirmed
    if [[ "$confirmed" != "ja" && "$confirmed" != "y" && "$confirmed" != "Y" && "$confirmed" != "yes" ]]; then
      echo "${RED}❌ Avbrutt. Les itemet og kjør gaten på nytt.${RESET}"
      exit 1
    fi
    echo ""
    echo "${BOLD}Skriv 1-3 konkrete setninger om hva du tar med deg fra dette itemet:${RESET}"
    echo "(avslutt med tom linje + Enter)"
    local takeaway=""
    local line
    while IFS= read -r line; do
      [[ -z "$line" ]] && break
      takeaway+="$line"$'\n'
    done
    if ! validate_takeaway_text "$takeaway"; then
      echo "${RED}❌ Takeaway er for kort eller ser ut som placeholder.${RESET}"
      exit 1
    fi
    {
      echo "### $idx. [$kind] $path"
      echo ""
      echo "**Tittel:** $title"
      echo ""
      echo "**Takeaway:**"
      echo ""
      echo "$takeaway"
      echo ""
    } >> "$tmp_file"
    echo "${GREEN}✓ Bekreftet.${RESET}"
    echo ""
  done < <(list_items)

  cp "$tmp_file" "$CONFIRM_FILE"
  rm -f "$tmp_file"
  trap - EXIT

  echo ""
  echo "${GREEN}${BOLD}✅ Doc-absorpsjon-gate passert!${RESET}"
  echo "Bekreftelse skrevet til: ${BOLD}$CONFIRM_FILE${RESET}"
  echo "Gyldig i ${VALIDITY_DAYS} dager, med mindre dokumentsettet endres."
}

mode="${1:-run}"
case "$mode" in
  --list|list)
    cmd_list
    ;;
  --status|status)
    cmd_status
    ;;
  --validate|validate)
    validate_confirmation
    ;;
  --help|-h|help)
    cat <<EOF
PM doc-absorpsjon-gate.

Bruk:
  bash scripts/pm-doc-absorption-gate.sh
  bash scripts/pm-doc-absorption-gate.sh --list
  bash scripts/pm-doc-absorption-gate.sh --status
  bash scripts/pm-doc-absorption-gate.sh --validate

Env:
  PM_DOC_ABSORPTION_VALIDITY_DAYS   Default: 7
  PM_DOC_ABSORPTION_PM_ID           Forhåndsutfyll PM-id
EOF
    ;;
  --run|run|"")
    cmd_run
    ;;
  *)
    echo "Ukjent mode: $mode" >&2
    exit 2
    ;;
esac
