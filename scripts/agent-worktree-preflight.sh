#!/usr/bin/env bash
# agent-worktree-preflight.sh — fail-fast lane check for Codex/Claude sessions.
#
# Purpose:
#   Make it obvious, before the first file edit, whether the current agent is
#   standing in the correct local worktree and on a branch that is fresh against
#   origin/main. This is an ergonomics guardrail for
#   docs/operations/CODEX_CLAUDE_WORKTREE_ROUTINE.md.
#
# Usage:
#   bash scripts/agent-worktree-preflight.sh --actor codex
#   bash scripts/agent-worktree-preflight.sh --actor claude
#   bash scripts/agent-worktree-preflight.sh --actor admin
#
# Optional:
#   --no-fetch       Do not fetch origin/main first (tests/offline only)
#   --allow-dirty    Do not fail on local modified/untracked files

set -euo pipefail

ACTOR="auto"
NO_FETCH="${AGENT_PREFLIGHT_SKIP_FETCH:-0}"
SKIP_GH="${AGENT_PREFLIGHT_SKIP_GH:-0}"
ALLOW_DIRTY=0

CODEX_WORKTREE="${SPILLORAMA_CODEX_WORKTREE:-/Users/tobiashaugen/Projects/Spillorama-system-codex}"
CLAUDE_WORKTREE="${SPILLORAMA_CLAUDE_WORKTREE:-/Users/tobiashaugen/Projects/Spillorama-system-claude}"
ADMIN_WORKTREE="${SPILLORAMA_ADMIN_WORKTREE:-/Users/tobiashaugen/Projects/Spillorama-system}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/agent-worktree-preflight.sh --actor codex|claude|admin

