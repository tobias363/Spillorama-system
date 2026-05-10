# R9 — Spill 2 24t-leak-test — operasjonell runbook

**Status:** Operasjonell (test-infrastruktur klar, faktisk 24t-kjøring avventer pilot-utvidelse)
**Linear:** [BIN-819](https://linear.app/bingosystem/issue/BIN-819)
**Mandat:** [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.5
**Test-skript:** [`infra/leak-tests/r9-spill2-24h-leak-test.sh`](../../infra/leak-tests/r9-spill2-24h-leak-test.sh)
**Helper:** [`infra/leak-tests/heap-snapshot-helper.mjs`](../../infra/leak-tests/heap-snapshot-helper.mjs)
**Resultat-rapport (pre-utfylt mal):** [`R9_SPILL2_LEAK_TEST_RESULT.md`](./R9_SPILL2_LEAK_TEST_RESULT.md)
**Eier:** PM-AI + ops-on-call
**Sist oppdatert:** 2026-05-10

---

## 0. TL;DR

R9 er pilot-**utvidelses**-gating (ikke pilot-go-live-gating). Den kjøres
på dedikert staging-miljø **før Spillorama går fra 4-hall-pilot til
flere haller**, ikke før første pilot-runde. Du skal kun kjøre denne
runbook-en hvis du har grønt lys fra Tobias for utvidelses-vurdering.

| Mode | Varighet | Kjøres når | Kilde |
|---|---|---|---|
| **Smoke-test** | 30-60 min | Validering at scriptet fungerer | Lokal Docker / dev-Mac |
| **Full leak-test** | 24 t | Før pilot-utvidelse fra 4 → flere haller | Dedikert staging-miljø |

PASS-kriterium: heap-vekst < 10 %, FD-vekst < 10 %, DB-pool-idle > 0,
ingen orphan socket-handles. Detaljer i §6.

---

## 1. Når denne testen skal kjøres

### 1.1 Pilot-utvidelses-gating

Per [LIVE_ROOM_ROBUSTNESS_MANDATE §6.1](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md#61-gono-go-policy-tobias-2026-05-08)
er R9 i kategorien "post-pilot-go-live, pre-utvidelse". Kjør den når:

1. ✅ 4-hall-pilot har kjørt grønt i 2-4 uker uten kunde-klager om "rom utilgjengelig".
2. ✅ R4 (load-test 1000) bestått.
3. ✅ R6 (outbox-validering) bestått.
4. ⏳ **Tobias signerer "vi vurderer utvidelse"-beslutning.**

Hvis disse er oppfylt, **må R9 kjøres med PASS** før neste hall skrus på.

### 1.2 Når denne IKKE skal kjøres

- Som del av første pilot-go-live (R9 er ikke gating der).
- I CI / pre-merge-flyt (24t-kjøring er for lang for CI).
- På Tobias' Mac (smoke-test OK, full 24t krever dedikert miljø).

### 1.3 Når smoke-modus alene er tilstrekkelig

- Etter endring i `PerpetualRoundService` for å verifisere at infra-laget kompilerer.
- Etter endring i mock-players (`scripts/dev/mock-players.mjs`) for sanity-check.
- Som del av PR-review hvis endringen treffer Spill 2 perpetual-loop.

Smoke-modus fanger IKKE ekte minne-leaks (1 t er for kort tid for vekst > 10 %)
men verifiserer at hele test-pipelinen fungerer end-to-end.

---

## 2. Forutsetninger

### 2.1 Miljø

| Komponent | Smoke (lokal) | Full (staging) |
|---|---|---|
| Docker Engine | 24+ med daemon kjørende | 24+ med daemon kjørende |
| Postgres | 16-alpine via docker-compose | 16-alpine via docker-compose, dedikert host |
| Redis | 7-alpine via docker-compose | 7-alpine via docker-compose, dedikert host |
| Backend RAM | Hvilken som helst | ≥ 2 GB (Render Standard-tier eller equiv.) |
| Backend CPU | Hvilken som helst | ≥ 1 vCPU dedikert |
| Disk-plass | 5 GB ledig | 20 GB ledig (heap-snapshots tar plass) |
| Node.js | 22+ | 22+ |
| jq | Installert | Installert |
| curl | Installert | Installert |

### 2.2 Verktøy som må være tilgjengelige

```bash
which jq && which curl && which docker && which node
```

Hvis noe mangler:
```bash
brew install jq curl  # macOS
# Docker: https://docs.docker.com/engine/install/
# Node 22: https://nodejs.org/ eller mise/nvm
```

### 2.3 Konfig-defaults

| ENV | Default | Smoke-override | Full-override |
|---|---|---|---|
| `DURATION_HOURS` | 24 | 1 | 24 |
| `SAMPLE_INTERVAL_S` | 3600 | 300 (5 min) | 3600 (1 t) |
| `HEAP_SNAPSHOTS` | "0,6,12,18,24" | "0,1" | "0,6,12,18,24" |
| `MOCK_PLAYER_COUNT` | 5 | 5 | 5-12 |
| `ADMIN_PASSWORD` | Spillorama123! | (samme) | Hentet fra staging-secret |
| `HEAP_GROWTH_LIMIT_PCT` | 10 | 10 | 10 |
| `FD_GROWTH_LIMIT_PCT` | 10 | 10 | 10 |
| `BACKEND_URL` | http://localhost:4000 | (samme) | Staging-URL |
| `BACKEND_CONTAINER` | spillorama-backend | (auto-discover) | Staging-name |

---

## 3. Slik kjører du smoke-test (30-60 min)

### 3.1 Lokal Mac eller dev-server

Forutsetninger: docker daemon kjører, port 4000 er ledig, port 5432/6379
er ledige eller deles via eksisterende `docker-compose.yml`.

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

# Kjør smoke-test (1t med sampling hvert 5 min, 2 heap-snapshots)
DURATION_HOURS=1 \
  SAMPLE_INTERVAL_S=300 \
  HEAP_SNAPSHOTS="0,1" \
  bash infra/leak-tests/r9-spill2-24h-leak-test.sh
```

Forventet output:
```
[ ..  ] Pre-flight: jq + curl + docker + node
[PASS] Pre-flight OK
[ ..  ] Konfigurasjon: duration=1t, sample-interval=300s, mock-players=5
[PASS] Backend allerede oppe på http://localhost:4000     # eller starter docker-compose
[ ..  ] Migrerer DB + seeder demo-pilot-day
[PASS] Migrering OK
[PASS] Seed OK
[ ..  ] Admin-login
[PASS] Login OK
[ ..  ] Samples-katalog: /tmp/r9-leak-test.XXXXXX
[ ..  ] Starter 5 mock-spillere mot Spill 2 (rocket)
[PASS] Mock-trafikk kjører (PID 12345)
[ ..  ] Tar baseline-sample (h0)
[ ..  ] Sampling h1 (etter 300s)
[ ..  ] Sampling h2 (etter 600s)
... (hver 5. min)
[ ..  ] Sampling h12 (etter 3600s)
[ ..  ] Test-perioden (1t) er ferdig
[ ..  ] Tar avsluttende sample (h1)
[ ..  ] Analyserer samples
[ ..  ] Trend-CSV: /tmp/r9-leak-test.XXXXXX/trends.csv

═══════════════════════════════════════════════════════════════
 R9 SPILL 2 LEAK-TEST: PASSED
═══════════════════════════════════════════════════════════════
  Heap-vekst: 1.23% (grense 10%)
  FD-vekst:   0.00% (grense 10%)
  Samples:    /tmp/r9-leak-test.XXXXXX/samples.json
  Analyse:    /tmp/r9-leak-test.XXXXXX/analysis.json
```

### 3.2 Hvis backend kjører lokalt uten Docker (tsx watch)

Scriptet sjekker `BACKEND_URL/health` og hopper over docker-stack-oppstart hvis
backend allerede svarer. Da fortsetter testen mot lokal-backenden men:

- `docker exec`-baserte FD/pool-stats blir hoppet over (warning logges).
- Migrate + seed via `docker exec` blir hoppet over (warning).
- Mock-trafikk og samples-loop fortsetter normalt.

Dette er greit for en rask sanity-sjekk men gir redusert signal — hvis du
trenger full FD/pool-tracking, kjør via docker-compose.

### 3.3 Verifiser at smoke-testen produserte resultatene

```bash
# JSON-rapport
ls -la /tmp/r9-leak-test.*/  # finn katalogen som ble brukt

# Vis samples
cat /tmp/r9-leak-test.*/samples.json | jq '.[].label'

# Vis trend-CSV
cat /tmp/r9-leak-test.*/trends.csv
```

Forventet:
- `samples.json` har 13 entries (h0 + 12 samples + h1 final)
- `analysis.json` har `ok: true` og `heapGrowthPct < 10`
- `trends.csv` har header + 13 rader
- 2 heap-snapshots (`heap-h0.heapsnapshot`, `heap-h1.heapsnapshot`) hvis
  diagnose-endpointen er tilgjengelig

---

## 4. Slik kjører du full 24t-leak-test (staging only)

### 4.1 Pre-flight checklist

Før du starter en 24t-kjøring, signér disse:

- [ ] Tobias har gitt grønt lys for pilot-utvidelses-vurdering
- [ ] Staging-miljøet er dedikert til denne testen (ingen andre tester samtidig)
- [ ] Disk-plass ≥ 20 GB ledig (heap-snapshots på 1 GB+ hver)
- [ ] Du har tilgang til staging-secrets (ADMIN_PASSWORD via 1Password / Render)
- [ ] Du har en fail-over-strategi hvis testen krasjer halveis (dokumentert under)
- [ ] Du har planlagt tid (24 t + 4 t analyse = 28 t totalt)

### 4.2 Slik starter du full-modus

```bash
# På staging-host (ikke Tobias' Mac)
cd /opt/spillorama-system

# Hent admin-passord fra secret store
export ADMIN_PASSWORD="$(op read 'op://Spillorama/staging-admin/password')"

# Default 24 t med sampling hver time + heap-snaps i h0/6/12/18/24
nohup bash infra/leak-tests/r9-spill2-24h-leak-test.sh \
  > /var/log/r9-leak-test-$(date +%Y%m%d).log 2>&1 &

echo "Test PID: $!"
disown
```

Testen kjører nå i bakgrunnen og overlever SSH-disconnect. Sjekk progresjon:

```bash
# Live-log
tail -f /var/log/r9-leak-test-*.log

# Samples-katalog (oppdateres hver time)
ls -la /tmp/r9-leak-test.*/

# Mock-traffic-log (debug)
tail -100 /tmp/r9-leak-test.*/mock-players.log
```

### 4.3 Hvis testen krasjer halveis

Mock-prosess-vakten dreper testen hvis mock-spillere dør. Hvis dette skjer:

1. **Sjekk hvorfor mock-en døde:**
   ```bash
   tail -100 /tmp/r9-leak-test.*/mock-players.log
   ```

2. **Sjekk om backenden er nede:**
   ```bash
   curl -sf http://localhost:4000/health || echo "BACKEND DOWN"
   ```

3. **Restart backenden:**
   ```bash
   docker-compose restart backend
   ```

4. **Restart testen:**
   ```bash
   bash infra/leak-tests/r9-spill2-24h-leak-test.sh
   ```

Test-resultatene fra forrige run er bevart i `/tmp/r9-leak-test.<gammel-id>/`
— hvis halveis-data er nyttig (f.eks. for å se hvor leak-mønster startet),
kopiér den ut før neste run starter.

### 4.4 Hvordan stoppe testen for hånd

```bash
# Finn PID-en (cleanup-trap rydder opp ved SIGTERM)
ps aux | grep r9-spill2 | grep -v grep
kill -TERM <pid>

# Eller mer aggressiv stop hvis trap ikke fyrer
pkill -TERM -f r9-spill2
pkill -TERM -f mock-players
```

Testen rydder opp etter seg selv hvis cleanup-trap fungerer
(`r9-spill2-24h-leak-test.sh` linje 87-102). Hvis ikke:

```bash
# Stopp manuelt
docker-compose down
rm -rf /tmp/r9-leak-test.*
```

---

## 5. PASS / FAIL-kriterier (autoritativ)

Disse er identiske med [`R9_SPILL2_LEAK_TEST_RESULT.md` §3.2](./R9_SPILL2_LEAK_TEST_RESULT.md)
men gjentas her for operasjonell tilgang uten å måtte hoppe mellom doc-er.

### 5.1 PASS — alle invarianter holder

| Invariant | Grense | Kilde | Hvorfor |
|---|---|---|---|
| Heap-vekst h0 → h_final | < 10 % | `heapUsedMb` (eller `rssMb` fallback) | GC-kompaktering har naturlig fluktuasjon; vekst > 10 % over 24 t er klart leak-mønster |
| FD-vekst h0 → h_final | < 10 % | `openFds` fra `/proc/self/fd` count | FD-tall skal stabilisere etter warmup; vekst er handle-leak |
| DB-pool idle final | > 0 | `dbPoolIdle` | Idle = 0 i final-sample tyder på connections som aldri returneres |
| Mock-process overlevelse | Hele varigheten | `kill -0 $MOCK_PID` | Hvis mock dør vet vi ikke om backend tok over eller ikke |
| Socket.IO clients final | ≈ MOCK_PLAYER_COUNT (±2) | `socketIoClients` | Vekst utenfor toleranse er socket-leak ved reconnect |

Når ALLE er innenfor: testen exiter 0 og logger "R9 SPILL 2 LEAK-TEST: PASSED".

### 5.2 FAIL — minst én invariant brutt

Testen exiter 1 og lister hvilke invarianter som brøt. Hver brudd skal følges
opp som beskrevet i §7 nedenfor.

### 5.3 Inconclusive — testen kunne ikke kjøres

Exit-kode 2 betyr oppsett-feil:
- Docker daemon ikke kjørende
- Backend healthet aldri (timeout 120 s)
- Login feilet (admin-passord feil eller bruker mangler)
- Mock-spillere døde innen 5 sek etter oppstart

Dette er IKKE et leak-funn — det er et test-infra-funn. Fix oppsettet og
kjør på nytt.

---

## 6. Slik analyserer du resultatene

### 6.1 Auto-rapport

Etter at testen er ferdig får du:

| Fil | Innhold | Bruk |
|---|---|---|
| `samples.json` | Array av per-time-samples med rss/heap/fd/pool-stats | Rå data for re-analyse |
| `analysis.json` | Aggregert analyse (`{ok, heapGrowthPct, fdGrowthPct, errors[]}`) | Maskinlesbar PASS/FAIL |
| `trends.csv` | Flat CSV med vekst-prosent per rad | Heatmap / Excel / Grafana |
| `heap-h0.heapsnapshot` ... `heap-h24.heapsnapshot` | V8 heap-dumps for Chrome DevTools | Manuell leak-jakt |
| `mock-players.log` | Mock-trafikk-logg (verbose) | Debug hvis mock-en feilet |

### 6.2 Heatmap-visualisering (matplotlib eller Excel)

`trends.csv` har formatet:
```csv
label,ts,rssMb,heapUsedMb,heapTotalMb,openFds,dbPoolActive,dbPoolIdle,redisClients,socketIoClients,heapGrowthFromBaselinePct,fdGrowthFromBaselinePct
h0,2026-05-10T12:00:00Z,120,85,110,42,2,3,5,5,0.00,0.00
h6,2026-05-10T18:00:00Z,124,86,112,42,2,3,5,5,1.18,0.00
...
```

Plot-eksempler:

```python
# matplotlib quickplot
import pandas as pd, matplotlib.pyplot as plt
df = pd.read_csv("trends.csv")
fig, ax = plt.subplots(2, 2, figsize=(12,8))
df.plot(x='label', y='heapUsedMb', ax=ax[0][0], title='Heap brukt (MB)')
df.plot(x='label', y='openFds', ax=ax[0][1], title='Open FDs')
df.plot(x='label', y='socketIoClients', ax=ax[1][0], title='Socket.IO clients')
df.plot(x='label', y=['dbPoolActive', 'dbPoolIdle'], ax=ax[1][1], title='DB pool')
plt.tight_layout(); plt.savefig('r9-trends.png')
```

```bash
# Bruk gnuplot for ASCII-heatmap (ingen Python-avhengighet)
gnuplot -e "
set terminal dumb;
set datafile separator ',';
set key off;
plot 'trends.csv' using 0:4 with lines title 'heapUsedMb';
"
```

### 6.3 Heap-snapshot-analyse i Chrome DevTools

Hvis testen FAIL-er på heap-vekst:

1. Åpne Chrome → `chrome://inspect`
2. "Open dedicated DevTools for Node" eller "Performance" tab
3. Memory-tab → "Load profile" → velg `heap-h0.heapsnapshot`
4. Last `heap-h24.heapsnapshot` i en annen fane
5. Bruk "Comparison view": velg h24 som main, h0 som baseline
6. Sortér på "Delta" — objekt-typer som vokser unormalt vises på topp

**Mistenkelige objekt-typer:**

| Type | Indikerer |
|---|---|
| `Promise` (mange tusen) | Async-leak — uavsluttede await-kjeder, mest sannsynlig i `PerpetualRoundService.scheduleAutoRestart` |
| `Timer` / `Timeout` | `setTimeout`/`setInterval` som ikke ryddes — ofte fra reconnect-handlers |
| `Socket` / `Connection` | Socket.IO room-handlers ikke cleaned ved disconnect |
| `Map` med stort antall entries | Cache som vokser ubegrenset (Postgres prepared-statements, idempotency-keys) |
| `Buffer` (stort total-volum) | Streaming-data som ikke flushes — Redis pub/sub eller socket.IO buffering |

**Akseptable objekt-typer:**
- `String` (varies, normalt vokser med trafikk-volume)
- `Code` / `SharedFunctionInfo` (V8 internal — vokser ved JIT-warmup)
- Små absolutte tall av "Server"/"Pool" (én per service, totalt < 100)

### 6.4 Round-count vs Redis-key-count konsistens

Spill 2 perpetual-loop spawner ny runde hvert ~30 sek. Forventet round-count
i 24 t = `24 * 60 * 2 = 2880`. Sjekk Redis-key-vekst:

```bash
# Når test kjører
docker exec spillorama-system-redis-1 redis-cli DBSIZE

# Bør være ~konstant (ikke 1:1 vekst med round-count)
```

Hvis DBSIZE vokser med faktor > 1 per round → mistenkelig:
- Eldre round-state cachet uten TTL
- Race-condition i `RoomState.deleteRoom`
- Test-data lekker fra mock-spillere

### 6.5 Stability-check: draw-tick-jitter

Hvis testen feiler på heap men FD/pool er OK, sjekk om draw-tick-jitter har
økt over tid. Dette kan tyde på event-loop-saturation:

```bash
# Hent metrikker fra backenden hvis Prometheus-endpoint finnes
curl -s http://localhost:4000/metrics | grep draw_tick

# Eller fra logs
grep -i "draw.*late\|tick.*late\|jitter" /var/log/spillorama/*.log
```

Forventet: jitter konstant innenfor ±50 ms hele 24 t. Hvis det vokser
> 200 ms etter h12 → mistanke om event-loop-leak.

---

## 7. Hva å gjøre hvis FAIL

### 7.1 Generelt

1. **IKKE forsøk å fikse leak under testen.** Test-mandatet er å rapportere,
   ikke fikse. Fix går i egen P0-PR med chaos-engineering-ansvar.

2. **Bevar test-artefaktene:**
   ```bash
   tar czf r9-leak-fail-$(date +%Y%m%d-%H%M).tar.gz /tmp/r9-leak-test.*
   ```
   Last opp til 1Password / S3 / shared drive — slett ikke før fix er merget.

3. **Opprett Linear-issue:** `BIN-XXX — R9 leak-test FAIL [dato]`
   - Link til artefakt-tarball
   - Lim inn `analysis.json`-output
   - Henvis til denne runbook §7

4. **Pause pilot-utvidelse** inntil leak er fikset OG test kjørt på nytt.

### 7.2 Heap-vekst > 10 %

Mest sannsynlige årsaker (sortert etter sannsynlighet):

| Årsak | Hvor finnes den | Fix |
|---|---|---|
| `PerpetualRoundService` pending-restart-Map ikke ryddet | `apps/backend/src/game/PerpetualRoundService.ts` `pendingRestarts: Map<string, Timer>` | Sørg for `clearTimeout` + `delete pendingRestarts.get(roomCode)` ved `manualEnd` / `error` / `disconnect` |
| Socket.IO room-handlers ikke fjernet ved disconnect | `apps/backend/src/sockets/gameEvents/roomEvents.ts` | Sjekk at `socket.leave(roomCode)` + `removeAllListeners(...)` kjøres på `disconnect` |
| Postgres prepared-statement-cache ubegrenset | `apps/backend/src/db/pool.ts` | Sett `max_prepared_statements` i `pg.Pool`-config eller bytt til text-mode-queries |
| Idempotency-key-cache uten TTL | `apps/backend/src/sockets/SocketIdempotencyStore.ts` | Verifiser at Redis-TTL er 5 min og ikke uendelig |
| Compliance-ledger event-buffer | `apps/backend/src/compliance/ComplianceLedger.ts` | Sjekk batch-flush-logikk |

### 7.3 FD-vekst > 10 %

Mest sannsynlige årsaker:

| Årsak | Diagnose | Fix |
|---|---|---|
| Postgres-connections ikke returnert til pool | `select count(*) from pg_stat_activity` på Postgres | `client.release()` i alle catch-blokker (try/finally) |
| Redis-connections ikke close()-et ved reconnect | Redis `CLIENT LIST` count vokser over tid | Verifiser at `redis.disconnect()` kjøres ved socket.IO disconnect |
| Fil-handles fra `pino`-logging | `lsof -p <pid>` viser åpne `.log`-filer som vokser | Verifiser at `pino.transport({ sync: false })` flusher periodisk |
| Heap-snapshot-filer ikke lukket | `lsof -p <pid> | grep heapsnapshot` | Bruk `fs.writeSync` med eksplisitt close |

### 7.4 DB-pool idle = 0 i final

Dette betyr alle connections holdes — testen forutsetter `pg.Pool` returnerer
connections til poolen. Hvis idle = 0 etter 24 t, en av disse er sannsynlig:

- `client.release()` mangler i en error-path
- Long-running transactions som aldri commiter / ruller tilbake
- `pg.Pool({ max: N })` er for lavt for trafikk-mengden

Sjekk med:
```sql
-- På Postgres-host
SELECT pid, state, query_start, query
FROM pg_stat_activity
WHERE datname = 'spillorama' AND state != 'idle'
ORDER BY query_start;
```

Hvis flere queries er > 1 t gamle → orphan transactions. Fix: legg til
`statement_timeout` + `idle_in_transaction_session_timeout` i pool-config.

### 7.5 Socket.IO clients vokser ubegrenset

Indikerer reconnect-loop-leak. Sjekk:

```bash
# I backend-logs
grep -c "socket connect\|socket disconnect" /var/log/spillorama/backend.log
```

Hvis connect-count vokser uten tilsvarende disconnect-count → klient-side
auto-reconnect uten server-side cleanup. Fix: `engine.io.opts.maxHttpBufferSize`
+ verifiser at `socket.recovery` ikke akkumulerer.

---

## 8. Vedlikehold og oppdatering

### 8.1 Når runbook-en må oppdateres

| Endring | Påvirker | Hva må oppdateres |
|---|---|---|
| Ny diagnose-endpoint i backend | Helper.mjs sample-mode | §2.3 + §6.3 |
| Ny `Spill2Config`-felt | PASS/FAIL-kriterier | §5.1 |
| Endret `MOCK_PLAYER_COUNT`-default | Forventet socket-clients | §5.1 + §6.4 |
| Heap-snapshot-endpoint endrer URL | Helper.mjs `snapCandidates` | helper.mjs + §6.3 |
| Nytt staging-miljø | Pre-flight | §2.1 + §4.1 |

### 8.2 Forventet vedlikeholds-kadanse

- **Hver utvidelse-vurdering:** kjør full 24t test. Sammenlign vekst-tall mot historikk.
- **Hver Spill 2 backend-endring:** kjør smoke-test som del av PR-review.
- **Hver kvartal:** vurder om HEAP/FD-grenser fortsatt er relevante (kanskje vi er
  blitt strammere?).

### 8.3 Hvor historikk-data lagres

Hver leak-test-kjøring lagres i:
```
/var/log/r9-leak-test/<dato>/
  ├── samples.json
  ├── analysis.json
  ├── trends.csv
  └── heap-h*.heapsnapshot
```

Heap-snapshots tar mye plass (1 GB+ hver). Kompresser etter 30 dager:
```bash
find /var/log/r9-leak-test -mtime +30 -name "*.heapsnapshot" -exec gzip {} \;
```

Slett etter 1 år (eller behold for compliance-traceability i 7 år hvis Lotteritilsynet krever).

---

## 9. Relaterte dokumenter

| Dok | Bruk |
|---|---|
| [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.5 | Mandat-tekst for R9 |
| [SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md) | Spill 2-arkitektur (perpetual-loop, ROCKET-rom) |
| [R9_SPILL2_LEAK_TEST_RESULT.md](./R9_SPILL2_LEAK_TEST_RESULT.md) | Resultat-rapport-mal (skal fylles inn etter første full-kjøring) |
| [PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md](./PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) | Manuell pilot-flyt (ikke leak-test) |
| [PILOT_RUNBOOK_SPILL2_3_2026-05-05.md](./PILOT_RUNBOOK_SPILL2_3_2026-05-05.md) | Generell pilot-runbook for Spill 2/3 |
| [LIVE_ROOM_DR_RUNBOOK.md](./LIVE_ROOM_DR_RUNBOOK.md) S7 | DR-scenario "perpetual-loop-leak" — hvor leak ER funnet og må håndteres i prod |

---

## 10. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — dedikert operasjonell runbook (separat fra resultat-rapport). Lagt til CSV-trend-export i helper.mjs + heatmap-eksempler. Smoke-test-prosedyre verifisert lokalt med synthetic samples. | Agent H (R9 BIN-819, Bølge 2 ADR-0020) |
