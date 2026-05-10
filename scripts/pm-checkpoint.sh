#!/usr/bin/env bash
# PM-checkpoint — vanntett gate FØR ny PM kan begynne kode-handling.
#
# Krever per-file bekreftelse av ALLE PM_HANDOFF-filer siden prosjekt-start
# (2026-04-23). Skriver `.pm-onboarding-confirmed.txt` til repo-roten med
# timestamp, main-SHA, PM-identifier, og fri-tekst-key-takeaways per fil.
#
# Filen er bevis på at PM faktisk har lest gjennom hele rekken — ikke bare
# nyeste handoff. Den brukes som gate i CLAUDE.md og PM_ONBOARDING_PLAYBOOK
# slik at AI-PM kan validere at onboarding er passert.
#
# Usage:
#   bash scripts/pm-checkpoint.sh
#   bash scripts/pm-checkpoint.sh --list           # bare list, ikke kjør gate
#   bash scripts/pm-checkpoint.sh --status         # sjekk om .pm-onboarding-confirmed.txt er gyldig
#   bash scripts/pm-checkpoint.sh --validate       # exit 0 hvis valid, 1 hvis må re-kjøres
#
# Vanntett-design (Tobias-direktiv 2026-05-10):
#   - Lag 1 (denne scripten): produserer audit-spor, krever per-fil takeaway
#   - Lag 2 (CLAUDE.md):       blocking-instruksjon "kjør først"
#   - Lag 3 (PR-template):     mandatory checkbox m/SHA-referanse
#   - Lag 4 (Playbook §3):     hard-block før trinn 4
#
# Ingen exit på manglende verktøy — scriptet skal kunne kjøres på en hvilken
# som helst utvikler-Mac med bash + git.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

CONFIRM_FILE="$REPO_ROOT/.pm-onboarding-confirmed.txt"
HANDOFF_DIR="$REPO_ROOT/docs/operations"
VALIDITY_DAYS="${PM_CHECKPOINT_VALIDITY_DAYS:-7}"

# ANSI-farger (slått av hvis ikke TTY)
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
  echo "${BOLD}${BLUE}║  PM-checkpoint — vanntett onboarding-gate                        ║${RESET}"
  echo "${BOLD}${BLUE}║  Spillorama-system                                                ║${RESET}"
  echo "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

list_handoffs() {
  # Returnerer alle PM_HANDOFF-filer sortert kronologisk (eldste først).
  # PM-en SKAL lese alt fra prosjekt-start, ikke bare siste.
  find "$HANDOFF_DIR" -maxdepth 1 -name 'PM_HANDOFF_*.md' -type f 2>/dev/null \
    | sort
}

get_main_sha() {
  git -C "$REPO_ROOT" rev-parse origin/main 2>/dev/null || git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"
}

cmd_list() {
  print_header
  echo "${BOLD}PM_HANDOFF-filer som MÅ leses (kronologisk):${RESET}"
  echo ""
  local count=0
  while IFS= read -r f; do
    count=$((count + 1))
    local rel="${f#"$REPO_ROOT/"}"
    local size_lines
    size_lines=$(wc -l < "$f" 2>/dev/null | tr -d ' ' || echo "?")
    printf "  %2d. %s ${YELLOW}(%s linjer)${RESET}\n" "$count" "$rel" "$size_lines"
  done < <(list_handoffs)
  echo ""
  echo "${BOLD}Totalt: $count handoff-filer${RESET}"
  echo ""
  echo "Anbefalt rekkefølge: les nyeste FØRST for current state, deretter"
  echo "fra eldst til nyest for å forstå hvordan vi kom hit."
  echo ""
}

