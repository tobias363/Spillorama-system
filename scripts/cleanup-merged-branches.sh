#!/usr/bin/env bash
# cleanup-merged-branches.sh — Fase B.2 av ADR-0024 follow-up.
#
# Identifiserer trygt-slettbare git-branches (lokale og/eller remote) og
# foreslår fjerning. DRY-RUN BY DEFAULT — krever --apply for å faktisk slette.
#
# Sikkerhets-kategorisering per branch:
#   PROTECTED      — main/master/recovery/backup/restore — ROR ALDRI
#   OPEN-PR        — har åpen PR på GitHub — behold
#   WORKTREE       — branchen er checked out i et worktree — behold
#   CURRENT        — current branch i denne checkout — kan ikke slettes
#   MERGED         — `git merge-base --is-ancestor` mot origin/main → safe
#   SQUASH-MERGED  — `gh pr list --state merged` matcher head → safe
#   FRESH          — branch laget for nylig (< --min-age) — behold selv om merget
#   UNMERGED       — verken merged ny squash-merged ny open-PR — krever manuell vurdering
#
# Bruk:
#   bash scripts/cleanup-merged-branches.sh                # dry-run lokale branches
#   bash scripts/cleanup-merged-branches.sh --remote       # dry-run remote branches
#   bash scripts/cleanup-merged-branches.sh --all          # dry-run begge
#   bash scripts/cleanup-merged-branches.sh --apply        # interaktivt
#   bash scripts/cleanup-merged-branches.sh --apply --yes  # bekreft alt
#   bash scripts/cleanup-merged-branches.sh --json         # JSON output
#   bash scripts/cleanup-merged-branches.sh --min-age N    # minst N dager (default: 7)
#
# Krav: bash 3.2+ (macOS default), gh CLI auth'd, jq.

set -euo pipefail

DRY_RUN=1
INTERACTIVE=1
SCOPE="local"   # local | remote | all
JSON_OUTPUT=0
MIN_AGE_DAYS=7
MAIN_REF="${MAIN_REF:-origin/main}"
PROTECTED_PATTERN='^(main|master|HEAD|backup/|recovery/|restore/|rescue/|docs/o1-o2-backup-rollback-drills|docs/session-log-backup-ref)'

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
  bash scripts/cleanup-merged-branches.sh [--apply] [--yes] [--remote|--all] [--min-age N] [--json]

Default: DRY-RUN, scope=local. Shows table of branches with safety verdict.

