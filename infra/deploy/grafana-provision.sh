#!/usr/bin/env bash
# BIN-539: Provision Spillorama Grafana dashboards from infra/grafana/dashboards/.
#
# Uploads each dashboard JSON to the Grafana instance referenced by
# GRAFANA_URL using a service-account API token (GRAFANA_API_KEY). Uses
# the POST /api/dashboards/db endpoint which upserts by uid. Running
# the script twice is idempotent — existing dashboards are overwritten
# with version bumped.
#
# Usage:
#   GRAFANA_URL=https://grafana.internal \
#   GRAFANA_API_KEY=eyJrIjoi...        \
#   [GRAFANA_FOLDER_UID=spillorama]     \  # optional, defaults to General (0)
#   ./infra/deploy/grafana-provision.sh
#
# Prereqs:
#   - curl, jq
#   - Service-account token with `Dashboards:Write` scope
#   - Prometheus datasource already configured in the target Grafana
#     (dashboards reference it via the ${DS_PROM} template variable)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARDS_DIR="$(cd "$SCRIPT_DIR/../grafana/dashboards" && pwd)"

: "${GRAFANA_URL:?GRAFANA_URL must be set (e.g. https://grafana.internal)}"
: "${GRAFANA_API_KEY:?GRAFANA_API_KEY must be set (service-account token with Dashboards:Write)}"
GRAFANA_URL="${GRAFANA_URL%/}"
FOLDER_UID="${GRAFANA_FOLDER_UID:-}"

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "FATAL: $cmd is required but not installed." >&2
    exit 1
  fi
done

if [[ ! -d "$DASHBOARDS_DIR" ]]; then
  echo "FATAL: dashboards dir not found: $DASHBOARDS_DIR" >&2
  exit 1
fi

echo "Provisioning dashboards from $DASHBOARDS_DIR to $GRAFANA_URL"
if [[ -n "$FOLDER_UID" ]]; then
  echo "Target folder uid: $FOLDER_UID"
fi

shopt -s nullglob
files=("$DASHBOARDS_DIR"/*.json)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No dashboards found — nothing to do." >&2
  exit 0
fi

status=0
for dashboard_file in "${files[@]}"; do
  name="$(basename "$dashboard_file")"
  # Wrap the file in the API-required {dashboard: ..., overwrite: true,
  # folderUid: ...} envelope. Using jq keeps the inner JSON intact
  # instead of bash-interpolating it (safer for special chars).
  if [[ -n "$FOLDER_UID" ]]; then
    payload=$(jq --arg folder "$FOLDER_UID" \
      '{dashboard: ., overwrite: true, folderUid: $folder, message: "BIN-539 provision-script upload"}' \
      "$dashboard_file")
  else
    payload=$(jq \
      '{dashboard: ., overwrite: true, message: "BIN-539 provision-script upload"}' \
      "$dashboard_file")
  fi

  echo ">> Uploading $name"
  response=$(curl --silent --show-error --fail-with-body \
    --request POST \
    --header "Authorization: Bearer $GRAFANA_API_KEY" \
    --header "Content-Type: application/json" \
    --data "$payload" \
    "$GRAFANA_URL/api/dashboards/db") || {
      echo "   ✗ upload failed for $name"
      status=1
      continue
    }

  uid=$(echo "$response" | jq -r '.uid // empty')
  version=$(echo "$response" | jq -r '.version // empty')
  url=$(echo "$response" | jq -r '.url // empty')
  if [[ -n "$uid" ]]; then
    echo "   ✓ uid=$uid version=$version url=$GRAFANA_URL$url"
  else
    echo "   ? response: $response"
  fi
done

if [[ $status -ne 0 ]]; then
  echo "One or more dashboards failed to upload." >&2
  exit 1
fi

echo "All dashboards provisioned."
