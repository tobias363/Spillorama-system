# pgBouncer setup — runbook

**Status:** Aktiv (OBS-7, 2026-05-14)
**Eier:** Backend-team / PM-AI
**Formål:** Connection-pooling-arkitektur for 4-hall × 1500-spiller-pilot.

---

## TL;DR

```bash
# Lokal-stack med pgBouncer:
docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml up -d
export PGBOUNCER_URL=postgres://spillorama:spillorama@localhost:6432/spillorama
npm --prefix apps/backend run dev
```

App-queries går nå via pgBouncer på port 6432. Migrations bruker
fortsatt port 5432 direkte (via `APP_PG_CONNECTION_STRING`).

---

## 1. Hvorfor pgBouncer

### Skala-regning

Render Postgres `pro_4gb` har `max_connections ≈ 100` (75 effektivt etter
superuser-reservasjon). Med 4-hall × 1500 spiller-WebSocket-connections
har vi følgende profil:

| Scenario | DB-connections |
|---|---|
| Baseline (steady-state) | ~30 (shared+wallet pool max 20 hver) |
| Master starter runde | spike til ~50 (bonge-purchase + draw-tick) |
| Mass-payout (75 vinnere × 4 queries) | spike til ~70 |
| Worst-case (instans-restart med queue-up) | spike til ~100+ → cap-overskridelse |

Uten pgBouncer ramper vi opp mot `max_connections` ved hver mass-payout-
spike. Med pgBouncer i transaction-mode multiplexes 1500+ logiske
connections over 20 fysiske connections.

### Hvordan pooling fungerer

```
1500 spillere → WebSocket-handler → app-pool (20 slots)
       ↓
   pool.query("...")
       ↓
[ pgBouncer (200 client slots) ]    ← multiplexer
       ↓
   20 fysiske Postgres-connections   ← det som teller mot max_connections
       ↓
   Postgres
```

Transaction-mode: en server-connection er bundet til klient KUN under
en aktiv transaksjon (BEGIN…COMMIT). Mellom transaksjoner kan
connection-en resirkuleres til en annen klient.

---

## 2. Pool-mode: hvorfor transaction (ikke session)

| Pool-mode | Multiplexing | Begrensninger |
|---|---|---|
| Session | Ingen — én klient eier én server-connection | Få fordeler vs ingen pooler |
| **Transaction** | High — server-conn frigjort etter COMMIT | Ingen `SET` (session-state), ingen `LISTEN/NOTIFY` |
| Statement | Maks — server-conn frigjort etter hver query | Ingen transaksjoner, prepared statements |

Spillorama bruker **transaction-mode** fordi:
- Wallet-mutering bruker `BEGIN/COMMIT` REPEATABLE READ (BIN-762) — virker
  i transaction-mode
- Wallet bruker `pg_advisory_xact_lock` (transaction-scoped) — virker
- Vi bruker IKKE `pg_advisory_lock` (session-scoped) noe sted
- Vi bruker IKKE `LISTEN/NOTIFY` — alt går via Redis/Socket.IO
- `SET LOCAL` (per-transaction) brukes i `idempotencyAdapter.ts` — virker

### Prepared statements

node-pg sender prepared statements via `named` parameter. pgBouncer 1.21+
har native support for prepared statements i transaction-mode (intern
caching). Vi krever 1.21+ i `docker-compose.pgbouncer.yml` (`1.23.1`).

Hvis vi noen gang ser warnings som `ERROR: prepared statement "..." does
not exist`, sjekk pgBouncer-versjon.

---

## 3. Connection-string-format

### App (runtime queries)

```
postgres://<user>:<password>@<pgbouncer-host>:6432/<dbname>?...
```

`PGBOUNCER_URL` overstyrer `APP_PG_CONNECTION_STRING` i `sharedPool.ts`.
Hvis `PGBOUNCER_URL` er tom-string eller unset, bruker app-en
`APP_PG_CONNECTION_STRING` direkte (default-adferd).

### Migrations (direct queries)

Migrations bruker session-level state og MÅ gå direkte mot Postgres:

```
postgres://<user>:<password>@<postgres-host>:5432/<dbname>?...
```

`render.yaml`-buildCommand setter:
```bash
APP_PG_CONNECTION_STRING="${DATABASE_URL_DIRECT:-$APP_PG_CONNECTION_STRING}" \
  npm --prefix apps/backend run migrate
```

`DATABASE_URL_DIRECT` skal peke direkte mot Postgres (port 5432) når
pgBouncer er aktivert. Når PGBOUNCER_URL ikke er satt, kan
`DATABASE_URL_DIRECT` også være unset → migrate kjører som før.

