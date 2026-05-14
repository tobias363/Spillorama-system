# DB-Perf Watcher — runbook

**Status:** Aktiv (OBS-9, 2026-05-14)
**Eier:** Backend-team / PM-AI
**Formål:** Cron-script som hver 5 min fanger N+1-queries og regresjoner
fra `pg_stat_statements`, og auto-oppretter Linear-issue ved nye funn.

**Tobias-direktiv 2026-05-14:** *"Vi må overvåke databasen så vi får data
på hva som må forbedres. Test-agent som overvåker alt og peker på
svakheter og tregheter."*

---

## 1. TL;DR

```bash
# Manuell one-shot (etablerer baseline første gang)
bash scripts/ops/db-perf-watcher.sh

# Vis rapport
ls -t /tmp/db-perf-watcher-*.md | head -1 | xargs cat

# Sett opp cron (every 5 min)
bash scripts/ops/setup-db-perf-cron.sh install

# Aktiver / fjern
bash scripts/ops/setup-db-perf-cron.sh status
bash scripts/ops/setup-db-perf-cron.sh uninstall
```

Krever:
- `pg_stat_statements`-extension i Postgres (se [PG_STAT_STATEMENTS_RUNBOOK.md](./PG_STAT_STATEMENTS_RUNBOOK.md))
- `psql`, `jq`, `curl` på PATH
- Postgres reachable via `PGPASSWORD=spillorama` + `localhost:5432`

---

## 2. Hvorfor finnes dette

Sentry detekterte 2026-05-14 62 N+1-events (SPILLORAMA-BACKEND-3 + -4) på
lobby-endpoints på 6 timer. Vi vil at slike events automatisk skal bli
til Linear-issue med:

- Konkret SQL-rapport (top-20 queries med calls, mean, total time)
- Diff mot baseline (NEW slow queries + REGRESSIONS)
- Foreslått fix-direktiv (N+1 → batch, regression → index)

Watcher komplementerer:
- **Sentry DB-tracing** (`apps/backend/src/observability/dbInstrumentation.ts`) — per-request span
- **PgHero** (`docker-compose.observability.yml`) — manuell UI for top-N
- **OBS-6 `audit:db`** (`apps/backend/scripts/audit-db.mjs`) — manuell bug-rapport
- **OBS-7 `pg_stat_statements`** — extension som leverer data

Watcher er den **automatiske, proaktive** delen — kjører uten at noen
ser på dashbordet, lager Linear-issue når noe nytt blir tregt.

---

## 3. Komponenter

### 3.1 `scripts/ops/db-perf-watcher.sh`

Hoved-script. Hver kjøring:

1. Pinger Postgres (exit 2 hvis nede)
2. Verifiserer `pg_stat_statements`-extension (exit 3 hvis mangler)
3. Henter top-N queries via SQL → JSON
4. Sammenligner mot baseline-snapshot
5. Skriver markdown-rapport til `/tmp/db-perf-watcher-<ISO>.md`
6. Hvis NEW eller REGRESSION → kall sibling Linear-script

Idempotent. Read-only mot DB. Aldri INSERT/UPDATE/DELETE.

### 3.2 `scripts/ops/db-perf-create-linear-issue.sh`

Wrapper rundt Linear GraphQL API:

1. Leser `LINEAR_API_KEY` fra env eller `secrets/linear-api.local.md`
2. Resolver team-id for `BIN`-team
3. Resolver label-id for `db-performance` (best-effort — issue lages uten hvis ikke funnet)
4. POST mutation `issueCreate` til `https://api.linear.app/graphql`
5. Hvis Linear feiler → fallback Slack-webhook
6. Hvis Slack feiler → fallback fil i `/tmp` for manuell oppfølging

### 3.3 `scripts/ops/setup-db-perf-cron.sh`

Installerer schedule:

- **macOS** → launchd plist på `~/Library/LaunchAgents/com.spillorama.db-perf-watcher.plist`
- **Linux/Render** → crontab entry tagget med `# db-perf-watcher (managed by setup-db-perf-cron.sh)`

