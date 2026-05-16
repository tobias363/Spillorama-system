#!/usr/bin/env bash
# cleanup-stale-stashes.sh — Fase B av ADR-0024 follow-up.
#
# Identifiserer trygt-slettbare git-stashes og foreslår fjerning.
# DRY-RUN BY DEFAULT — krever --apply for å faktisk slette.
#
# Sikkerhets-kategorisering per stash:
#   AUTO-BACKUP    — lint-staged eller andre auto-stashes (>1 dag = safe)
#   AGENT-LEFTOVER — "agent-x", "parallel agent", "WIP from" (>7 dager = safe)
#   MERGED-BRANCH  — branch er merget eller slettet (>7 dager = safe)
#   FRESH          — nylig (≤7 dager), behold
#   EXPLICIT-KEEP  — pre-rebase/recovery/rescue/etc., behold
#   UNCLEAR        — ingen klar pattern, behold
#
# Bruk:
#   bash scripts/cleanup-stale-stashes.sh                # dry-run, default
#   bash scripts/cleanup-stale-stashes.sh --apply        # interaktivt
#   bash scripts/cleanup-stale-stashes.sh --apply --yes  # bekreft alt
#   bash scripts/cleanup-stale-stashes.sh --min-age N    # minst N dager (default: 7)
#   bash scripts/cleanup-stale-stashes.sh --json         # JSON output

set -euo pipefail

DRY_RUN=1
INTERACTIVE=1
JSON_OUTPUT=0
MIN_AGE_DAYS=7
MAIN_REF="${MAIN_REF:-origin/main}"

if [ -t 1 ]; then
  C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'
  C_GREEN=$'\033[32m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_RED='' C_YELLOW='' C_GREEN='' C_DIM='' C_BOLD='' C_RESET=''
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/cleanup-stale-stashes.sh [--apply] [--yes] [--min-age N] [--json]

Default: DRY-RUN. Shows table of stashes with category + age + verdict.

Flags:
  --apply           Actually drop stashes (with per-item prompt unless --yes)
  --yes / -y        Skip per-item prompt
  --min-age N       Minimum age in days to suggest deletion (default: 7)
  --json            JSON output instead of human-readable table
  --help / -h       Show this help

Safety:
  - Only stashes matching SAFE-categories AND older than --min-age are suggested.
  - EXPLICIT-KEEP patterns (pre-rebase, recovery, rescue) are NEVER suggested.
  - UNCLEAR / FRESH stashes are never suggested.
  - Per-item Y/N prompt unless --yes.

Exit codes:
  0 — success
  1 — argument error
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) DRY_RUN=0; shift ;;
    --yes|-y) INTERACTIVE=0; shift ;;
    --min-age) MIN_AGE_DAYS="${2:-7}"; shift 2 ;;
    --json) JSON_OUTPUT=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

NOW_EPOCH="$(date -u +%s)"
MIN_AGE_SECS=$(( MIN_AGE_DAYS * 86400 ))

# Get stash list with stable timestamps + messages
# Format: "<index>|<unix-ts>|<branch>|<message>"
stash_list_raw="$(git stash list --format='%gd|%ct|%gs' 2>/dev/null || true)"

if [ -z "$stash_list_raw" ]; then
  echo "${C_DIM}No stashes to analyze.${C_RESET}"
  exit 0
fi

declare -a STASH_REFS=() STASH_TS=() STASH_MSGS=()

while IFS='|' read -r ref ts msg; do
  [ -z "$ref" ] && continue
  STASH_REFS+=("$ref")
  STASH_TS+=("$ts")
  STASH_MSGS+=("$msg")
done <<< "$stash_list_raw"

