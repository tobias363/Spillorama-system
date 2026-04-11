#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="$REPO_ROOT/Spillorama"
LOG_FILE="/tmp/unity_game_runtime_state_smoke.log"

UNITY_BIN="${UNITY_BIN:-}"
if [[ -z "$UNITY_BIN" ]]; then
  PROJECT_VERSION_FILE="$PROJECT_PATH/ProjectSettings/ProjectVersion.txt"
  if [[ -f "$PROJECT_VERSION_FILE" ]]; then
    UNITY_VERSION="$(sed -n 's/^m_EditorVersion: //p' "$PROJECT_VERSION_FILE" | head -n1)"
    if [[ -n "$UNITY_VERSION" ]]; then
      CANDIDATE="/Applications/Unity/Hub/Editor/$UNITY_VERSION/Unity.app/Contents/MacOS/Unity"
      if [[ -x "$CANDIDATE" ]]; then
        UNITY_BIN="$CANDIDATE"
        echo "Auto-detektert Unity-bin fra ProjectVersion: $UNITY_BIN"
      fi
    fi
  fi
fi

if [[ -z "$UNITY_BIN" ]]; then
  UNITY_BIN="/Applications/Unity/Hub/Editor/6000.3.10f1/Unity.app/Contents/MacOS/Unity"
fi

if [[ ! -x "$UNITY_BIN" ]]; then
  echo "Unity binary not found or not executable: $UNITY_BIN" >&2
  exit 1
fi

echo "Running game runtime state smoke test..."
"$UNITY_BIN" \
  -batchmode \
  -nographics \
  -quit \
  -projectPath "$PROJECT_PATH" \
  -executeMethod GameRuntimeStateSmokeTests.RunGameRuntimeStateSmokeTest \
  -logFile "$LOG_FILE"

grep -q "\[GameRuntimeStateSmoke\] PASS" "$LOG_FILE"
echo "Game runtime state smoke test passed."