Default: kjør hver 5. min. Settes via `INTERVAL_MINUTES`.

### 3.4 `scripts/__tests__/ops/db-perf-watcher.test.sh`

34 tester:
- Sanity: alle 3 scripts finnes + syntax OK
- jq anomaly-detection pure-function (mock pg_stat_statements input → forventet NEW + REGRESSION)
- Dedup state-file logic (24h window)
- Linear-script DRY_RUN composes correct title
- Setup-cron print/status modes
- Watcher pre-flight DB-check (unreachable → exit 2)
- Integration smoke mot lokal Postgres (skip-graceful hvis ikke tilgjengelig)

```bash
bash scripts/__tests__/ops/db-perf-watcher.test.sh
```

---

## 4. Anomaly-deteksjon

### 4.1 NEW slow query

En query er **NEW** hvis:
- `queryid` finnes IKKE i baseline
- `mean_exec_time > MEAN_MS_THRESHOLD` (default 100 ms)
- `calls > CALLS_THRESHOLD` (default 10)

Begge betingelsene må holde — dette filtrerer ut:
- Admin-rapporter som har 1 call på 5 sek (lav `calls`)
- "Normal" hot-path som har 50 ms mean (under threshold)

### 4.2 REGRESSION

En query er **REGRESSION** hvis:
- `queryid` finnes i baseline
- `((current.mean_ms - baseline.mean_ms) / baseline.mean_ms) × 100 > REGRESSION_PCT` (default 50%)

Eksempel: query gikk fra 12 ms → 18 ms = +50%. Med default 50% trigger
det IKKE (må være >50%). Fra 12 ms → 19 ms = +58% trigger.

### 4.3 Dedup

Hver flagget query lagres med `queryid` + timestamp i
`/tmp/db-perf-watcher-state.json`. Samme `queryid` flagges max én gang
per `LINEAR_ISSUE_DEDUP_HOURS` (default 24t).

Dette hindrer Linear-spam når en regresjon vedvarer i mange timer.
Etter 24t re-fires hvis anomaly fortsatt holder.

---

## 5. Konfigurasjon

Alle via env-vars (default i parentes):

| Var | Default | Hva |
|---|---|---|
| `PGHOST` | `localhost` | Postgres host |
| `PGPORT` | `5432` | Postgres port |
| `PGUSER` | `spillorama` | Postgres user |
| `PGDATABASE` | `spillorama` | Postgres DB |
| `PGPASSWORD` | `spillorama` | Postgres passord (lokal dev) |
| `BASELINE_FILE` | `/tmp/db-perf-watcher-baseline.json` | Hvor baseline lagres |
| `REPORT_DIR` | `/tmp` | Hvor rapporter skrives |
| `REPORT_RETENTION_HOURS` | `168` (7 dager) | Rapporter eldre enn dette slettes |
| `MEAN_MS_THRESHOLD` | `100` | Anomaly hvis NEW query har mean > X ms |
| `CALLS_THRESHOLD` | `10` | Anomaly hvis NEW query har calls > X |
| `REGRESSION_PCT` | `50` | Anomaly hvis kjent query har mean økt > X % |
| `TOP_N` | `20` | Antall queries å hente fra pg_stat_statements |
| `DRY_RUN` | `0` | `1` = ikke opprett Linear-issue |
| `FORCE_BASELINE` | `0` | `1` = skriv ny baseline, exit uten anomaly-sjekk |
| `LINEAR_ISSUE_DEDUP_HOURS` | `24` | Dedup-vindu per queryid |
| `STATE_FILE` | `/tmp/db-perf-watcher-state.json` | Dedup-state-fil |

Linear-script:

| Var | Default | Hva |
|---|---|---|
| `LINEAR_API_KEY` | (fra `secrets/linear-api.local.md`) | Personal API key |
| `LINEAR_TEAM_KEY` | `BIN` | Linear team-key |
| `LINEAR_LABEL_NAME` | `db-performance` | Label som auto-attaches |
| `LINEAR_ISSUE_TITLE_PREFIX` | `[db-perf-watcher]` | Prefix på issue-tittel |
| `SLACK_ALERT_WEBHOOK_URL` | (ikke satt) | Fallback hvis Linear ikke tilgjengelig |
| `FALLBACK_OUTPUT_DIR` | `/tmp` | Fallback-fil-mappe |