---

## 4. Monitoring

### 4.1 Live stats via psql

```bash
psql -h localhost -p 6432 -U spillorama pgbouncer
```

pgBouncer eksponerer en admin-DB kalt `pgbouncer` (intern). Inni kan vi
kjøre:

```
SHOW STATS;
-- Per database: total_xact_count, total_query_count, total_query_time,
-- avg_query_time osv.

SHOW POOLS;
-- cl_active, cl_waiting, sv_active, sv_idle, maxwait
-- maxwait > 0 = klienter venter på server-connection. Alarm-signal.

SHOW CLIENTS;
-- Liste over alle klient-connections med state (active/waiting/idle)

SHOW SERVERS;
-- Liste over server-connections til Postgres (max DEFAULT_POOL_SIZE per pool)
```

### 4.2 Alerting

PgBouncer publiserer ikke Prometheus-metrikker out-of-the-box. To
alternativer:

1. **pgbouncer_exporter** (separate container) — leser SHOW STATS hvert
   intervall og eksponerer Prometheus. Anbefalt for prod.
2. **Custom cron via `audit:db`** (OBS-6) — kan plukke SHOW STATS og legge
   det i bug-report-bundle.

For pilot: kun dashboard-watching via `SHOW POOLS` ad-hoc. Alert-rules
post-pilot når vi har bekreftet at pooling-helse er stabil.

### 4.3 Key metrics å watch

| Metric | Hva | Alarm |
|---|---|---|
| `maxwait` (SHOW POOLS) | Lengste tid en klient har ventet på server-conn | > 0 i steady-state |
| `cl_waiting` | Klienter i kø | > 0 vedvarende |
| `total_query_time / total_query_count` | Snitt query-tid | > baseline + 50 % |
| `total_received - total_sent` | Bytes ubehandlet | Stiger uten å falle |

---

## 5. Failover-strategi

### 5.1 Hvis pgBouncer-container faller

Når `PGBOUNCER_URL` er satt og pgBouncer er nede, kaster `pg.Pool` connection-
errors. Backend logger via `[sharedPool] error` og fortsetter å prøve.

**Recovery-prosedyre:**

1. Detect via Render-dashboard eller `docker compose ps` (lokal)
2. Restart pgBouncer-container: `docker compose -f docker-compose.pgbouncer.yml restart pgbouncer`
3. Verifiser via `psql -h localhost -p 6432 ...`
4. Backend gjenopptas automatisk når connection-er etablert

### 5.2 Nødfall-bypass

Hvis pgBouncer er nede > 5 min og ikke kan repareres, bypass:

```bash
# Lokal
unset PGBOUNCER_URL
npm --prefix apps/backend run dev

# Render
# Dashboard → service → Environment → fjern PGBOUNCER_URL → redeploy
```

Backend faller tilbake til direkte Postgres-connections via
`APP_PG_CONNECTION_STRING`. Slik unngås full outage.

**NB:** Bypass øker `max_connections`-pressure. Hold pilot-trafikk lav til
pgBouncer er restored.

---

## 6. Pilot-readiness-checklist

- [ ] `docker-compose.pgbouncer.yml` mergeable med hoved-stack
- [ ] `psql -h localhost -p 6432` returnerer rad
- [ ] Backend boot-log viser `[sharedPool] OBS-7: routing via pgBouncer`
- [ ] `SHOW POOLS` viser `maxwait = 0` under normal load
- [ ] Mass-payout-test (10+ samtidige wallet-debits) holder pool-cap
- [ ] Migration kjører OK med `DATABASE_URL_DIRECT` på sidelinjen
- [ ] Sentry DB-tracing fanger queries (verifisert i Sentry Performance)
- [ ] pg_stat_statements logger queries (verifisert via `SELECT count(*)
  FROM pg_stat_statements`)

---

## 7. Referanser

- [pgBouncer docs](https://www.pgbouncer.org/usage.html)
- [PgBouncer 1.21 release notes (prepared statements)](https://www.pgbouncer.org/changelog.html#pgbouncer-121x)
- Migration: `apps/backend/migrations/20261225000000_enable_pg_stat_statements.sql`
- Compose: `docker-compose.pgbouncer.yml`
- Code-toggle: `apps/backend/src/util/sharedPool.ts` (`PGBOUNCER_URL`)
- Render env-vars: `render.yaml` (`PGBOUNCER_URL` + `DATABASE_URL_DIRECT`)

---

## 8. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial — OBS-7 implementasjon | Backend-agent (OBS-7) |
