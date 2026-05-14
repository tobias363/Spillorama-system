# PgHero + pgBadger runbook (OBS-8)

**Status:** Aktiv (2026-05-14)
**Eier:** Ops / PM
**Linear:** OBS-8
**Linker:**
[docker-compose.observability.yml](../../docker-compose.observability.yml) ·
[scripts/observability-up.sh](../../scripts/observability-up.sh) ·
[scripts/pgbadger-report.sh](../../scripts/pgbadger-report.sh) ·
[OBSERVABILITY_RUNBOOK.md](./OBSERVABILITY_RUNBOOK.md) (overordnet)

Denne runbook-en dekker hvordan vi bruker **PgHero** (live web-dashboard)
og **pgBadger** (HTML-rapporter) for å overvåke Postgres-databasen lokalt
under pilot-utvikling. Stacken kjører som separat docker-compose-fil
og berører IKKE hoved-dev-stacken (`docker-compose.yml`).

---

## 1. Hva verktøyene gir oss

### PgHero — live dashboard

PgHero er en Ruby-app som leser Postgres' interne statistikk-tabeller
(`pg_stat_statements`, `pg_stat_user_tables`, `pg_stat_user_indexes`,
`pg_stat_activity`) og presenterer dem som et web-dashboard.

Vi bruker det til:

- **Hva er sakte akkurat nå?** Top-N slow queries rangert på `total_time` ×
  `calls` — viktigste signaler for hvor vi har sankt-tid på flest queries.
- **Hvilke queries kalles for ofte?** Call-count + mean-time hjelper å
  identifisere N+1-mønstre og manglende caching.
- **Mangler vi index?** "Suggestions"-tab flagger foreign keys uten
  støttende index — typisk årsak til table-scans.
- **Har vi ubrukte indexes?** Index som aldri blir scant koster RAM +
  skrivetid. Drop dem.
- **Hvor stor er DB-en?** Per-tabell + per-index disk-bruk. Bloat-estimat
  hvis vacuum henger etter.
- **Live aktivitet:** Hvem holder hvilke locks akkurat nå? Hvilke queries
  har kjørt > 60s?

### pgBadger — historiske rapporter

pgBadger er Perl-script som parser Postgres-logger og produserer en stor
HTML-rapport med histogrammer, traffic-mønstre og top-queries over tid.

Vi bruker det til:

- **Hvilke timer på døgnet har vi mest last?** Identifiser peak-vinduer
  for pilot-kveld planlegging.
- **Hva er top-10 dyreste queries siste uke?** Mer presis enn PgHero
  fordi det leser FAKTISKE queries fra logger, ikke aggregert
  `pg_stat_statements`.
- **Hadde vi DB-stress under en spesifikk hendelse?** Filtrere rapporten
  på tidsvindu for å se hva som skjedde rundt en kjent prod-incident.

PgHero og pgBadger komplementerer hverandre: PgHero er live, pgBadger er
forensics.

---

## 2. Quick start

**Anbefalt — kombinert med `dev:nuke`:**

```bash
# Start hele stacken (backend + admin + game-client + PgHero på :8080)
# Tobias-direktiv 2026-05-14: bruk denne for pilot-test-sesjoner så DB-
# trafikken overvåkes i sanntid mens vi tester pilot-flyt.
npm run dev:nuke -- --observability

# Åpne PgHero
open http://localhost:8080
# Login: admin / spillorama-2026-test (overstyrbar via env)
```

**Manuell — kjør PgHero alene:**

```bash
# Forutsetning: hoved-dev-stacken kjører (npm run dev:nuke eller
# docker-compose up -d postgres redis).

# Start PgHero på localhost:8080
bash scripts/observability-up.sh

# Generer pgBadger-rapport (krever Postgres CSV-logger — se §4)
bash scripts/pgbadger-report.sh
open infra/observability/data/pgbadger-latest.html

# Når du er ferdig
bash scripts/observability-down.sh
```

> **NB om aktivering (kritisk lærdom 2026-05-14):** `pg_stat_statements`-
> extension installeres via migration `20261225000000`, men extension-en
> samler INGEN data uten at `shared_preload_libraries=pg_stat_statements`
> er satt på Postgres-prosessen ved oppstart. Dette håndteres nå av
> `command:`-blokken i `docker-compose.yml`. Hvis du kjører Postgres
> utenfor Docker (eks. lokalt brew-install), MÅ du sette dette i
> `postgresql.conf` selv.

