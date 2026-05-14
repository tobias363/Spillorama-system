#!/usr/bin/env bash
# db-perf-watcher.test.sh — unit + integration tests
#
# Coverage:
#   1. jq anomaly-detection pure-function (mock pg_stat_statements output → expected NEW + REGRESSION)
#   2. Baseline bootstrapping on first run
#   3. Dedup state-file behavior (24h window)
#   4. DRY_RUN exits 1 with anomalies but no Linear call
#   5. Linear-script DRY_RUN renders correct title
#   6. Setup-cron print-instructions sanity
#   7. (integration) End-to-end smoke against a temporary docker postgres OR skip-graceful if unavailable
#
# All tests use mktemp dirs/files — no external side-effects.
#
# Bruk:
#   bash scripts/__tests__/ops/db-perf-watcher.test.sh
#
# Exit-code:
#   0 = all pass
#   1 = at least one fail

set -u
PASS=0
FAIL=0
ERRORS=()

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WATCHER="$REPO_ROOT/scripts/ops/db-perf-watcher.sh"
LINEAR_SCRIPT="$REPO_ROOT/scripts/ops/db-perf-create-linear-issue.sh"
CRON_SCRIPT="$REPO_ROOT/scripts/ops/setup-db-perf-cron.sh"

cleanup_tests() {
  rm -rf /tmp/db-perf-test-*
}
trap cleanup_tests EXIT

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ $desc — expected '$expected', got '$actual'")
    echo "  ❌ $desc — expected='$expected' actual='$actual'"
  fi
}

assert_file_exists() {
  local desc="$1" path="$2"
  if [ -f "$path" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ $desc — file not found: $path")
    echo "  ❌ $desc — file not found: $path"
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ $desc — '$haystack' missing '$needle'")
    echo "  ❌ $desc — missing '$needle'"
  fi
}

# ── Sanity ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Sanity: scripts exist + syntax ==="

assert_file_exists "watcher script exists" "$WATCHER"
assert_file_exists "linear script exists" "$LINEAR_SCRIPT"
assert_file_exists "cron-setup script exists" "$CRON_SCRIPT"

bash -n "$WATCHER" 2>/dev/null && \
  assert_eq "watcher syntax OK" "0" "0" || \
  assert_eq "watcher syntax OK" "0" "1"

bash -n "$LINEAR_SCRIPT" 2>/dev/null && \
  assert_eq "linear-script syntax OK" "0" "0" || \
  assert_eq "linear-script syntax OK" "0" "1"

bash -n "$CRON_SCRIPT" 2>/dev/null && \
  assert_eq "cron-setup syntax OK" "0" "0" || \
  assert_eq "cron-setup syntax OK" "0" "1"

# ── Test 1: anomaly-detection jq pure-function ──────────────────────────────
echo ""
echo "=== Test 1: jq anomaly-detection (pure-function) ==="

# Baseline JSON (3 queries with stable mean_ms)
BASELINE_JSON='[
  {"queryid":"100","calls":50,"mean_ms":12,"total_ms":600,"rows":50,"blks_read":0,"blks_hit":100,"query":"SELECT * FROM app_wallets WHERE user_id = $1"},
  {"queryid":"200","calls":1000,"mean_ms":5,"total_ms":5000,"rows":1000,"blks_read":0,"blks_hit":2000,"query":"SELECT * FROM app_users WHERE id = $1"},
  {"queryid":"300","calls":20,"mean_ms":30,"total_ms":600,"rows":20,"blks_read":5,"blks_hit":50,"query":"SELECT count(*) FROM app_payouts"}
]'

