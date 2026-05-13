#!/usr/bin/env bash
# monitor-push-to-pm.sh — companion push-daemon for pilot-monitor-enhanced.sh
#
# Tobias-direktiv 2026-05-13: Live-monitor må AKTIVT pushe P0/P1-anomalier
# til PM-sesjonen, ikke bare logge passivt til /tmp/pilot-monitor.log.
#
# Hva denne daemonen gjør:
#   1. Tailer /tmp/pilot-monitor.log med `tail -F`
#   2. Filtrerer for severity-tags `[P0]` og `[P1]` per
#      docs/engineering/MONITOR_SEVERITY_CLASSIFICATION.md
#   3. For hver match, pusher til 3 kanaler:
#       a. /tmp/pilot-monitor-urgent.fifo  (named pipe, PM tail-er denne)
#       b. Terminal bell (\a)
#       c. macOS notification via osascript
#
# Forutsetning:
#   - pilot-monitor-enhanced.sh kjører (skriver /tmp/pilot-monitor.log)
#   - /tmp/pilot-monitor.log finnes (touches selv om ikke)
#
# Bruk:
#   # Som standalone:
#   bash scripts/monitor-push-to-pm.sh &
#
#   # Som del av wrapper:
#   bash scripts/start-monitor-with-push.sh
#
# Stopp:
#   kill $(cat /tmp/pilot-monitor-push.pid)
#
# Test:
#   bash scripts/__tests__/monitor-severity-classification.test.sh

set -euo pipefail

LOG_FILE="${PILOT_MONITOR_LOG:-/tmp/pilot-monitor.log}"
FIFO="${PILOT_MONITOR_FIFO:-/tmp/pilot-monitor-urgent.fifo}"
PID_FILE="${PILOT_MONITOR_PUSH_PID:-/tmp/pilot-monitor-push.pid}"

# Sett til 1 for å disable macOS notifications (eks. CI, headless)
DISABLE_NOTIFY="${DISABLE_NOTIFY:-0}"

# Skriv egen PID
echo $$ > "$PID_FILE"

# Lag FIFO hvis den ikke finnes
if [ ! -p "$FIFO" ]; then
  # Rydd vekk evt. gammel fil/dir på path-en
  rm -f "$FIFO" 2>/dev/null || true
  mkfifo "$FIFO"
fi

# Touch log-fil hvis den ikke finnes (så tail -F ikke feiler)
touch "$LOG_FILE"

# Open FIFO som both-rw (rw mode) på file descriptor 3.
# Dette gjør at daemonen alltid har en reader (seg selv via FD 3), så
# writes til FIFO-en aldri blokkerer selv om ingen PM-tail-er den.
# Eksterne readers (`tail -f $FIFO`) får sin egen kopi av byte-strømmen.
# NB: Linux + macOS FIFO-semantikk støtter `<>` rw-open uten å blokkere.
exec 3<>"$FIFO"

cleanup() {
  # Lukk FD 3 så FIFO kan slettes hvis ingen andre holder den åpen
  exec 3<&-  2>/dev/null || true
  exec 3>&-  2>/dev/null || true
  rm -f "$PID_FILE" 2>/dev/null || true
  # ALDRI slett FIFO her — kan brukes av andre prosesser eller PM-sesjoner
  # Wrapper-scriptet rydder FIFO ved Ctrl+C
  exit 0
}
trap cleanup EXIT INT TERM

# Helper: send notification via osascript med sound + title
notify_macos() {
  local sev="$1"
  local msg="$2"
  local sound="Submarine"   # default P1

  if [ "$sev" = "P0" ]; then
    sound="Sosumi"
  fi

  if [ "$DISABLE_NOTIFY" = "1" ]; then
    return 0
  fi

  # Escape doble anførselstegn slik at AppleScript ikke knekker
  local safe_msg
  safe_msg=$(printf '%s' "$msg" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

  # Best-effort; ikke kræsj hvis osascript ikke finnes (eks. Linux CI)
  osascript -e "display notification \"$safe_msg\" with title \"Spillorama $sev\" sound name \"$sound\"" 2>/dev/null || true
}

# Regex for parse_log_line. Format:
#   [2026-05-13T14:32:10Z] [P0] wallet.balance-mismatch: 1 demo-wallets...
# Capture groups:
#   1 = ISO timestamp
#   2 = severity tag (P0/P1/P2/P3)
#   3 = kind
#   4 = message
# Krever bash 3.2+ (POSIX ERE via =~).
PARSE_REGEX='^\[([^]]+)\] \[(P[0-3])\] ([^:]+):[[:space:]]*(.*)$'

# Helper: process én log-linje
process_line() {
  local line="$1"

  # Bash regex med BASH_REMATCH.
  # NB: kjør under bash, ikke sh/dash — see shebang.
  if [[ ! "$line" =~ $PARSE_REGEX ]]; then
    return 0
  fi

  local iso="${BASH_REMATCH[1]}"
  local sev="${BASH_REMATCH[2]}"
  local kind="${BASH_REMATCH[3]}"
  local msg="${BASH_REMATCH[4]}"

  # KUN P0/P1 trigger push
  if [ "$sev" != "P0" ] && [ "$sev" != "P1" ]; then
    return 0
  fi

  # Format: [P0 2026-05-13T14:32:10Z] wallet.balance-mismatch: 1 demo-wallets...
  local urgent_line="[$sev $iso] $kind: $msg"

  # 1. Push til FIFO via FD 3 (åpnet rw i startup, så aldri blokker)
  # Hvis FIFO-bufferen er full (PM ikke leser raskt nok), skriv kan
  # blokkere kort — det er ønsket atferd; vi vil ikke droppe P0/P1.
  # Hvis daemon kjører uten en aktiv reader på den eksterne enden, går
  # eventene fortsatt inn i kjernens buffer (~64 KB) og kan leses senere.
  echo "$urgent_line" >&3

  # 2. Terminal bell — synlig om PM-sesjonen kjører i samme terminal
  printf '\a' >&2

  # 3. macOS notification
  notify_macos "$sev" "$kind: $msg"

  # Log activity til stderr (synlig om man kjører non-daemon)
  echo "[push] $urgent_line" >&2
}

# Initial info-melding
echo "[push] monitor-push-to-pm.sh started (PID $$, log: $LOG_FILE, fifo: $FIFO)" >&2

# Hovedløkke: tail log fra end-of-file (-n 0) for å unngå replay av gamle entries
# `-F` = follow filename, reopen ved rotering. `--lines=0` = start fra slutten.
tail -n 0 -F "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
  process_line "$line"
done