---

## 3. Aktivere pg_stat_statements (allerede aktivert i hoved-stacken per 2026-05-14)

PgHero leser fra `pg_stat_statements`-extension. Per 2026-05-14 er den
**permanent aktivert** i `docker-compose.yml` via `command:`-blokken på
postgres-service-en. Du trenger ikke gjøre noe ekstra for å aktivere den
lokalt — bare kjør `npm run dev:nuke` (med eller uten `--observability`)
så er extension-en aktiv og samler data fra første spørring.

### Hvordan det fungerer

`docker-compose.yml` setter:

```yaml
postgres:
  image: postgres:16-alpine
  command:
    - "postgres"
    - "-c"
    - "shared_preload_libraries=pg_stat_statements"
    - "-c"
    - "pg_stat_statements.track=all"
    - "-c"
    - "pg_stat_statements.max=10000"
    - "-c"
    - "log_min_duration_statement=100"
    # ... og noen log_-flagg for fremtidig pgBadger-bruk
```

Migration `20261225000000_enable_pg_stat_statements.sql` kjører
`CREATE EXTENSION IF NOT EXISTS pg_stat_statements` ved hver `dev:all`-
oppstart (idempotent).

Resultat: PgHero ser data så snart Postgres har behandlet ≥ 1 spørring.

### Verifiser aktivering

```bash
# 1. Sjekk shared_preload_libraries
docker exec -i agent-a569f6a545f50e788-postgres-1 psql -U spillorama -d spillorama \
  -c "SHOW shared_preload_libraries;"
# Forventet output: pg_stat_statements

# 2. Sjekk at extension er installert
docker exec -i agent-a569f6a545f50e788-postgres-1 psql -U spillorama -d spillorama \
  -c "SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';"
# Forventet output: pg_stat_statements

# 3. Sjekk at data samles
docker exec -i agent-a569f6a545f50e788-postgres-1 psql -U spillorama -d spillorama \
  -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 5;"
# Forventet: rader fra faktiske spørringer (ikke tom tabell)
```

NB: Container-navnet (`agent-a569f6a545f50e788-postgres-1`) varierer per
worktree — bruk `docker ps` for å finne riktig navn lokalt.

### Hvis du må deaktivere midlertidig

Det er sjelden behov for det, men hvis du oppdager at
`pg_stat_statements` koster mer CPU enn forventet:

1. Kommenter ut `shared_preload_libraries`-linjen i `docker-compose.yml`.
2. Kjør `npm run dev:nuke` for å restarte Postgres med ny config.
3. NB: Migration vil fortsatt prøve å kjøre `CREATE EXTENSION` — det
   feiler med `ERROR: pg_stat_statements must be loaded via
   shared_preload_libraries`. Migration har `IF NOT EXISTS` så den feiler
   ikke catastrophic, men ny extension installeres ikke.

---

## 4. Konfigurere Postgres for pgBadger

pgBadger trenger detaljerte query-logger. Standard `postgres:16-alpine`
logger ikke nok ut av boksen.

### Minimum-config

Postgres må logges med disse settings:

```ini
log_destination = 'csvlog'
logging_collector = on
log_directory = '/var/log/postgresql'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = 1d
log_min_duration_statement = 100  # logger queries > 100ms
log_line_prefix = '%t [%p]: db=%d,user=%u,app=%a,client=%h '
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0
log_autovacuum_min_duration = 0
```

### Lokal aktivering (engangs CLI-override)

```bash
docker run -d --name pg-with-logs \
  -p 5432:5432 \
  -e POSTGRES_DB=spillorama \
  -e POSTGRES_USER=spillorama \
  -e POSTGRES_PASSWORD=spillorama \
  -v spillorama-system_pgdata:/var/lib/postgresql/data \
  -v $(pwd)/infra/observability/pglogs:/var/log/postgresql \
  postgres:16-alpine \
  postgres \
    -c log_destination=csvlog \
    -c logging_collector=on \
    -c log_directory=/var/log/postgresql \
    -c log_filename=postgresql-%Y-%m-%d.log \
    -c log_min_duration_statement=100 \
    -c log_line_prefix='%t [%p]: db=%d,user=%u,app=%a,client=%h '
```

Etter litt trafikk, sjekk at logger blir skrevet:

```bash
ls -la infra/observability/pglogs/
# Skal vise postgresql-2026-05-14.csv (eller lignende)
```

