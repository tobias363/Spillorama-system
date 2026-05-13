# pg_stat_statements — runbook

**Status:** Aktiv (OBS-7, 2026-05-14)
**Eier:** Backend-team / PM-AI
**Formål:** Bruk Postgres' innebygde query-stats-extension for å rangere
slow queries og oppdage N+1-mønstre i prod uten å gjette.

---

## TL;DR

```sql
-- Top 10 queries på total exec-time siden siste reset
SELECT
  substring(query, 1, 80) AS sample,
  calls,
  ROUND(total_exec_time::numeric, 1)  AS total_ms,
  ROUND(mean_exec_time::numeric, 2)   AS mean_ms,
  rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

---

## 1. Hva er pg_stat_statements

Postgres-extension som hooker inn i executor og samler aggregated
statistikk per **normalized** SQL-tekst. Normalisering betyr at
`SELECT * FROM users WHERE id = 42` og `SELECT * FROM users WHERE id = 7`
teller som **samme query** med `id = $1`.

Hver rad i view-en `pg_stat_statements` har:

| Kolonne | Hva |
|---|---|
| `queryid` | Stable hash av normalized text + db + role |
| `query` | Normalized SQL-tekst |
| `calls` | Antall ganger kjørt siden siste reset |
| `total_exec_time` | Total CPU-tid (ms) brukt på denne query-en |
| `mean_exec_time` | Snitt-tid (ms) per call |
| `min_exec_time` / `max_exec_time` | Min/max-latency |
| `stddev_exec_time` | Standardavvik (høy = ujevne latencies) |
| `rows` | Totalt antall rader returnert/påvirket |
| `shared_blks_hit` | Cache-hits |
| `shared_blks_read` | Disk-reads (høy → mangler index?) |

For pilot er det `total_exec_time`, `mean_exec_time` og `shared_blks_read`
som er viktigst.

---

## 2. Aktivere extension-en

### 2.1 Render-Postgres (prod)

`pg_stat_statements` krever at biblioteket lastes via
`shared_preload_libraries`. På Render gjøres dette via dashboard:

1. Logg inn på https://dashboard.render.com/
2. Velg `spillorama-db`-instansen
3. Settings → Database Configuration
4. Sett `shared_preload_libraries = pg_stat_statements`
5. Klikk **Restart Database** (~ 30 sek nedetid på pro_4gb-plan)

Etter restart:

```bash
# Verifiser via psql-tunnel
PGPASSWORD=... psql -h <render-host> -U spillorama -d spillorama -c "SHOW shared_preload_libraries;"
# Forventet: pg_stat_statements
```

Migration `20261225000000_enable_pg_stat_statements.sql` kjører
`CREATE EXTENSION IF NOT EXISTS pg_stat_statements` neste deploy.
Hvis steg 1-5 ikke er gjort feiler migrationen med:
```
ERROR: pg_stat_statements must be loaded via shared_preload_libraries
```
→ deploy aborter, app forblir på forrige versjon. Fix: gjør steg 1-5,
trigger redeploy.

### 2.2 Lokal Docker-stack

`docker-compose.yml` må overstyre Postgres-command for å laste libraryet.
Legg til:

```yaml
postgres:
  image: postgres:16-alpine
  command: >
    postgres
    -c shared_preload_libraries=pg_stat_statements
    -c pg_stat_statements.track=all
  ...
```

(Vi har IKKE gjort denne endringen automatisk — det er ops-valg om vi
vil ha pg_stat_statements på lokal dev. Migration kjører trygt uten —
den vil bare feile med tydelig feilmelding.)

### 2.3 Verifisere etter aktivering

```sql
\dx pg_stat_statements
-- Skal vise: pg_stat_statements | 1.10 | public | ...

SELECT count(*) FROM pg_stat_statements;
-- Skal returnere > 0 etter at appen har kjørt noen queries.
```

---

## 3. Cheatsheet: top-N queries

### 3.1 Slowest by total CPU-tid

```sql
SELECT
  substring(query, 1, 100) AS sample,
  calls,
  ROUND(total_exec_time::numeric, 1)  AS total_ms,
  ROUND(mean_exec_time::numeric, 2)   AS mean_ms,
  ROUND(stddev_exec_time::numeric, 2) AS stddev_ms,
  rows
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY total_exec_time DESC
LIMIT 20;
```

**Bruk:** Identifiser queries som spiser DB-CPU. Hvis én query har 30 % av
total exec-time, er det høyt-trafikk-path og kandidat for caching/index.

### 3.2 Slowest by mean exec-time (slow per-call)

```sql
SELECT
  substring(query, 1, 100) AS sample,
  calls,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND(max_exec_time::numeric, 2)  AS max_ms,
  rows / GREATEST(calls, 1)         AS avg_rows
FROM pg_stat_statements
WHERE calls > 10  -- ignorer queries som bare har kjørt 1-2 ganger
  AND query NOT LIKE '%pg_stat_statements%'
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**Bruk:** Finne tunge queries selv hvis de ikke kalles ofte. F.eks. admin-
rapporter kan ha 5s mean men kun 100 calls/dag → låg total_exec_time
men dårlig UX.

