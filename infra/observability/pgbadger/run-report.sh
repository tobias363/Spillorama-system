#!/bin/bash
## infra/observability/pgbadger/run-report.sh
##
## Wrapper-entrypoint for pgBadger-container. Genererer HTML-rapport fra
## Postgres-logger og skriver til /output/pgbadger-YYYYMMDD.html.
##
## Kjøres KUN fra Docker-container (dalibo/pgbadger image). Lokalt kjøres
## via `scripts/pgbadger-report.sh` som wrapper.
##
## Forventer:
##   /var/log/postgresql/*.{log,csv}  — Postgres-logger (read-only mount)
##   /output                          — bind-mount til infra/observability/data/

set -euo pipefail

DATE_STAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="/output/pgbadger-${DATE_STAMP}.html"
LATEST_SYMLINK="/output/pgbadger-latest.html"

echo "[pgbadger] Skanner /var/log/postgresql/ for Postgres-logger..."
LOG_FILES=$(find /var/log/postgresql -maxdepth 2 -type f \( -name "*.log" -o -name "*.csv" \) 2>/dev/null | head -100)

if [ -z "${LOG_FILES}" ]; then
  echo "[pgbadger] FEIL: Ingen log-filer i /var/log/postgresql/."
  echo "[pgbadger] Sjekk at PG_LOG_DIR er satt og at Postgres er konfigurert"
  echo "[pgbadger] til å logge (se docs/operations/PGHERO_PGBADGER_RUNBOOK.md §4)."
  exit 1
fi

echo "[pgbadger] Fant logger:"
echo "${LOG_FILES}" | sed 's/^/  /'

## Velg log-format basert på filendelse. CSV gir mest presis parsing.
LOG_FORMAT="stderr"
if echo "${LOG_FILES}" | grep -q "\.csv$"; then
  LOG_FORMAT="csv"
fi

echo "[pgbadger] Bruker log-format: ${LOG_FORMAT}"
echo "[pgbadger] Genererer rapport til ${OUTPUT_FILE}..."

pgbadger \
  --format "${LOG_FORMAT}" \
  --outfile "${OUTPUT_FILE}" \
  --title "Spillorama Postgres rapport — ${DATE_STAMP}" \
  --quiet \
  ${LOG_FILES}

## Lag/oppdater symlink til siste rapport — kan åpnes uten å vite dato.
ln -sf "$(basename "${OUTPUT_FILE}")" "${LATEST_SYMLINK}"

echo "[pgbadger] Ferdig. Åpne:"
echo "  infra/observability/data/$(basename "${OUTPUT_FILE}")"
echo "  infra/observability/data/pgbadger-latest.html  (symlink til siste)"