cmd_status() {
  print_header
  if [[ ! -f "$CONFIRM_FILE" ]]; then
    echo "${RED}❌ Ingen onboarding-bekreftelse funnet.${RESET}"
    echo ""
    echo "Fil mangler: ${BOLD}$CONFIRM_FILE${RESET}"
    echo ""
    echo "Kjør ${BOLD}bash scripts/pm-checkpoint.sh${RESET} for å starte gate."
    return 1
  fi

  local age_days
  if [[ "$(uname)" == "Darwin" ]]; then
    local file_epoch
    file_epoch=$(stat -f %m "$CONFIRM_FILE" 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    age_days=$(( (now_epoch - file_epoch) / 86400 ))
  else
    local file_epoch
    file_epoch=$(stat -c %Y "$CONFIRM_FILE" 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    age_days=$(( (now_epoch - file_epoch) / 86400 ))
  fi

  if (( age_days <= VALIDITY_DAYS )); then
    echo "${GREEN}✅ Onboarding-bekreftelse er gyldig.${RESET}"
    echo ""
    echo "  Fil:  $CONFIRM_FILE"
    echo "  Alder: ${age_days} dag(er) (gyldig opp til ${VALIDITY_DAYS} dager)"
    echo ""
    echo "Innhold (topp 20 linjer):"
    echo "${BOLD}---${RESET}"
    head -20 "$CONFIRM_FILE" | sed 's/^/  /'
    echo "${BOLD}---${RESET}"
    return 0
  else
    echo "${YELLOW}⚠️  Onboarding-bekreftelse er for gammel.${RESET}"
    echo ""
    echo "  Alder: ${age_days} dager (max tillatt: ${VALIDITY_DAYS} dager)"
    echo "  Fil:   $CONFIRM_FILE"
    echo ""
    echo "Kjør ${BOLD}bash scripts/pm-checkpoint.sh${RESET} på nytt for å fornye."
    return 1
  fi
}

cmd_validate() {
  # Stillegående exit-code for CI / wrapper-scripts.
  if [[ ! -f "$CONFIRM_FILE" ]]; then
    return 1
  fi
  local age_days
  if [[ "$(uname)" == "Darwin" ]]; then
    local file_epoch
    file_epoch=$(stat -f %m "$CONFIRM_FILE" 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    age_days=$(( (now_epoch - file_epoch) / 86400 ))
  else
    local file_epoch
    file_epoch=$(stat -c %Y "$CONFIRM_FILE" 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    age_days=$(( (now_epoch - file_epoch) / 86400 ))
  fi
  if (( age_days <= VALIDITY_DAYS )); then
    return 0
  fi
  return 1
}

cmd_run() {
  print_header

  echo "${BOLD}Hva er dette?${RESET}"
  echo ""
  echo "Dette er en vanntett gate ny PM (menneskelig eller AI) MÅ passere"
  echo "før første kode-handling. Du må bekrefte at du har lest hele rekken"
  echo "av PM_HANDOFF-filer fra prosjekt-start (2026-04-23) til i dag."
  echo ""
  echo "Per fil må du skrive 1-3 setninger om hovedinnholdet — det stopper"
  echo "rask-skroll og tvinger ekte gjennomlesing."
  echo ""
  echo "${YELLOW}Du kan IKKE jukse ved å skrive 'lest' uten å ha lest. Tobias"
  echo "leser .pm-onboarding-confirmed.txt og verifiserer at takeaway-en"
  echo "matcher faktisk innhold før første PR mergees.${RESET}"
  echo ""

  # PM-identifier
  local pm_id="${PM_CHECKPOINT_PM_ID:-}"
  if [[ -z "$pm_id" ]]; then
    if [[ -t 0 ]]; then
      printf "${BOLD}Hvem er du?${RESET} (eks: 'Claude Opus 4.7 - 2026-05-10' eller 'Konsulent Ola Nordmann'): "
      read -r pm_id
    else
      pm_id="ukjent (non-interactive)"
    fi
  fi
  if [[ -z "$pm_id" ]]; then
    pm_id="ukjent"
  fi

  local main_sha
  main_sha="$(get_main_sha)"
  local now_iso
  now_iso="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  # Oppretter temp-fil for å bygge bekreftelsen
  local tmp_file
  tmp_file="$(mktemp -t pm-checkpoint-XXXXXX)"
  cleanup() {
    rm -f "$tmp_file"
  }
  trap cleanup EXIT

  {
    echo "# PM-onboarding-bekreftelse"
    echo ""
    echo "**Generert:** $now_iso"
    echo "**PM-identifier:** $pm_id"
    echo "**Main-SHA:** $main_sha"
    echo "**Repo-rot:** $REPO_ROOT"
    echo ""
    echo "## Bekreftelse"
    echo ""
    echo "Jeg bekrefter at jeg har lest hele rekken av PM_HANDOFF-filer"
    echo "siden prosjekt-start (2026-04-23) og forstått hovedinnholdet"
    echo "i hver fil. Min fri-tekst-takeaway per fil er nedenfor."
    echo ""
    echo "## Handoff-rekke"
    echo ""
  } > "$tmp_file"

  # Per-fil-confirmation
  local idx=0
  local total
  total="$(list_handoffs | wc -l | tr -d ' ')"
  echo ""
  echo "${BOLD}Du må bekrefte $total handoff-filer.${RESET}"
  echo ""

  while IFS= read -r f; do
    idx=$((idx + 1))
    local rel="${f#"$REPO_ROOT/"}"
    local size_lines
    size_lines=$(wc -l < "$f" 2>/dev/null | tr -d ' ' || echo "?")

    echo "${BOLD}${BLUE}━━ [$idx/$total] $rel${RESET}"
    echo "${YELLOW}Størrelse: $size_lines linjer${RESET}"
    echo ""
    echo "Forventet handling:"
    echo "  1. Åpne filen i editor"
    echo "  2. Les minimum (a) Status-blokken på topp og (b) hovedoverskrifter"
    echo "  3. Notér 1-3 setninger om hva som ble levert / besluttet i denne sesjon"
    echo ""

    if [[ -t 0 ]]; then
      printf "${BOLD}Har du lest %s? (ja/nei):${RESET} " "$rel"
      read -r confirmed
      if [[ "$confirmed" != "ja" && "$confirmed" != "y" && "$confirmed" != "Y" && "$confirmed" != "yes" ]]; then
        echo ""
        echo "${RED}❌ Avbrutt. Du må lese filen og kjøre dette på nytt.${RESET}"
        echo ""
        echo "Tips: Åpne filen i editor først, deretter kjør pm-checkpoint igjen."
        rm -f "$tmp_file"
        exit 1
      fi
      echo ""
      echo "${BOLD}Skriv 1-3 setninger om hovedinnholdet i $rel:${RESET}"
      echo "(avslutt med tom linje + Enter)"
      echo ""
      local takeaway=""
      while IFS= read -r line; do
        if [[ -z "$line" ]]; then
          break
        fi
        takeaway+="$line"$'\n'
      done
      if [[ -z "$takeaway" ]]; then
        echo ""
        echo "${RED}❌ Tom takeaway. Du må skrive 1-3 setninger.${RESET}"
        rm -f "$tmp_file"
        exit 1
      fi
      {
        echo "### $idx. $rel"
        echo ""
        echo "**Takeaway:**"
        echo ""
        echo "$takeaway"
        echo ""
      } >> "$tmp_file"
      echo "${GREEN}✓ Bekreftet.${RESET}"
      echo ""
    else
      # Non-interactive (CI / pipe) — kan ikke samle takeaway. Skriv inn placeholder.
      {
        echo "### $idx. $rel"
        echo ""
        echo "**Takeaway:** (non-interactive run — ingen takeaway samlet)"
        echo ""
      } >> "$tmp_file"
    fi
  done < <(list_handoffs)

  {
    echo ""
    echo "## Tilleggsbekreftelse"
    echo ""
    echo "Jeg bekrefter også at jeg har lest:"
    echo ""
    echo "- [ ] CLAUDE.md (Project-specific Conventions)"
    echo "- [ ] docs/SYSTEM_DESIGN_PRINCIPLES.md"
    echo "- [ ] docs/architecture/SPILL_REGLER_OG_PAYOUT.md"
    echo "- [ ] docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md"
    echo "- [ ] docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md"
    echo "- [ ] docs/engineering/PM_ONBOARDING_PLAYBOOK.md"
    echo ""
    echo "## Sjekkpunkter"
    echo ""
    echo "Generert via \`scripts/pm-checkpoint.sh\` og er gyldig i ${VALIDITY_DAYS} dager."
    echo ""
    echo "Etter ${VALIDITY_DAYS} dager må PM kjøre dette på nytt for å fornye gate-en."
  } >> "$tmp_file"

  # Kopier til endelig plassering
  cp "$tmp_file" "$CONFIRM_FILE"
  rm -f "$tmp_file"

  echo ""
  echo "${GREEN}${BOLD}✅ Onboarding-gate passert!${RESET}"
  echo ""
  echo "Bekreftelse skrevet til:"
  echo "  ${BOLD}$CONFIRM_FILE${RESET}"
  echo ""
  echo "Den er gyldig i ${VALIDITY_DAYS} dager."
  echo ""
  echo "${BOLD}Neste steg:${RESET}"
  echo "  1. Les inn nyeste PM_HANDOFF (igjen — for current state)"
  echo "  2. Sjekk pågående arbeid i BACKLOG.md + Linear"
  echo "  3. Verifiser dev-stack: \`bash scripts/pm-onboarding.sh\`"
  echo "  4. Begynn første kode-handling"
  echo ""
  echo "${YELLOW}NB:${RESET} ${BOLD}.pm-onboarding-confirmed.txt${RESET} er ${BOLD}.gitignore-d${RESET} —"
  echo "den lever lokalt og skal IKKE commitees. Når du åpner PR vil"
  echo "PR-template be deg om å referere main-SHA fra denne filen som bevis."
  echo ""
}

# CLI-dispatch
mode="${1:-run}"
case "$mode" in
  --list|list)
    cmd_list
    exit 0
    ;;
  --status|status)
    cmd_status
    exit $?
    ;;
  --validate|validate)
    cmd_validate
    exit $?
    ;;
  --help|-h|help)
    cat <<EOF
PM-checkpoint — vanntett onboarding-gate.

Bruk:
  bash scripts/pm-checkpoint.sh                  Kjør interaktiv gate
  bash scripts/pm-checkpoint.sh --list           List alle PM_HANDOFF-filer
  bash scripts/pm-checkpoint.sh --status         Vis status av .pm-onboarding-confirmed.txt
  bash scripts/pm-checkpoint.sh --validate       Exit 0 hvis valid, 1 ellers (for CI/wrapper)

Env-vars:
  PM_CHECKPOINT_VALIDITY_DAYS    Hvor mange dager bekreftelsen er gyldig (default 7)
  PM_CHECKPOINT_PM_ID            Forhånds-utfyll PM-identifier (skip prompt)

Filer:
  .pm-onboarding-confirmed.txt   Skrives til repo-rot etter passert gate (gitignore-d)
  scripts/pm-checkpoint.sh       Denne scripten
EOF
    exit 0
    ;;
  --run|run|"")
    cmd_run
    exit 0
    ;;
  *)
    echo "Ukjent mode: $mode" >&2
    echo "Bruk --help for hjelp." >&2
    exit 2
    ;;
esac
