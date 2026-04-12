#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Spillorama"}"
ARCHIVE_PATH="${1:-${UNITY_VENDOR_BUNDLE_PATH:-}}"
FORCE="${UNITY_VENDOR_RESTORE_FORCE:-0}"
MANIFEST_FILE="${UNITY_VENDOR_MANIFEST_PATH:-"$ROOT_DIR/scripts/unity-vendor-sdk-manifest.tsv"}"
BUNDLE_MANIFEST_PATH="${2:-${UNITY_VENDOR_BUNDLE_VERIFY_MANIFEST_PATH:-}}"

if [[ -z "$ARCHIVE_PATH" ]]; then
  echo "Usage: bash scripts/unity-vendor-sdk-restore.sh /absolute/path/to/unity-vendor-sdk.tar.gz" >&2
  exit 1
fi

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Unity vendor bundle not found: $ARCHIVE_PATH" >&2
  exit 1
fi

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "Unity vendor manifest not found: $MANIFEST_FILE" >&2
  exit 1
fi

if [[ -n "$BUNDLE_MANIFEST_PATH" && ! -f "$BUNDLE_MANIFEST_PATH" ]]; then
  echo "Unity vendor bundle verification manifest not found: $BUNDLE_MANIFEST_PATH" >&2
  exit 1
fi

mkdir -p "$PROJECT_PATH"

while IFS=$'\t' read -r relative_path _purpose || [[ -n "${relative_path:-}" ]]; do
  [[ -z "${relative_path:-}" ]] && continue
  target="$PROJECT_PATH/$relative_path"
  if [[ -e "$target" && "$FORCE" != "1" ]]; then
    echo "Target already exists: $target" >&2
    echo "Set UNITY_VENDOR_RESTORE_FORCE=1 to overwrite." >&2
    exit 1
  fi
done < "$MANIFEST_FILE"

if [[ -n "$BUNDLE_MANIFEST_PATH" ]]; then
  bash "$ROOT_DIR/scripts/unity-vendor-sdk-verify.sh" "$ARCHIVE_PATH" "$BUNDLE_MANIFEST_PATH"
else
  bash "$ROOT_DIR/scripts/unity-vendor-sdk-verify.sh" "$ARCHIVE_PATH"
fi

tar -xzf "$ARCHIVE_PATH" -C "$PROJECT_PATH"

"$ROOT_DIR/scripts/unity-vendor-sdk-audit.sh"

echo "Unity vendor SDK bundle restored into: $PROJECT_PATH"