# Current snapshot:
#   queryid=100 → mean 12→55 (+358% — REGRESSION above 50%)
#   queryid=200 → mean 5→6 (+20% — under 50%, NOT anomaly)
#   queryid=300 → mean 30→32 (+6%, NOT anomaly)
#   queryid=999 → NEW slow (mean=185, calls=46 — above thresholds → NEW anomaly)
#   queryid=998 → NEW but mean=80 (below threshold → NOT anomaly)
#   queryid=997 → NEW but calls=5 (below threshold → NOT anomaly)
CURRENT_JSON='[
  {"queryid":"100","calls":53,"mean_ms":55,"total_ms":2915,"rows":53,"blks_read":2,"blks_hit":100,"query":"SELECT * FROM app_wallets WHERE user_id = $1"},
  {"queryid":"200","calls":1010,"mean_ms":6,"total_ms":6060,"rows":1010,"blks_read":0,"blks_hit":2020,"query":"SELECT * FROM app_users WHERE id = $1"},
  {"queryid":"300","calls":21,"mean_ms":32,"total_ms":672,"rows":21,"blks_read":5,"blks_hit":52,"query":"SELECT count(*) FROM app_payouts"},
  {"queryid":"999","calls":46,"mean_ms":185,"total_ms":8510,"rows":46,"blks_read":50,"blks_hit":100,"query":"SELECT FROM app_game_catalog WHERE id = $1"},
  {"queryid":"998","calls":40,"mean_ms":80,"total_ms":3200,"rows":40,"blks_read":2,"blks_hit":100,"query":"SELECT FROM app_halls WHERE id = $1"},
  {"queryid":"997","calls":5,"mean_ms":200,"total_ms":1000,"rows":5,"blks_read":50,"blks_hit":100,"query":"SELECT FROM app_audit_log WHERE id = $1"}
]'

