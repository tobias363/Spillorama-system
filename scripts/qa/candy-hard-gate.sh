#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_SETTINGS_FILE="$ROOT_DIR/Candy/ProjectSettings/EditorBuildSettings.asset"

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

RUN_BACKEND_CHECK="${CANDY_GATE_RUN_BACKEND_CHECK:-true}"
RUN_BACKEND_TESTS="${CANDY_GATE_RUN_BACKEND_TESTS:-true}"
RUN_UNITY_COMPILE="${CANDY_GATE_RUN_UNITY_COMPILE:-true}"
RUN_E2E="${CANDY_GATE_RUN_E2E:-false}"

echo "[candy-hard-gate] Root: $ROOT_DIR"

echo "[candy-hard-gate] Verifiserer Theme1 som eneste aktive build-scene..."
if [[ ! -f "$BUILD_SETTINGS_FILE" ]]; then
  echo "[candy-hard-gate] Mangler $BUILD_SETTINGS_FILE" >&2
  exit 1
fi

if ! rg -q "path: Assets/Scenes/Theme1.unity" "$BUILD_SETTINGS_FILE"; then
  echo "[candy-hard-gate] Theme1 mangler i EditorBuildSettings." >&2
  exit 1
fi

enabled_count="$(rg -c "enabled: 1" "$BUILD_SETTINGS_FILE")"
if [[ "$enabled_count" != "1" ]]; then
  echo "[candy-hard-gate] Forventet 1 aktiv scene, fant $enabled_count." >&2
  exit 1
fi

if is_true "$RUN_BACKEND_CHECK"; then
  echo "[candy-hard-gate] Kjorer backend check..."
  npm --prefix "$ROOT_DIR/backend" run check
fi

if is_true "$RUN_BACKEND_TESTS"; then
  echo "[candy-hard-gate] Kjorer backend tester..."
  npm --prefix "$ROOT_DIR/backend" run test
fi

if is_true "$RUN_UNITY_COMPILE"; then
  echo "[candy-hard-gate] Kjorer Unity compile-check..."
  bash "$ROOT_DIR/scripts/unity-compile-check.sh"
fi

if is_true "$RUN_E2E"; then
  echo "[candy-hard-gate] Kjorer E2E smoke..."
  : "${CANDY_API_BASE_URL:?Missing CANDY_API_BASE_URL}"
  : "${CANDY_ADMIN_EMAIL:?Missing CANDY_ADMIN_EMAIL}"
  : "${CANDY_ADMIN_PASSWORD:?Missing CANDY_ADMIN_PASSWORD}"
  if [[ -z "${CANDY_TEST_ACCESS_TOKEN:-}" && ( -z "${CANDY_TEST_EMAIL:-}" || -z "${CANDY_TEST_PASSWORD:-}" ) ]]; then
    echo "[candy-hard-gate] Sett CANDY_TEST_ACCESS_TOKEN eller CANDY_TEST_EMAIL+CANDY_TEST_PASSWORD" >&2
    exit 1
  fi

  bash "$ROOT_DIR/scripts/qa/test3-e2e-smoke.sh"
fi

echo "[candy-hard-gate] PASS"