categorize_stash() {
  local ref="$1" ts="$2" msg="$3"

  local age_secs=$(( NOW_EPOCH - ts ))
  local age_days=$(( age_secs / 86400 ))

  # EXPLICIT-KEEP patterns — never suggest deletion
  if [[ "$msg" =~ (pre-rebase|pre-cherry-pick|pre-merge|recovery/|rescue|recover|backup-before|restore-) ]]; then
    echo "EXPLICIT-KEEP|$age_days"
    return
  fi

  # FRESH — too new
  if [ "$age_secs" -lt "$MIN_AGE_SECS" ]; then
    echo "FRESH|$age_days"
    return
  fi

  # AUTO-BACKUP — lint-staged or similar automatic
  if [[ "$msg" =~ (lint-staged.*automatic.*backup|automatic.backup) ]]; then
    if [ "$age_days" -ge 1 ]; then
      echo "AUTO-BACKUP|$age_days"
    else
      echo "FRESH|$age_days"
    fi
    return
  fi

  # AGENT-LEFTOVER — agent collision baggage
  if [[ "$msg" =~ (agent-x|agent-y|parallel.agent|WIP.from.other.agent|from.other.session|leftover.from.other|leftover.from.parallel|agent-cross-pollution|carryover.from.parallel|other-agent|other-agents) ]]; then
    echo "AGENT-LEFTOVER|$age_days"
    return
  fi

  # MERGED-BRANCH — try to detect if branch is merged
  if [[ "$msg" =~ ^WIP[[:space:]]on[[:space:]]([^:]+): ]] || [[ "$msg" =~ ^On[[:space:]]([^:]+): ]]; then
    local branch="${BASH_REMATCH[1]}"
    # Check if branch is merged (or no longer exists)
    if ! git rev-parse --verify "refs/heads/${branch}" >/dev/null 2>&1; then
      echo "MERGED-BRANCH|$age_days|$branch|deleted"
      return
    fi
    local branch_sha
    branch_sha="$(git rev-parse "refs/heads/${branch}" 2>/dev/null || echo "")"
    if [ -n "$branch_sha" ] && git merge-base --is-ancestor "$branch_sha" "$MAIN_REF" 2>/dev/null; then
      echo "MERGED-BRANCH|$age_days|$branch|merged"
      return
    fi
    echo "UNCLEAR|$age_days|$branch|unmerged"
    return
  fi

  echo "UNCLEAR|$age_days"
}

declare -a CATS=()
for i in "${!STASH_REFS[@]}"; do
  c="$(categorize_stash "${STASH_REFS[$i]}" "${STASH_TS[$i]}" "${STASH_MSGS[$i]}")"
  CATS+=("$c")
done

if [ "$JSON_OUTPUT" = "1" ]; then
  echo "["
  for i in "${!STASH_REFS[@]}"; do
    sep=","
    [ "$i" = "$((${#STASH_REFS[@]} - 1))" ] && sep=""
    IFS='|' read -r cat age branch info <<< "${CATS[$i]}"
    esc_msg="$(echo "${STASH_MSGS[$i]}" | sed 's/"/\\"/g')"
    cat <<EOF
  {
    "ref": "${STASH_REFS[$i]}",
    "age_days": ${age},
    "category": "${cat}",
    "branch": "${branch:-}",
    "info": "${info:-}",
    "message": "${esc_msg}"
  }${sep}
EOF
  done
  echo "]"
  exit 0
fi

# Counters (bash 3.2-compatible — no associative arrays)
count_category() {
  local target="$1"
  local n=0
  for c in "${CATS[@]}"; do
    [ "${c%%|*}" = "$target" ] && n=$((n + 1))
  done
  echo "$n"
}

echo "${C_BOLD}Stash cleanup analysis${C_RESET}"
echo "${C_DIM}Total stashes: ${#STASH_REFS[@]}${C_RESET}"
echo "${C_DIM}Min-age for delete-eligibility: ${MIN_AGE_DAYS} days${C_RESET}"
echo ""

printf "%-15s %s\n" "CATEGORY" "COUNT"
printf "%-15s %s\n" "--------" "-----"
for cat in AUTO-BACKUP AGENT-LEFTOVER MERGED-BRANCH FRESH EXPLICIT-KEEP UNCLEAR; do
  c="$(count_category "$cat")"
  [ "$c" = "0" ] && continue
  printf "%-15s %s\n" "$cat" "$c"
done
echo ""

