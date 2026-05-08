# R9 Spill 2 perpetual-loop 24-timers leak-test — resultat-rapport

**Linear:** [BIN-819](https://linear.app/bingosystem/issue/BIN-819)
**Mandat:** [docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.5](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)
**Test-skript:** [`infra/leak-tests/r9-spill2-24h-leak-test.sh`](../../infra/leak-tests/r9-spill2-24h-leak-test.sh)
**Heap-helper:** [`infra/leak-tests/heap-snapshot-helper.mjs`](../../infra/leak-tests/heap-snapshot-helper.mjs)

---

## 1. Sammendrag

Pilot-gating-test (Mandat §3.5) som verifiserer at Spill 2 perpetual-loop
(`PerpetualRoundService.ts`, PR #1016) ikke akkumulerer minne-, fil-handle-
eller DB-connection-leaks over et fullt døgn (åpningstid 11:00–21:00 × N).

**Status pr. levering:** test-infrastruktur **bygget og klar for kjøring**.
Faktisk 24t-kjøring må utføres av PM/ops før pilot-go-live-vurdering — denne
PR-en leverer kun verktøyet, ikke selve test-resultatet (jf. mandat §6.1:
"R-tester må kjøres FØR pilot-go-live-møte — ikke etter").

Smoke-modus (1 t med 5-min-sampling) er innebygd for å validere infrastruktur-
delen uten å måtte investere et helt døgn — se §5.

---

## 2. Pre-conditions

| Komponent | Verdi |
|---|---|
| Versjon | branch `test/r9-spill2-24h-leak-test` (base: `main`) |
| Backend-runtime | Node.js 22 + Express 4.21 + Socket.IO 4.8 |
| Postgres | 16-alpine (delt) |
| Redis | 7-alpine (delt) |
| Wallet-provider | postgres (casino-grade outbox + REPEATABLE READ) |
| Mock-klient | `scripts/dev/mock-players.mjs` med `--game=rocket --count=5` |
| Test-environment | Lokal Docker (kjøres av ops før hver pilot-go-live-vurdering) |
| Ressurs-budsjett | Render Starter = 512 MB RAM — vi må holde oss godt under |

### 2.1 Hva infrastrukturen forventer av backenden

Sample-helperen prøver tre diagnose-endepunkter for å hente heap-bruk, FD-count
og pool-stats:

1. `GET /api/internal/diagnostics`
2. `GET /api/admin/diagnostics`
3. `GET /health/deep`

Disse er **ikke verifisert å eksistere** ennå. Hvis ingen finnes, faller
helperen graceful tilbake til kun RSS via `docker stats` og logger en
warning. Da blir signal-styrken redusert: heap-vekst kan kun analyseres
indirekte via RSS, og pool/FD-tall blir ikke samplet. Anbefalt oppfølging
(out-of-scope for R9):

- **R9-followup-1:** Eksponer en intern-only diagnose-endpoint som returnerer
  `process.memoryUsage()`, FD-count (via `/proc/self/fd` på Linux),
  `pg.totalCount`/`idleCount`/`waitingCount` og Socket.IO `engine.clientsCount`.
  Beskytt med admin-only RBAC.
- **R9-followup-2:** Eksponer en POST-only `/api/internal/heap-snapshot`
  som kaller `v8.writeHeapSnapshot()` og returnerer fila som binær-respons.
  Rate-limit til < 5 kall/dag — heap-snapshots er dyre.

Begge er små og kan landes uavhengig av denne PR-en. Helperen sniffer på
dem og bruker dem hvis de finnes; hvis ikke, kjører testen videre med RSS-only.

---

## 3. Test-strategi

### 3.1 Kjernen

1. Sørg for at `docker-compose up` har postgres + redis + backend kjørende.
2. Logg inn som admin, hent JWT.
3. Spawn 5 mock-spillere via `scripts/dev/mock-players.mjs --game=rocket
   --count=5` — disse gjør realistic Spill 2-trafikk
   (login → join → arm/buy → mark → repeat) i hele test-perioden.
4. Hver time (`SAMPLE_INTERVAL_S=3600`):
   - Kall sample-helperen.
   - Helperen henter heap/RSS/FD/pool/Redis/socket-stats fra backenden.
   - Resultat appendes til `samples.json`.
   - Hvis label er i `HEAP_SNAPSHOTS`-listen (default `0,6,12,18,24`),
     ber helperen om en heap-snapshot for senere Chrome DevTools-analyse.
5. Etter `DURATION_HOURS` (default 24):
   - Kjør analyze-modus.
   - Beregn heap-vekst i prosent fra h0 til h24.
   - Beregn FD-vekst i prosent.
   - Sjekk DB-pool-idle for connection-leak-signaler.
   - PASS/FAIL basert på toleranse (default 10 % heap, 10 % FD).

### 3.2 Akseptable grenseverdier

| Invariant | Grense | Begrunnelse |
|---|---|---|
| Heap-vekst over 24t | < 10 % | GC-kompaktering har naturlig fluktuasjon; vekst > 10 % over et helt døgn er klart leak-mønster. |
| FD-vekst over 24t | < 10 % (±) | FD-tall skal være stabilt etter warmup; konsistent vekst er handle-leak. |
| DB-pool idle | > 0 i final-sample | Idle = 0 tyder på connections som aldri returneres. |
| Socket.IO clients | ≈ MOCK_PLAYER_COUNT (±2) | Hvis tallet vokser ubegrenset, er det socket-leak ved reconnect. |
| Mock-prosess overlevelse | Hele varigheten | Hvis mock-prosessen dør, vet vi ikke om backenden tok over eller om mock-en faktisk produserte trafikk. |

### 3.3 Hvorfor 24 timer

Mandat §3.1: 99.95 % uptime innenfor åpningstid (~10 t × 7 dager). En leak
som vokser 1 % per time vil ikke vises i en 1 t-test, men er katastrofal
over en uke. 24 t fanger:

- Akkumulert state fra ~2880 perpetual-runder (én hver 30 sek = 120/t).
- Eventuelle dag-rull-relaterte regressioner (close-day-cron, daily settle-job).
- Sove-state-håndtering hvis backenden bruker timers/setTimeout som hoper opp.

---

## 4. Resultat (placeholder for kjøring)

> Denne seksjonen fylles inn når faktisk 24t-test er kjørt. Inntil videre
> dokumenterer den hvilke datapunkter som forventes.

### 4.1 Heap-vekst (forventet utfall: < 10 %)

```text
PLACEHOLDER — vil bli fylt inn etter kjøring:

| Tidspunkt | RSS (MB) | Heap brukt (MB) | Heap total (MB) |
|---|---|---|---|
| h0 (baseline)    | TBD | TBD | TBD |
| h6               | TBD | TBD | TBD |
| h12              | TBD | TBD | TBD |
| h18              | TBD | TBD | TBD |
| h24 (final)      | TBD | TBD | TBD |
| Vekst h0 → h24   | TBD%| TBD%| TBD%|
```

### 4.2 FD-vekst (forventet utfall: stabilt)

```text
PLACEHOLDER:

| Tidspunkt | Open FDs | Endring fra baseline |
|---|---|---|
| h0    | TBD | — |
| h12   | TBD | TBD |
| h24   | TBD | TBD |
```

### 4.3 DB-connection-pool

```text
PLACEHOLDER:

| Tidspunkt | Active | Idle | Waiting | Total |
|---|---|---|---|---|
| h0    | TBD | TBD | TBD | TBD |
| h24   | TBD | TBD | TBD | TBD |
```

Forventet: ingen `connection limit reached`-loggmelding i hele perioden.
Idle skal ikke synke til 0 (= alle connections holdt; mulig leak).

### 4.4 Heap-snapshot-analyse

Heap-snapshots tas i timene `0, 6, 12, 18, 24` og lagres i samples-katalogen
som `heap-h{N}.heapsnapshot`. Last inn parene `heap-h0` og `heap-h24` i
Chrome DevTools (Memory-tab → "Load") og bruk "Comparison view" for å
identifisere objekt-typer som vokser unormalt:

- Mistenkelige tegn: et stort antall `Promise`, `Timer`, `Socket`-objekter
  som ikke fjernes. Spesielt `setTimeout`-callbacks fra
  `PerpetualRoundService.scheduleAutoRestart`.
- Akseptabelt: små absolutt-verdier av langlevende objekter
  (caches, prepared statements).

---

## 5. Smoke-modus (verifiserer infrastrukturen uten 24t-investering)

For å validere at scriptet, mock-trafikken og helperen henger sammen
uten å bruke et helt døgn, kjør:

```bash
DURATION_HOURS=1 SAMPLE_INTERVAL_S=300 HEAP_SNAPSHOTS="0,1" \
  bash infra/leak-tests/r9-spill2-24h-leak-test.sh
```

Dette tar 1 time og produserer 12 samples + 2 heap-snapshots. Smoke-modus
fanger ikke ekte leaks (1 t er for kort), men verifiserer at:

- Backend starter og svarer på `/health`.
- Migrate + seed kjører.
- Mock-spillere logger inn og produserer rocket-trafikk.
- Helperen samler diagnose-data hver 5 min.
- Analyze-modus produserer en utskrivbar rapport.

Smoke-modus skal kjøres **før** ekte 24t-test for å fange oppsetts-feil tidlig.

---

## 6. Anbefaling

**Forventet ved leak-fri kode:** PASS — heap-vekst < 10 %, FD stabilt,
DB-pool idle > 0, ingen "connection limit reached"-feil.

**Hvis test FAIL-er:**

1. Sjekk hvilke invarianter brøt seg (`samples-dir/analysis.json`).
2. Last inn `heap-h0.heapsnapshot` og `heap-h24.heapsnapshot` i Chrome
   DevTools — bruk Comparison view for å finne objekt-typer som vokser.
3. Mistenk først:
   - `PerpetualRoundService` pending-restart-map som ikke ryddes ved
     unhappy-path (manuell admin-end midt i auto-restart-window).
   - Socket.IO room-handlers som ikke ryddes ved disconnect.
   - Postgres prepared-statement-cache som vokser ubegrenset.
4. Rapporter sak via Linear (BIN-819-FOLLOWUP) før pilot.

**Beslutningen er ikke "fix lekker du finner her" — det er R-test-mandatet:
bygge infrastrukturen, kjøre den, rapportere funn, og la fix-en gå i egen
P0-PR med chaos-engineering-ansvar.**

---

## 7. Kjente begrensninger / mangler

| Begrensning | Konsekvens | Mitigering |
|---|---|---|
| Ingen `/api/internal/diagnostics` ennå | Heap/FD/pool kun samplet via RSS | R9-followup-1 (over) — eksponer endpoint |
| Ingen `/api/internal/heap-snapshot` ennå | Manuell heap-snapshot via `node --inspect` + Chrome | R9-followup-2 — eksponer endpoint |
| 5 mock-spillere er ikke 1000-klient-load | Vi tester **leak**, ikke **load** — R4 (BIN-817) eier load | R9 + R4 sammen dekker både dimensjonene |
| Render Starter = 512 MB RAM, lokal-test = uten cap | RSS-tall vil være lavere lokalt | Smoke-test før prod-deploy + spesifikk render-test |
| Test må kjøres manuelt — ikke i CI | Pilot-gating krever at PM/ops kjører før go-live | Akseptert av mandat §6.1 |

---

## 8. Levert

- [x] `infra/leak-tests/r9-spill2-24h-leak-test.sh` — runnable bash-script
- [x] `infra/leak-tests/heap-snapshot-helper.mjs` — sample + analyze
- [x] `docs/operations/R9_SPILL2_LEAK_TEST_RESULT.md` — denne rapporten
- [x] Smoke-modus dokumentert (1 t kjøring)
- [x] Akseptansegrenser konfigurert via env (`HEAP_GROWTH_LIMIT_PCT`, `FD_GROWTH_LIMIT_PCT`)
- [x] Helper validert lokalt (sample-modus + analyze-modus syntax/output OK)
- [ ] Faktisk 24t-kjøring — ansvar: PM/ops før pilot-go-live-møte

---

## 9. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial versjon — infrastruktur + smoke-modus levert. Faktisk 24t-kjøring gjenstår. | Agent (R9 BIN-819) |