Flags:
  --apply           Actually delete branches (with per-item prompt unless --yes)
  --yes / -y        Skip per-item prompt
  --remote          Process remote-tracking branches on origin (refs/remotes/origin/*)
  --all             Process both local + remote
  --local           Process only local (default)
  --min-age N       Minimum age in days to suggest deletion (default: 7)
  --json            JSON output instead of human-readable table
  --main-ref REF    Override main ref (default: origin/main)
  --help / -h       Show this help

Safety:
  - PROTECTED-mønstre (main/master/backup/recovery/restore/rescue) slettes ALDRI.
  - WORKTREE-branches (checked out i et worktree) slettes ALDRI.
  - OPEN-PR-branches (har åpen PR) slettes ALDRI.
  - UNMERGED-branches krever manuell vurdering — ikke i delete-eligible.
  - FRESH-branches (< --min-age dager) beholdes selv om merged.
  - Per-item Y/N prompt med mindre --yes.

Avhengigheter: gh CLI auth'd (gh auth status), jq.

Exit codes:
  0 — success
  1 — argument error
  2 — missing dependency (gh/jq)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) DRY_RUN=0; shift ;;
    --yes|-y) INTERACTIVE=0; shift ;;
    --remote) SCOPE="remote"; shift ;;
    --all) SCOPE="all"; shift ;;
    --local) SCOPE="local"; shift ;;
    --min-age) MIN_AGE_DAYS="${2:-7}"; shift 2 ;;
    --json) JSON_OUTPUT=1; shift ;;
    --main-ref) MAIN_REF="${2:-origin/main}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

# Dependency checks
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated (run 'gh auth login')" >&2; exit 2; }

NOW_EPOCH="$(date -u +%s)"
MIN_AGE_SECS=$(( MIN_AGE_DAYS * 86400 ))

# ---- Fetch PR cache (open + merged) once ---------------------------------

echo "${C_DIM}Caching PR state from GitHub...${C_RESET}" >&2

OPEN_PR_HEADS_FILE="$(mktemp)"
MERGED_PR_HEADS_FILE="$(mktemp)"
trap 'rm -f "$OPEN_PR_HEADS_FILE" "$MERGED_PR_HEADS_FILE"' EXIT

gh pr list --state open --limit 200 --json headRefName --jq '.[].headRefName' > "$OPEN_PR_HEADS_FILE" 2>/dev/null || true
gh pr list --state merged --limit 2000 --json headRefName --jq '.[].headRefName' > "$MERGED_PR_HEADS_FILE" 2>/dev/null || true

OPEN_COUNT="$(wc -l < "$OPEN_PR_HEADS_FILE" | tr -d ' ')"
MERGED_COUNT="$(wc -l < "$MERGED_PR_HEADS_FILE" | tr -d ' ')"
echo "${C_DIM}  ${OPEN_COUNT} open PRs, ${MERGED_COUNT} merged PRs cached${C_RESET}" >&2

# ---- Enumerate worktree-branches (to mark WORKTREE) ----------------------

WORKTREE_BRANCHES_FILE="$(mktemp)"
trap 'rm -f "$OPEN_PR_HEADS_FILE" "$MERGED_PR_HEADS_FILE" "$WORKTREE_BRANCHES_FILE"' EXIT
git worktree list --porcelain 2>/dev/null | awk '/^branch refs\/heads\// {sub("^branch refs/heads/", ""); print}' > "$WORKTREE_BRANCHES_FILE" || true

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

# ---- Helpers -------------------------------------------------------------

in_file() {
  # Match exact line in file (handles branches with /)
  local needle="$1" file="$2"
  grep -Fxq -- "$needle" "$file" 2>/dev/null
}

branch_age_days() {
  # Age based on committer date of branch tip
  local ref="$1"
  local ts
  ts="$(git log -1 --format='%ct' "$ref" 2>/dev/null || echo "0")"
  if [ "$ts" = "0" ]; then echo "999"; return; fi
  echo $(( (NOW_EPOCH - ts) / 86400 ))
}

classify_branch() {
  local scope="$1" ref_name="$2"
  # ref_name is the short name (e.g., "feat/foo" or "claude/foo")
  # For remote scope it's still short name (without "origin/" prefix)

  # PROTECTED — never touch
  if [[ "$ref_name" =~ $PROTECTED_PATTERN ]]; then
    echo "PROTECTED|0"
    return
  fi

  # CURRENT — can't delete current
  if [ "$scope" = "local" ] && [ "$ref_name" = "$CURRENT_BRANCH" ]; then
    echo "CURRENT|0"
    return
  fi

  # WORKTREE — checked out in any worktree
  if [ "$scope" = "local" ] && in_file "$ref_name" "$WORKTREE_BRANCHES_FILE"; then
    echo "WORKTREE|0"
    return
  fi

  # OPEN-PR
  if in_file "$ref_name" "$OPEN_PR_HEADS_FILE"; then
    echo "OPEN-PR|0"
    return
  fi

  local full_ref
  if [ "$scope" = "local" ]; then
    full_ref="refs/heads/${ref_name}"
  else
    full_ref="refs/remotes/origin/${ref_name}"
  fi

  local age
  age="$(branch_age_days "$full_ref")"

  # FRESH — too new (regardless of merge status)
  if [ "$age" -lt "$MIN_AGE_DAYS" ]; then
    echo "FRESH|$age"
    return
  fi

  # MERGED via merge-base ancestor (regular merge)
  if git merge-base --is-ancestor "$full_ref" "$MAIN_REF" 2>/dev/null; then
    echo "MERGED|$age"
    return
  fi

  # SQUASH-MERGED via gh PR cache
  if in_file "$ref_name" "$MERGED_PR_HEADS_FILE"; then
    echo "SQUASH-MERGED|$age"
    return
  fi

  # UNMERGED — manual review needed
  echo "UNMERGED|$age"
}

# ---- Build branch lists -------------------------------------------------

declare -a BRANCH_REFS=()     # short name (no refs/ prefix)
declare -a BRANCH_SCOPE=()    # "local" or "remote"
declare -a BRANCH_CATS=()     # category|age

scan_local() {
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    BRANCH_REFS+=("$b")
    BRANCH_SCOPE+=("local")
  done < <(git for-each-ref refs/heads/ --format='%(refname:short)')
}

scan_remote() {
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    # Strip "origin/" prefix
    b_short="${b#origin/}"
    # Skip HEAD pseudo-ref
    [ "$b_short" = "HEAD" ] && continue
    BRANCH_REFS+=("$b_short")
    BRANCH_SCOPE+=("remote")
  done < <(git for-each-ref refs/remotes/origin/ --format='%(refname:short)')
}

case "$SCOPE" in
  local) scan_local ;;
  remote) scan_remote ;;
  all) scan_local; scan_remote ;;
esac

# ---- Classify --------------------------------------------------------------

echo "${C_DIM}Classifying ${#BRANCH_REFS[@]} branches...${C_RESET}" >&2

for i in "${!BRANCH_REFS[@]}"; do
  c="$(classify_branch "${BRANCH_SCOPE[$i]}" "${BRANCH_REFS[$i]}")"
  BRANCH_CATS+=("$c")
done

# ---- JSON output ---------------------------------------------------------

if [ "$JSON_OUTPUT" = "1" ]; then
  echo "["
  for i in "${!BRANCH_REFS[@]}"; do
    sep=","
    [ "$i" = "$((${#BRANCH_REFS[@]} - 1))" ] && sep=""
    IFS='|' read -r cat age <<< "${BRANCH_CATS[$i]}"
    cat <<EOF
  {
    "branch": "${BRANCH_REFS[$i]}",
    "scope": "${BRANCH_SCOPE[$i]}",
    "category": "${cat}",
    "age_days": ${age}
  }${sep}
EOF
  done
  echo "]"
  exit 0
fi

# ---- Summary --------------------------------------------------------------

count_category() {
  local target="$1" scope_filter="${2:-}"
  local n=0
  for i in "${!BRANCH_CATS[@]}"; do
    [ "${BRANCH_CATS[$i]%%|*}" != "$target" ] && continue
    [ -n "$scope_filter" ] && [ "${BRANCH_SCOPE[$i]}" != "$scope_filter" ] && continue
    n=$((n + 1))
  done
  echo "$n"
}

echo "${C_BOLD}Branch cleanup analysis${C_RESET}"
echo "${C_DIM}Total branches scanned: ${#BRANCH_REFS[@]} (scope=${SCOPE})${C_RESET}"
echo "${C_DIM}Min-age for delete-eligibility: ${MIN_AGE_DAYS} days${C_RESET}"
echo ""

printf "%-15s %8s %8s %8s\n" "CATEGORY" "LOCAL" "REMOTE" "TOTAL"
printf "%-15s %8s %8s %8s\n" "--------" "-----" "------" "-----"
for cat in MERGED SQUASH-MERGED FRESH OPEN-PR WORKTREE CURRENT PROTECTED UNMERGED; do
  l="$(count_category "$cat" "local")"
  r="$(count_category "$cat" "remote")"
  t=$(( l + r ))
  [ "$t" = "0" ] && continue
  printf "%-15s %8s %8s %8s\n" "$cat" "$l" "$r" "$t"
done
echo ""

# Eligible: MERGED + SQUASH-MERGED (age check baked into FRESH category)
echo "${C_BOLD}Eligible for deletion (MERGED or SQUASH-MERGED, age ≥ ${MIN_AGE_DAYS}d):${C_RESET}"
echo ""

declare -a ELIGIBLE_IDX=()
for i in "${!BRANCH_CATS[@]}"; do
  case "${BRANCH_CATS[$i]%%|*}" in
    MERGED|SQUASH-MERGED) ELIGIBLE_IDX+=("$i") ;;
  esac
done

ELIGIBLE_COUNT="${#ELIGIBLE_IDX[@]}"

if [ "$ELIGIBLE_COUNT" = "0" ]; then
  echo "${C_DIM}No branches eligible for cleanup.${C_RESET}"
else
  echo "${C_DIM}(Showing first 20; full list available with --json)${C_RESET}"
  echo ""
  printf "%-6s  %-15s  %-5s  %s\n" "SCOPE" "CATEGORY" "AGE" "BRANCH"
  printf "%-6s  %-15s  %-5s  %s\n" "-----" "--------" "---" "------"
  shown=0
  for i in "${ELIGIBLE_IDX[@]}"; do
    [ "$shown" -ge 20 ] && break
    IFS='|' read -r cat age <<< "${BRANCH_CATS[$i]}"
    printf "${C_GREEN}%-6s${C_RESET}  %-15s  %-5s  %s\n" "${BRANCH_SCOPE[$i]}" "$cat" "${age}d" "${BRANCH_REFS[$i]}"
    shown=$((shown + 1))
  done
  if [ "$ELIGIBLE_COUNT" -gt 20 ]; then
    echo "${C_DIM}  ... and $((ELIGIBLE_COUNT - 20)) more${C_RESET}"
  fi
fi

echo ""
echo "${C_BOLD}Total eligible: ${ELIGIBLE_COUNT}${C_RESET}"

# Show UNMERGED count separately (manual-review)
unmerged_c="$(count_category UNMERGED)"
if [ "$unmerged_c" -gt 0 ]; then
  echo "${C_YELLOW}⚠ UNMERGED branches: ${unmerged_c} (manuell vurdering kreves — ikke i delete-eligible)${C_RESET}"
fi

# ---- DRY-RUN exit ---------------------------------------------------------

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "${C_DIM}DRY-RUN — no changes made. Re-run with --apply to delete eligible branches.${C_RESET}"
  exit 0
fi

if [ "$ELIGIBLE_COUNT" = "0" ]; then
  exit 0
fi

# ---- Apply mode ----------------------------------------------------------

echo ""
echo "${C_BOLD}Apply mode${C_RESET} — about to delete ${ELIGIBLE_COUNT} branch(es)."

REMOVED=0
SKIPPED=0
FAILED=0

for i in "${ELIGIBLE_IDX[@]}"; do
  ref="${BRANCH_REFS[$i]}"
  scope="${BRANCH_SCOPE[$i]}"
  cat="${BRANCH_CATS[$i]%%|*}"

  if [ "$INTERACTIVE" = "1" ]; then
    printf "Delete ${C_DIM}[%s/%s]${C_RESET} %s? [y/N] " "$scope" "$cat" "$ref"
    read -r ans
    case "$ans" in
      y|Y|yes|YES)
        :
        ;;
      *)
        SKIPPED=$((SKIPPED + 1))
        continue
        ;;
    esac
  fi

  if [ "$scope" = "local" ]; then
    if git branch -D "$ref" >/dev/null 2>&1; then
      REMOVED=$((REMOVED + 1))
    else
      echo "${C_RED}  FAILED to delete local: $ref${C_RESET}" >&2
      FAILED=$((FAILED + 1))
    fi
  else
    if git push origin --delete "$ref" >/dev/null 2>&1; then
      REMOVED=$((REMOVED + 1))
    else
      echo "${C_RED}  FAILED to delete remote: $ref${C_RESET}" >&2
      FAILED=$((FAILED + 1))
    fi
  fi
done

echo ""
echo "${C_BOLD}Summary:${C_RESET}"
echo "  ${C_GREEN}Removed:${C_RESET} ${REMOVED}"
[ "$SKIPPED" -gt 0 ] && echo "  ${C_DIM}Skipped:${C_RESET} ${SKIPPED}"
[ "$FAILED" -gt 0 ] && echo "  ${C_RED}Failed:${C_RESET}  ${FAILED}"

exit 0
