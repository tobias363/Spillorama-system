#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Spillorama"}"
MANIFEST_FILE="${UNITY_VENDOR_MANIFEST_PATH:-"$ROOT_DIR/scripts/unity-vendor-sdk-manifest.tsv"}"

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Unity project path not found: $PROJECT_PATH" >&2
  exit 1
fi

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "Unity vendor manifest not found: $MANIFEST_FILE" >&2
  exit 1
fi

purpose_for_path() {
  case "$1" in
    "Assets/Best HTTP") echo "socket.io transport, JSON helpers, legacy networking" ;;
    "Assets/ExternalDependencyManager") echo "Firebase/Android dependency resolution" ;;
    "Assets/Firebase") echo "Firebase Messaging SDK" ;;
    "Assets/GPM") echo "mobile/webview glue used by webViewManager" ;;
    "Assets/I2") echo "localization layer" ;;
    "Assets/Plugins") echo "native/plugin binaries used by authored scripts" ;;
    "Assets/Vuplex") echo "embedded webview SDK" ;;
    *) echo "unknown" ;;
  esac
}

missing=0
while IFS=$'\t' read -r relative_path purpose || [[ -n "${relative_path:-}" ]]; do
  [[ -z "${relative_path:-}" ]] && continue
  full_path="$PROJECT_PATH/$relative_path"
  if [[ ! -e "$full_path" ]]; then
    echo "Missing required Unity vendor SDK path: $full_path" >&2
    echo "  Purpose: ${purpose:-$(purpose_for_path "$relative_path")}" >&2
    missing=1
  fi
done < "$MANIFEST_FILE"

if [[ "$missing" -ne 0 ]]; then
  cat >&2 <<EOF

Unity vendor dependency audit failed.

This repo tracks authored gameplay code, scenes, templates and project settings, but it does not yet fully vendor every third-party Unity SDK.
Provide a Unity project path that already contains the required SDK folders, for example:

  UNITY_PROJECT_PATH=/absolute/path/to/Spillorama bash scripts/unity-compile-check.sh

See docs/UNITY_VENDOR_SDK_BOOTSTRAP_2026-04-11.md for the current bootstrap contract.
EOF
  exit 1
fi

echo "Unity vendor dependency audit passed."
