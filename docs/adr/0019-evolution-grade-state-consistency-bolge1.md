# ADR-0019 — Evolution-grade state-konsistens (Bølge 1)

**Status:** Accepted
**Dato:** 2026-05-10
**Deciders:** Tobias Haugen
**Konsulterer:** Senior arkitekt-audit 2026-05-10 (`docs/architecture/LIVE_ROOM_EVOLUTION_GRADE_AUDIT_2026-05-10.md` — referanse)

## Kontekst

Tobias-direktiv 2026-05-10 P0:
> "Det er meget viktig at denne funksjonaliteten er evolution nivå på løsning. svært viktig at alle liverom alltid er aktive innenfor åpningstidene og at alle kunder alltid ser det samme inne i live rommene. Sett av så mange ressurser som mulig til dette. Ekstremt viktig at dette blir gjort riktig fra nå og at vi ikke fortsetter å lappe på dårlig grunnlag."

Senior-arkitekt-audit 2026-05-10 konkluderte at live-rom-arkitekturen er ~85% Evolution-nivå med solid fundament (wallet-stack, distribuert lock, idempotency, drawIndex gap-detection, outbox, self-healing). Men identifiserte 4 P0-funn som blokkerer ekte casino-grade state-konsistens.

Dette ADR-en dokumenterer hva som lukkes i Bølge 1. P1/P2-funn vil dekkes av framtidige ADR-er.

## Beslutning

**Lukk alle 4 P0-funn parallelt i Bølge 1.** Ingen ekspedert "lapp" — hver fix skal være riktig fra grunnen.

### P0-1 — Monoton `stateVersion` på `room:update`

**Problem:** `RoomUpdatePayload` har `serverTimestamp` (ms), men klient (`GameBridge.handleRoomUpdate`) deduplikerer IKKE før den overskriver state. Kun `wallet:state` har slik dedup. Out-of-order `room:update`-payloads (typisk reconnect-replay eller multi-instance-broadcast) kan skrive eldre snapshot over nyere → klienter ser inkonsistent state.

**Løsning:**
- Server: legg til `stateVersion: number` (monoton per rom, increment pre-emit) på `RoomUpdatePayload` i `buildRoomUpdatePayload`
- Klient: avvis payload hvis `payload.stateVersion <= state.lastAppliedStateVersion` (matcher wallet:state-mønsteret)
- `serverTimestamp` (ms) er ikke unik — to emits i samme ms er teoretisk mulig
- Counter må persisteres i Redis room-state slik at den overlever instance-restart uten å nullstille

### P0-2 — Synkron persist på kritiske paths

**Problem:** `RedisRoomStateStore.set()` skriver til memory umiddelbart og kaller `persistAsync()` som `.catch(...)`. 10-50ms vindu hvor backend-crash mister state. R2 chaos-test PASSED men testet ikke alle hot paths.

**Løsning:**
- Identifiser alle "kritiske" write-paths: etter draw, etter game-end, etter payout-commit, etter master-action
- På disse: kall eksplisitt `await store.persist(roomCode)` istedenfor å lite på fire-and-forget
- Logikken finnes allerede (`HOEY-11`-kommentar) men er ikke wired
- Audit: list opp ALLE `store.set()`-call-sites og klassifiser

### P0-3 — Fjern global `io.emit(...)` for transfer-events

**Problem:** 7 globale `io.emit(...)` for `game1:transfer-*`-events lekker til 36 000 sockets. Bryter eksplisitt Wave 3b (ADR-0013). Spillere har ingen behov for transfer-events.

**Løsning:**
- Sett opp dedikert admin-master-rom (eks. `admin:masters:{gameId}`)
- Master-konsoller joiner ved init
- Bytt `io.emit(...)` → `io.to('admin:masters:'+gameId).emit(...)`
- Fjern `io.emit`-fallback — agent-portalen joiner display-rommet uansett

### P0-4 — Admin-full-snapshot-rom

**Problem:** Per-spiller-strip i perpetual-rom (Wave 3b/ADR-0013) sender strippet null-payload til `roomCode`-rommet hvis ingen player-bound socket finnes. Admin-display og TV-skjermer som joiner `roomCode`-rommet får dermed `players=[]`, `tickets={}`, `marks={}`. UI viser ikke armerte spillere → bryter direktiv "alle ser samme state".

**Løsning:**
- Send strippet payload kun til player-bound sockets
- Send FULL payload til separat `roomCode:admin`-room
- Admin-display og TV joiner admin-rommet
- Bandwidth holdes under kontroll (admin-rom er sjeldent — 1-3 sockets)

## Konsekvenser

### Positive
- **Klienter ser deterministisk samme state** — out-of-order delivery kan ikke lenger skrive feil snapshot
- **State-tap ved crash reduseres** fra 10-50ms til ~0ms på kritiske paths
- **Bandwidth-besparelse** ved 36 000 sockets — transfer-events går til <10 admin-sockets istedenfor alle
- **Admin/TV ser FULL state** uavhengig av per-spiller-strip
- **Fundament for utvidelse** fra 4 til 24 haller — ingen flaskehals i broadcast-mønstre

### Negative
- **Klient må håndtere stateVersion-skipping** — kan se "frosset" UI hvis stateVersion stagnerer (bug-magnet, må testes)
- **Sync persist gir høyere latency** på kritiske paths (~5-15ms ekstra) — akseptabelt for casino-grade
- **Admin-master-rom er nytt konsept** — krever wiring i alle admin-konsoller (ikke pent for legacy-paths)

### Nøytrale
- 4 P0-er kan parallelliseres — distinkte filer
- Bølge 1 lukker pilot-go-live-blokkere; Bølge 2 (P1) er utvidelses-blokkere

## Alternativer vurdert

### Alternativ A: Halv-implementasjon (kun P0-1 + P0-3)
Avvist: Tobias-direktiv "ekstremt viktig at dette blir gjort riktig fra nå". Halv-implementasjon er nettopp "lapp på lapp".

### Alternativ B: Bytte til Kafka eller annen event-bus for state-distribusjon
Avvist: For omfattende endring. Socket.IO + Redis-adapter er tilstrekkelig hvis stateVersion + sync persist + targeted broadcast lukkes.

### Alternativ C: Behold fire-and-forget men add WAL (write-ahead log)
Avvist: Outbox er allerede WAL-aktig for wallet-events. Room-state har ikke samme audit-krav. Sync persist på kritiske paths er enklere + tilstrekkelig.

## Implementasjon

Bølge 1 — 4 parallelle agenter:

| Agent | PR | Scope |
|---|---|---|
| Agent A | TBD | P0-1 stateVersion (server `roomHelpers.ts` + klient `GameBridge.ts`) |
| Agent B | TBD | P0-3 admin-master-rom + P0-4 admin-full-snapshot-rom |
| Agent C | TBD | P0-2 sync persist på kritiske paths |
| Agent D | TBD | P1-7 BIN-XXXX cleanup (small task, parallelliseres trygt) |

Bølge 2 (P1) og Bølge 3 (P2) dokumenteres i fremtidige ADR-er etter Bølge 1 er stabil.

## Referanser

- Tobias-direktiv 2026-05-10 (sesjons-chat)
- Senior-arkitekt-audit 2026-05-10 (in-session, output `aff0b2da27e5bd48f`)
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — opprinnelig R1-R12-mandat
- ADR-0005 (Outbox-pattern) — eksisterende fundament
- ADR-0013 (Per-spiller-strip i perpetual rooms) — Wave 3b som denne ADR utvider
- BIN-761/762/763/764 — Casino-grade wallet-stack (positive baseline)
