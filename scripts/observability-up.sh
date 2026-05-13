#!/bin/bash
## scripts/observability-up.sh (OBS-8, 2026-05-14)
##
## Starter PgHero som lokal DB-dashboard. Kjøres ved siden av
## hoved-dev-stacken — verken backend eller Postgres berøres.
##
## Krav: docker-compose installert + Postgres kjørende på host (typisk
## via `docker-compose up -d postgres redis` fra hoved-stacken).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "[observability-up] Starter PgHero..."
echo

## Verifiser at Postgres er nåbar. Ikke fatalt hvis den ikke er det —
## PgHero starter uansett, men dashbordet vil vise "connection refused".
if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -h localhost -p 5432 -U spillorama -q 2>/dev/null; then
    echo "[observability-up] ADVARSEL: Postgres på localhost:5432 svarer ikke."
    echo "[observability-up] PgHero starter uansett, men dashbordet vil vise"
    echo "[observability-up] tilkoblingsfeil. Start hoved-stacken først:"
    echo "[observability-up]   docker-compose up -d postgres redis"
    echo
  fi
fi

## Start PgHero (pgbadger har profile=report → trigges ikke av default up).
docker-compose -f docker-compose.observability.yml up -d pghero

## Liten pause så Rails-prosessen rekker å boote før vi sjekker.
sleep 2

if docker ps --filter "name=spillorama-pghero" --filter "status=running" --format "{{.Names}}" | grep -q spillorama-pghero; then
  PGHERO_USER="${PGHERO_USERNAME:-admin}"
  PGHERO_PASS="${PGHERO_PASSWORD:-spillorama-2026-test}"
  PGHERO_PORT_VAL="${PGHERO_PORT:-8080}"

  echo
  echo "✅ PgHero kjører på http://localhost:${PGHERO_PORT_VAL}"
  echo
  echo "   Login:    ${PGHERO_USER}"
  echo "   Passord:  ${PGHERO_PASS}"
  echo
  echo "Når du har slow queries i pg_stat_statements, åpne dashbordet:"
  echo "   open http://localhost:${PGHERO_PORT_VAL}"
  echo
  echo "Andre kommandoer:"
  echo "   bash scripts/pgbadger-report.sh    # generer pgBadger HTML-rapport"
  echo "   bash scripts/observability-down.sh # tear down stack"
  echo
  echo "Dokumentasjon: docs/operations/PGHERO_PGBADGER_RUNBOOK.md"
else
  echo
  echo "❌ PgHero startet ikke korrekt. Sjekk logger:"
  echo "   docker-compose -f docker-compose.observability.yml logs pghero"
  exit 1
fi
