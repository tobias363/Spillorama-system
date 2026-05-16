#!/usr/bin/env bash
# pilot-monitor-enhanced.sh — utvidet monitor med 4 kapasiteter
#
# Tobias-direktiv 2026-05-13: "Denne agenten må ha tilgang til konsoll og
# kunne hele tiden se hva som skjer og rapportere til deg etter endt runde."
#
# Forbedringer over basic-monitor:
#   A. Tail backend stdout fra /tmp/spillorama-backend.log
#   B. Auto-detekt round-end → generer /tmp/pilot-monitor-round-<N>.md
#   C. DB-state polling hvert 30s — flag plan-run vs scheduled-game mismatch
#   D. Proaktiv terminal-bell + macOS-notification ved SEV-P0/P1 anomali
#
# Severity-tags (alle log-entries følger dette skjemaet):
#   [P0] — Regulatorisk eller umiddelbar live-room-stopp
#          Eks: wallet.balance-mismatch, monitor.live-room-down,
#          compliance.audit-mutate, backend-unreachable > 30s
#   [P1] — Funksjonell stuck-state eller repeated error
#          Eks: draw.stuck, health.stale, db.stuck-state,
#          client.error, popup.blocked-repeat, backend.error
#   [P2] — Monitor-internal eller recoverable
#          Eks: monitor.no-backend-log, monitor.backend-unreachable,
#          backend.warn, monitor.snapshot-error
#   [P3] — Informational
#          Eks: round.ended, round.started, gameStatus.change,
#          snapshot.tick, monitor.start
#
# Companion: scripts/monitor-push-to-pm.sh tailer denne log-en og
# pusher P0/P1 til /tmp/pilot-monitor-urgent.fifo + macOS-notification.
#
# Full severity-tabell + anti-mønstre:
#   docs/engineering/MONITOR_SEVERITY_CLASSIFICATION.md
#
# Forutsetning:
#   - Backend kjører på localhost:4000
#   - RESET_TEST_PLAYERS_TOKEN=spillorama-2026-test (default)
#   - psql + PGPASSWORD=spillorama tilgjengelig
#
# Bruk:
#   bash scripts/pilot-monitor-enhanced.sh &
#   # Eller via wrapper som også starter push-daemon:
#   bash scripts/start-monitor-with-push.sh
#   # Eller som agent via Agent({prompt: "<<autonomous-loop>>..."})

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TOKEN="${RESET_TEST_PLAYERS_TOKEN:-spillorama-2026-test}"
PGPASSWORD="${PGPASSWORD:-spillorama}"
export PGPASSWORD

POLL_INTERVAL=5      # sec — debug-events poll
DB_INTERVAL=30       # sec — DB-state poll
STATE_FILE="/tmp/pilot-monitor-state.json"
LOG_FILE="/tmp/pilot-monitor.log"
SNAPSHOT_FILE="/tmp/pilot-monitor-snapshot.md"
ROUND_FILE_PREFIX="/tmp/pilot-monitor-round"
BACKEND_LOG="/tmp/spillorama-backend.log"
LAST_DB_POLL_FILE="/tmp/pilot-monitor-last-db-poll.txt"
LAST_ROUND_GAMEID_FILE="/tmp/pilot-monitor-last-round-gameid.txt"
LAST_EVENT_RECEIVED_AT="/tmp/pilot-monitor-last-receivedAt.txt"

# Init
touch "$LOG_FILE"
[ -f "$LAST_EVENT_RECEIVED_AT" ] || echo "0" > "$LAST_EVENT_RECEIVED_AT"

log_anomaly() {
  local severity="$1"
  local kind="$2"
  local message="$3"
  local iso
  iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$iso] [$severity] $kind: $message" >> "$LOG_FILE"

  # D. Proaktiv varsling for P0/P1
  if [[ "$severity" == "P0" || "$severity" == "P1" ]]; then
    # Terminal-bell
    printf '\a' >&2
    # macOS notification (best-effort, ignore if not on Mac)
    osascript -e "display notification \"$message\" with title \"Pilot Monitor: $severity $kind\"" 2>/dev/null || true
  fi
}

