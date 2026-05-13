#!/usr/bin/env bash
# start-monitor-with-push.sh — wrapper som starter monitor + push-daemon
#
# Tobias-direktiv 2026-05-13: Live-monitor må aktivt pushe P0/P1 til PM-sesjon.
# Dette scriptet starter begge prosesser med proper cleanup ved Ctrl+C.
#
# Produserer:
#   /tmp/pilot-monitor.log                — full log fra monitor (alle severities)
#   /tmp/pilot-monitor-snapshot.md        — 60s-snapshots
#   /tmp/pilot-monitor-round-<N>.md       — round-end-rapporter
#   /tmp/pilot-monitor-urgent.fifo        — named pipe for PM-sesjon-tail
#   /tmp/pilot-monitor.pid                — monitor PID
#   /tmp/pilot-monitor-push.pid           — push-daemon PID
#
# Bruk:
#   bash scripts/start-monitor-with-push.sh
#
# I annet terminal — for PM-sesjon:
#   tail -f /tmp/pilot-monitor-urgent.fifo
#
# Stopp: Ctrl+C eller `pkill -f 'start-monitor-with-push.sh'`

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$REPO_ROOT/scripts"

MONITOR_PID_FILE="/tmp/pilot-monitor.pid"
PUSH_PID_FILE="/tmp/pilot-monitor-push.pid"
LOG_FILE="/tmp/pilot-monitor.log"
FIFO="/tmp/pilot-monitor-urgent.fifo"

# Forsikre om at child-scripts finnes og er kjørbare
for script in "$SCRIPT_DIR/pilot-monitor-enhanced.sh" "$SCRIPT_DIR/monitor-push-to-pm.sh"; do
  if [ ! -x "$script" ]; then
    echo "❌ Required script not executable: $script" >&2
    exit 1
  fi
done

# Drep gamle prosesser hvis de fortsatt kjører
for pid_file in "$MONITOR_PID_FILE" "$PUSH_PID_FILE"; do
  if [ -f "$pid_file" ]; then
    OLD_PID=$(cat "$pid_file" 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      echo "ℹ️  Killing stale process from $pid_file (PID $OLD_PID)"
      kill -TERM "$OLD_PID" 2>/dev/null || true
      sleep 1
      kill -0 "$OLD_PID" 2>/dev/null && kill -KILL "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
done

# Rydd FIFO hvis den fantes som vanlig fil (bug-case)
if [ -e "$FIFO" ] && [ ! -p "$FIFO" ]; then
  echo "ℹ️  Removing non-FIFO file at $FIFO"
  rm -f "$FIFO"
fi

# Start monitor
echo "▶️  Starting pilot-monitor-enhanced.sh..."
bash "$SCRIPT_DIR/pilot-monitor-enhanced.sh" &
MONITOR_PID=$!
echo "$MONITOR_PID" > "$MONITOR_PID_FILE"

# Vent litt slik at monitor får oppretta log-fil
sleep 2

# Verifiser at monitor faktisk kjører
if ! kill -0 "$MONITOR_PID" 2>/dev/null; then
  echo "❌ Monitor died on startup — check $LOG_FILE" >&2
  rm -f "$MONITOR_PID_FILE"
  exit 1
fi

# Start push-daemon
echo "▶️  Starting monitor-push-to-pm.sh..."
bash "$SCRIPT_DIR/monitor-push-to-pm.sh" &
PUSH_PID=$!
echo "$PUSH_PID" > "$PUSH_PID_FILE"

# Vent litt
sleep 1

# Verifiser push-daemon
if ! kill -0 "$PUSH_PID" 2>/dev/null; then
  echo "❌ Push-daemon died on startup" >&2
  kill -TERM "$MONITOR_PID" 2>/dev/null || true
  rm -f "$MONITOR_PID_FILE" "$PUSH_PID_FILE"
  exit 1
fi

echo ""
echo "✅ Monitor + Push started:"
echo "  Monitor PID: $MONITOR_PID  (log: $LOG_FILE)"
echo "  Push PID:    $PUSH_PID  (fifo: $FIFO)"
echo ""
echo "PM-sesjon kan tail-e push-events:"
echo "  tail -f $FIFO"
echo ""
echo "60s-snapshots: cat /tmp/pilot-monitor-snapshot.md"
echo ""
echo "Stopp: Ctrl+C eller kill ovenstående PIDs"
echo ""

# Cleanup ved Ctrl+C / TERM
# Idempotent: kan kalles flere ganger uten skade (trap kjøres på EXIT også).
CLEANUP_DONE=0
cleanup() {
  # Disable trap så vi ikke får dobbeltkjøring (EXIT-trap fyrer etter INT/TERM-trap)
  trap - INT TERM EXIT
  [ "$CLEANUP_DONE" = "1" ] && exit 0
  CLEANUP_DONE=1

  echo ""
  echo "🛑 Shutdown signal received — stopping monitor + push-daemon..."

  # Kill HELE process-gruppen for hver child via negative PID.
  # Det dreper også eventuelle `tail -F`-subprosesser som monitor har
  # forked til backend-log-tail (de hører til samme process group).
  for pid in "$PUSH_PID" "$MONITOR_PID"; do
    if kill -0 "$pid" 2>/dev/null; then
      # Trygt kill av process-gruppen; PG-id == leader's PID for daemoner
      kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  # Vent inntil 3s for graceful shutdown
  for i in 1 2 3; do
    local alive=0
    for pid in "$PUSH_PID" "$MONITOR_PID"; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = "0" ] && break
    sleep 1
  done

  # SIGKILL hvis fortsatt alive (på både PID og PG)
  for pid in "$PUSH_PID" "$MONITOR_PID"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
  done

  # Sikkerhetsnett: pkill etter kommando-navn for å fange orphan-children
  pkill -KILL -f 'pilot-monitor-enhanced\.sh' 2>/dev/null || true
  pkill -KILL -f 'monitor-push-to-pm\.sh' 2>/dev/null || true

  # Rydd PID-filer + FIFO
  rm -f "$MONITOR_PID_FILE" "$PUSH_PID_FILE" "$FIFO"

  echo "✅ Cleanup complete"
  exit 0
}

trap cleanup INT TERM EXIT

# Wait for any of the two to die (uventet exit)
# Bruk korte sleeps for å være responsive på signaler. `wait -n` finnes ikke
# i bash 3.2 (macOS default), så vi poller manuelt.
while kill -0 "$MONITOR_PID" 2>/dev/null && kill -0 "$PUSH_PID" 2>/dev/null; do
  # Kort sleep med shell-builtin slik at signaler kan bryte inn raskt.
  # `read -t` med /dev/null som input gir en signalbar sleep i ren bash.
  read -r -t 1 </dev/null || true
done

# En av prosessene døde — log hvilken
if ! kill -0 "$MONITOR_PID" 2>/dev/null; then
  echo "⚠️  Monitor died unexpectedly (PID $MONITOR_PID)" >&2
fi
if ! kill -0 "$PUSH_PID" 2>/dev/null; then
  echo "⚠️  Push-daemon died unexpectedly (PID $PUSH_PID)" >&2
fi

# cleanup trap triggerer på exit