Checks:
  - current checkout is the expected Codex/Claude/admin worktree
  - git worktree is clean, unless --allow-dirty is used
  - origin/main is fetched, unless --no-fetch is used
  - current feature branch contains origin/main
  - branch prefix matches codex/* or claude/* when applicable
  - open PRs are listed so shared-file ownership can be checked before edits

Environment overrides for tests/local variants:
  SPILLORAMA_CODEX_WORKTREE
  SPILLORAMA_CLAUDE_WORKTREE
  SPILLORAMA_ADMIN_WORKTREE
  AGENT_PREFLIGHT_SKIP_FETCH=1
  AGENT_PREFLIGHT_SKIP_GH=1
EOF
}

fail() {
  echo "PREFLIGHT FAIL: $*" >&2
  exit 1
}

warn() {
  echo "WARN: $*" >&2
}

real_path() {
  local target="$1"
  if [ -d "$target" ]; then
    (cd "$target" && pwd -P)
  else
    printf '%s\n' "$target"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --actor)
      ACTOR="${2:-}"
      shift 2
      ;;
    --no-fetch)
      NO_FETCH=1
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] || fail "not inside a git repository"
REPO_ROOT="$(real_path "$REPO_ROOT")"
cd "$REPO_ROOT"

CODEX_WORKTREE="$(real_path "$CODEX_WORKTREE")"
CLAUDE_WORKTREE="$(real_path "$CLAUDE_WORKTREE")"
ADMIN_WORKTREE="$(real_path "$ADMIN_WORKTREE")"

if [ "$ACTOR" = "auto" ]; then
  case "$REPO_ROOT" in
    "$CODEX_WORKTREE") ACTOR="codex" ;;
    "$CLAUDE_WORKTREE") ACTOR="claude" ;;
    "$ADMIN_WORKTREE") ACTOR="admin" ;;
    *) fail "could not infer actor from worktree path: $REPO_ROOT. Pass --actor codex|claude|admin." ;;
  esac
fi

case "$ACTOR" in
  codex)
    EXPECTED_WORKTREE="$CODEX_WORKTREE"
    EXPECTED_PREFIX="codex/"
    ;;
  claude)
    EXPECTED_WORKTREE="$CLAUDE_WORKTREE"
    EXPECTED_PREFIX="claude/"
    ;;
  admin)
    EXPECTED_WORKTREE="$ADMIN_WORKTREE"
    EXPECTED_PREFIX=""
    ;;
  *)
    fail "--actor must be codex, claude, admin, or auto"
    ;;
esac

if [ "$REPO_ROOT" != "$EXPECTED_WORKTREE" ]; then
  cat >&2 <<EOF
PREFLIGHT FAIL: wrong worktree for actor '$ACTOR'

Current:  $REPO_ROOT
Expected: $EXPECTED_WORKTREE

Run:
  cd "$EXPECTED_WORKTREE"
  bash scripts/agent-worktree-preflight.sh --actor $ACTOR
EOF
  exit 1
fi

if [ "$NO_FETCH" != "1" ]; then
  git fetch origin main --prune
else
  warn "skipping git fetch because --no-fetch / AGENT_PREFLIGHT_SKIP_FETCH=1 is set"
fi

git rev-parse --verify origin/main >/dev/null 2>&1 \
  || fail "origin/main is not available. Run: git fetch origin main --prune"

BRANCH="$(git branch --show-current 2>/dev/null || true)"
HEAD_SHA="$(git rev-parse --short HEAD)"
MAIN_SHA="$(git rev-parse --short origin/main)"
STATUS_PORCELAIN="$(git status --porcelain)"

if [ -n "$STATUS_PORCELAIN" ] && [ "$ALLOW_DIRTY" != "1" ]; then
  cat >&2 <<EOF
PREFLIGHT FAIL: worktree has local changes before preflight completed.

Run:
  git status -sb

Commit/stash/revert unrelated local files before rebasing or starting new work.
EOF
  exit 1
fi

if [ -n "$STATUS_PORCELAIN" ] && [ "$ALLOW_DIRTY" = "1" ]; then
  warn "worktree is dirty, but --allow-dirty was provided"
fi

if [ "$ACTOR" != "admin" ] && [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ]; then
  case "$BRANCH" in
    "$EXPECTED_PREFIX"*) ;;
    *)
      fail "branch '$BRANCH' does not match expected $ACTOR prefix '$EXPECTED_PREFIX'"
      ;;
  esac
fi

if [ "$BRANCH" = "main" ]; then
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    fail "local main is not equal to origin/main. Run: git pull --ff-only origin main"
  fi
else
  if ! git merge-base --is-ancestor origin/main HEAD; then
    cat >&2 <<EOF
PREFLIGHT FAIL: current branch is not rebased on latest origin/main.

Current branch: ${BRANCH:-detached HEAD}
HEAD:           $HEAD_SHA
origin/main:    $MAIN_SHA

Run:
  git fetch origin main --prune
  git rebase origin/main

If the branch is already pushed:
  git push --force-with-lease
EOF
    exit 1
  fi
fi

cat <<EOF
PREFLIGHT PASS

Actor:        $ACTOR
Worktree:     $REPO_ROOT
Branch:       ${BRANCH:-detached HEAD}
HEAD:         $HEAD_SHA
origin/main:  $MAIN_SHA
Dirty files:  $([ -n "$STATUS_PORCELAIN" ] && echo yes || echo no)

Read before edits:
  docs/operations/CODEX_CLAUDE_WORKTREE_ROUTINE.md
  docs/operations/AI_BRANCH_COORDINATION_PROTOCOL.md

Conflict-sensitive files require explicit owner/rebase before edits:
  docs/engineering/PITFALLS_LOG.md
  docs/engineering/AGENT_EXECUTION_LOG.md
  .claude/skills/pm-orchestration-pattern/SKILL.md
  .github/workflows/**
  package.json
  package-lock.json
  docs/auto-generated/SKILL_FILE_MAP.md
  scripts/pm-knowledge-continuity.mjs
  scripts/validate-delivery-report.mjs
  scripts/validate-pr-agent-contract.mjs

If you need a new branch now:
  git switch -c ${ACTOR}/<scope>-$(date +%Y-%m-%d)
EOF

if command -v gh >/dev/null 2>&1 && [ "$SKIP_GH" != "1" ]; then
  echo
  echo "Open PRs to inspect for shared-file ownership:"
  gh pr list --state open --limit 20 \
    --json number,title,headRefName,isDraft,mergeStateStatus \
    --jq '.[] | "- PR #\(.number) [\(.mergeStateStatus)] \(.headRefName): \(.title)"' \
    || warn "gh pr list failed; inspect open PRs manually"
else
  echo
  warn "gh unavailable or skipped; inspect open PRs manually before touching shared files"
fi
