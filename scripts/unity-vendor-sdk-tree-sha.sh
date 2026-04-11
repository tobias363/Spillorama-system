#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: bash scripts/unity-vendor-sdk-tree-sha.sh /absolute/project/path relative/path" >&2
  exit 1
fi

BASE_DIR="$1"
RELATIVE_PATH="$2"
TARGET_PATH="$BASE_DIR/$RELATIVE_PATH"

if [[ ! -e "$TARGET_PATH" ]]; then
  echo "Path not found for hashing: $TARGET_PATH" >&2
  exit 1
fi

if [[ -f "$TARGET_PATH" ]]; then
  shasum -a 256 "$TARGET_PATH" | awk '{print $1}'
  exit 0
fi

(
  cd "$BASE_DIR"
  find "$RELATIVE_PATH" \( -type f -o -type l \) -print0 | sort -z | while IFS= read -r -d '' entry; do
    if [[ -L "$entry" ]]; then
      printf 'L\t%s\t%s\0' "$entry" "$(readlink "$entry")"
    else
      file_sha="$(shasum -a 256 "$entry" | awk '{print $1}')"
      printf 'F\t%s\t%s\0' "$entry" "$file_sha"
    fi
  done
) | shasum -a 256 | awk '{print $1}'
