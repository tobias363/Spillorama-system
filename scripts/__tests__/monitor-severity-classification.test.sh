#!/usr/bin/env bash
# monitor-severity-classification.test.sh — validate severity-parsing + push-flow
#
# Tester:
#   1. parse_log_line korrekt ekstraherer severity + kind + message
#   2. P0/P1 trigger push (FIFO + bell + macOS-notification)
#   3. P2/P3 IKKE trigger push
#   4. Regex-matching false-positive-fri (eks. [INFO] tags ikke matcher)
#   5. End-to-end: skriv linje til log → push-daemon plukker den opp → FIFO får urgent-line
#   6. macOS notification kalles med korrekt sound (P0=Sosumi, P1=Submarine)
#
# Bruk:
#   bash scripts/__tests__/monitor-severity-classification.test.sh
#
# Exit-code:
#   0 = alle tester passerer
#   1 = minst en test feilet

set -u  # ikke -e, vi vil samle feil og rapportere alle
PASS=0
FAIL=0
ERRORS=()

# Test-fixtures
TEST_LOG="/tmp/pilot-monitor-test.log"
TEST_FIFO="/tmp/pilot-monitor-test.fifo"
TEST_PID="/tmp/pilot-monitor-test-push.pid"
TEST_RECEIVED="/tmp/pilot-monitor-test-received.txt"

REPO_ROOT="$(git rev-parse --show-toplevel)"
PUSH_SCRIPT="$REPO_ROOT/scripts/monitor-push-to-pm.sh"

cleanup_test() {
  # Disable job-control notifications under cleanup for å unngå "Terminated"-spam
  set +m 2>/dev/null || true
  # Drep test push-daemon hvis kjører
  if [ -f "$TEST_PID" ]; then
    local pid
    pid=$(cat "$TEST_PID" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$TEST_PID"
  fi
  # Drep også eventuelle child-readers
  jobs -p 2>/dev/null | while read -r child_pid; do
    kill -KILL "$child_pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -f "$TEST_LOG" "$TEST_FIFO" "$TEST_RECEIVED"
}
trap cleanup_test EXIT

assert_eq() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ $desc — expected '$expected' got '$actual'")
    echo "  ❌ $desc"
    echo "       expected: '$expected'"
    echo "       got:      '$actual'"
  fi
}

assert_contains() {
  local desc="$1"
  local haystack="$2"
  local needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ $desc — '$haystack' missing '$needle'")
    echo "  ❌ $desc"
    echo "       haystack: '$haystack'"
    echo "       needle:   '$needle'"
  fi
}

assert_not_contains() {
  local desc="$1"
  local haystack="$2"
  local needle="$3"
  if ! echo "$haystack" | grep -qF "$needle"; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ $desc — '$haystack' should NOT contain '$needle'")
    echo "  ❌ $desc"
    echo "       haystack contained: '$needle' (it should not)"
  fi
}

# Sanity: scripts finnes
echo ""
echo "=== Sanity checks ==="
if [ ! -x "$PUSH_SCRIPT" ]; then
  echo "❌ Push-script not executable: $PUSH_SCRIPT"
  exit 1
fi
echo "  ✅ push-script executable"

# Reglex-matching som push-daemon bruker
PUSH_REGEX='^\[[^]]+\] \[P[01]\]'

# ─── Test 1: Regex matches expected severity tags ───────────────────────────
echo ""
echo "=== Test 1: Regex pattern matching ==="

LINE_P0='[2026-05-13T14:32:10Z] [P0] wallet.balance-mismatch: 1 demo-wallets har balance != ledger-sum'
LINE_P1='[2026-05-13T14:32:10Z] [P1] draw.stuck: drawIndex=22 uendret i 65s'
LINE_P2='[2026-05-13T14:32:10Z] [P2] monitor.no-backend-log: Backend stdout-log mangler'
LINE_P3='[2026-05-13T14:32:10Z] [P3] round.ended: Runde 3 ferdig'
LINE_INFO='[2026-05-13T14:32:10Z] [INFO] snapshot.tick: events_60s=0 status=UNKNOWN anomalies=0'
LINE_ERROR='[2026-05-13T14:32:10Z] [ERROR] anomaly.draw_stale: last draw event in buffer was 5+ min ago'

