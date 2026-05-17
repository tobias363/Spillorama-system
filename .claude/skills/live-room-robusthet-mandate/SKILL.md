---
name: live-room-robusthet-mandate
description: When the user/agent works with rom-arkitektur, socket-events, draw-tick, ticket-purchase, wallet-touch fra rom-events, eller pilot-gating-tiltak (R1-R12). Also use when they mention RoomAlertingService, SocketIdempotencyStore, EngineCircuitBreakerPort, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, BIN-810, BIN-811, BIN-812, BIN-813, BIN-814, BIN-815, BIN-816, BIN-817, BIN-818, BIN-819, BIN-820, BIN-821, BIN-822, chaos-test, failover, klient-reconnect, idempotent socket-events, clientRequestId dedup, health-endpoint per rom, alerting Slack PagerDuty, DR-runbook, Evolution Gaming-grade oppetid, 99.95%, perpetual-loop leak, per-rom resource-isolation, stuck-game-recovery, monotonic stateVersion, RoomStateStore, SerializedRoomState, scheduledGameId-persistens, isHallShared-persistens, isTestHall-persistens, pendingMiniGame-persistens, spill3PhaseState-persistens, Redis-restart-recovery, ADR-0019, ADR-0020, ADR-0022. Make sure to use this skill whenever someone touches Spill 1/2/3 live-rom-arkitektur, robusthet-tiltak, eller pilot-gating — even if they don't explicitly ask for it.
metadata:
  version: 1.4.0
  project: spillorama
---