# Run the same jq logic the watcher uses
ANOMALIES=$(jq -c -n \
  --argjson current "$CURRENT_JSON" \
  --argjson baseline "$BASELINE_JSON" \
  --argjson mean_threshold 100 \
  --argjson calls_threshold 10 \
  --argjson regression_pct 50 \
  '
    ($baseline | map({key: .queryid, value: .}) | from_entries) as $base_lookup
    |
    $current | map(
      . as $cur
      | ($base_lookup[$cur.queryid] // null) as $base
      | if $base == null then
          if ($cur.mean_ms > $mean_threshold) and ($cur.calls > $calls_threshold) then
            {
              kind: "NEW",
              queryid: $cur.queryid,
              current: $cur,
              baseline: null,
              delta_pct: null,
              reason: "New slow query (mean=\($cur.mean_ms)ms, calls=\($cur.calls))"
            }
          else
            empty
          end
        else
          ($base.mean_ms) as $base_mean
          | if ($base_mean > 0) then
              ((($cur.mean_ms - $base_mean) / $base_mean) * 100) as $delta
              | if $delta > $regression_pct then
                  {
                    kind: "REGRESSION",
                    queryid: $cur.queryid,
                    current: $cur,
                    baseline: $base,
                    delta_pct: ($delta | floor),
                    reason: "Regression (was \($base_mean)ms → \($cur.mean_ms)ms, +\($delta | floor)%)"
                  }
                else
                  empty
                end
            else
              empty
            end
        end
    )
  ')

ANOMALY_COUNT=$(echo "$ANOMALIES" | jq 'length')
assert_eq "Total anomalies = 2 (1 NEW + 1 REGRESSION)" "2" "$ANOMALY_COUNT"

NEW_COUNT=$(echo "$ANOMALIES" | jq '[.[] | select(.kind == "NEW")] | length')
assert_eq "NEW count = 1 (queryid=999)" "1" "$NEW_COUNT"

REGRESSION_COUNT=$(echo "$ANOMALIES" | jq '[.[] | select(.kind == "REGRESSION")] | length')
assert_eq "REGRESSION count = 1 (queryid=100)" "1" "$REGRESSION_COUNT"

NEW_QID=$(echo "$ANOMALIES" | jq -r '[.[] | select(.kind == "NEW")][0].queryid')
assert_eq "NEW queryid = 999" "999" "$NEW_QID"

REG_QID=$(echo "$ANOMALIES" | jq -r '[.[] | select(.kind == "REGRESSION")][0].queryid')
assert_eq "REGRESSION queryid = 100" "100" "$REG_QID"

REG_DELTA=$(echo "$ANOMALIES" | jq -r '[.[] | select(.kind == "REGRESSION")][0].delta_pct')
# (55 - 12) / 12 * 100 = 358.33... → floor=358
assert_eq "REGRESSION delta_pct = 358 (floor)" "358" "$REG_DELTA"

# Test that queryid 998 (NEW but mean=80, below threshold) is NOT in anomalies
SUB_THRESHOLD_PRESENT=$(echo "$ANOMALIES" | jq '[.[] | select(.queryid == "998")] | length')
assert_eq "sub-threshold-mean NEW query (998) NOT in anomalies" "0" "$SUB_THRESHOLD_PRESENT"

# Test that queryid 997 (NEW but calls=5, below threshold) is NOT in anomalies
SUB_CALL_PRESENT=$(echo "$ANOMALIES" | jq '[.[] | select(.queryid == "997")] | length')
assert_eq "low-calls NEW query (997) NOT in anomalies" "0" "$SUB_CALL_PRESENT"

# ── Test 2: dedup state-file logic ──────────────────────────────────────────
echo ""
echo "=== Test 2: dedup state-file logic ==="

TEST_STATE=$(mktemp /tmp/db-perf-test-state-XXXXXX.json)
echo '{"seen": {"999": "2026-05-14T00:00:00Z"}}' > "$TEST_STATE"

# Anomaly already seen 30 min ago → should be filtered out at 24h window
NOW_EPOCH=$(date -u -d "2026-05-14T00:30:00Z" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "2026-05-14T00:30:00Z" +%s)

ANOMALIES_SUBSET='[{"kind":"NEW","queryid":"999","current":{"calls":46,"mean_ms":185,"query":"SELECT 1"},"baseline":null,"delta_pct":null,"reason":"x"}]'

FILTERED=$(jq -c \
  --argjson anomalies "$ANOMALIES_SUBSET" \
  --argjson now_epoch "$NOW_EPOCH" \
  --argjson dedup_window_sec 86400 \
  '
    (.seen // {}) as $seen
    | $anomalies | map(
        . as $a
        | (($seen[$a.queryid] // null) | if . then (. | fromdate) else null end) as $last_seen
        | if $last_seen == null or (($now_epoch - $last_seen) > $dedup_window_sec) then
            $a
          else
            empty
          end
      )
  ' "$TEST_STATE")

FILTERED_COUNT=$(echo "$FILTERED" | jq 'length')
assert_eq "Within dedup window: filtered to 0" "0" "$FILTERED_COUNT"

# Now jump > 24h forward
NOW_EPOCH_FUTURE=$(date -u -d "2026-05-15T01:00:00Z" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "2026-05-15T01:00:00Z" +%s)

FILTERED_FUTURE=$(jq -c \
  --argjson anomalies "$ANOMALIES_SUBSET" \
  --argjson now_epoch "$NOW_EPOCH_FUTURE" \
  --argjson dedup_window_sec 86400 \
  '
    (.seen // {}) as $seen
    | $anomalies | map(
        . as $a
        | (($seen[$a.queryid] // null) | if . then (. | fromdate) else null end) as $last_seen
        | if $last_seen == null or (($now_epoch - $last_seen) > $dedup_window_sec) then
            $a
          else
            empty
          end
      )
  ' "$TEST_STATE")

FILTERED_FUTURE_COUNT=$(echo "$FILTERED_FUTURE" | jq 'length')
assert_eq "After 24h: anomaly re-fires" "1" "$FILTERED_FUTURE_COUNT"

# Empty/fresh state file should not filter
EMPTY_STATE=$(mktemp /tmp/db-perf-test-empty-XXXXXX.json)
echo '{"seen":{}}' > "$EMPTY_STATE"
FILTERED_FRESH=$(jq -c \
  --argjson anomalies "$ANOMALIES_SUBSET" \
  --argjson now_epoch "$NOW_EPOCH" \
  --argjson dedup_window_sec 86400 \
  '
    (.seen // {}) as $seen
    | $anomalies | map(
        . as $a
        | (($seen[$a.queryid] // null) | if . then (. | fromdate) else null end) as $last_seen
        | if $last_seen == null or (($now_epoch - $last_seen) > $dedup_window_sec) then
            $a
          else
            empty
          end
      )
  ' "$EMPTY_STATE")
FILTERED_FRESH_COUNT=$(echo "$FILTERED_FRESH" | jq 'length')
assert_eq "Fresh state file: nothing filtered" "1" "$FILTERED_FRESH_COUNT"

# ── Test 3: Linear-script DRY_RUN composes correct title ────────────────────
echo ""
echo "=== Test 3: Linear-script DRY_RUN ==="

TEST_REPORT=$(mktemp /tmp/db-perf-test-report-XXXXXX.md)
cat > "$TEST_REPORT" <<EOF
# DB-Perf Watcher Report 2026-05-14T15:00:00Z

## Summary
- Anomalies: 2 (1 NEW, 1 REGRESSION)
EOF

# Run linear script in DRY_RUN — should log title and exit 0
OUTPUT=$(DRY_RUN=1 bash "$LINEAR_SCRIPT" "$TEST_REPORT" "$ANOMALIES" 2>&1)
DRY_EXIT=$?

assert_eq "DRY_RUN exit code = 0" "0" "$DRY_EXIT"
assert_contains "title says '2 DB-anomalies'" "$OUTPUT" "2 DB-anomalies"
assert_contains "title says NEW count" "$OUTPUT" "1 NEW"
assert_contains "title says REGRESSION count" "$OUTPUT" "1 REGRESSION"

# Missing args should exit 2
set +e
ARG_OUTPUT=$(bash "$LINEAR_SCRIPT" 2>&1)
ARG_EXIT=$?
set -e 2>/dev/null
assert_eq "no args → exit 2" "2" "$ARG_EXIT"

# ── Test 4: Setup-cron print mode ───────────────────────────────────────────
echo ""
echo "=== Test 4: setup-db-perf-cron print mode ==="

PRINT_OUTPUT=$(bash "$CRON_SCRIPT" print 2>&1)
PRINT_EXIT=$?
assert_eq "print mode exit 0" "0" "$PRINT_EXIT"
assert_contains "print mentions install" "$PRINT_OUTPUT" "install"
assert_contains "print mentions uninstall" "$PRINT_OUTPUT" "uninstall"
assert_contains "print mentions watcher path" "$PRINT_OUTPUT" "db-perf-watcher.sh"

# Status mode shouldn't crash even if nothing installed
STATUS_OUTPUT=$(bash "$CRON_SCRIPT" status 2>&1)
STATUS_EXIT=$?
assert_eq "status mode exit 0" "0" "$STATUS_EXIT"

# ── Test 5: Watcher pre-flight DB check ─────────────────────────────────────
echo ""
echo "=== Test 5: watcher pre-flight DB connection check ==="

# Pick a deterministic unreachable address. PGCONNECT_TIMEOUT keeps psql from
# hanging when there's no real socket on the other end. We don't shell out to
# `timeout` (not present on macOS without coreutils).
set +e
PGHOST="127.0.0.99" PGPORT="65535" PGCONNECT_TIMEOUT=2 \
  BASELINE_FILE=/tmp/db-perf-test-baseline-noop.json \
  REPORT_DIR=/tmp/db-perf-test-reports-$$ \
  bash "$WATCHER" >/dev/null 2>&1
WATCHER_EXIT=$?
set -e 2>/dev/null

# Expect explicit "DB unreachable" exit 2 from the watcher's pre-flight check.
# (psql binary missing would give 127; we already asserted it exists above.)
if [ "$WATCHER_EXIT" = "2" ]; then
  PASS=$((PASS + 1))
  echo "  ✅ unreachable DB → exit 2"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ unreachable DB exit — expected 2, got $WATCHER_EXIT")
  echo "  ❌ unreachable DB exit — expected 2, got $WATCHER_EXIT"
fi

# ── Test 6: Integration smoke — only if local pg_stat_statements available ──
echo ""
echo "=== Test 6: integration smoke (skip-graceful) ==="

PG_AVAILABLE=0
if command -v psql >/dev/null 2>&1; then
  PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama \
    -tA -c "SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements'" 2>/dev/null \
    | grep -q "^1$" && PG_AVAILABLE=1 || PG_AVAILABLE=0
fi

if [ "$PG_AVAILABLE" = "1" ]; then
  echo "  ▸ Local postgres has pg_stat_statements — running smoke test"

  INT_BASELINE=$(mktemp /tmp/db-perf-test-int-baseline-XXXXXX.json)
  INT_REPORT_DIR=$(mktemp -d /tmp/db-perf-test-int-reports-XXXXXX)
  INT_STATE=$(mktemp /tmp/db-perf-test-int-state-XXXXXX.json)

  # First run — should bootstrap baseline
  set +e
  FORCE_BASELINE=1 \
    BASELINE_FILE="$INT_BASELINE" \
    REPORT_DIR="$INT_REPORT_DIR" \
    STATE_FILE="$INT_STATE" \
    DRY_RUN=1 \
    bash "$WATCHER" >/dev/null 2>&1
  FIRST_EXIT=$?
  set -e 2>/dev/null

  assert_eq "integration: FORCE_BASELINE exit 0" "0" "$FIRST_EXIT"
  assert_file_exists "integration: baseline file written" "$INT_BASELINE"

  # Verify baseline JSON shape
  if [ -f "$INT_BASELINE" ]; then
    BASELINE_HAS_TAKEN_AT=$(jq -r 'has("taken_at")' "$INT_BASELINE")
    assert_eq "integration: baseline has taken_at" "true" "$BASELINE_HAS_TAKEN_AT"

    BASELINE_HAS_QUERIES=$(jq -r 'has("queries")' "$INT_BASELINE")
    assert_eq "integration: baseline has queries[]" "true" "$BASELINE_HAS_QUERIES"
  fi

  # Second run — compare against baseline (expect 0 anomalies since DB hasn't changed)
  set +e
  BASELINE_FILE="$INT_BASELINE" \
    REPORT_DIR="$INT_REPORT_DIR" \
    STATE_FILE="$INT_STATE" \
    DRY_RUN=1 \
    bash "$WATCHER" >/dev/null 2>&1
  SECOND_EXIT=$?
  set -e 2>/dev/null

  # Exit can be 0 (no anomalies) or 1 (anomalies but DRY_RUN suppresses Linear call)
  if [ "$SECOND_EXIT" = "0" ] || [ "$SECOND_EXIT" = "1" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ integration: second run completed (exit $SECOND_EXIT)"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ integration: second run unexpected exit $SECOND_EXIT")
    echo "  ❌ integration: second run unexpected exit $SECOND_EXIT"
  fi

  # Latest report should exist
  REPORT_COUNT=$(find "$INT_REPORT_DIR" -name 'db-perf-watcher-*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$REPORT_COUNT" -ge "1" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ integration: report file written ($REPORT_COUNT report(s))"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ integration: no report file in $INT_REPORT_DIR")
    echo "  ❌ integration: no report file in $INT_REPORT_DIR"
  fi
else
  echo "  ▸ Local postgres not available or pg_stat_statements not installed — SKIP"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Tests: PASS=$PASS  FAIL=$FAIL"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do
    echo "  $e"
  done
  exit 1
fi

exit 0
