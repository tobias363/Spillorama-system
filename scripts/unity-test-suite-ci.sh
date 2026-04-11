#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${UNITY_VENDOR_BUNDLE_URL:-}" ]]; then
  echo "UNITY_VENDOR_BUNDLE_URL is required for CI/bootstrap on machines without local vendor bundles." >&2
  exit 1
fi

exec bash "$ROOT_DIR/scripts/unity-bootstrap.sh" --with-tests "$@"
