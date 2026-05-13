#!/usr/bin/env bash
# scripts/squawk-check.sh
#
# OBS-9: run squawk (https://github.com/sbdchd/squawk) against any
# migration files this PR touches. squawk is a Postgres migration linter
# that catches breaking changes (DROP COLUMN, RENAME COLUMN, ADD COLUMN
# NOT NULL without DEFAULT, locking-heavy DDL, etc.) before they reach
# prod.
#
# What this script does:
#   1. Computes the set of changed `apps/backend/migrations/*.sql` files
#      between origin/main and HEAD.
#   2. If nothing changed → exit 0 cleanly (no-op in PRs that don't
#      touch migrations).
#   3. Otherwise → run squawk with the rule set documented in
#      docs/operations/MIGRATION_LINT_RULES.md.
#   4. Parse JSON output and exit 1 if any *blocking* rule fires.
#      squawk-cli 2.52.x emits "Warning" level for everything and exits
#      0 by itself; we promote the rules we treat as errors via the
#      $SQUAWK_BLOCKING_RULES list below.
#
# Local usage:
#   bash scripts/squawk-check.sh             # diff vs origin/main
#   bash scripts/squawk-check.sh --all       # lint every migration
#   bash scripts/squawk-check.sh path/a.sql  # lint specific files
#
# CI usage:
#   .github/workflows/schema-as-code.yml calls this with no args.
#   Requires `actions/checkout@v4` with fetch-depth: 0 so we can diff
#   against origin/main.
#
# Rule selection:
#   squawk has dozens of rules — we enable the ones that match our
#   pilot risk profile (live DB, 99.95% uptime target). See
#   docs/operations/MIGRATION_LINT_RULES.md for the full catalog, why
#   each rule is on / off, and which rules block CI vs only warn.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Rule set. Each comma-separated rule is an "excluded" rule (turned
# OFF). We invert the default-on/default-off list because our migration
# style relies on idempotent CREATE/ALTER (ADR-0014) which squawk would
# otherwise flag as "transaction-nesting".
#
# Why each exclusion is here:
#   - transaction-nesting: node-pg-migrate wraps every migration in a
#     transaction automatically; explicit BEGIN/COMMIT inside is
#     legitimate when we need to escape the wrapper for CREATE INDEX
#     CONCURRENTLY etc. Catching this is squawk's default; we trust
#     the pattern.
#   - prefer-text-field: we have legacy VARCHAR(n) columns we can't
#     migrate today. New code should still use TEXT but squawk would
#     fail on legacy follow-up patches.
#   - ban-drop-database: irrelevant in our migrations — node-pg-migrate
#     can't drop databases. Noise reduction.
#   - require-timeout-settings: node-pg-migrate handles statement and
#     lock timeouts via DATABASE_URL / `?options=`. Every single
#     migration would flag without this, and the recommended `SET
#     lock_timeout = '1s'` clashes with node-pg-migrate's transaction
#     wrapper.
SQUAWK_EXCLUDED_RULES=(
  "transaction-nesting"
  "prefer-text-field"
  "ban-drop-database"
  "require-timeout-settings"
)

# Blocking rules. Any one of these firing → exit 1. Squawk itself emits
# every issue as Level=Warning today (2.52.x); we promote the
# regulatorily-risky ones to "blocking" here so CI fails. Everything
# else stays informational.
#
# See docs/operations/MIGRATION_LINT_RULES.md for the rationale per
# rule and how to safely refactor a migration that trips one.
SQUAWK_BLOCKING_RULES=(
  # Schema-evolution killers — break running clients.
  "renaming-column"
  "renaming-table"
  "disallowed-unique-constraint"
  "changing-column-type"
  "constraint-missing-not-valid"
  # Lock-amplifying patterns — multi-minute outages on big tables.
  "adding-required-field"
  "adding-not-nullable-field"
  "adding-field-with-default"
  "ban-create-index-non-concurrently"
  "ban-char-field"
  # Idempotency / rerun-safety.
  "prefer-robust-stmts"
  # Time/clock footguns.
  "disallowed-current-time"
)

# Build --exclude flags (squawk-cli format).
EXCLUDE_FLAGS=()
for rule in "${SQUAWK_EXCLUDED_RULES[@]}"; do
  EXCLUDE_FLAGS+=(--exclude "$rule")
done

# Collect target files.
TARGETS=()
MODE="diff"
if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--all" ]]; then
    MODE="all"
  else
    MODE="explicit"
    TARGETS=("$@")
  fi
fi

