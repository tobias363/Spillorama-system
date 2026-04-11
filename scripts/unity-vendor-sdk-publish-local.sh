#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLISH_DIR="${UNITY_VENDOR_PUBLISH_DIR:-"$HOME/.spillorama/unity-vendor-bundles"}"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$PUBLISH_DIR"

UNITY_VENDOR_BUNDLE_DIR="$TMP_DIR" \
  bash "$ROOT_DIR/scripts/unity-vendor-sdk-package.sh"

archive_path="$(ls -t "$TMP_DIR"/*.tar.gz | head -n1)"
manifest_path="$(ls -t "$TMP_DIR"/*.manifest.tsv | head -n1)"

archive_name="$(basename "$archive_path")"
manifest_name="$(basename "$manifest_path")"

cp "$archive_path" "$PUBLISH_DIR/$archive_name"
cp "$manifest_path" "$PUBLISH_DIR/$manifest_name"

bash "$ROOT_DIR/scripts/unity-vendor-sdk-verify.sh" \
  "$PUBLISH_DIR/$archive_name" \
  "$PUBLISH_DIR/$manifest_name"

ln -sfn "$PUBLISH_DIR/$archive_name" "$PUBLISH_DIR/latest.tar.gz"
ln -sfn "$PUBLISH_DIR/$manifest_name" "$PUBLISH_DIR/latest.manifest.tsv"

echo "Unity vendor SDK bundle published."
echo "  Directory: $PUBLISH_DIR"
echo "  Archive:   $PUBLISH_DIR/$archive_name"
echo "  Manifest:  $PUBLISH_DIR/$manifest_name"
echo "  Latest:    $PUBLISH_DIR/latest.tar.gz"
