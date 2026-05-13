#!/usr/bin/env bash
# scripts/atlas-snapshot.sh
#
# OBS-9: snapshots the live schema (dev / staging / prod) into
# atlas/snapshots/<date>.sql so an operator can diff "what is actually in
# the database" against the checked-in baseline at
# apps/backend/schema/baseline.sql.
#
# Use cases:
#   - Pre-deploy verification: did anyone hand-apply SQL to prod?
#   - Post-incident: capture the state at the moment a ghost-migration
#     was suspected, before re-running migrations.
#   - Debugging schema-CI failures: see how the running database differs
#     from the baseline shadow-replay produces.
#
# This script is intentionally separate from `npm run schema:snapshot`
# (which uses Docker + pg_dump to refresh the baseline). The atlas
# snapshot uses Atlas's own inspector, which:
#   - Connects directly with the same URL the app uses (no Docker
#     needed if a target DB is already reachable).
#   - Produces a canonical SQL representation that matches what Atlas
#     uses internally for lint, so it round-trips cleanly with
#     `atlas migrate lint`.
#
# Usage:
#   # Snapshot whatever ATLAS_URL / APP_PG_CONNECTION_STRING points at:
#   bash scripts/atlas-snapshot.sh
#
#   # Snapshot prod (explicit; uses env "prod" from atlas.hcl):
#   APP_PG_CONNECTION_STRING="postgresql://..." \
#     bash scripts/atlas-snapshot.sh --env prod
#
#   # Snapshot local dev (default docker-compose URL):
#   bash scripts/atlas-snapshot.sh --env local \
#     --url postgresql://spillorama:spillorama@localhost:5432/spillorama
#
# Output: atlas/snapshots/<YYYY-MM-DD>.sql (timestamped, idempotent
# within a single calendar day — re-runs overwrite). The file is
# .gitignored on purpose (per-operator capture, not source of truth).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOT_DIR="$ROOT/atlas/snapshots"

ENV_NAME="local"
URL_OVERRIDE=""
OUTPUT_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)    ENV_NAME="$2"; shift 2 ;;
    --url)    URL_OVERRIDE="$2"; shift 2 ;;
    --output) OUTPUT_PATH="$2"; shift 2 ;;
    --help|-h)
      sed -n '1,40p' "$0" >&2
      exit 0
      ;;
    *)
      echo "[atlas-snapshot] Unknown flag: $1" >&2
      exit 64
      ;;
  esac
done

if ! command -v atlas >/dev/null 2>&1; then
  echo "[atlas-snapshot] atlas CLI not found." >&2
  echo "  Install: curl -sSf https://atlasgo.sh | sh" >&2
  echo "  Or:      brew install ariga/tap/atlas" >&2
  echo "  CI installs it via ariga/setup-atlas@v0." >&2
  exit 65
fi

# Resolve URL.
URL="${URL_OVERRIDE:-${APP_PG_CONNECTION_STRING:-${ATLAS_URL:-}}}"
if [[ -z "$URL" ]]; then
  echo "[atlas-snapshot] No database URL." >&2
  echo "  Pass --url postgresql://..." >&2
  echo "  Or set APP_PG_CONNECTION_STRING / ATLAS_URL in env." >&2
  exit 64
fi

# Resolve output path. Default: atlas/snapshots/<YYYY-MM-DD>.sql.
if [[ -z "$OUTPUT_PATH" ]]; then
  DATE="$(date +%Y-%m-%d)"
  OUTPUT_PATH="$SNAPSHOT_DIR/$DATE.sql"
fi
mkdir -p "$(dirname "$OUTPUT_PATH")"

echo "[atlas-snapshot] env=$ENV_NAME" >&2
echo "[atlas-snapshot] url=${URL//:*@/:***@}" >&2  # mask password
echo "[atlas-snapshot] output=$OUTPUT_PATH" >&2

# Atlas inspect writes SQL (-f sql) representation of the current
# schema. We restrict to schema=public so we don't capture internal
# pg_catalog noise. The exit status is propagated.
atlas schema inspect \
  --env "$ENV_NAME" \
  --url "$URL" \
  --schema public \
  --format '{{ sql . "  " }}' \
  > "$OUTPUT_PATH"

LINES=$(wc -l < "$OUTPUT_PATH" | tr -d '[:space:]')
echo "[atlas-snapshot] Wrote $OUTPUT_PATH ($LINES lines)" >&2
echo "" >&2
echo "Compare against the checked-in baseline:" >&2
echo "  diff -U 3 apps/backend/schema/baseline.sql $OUTPUT_PATH | less" >&2
echo "" >&2
echo "If they diverge, see docs/operations/SCHEMA_AS_CODE_RUNBOOK.md." >&2
