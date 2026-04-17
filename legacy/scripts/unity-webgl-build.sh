#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_RELEASE_ENV_FILE="$ROOT_DIR/scripts/release.env"
RELEASE_ENV_FILE="${RELEASE_ENV_FILE:-$DEFAULT_RELEASE_ENV_FILE}"

if [[ -f "$RELEASE_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$RELEASE_ENV_FILE"
  set +a
  echo "[unity-webgl-build] Lastet env fra: $RELEASE_ENV_FILE"
fi

PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Spillorama"}"
UNITY_BIN="${UNITY_BIN:-}"
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
      echo "[unity-webgl-build] Auto-detektert Unity-bin fra ProjectVersion: $UNITY_BIN"
    fi
  fi
fi

if [[ -z "$UNITY_BIN" ]]; then
  UNITY_BIN="/Applications/Unity/Hub/Editor/2021.3.8f1/Unity.app/Contents/MacOS/Unity"
  echo "[unity-webgl-build] Fallback Unity-bin i bruk: $UNITY_BIN"
fi

RELEASE_VERSION="${SYSTEM_RELEASE_VERSION:-$(date -u +"%Y%m%d-%H%M%S")}"
RELEASE_COMMIT="${SYSTEM_RELEASE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
OUTPUT_DIR="${UNITY_WEBGL_OUTPUT_DIR:-"$ROOT_DIR/SpilloramaBuilds/releases/$RELEASE_VERSION"}"
LOG_DIR="${UNITY_BUILD_LOG_DIR:-"$ROOT_DIR/SpilloramaBuilds/logs"}"
LOG_FILE="${UNITY_WEBGL_BUILD_LOG:-"$LOG_DIR/webgl-build-$RELEASE_VERSION.log"}"
RUN_COMPILE_CHECK="${RUN_UNITY_COMPILE_CHECK:-true}"
RUN_THEME2_SMOKE="${RUN_THEME2_SMOKE:-false}"

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

if [[ ! -x "$UNITY_BIN" ]]; then
  echo "[unity-webgl-build] Unity binary finnes ikke eller er ikke kjørbar: $UNITY_BIN" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "[unity-webgl-build] Unity project path finnes ikke: $PROJECT_PATH" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$OUTPUT_DIR"

echo "[unity-webgl-build] Release: $RELEASE_VERSION ($RELEASE_COMMIT)"
echo "[unity-webgl-build] Output: $OUTPUT_DIR"
echo "[unity-webgl-build] Log: $LOG_FILE"

if is_true "$RUN_COMPILE_CHECK"; then
  echo "[unity-webgl-build] Kjører compile-check..."
  UNITY_COMPILE_LOG="$LOG_DIR/compile-$RELEASE_VERSION.log" \
    UNITY_PROJECT_PATH="$PROJECT_PATH" \
    UNITY_BIN="$UNITY_BIN" \
    bash "$ROOT_DIR/scripts/unity-compile-check.sh"
fi

if is_true "$RUN_THEME2_SMOKE"; then
  echo "[unity-webgl-build] Kjører Theme2 smoke..."
  UNITY_THEME2_SMOKE_LOG="$LOG_DIR/theme2-smoke-$RELEASE_VERSION.log" \
    UNITY_PROJECT_PATH="$PROJECT_PATH" \
    UNITY_BIN="$UNITY_BIN" \
    bash "$ROOT_DIR/scripts/unity-theme2-smoke.sh"
fi

echo "[unity-webgl-build] Starter batch build..."
"$UNITY_BIN" \
  -batchmode \
  -nographics \
  -quit \
  -projectPath "$PROJECT_PATH" \
  -executeMethod WebGLBatchBuild.BuildWebGL \
  -outputPath "$OUTPUT_DIR" \
  -logFile "$LOG_FILE"

if [[ ! -f "$OUTPUT_DIR/index.html" ]]; then
  echo "[unity-webgl-build] index.html mangler i build output: $OUTPUT_DIR" >&2
  exit 1
fi

if [[ ! -f "$OUTPUT_DIR/release.json" ]]; then
  cat > "$OUTPUT_DIR/release.json" <<EOF
{
  "releaseVersion": "$RELEASE_VERSION",
  "releaseCommit": "$RELEASE_COMMIT",
  "builtAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "outputDir": "$OUTPUT_DIR"
}
EOF
fi

echo "[unity-webgl-build] OK."
