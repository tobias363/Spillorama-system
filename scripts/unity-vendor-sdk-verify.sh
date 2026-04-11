#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE_PATH="${1:-${UNITY_VENDOR_BUNDLE_PATH:-}}"
MANIFEST_PATH="${2:-${UNITY_VENDOR_BUNDLE_VERIFY_MANIFEST_PATH:-}}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

resolve_manifest_path() {
  local archive_path="$1"
  local candidate=""

  if [[ -n "${MANIFEST_PATH:-}" ]]; then
    printf "%s\n" "$MANIFEST_PATH"
    return 0
  fi

  if [[ "$archive_path" == *.tar.gz ]]; then
    candidate="${archive_path%.tar.gz}.manifest.tsv"
    if [[ -f "$candidate" ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  fi

  candidate="$(dirname "$archive_path")/latest.manifest.tsv"
  if [[ -f "$candidate" ]]; then
    printf "%s\n" "$candidate"
    return 0
  fi

  return 1
}

if [[ -z "$ARCHIVE_PATH" ]]; then
  echo "Usage: bash scripts/unity-vendor-sdk-verify.sh /absolute/path/to/unity-vendor-sdk.tar.gz [optional-manifest-path]" >&2
  exit 1
fi

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Unity vendor bundle not found: $ARCHIVE_PATH" >&2
  exit 1
fi

if ! MANIFEST_PATH="$(resolve_manifest_path "$ARCHIVE_PATH")"; then
  echo "Could not resolve manifest for Unity vendor bundle: $ARCHIVE_PATH" >&2
  echo "Provide a sibling *.manifest.tsv or pass it explicitly as the second argument." >&2
  exit 1
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Unity vendor bundle manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

verified=0
while IFS=$'\t' read -r relative_path _purpose _size expected_sha || [[ -n "${relative_path:-}" ]]; do
  [[ -z "${relative_path:-}" ]] && continue
  if [[ "$relative_path" == "path" ]]; then
    continue
  fi

  extracted_path="$TMP_DIR/$relative_path"
  if [[ ! -e "$extracted_path" ]]; then
    echo "Bundle verification failed. Missing path in archive: $relative_path" >&2
    exit 1
  fi

  actual_sha="$(bash "$ROOT_DIR/scripts/unity-vendor-sdk-tree-sha.sh" "$TMP_DIR" "$relative_path")"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "Bundle verification failed. SHA mismatch for: $relative_path" >&2
    echo "  Expected: $expected_sha" >&2
    echo "  Actual:   $actual_sha" >&2
    exit 1
  fi

  verified=$((verified + 1))
done < "$MANIFEST_PATH"

if [[ "$verified" -eq 0 ]]; then
  echo "Unity vendor bundle manifest did not contain any entries: $MANIFEST_PATH" >&2
  exit 1
fi

echo "Unity vendor SDK bundle verification passed."
echo "  Archive:  $ARCHIVE_PATH"
echo "  Manifest: $MANIFEST_PATH"
