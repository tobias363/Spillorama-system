#!/usr/bin/env bash
# cleanup-merged-worktrees.sh — Fase B av ADR-0024 follow-up.
#
# Identifiserer trygt-slettbare git-worktrees og foreslår fjerning.
# DRY-RUN BY DEFAULT — krever --apply for å faktisk slette.
#
# Sikkerhets-verifikasjon per worktree:
#   1. Branch er merget til origin/main (alt arbeid bevart), ELLER
#      branchen finnes ikke lenger lokalt/remote (orphaned worktree)
#   2. Working tree er rent (ingen uncommittet WIP)
#   3. Ingen upushede commits
#
# Verdikter:
#   SAFE       — kan slettes uten data-tap
#   UNSAFE     — har upushed/uncommitted arbeid, ROR IKKE
#   LOCKED-S   — locked men ellers safe (kreves --include-locked for sletting)
#   ORPHANED   — worktree-path finnes ikke, prune-bare
#   CURRENT    — current worktree, kan ikke slettes
#
# Bruk:
#   bash scripts/cleanup-merged-worktrees.sh                   # dry-run, default
#   bash scripts/cleanup-merged-worktrees.sh --apply           # interaktivt
#   bash scripts/cleanup-merged-worktrees.sh --apply --yes     # bekreft alt
#   bash scripts/cleanup-merged-worktrees.sh --include-locked  # inkluder LOCKED-S
#   bash scripts/cleanup-merged-worktrees.sh --json            # JSON output

set -euo pipefail

DRY_RUN=1
INTERACTIVE=1
INCLUDE_LOCKED=0
JSON_OUTPUT=0
MAIN_REF="${MAIN_REF:-origin/main}"

# Colors (suppress if no TTY)
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
  bash scripts/cleanup-merged-worktrees.sh [--apply] [--yes] [--include-locked] [--json]

Default: DRY-RUN. Shows table of worktrees with safety verdict.

Flags:
  --apply           Actually remove worktrees (with per-item prompt unless --yes)
  --yes / -y        Skip per-item prompt (still requires --apply)
  --include-locked  Include LOCKED-S (locked but otherwise safe) worktrees
  --json            JSON output instead of human-readable table
  --main-ref REF    Override main ref for merge check (default: origin/main)
  --help / -h       Show this help

Safety:
  - Only worktrees with SAFE verdict are eligible for deletion.
  - UNSAFE worktrees (uncommitted or unpushed work) are NEVER deleted.
  - LOCKED worktrees require explicit --include-locked flag.
  - Per-item Y/N prompt unless --yes.

Exit codes:
  0 — success (or dry-run completed)
  1 — argument error
  2 — git error (couldn't enumerate worktrees)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) DRY_RUN=0; shift ;;
    --yes|-y) INTERACTIVE=0; shift ;;
    --include-locked) INCLUDE_LOCKED=1; shift ;;
    --json) JSON_OUTPUT=1; shift ;;
    --main-ref) MAIN_REF="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

# Sanity: ensure we're in a git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: not in a git repo" >&2
  exit 2
fi

# Ensure main-ref exists
if ! git rev-parse --verify "$MAIN_REF" >/dev/null 2>&1; then
  echo "ERROR: ref '$MAIN_REF' does not exist. Run 'git fetch origin' first." >&2
  exit 2
fi

CURRENT_PATH="$(pwd -P)"

# Parse `git worktree list --porcelain` into parallel arrays
declare -a WT_PATHS=() WT_BRANCHES=() WT_LOCKED=() WT_DETACHED=()

current_path=""
current_branch=""
current_locked=0
current_detached=0

flush_stanza() {
  if [ -n "$current_path" ]; then
    WT_PATHS+=("$current_path")
    WT_BRANCHES+=("$current_branch")
    WT_LOCKED+=("$current_locked")
    WT_DETACHED+=("$current_detached")
  fi
  current_path=""
  current_branch=""
  current_locked=0
  current_detached=0
}

while IFS= read -r line; do
  if [[ "$line" =~ ^worktree[[:space:]](.+)$ ]]; then
    flush_stanza
    current_path="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^branch[[:space:]]refs/heads/(.+)$ ]]; then
    current_branch="${BASH_REMATCH[1]}"
  elif [ "$line" = "detached" ]; then
    current_detached=1
  elif [[ "$line" == locked* ]]; then
    current_locked=1
  fi
done < <(git worktree list --porcelain)
flush_stanza

