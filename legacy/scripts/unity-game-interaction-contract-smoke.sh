#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Spillorama"}"
UNITY_BIN="${UNITY_BIN:-}"
LOG_FILE="${UNITY_GAME_INTERACTION_CONTRACT_LOG:-/tmp/unity_game_interaction_contract_smoke.log}"

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

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Unity project path not found: $PROJECT_PATH" >&2
  exit 1
fi

echo "Running game interaction contract smoke test..."
"$UNITY_BIN" \
  -batchmode \
  -nographics \
  -quit \
  -projectPath "$PROJECT_PATH" \
  -executeMethod GameInteractionContractSmokeTests.RunGameInteractionContractSmokeTest \
  -logFile "$LOG_FILE"

if ! rg -n "\[GameInteractionContractSmoke\] PASS" "$LOG_FILE" >/dev/null; then
  echo "Game interaction contract smoke test did not report PASS. Check log: $LOG_FILE" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "Game interaction contract smoke test passed."