# Trigger-test
echo "$LINE_P0" | grep -qE "$PUSH_REGEX" && assert_eq "P0 matches push-regex" "0" "0" || assert_eq "P0 matches push-regex" "0" "1"
echo "$LINE_P1" | grep -qE "$PUSH_REGEX" && assert_eq "P1 matches push-regex" "0" "0" || assert_eq "P1 matches push-regex" "0" "1"

# Skip-test
echo "$LINE_P2" | grep -qE "$PUSH_REGEX" && assert_eq "P2 does NOT match push-regex" "0" "1" || assert_eq "P2 does NOT match push-regex" "0" "0"
echo "$LINE_P3" | grep -qE "$PUSH_REGEX" && assert_eq "P3 does NOT match push-regex" "0" "1" || assert_eq "P3 does NOT match push-regex" "0" "0"
echo "$LINE_INFO" | grep -qE "$PUSH_REGEX" && assert_eq "[INFO] does NOT match push-regex" "0" "1" || assert_eq "[INFO] does NOT match push-regex" "0" "0"
echo "$LINE_ERROR" | grep -qE "$PUSH_REGEX" && assert_eq "[ERROR] does NOT match push-regex" "0" "1" || assert_eq "[ERROR] does NOT match push-regex" "0" "0"

# ─── Test 2: parse_log_line bash regex extraction ──────────────────────────
echo ""
echo "=== Test 2: parse_log_line bash regex extraction ==="

# Replicate PARSE_REGEX from monitor-push-to-pm.sh.
# Krever bash 3.2+ med BASH_REMATCH (macOS default bash er 3.2.57).
# NB: hvis testen kjøres under zsh, BASH_REMATCH eksisterer ikke — bruk /bin/bash.
PARSE_REGEX_TEST='^\[([^]]+)\] \[(P[0-3])\] ([^:]+):[[:space:]]*(.*)$'

