#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${UNITY_PROJECT_PATH:-"$ROOT_DIR/Spillorama"}"
MANIFEST_FILE="${UNITY_VENDOR_MANIFEST_PATH:-"$ROOT_DIR/scripts/unity-vendor-sdk-manifest.tsv"}"
OUTPUT_DIR="${UNITY_VENDOR_BUNDLE_DIR:-"$ROOT_DIR/unity-vendor-bundles"}"
TIMESTAMP="$(date +"%Y%m%dT%H%M%S")"
BUNDLE_BASENAME="${UNITY_VENDOR_BUNDLE_NAME:-unity-vendor-sdk-$TIMESTAMP}"
ARCHIVE_PATH="${UNITY_VENDOR_BUNDLE_PATH:-"$OUTPUT_DIR/$BUNDLE_BASENAME.tar.gz"}"
REPORT_PATH="${UNITY_VENDOR_REPORT_PATH:-"$OUTPUT_DIR/$BUNDLE_BASENAME.manifest.tsv"}"

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Unity project path not found: $PROJECT_PATH" >&2
  exit 1
fi

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "Unity vendor manifest not found: $MANIFEST_FILE" >&2
  exit 1
fi

"$ROOT_DIR/scripts/unity-vendor-sdk-audit.sh"

mkdir -p "$OUTPUT_DIR"

relative_paths=()
{
  printf "path\tpurpose\tsize\tsha256\n"
  while IFS=$'\t' read -r relative_path purpose || [[ -n "${relative_path:-}" ]]; do
    [[ -z "${relative_path:-}" ]] && continue
    full_path="$PROJECT_PATH/$relative_path"
    size="$(du -sh "$full_path" | awk '{print $1}')"
    sha="$(tar -cf - -C "$PROJECT_PATH" "$relative_path" | shasum -a 256 | awk '{print $1}')"
    printf "%s\t%s\t%s\t%s\n" "$relative_path" "${purpose:-unknown}" "$size" "$sha"
    relative_paths+=("$relative_path")
  done < "$MANIFEST_FILE"
} > "$REPORT_PATH"

tar -czf "$ARCHIVE_PATH" -C "$PROJECT_PATH" "${relative_paths[@]}"

echo "Unity vendor SDK bundle created."
echo "  Archive: $ARCHIVE_PATH"
echo "  Manifest: $REPORT_PATH"
