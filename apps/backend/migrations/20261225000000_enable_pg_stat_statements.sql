-- OBS-7 (2026-05-14): Aktiver pg_stat_statements-extension for DB-observability.
--
-- Bakgrunn:
--   For pilot-skala (1500 spillere × 4-hall) trenger vi å kunne identifisere
--   slow queries i prod uten å gjette. pg_stat_statements er Postgres' egen
--   query-stats-extension — den lagrer normalized query-tekst + aggregated
--   metrikker (calls, total_exec_time, mean_exec_time, rows, etc.) per query.
--
-- Hva extension-en gjør:
--   Hooker inn i Postgres' executor og populerer view-en `pg_stat_statements`
--   med én rad per normalized query (parametre erstattet med `$1`, `$2`,...).
--   PgHero, pgBadger og vår egen `audit:db`-script (OBS-6) kan deretter
--   spørre denne view-en for å rangere queries på cost.
--
-- KRITISK: shared_preload_libraries
--   Extension-en krever at `pg_stat_statements` står i Postgres'
--   `shared_preload_libraries`-config. På Render-Postgres er dette IKKE
--   default. Ops må sette dette via dashboard ELLER via env-var
--   `POSTGRES_SHARED_PRELOAD_LIBRARIES=pg_stat_statements` FØR
--   denne migrationen kjører. Hvis ikke, feiler `CREATE EXTENSION` med
--   "pg_stat_statements must be loaded via shared_preload_libraries".
--
--   Lokal Docker (`postgres:16-alpine`): kan settes via command-line:
--     command: postgres -c shared_preload_libraries=pg_stat_statements
--   Se PG_STAT_STATEMENTS_RUNBOOK.md §"Lokal-stack" for full oppsett.
--
-- Hva extension-en KOSTER:
--   ~1-2 % CPU-overhead, ~32 MB shared memory (default 5000-track-limit).
--   Negligible på Render `pro_4gb`-plan. Lavere overhead enn pgBadger
--   (som krever full query-log analyse).
--
-- Idempotens:
--   `CREATE EXTENSION IF NOT EXISTS` — re-kjøring er gratis.
--   `pg_stat_statements_reset()` kan kalles ad-hoc av ops uten ny migration.
--
-- Forward-only per ADR-0014. Hvis vi noen gang trenger å droppe extension,
-- skriv ny migration med `DROP EXTENSION IF EXISTS pg_stat_statements`.
--
-- Up

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Grant SELECT på view-en til vanlig app-rolle slik at `audit:db`-script og
-- PgHero kan lese den uten å være superuser. På Render kjører appen som
-- non-superuser, så denne grant-en er nødvendig.
--
-- NB: pg_stat_statements_reset() krever fortsatt superuser/pg_read_all_stats.
-- Ops må kjøre reset manuelt via Render psql-tunnel.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'pg_stat_statements') THEN
    -- Grant til current_user (app-rollen som kjører migrationen).
    EXECUTE 'GRANT SELECT ON pg_stat_statements TO ' || current_user;
  END IF;
END
$$;
