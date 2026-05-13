#!/usr/bin/env bash
# Test for .husky/pre-push-agent-scope-check.sh
#
# Setter opp midlertidig registry og tester at hook detekterer scope-creep.
# Bruker --registry via PM_PUSH_CONTROL_REGISTRY env-var siden bash-hooken
# leser fra default-lokasjonen (.claude/active-agents.json).
#
# Kjøres fra repo-rot:
#   bash scripts/__tests__/pre-push-scope-check.test.sh
#
# Exit 0 = alle tester passerer
# Exit 1 = en eller flere tester feilet

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$REPO_ROOT/.husky/pre-push-agent-scope-check.sh"
SCRIPT="$REPO_ROOT/scripts/pm-push-control.mjs"

if [ ! -x "$HOOK" ]; then
  echo "❌ Hook not found or not executable: $HOOK"
  exit 1
fi

if [ ! -f "$SCRIPT" ]; then
  echo "❌ pm-push-control.mjs not found: $SCRIPT"
  exit 1
fi

# Helper: run test with isolation
TMPDIR_BASE="$(mktemp -d)"
trap "rm -rf '$TMPDIR_BASE'" EXIT

PASS=0
FAIL=0

assert() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name  expected='$expected' actual='$actual'"
    FAIL=$((FAIL + 1))
  fi
}

run_hook_with_input() {
  local stdin="$1"
  local env_overrides="$2"
  local registry_path="$3"

  # Mock .claude/active-agents.json by using PM_PUSH_CONTROL_REGISTRY
  # via the underlying pm-push-control.mjs grep-based registry check
  # in the hook.
  #
  # The hook itself uses grep on the canonical .claude/active-agents.json
  # to check if a branch is registered. To isolate tests, we run the
  # underlying scope-check directly via the same node-CLI.

  # NB: the bash hook hardcodes the registry path. For tests, we shortcut
  # by invoking the underlying CLI command which DOES respect --registry.
  echo "$stdin" | env $env_overrides node "$SCRIPT" --registry "$registry_path" scope-check "$BRANCH_FOR_TEST"
  return $?
}

# ─── Test 1: in-scope files pass ────────────────────────────────────────

echo "📋 Test 1: in-scope files pass"
REG1="$TMPDIR_BASE/reg1.json"
node "$SCRIPT" --registry "$REG1" --silent register "t1-id" "feat/t1-branch" "scripts/foo.mjs" "docs/**" >/dev/null 2>&1
BRANCH_FOR_TEST="feat/t1-branch"

OUT=$(echo -e "scripts/foo.mjs\ndocs/bar.md" | node "$SCRIPT" --registry "$REG1" --silent scope-check feat/t1-branch 2>&1)
EC=$?
assert "exit code 0" "0" "$EC"

# ─── Test 2: out-of-scope files warn (exit 0, default) ──────────────────

echo "📋 Test 2: out-of-scope files warn in default mode"
OUT=$(echo "apps/backend/src/evil.ts" | node "$SCRIPT" --registry "$REG1" --silent scope-check feat/t1-branch 2>&1)
EC=$?
assert "exit code 0 (warn mode)" "0" "$EC"
echo "$OUT" | grep -q "scope-creep detected" && assert "stderr contains scope-creep" "yes" "yes" || assert "stderr contains scope-creep" "yes" "no"

# ─── Test 3: out-of-scope files abort in strict mode ────────────────────

echo "📋 Test 3: out-of-scope files abort in strict mode"
OUT=$(echo "apps/backend/src/evil.ts" | PM_PUSH_STRICT_SCOPE=1 node "$SCRIPT" --registry "$REG1" --silent scope-check feat/t1-branch 2>&1)
EC=$?
assert "exit code 1 (strict mode)" "1" "$EC"
echo "$OUT" | grep -q "BLOCKED" && assert "stderr contains BLOCKED" "yes" "yes" || assert "stderr contains BLOCKED" "yes" "no"

# ─── Test 4: unregistered branch passes silently ────────────────────────

echo "📋 Test 4: unregistered branch passes silently"
OUT=$(echo "anything.ts" | node "$SCRIPT" --registry "$REG1" --silent scope-check feat/unknown-branch 2>&1)
EC=$?
assert "exit code 0" "0" "$EC"

# ─── Test 5: bypass env-vars skip the hook itself ──────────────────────

echo "📋 Test 5: bypass env-vars in shell hook"
# Test the bash hook directly with mocked git environment.
# Since git rev-parse won't work in our tempdir context, we test the
# bypass-flag path only.
OUT=$(PM_PUSH_BYPASS=1 bash "$HOOK" </dev/null 2>&1)
EC=$?
assert "PM_PUSH_BYPASS=1 → exit 0" "0" "$EC"
echo "$OUT" | grep -q "bypassed" && assert "stdout indicates bypass" "yes" "yes" || assert "stdout indicates bypass" "yes" "no"

# ─── Test 6: empty file list passes ────────────────────────────────────

echo "📋 Test 6: empty file list passes"
OUT=$(echo "" | node "$SCRIPT" --registry "$REG1" --silent scope-check feat/t1-branch 2>&1)
EC=$?
assert "exit code 0 with empty file list" "0" "$EC"

# ─── Summary ────────────────────────────────────────────────────────────

echo
echo "─── Results ────────────────────────────────────────"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ All tests passed"
  exit 0
else
  echo "  ❌ $FAIL test(s) failed"
  exit 1
fi
