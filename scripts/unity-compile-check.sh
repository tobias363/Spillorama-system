#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Candy"}"
UNITY_BIN="${UNITY_BIN:-}"
LOG_FILE="${UNITY_COMPILE_LOG:-/tmp/unity_compile_check.log}"

if [[ -z "$UNITY_BIN" ]]; then
  PROJECT_VERSION_FILE="$PROJECT_PATH/ProjectSettings/ProjectVersion.txt"
  DETECTED_UNITY_VERSION=""
  if [[ -f "$PROJECT_VERSION_FILE" ]]; then
    DETECTED_UNITY_VERSION="$(awk -F': ' '/^m_EditorVersion:/{print $2; exit}' "$PROJECT_VERSION_FILE" || true)"
  fi

  if [[ -n "$DETECTED_UNITY_VERSION" ]]; then
    CANDIDATE_BIN="/Applications/Unity/Hub/Editor/$DETECTED_UNITY_VERSION/Unity.app/Contents/MacOS/Unity"
    if [[ -x "$CANDIDATE_BIN" ]]; then
      UNITY_BIN="$CANDIDATE_BIN"
      echo "Auto-detektert Unity-bin fra ProjectVersion: $UNITY_BIN"
    fi
  fi
fi

if [[ -z "$UNITY_BIN" ]]; then
  UNITY_BIN="/Applications/Unity/Hub/Editor/2021.3.8f1/Unity.app/Contents/MacOS/Unity"
  echo "Fallback Unity-bin i bruk: $UNITY_BIN"
fi

if [[ ! -x "$UNITY_BIN" ]]; then
  echo "Unity binary not found or not executable: $UNITY_BIN" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Unity project path not found: $PROJECT_PATH" >&2
  exit 1
fi

echo "Running Unity compile check..."
"$UNITY_BIN" \
  -batchmode \
  -nographics \
  -quit \
  -projectPath "$PROJECT_PATH" \
  -logFile "$LOG_FILE"

if rg -n "error CS[0-9]+|\\): error [A-Z]{2}[0-9]+" "$LOG_FILE" >/dev/null; then
  echo "Compile errors found in Unity log: $LOG_FILE" >&2
  rg -n "error CS[0-9]+|\\): error [A-Z]{2}[0-9]+" "$LOG_FILE" >&2
  exit 1
fi

echo "Unity compile check passed."
