#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Spillorama"}"
RUN_TESTS="${UNITY_BOOTSTRAP_RUN_TESTS:-0}"
FORCE_RESTORE="${UNITY_VENDOR_RESTORE_FORCE:-0}"
EXPLICIT_BUNDLE_PATH="${UNITY_VENDOR_BUNDLE_PATH:-}"

usage() {
  cat <<EOF
Usage: bash scripts/unity-bootstrap.sh [--bundle /absolute/path/to/bundle.tar.gz] [--with-tests] [--force]

Behavior:
  1. Resolve the Unity project path
  2. Run vendor SDK audit
  3. If vendor SDKs are missing, locate a bundle and restore it
  4. Re-run vendor SDK audit
  5. Optionally run the Unity smoke suite

Environment overrides:
  UNITY_PROJECT_PATH
  UNITY_VENDOR_BUNDLE_PATH
  UNITY_BOOTSTRAP_RUN_TESTS=1
  UNITY_VENDOR_RESTORE_FORCE=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      EXPLICIT_BUNDLE_PATH="${2:-}"
      shift 2
      ;;
    --with-tests)
      RUN_TESTS=1
      shift
      ;;
    --force)
      FORCE_RESTORE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

find_latest_bundle() {
  local dir
  for dir in \
    "$HOME/.spillorama/unity-vendor-bundles" \
    "$HOME/Library/Application Support/Spillorama/unity-vendor-bundles" \
    "$ROOT_DIR/unity-vendor-bundles"
  do
    if [[ -d "$dir" ]]; then
      latest="$(ls -t "$dir"/*.tar.gz 2>/dev/null | head -n1 || true)"
      if [[ -n "$latest" ]]; then
        printf "%s\n" "$latest"
        return 0
      fi
    fi
  done
  return 1
}

echo "Unity bootstrap project path: $PROJECT_PATH"

needs_restore=1
if [[ -d "$PROJECT_PATH" ]]; then
  if bash "$ROOT_DIR/scripts/unity-vendor-sdk-audit.sh"; then
    echo "Unity vendor SDKs already present."
    needs_restore=0
  fi
else
  echo "Unity project path does not exist yet. Skipping initial audit and preparing restore."
fi

if [[ "$needs_restore" == "1" ]]; then
  bundle_path="$EXPLICIT_BUNDLE_PATH"
  if [[ -z "$bundle_path" ]]; then
    bundle_path="$(find_latest_bundle || true)"
  fi

  if [[ -z "$bundle_path" ]]; then
    echo "No Unity vendor bundle found." >&2
    echo "Checked:" >&2
    echo "  - UNITY_VENDOR_BUNDLE_PATH" >&2
    echo "  - $ROOT_DIR/unity-vendor-bundles" >&2
    echo "  - $HOME/.spillorama/unity-vendor-bundles" >&2
    echo "  - $HOME/Library/Application Support/Spillorama/unity-vendor-bundles" >&2
    exit 1
  fi

  echo "Restoring Unity vendor bundle: $bundle_path"
  UNITY_PROJECT_PATH="$PROJECT_PATH" \
  UNITY_VENDOR_RESTORE_FORCE="$FORCE_RESTORE" \
  bash "$ROOT_DIR/scripts/unity-vendor-sdk-restore.sh" "$bundle_path"
fi

bash "$ROOT_DIR/scripts/unity-vendor-sdk-audit.sh"

if [[ "$RUN_TESTS" == "1" ]]; then
  bash "$ROOT_DIR/scripts/unity-compile-check.sh"
  bash "$ROOT_DIR/scripts/unity-theme2-smoke.sh"
  bash "$ROOT_DIR/scripts/unity-game-panel-smoke.sh"
  bash "$ROOT_DIR/scripts/unity-game-flow-contract-smoke.sh"
  bash "$ROOT_DIR/scripts/unity-game-panel-lifecycle-smoke.sh"
  bash "$ROOT_DIR/scripts/unity-game-interaction-contract-smoke.sh"
  bash "$ROOT_DIR/scripts/unity-game-runtime-state-smoke.sh"
fi

echo "Unity bootstrap completed."