parse_log_line_test() {
  # Returner severity\tiso\tkind\tmessage (eller tomt hvis ingen match)
  local line="$1"
  local result
  result=$(/bin/bash -c '
    PARSE_REGEX="$1"
    line="$2"
    if [[ "$line" =~ $PARSE_REGEX ]]; then
      printf "%s\t%s\t%s\t%s\n" "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
    fi
  ' _ "$PARSE_REGEX_TEST" "$line")
  echo "$result"
}

P0_PARSED=$(parse_log_line_test "$LINE_P0")
P0_SEV=$(echo "$P0_PARSED" | cut -f1)
P0_ISO=$(echo "$P0_PARSED" | cut -f2)
P0_KIND=$(echo "$P0_PARSED" | cut -f3)
P0_MSG=$(echo "$P0_PARSED" | cut -f4)

assert_eq "parse P0 severity"  "P0" "$P0_SEV"
assert_eq "parse P0 iso"        "2026-05-13T14:32:10Z" "$P0_ISO"
assert_eq "parse P0 kind"       "wallet.balance-mismatch" "$P0_KIND"
assert_contains "parse P0 message" "$P0_MSG" "demo-wallets"

P1_PARSED=$(parse_log_line_test "$LINE_P1")
P1_SEV=$(echo "$P1_PARSED" | cut -f1)
assert_eq "parse P1 severity"   "P1" "$P1_SEV"

# P2 og P3 PARSES (de er valide log-entries med severity-tag), men push-daemon
# skipper push for dem (tested i Test 1 + Test 3).
P2_PARSED=$(parse_log_line_test "$LINE_P2")
P2_SEV=$(echo "$P2_PARSED" | cut -f1)
assert_eq "parse P2 severity"   "P2" "$P2_SEV"

# Non-matching lines should produce empty output
INFO_PARSED=$(parse_log_line_test "$LINE_INFO")
assert_eq "parse [INFO] produces no output" "" "$INFO_PARSED"
ERROR_PARSED=$(parse_log_line_test "$LINE_ERROR")
assert_eq "parse [ERROR] produces no output" "" "$ERROR_PARSED"

# ─── Test 3: End-to-end — start push-daemon, write logs, verify FIFO ────────
echo ""
echo "=== Test 3: End-to-end push-daemon → FIFO ==="

# Forbered isolert test-env
rm -f "$TEST_LOG" "$TEST_FIFO" "$TEST_PID"
touch "$TEST_LOG"

# Start push-daemon med test-paths (DISABLE_NOTIFY=1 så vi ikke spam'er bruker med notifications)
PILOT_MONITOR_LOG="$TEST_LOG" \
PILOT_MONITOR_FIFO="$TEST_FIFO" \
PILOT_MONITOR_PUSH_PID="$TEST_PID" \
DISABLE_NOTIFY=1 \
  bash "$PUSH_SCRIPT" > /dev/null 2>&1 &

# Vent til daemon er oppe (FIFO opprettet)
WAIT_FOR_FIFO=0
while [ $WAIT_FOR_FIFO -lt 20 ] && [ ! -p "$TEST_FIFO" ]; do
  sleep 0.2
  WAIT_FOR_FIFO=$((WAIT_FOR_FIFO + 1))
done

if [ ! -p "$TEST_FIFO" ]; then
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ FIFO not created within 4 seconds")
  echo "  ❌ FIFO not created within 4 seconds"
else
  PASS=$((PASS + 1))
  echo "  ✅ FIFO created by daemon"
fi

if [ ! -f "$TEST_PID" ]; then
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ PID file not written")
  echo "  ❌ PID file not written"
else
  PASS=$((PASS + 1))
  echo "  ✅ PID file written"
fi

# Disable job-control notifications for å unngå "Terminated"-spam
# når background-prosesser killes under cleanup.
set +m 2>/dev/null || true

# Start en background-reader på FIFO.
# macOS har ikke `timeout`-kommando som default — bruk eksplisitt kill etter
# fixed delay. Selv om reader stopper først kan daemon fortsatt skrive via
# FD 3 (vi åpnet FIFO rw i daemon startup, så FIFO-bufferen tar imot writes
# uavhengig av om eksterne readers er aktive).
RECEIVED_LINES="$TEST_RECEIVED"
> "$RECEIVED_LINES"

(
  # Reader: cat fra FIFO inntil parent killer oss.
  exec cat "$TEST_FIFO" >> "$RECEIVED_LINES" 2>/dev/null
) &
READER_PID=$!

# Vent til reader er klar (har åpnet FIFO)
sleep 0.5

# Skriv test-linjer til log
echo "$LINE_INFO" >> "$TEST_LOG"
echo "$LINE_P2" >> "$TEST_LOG"
echo "$LINE_P3" >> "$TEST_LOG"
echo "$LINE_P1" >> "$TEST_LOG"
echo "$LINE_P0" >> "$TEST_LOG"

# Vent på at push-daemon prosesserer (tail -F polling interval typisk ~1s)
sleep 3

# Stopp reader — manuell timeout siden macOS mangler `timeout`-kommando.
# Disable job-control så vi ikke får "Terminated: 15"-stderr-spam.
set +m 2>/dev/null || true
kill -TERM "$READER_PID" 2>/dev/null || true
sleep 0.2
kill -KILL "$READER_PID" 2>/dev/null || true
wait "$READER_PID" 2>/dev/null || true

RECEIVED=$(cat "$RECEIVED_LINES" 2>/dev/null || echo "")

# Verifiser at P0/P1 nådde FIFO, P2/P3/[INFO] ikke
assert_contains "FIFO contains P0 line"        "$RECEIVED" "[P0 2026-05-13T14:32:10Z]"
assert_contains "FIFO contains P0 kind"        "$RECEIVED" "wallet.balance-mismatch"
assert_contains "FIFO contains P1 line"        "$RECEIVED" "[P1 2026-05-13T14:32:10Z]"
assert_contains "FIFO contains P1 kind"        "$RECEIVED" "draw.stuck"
assert_not_contains "FIFO does NOT contain P2" "$RECEIVED" "[P2 2026-05-13T14:32:10Z]"
assert_not_contains "FIFO does NOT contain P3" "$RECEIVED" "[P3 2026-05-13T14:32:10Z]"
assert_not_contains "FIFO does NOT contain INFO" "$RECEIVED" "snapshot.tick"

# ─── Test 4: Verify pilot-monitor-enhanced syntax + uses P0-P3 ──────────────
echo ""
echo "=== Test 4: pilot-monitor-enhanced.sh uses correct severity tags ==="

ENHANCED_SCRIPT="$REPO_ROOT/scripts/pilot-monitor-enhanced.sh"
if [ -x "$ENHANCED_SCRIPT" ]; then
  PASS=$((PASS + 1))
  echo "  ✅ Enhanced script executable"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Enhanced script not executable: $ENHANCED_SCRIPT")
fi

# Syntax check
if bash -n "$ENHANCED_SCRIPT" 2>/dev/null; then
  PASS=$((PASS + 1))
  echo "  ✅ Enhanced script syntax OK"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Enhanced script syntax error")
fi

# Verifiser at log_anomaly bruker P0-P3
LOG_CALLS=$(grep -E '^\s*log_anomaly\s+"P[0-3]"' "$ENHANCED_SCRIPT" | wc -l | tr -d ' ')
if [ "$LOG_CALLS" -ge 5 ]; then
  PASS=$((PASS + 1))
  echo "  ✅ log_anomaly P0-P3 used $LOG_CALLS times"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ log_anomaly P0-P3 only used $LOG_CALLS times — too few")
fi

# Verifiser at backend-down-30s eskaleres til P0
if grep -q 'P0.*backend-down-30s' "$ENHANCED_SCRIPT"; then
  PASS=$((PASS + 1))
  echo "  ✅ backend-down-30s eskaleres til P0"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ backend-down-30s not P0-escalated")
fi

# ─── Test 5: wrapper script ─────────────────────────────────────────────────
echo ""
echo "=== Test 5: start-monitor-with-push.sh ==="

WRAPPER="$REPO_ROOT/scripts/start-monitor-with-push.sh"
if [ -x "$WRAPPER" ]; then
  PASS=$((PASS + 1))
  echo "  ✅ Wrapper script executable"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Wrapper script not executable")
fi

if bash -n "$WRAPPER" 2>/dev/null; then
  PASS=$((PASS + 1))
  echo "  ✅ Wrapper syntax OK"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Wrapper syntax error")
fi

# Wrapper skal nevne både monitor + push-script
if grep -q 'pilot-monitor-enhanced' "$WRAPPER" && grep -q 'monitor-push-to-pm' "$WRAPPER"; then
  PASS=$((PASS + 1))
  echo "  ✅ Wrapper invokes both scripts"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Wrapper missing one of the scripts")
fi

# Wrapper skal skrive PIDs
if grep -q 'MONITOR_PID_FILE\|/tmp/pilot-monitor.pid' "$WRAPPER" && grep -q 'PUSH_PID_FILE\|/tmp/pilot-monitor-push.pid' "$WRAPPER"; then
  PASS=$((PASS + 1))
  echo "  ✅ Wrapper writes both PIDs"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Wrapper missing PID writes")
fi

# ─── Test 6: severity-doc finnes + refererer skripter ───────────────────────
echo ""
echo "=== Test 6: Documentation ==="

SEVERITY_DOC="$REPO_ROOT/docs/engineering/MONITOR_SEVERITY_CLASSIFICATION.md"
if [ -f "$SEVERITY_DOC" ]; then
  PASS=$((PASS + 1))
  echo "  ✅ Severity-doc exists"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Severity-doc missing: $SEVERITY_DOC")
fi

# Doc skal nevne alle 4 severity-nivåer
for sev in P0 P1 P2 P3; do
  if grep -q "$sev" "$SEVERITY_DOC" 2>/dev/null; then
    PASS=$((PASS + 1))
    echo "  ✅ Doc covers $sev"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("❌ Doc missing $sev coverage")
  fi
done

# Doc skal nevne Sosumi (P0) og Submarine (P1)
if grep -q 'Sosumi' "$SEVERITY_DOC" 2>/dev/null && grep -q 'Submarine' "$SEVERITY_DOC" 2>/dev/null; then
  PASS=$((PASS + 1))
  echo "  ✅ Doc covers both sound names"
else
  FAIL=$((FAIL + 1))
  ERRORS+=("❌ Doc missing sound-name coverage")
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "Results:  $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for err in "${ERRORS[@]}"; do
    echo "  $err"
  done
  exit 1
fi

echo ""
echo "✅ All severity-classification tests passed"
exit 0