# A. Backend stdout-tail — håndteres som side-prosess
start_backend_tail() {
  if [ ! -f "$BACKEND_LOG" ]; then
    log_anomaly "P2" "monitor.no-backend-log" \
      "Backend stdout-log ($BACKEND_LOG) finnes ikke. dev:nuke må wires til å skrive dit. Skipping backend-tail."
    return
  fi

  # Tail i bakgrunn, filtrer for ERROR/FATAL/Warning/TypeError og logg som anomali
  (
    tail -F "$BACKEND_LOG" 2>/dev/null | while IFS= read -r line; do
      case "$line" in
        *ERROR*|*FATAL*|*"Unhandled"*|*"TypeError"*|*"ReferenceError"*)
          log_anomaly "P1" "backend.error" "${line:0:200}"
          ;;
        *WARN*|*"Warning"*)
          log_anomaly "P2" "backend.warn" "${line:0:200}"
          ;;
      esac
    done
  ) &
  BACKEND_TAIL_PID=$!
  echo "[monitor] backend-tail started (PID $BACKEND_TAIL_PID)" >> "$LOG_FILE"
}

# B. Round-end detection
check_round_end() {
  # Hent siste game1 scheduled-game status fra DB
  local row
  row=$(psql -h localhost -U spillorama -d spillorama -tA -F "|" -c \
    "SELECT id, master_hall_id, status, actual_start_time, actual_end_time
     FROM app_game1_scheduled_games
     WHERE status IN ('running','completed','paused')
     ORDER BY actual_end_time DESC NULLS LAST, created_at DESC
     LIMIT 1" 2>/dev/null || echo "")

  if [ -z "$row" ]; then return; fi

  local game_id=$(echo "$row" | cut -d'|' -f1)
  local hall=$(echo "$row" | cut -d'|' -f2)
  local status=$(echo "$row" | cut -d'|' -f3)
  local start_at=$(echo "$row" | cut -d'|' -f4)
  local end_at=$(echo "$row" | cut -d'|' -f5)

  # Sjekk om det er en NY round-end (vi har ikke rapportert denne enda)
  local last_reported=""
  [ -f "$LAST_ROUND_GAMEID_FILE" ] && last_reported=$(cat "$LAST_ROUND_GAMEID_FILE")

  if [ "$status" = "completed" ] && [ -n "$end_at" ] && [ "$game_id" != "$last_reported" ]; then
    # NY round-end — generer rapport
    local round_num
    round_num=$(ls -1 "${ROUND_FILE_PREFIX}-"*.md 2>/dev/null | wc -l | tr -d ' ')
    round_num=$((round_num + 1))
    local report_file="${ROUND_FILE_PREFIX}-${round_num}.md"

    # Hent events for denne scheduled-game-id
    local events_json
    events_json=$(curl -s "http://localhost:4000/api/_dev/debug/events/tail?token=$TOKEN" 2>/dev/null || echo "{}")

    {
      echo "# Round-End Rapport #$round_num"
      echo ""
      echo "**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      echo "**Scheduled Game ID:** \`$game_id\`"
      echo "**Master Hall:** $hall"
      echo "**Started:** $start_at"
      echo "**Ended:** $end_at"
      echo ""

      # Beregn duration
      local start_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "${start_at%.*}" "+%s" 2>/dev/null || echo "0")
      local end_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "${end_at%.*}" "+%s" 2>/dev/null || echo "0")
      local duration=$((end_epoch - start_epoch))
      echo "**Varighet:** ${duration} sekunder"
      echo ""

      # DB-stats
      echo "## DB-snapshot for denne runden"
      echo ""
      echo "### Bonge-kjøp"
      echo '```'
      psql -h localhost -U spillorama -d spillorama -c \
        "SELECT
           ticket_color,
           COUNT(*) as count,
           SUM(price_cents) as total_cents
         FROM app_game1_tickets
         WHERE scheduled_game_id = '$game_id'
         GROUP BY ticket_color
         ORDER BY ticket_color" 2>&1 | head -20
      echo '```'
      echo ""

      echo "### Trekninger"
      echo '```'
      psql -h localhost -U spillorama -d spillorama -c \
        "SELECT
           drawn_numbers,
           array_length(drawn_numbers, 1) as total
         FROM app_game1_scheduled_games
         WHERE id = '$game_id'" 2>&1 | head -10
      echo '```'
      echo ""

      echo "### Compliance-ledger STAKE-entries"
      echo '```'
      psql -h localhost -U spillorama -d spillorama -c \
        "SELECT event_type, hall_id, game_type, channel, COUNT(*) as count, SUM(amount) as total
         FROM app_rg_compliance_ledger
         WHERE game_id = '$game_id'
         GROUP BY event_type, hall_id, game_type, channel
         ORDER BY event_type" 2>&1 | head -10
      echo '```'
      echo ""

      echo "## Klient-side events (siste 30 fra ConsoleBridge)"
      echo '```'
      echo "$events_json" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    events = data.get('data',{}).get('events',[])
    # Filter for console-bridged events
    console_evts = [e for e in events if e['type'].startswith('console.')][-30:]
    for e in console_evts:
        msg = e['payload'].get('message','')[:120]
        print(f\"[{e['iso']}] {e['type']}: {msg}\")
except Exception as ex:
    print(f'(parse error: {ex})')
" 2>&1
      echo '```'
      echo ""

      echo "## Anomalier under runden (fra /tmp/pilot-monitor.log)"
      echo '```'
      # Sett siste timestamps
      grep -E "P[0-3]" "$LOG_FILE" | tail -30 || echo "(ingen anomalier)"
      echo '```'
      echo ""

      echo "## Status"
      if [ "$status" = "completed" ] && [ "$duration" -gt 30 ]; then
        echo "✅ Runden fullført normalt"
      elif [ "$duration" -lt 10 ]; then
        echo "⚠️ Runde svært kort ($duration sek) — mistanke om abort"
      fi
    } > "$report_file"

    echo "$game_id" > "$LAST_ROUND_GAMEID_FILE"
    log_anomaly "P3" "round.ended" \
      "Runde $round_num ferdig ($game_id, ${duration}s). Rapport: $report_file"
  fi
}

# D. DB-state mismatch polling
check_db_mismatch() {
  local now=$(date +%s)
  local last_poll=0
  [ -f "$LAST_DB_POLL_FILE" ] && last_poll=$(cat "$LAST_DB_POLL_FILE")
  local elapsed=$((now - last_poll))
  if [ $elapsed -lt $DB_INTERVAL ]; then return; fi

  echo "$now" > "$LAST_DB_POLL_FILE"

  # Sjekk plan-run vs scheduled-game state.
  #
  # 2026-05-16: `plan-run.running + scheduled-game.completed` på current
  # position er normal mellom-runder-state. Master/runner skal da advance til
  # neste posisjon, ikke kjøre cleanup. P1 gjelder bare når det finnes hverken
  # aktiv scheduled-game eller en current-position-rad å fortsette fra.
  local mismatch
  mismatch=$(psql -h localhost -U spillorama -d spillorama -tA -F "|" -c \
    "SELECT
       pr.id as plan_run_id,
       pr.status as run_status,
       pr.current_position,
       sg_current.id as current_sched_game_id
     FROM app_game_plan_run pr
     LEFT JOIN app_game1_scheduled_games sg_active
       ON sg_active.plan_run_id = pr.id
      AND sg_active.status IN ('scheduled','purchase_open','ready_to_start','running','paused')
     LEFT JOIN app_game1_scheduled_games sg_current
       ON sg_current.plan_run_id = pr.id
      AND sg_current.plan_position = pr.current_position
     WHERE pr.status = 'running'
       AND sg_active.id IS NULL
       AND sg_current.id IS NULL
       AND pr.business_date = CURRENT_DATE
     GROUP BY pr.id, pr.status, pr.current_position, sg_current.id
     LIMIT 5" 2>/dev/null || echo "")

  if [ -n "$mismatch" ]; then
    log_anomaly "P1" "db.stuck-state" \
      "Plan-run RUNNING uten aktiv eller current-position scheduled-game: $mismatch — krever cleanup"
  fi

  # Sjekk wallet-balance vs ledger-sum
  local wallet_mismatch
  wallet_mismatch=$(psql -h localhost -U spillorama -d spillorama -tA -c \
    "SELECT COUNT(*) FROM (
       SELECT wa.id, wa.balance,
              COALESCE((SELECT SUM(amount) FROM app_wallet_transactions wt WHERE wt.wallet_id = wa.id), 0) as ledger_sum
       FROM app_wallet_accounts wa
       WHERE wa.id LIKE 'wallet-user-demo-%'
     ) t WHERE balance != ledger_sum" 2>/dev/null || echo "0")

  if [ -n "$wallet_mismatch" ] && [ "$wallet_mismatch" -gt 0 ]; then
    log_anomaly "P0" "wallet.balance-mismatch" \
      "$wallet_mismatch demo-wallets har balance != ledger-sum — regulatorisk-kritisk"
  fi
}

# Main loop
log_anomaly "P3" "monitor.start" "pilot-monitor-enhanced started (PID $$)"
start_backend_tail

ITERATIONS=0
BACKEND_DOWN_CONSECUTIVE=0   # Antall consecutive 5s-polls hvor backend er nede
                              # 6 × 5s = 30s → P0 escalation per
                              # MONITOR_SEVERITY_CLASSIFICATION.md
while true; do
  ITERATIONS=$((ITERATIONS + 1))

  # Poll debug-events
  events=$(curl -s --max-time 3 "http://localhost:4000/api/_dev/debug/events/tail?token=$TOKEN" 2>/dev/null || echo "")
  if [ -z "$events" ] || [[ "$events" == *"<html"* ]]; then
    BACKEND_DOWN_CONSECUTIVE=$((BACKEND_DOWN_CONSECUTIVE + 1))
    # P2 etter 6 consecutive failures (30s).
    # P0 escalation etter 12 consecutive (60s) — eskaleres som live-room-down.
    # Loggges hver 12. iteration (60s) for å unngå spam.
    if [ $((ITERATIONS % 12)) -eq 0 ]; then
      if [ "$BACKEND_DOWN_CONSECUTIVE" -ge 12 ]; then
        log_anomaly "P0" "monitor.backend-down-30s" \
          "Backend on :4000 har vært nede i $((BACKEND_DOWN_CONSECUTIVE * POLL_INTERVAL))s — live-room-stopp risk"
      else
        log_anomaly "P2" "monitor.backend-unreachable" \
          "Backend on :4000 not responding (every 60s)"
      fi
    fi
  else
    # Backend tilbake — reset counter
    if [ "$BACKEND_DOWN_CONSECUTIVE" -ge 6 ]; then
      log_anomaly "P3" "monitor.backend-recovered" \
        "Backend reachable etter $((BACKEND_DOWN_CONSECUTIVE * POLL_INTERVAL))s nedetid"
    fi
    BACKEND_DOWN_CONSECUTIVE=0
    # Parse anomalier fra nye events
    echo "$events" | python3 -c "
import json, sys, os, time

try:
    data = json.load(sys.stdin)
    events = data.get('data',{}).get('events',[])
except:
    sys.exit(0)

last_received_file = '/tmp/pilot-monitor-last-receivedAt.txt'
last_received = 0
try:
    with open(last_received_file) as f:
        last_received = int(f.read().strip())
except: pass

new_events = [e for e in events if e.get('receivedAt', 0) > last_received]
if not new_events: sys.exit(0)

max_received = last_received
for e in new_events:
    if e.get('receivedAt', 0) > max_received:
        max_received = e['receivedAt']

# Anomali-deteksjon:
# 1. console.error event
errs = [e for e in new_events if e['type'] == 'console.error']
for e in errs:
    msg = e['payload'].get('message','')[:200]
    print(f'P1|client.error|{msg}')

# 2. popup.autoShowGate med willOpen:false flere ganger på rad uten følgende popup.show
gates = [e for e in new_events if e['type'] == 'popup.autoShowGate']
blocked = [g for g in gates if not g['payload'].get('willOpen', False)]
if len(blocked) >= 3:
    last = blocked[-1]['payload']
    blocked_reason = []
    if last.get('autoShowBuyPopupDone'): blocked_reason.append('autoShowBuyPopupDone=true')
    if last.get('hasLive'): blocked_reason.append('hasLive=true')
    if not last.get('hasTicketTypes'): blocked_reason.append('hasTicketTypes=false')
    if last.get('waitingForMasterPurchase'): blocked_reason.append('waitingForMasterPurchase=true')
    if last.get('preRoundTicketsCount',0) > 0: blocked_reason.append(f\"preRoundTicketsCount={last['preRoundTicketsCount']}\")
    print(f'P1|popup.blocked-repeat|Gate blokkerer popup ({len(blocked)} consecutive). Reasons: {chr(10).join(blocked_reason) or \"unknown\"}')

with open(last_received_file, 'w') as f:
    f.write(str(max_received))
" 2>/dev/null | while IFS='|' read -r sev kind msg; do
      [ -n "$sev" ] && log_anomaly "$sev" "$kind" "$msg"
    done
  fi

  # Round-end check (hver poll)
  check_round_end 2>/dev/null || true

  # DB-state polling (hver 30s)
  check_db_mismatch 2>/dev/null || true

  # Snapshot hvert 60 sek
  if [ $((ITERATIONS % 12)) -eq 0 ]; then
    {
      echo "# Pilot Monitor Snapshot — $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      echo ""
      echo "**Iterations:** $ITERATIONS"
      echo "**Last 10 anomalies:**"
      echo '```'
      tail -10 "$LOG_FILE"
      echo '```'
      echo ""
      echo "**Round reports generated:**"
      ls -la "${ROUND_FILE_PREFIX}-"*.md 2>/dev/null | head -10 || echo "(none yet)"
    } > "$SNAPSHOT_FILE"
  fi

  sleep $POLL_INTERVAL
done