# Eligible: AUTO-BACKUP, AGENT-LEFTOVER, MERGED-BRANCH (with age >= MIN_AGE_DAYS)
echo "${C_BOLD}Eligible for deletion (safe categories + age ≥ ${MIN_AGE_DAYS}d):${C_RESET}"
echo ""
printf "%-9s  %-15s  %-5s  %s\n" "REF" "CATEGORY" "AGE" "MESSAGE"
printf "%-9s  %-15s  %-5s  %s\n" "---" "--------" "---" "-------"
ELIGIBLE_COUNT=0
declare -a ELIGIBLE_IDX=()
for i in "${!STASH_REFS[@]}"; do
  IFS='|' read -r cat age _ _ <<< "${CATS[$i]}"
  case "$cat" in
    AUTO-BACKUP|AGENT-LEFTOVER|MERGED-BRANCH)
      msg_trunc="${STASH_MSGS[$i]:0:60}"
      [ "${#STASH_MSGS[$i]}" -gt 60 ] && msg_trunc="${msg_trunc}…"
      printf "${C_GREEN}%-9s${C_RESET}  %-15s  %-5s  %s\n" "${STASH_REFS[$i]}" "$cat" "${age}d" "$msg_trunc"
      ELIGIBLE_IDX+=($i)
      ELIGIBLE_COUNT=$((ELIGIBLE_COUNT + 1))
      ;;
  esac
done

if [ "$ELIGIBLE_COUNT" = "0" ]; then
  echo ""
  echo "${C_DIM}No stashes eligible for cleanup.${C_RESET}"
fi

# Show UNCLEAR + FRESH counts for transparency
fresh_c="$(count_category FRESH)"
keep_c="$(count_category EXPLICIT-KEEP)"
unclear_c="$(count_category UNCLEAR)"
if [ "$fresh_c" -gt 0 ] || [ "$unclear_c" -gt 0 ] || [ "$keep_c" -gt 0 ]; then
  echo ""
  echo "${C_DIM}Preserved (not eligible):${C_RESET}"
  echo "${C_DIM}  FRESH: ${fresh_c} (younger than ${MIN_AGE_DAYS}d)${C_RESET}"
  echo "${C_DIM}  EXPLICIT-KEEP: ${keep_c} (pre-rebase/recovery/rescue patterns)${C_RESET}"
  echo "${C_DIM}  UNCLEAR: ${unclear_c} (no clear category — manual review recommended)${C_RESET}"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "${C_DIM}DRY-RUN (default). Re-run with --apply to actually drop.${C_RESET}"
  echo "${C_DIM}Tip: --json for machine-readable output, --min-age N to adjust threshold.${C_RESET}"
  exit 0
fi

if [ "$ELIGIBLE_COUNT" = "0" ]; then
  exit 0
fi

echo ""
echo "${C_BOLD}Apply mode${C_RESET} — about to drop ${ELIGIBLE_COUNT} stash(es)."

# When dropping stashes, indices shift. Drop from highest to lowest.
# Sort eligible indices descending by parsing stash@{N}.
declare -a SORTED_IDX=()
mapfile -t SORTED_IDX < <(
  for i in "${ELIGIBLE_IDX[@]}"; do
    ref="${STASH_REFS[$i]}"
    n="${ref#stash@\{}"
    n="${n%\}}"
    echo "$n $i"
  done | sort -k1 -nr | awk '{print $2}'
)

REMOVED=0
SKIPPED=0
for i in "${SORTED_IDX[@]}"; do
  ref="${STASH_REFS[$i]}"
  msg="${STASH_MSGS[$i]:0:60}"
  cat="${CATS[$i]%%|*}"

  if [ "$INTERACTIVE" = "1" ]; then
    printf "Drop ${C_DIM}[%s]${C_RESET} %s — %s? [y/N] " "$cat" "$ref" "$msg"
    read -r ans
    case "$ans" in
      y|Y|yes) : ;;
      *) echo "  ${C_DIM}skipped${C_RESET}"; SKIPPED=$((SKIPPED + 1)); continue ;;
    esac
  fi

  if git stash drop "$ref" >/dev/null 2>&1; then
    REMOVED=$((REMOVED + 1))
    echo "  ${C_GREEN}dropped${C_RESET} $ref"
  else
    echo "  ${C_RED}failed to drop${C_RESET} $ref"
  fi
done

echo ""
echo "${C_GREEN}Dropped: ${REMOVED}${C_RESET}, ${C_DIM}Skipped: ${SKIPPED}${C_RESET}"
echo ""
echo "${C_DIM}Note: stash indices may have shifted. Run again to see updated list.${C_RESET}"