### Kjør pgBadger-rapport

```bash
bash scripts/pgbadger-report.sh
```

Output: `infra/observability/data/pgbadger-YYYYMMDD-HHMMSS.html` +
symlink `pgbadger-latest.html`.

Åpne i browser:

```bash
open infra/observability/data/pgbadger-latest.html
```

---

## 5. PgHero dashboard-tour

Når du åpner `http://localhost:8080`, ser du:

### Sidebar (venstre)

- **Index** — landing-side med summary
- **Queries** — alle queries fra pg_stat_statements
- **Space** — disk-bruk per tabell + index
- **Connections** — live connection-state
- **Live Queries** — pågående queries (snapshot)
- **System Stats** — CPU/RAM/IOPS hvis Postgres rapporterer
- **Maintenance** — vacuum/analyze-historikk

### Top-cards

**Slow queries** — alt over `PGHERO_SLOW_QUERY_MS` (default 100ms).
Klikk på query-en for full SQL + execution plan-hint.

**Long running queries** — alt som har kjørt > `PGHERO_LONG_RUNNING_QUERY_SEC`
(default 60s). Hvis du ser noe her under pilot — drep dem.

### Connections-panel

Viser antall connections per state:
- **Active** — utfører query
- **Idle** — connection åpen, ikke i bruk
- **Idle in transaction** — DANGER, kan blokkere VACUUM. Sjekk app-kode
- **Idle in transaction (aborted)** — connection-leak, må kill-es

For pilot-skala (1500 spillere × 4 haller = 6000 samtidige tilkoblinger)
trenger vi at admin-app + backend bruker connection-pool via pgBouncer
(OBS-7). PgHero hjelper å verifisere at pooling fungerer.

### Suggestions-panel

To viktige seksjoner:

**Missing indexes** — Foreign-key-kolonner uten støttende index. Eksempel:
hvis `app_game1_tickets.scheduled_game_id` er FK men ikke har index, blir
JOIN-er sakte. PgHero foreslår `CREATE INDEX ON app_game1_tickets
(scheduled_game_id)`.

⚠️ **False positives:** Små tabeller (< 1000 rader) trenger sjelden index.
Verifiser med `EXPLAIN ANALYZE` før du legger til.

**Unused indexes** — Indexes som aldri brukes (`idx_scan = 0` i
`pg_stat_user_indexes`). Drop dem hvis tabellen er stor (sparer RAM +
skrive-tid).

⚠️ **Vær forsiktig:** Hvis stat'ene ble reset nylig, kan en index vise
0 scans selv om den faktisk brukes. Vent minst en uke før du dropper noe.

---

## 6. pgBadger rapport-tour

pgBadger-HTML inneholder typisk 5-15 MB med charts og tabeller. Det
viktigste:

### Overview-sidehover

- **Total queries** — antall queries i analysevinduet
- **Total exec time** — kumulativ tid brukt på DB-arbeid
- **Top time-consuming queries** — query-normaliserte aggregater

### Hourly stats

Heat-map som viser query-volum per time. Bruk for å:
- Identifisere peak-trafikk (pilot-kveld 18-22?)
- Se om autovacuum-vinduer kolliderer med peak
- Verifisere at "stille natt" virkelig er stille

### Slowest queries / most-frequent queries

Disse er gull. Klikk på query-en for å se:
- Eksempel-execution med faktiske parametre
- Antall ganger query har kjørt
- Total tid brukt
- Min/max/median/p95 latency

### Lock-events

Hvis vi får dead-locks eller lange waits, ser vi det her. Pilot må ha
0 deadlocks — hvis vi ser dem, er det app-bug.

---

## 7. Integrasjon i pilot-monitor-loop (advanced)

Foreløpig kjører PgHero/pgBadger manuelt. For å integrere i
[pilot-monitor-enhanced.sh](../../scripts/pilot-monitor-enhanced.sh):

**Forslag (post-pilot-stabil):**

```bash
# Hvert 5. minutt, hent slow-query-count fra PgHero API
curl -s -u admin:spillorama-2026-test http://localhost:8080/queries.json \
  | jq '.queries | map(select(.mean_time_ms > 500)) | length'
# Hvis > 5 → alert
```

PgHero har JSON-endpoint for de fleste views (legg `.json` på URL-en).
Vi kan strikke det inn i Slack-alerts senere.