<!-- scope: apps/backend/src/sockets/SocketIdempotencyStore.ts, apps/backend/src/sockets/withSocketIdempotency.ts, apps/backend/src/observability/RoomAlertingService.ts, apps/backend/src/adapters/EngineCircuitBreakerPort.ts, apps/backend/src/routes/publicGameHealth.ts, infra/chaos-tests/**, apps/backend/src/__tests__/chaos/**, docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_*.md -->

# Live-rom-robusthet — Evolution Gaming-grade pilot-mandat

Spill 1, Spill 2 og Spill 3 er live-rom som **alltid** må være tilgjengelige innenfor spilleplanens åpningstid. Mål: Evolution Gaming-grade oppetid (99.95%+). Hvis rom-arkitektur, socket-events, draw-tick, ticket-purchase eller wallet-touch fra rom-events røres: **dette mandatet er bindende**. R1-R12 er pilot-gating eller utvidelses-gating.

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc:**
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — autoritativt mandat
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 1-status med R-tiltak
- `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 2-status
- `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 3-status
- `docs/operations/LIVE_ROOM_DR_RUNBOOK.md` — DR-runbook (R12)

**Direktiv (Tobias 2026-05-08):**
> "Det er ekstremt viktig at arkitekturen rundt rommene er robust. Spill 1, 2 og 3 er live rom som alltid må være live innenfor åpningstid. Vi må sette alle de ressursene vi ser hensiktsmessige for at vi får like robust løsning på dette område som Evolution Gaming."

**Linear:** [BIN-810 R-mandat parent](https://linear.app/bingosystem/issue/BIN-810) + R1-R12 children (BIN-811..822).

## Hvorfor dette er P0

- **Direkte tap av omsetning** — hver feilet runde, hver "rom utilgjengelig"-melding er penger som går til konkurrent
- **Tillit som ikke kan kjøpes tilbake** — bingo-spillere er vanedyr. Mister vi dem én gang på ustabilitet, kommer de ikke tilbake
- **Regulatorisk risiko** — pengespillforskriften §66 (obligatorisk pause) og §71 (rapportering) kan ikke håndheves korrekt hvis rom-state er inkonsistent
- **Pilot-blokker** — vi kan ikke gå live i fire pilot-haller hvis grunnflyten faller når en runde feiler

Dette er **ikke** en "P1 etter pilot" — det er **fundament som må være på plass før pilot går live**.

## Robusthet-krav (Evolution-grade)

### Tilgjengelighet
- **Mål:** 99.95% uptime innenfor åpningstid (≤ 4 min/uke nedetid)
- **Stretch:** 99.99% (≤ 50 sek/uke)
- Måles per (hall, dato) — ikke aggregert (én hall ned er fortsatt en feil)

### Determinisme
- **Ingen race-conditions** mellom socket-events, draw-tick, ticket-purchase, payout
- **Idempotent håndtering** av alle state-overganger (start, draw-next, pause, resume, finish)
- **REPEATABLE READ** eller serialisering på alle wallet-touch-paths (BIN-761→764)

### Recovery
- **Automatisk re-kobling** for klient innen 3 sek etter midlertidig nettverksfeil
- **State-replay** ved klient-reconnect — klient skal kunne hente full rom-state og fortsette uten tap
- **Cross-instance failover** — hvis backend-instans dør midt i runde, skal annen instans plukke opp via Redis-state og fortsette uten å miste draws/marks
- **Idempotente socket-meldinger** med `clientRequestId`/`messageId`

### Observabilitet
- **Strukturert event-logg** for hver state-overgang (`room.opened`, `round.started`, `draw.next`, `claim.submitted`, `round.finished`)
- **Health-endpoint per rom** — `/api/games/spill[1-3]/health?hallId=X` returnerer alltid live-state, aldri stale > 5 sek
- **Metrics:** p50/p95/p99 for socket-roundtrip, draw-tick-jitter, ticket-purchase-latency
- **Alerting:** Slack/PagerDuty hvis rom står i error-state > 30 sek

### Last og kapasitet
- **Tåle 1000 samtidige klienter per rom** uten degradering (4 haller × 250 spillere er pilot-realistisk; vi planlegger for 10× pilot)
- **Backpressure** ved ticket-purchase-burst (alle kjøper i siste minutt før rundestart)
- **Graceful degradation** — hvis Redis er treg, fall tilbake til read-only og varsle ops

### Konsistens med wallet
- **Aldri** belaste lommebok uten at ticket-rad faktisk er commit-et
- **Aldri** utbetale premie uten audit-event
- Outbox-pattern (BIN-761→764) for alle wallet-touch fra rom-event

## Etter-runde auto-return til lobby (Tobias 2026-05-14)

**Tobias-direktiv:**
> "Etter endt runde må man bli ført tilbake til lobbyen til spillet etter at runden er ferdig, må da bli ført tilbake når man er sikker på at rommet er klart igjen og live."

**Flyt (Game1):**
1. Runde ender (BINGO_CLAIMED / MAX_DRAWS / MANUAL_END) → `Game1EndOfRoundOverlay` viser vinner-summary
2. Persistent spinner med tekst "Forbereder rommet..."
3. Klient lytter på `room:update WAITING` med ny `currentGame.id` (ny runde spawnet av backend) → `markRoomReady()` → normal dismiss til in-room WAITING
4. **Fallback: 15s max-timeout (`MAX_PREPARING_ROOM_MS`)** → forced auto-return til lobby via `onBackToLobby` (samme path som manuell knapp-klikk). De siste 2 sekundene byttes loading-teksten til "Returnerer til lobby..." for synlig overgang
5. Manuell "Tilbake til lobby" forblir alltid tilgjengelig som backup

**Hvorfor max-timeout er obligatorisk:**

Backend emit-er ikke nødvendigvis ny `room:update` umiddelbart etter round-end (master må starte neste runde, eller perpetual-loop må spawne ny scheduled-game). Uten timeout-fallback henger spilleren evig på "Forbereder rommet..."-spinner — Tobias-rapport 2026-05-14 09:54 etter runde 330597ef. ALDRI fjern timeout-fallback uten å erstatte med annen guarantee.

**Implementasjon (`packages/game-client/src/games/game1/components/Game1EndOfRoundOverlay.ts`):**
- `MAX_PREPARING_ROOM_MS = 15_000` — max wait before forced auto-return
- `RETURNING_TO_LOBBY_PREVIEW_MS = 2_000` — last 2s show "Returnerer til lobby..."
- Sentry-breadcrumb `endOfRoundOverlay.autoReturnFallback` ved timeout
- Idempotent — cancelles av manuell klikk, `markRoomReady` eller `hide()`
- Reconnect-resilient — `elapsedSinceEndedMs > MAX_PREPARING_ROOM_MS` triggrer auto-return umiddelbart

**Spill 2/3 (perpetual rocket/monsterbingo):** Bruker IKKE `Game1EndOfRoundOverlay`. Auto-restart-flyten der er backend-drevet (`PerpetualRoundService.handleGameEnded` → `roundPauseMs`-delay → ny runde i samme rom). Klient ser kun pause + ny `gameStarted`-event. Hvis perpetual-loopen feiler å spawne ny runde, er det en server-side bug (R9-leak-test gating) — ikke en klient-UX-bug.

**Anti-pattern:** Fjerne 15s timeout fordi "backend skal jo alltid emit-e ny event". Det er NETTOPP det Tobias-rapport 2026-05-14 demonstrerer er feil — vi MÅ ha fallback for når backend ikke emit-er innen rimelig tid.

**Symptom hvis fjernet:** "Forbereder rommet..."-spinner henger evig. Brukeren må klikke "Tilbake til lobby" manuelt eller refreshe siden. Pilot-blokker for UX-mandat.

## R1-R12 — alle pilot/utvidelses-tiltak (status per 2026-05-13)

| # | Tiltak | Linear | Pilot-gating? | Status |
|---|---|---|---|---|
| **R1** | Lobby-rom Game1Controller-wireup | BIN-822 | Ja | ✅ Merget #1018 + #1033 |
| **R2** | Failover-test (drep instans midt i runde) | BIN-811 | **Ja** | ✅ **PASSED 2026-05-08 22:39** (recovery 2s, alle invariants OK) |
| **R3** | Klient-reconnect-test (5s/15s/60s) | BIN-812 | **Ja** | ✅ **PASSED 2026-05-08 22:42** (alle 3 scenarioer) |
| **R4** | Load-test 1000 klienter | BIN-817 | Utvidelse | ✅ Infrastructure merget (PR #1180) — kjør pre-utvidelse |
| **R5** | Idempotent socket-events | BIN-813 | **Ja** | ✅ Merget #1028 (`withSocketIdempotency`) |
| **R6** | Outbox for room-events | BIN-818 | Utvidelse | Wallet-siden ferdig (BIN-761); rom-side må verifiseres |
| **R7** | Health-endpoint per rom | BIN-814 | **Ja** | ✅ Merget #1027 |
| **R8** | Alerting (Slack/PagerDuty) | BIN-815 | **Ja** | ✅ Merget #1031 |
| **R9** | Spill 2 perpetual 24t-leak-test | BIN-819 | Utvidelse | Runbook klar; må kjøres |
| **R10** | Spill 3 phase-state-machine chaos-test | BIN-820 | Utvidelse | Foundation merget; chaos-test må kjøres |
| **R11** | Per-rom resource-isolation | BIN-821 | Utvidelse | ✅ **Circuit-breaker + latency-tracker merget (PR #1176, ADR-0020 P1-6)** |
| **R12** | DR-runbook for live-rom | BIN-816 | **Ja** | ✅ Merget #1025 + valideringsplan (R12_DR_VALIDATION_PLAN.md) |

## Pilot-gating (4 haller) — status 2026-05-13

**Alle pilot-gating-krav er GRØNNE:**
- ✅ R1 (Game1Controller-wireup)
- ✅ R2 (failover-test PASSED 2026-05-08)
- ✅ R3 (reconnect-test PASSED 2026-05-08)
- ✅ R5 (idempotent socket-events)
- ✅ R7 (health-endpoint live)
- ✅ R8 (alerting live)
- ✅ R12 (runbook merget; drill-validering pending)

**Pilot-go-live mandat: GRØNT** (per `CHAOS_TEST_RESULTS_R2_R3_2026-05-08.md`).

**Pre-utvidelse til > 4 haller — gjenstår:**
- R4 (load-test 1000 — infrastruktur klar; synthetic-precursor under)
- R6 (outbox-validering — wallet-side ferdig)
- R9 (Spill 2 24t-leak)
- R10 (Spill 3 chaos-test)
- 2-4 ukers drift-data uten kunde-klager

### Synthetic bingo-runde-test (R4-precursor, 2026-05-14)

Småskala (10 spillere × 3 bonger) ende-til-ende-test som validerer **seks
strukturelle invarianter (I1-I6)** i én komplett Spill 1-runde:

- I1 Wallet-konservering
- I2 Compliance-ledger entries
- I3 Hash-chain intakt (WARN inntil dev-endpoint legges til)
- I4 Draw-sequence consistency
- I5 Idempotency
- I6 Round-end-state

**Pilot-gating:** ALLTID kjør `npm run test:synthetic` pre-pilot-deploy.
Hvis I1, I2, I5 eller I6 FEILER → pilot pauses umiddelbart (compliance
+ regulatorisk eksponering).

**Hvordan kjøre:**
```bash
RESET_TEST_PLAYERS_TOKEN=spillorama-2026-test \
  npm run test:synthetic
```

**Hva tester den IKKE:** failover (R2), reconnect (R3), 24t-leak (R9),
phase-state-chaos (R10), full load (R4). Synthetic er **precursor**.

**Doc:** [`docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`](../../../docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md)

## Bølge 1 + Bølge 2 — Evolution-grade utvidelse (2026-05-11 → 2026-05-13)

### Bølge 1 (ADR-0019) — state-konsistens
- ✅ P0-1: Monotonic `stateVersion` på `room:update` (PR #1169)
- ✅ P0-2: Sync-persist på critical room-state paths (PR #1170)
- ✅ P0-3 + P0-4: Targeted broadcast for admin-events (PR #1168)
- ✅ P0-5: ADR-0021 — master kan starte uten klare haller (PR #1177)

### Bølge 2 (ADR-0020) — utvidelses-fundament
- ✅ P1-3: Redis health-monitor + degradering-alarmer (PR #1174)
- ✅ P1-6 / R11: Per-room circuit breaker + latency tracker + isolation guard (PR #1176)
- ✅ R4: Load-test infrastructure for 1000 klienter (PR #1180)

### ADR-0022 — Multi-lag stuck-game-recovery (PR #1241)
Auto-reconcile fra lobby-poll (I16, F-02). Recovery-layers: (1) lobby-poll auto-reconcile, (2) periodic stuck-game scan, (3) manuell admin-override, (4) DR-runbook fallback.

## Go/no-go-policy (Tobias 2026-05-08, §6.1)

**BESLUTNING:** Hvis Bølge 1-tiltakene R2 (failover) eller R3 (reconnect) avdekker strukturelle arkitektur-problemer, **skal pilot-utrulling pauses** inntil problemet er løst.

**Begrunnelse:** Tap av kunde-tillit ved live-feil er dyrere enn 1-2 ukers utsatt pilot. Bingo-spillere er vanedyr — én dårlig kveld med "rom utilgjengelig" eller mistede draws sender dem til konkurrent og de kommer ikke tilbake.

**Operativ konsekvens:**

1. **R2/R3 må kjøres FØR pilot-go-live-møte** — ikke etter. Resultatet må være grønt eller "kjent risiko med dokumentert mitigation"
2. **"Best effort, fikser i drift" er IKKE et akseptabelt go-live-kriterium**
3. **Pilot-go/no-go-møte må holdes** med Tobias før første hall går live
4. **Ved tvil — pause.** Bedre å vente 2 uker enn å brenne tilliten i pilot-haller

**Hva som regnes som "strukturelt problem":**
- Draws kan mistes ved instans-restart (R2)
- Klient kan ikke replay-e state etter > 5 sek nett-glipp (R3)
- Wallet-double-spend ved race-condition
- En rom-feil drar ned andre rom (R11)
- §66/§71-rapporter blir inkonsistente ved instans-failover

**Hva som IKKE blokkerer (kan fikses i drift):**
- Performance-tuning (latency, throughput) hvis vi er innenfor SLA
- UI-polish
- Mindre feature-mangler som ikke berører rom-state
- Logging/metrics-forbedringer

## Implementasjons-detaljer

### R5 — Idempotent socket-events (BIN-1028)

**Fil:** `apps/backend/src/sockets/SocketIdempotencyStore.ts`, `apps/backend/src/sockets/withSocketIdempotency.ts`

`clientRequestId` (UUID v4) på alle socket-events. Server dedup-erer i Redis med 5-min TTL.

**Cache-key:** `(userId, eventName, clientRequestId)`

**Hva som er idempotent:**
- `ticket:mark`
- `ticket:buy`
- `claim:submit`
- `bet:arm`

### R7 — Health-endpoint per rom (BIN-1027)

**Endpoints:**
- `GET /api/games/spill1/health?hallId=X` (per-hall lobby)
- `GET /api/games/spill2/health?hallId=X` (rocket — global, hallId for logging)
- `GET /api/games/spill3/health?hallId=X` (monsterbingo — global, hallId for logging)

**Public, no-auth, rate-limit 60/min/IP, no-cache.** Aldri stale > 5s.

**Status-mapping:**
- `ok` — alt friskt eller venter på neste runde innenfor åpningstid
- `degraded` — aktiv runde men minst én avhengighet svikter (Redis nede / draw stale > 30s)
- `down` — DB nede, eller utenfor åpningstid uten aktiv runde

### R8 — Alerting (BIN-1031)

**Fil:** `apps/backend/src/observability/RoomAlertingService.ts` + `RoomAlertingBootstrap.ts`

Slack/PagerDuty-varsel hvis rom står i error-state > 30 sek eller draw-tick-jitter > 2s.

**Hash-chain audit:** `app_alert_log` med `entry_hash` (SHA-256 av forrige + dette) for tippe-sikker logg.

### R12 — DR-runbook

**Fil:** `docs/operations/LIVE_ROOM_DR_RUNBOOK.md`

Scenarier S1-S7 som drilles minst én gang i staging før pilot:
- S1: Backend-instans dør midt i runde
- S2: Redis blir utilgjengelig
- S3: Postgres lever men er treg
- S4: Master-hall blir offline
- S5: GoH-membership endrer seg under runde
- S6: Phantom-rom etter restart
- S7: Wallet-outbox stuck

## Eksternt løft (Tobias 2026-05-08, §8.1)

**BESLUTNING:** Vi henter IKKE inn SRE-konsulent før R2/R3 er forsøkt internt. **Trigger for ekstern eskalering:**

- **R2 (failover-test) viser strukturelle problemer** med fix-estimat > 1 uke → eskalér for SRE-konsulent
- **R3 (reconnect-test) viser strukturelle problemer** med fix-estimat > 1 uke → eskalér
- **R11 (per-rom isolation)** krever distributed-systems-arkitekt → eskalér når R11 startes
- **> 1 hendelse/mnd etter 3 mnd drift** → vurder chaos-engineering-byrå (Gremlin / lignende)

**Budsjett-rammer (estimat):**
- SRE-konsulent (3-4 uker, R2/R3 + R11): 200-400k NOK
- Erfaren distributed-systems-arkitekt (R11 enkeltstående): 150-250k NOK
- Chaos-engineering-byrå (kontinuerlig, post-3-mnd): 50-100k NOK/mnd

## Pilot-omfang (Tobias 2026-05-08, §8.2)

**BESLUTNING:** Pilot holder **4 haller** (Teknobingo Årnes som master + Bodø + Brumunddal + Fauske). Ingen utvidelse til 6-8 før vi har 2-4 ukers drift-data fra 4-hall-pilot.

**Utvidelses-trigger fra 4 til neste hall(er):**
- 4-hall-pilot grønn (ingen pilot-pauser, ingen kunde-klager om "rom utilgjengelig") i 2 uker
- R4 (load-test 1000 klienter) bestått
- R6 (outbox-validering) bestått
- R9 (Spill 2 24t-leak) bestått
- Alle pilot-haller har null kjente compliance-feil

## Hvordan måle "Evolution Gaming-grade"

Evolution publiserer ikke SLA-er offentlig, men markeds-rykte tilsier:
- **Uptime under live-event:** 99.99%+ (de tar ned for vedlikehold, men aldri midt i runde)
- **Reconnect:** sekunder, ikke minutter — spilleren merker sjelden et nettverks-glipp
- **Determinisme:** absolutt — to spillere som ser samme runde får samme resultat
- **Auditerbar:** hver hånd / hver runde kan reproduseres event-for-event for compliance

Vår benchmark er **"håndterer feil så godt at sluttbruker ikke merker det"**. Det krever:
- Redundans
- Failover
- Idempotens
- Observabilitet

## Vanlige feil og hvordan unngå dem

### 1. Lager nye paths uten R5-idempotency
Symptom: Nye socket-events uten `clientRequestId`-dedup.
**Fix:** ALLE wallet-touch-events MÅ være idempotente. Wrap i `withSocketIdempotency`.

### 2. Skriver state utenfor outbox
Symptom: `socket.emit(...)` etter wallet-mutering, men ikke i samme TX.
**Fix:** Bruk outbox-pattern. Worker plukker og emitter asynkront.

### 3. Antar Redis er pålitelig
Symptom: Kode krasjer ved Redis-timeout.
**Fix:** Graceful degradation. Falle tilbake til Postgres-only hvis Redis er treg.

### 4. Skipper R7 health-endpoint update
Symptom: Endrer rom-state-felter men oppdaterer ikke `GameRoomHealth`-shape.
**Fix:** Verifiser at health-endpoint returnerer alle relevante felter.

### 5. Antar single-instance backend
Symptom: In-memory state istedenfor Redis-backed state.
**Fix:** All rom-state må være cross-instance-tilgjengelig via Redis. Failover (R2) avhenger av det.

### 6. Skipper rate-limit på health-endpoint
Symptom: Public health-endpoint kan DoS-es.
**Fix:** 60/min/IP rate-limit. Verifisert i R7-implementasjon.

### 7. Mangler audit-event ved state-overgang
Symptom: Ingen logg når master pauser eller advance-er.
**Fix:** Strukturert event-logg for hver state-overgang. R8-alerting bygger på dette.

### 8. Tar ned alle rom ved én rom-feil
Symptom: Unhandled exception i ROCKET-rom dreper også Spill 1-rom.
**Fix:** R11 — per-rom resource-isolation. Sirkel-bryter per rom eller process-level isolation.

### 9. Antar 4-hall pilot er nok skala
Symptom: Test mot 250 spillere/rom istedet for 1000.
**Fix:** R4 — load-test 1000 klienter per rom. Pilot er 4×250, men vi planlegger for 10× pilot.

### 10. Ignorerer perpetual-loop-leak
Symptom: Spill 2 hukommelses-leak over 24t.
**Fix:** R9 — 24t-leak-test. `Spill2Config.opening_time_*` + perpetual-loop må holde uten drift.

## Når denne skill-en er aktiv

**Gjør:**
- Les `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` FØRST
- Verifiser at endringer ikke regresserer R1-R12-tiltak
- Test idempotency på socket-events (R5)
- Sjekk health-endpoint-shape etter rom-state-endringer (R7)
- Verifiser at outbox-pattern er bevart (R6)
- Drill DR-runbook i staging før prod-deploy (R12)
- Eskaler til Tobias hvis R2/R3-test avdekker strukturelle problemer

**Ikke gjør:**
- IKKE bypass `clientRequestId`-dedup på wallet-touch socket-events
- IKKE skriv state utenfor outbox
- IKKE anta single-instance backend
- IKKE skip rate-limit på public health-endpoints
- IKKE skip audit-events ved state-overganger
- IKKE deploy til prod uten R2/R3 grønn
- IKKE utvide til > 4 haller før R4/R6/R9 bestått
- IKKE forhandl ned 99.95%-mål uten Tobias-godkjenning

## Redis room-state-serialisering — INVARIANT

`apps/backend/src/store/RoomStateStore.ts` definerer `SerializedRoomState` og `SerializedGameState`. Disse er kontrakten mot Redis (`RedisRoomStateStore.persist()` kaller `serializeRoom(room)` → `JSON.stringify` → `SETEX`).

**Hver gang du legger til et felt i `RoomState` eller `GameState` (types.ts) som beskriver live-room-state (ikke ren UI-state), MÅ du gjøre en av disse:**

1. **Persistere det:** legg til feltet i `SerializedRoomState`/`SerializedGameState`, oppdater `serializeRoom`/`serializeGame` til å emitte det, og `deserializeRoom`/`deserializeGame` til å gjenopprette det. Optional-keys skal **kun emittes når satt** (`if (room.X !== undefined)`-mønster). Deserialiseringen skal **ikke overstyre med default** når feltet mangler — la `undefined` passere.
2. **Eksplisitt unnta det:** legg en JSDoc-kommentar i `RoomState`/`GameState` som forklarer hvorfor feltet IKKE persisteres (eks. "regenereres ved første draw" eller "kun in-memory cache").

**Hvorfor:** Felter som settes via dedikerte engine-helpers (eks. `markRoomAsScheduledAndPersist`) ser ut som persistert state fordi `setAndPersistWithPath` returnerer success — men hvis serializer-en dropper dem, går de tapt ved Redis-restart, og første reconnect-burst etterpå feiler.

**Konkrete invarianter (per 2026-05-17):**

| Felt | Hvor | Hvorfor det MÅ persisteres |
|---|---|---|
| `scheduledGameId` | RoomState | scheduled Spill 1-binding mot `app_game1_scheduled_games`. Tap → `room:resume`-validering feiler → alle reconnects feiler |
| `isHallShared` | RoomState | GoH-rom + global Spill 2/3 skal skippe HALL_MISMATCH-sjekken. Tap → spillere kastes ut av rommet |
| `isTestHall` | RoomState | Demo-haller går gjennom alle 5 faser i stedet for å ende på Fullt Hus. Tap → pattern-evaluator avslutter for tidlig |
| `pendingMiniGame` | RoomState | Mini-game som overlevde `archiveIfEnded`-wipe. Tap → Tobias prod-incident 2026-04-30 reaktiveres |
| `spill3PhaseState` | GameState | Spill 3 sequential phase-state (R10). Tap → runde re-starter fra Rad 1 etter recovery |
| `isPaused` + pause-felter | GameState | Master-pauset spill auto-resumes etter restart hvis disse mangler |
| `participatingPlayerIds` | GameState | KRITISK-8: payout-binding og compliance-ledger trenger denne |
| `patterns` / `patternResults` | GameState | Live pattern-state for klient — uten dette mister klient progresjon på recovery |
| `isTestGame` | GameState | BIN-463: test-flagg. Tap → test-runde kan plutselig debite ekte wallets |

**Test-pattern:** `apps/backend/src/store/RoomStateStore.test.ts` har én test per kritisk felt + én "ALLE felter samtidig"-test + én "pre-hardening backward-compat"-test som verifiserer at gamle Redis-payloads fortsatt deserialiseres uten å introdusere uønskede defaults.

**Når du oppdager et NYTT felt som bør persisteres:** legg det til i `SerializedRoomState`/`SerializedGameState`, oppdater `serializeRoom`/`serializeGame`-funksjonene, legg til regresjons-test, og oppdater tabellen over. Sjekk samtidig om eksisterende kode kaller `setAndPersistWithPath` med det feltet satt — hvis ja, tapet er ekte og må flagges i PITFALLS_LOG.

## Kanonisk referanse

`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` er autoritativ. Tobias-eier — endringer krever direkte godkjenning. Ved tvil mellom kode og mandat: mandat vinner, koden må fikses.

**Relaterte ADR-er:**
- [ADR-0019 — Evolution-grade state-konsistens (Bølge 1)](../../../docs/adr/0019-evolution-grade-state-consistency-bolge1.md)
- [ADR-0020 — Evolution-grade utvidelses-fundament (Bølge 2)](../../../docs/adr/0020-evolution-grade-utvidelses-fundament-bolge2.md)
- [ADR-0021 — Master kan starte uten solgte bonger](../../../docs/adr/0021-allow-master-start-without-players.md)
- [ADR-0022 — Multi-lag stuck-game-recovery](../../../docs/adr/0022-stuck-game-recovery-multilayer.md)

**Test-resultater:**
- `docs/operations/CHAOS_TEST_RESULTS_R2_R3_2026-05-08.md` — autoritativ R2/R3-status
- `docs/operations/R4_LOAD_TEST_RUNBOOK.md` — R4 load-test (infrastruktur klar)
- `docs/operations/R9_SPILL2_LEAK_TEST_RUNBOOK.md` — R9 leak-test
- `docs/operations/R12_DR_VALIDATION_PLAN.md` — DR-runbook valideringsplan

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial mandat |
| 2026-05-13 | v1.1.0 — oppdatert R-status: R2/R3 PASSED, R4 infrastruktur merget, R11 circuit-breaker merget. Lagt til Bølge 1 + Bølge 2 + ADR-0019/0020/0021/0022. |
| 2026-05-14 | v1.2.0 — lagt til "Etter-runde auto-return til lobby" seksjon (`MAX_PREPARING_ROOM_MS = 15s`-fallback) etter Tobias-rapport 2026-05-14 09:54 ("Forbereder rommet..."-spinner hang evig). |
| 2026-05-14 | v1.3.0 — la til "Synthetic bingo-runde-test (R4-precursor)" seksjon under pilot-gating. Småskala-test som ALLTID må PASSE pre-pilot. Doc: `docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`. |
| 2026-05-17 | v1.4.0 — la til "Redis room-state-serialisering — INVARIANT" seksjon. Hardened `SerializedRoomState`/`SerializedGameState` til å persistere `scheduledGameId`, `isHallShared`, `isTestHall`, `pendingMiniGame` (RoomState) + `spill3PhaseState`, `isPaused`/pause-felter, `participatingPlayerIds`, `patterns`/`patternResults`, `miniGame`/`jackpot`, `isTestGame` (GameState). Pre-hardening gikk disse tapt på Redis-restart — scheduled Spill 1 mistet binding, GoH-rom mistet isHallShared og ga HALL_MISMATCH til ikke-master-haller. |