---

## 6. Drift

### 6.1 Aktiver (default disabled)

Tobias velger å aktivere etter pilot-test:

```bash
# 1. Verifiser pg_stat_statements er på (lokal docker-compose.yml håndterer dette)
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama \
  -c "SELECT count(*) FROM pg_stat_statements"

# 2. Etabler baseline manuelt (første kjøring lager den automatisk)
bash scripts/ops/db-perf-watcher.sh

# 3. Aktiver cron
bash scripts/ops/setup-db-perf-cron.sh install

# 4. Verifiser
bash scripts/ops/setup-db-perf-cron.sh status

# 5. Følg logger
tail -f /tmp/db-perf-watcher-cron.log
```

### 6.2 Tilbakerull

```bash
bash scripts/ops/setup-db-perf-cron.sh uninstall
```

State-filer (baseline.json, state.json) er **ikke** auto-slettet —
de er trygge å beholde mellom installasjoner.

### 6.3 Re-baseline etter fix

Når en regresjon er fikset (eks. ny index merget), re-establerer du
baseline slik at fix-en blir den nye "normale":

```bash
FORCE_BASELINE=1 bash scripts/ops/db-perf-watcher.sh
```

Eller bare slett baseline-filen — neste run lager ny automatisk.

### 6.4 Test fra fersh state

Ny watch-syklus uten gammel state:

```bash
rm -f /tmp/db-perf-watcher-baseline.json \
      /tmp/db-perf-watcher-state.json
bash scripts/ops/db-perf-watcher.sh
```

### 6.5 Verifiser at Linear-integrasjon fungerer

```bash
# Sjekk at API-nøkkel er funnet
ls -la secrets/linear-api.local.md 2>/dev/null  # eller env LINEAR_API_KEY

# DRY_RUN — composer tittel/body men sender ikke
DRY_RUN=1 bash scripts/ops/db-perf-create-linear-issue.sh \
  /tmp/db-perf-watcher-*.md '[]'

# Live test (vil opprette EKTE issue!)
# bash scripts/ops/db-perf-create-linear-issue.sh \
#   /tmp/db-perf-watcher-*.md '[{"kind":"NEW","queryid":"test","current":{"calls":50,"mean_ms":200,"query":"SELECT 1"},"baseline":null,"delta_pct":null,"reason":"test"}]'
```

---

## 7. Eksempel-rapport (sample output)

Faktisk rapport fra lokal smoke-test 2026-05-14:

```md
# DB-Perf Watcher Report 2026-05-14T13:52:43Z

## Summary

- **Host:** localhost:5432/spillorama
- **Top queries scanned:** 20
- **Baseline taken:** 2026-05-14T13:52:40Z
- **Anomalies detected:** 0 (0 NEW, 0 REGRESSION)
- **Mean threshold:** 100 ms
- **Calls threshold:** 10
- **Regression threshold:** 50%

## Anomalies detected

None — workload is within thresholds compared to baseline.

## Top 10 queries by total_exec_time

| # | Calls | Mean ms | Total ms | Rows | Disk reads | Query |
|---|------:|--------:|---------:|-----:|-----------:|-------|
| 1 | 1657  | 1.49    | 2476.18  | 1657 | 145        | `SELECT id, master_hall_id, status… FROM app_game1_scheduled_games WHERE status…` |
| 2 | 29879 | 0.05    | 1431.68  | 29879 | 6         | `SELECT id, slug, display_name… FROM app_game_catalog WHERE id = $1` |
| …
```

Når anomalies finnes, rapporten inneholder også:

```md
## Anomalies detected

- **NEW** (queryid: `4567890`, mean=185ms, calls=46): `SELECT FROM app_game_catalog WHERE id = $1`
  - New slow query (mean=185ms, calls=46)

## Recommended actions

- **N+1 suspect** on `SELECT FROM app_game_catalog WHERE id = $1` — 46 calls. Investigate code path; consider batch resolver (DataLoader pattern) or eager-loading JOIN.
```