# Classify each worktree
classify_worktree() {
  local path="$1"
  local branch="$2"
  local locked="$3"
  local detached="$4"

  # CURRENT
  if [ "$(cd "$path" 2>/dev/null && pwd -P)" = "$CURRENT_PATH" ] 2>/dev/null; then
    echo "CURRENT"
    return
  fi

  # ORPHANED — worktree path doesn't exist
  if [ ! -d "$path" ]; then
    echo "ORPHANED"
    return
  fi

  # MAIN — main worktree (has .git as directory, not file). git worktree remove
  # refuses to remove the main worktree, and we shouldn't suggest it.
  if [ -d "$path/.git" ]; then
    echo "MAIN"
    return
  fi

  # If detached, hard to verify safely — treat as UNSAFE
  if [ "$detached" = "1" ]; then
    echo "UNSAFE_DETACHED"
    return
  fi

  # Check working tree clean
  local dirty
  dirty="$(git -C "$path" status --porcelain 2>/dev/null | head -1 || true)"
  if [ -n "$dirty" ]; then
    if [ "$locked" = "1" ]; then echo "LOCKED-UNSAFE"; else echo "UNSAFE_DIRTY"; fi
    return
  fi

  # Check branch exists locally
  if ! git -C "$path" rev-parse --verify "refs/heads/${branch}" >/dev/null 2>&1; then
    # Branch was deleted but worktree exists — safe
    if [ "$locked" = "1" ]; then echo "LOCKED-S"; else echo "SAFE"; fi
    return
  fi

  # Check merged to main
  local branch_sha
  branch_sha="$(git -C "$path" rev-parse "refs/heads/${branch}" 2>/dev/null || echo "")"
  if [ -n "$branch_sha" ] && git merge-base --is-ancestor "$branch_sha" "$MAIN_REF" 2>/dev/null; then
    if [ "$locked" = "1" ]; then echo "LOCKED-S"; else echo "SAFE"; fi
    return
  fi

  # Check for unpushed commits (compared to origin/<branch> if exists)
  local upstream
  upstream="$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")"
  if [ -z "$upstream" ]; then
    # No upstream and not merged → UNSAFE (work might not be on origin)
    if [ "$locked" = "1" ]; then echo "LOCKED-UNSAFE"; else echo "UNSAFE_NO_UPSTREAM"; fi
    return
  fi

  local unpushed
  unpushed="$(git -C "$path" log "${upstream}..HEAD" --oneline 2>/dev/null | head -1 || true)"
  if [ -n "$unpushed" ]; then
    if [ "$locked" = "1" ]; then echo "LOCKED-UNSAFE"; else echo "UNSAFE_UNPUSHED"; fi
    return
  fi

  # Branch is in sync with upstream but not yet merged to main
  # — still UNSAFE because work might be in active PR
  if [ "$locked" = "1" ]; then echo "LOCKED-UNSAFE"; else echo "UNSAFE_NOT_MERGED"; fi
}

# Build classification
declare -a WT_VERDICT=()
for i in "${!WT_PATHS[@]}"; do
  v="$(classify_worktree "${WT_PATHS[$i]}" "${WT_BRANCHES[$i]}" "${WT_LOCKED[$i]}" "${WT_DETACHED[$i]}")"
  WT_VERDICT+=("$v")
done

# Output
if [ "$JSON_OUTPUT" = "1" ]; then
  echo "["
  for i in "${!WT_PATHS[@]}"; do
    sep=","
    [ "$i" = "$((${#WT_PATHS[@]} - 1))" ] && sep=""
    cat <<EOF
  {
    "path": "${WT_PATHS[$i]}",
    "branch": "${WT_BRANCHES[$i]}",
    "locked": ${WT_LOCKED[$i]},
    "detached": ${WT_DETACHED[$i]},
    "verdict": "${WT_VERDICT[$i]}"
  }${sep}
EOF
  done
  echo "]"
  exit 0
fi

# Summary counters (bash 3.2-compatible — no associative arrays)
count_verdict() {
  local target="$1"
  local n=0
  for v in "${WT_VERDICT[@]}"; do
    [ "$v" = "$target" ] && n=$((n + 1))
  done
  echo "$n"
}

echo "${C_BOLD}Worktree cleanup analysis${C_RESET}"
echo "${C_DIM}Main ref: ${MAIN_REF}${C_RESET}"
echo "${C_DIM}Total worktrees: ${#WT_PATHS[@]}${C_RESET}"
echo ""

printf "%-20s %s\n" "VERDICT" "COUNT"
printf "%-20s %s\n" "-------" "-----"
for v in CURRENT MAIN SAFE LOCKED-S ORPHANED UNSAFE_DIRTY UNSAFE_UNPUSHED UNSAFE_NO_UPSTREAM UNSAFE_NOT_MERGED UNSAFE_DETACHED LOCKED-UNSAFE; do
  c="$(count_verdict "$v")"
  [ "$c" = "0" ] && continue
  printf "%-20s %s\n" "$v" "$c"
done
echo ""

