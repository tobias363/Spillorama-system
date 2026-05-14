#!/usr/bin/env bash
# setup-db-perf-cron.sh — install/uninstall the db-perf-watcher schedule
#
# Tobias-direktiv 2026-05-14: rutinen skal kjøre hver 5 min for å fange
# N+1-queries og regressions. Default disabled — Tobias velger å aktivere
# etter pilot-test.
#
# Supports two install modes:
#   1. macOS launchd  (default — Tobias kjører på macOS)
#   2. crontab        (Linux/Render/staging)
#
# Bruk:
#   bash scripts/ops/setup-db-perf-cron.sh install        # default: launchd on macOS, cron on Linux
#   bash scripts/ops/setup-db-perf-cron.sh install --cron # force crontab
#   bash scripts/ops/setup-db-perf-cron.sh install --launchd # force launchd
#   bash scripts/ops/setup-db-perf-cron.sh uninstall
#   bash scripts/ops/setup-db-perf-cron.sh status
#   bash scripts/ops/setup-db-perf-cron.sh print          # print install instructions, do nothing
#
# Env:
#   INTERVAL_MINUTES   default 5
#   PGPASSWORD         passed to the cron-environment (default spillorama)
#
# Idempotent — re-running install replaces the existing schedule.

set -u
set -o pipefail

ACTION="${1:-print}"
MODE="${2:-auto}"

: "${INTERVAL_MINUTES:=5}"
: "${PGPASSWORD:=spillorama}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
WATCHER_SCRIPT="${SCRIPT_DIR}/db-perf-watcher.sh"

LAUNCHD_LABEL="com.spillorama.db-perf-watcher"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
CRON_TAG="# db-perf-watcher (managed by setup-db-perf-cron.sh)"
LOG_FILE="/tmp/db-perf-watcher-cron.log"

log() { echo "[setup-db-perf-cron] $*"; }
err() { echo "[setup-db-perf-cron] ERROR: $*" >&2; }

# Resolve mode if "auto"
resolve_mode() {
  if [ "$MODE" != "auto" ]; then
    echo "$MODE"
    return
  fi
  case "$(uname -s)" in
    Darwin) echo "launchd" ;;
    Linux) echo "cron" ;;
    *) echo "cron" ;;
  esac
}

# ── Sub-commands ────────────────────────────────────────────────────────────

print_instructions() {
  cat <<EOF
db-perf-watcher cron setup

Watcher script: ${WATCHER_SCRIPT}
Interval:       ${INTERVAL_MINUTES} min
Log:            ${LOG_FILE}

To install:
  bash scripts/ops/setup-db-perf-cron.sh install

To remove:
  bash scripts/ops/setup-db-perf-cron.sh uninstall

To check status:
  bash scripts/ops/setup-db-perf-cron.sh status

Manual one-shot (no schedule):
  bash scripts/ops/db-perf-watcher.sh

First run will establish the baseline. Subsequent runs compare against it.

Force re-baseline (after fix):
  FORCE_BASELINE=1 bash scripts/ops/db-perf-watcher.sh

See docs/operations/DB_PERF_WATCHER_RUNBOOK.md for full details.

Mode detection: $(uname -s) → $(resolve_mode)
EOF
}

install_launchd() {
  if [ "$(uname -s)" != "Darwin" ]; then
    err "launchd install requested but not on macOS. Use --cron."
    return 1
  fi

  mkdir -p "$(dirname "$LAUNCHD_PLIST")"

  # Compute StartInterval in seconds (launchd uses seconds, not minutes)
  local start_interval_sec=$((INTERVAL_MINUTES * 60))

  cat > "$LAUNCHD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WATCHER_SCRIPT}</string>
  </array>

  <key>StartInterval</key>
  <integer>${start_interval_sec}</integer>

  <key>RunAtLoad</key>
  <false/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PGPASSWORD</key>
    <string>${PGPASSWORD}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>

  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>

  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
</dict>
</plist>
EOF
  log "Wrote launchd plist: ${LAUNCHD_PLIST}"

  # Load (unload first if already loaded to make install idempotent)
  if launchctl list | grep -q "$LAUNCHD_LABEL"; then
    launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
  fi

  if launchctl load "$LAUNCHD_PLIST" 2>&1; then
    log "Loaded launchd job. Watcher will run every ${INTERVAL_MINUTES} min."
    log "Tail logs: tail -f ${LOG_FILE}"
  else
    err "launchctl load failed. Check the plist manually."
    return 1
  fi
}

