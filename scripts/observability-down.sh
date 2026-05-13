#!/bin/bash
## scripts/observability-down.sh (OBS-8, 2026-05-14)
##
## River ned PgHero + pgBadger-stacken. Hoved-dev-stacken (backend,
## Postgres, Redis) berøres IKKE.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "[observability-down] River ned PgHero + pgBadger-stack..."
docker-compose -f docker-compose.observability.yml down

echo
echo "✅ Observability-stack stoppet."
echo
echo "Generelle rapporter beholdes i infra/observability/data/ (gitignored)."
echo "Hoved-dev-stacken (backend/postgres/redis) er IKKE påvirket."