### 3.3 Most frequent queries (N+1-mistanke)

```sql
SELECT
  substring(query, 1, 100) AS sample,
  calls,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND((calls / GREATEST(EXTRACT(EPOCH FROM (now() - stats_since)), 1))::numeric, 1) AS calls_per_sec
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```

**Bruk:** Hvis én query har 100k calls og en annen i samme route har 1k
calls, er det N+1. Sjekk koden — manglende JOIN, manglende batch.

### 3.4 Queries med høy disk-read-ratio (manglende index?)

```sql
SELECT
  substring(query, 1, 100) AS sample,
  calls,
  shared_blks_read,
  shared_blks_hit,
  ROUND(
    100.0 * shared_blks_read / GREATEST(shared_blks_read + shared_blks_hit, 1),
    2
  ) AS disk_pct
FROM pg_stat_statements
WHERE shared_blks_read + shared_blks_hit > 1000
ORDER BY disk_pct DESC
LIMIT 20;
```

**Bruk:** `disk_pct > 50%` = mer disk-IO enn cache-hit = mangler index
eller table-scan på stor tabell. Match mot `EXPLAIN ANALYZE` for confirmation.

---

## 4. Anti-mønster-detection

### 4.1 Sequential scan på store tabeller

`pg_stat_statements` viser **ikke** scan-type direkte, men hint:

```sql
-- Hvis mean_exec_time stiger over tid for samme queryid, sjekk:
SELECT
  schemaname,
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  ROUND(100.0 * seq_scan / GREATEST(seq_scan + idx_scan, 1), 1) AS seq_pct
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 100
ORDER BY seq_pct DESC
LIMIT 20;
```

`seq_pct > 30%` på en tabell med > 10k rader = trolig manglende index.

### 4.2 Hot-spot queries

```sql
-- Queries som tar > 100ms mean_exec_time
SELECT substring(query, 1, 150) AS query, calls, mean_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;
```

For pilot bør **ingen** queries ha `mean_exec_time > 50ms` i steady-state.
Mass-payout-paths har egne batched-paths (PR #948) som unngår n × wallet-
debit.

---

## 5. Reset stats

`pg_stat_statements_reset()` krever superuser eller `pg_read_all_stats`-rolle.
På Render kjører vi appen som non-superuser, så denne kjøres manuelt via
psql-tunnel:

```sql
-- Krever superuser-rolle (Render → Database → Connect → External-tunnel
-- med admin-credentials)
SELECT pg_stat_statements_reset();
```

**Når å resette:**
- Etter en deploy som endrer query-shapes → reset for å få ren baseline
- Etter incident-debugging → reset slik at neste mål-perioden er ren
- ALDRI bare for å "rydde" — historikken er gratis å beholde

**Audit-trail:** noter timestamp + årsak i `docs/operations/PG_STATS_RESETS.md`
hvis vi reseter for incident-research. Ellers ikke nødvendig.

---

## 6. Integrasjoner

### 6.1 PgHero (OBS-8)

PgHero leser `pg_stat_statements` automatisk og viser top-N + suggested
indexes i sin UI. Wiringen er i `docker-compose.observability.yml` (eies
av OBS-8). PgHero kjører lokalt på port 8080.

### 6.2 OBS-6 `audit:db`-script

Backend-script `apps/backend/scripts/audit-db.mjs` (OBS-6) leser
`pg_stat_statements` og dumper top-20 inn i bug-report-bundle. Det betyr
at hver bug-report fra `/api/_dev/bug-report` inneholder DB-state for
korrelasjon.

### 6.3 Sentry DB-tracing (denne PR-en)

`apps/backend/src/observability/dbInstrumentation.ts` wrapper hver
`pool.query()` med en Sentry span. Sentry Performance-tab viser dermed
**per-request** DB-tid mens `pg_stat_statements` viser **aggregated**
DB-tid. De komplementerer hverandre.

---

## 7. Begrensninger

- **Normalization mister verdier.** Vi vet at en query kalles 100k
  ganger, men ikke om de fleste kallene har `id = 42` eller `id = 999`.
  For per-verdi-tracking bruk Sentry-spans.
- **5000-track-cap default.** Etter 5000 unike queryid-er resetter eldste
  rader automatisk. Vi har < 500 unike queries i hele kodebasen, så
  capen er ikke en bekymring.
- **Ikke per-tenant.** Aggregated på tvers av alle haller. Use Sentry-tags
  for per-hall debugging.

---

## 8. Referanser

- [Postgres docs: pg_stat_statements](https://www.postgresql.org/docs/16/pgstatstatements.html)
- ADR-0014 (forward-only migrations)
- Migration: `apps/backend/migrations/20261225000000_enable_pg_stat_statements.sql`
- OBS-6 script: `apps/backend/scripts/audit-db.mjs` (parallell agent eier)
- OBS-7 Sentry-tracing: `apps/backend/src/observability/dbInstrumentation.ts`
- OBS-8 PgHero: `docker-compose.observability.yml` (parallell agent eier)
