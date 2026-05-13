#!/bin/bash
## scripts/pgbadger-report.sh (OBS-8, 2026-05-14)
##
## Genererer pgBadger HTML-rapport fra Postgres-logger.
##
## Forutsetninger:
##  - Postgres må logge med log_destination='csvlog' og logging_collector=on
##  - PG_LOG_DIR-env må peke på katalogen med .log/.csv-filene
##  - Default: infra/observability/pglogs/ (lokal mock-katalog, tom inntil
##    du har konfigurert Postgres til å skrive hit)
##
## Output: infra/observability/data/pgbadger-YYYYMMDD-HHMMSS.html
##         + pgbadger-latest.html (symlink)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

OUTPUT_DIR="${REPO_ROOT}/infra/observability/data"
PG_LOG_DIR="${PG_LOG_DIR:-${REPO_ROOT}/infra/observability/pglogs}"

mkdir -p "${OUTPUT_DIR}"

## Kopier run-report.sh inn i output-mappa slik at pgBadger-containeren
## kan execve den (entrypoint må være innenfor mounted volumer).
cp "${REPO_ROOT}/infra/observability/pgbadger/run-report.sh" "${OUTPUT_DIR}/run-report.sh"
chmod +x "${OUTPUT_DIR}/run-report.sh"

## Sjekk om log-mappa er tom — gir bedre feilmelding enn pgBadger sin.
if [ -z "$(ls -A "${PG_LOG_DIR}" 2>/dev/null | grep -v '\.gitkeep')" ]; then
  echo "[pgbadger-report] FEIL: Ingen Postgres-logger funnet i:"
  echo "  ${PG_LOG_DIR}"
  echo
  echo "Du må konfigurere Postgres til å skrive CSV-logger til denne mappa."
  echo "Se docs/operations/PGHERO_PGBADGER_RUNBOOK.md §4 for full setup-guide."
  echo
  echo "Override med:"
  echo "  PG_LOG_DIR=/var/log/postgresql bash scripts/pgbadger-report.sh"
  exit 1
fi

echo "[pgbadger-report] Genererer rapport fra logger i:"
echo "  ${PG_LOG_DIR}"
echo

PG_LOG_DIR="${PG_LOG_DIR}" docker-compose -f docker-compose.observability.yml \
  --profile report \
  run --rm pgbadger

echo
echo "✅ Rapport ferdig:"
echo "   open infra/observability/data/pgbadger-latest.html"