install_cron() {
  local cron_line
  cron_line="*/${INTERVAL_MINUTES} * * * * PGPASSWORD=${PGPASSWORD} /bin/bash ${WATCHER_SCRIPT} >> ${LOG_FILE} 2>&1 ${CRON_TAG}"

  # Remove any prior entry, then append. mktemp avoids race conditions.
  local tmp_cron
  tmp_cron=$(mktemp)
  trap 'rm -f "$tmp_cron"' EXIT

  crontab -l 2>/dev/null | grep -v "$CRON_TAG" > "$tmp_cron" || true
  echo "$cron_line" >> "$tmp_cron"
  crontab "$tmp_cron"
  log "Installed crontab entry. Watcher will run every ${INTERVAL_MINUTES} min."
  log "Tail logs: tail -f ${LOG_FILE}"
}

uninstall() {
  local mode
  mode=$(resolve_mode)

  if [ "$mode" = "launchd" ] && [ -f "$LAUNCHD_PLIST" ]; then
    launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
    rm -f "$LAUNCHD_PLIST"
    log "Removed launchd plist."
  fi

  if command -v crontab >/dev/null 2>&1; then
    local tmp_cron
    tmp_cron=$(mktemp)
    trap 'rm -f "$tmp_cron"' EXIT
    if crontab -l 2>/dev/null | grep -v "$CRON_TAG" > "$tmp_cron"; then
      crontab "$tmp_cron"
      log "Removed crontab entry (if it existed)."
    fi
  fi
}

status() {
  log "Mode: $(resolve_mode)"
  if [ -f "$LAUNCHD_PLIST" ]; then
    log "launchd plist installed: ${LAUNCHD_PLIST}"
    if launchctl list | grep -q "$LAUNCHD_LABEL"; then
      log "launchd job loaded: ${LAUNCHD_LABEL}"
    else
      log "launchd job NOT loaded — re-install via: $0 install"
    fi
  else
    log "launchd plist not installed."
  fi

  if command -v crontab >/dev/null 2>&1; then
    if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
      log "crontab entry installed:"
      crontab -l 2>/dev/null | grep "$CRON_TAG" >&2
    else
      log "No crontab entry."
    fi
  fi

  if [ -f "$LOG_FILE" ]; then
    local last_modified
    last_modified=$(stat -f "%Sm" "$LOG_FILE" 2>/dev/null || stat -c "%y" "$LOG_FILE" 2>/dev/null || echo "unknown")
    log "Log file: ${LOG_FILE} (last modified: ${last_modified})"
  else
    log "No log file yet at ${LOG_FILE}"
  fi
}

# ── Dispatch ────────────────────────────────────────────────────────────────

case "$ACTION" in
  install)
    if ! [ -x "$WATCHER_SCRIPT" ]; then
      err "Watcher script not executable: $WATCHER_SCRIPT"
      err "Run: chmod +x ${WATCHER_SCRIPT}"
      exit 1
    fi

    local_mode=$(resolve_mode)
    if [ "$local_mode" = "launchd" ]; then
      install_launchd
    else
      install_cron
    fi
    ;;
  uninstall)
    uninstall
    ;;
  status)
    status
    ;;
  print|"")
    print_instructions
    ;;
  *)
    err "Unknown action: $ACTION"
    err "Usage: $0 {install|uninstall|status|print} [--cron|--launchd]"
    exit 1
    ;;
esac