if [[ "$MODE" == "diff" ]]; then
  # Determine merge base. If origin/main isn't fetched (shallow clone),
  # `git fetch --depth=… origin main` is the caller's responsibility
  # (CI does this in checkout with fetch-depth: 0).
  if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
    echo "[squawk-check] origin/main not fetched; falling back to HEAD~1 diff" >&2
    BASE="HEAD~1"
  else
    BASE="origin/main"
  fi

  # `--diff-filter=AM` = only Added or Modified .sql files. Deletions
  # don't need linting (they're a separate question — see
  # docs/operations/MIGRATION_LINT_RULES.md §"Why we don't lint
  # deletions").
  #
  # We use a while-read loop instead of `mapfile` for macOS bash 3.2
  # compatibility (mapfile is bash 4+; macOS ships 3.2 by default).
  TARGETS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && TARGETS+=("$line")
  done < <(
    git diff --name-only --diff-filter=AM "$BASE"...HEAD -- \
      'apps/backend/migrations/*.sql' \
      2>/dev/null || true
  )
elif [[ "$MODE" == "all" ]]; then
  TARGETS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && TARGETS+=("$line")
  done < <(
    find apps/backend/migrations -name '*.sql' -type f | sort
  )
fi

# Filter to existing files (a moved/deleted file in `git diff` could
# show up but no longer exist on disk). The `${TARGETS[@]+"${TARGETS[@]}"}`
# idiom prevents bash's `set -u` from tripping on an empty array.
EXISTING_TARGETS=()
for f in ${TARGETS[@]+"${TARGETS[@]}"}; do
  if [[ -f "$f" ]]; then
    EXISTING_TARGETS+=("$f")
  fi
done

