---
name: live-room-robusthet-mandate
description: When the user/agent works with rom-arkitektur, socket-events, draw-tick, ticket-purchase, wallet-touch fra rom-events, eller pilot-gating-tiltak (R1-R12). Also use when they mention RoomAlertingService, SocketIdempotencyStore, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, BIN-810, BIN-811, BIN-812, BIN-813, BIN-814, BIN-815, BIN-816, BIN-817, BIN-818, BIN-819, BIN-820, BIN-821, BIN-822, chaos-test, failover, klient-reconnect, idempotent socket-events, clientRequestId dedup, health-endpoint per rom, alerting Slack PagerDuty, DR-runbook, Evolution Gaming-grade oppetid, 99.95%, perpetual-loop leak, per-rom resource-isolation. Make sure to use this skill whenever someone touches Spill 1/2/3 live-rom-arkitektur, robusthet-tiltak, eller pilot-gating — even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
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

## R1-R12 — alle pilot/utvidelses-tiltak

| # | Tiltak | Linear | Estimat | Pilot-gating? | Status |
|---|---|---|---|---|---|
| **R1** | Lobby-rom Game1Controller-wireup ("FÅR IKKE KOBLET TIL ROM"-fix) | BIN-822 | 1-2d | Ja | ✅ Merget #1018 + #1033 |
| **R2** | Failover-test (drep instans midt i runde) | BIN-811 | 2-3d | **Ja** | Infra klar (#1032) — må kjøres |
| **R3** | Klient-reconnect-test | BIN-812 | 2d | **Ja** | Infra klar (#1037) — må kjøres |
| **R4** | Load-test 1000 klienter per rom over 60 min | BIN-817 | 2-3d | Utvidelse | Ikke startet |
| **R5** | Idempotent socket-events (`clientRequestId`-dedup) | BIN-813 | 2d | **Ja** | ✅ Merget #1028 |
| **R6** | Outbox for room-events (alle wallet-touch via outbox) | BIN-818 | 1-2d | Utvidelse | Wallet-siden ferdig (BIN-761); rom-side må verifiseres |
| **R7** | Health-endpoint per rom | BIN-814 | 1d | **Ja** | ✅ Merget #1027 |
| **R8** | Alerting (Slack/PagerDuty) ved error-state > 30s | BIN-815 | 1d | **Ja** | ✅ Merget #1031 |
| **R9** | Spill 2 perpetual-room 24t-leak-test | BIN-819 | 2d | Utvidelse | Ikke startet |
| **R10** | Spill 3 phase-state-machine engine-wireup + chaos-test | BIN-820 | 3-4d | Utvidelse | Foundation: PR #1008 |
| **R11** | Per-rom resource-isolation (én rom-feil må aldri ta ned andre rom) | BIN-821 | 3-5d | Utvidelse | Ikke startet |
| **R12** | DR-runbook for live-rom | BIN-816 | 1d | **Ja** | ✅ Merget #1025 |

**Sum:** ~22-30 dev-dager. Kan parallelliseres med 3-4 agenter til ~7-10 kalenderdager.

## Pilot-gating (4 haller, Tobias 2026-05-08)

**Må være lukket før pilot går live:**
- ✅ R1 (Game1Controller-wireup)
- [ ] R2 — failover-test grønn
- [ ] R3 — reconnect-test grønn
- ✅ R5 — idempotent socket-events
- ✅ R7 — health-endpoint live
- ✅ R8 — alerting live
- ✅ R12 — runbook validert

**Kan være planlagt etter pilot (men før utvidelse):**
- R4 (load-test for skala)
- R6 (outbox-validering)
- R9 (Spill 2 24t-test)
- R10 (Spill 3 chaos-test)
- R11 (per-rom isolation)

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

## Kanonisk referanse

`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` er autoritativ. Tobias-eier — endringer krever direkte godkjenning. Ved tvil mellom kode og mandat: mandat vinner, koden må fikses.
