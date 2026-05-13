#!/usr/bin/env bash
# generate-push-control-dashboard.sh — generer PM Push-Control HTML-dashboard
#
# Tynt bash-wrapper rundt `pm-push-control.mjs dashboard` for convenience:
# - Genererer dashboard
# - Åpner i nettleser hvis `--open` er angitt
# - Kjør i loop med `--watch` (regenerér hvert 30s)
#
# Bruk:
#   bash scripts/generate-push-control-dashboard.sh
#   bash scripts/generate-push-control-dashboard.sh --open
#   bash scripts/generate-push-control-dashboard.sh --watch
#   bash scripts/generate-push-control-dashboard.sh --open --watch

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/pm-push-control.mjs"
DASHBOARD="/tmp/pm-push-control-dashboard.html"

OPEN_BROWSER=0
WATCH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --open) OPEN_BROWSER=1; shift ;;
    --watch) WATCH=1; shift ;;
    --help|-h)
      echo "Usage: $0 [--open] [--watch]"
      echo
      echo "  --open    Open dashboard in browser after generation"
      echo "  --watch   Regenerate every 30 seconds (use Ctrl+C to stop)"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

generate() {
  node "$SCRIPT" --silent dashboard
  echo "✅ Dashboard: $DASHBOARD"
}

generate

if [ "$OPEN_BROWSER" = "1" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    open "$DASHBOARD"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DASHBOARD"
  else
    echo "⚠️  Cannot auto-open browser on this platform — open manually: $DASHBOARD"
  fi
fi

if [ "$WATCH" = "1" ]; then
  echo
  echo "👁️  Watching — regenerating every 30s. Ctrl+C to stop."
  while true; do
    sleep 30
    generate
  done
fi