# Detailed table for SAFE / LOCKED-S
echo "${C_BOLD}Eligible for cleanup:${C_RESET}"
echo ""
printf "%-7s  %-9s  %-60s  %s\n" "VERDICT" "LOCKED" "PATH" "BRANCH"
printf "%-7s  %-9s  %-60s  %s\n" "-------" "------" "----" "------"
ELIGIBLE_COUNT=0
declare -a ELIGIBLE_IDX=()
for i in "${!WT_PATHS[@]}"; do
  v="${WT_VERDICT[$i]}"
  case "$v" in
    SAFE)
      printf "${C_GREEN}%-7s${C_RESET}  %-9s  %-60s  %s\n" "$v" "no" "${WT_PATHS[$i]}" "${WT_BRANCHES[$i]:-<deleted>}"
      ELIGIBLE_IDX+=($i)
      ELIGIBLE_COUNT=$((ELIGIBLE_COUNT + 1))
      ;;
    LOCKED-S)
      if [ "$INCLUDE_LOCKED" = "1" ]; then
        printf "${C_YELLOW}%-7s${C_RESET}  %-9s  %-60s  %s\n" "$v" "yes" "${WT_PATHS[$i]}" "${WT_BRANCHES[$i]:-<deleted>}"
        ELIGIBLE_IDX+=($i)
        ELIGIBLE_COUNT=$((ELIGIBLE_COUNT + 1))
      fi
      ;;
    ORPHANED)
      printf "${C_GREEN}%-7s${C_RESET}  %-9s  %-60s  %s\n" "PRUNE" "n/a" "${WT_PATHS[$i]}" "${WT_BRANCHES[$i]:-<deleted>}"
      ;;
  esac
done

if [ "$ELIGIBLE_COUNT" = "0" ]; then
  echo ""
  echo "${C_DIM}No worktrees eligible for cleanup with current flags.${C_RESET}"
fi

locked_s_count="$(count_verdict LOCKED-S)"
if [ "$INCLUDE_LOCKED" = "0" ] && [ "$locked_s_count" -gt 0 ]; then
  echo ""
  echo "${C_YELLOW}Note: ${locked_s_count} LOCKED-S worktree(s) are otherwise safe but require --include-locked to be removed.${C_RESET}"
fi

# Show UNSAFE counts for transparency
unsafe_total=$(( $(count_verdict UNSAFE_DIRTY) + $(count_verdict UNSAFE_UNPUSHED) + $(count_verdict UNSAFE_NO_UPSTREAM) + $(count_verdict UNSAFE_NOT_MERGED) + $(count_verdict UNSAFE_DETACHED) + $(count_verdict LOCKED-UNSAFE) ))
if [ "$unsafe_total" -gt 0 ]; then
  echo ""
  echo "${C_RED}Unsafe (NOT eligible): ${unsafe_total} worktree(s) have uncommitted/unpushed/unmerged work.${C_RESET}"
  echo "${C_DIM}Run with --json for full details.${C_RESET}"
fi

# Dry-run early exit
if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "${C_DIM}DRY-RUN (default). Re-run with --apply to actually remove.${C_RESET}"
  exit 0
fi

# Apply mode — confirm and remove
if [ "$ELIGIBLE_COUNT" = "0" ]; then
  echo ""
  echo "Nothing to remove."
  exit 0
fi

echo ""
echo "${C_BOLD}Apply mode${C_RESET} — about to remove ${ELIGIBLE_COUNT} worktree(s)."

REMOVED=0
SKIPPED=0
for i in "${ELIGIBLE_IDX[@]}"; do
  path="${WT_PATHS[$i]}"
  branch="${WT_BRANCHES[$i]:-<deleted>}"
  verdict="${WT_VERDICT[$i]}"

  if [ "$INTERACTIVE" = "1" ]; then
    printf "Remove ${C_DIM}[%s]${C_RESET} %s (%s)? [y/N] " "$verdict" "$path" "$branch"
    read -r ans
    case "$ans" in
      y|Y|yes) : ;;
      *) echo "  ${C_DIM}skipped${C_RESET}"; SKIPPED=$((SKIPPED + 1)); continue ;;
    esac
  fi

  if [ "$verdict" = "LOCKED-S" ]; then
    git worktree unlock "$path" 2>/dev/null || true
  fi

  if git worktree remove "$path" 2>&1 | tail -2; then
    REMOVED=$((REMOVED + 1))
    echo "  ${C_GREEN}removed${C_RESET} $path"
  else
    echo "  ${C_YELLOW}retry with --force${C_RESET}"
    git worktree remove --force "$path" && REMOVED=$((REMOVED + 1)) || echo "  ${C_RED}failed${C_RESET}"
  fi
done

# Final prune to clean up orphaned entries
orphaned_count="$(count_verdict ORPHANED)"
if [ "$orphaned_count" -gt 0 ]; then
  echo ""
  echo "Pruning orphaned worktree entries…"
  git worktree prune --verbose
fi

echo ""
echo "${C_GREEN}Removed: ${REMOVED}${C_RESET}, ${C_DIM}Skipped: ${SKIPPED}${C_RESET}"
