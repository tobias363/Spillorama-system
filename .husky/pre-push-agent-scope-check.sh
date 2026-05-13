#!/usr/bin/env bash
# pre-push-agent-scope-check.sh — pre-push hook for PM push-control (Phase 2)
#
# Sjekker at filene en agent pusher matcher dens deklarerte scope i
# .claude/active-agents.json. Brukes for å fange scope-creep FØR det
# havner i en PR.
#
# Behavior:
#   - Hvis branch ikke er registrert → passerer silent (exit 0)
#   - Hvis branch er registrert OG alle filer matcher scope → exit 0
#   - Hvis branch er registrert OG noen filer ER UTENFOR scope:
#       - Default: WARN, exit 0 (push allowed)
#       - PM_PUSH_STRICT_SCOPE=1: ABORT, exit 1 (push blokkeret)
#
# Bypasses:
#   PM_PUSH_BYPASS=1                  # hopp over alle pre-push-sjekker
#   PM_PUSH_SCOPE_CHECK_BYPASS=1      # hopp over kun scope-sjekken
#
# Inputs (fra git):
#   stdin: linjer på formatet "<local ref> <local sha> <remote ref> <remote sha>"
#
# Loggføring:
#   /tmp/pm-push-control.log

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
LOG="/tmp/pm-push-control.log"

# Bypass-flagg
if [ "${PM_PUSH_BYPASS:-0}" = "1" ] || [ "${PM_PUSH_SCOPE_CHECK_BYPASS:-0}" = "1" ]; then
  echo "⏭️  Scope-check bypassed via env-var"
  exit 0
fi

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log_event() {
  echo "[$(ts)] pre-push-scope-check: $1" >> "$LOG" 2>/dev/null || true
}

# Parse git push input
# Each line: <local-ref> <local-sha> <remote-ref> <remote-sha>
PUSH_LINES="$(cat || true)"

if [ -z "$PUSH_LINES" ]; then
  # No push-input → fall back to current branch + HEAD
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
  REMOTE_SHA=""
  if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
    exit 0
  fi
else
  # Parse first line — for normal `git push` from a branch, there's only one ref
  FIRST_LINE="$(echo "$PUSH_LINES" | head -n 1)"
  LOCAL_REF="$(echo "$FIRST_LINE" | awk '{print $1}')"
  LOCAL_SHA="$(echo "$FIRST_LINE" | awk '{print $2}')"
  REMOTE_REF="$(echo "$FIRST_LINE" | awk '{print $3}')"
  REMOTE_SHA="$(echo "$FIRST_LINE" | awk '{print $4}')"

  # Strip "refs/heads/" prefix to get plain branch-name
  BRANCH="${LOCAL_REF#refs/heads/}"

  if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
    exit 0
  fi
fi

# Check that branch is registered in registry — quick pre-check
REGISTRY="$REPO_ROOT/.claude/active-agents.json"
if [ ! -f "$REGISTRY" ]; then
  # No registry → nothing to check
  exit 0
fi

# Fast jq-free check: is branch in registry?
if ! grep -q "\"branch\": *\"$BRANCH\"" "$REGISTRY" 2>/dev/null; then
  # Not registered — silently pass
  exit 0
fi

# Determine list of files being pushed
if [ -z "$REMOTE_SHA" ] || [ "$REMOTE_SHA" = "0000000000000000000000000000000000000000" ]; then
  # New branch — diff against origin/main as baseline
  BASE="origin/main"
  if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
    BASE=""
  fi
else
  BASE="$REMOTE_SHA"
fi

FILES=""
if [ -n "$BASE" ]; then
  FILES="$(git diff --name-only "$BASE..$LOCAL_SHA" 2>/dev/null || true)"
fi

if [ -z "$FILES" ]; then
  # Fallback: files in HEAD commit only
  FILES="$(git diff-tree --no-commit-id --name-only -r "$LOCAL_SHA" 2>/dev/null || true)"
fi

if [ -z "$FILES" ]; then
  log_event "no files diff for $BRANCH, skipping"
  exit 0
fi

FILE_COUNT="$(echo "$FILES" | grep -c . || echo 0)"
log_event "scope-checking $FILE_COUNT files on $BRANCH against agent registry"

# Delegate to pm-push-control.mjs scope-check (does the heavy globbing)
if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  node not in PATH — skipping scope-check"
  exit 0
fi

# Pipe files as stdin
set +e
echo "$FILES" | node "$REPO_ROOT/scripts/pm-push-control.mjs" scope-check "$BRANCH"
EXIT_CODE=$?
set -e

# pm-push-control returns 0 on pass/warn (unless strict mode is set, then 1 = abort)
# In default warn mode, this hook never blocks.
exit $EXIT_CODE