---

## 8. Diagnose-flow når Linear-issue dukker opp

1. **Reproduser EXPLAIN ANALYZE:**
   ```bash
   PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama \
     -c "EXPLAIN (ANALYZE, BUFFERS) <query her>"
   ```

2. **Sjekk recent migrations:**
   ```bash
   ls -t apps/backend/migrations/*.sql | head -5
   ```

3. **Sjekk data-growth på touched tables:**
   ```sql
   SELECT n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'app_game_catalog';
   ```

4. **Hvis N+1 → fix-mønster:**
   - DataLoader-mønster (batch resolver)
   - Eager-load JOIN i SELECT
   - Pre-load via `IN` med array-param

5. **Hvis missing index → fix:**
   - `CREATE INDEX CONCURRENTLY` migration (forward-only — se ADR-0014)

6. **Etter fix:**
   ```bash
   FORCE_BASELINE=1 bash scripts/ops/db-perf-watcher.sh
   ```

7. **Lukk Linear-issue** med commit-SHA + file:line + grønn test (Done-policy)

---

## 9. Anti-mønstre

### 9.1 Aldri kjør mot prod direkte

Watcher er designet for `localhost`. Hvis du absolutt må mot prod-DB,
opprett **read-only psql-tunnel** via Render dashboard og overstyr
`PGHOST`/`PGPORT`/`PGUSER` — men dette krever eksplisitt ops-godkjenning
og bør IKKE være cron'et.

### 9.2 Aldri hardkode LINEAR_API_KEY

Bruk `secrets/linear-api.local.md` eller env-var. Filen er git-ignored;
tester sjekker at den ikke commited.

### 9.3 Aldri Sett MEAN_MS_THRESHOLD lavt

Pilot-skala har ~50 unike queries med mean < 5 ms. Hvis du setter
threshold til f.eks. 10 ms, vil watcher flagge admin-rapport-queries
som "anomaly" — støy, ikke signal. 100 ms er pilot-realistisk default.

### 9.4 Ikke gjør watcher write-active

Hvis du noensinne trenger `INSERT INTO app_alert_log` eller liknende,
gjør det via en separat service med proper outbox-pattern. Watcher
forblir read-only.

### 9.5 Linear-spam ved persistent regression

Hvis en regresjon vedvarer i flere dager, opprettes nye issues hver
24t (dedup-window). Hvis dette blir støy, sett `LINEAR_ISSUE_DEDUP_HOURS`
høyere (eks. 168 = uke). Beste fix er likevel å løse anomalien.

---

## 10. Referanser

- `scripts/ops/db-perf-watcher.sh` — hoved-script
- `scripts/ops/db-perf-create-linear-issue.sh` — Linear-integrasjon
- `scripts/ops/setup-db-perf-cron.sh` — cron-installer
- `scripts/__tests__/ops/db-perf-watcher.test.sh` — test-suite
- [PG_STAT_STATEMENTS_RUNBOOK.md](./PG_STAT_STATEMENTS_RUNBOOK.md) — extension setup
- [PGHERO_PGBADGER_RUNBOOK.md](./PGHERO_PGBADGER_RUNBOOK.md) — interaktiv UI
- [OBSERVABILITY_RUNBOOK.md](./OBSERVABILITY_RUNBOOK.md) — bredere observability
- `apps/backend/scripts/audit-db.mjs` — manuell DB-audit (OBS-6)
- `apps/backend/src/observability/dbInstrumentation.ts` — Sentry DB-tracing
- `.claude/skills/health-monitoring-alerting/SKILL.md` — relatert skill (utvidet med "DB-perf-watcher")
- `docs/engineering/PITFALLS_LOG.md` §12 (DB-resilience)

---

## 11. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial — watcher + Linear-integrasjon + cron-setup + 34 tester. Tobias-direktiv OBS-9. | db-perf-watcher-agent |
