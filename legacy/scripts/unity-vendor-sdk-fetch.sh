#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FETCH_DIR="${UNITY_VENDOR_FETCH_DIR:-"$HOME/.spillorama/unity-vendor-bundles"}"
ARCHIVE_URL="${1:-${UNITY_VENDOR_BUNDLE_URL:-}}"
MANIFEST_URL="${2:-${UNITY_VENDOR_BUNDLE_MANIFEST_URL:-}}"

usage() {
  cat <<USAGE
Usage: bash scripts/unity-vendor-sdk-fetch.sh [bundle-url] [manifest-url]

Environment overrides:
  UNITY_VENDOR_BUNDLE_URL
  UNITY_VENDOR_BUNDLE_MANIFEST_URL
  UNITY_VENDOR_FETCH_DIR
USAGE
}

if [[ -z "$ARCHIVE_URL" ]]; then
  usage >&2
  exit 1
fi

mkdir -p "$FETCH_DIR"

archive_name="$(basename "${ARCHIVE_URL%%\?*}")"
if [[ -z "$archive_name" || "$archive_name" == "/" || "$archive_name" == "." ]]; then
  archive_name="unity-vendor-sdk-remote.tar.gz"
fi
archive_path="$FETCH_DIR/$archive_name"

if [[ -z "$MANIFEST_URL" ]]; then
  if [[ "$ARCHIVE_URL" == *.tar.gz ]]; then
    MANIFEST_URL="${ARCHIVE_URL%.tar.gz}.manifest.tsv"
  else
    echo "Could not infer manifest URL from bundle URL: $ARCHIVE_URL" >&2
    echo "Set UNITY_VENDOR_BUNDLE_MANIFEST_URL or pass it explicitly." >&2
    exit 1
  fi
fi

manifest_name="$(basename "${MANIFEST_URL%%\?*}")"
if [[ -z "$manifest_name" || "$manifest_name" == "/" || "$manifest_name" == "." ]]; then
  manifest_name="unity-vendor-sdk-remote.manifest.tsv"
fi
manifest_path="$FETCH_DIR/$manifest_name"

curl -fL "$ARCHIVE_URL" -o "$archive_path"
curl -fL "$MANIFEST_URL" -o "$manifest_path"

bash "$ROOT_DIR/scripts/unity-vendor-sdk-verify.sh" "$archive_path" "$manifest_path"

ln -sfn "$archive_path" "$FETCH_DIR/latest.tar.gz"
ln -sfn "$manifest_path" "$FETCH_DIR/latest.manifest.tsv"

echo "Unity vendor SDK bundle fetched."
echo "  Directory: $FETCH_DIR"
echo "  Archive:   $archive_path"
echo "  Manifest:  $manifest_path"
echo "  Latest:    $FETCH_DIR/latest.tar.gz"
