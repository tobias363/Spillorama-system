#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Candy"}"
UNITY_BIN="${UNITY_BIN:-/Applications/Unity/Hub/Editor/2021.3.8f1/Unity.app/Contents/MacOS/Unity}"
LOG_FILE="${UNITY_THEME2_SMOKE_LOG:-/tmp/unity_theme2_smoke.log}"

if [[ ! -x "$UNITY_BIN" ]]; then
  echo "Unity binary not found or not executable: $UNITY_BIN" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Unity project path not found: $PROJECT_PATH" >&2
  exit 1
fi

echo "Running Theme2 play smoke test..."
"$UNITY_BIN" \
  -batchmode \
  -nographics \
  -quit \
  -projectPath "$PROJECT_PATH" \
  -executeMethod Theme2SmokeTests.RunTheme2PlaySmokeTest \
  -logFile "$LOG_FILE"

if ! rg -n "\[Theme2Smoke\] PASS" "$LOG_FILE" >/dev/null; then
  echo "Theme2 smoke test did not report PASS. Check log: $LOG_FILE" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "Theme2 play smoke test passed."