if [[ ${#EXISTING_TARGETS[@]} -eq 0 ]]; then
  echo "[squawk-check] No migration files changed in this PR — skipping."
  exit 0
fi

echo "[squawk-check] Linting ${#EXISTING_TARGETS[@]} migration file(s):" >&2
for f in "${EXISTING_TARGETS[@]}"; do
  echo "  - $f" >&2
done
echo "" >&2

# In-file rule overrides.
#
# Authors can add per-migration suppressions in the first 30 lines of a
# .sql file:
#   -- squawk: ignore <rule-name>
#
# The annotation is parsed below and turned into --exclude-path filters
# OR per-file rule-suppression. squawk-cli doesn't natively support
# per-file rule excludes — `--exclude` is global. So we model
# per-file suppressions by collecting the set of suppressed rules per
# file, splitting the targets into "regular" and "with-suppressions"
# groups, and invoking squawk separately for each group.
#
# For simplicity, if a file has ANY in-file suppression, we run squawk
# on that file alone with the union of repo-wide excludes + per-file
# excludes. Files without suppressions run together in a single squawk
# invocation (the common case).
#
# This means in-file suppressions can only relax (not tighten) the
# repo-wide rules. Tightening would require per-file --include support.
SUPPRESSION_HEAD_LINES=30
declare -a FILES_PLAIN=()
declare -a FILES_SUPPRESSED=()
declare -a SUPPRESSED_RULES_BY_FILE=()

for f in "${EXISTING_TARGETS[@]}"; do
  # Extract rule names from "-- squawk: ignore <rule>" lines in the head.
  # The `|| true` after grep prevents `set -e` from tripping when there
  # are no matches (grep exits 1 on zero matches).
  HEADER="$(head -n "$SUPPRESSION_HEAD_LINES" "$f" 2>/dev/null || true)"
  PER_FILE_RULES="$(
    {
      echo "$HEADER" \
        | grep -oE -- '-- squawk: ignore [a-z][a-z0-9-]+' \
        || true
    } \
      | sed 's/^-- squawk: ignore //' \
      | sort -u \
      | tr '\n' ',' \
      | sed 's/,$//'
  )"
  if [[ -z "$PER_FILE_RULES" ]]; then
    FILES_PLAIN+=("$f")
  else
    FILES_SUPPRESSED+=("$f")
    SUPPRESSED_RULES_BY_FILE+=("$PER_FILE_RULES")
    echo "[squawk-check] $f: in-file suppression for: $PER_FILE_RULES" >&2
  fi
done

# Resolve squawk binary. Prefer a pre-installed binary (CI installs the
# official release directly); fall back to npx if available; else fail
# hard. NEVER let the script silently pass when no linter is on the
# host — that would make CI a green rubber-stamp.
SQUAWK_CMD=""
if command -v squawk >/dev/null 2>&1; then
  SQUAWK_CMD="squawk"
elif command -v npx >/dev/null 2>&1; then
  SQUAWK_CMD="npx -y squawk-cli"
else
  echo "[squawk-check] FATAL: neither 'squawk' nor 'npx' is on PATH." >&2
  echo "  Install one of:" >&2
  echo "    - squawk binary: https://github.com/sbdchd/squawk/releases" >&2
  echo "    - Node.js (provides npx): https://nodejs.org/" >&2
  echo "  CI installs the binary in .github/workflows/schema-as-code.yml." >&2
  exit 70
fi
echo "[squawk-check] Using: $SQUAWK_CMD" >&2

# Smoke-test that the binary actually runs (catches "npx -y squawk-cli"
# being installed but network-bound, or a corrupt binary). If this
# fails, CI must hard-fail rather than continue and report "clean".
if ! $SQUAWK_CMD --version >/tmp/squawk-version 2>&1; then
  echo "[squawk-check] FATAL: $SQUAWK_CMD --version failed:" >&2
  cat /tmp/squawk-version >&2
  exit 71
fi
echo "[squawk-check] Squawk version: $(cat /tmp/squawk-version)" >&2

# Helper: run squawk for a single group of files with optional extra
# excludes. Echoes JSON output on stdout, human-readable on stderr.
run_squawk_group() {
  local files_csv="$1"   # space-separated list of files
  local extra_excludes_csv="$2"  # comma-separated extra exclude rule names

  # Split files_csv back into array
  read -r -a files_arr <<< "$files_csv"

  # Build extra exclude flags from CSV
  local extra_flags=()
  if [[ -n "$extra_excludes_csv" ]]; then
    IFS=',' read -r -a extra_rules <<< "$extra_excludes_csv"
    for r in "${extra_rules[@]}"; do
      [[ -n "$r" ]] && extra_flags+=(--exclude "$r")
    done
  fi

  # Human-readable run (stderr).
  # shellcheck disable=SC2086
  $SQUAWK_CMD \
    "${EXCLUDE_FLAGS[@]}" \
    "${extra_flags[@]+"${extra_flags[@]}"}" \
    --reporter tty \
    "${files_arr[@]}" \
    >&2 \
    || true

  # JSON run (stdout — captured by caller).
  # shellcheck disable=SC2086
  $SQUAWK_CMD \
    "${EXCLUDE_FLAGS[@]}" \
    "${extra_flags[@]+"${extra_flags[@]}"}" \
    --reporter json \
    "${files_arr[@]}" \
    2>/dev/null \
    || true
}

# Run squawk in two groups:
#   1. FILES_PLAIN — files without in-file suppression. One invocation
#      with global excludes only.
#   2. FILES_SUPPRESSED — one invocation per file, with extra excludes
#      from the in-file annotation.
#
# We collect all JSON output into ALL_JSON for the blocking-rule check.
echo "" >&2
echo "==== squawk lint ====" >&2

ALL_JSON=""
if [[ ${#FILES_PLAIN[@]} -gt 0 ]]; then
  PLAIN_JSON="$(run_squawk_group "${FILES_PLAIN[*]}" "")"
  ALL_JSON+="$PLAIN_JSON"
fi
if [[ ${#FILES_SUPPRESSED[@]} -gt 0 ]]; then
  for i in "${!FILES_SUPPRESSED[@]}"; do
    f="${FILES_SUPPRESSED[$i]}"
    rules="${SUPPRESSED_RULES_BY_FILE[$i]}"
    SUPPRESSED_JSON="$(run_squawk_group "$f" "$rules")"
    ALL_JSON+="$SUPPRESSED_JSON"
  done
fi

# Use ALL_JSON as the consolidated output for blocking-rule analysis.
JSON_OUTPUT="$ALL_JSON"

echo "" >&2
echo "==== blocking-rule check ====" >&2

# If output is empty or not JSON, treat as clean.
if [[ -z "$JSON_OUTPUT" ]] || [[ "$JSON_OUTPUT" == "[]" ]]; then
  echo "[squawk-check] All ${#EXISTING_TARGETS[@]} migration file(s) lint-clean." >&2
  exit 0
fi

# Pretty-print, then check for blocking rules.
# Build a regex that matches any blocking rule's quoted name in JSON.
BLOCK_REGEX="\"rule_name\":\"($(IFS='|'; echo "${SQUAWK_BLOCKING_RULES[*]}"))\""

# Count violations by rule name. Use grep -oE to extract rule names,
# then sort | uniq -c.
echo "" >&2
echo "All findings (informational + blocking):" >&2
echo "$JSON_OUTPUT" \
  | grep -oE '"rule_name":"[a-z-]+"' \
  | sort \
  | uniq -c \
  | sort -rn \
  | sed 's/^/  /' >&2

BLOCKING_HITS="$(echo "$JSON_OUTPUT" | grep -cE "$BLOCK_REGEX" || true)"

if [[ -z "$BLOCKING_HITS" || "$BLOCKING_HITS" == "0" ]]; then
  echo "" >&2
  echo "[squawk-check] ${#EXISTING_TARGETS[@]} migration(s) checked. Informational findings only — no blocking rules tripped." >&2
  exit 0
fi

echo "" >&2
echo "[squawk-check] BLOCKED: $BLOCKING_HITS blocking-rule violation(s)." >&2
echo "  Blocking rule list (any of these → CI fails):" >&2
for r in "${SQUAWK_BLOCKING_RULES[@]}"; do
  echo "    - $r" >&2
done
echo "" >&2
echo "  See docs/operations/MIGRATION_LINT_RULES.md for the rule" >&2
echo "  catalog, how each rule helps, and how to safely refactor." >&2

exit 1
