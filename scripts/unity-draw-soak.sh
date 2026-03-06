#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Candy"}"
UNITY_BIN="${UNITY_BIN:-}"
LOG_FILE="${UNITY_DRAW_SOAK_LOG:-/tmp/unity_draw_soak.log}"

SOAK_SCENE="${CANDY_SOAK_SCENE_PATH:-Assets/Scenes/Theme1.unity}"
SOAK_API_BASE_URL="${CANDY_SOAK_API_BASE_URL:-https://bingosystem-staging.onrender.com}"
SOAK_EMAIL="${CANDY_SOAK_EMAIL:-demo@bingo.local}"
SOAK_PASSWORD="${CANDY_SOAK_PASSWORD:-Demo12345!}"
SOAK_TARGET_DRAWS="${CANDY_SOAK_TARGET_DRAWS:-500}"
SOAK_TIMEOUT_SECONDS="${CANDY_SOAK_TIMEOUT_SECONDS:-1800}"
SOAK_PLAY_PRESS_INTERVAL_SECONDS="${CANDY_SOAK_PLAY_PRESS_INTERVAL_SECONDS:-0.9}"
SOAK_TOPUP_AMOUNT="${CANDY_SOAK_TOPUP_AMOUNT:-40000}"

if [[ -z "${CANDY_SOAK_EMAIL:-}" ]]; then
  SOAK_EMAIL="demo-soak-$(date -u +%Y%m%d%H%M%S)@bingo.local"
fi

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

if command -v jq >/dev/null 2>&1; then
  echo "[draw-soak] Topper opp saldo for $SOAK_EMAIL ..."
  LOGIN_JSON="$(curl -sS -X POST "$SOAK_API_BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$SOAK_EMAIL\",\"password\":\"$SOAK_PASSWORD\"}")"
  ACCESS_TOKEN="$(printf '%s' "$LOGIN_JSON" | jq -r '.data.accessToken // empty')"
  if [[ -n "$ACCESS_TOKEN" ]]; then
    curl -sS -X POST "$SOAK_API_BASE_URL/api/wallet/me/topup" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"amount\":$SOAK_TOPUP_AMOUNT}" >/dev/null || true
  else
    echo "[draw-soak] Klarte ikke hente token for topup. Fortsetter uten topup."
  fi
fi

echo "[draw-soak] Running realtime soak..."
echo "[draw-soak] scene=$SOAK_SCENE targetDraws=$SOAK_TARGET_DRAWS timeoutSeconds=$SOAK_TIMEOUT_SECONDS"
echo "[draw-soak] email=$SOAK_EMAIL"
echo "[draw-soak] log=$LOG_FILE"

"$UNITY_BIN" \
  -batchmode \
  -nographics \
  -projectPath "$PROJECT_PATH" \
  -executeMethod RealtimeDrawSoakTests.RunDrawSoakFromCommandLine \
  -soakScene "$SOAK_SCENE" \
  -soakApiBaseUrl "$SOAK_API_BASE_URL" \
  -soakEmail "$SOAK_EMAIL" \
  -soakPassword "$SOAK_PASSWORD" \
  -soakTargetDraws "$SOAK_TARGET_DRAWS" \
  -soakTimeoutSeconds "$SOAK_TIMEOUT_SECONDS" \
  -soakPlayPressIntervalSeconds "$SOAK_PLAY_PRESS_INTERVAL_SECONDS" \
  -logFile "$LOG_FILE"

if ! rg -n "\[DrawSoak\] RESULT status=PASS" "$LOG_FILE" >/dev/null; then
  echo "[draw-soak] Soak test did not PASS. Showing summary:" >&2
  rg -n "\[DrawSoak\]" "$LOG_FILE" | tail -n 120 >&2 || true
  exit 1
fi

echo "[draw-soak] PASS"
rg -n "\[DrawSoak\] RESULT" "$LOG_FILE" | tail -n 1