For pgBadger: kjør som nightly cron-job (3am) → upload til S3-bucket
→ link i PM-dashboard. Out-of-scope for OBS-8.

---

## 8. Troubleshooting

### PgHero viser "Connection refused"

```bash
docker-compose -f docker-compose.observability.yml logs pghero
```

Vanlige årsaker:
1. **Postgres er ikke oppe.** Sjekk `docker ps` for `spillorama-system-postgres-1`.
2. **`DATABASE_URL` peker feil.** Default antar Postgres på
   `host.docker.internal:5432`. Hvis du har endret porten, overstyr:
   ```bash
   PGHERO_DATABASE_URL=postgres://spillorama:spillorama@host.docker.internal:5433/spillorama \
     bash scripts/observability-up.sh
   ```
3. **Linux uten Docker Desktop:** `host.docker.internal` mapping må legges
   til manuelt. Allerede gjort via `extra_hosts:` i compose-filen — men
   eldre Docker-versjoner kan trenge `--add-host`.

### PgHero viser tomme tabeller

```sql
-- Sjekk at extension er aktivert
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';
```

Hvis tom: aktivér per §3. Ellers: vent litt på trafikk — `pg_stat_statements`
populeres mens queries kjører.

### pgBadger sier "Ingen log-filer funnet"

```bash
ls -la infra/observability/pglogs/
```

Hvis bare `.gitkeep` finnes: du har ikke konfigurert Postgres til å skrive
hit. Se §4 for setup.

### PgHero-dashbord er sakte

Hvis Postgres er under stress, kan PgHero-queries (som leser
`pg_stat_statements` med JOIN mot `pg_database`) gjøre det verre. Skru
ned `PGHERO_STATS_INTERVAL` eller skru av PgHero midlertidig under
incident-debugging.

### `docker-compose -f docker-compose.observability.yml` finner ikke compose-fila

Du står sannsynligvis i feil katalog. Scripts gjør `cd $REPO_ROOT`
automatisk, men hvis du kjører compose direkte:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
docker-compose -f docker-compose.observability.yml ps
```

---

## 9. Sikkerhet og deployment

### Lokal-only per default

OBS-8 er **kun for lokal dev**. Vi deployer ikke PgHero til Render-prod.
Hvis vi senere vil ha det i prod:

- PgHero må stå bak VPN eller IP-whitelist (basic auth alene er ikke nok)
- Passordet må roteres
- `DATABASE_URL` må peke på read-replica, ikke primary

### Hva fungerer prod-side i mellomtiden?

Eksisterende: Sentry (BIN-731), PostHog (OBS-5), Grafana
([LIVE_ROOM_OBSERVABILITY](./LIVE_ROOM_OBSERVABILITY_2026-04-29.md)). DB-spesifikke metrikker
hentes via custom Prometheus-exporter (planlagt OBS-7).

PgHero/pgBadger er **utvikler-verktøy** for å forstå hva vi sender til
DB-en, ikke prod-observability.

---

## 10. Endringer fra denne implementasjonen

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial — OBS-8 levert. PgHero docker-stack + pgBadger entrypoint-script + runbook. | OBS-8 ops-agent |
| 2026-05-14 | **OBS-7/OBS-8 aktivering fullført.** `pg_stat_statements` + `log_min_duration_statement=100ms` permanent aktivert i `docker-compose.yml` via `command:`-blokk. PgHero integrert i `dev:nuke` via `--observability`-flag (opt-in). Tobias-rapport: "vi skulle vente med database verktøy men alt er satt opp slik at vi ser alt som skjer i databasen". Tidligere bare-installert-ikke-aktivert (samlet null data) er nå reell observability fra T-0. | DB-observability fix-agent (Agent S) |

---

## 11. Referanser

- [PgHero GitHub](https://github.com/ankane/pghero) — Andrew Kane (Instacart)
- [pgBadger GitHub](https://github.com/darold/pgbadger) — Gilles Darold (Dalibo)
- [pg_stat_statements docs](https://www.postgresql.org/docs/16/pgstatstatements.html)
- [Postgres logging docs](https://www.postgresql.org/docs/16/runtime-config-logging.html)
- [LIVE_ROOM_OBSERVABILITY_2026-04-29.md](./LIVE_ROOM_OBSERVABILITY_2026-04-29.md) — Grafana-dashboards
- [OBSERVABILITY_RUNBOOK.md](./OBSERVABILITY_RUNBOOK.md) — overordnet runbook
