# Spill 1 — Engine-rolledeling

**Dato:** 2026-04-23
**Forfatter:** Refaktor-innsats C5
**Status:** Kanonisk forklaring av hvorfor to "engines" eksisterer parallelt
**Relatert:** [REFACTOR_PLAN_2026-04-23.md](./REFACTOR_PLAN_2026-04-23.md) §P1.1

---

## Sammendrag

Etter GAME1_SCHEDULE-migreringen eksisterer det **to adskilte "engines"** i backend som begge tilsynelatende eier "Spill 1": `BingoEngine` og `Game1DrawEngineService`. Dette er ikke parallelle draw-strømmer av samme data — det er en **rolledeling**. For *scheduled* Spill 1 (daglig-spill fra admin-kalender) er `Game1DrawEngineService` autoritativ live-engine og `BingoEngine.Room` kun player-registry + UI-snapshot. For *ad-hoc* Spill 2/3 (host-room-modellen) er `BingoEngine` fortsatt full live-engine, og `Game1DrawEngineService` er helt ut av bildet. Denne doc-en forklarer hvordan man skiller disse rollene i kode, DB og socket-lag.

---

## Historisk kontekst

### Fase 1 — BingoEngine som peer-to-peer-lobby (før GAME1_SCHEDULE)

Den opprinnelige `BingoEngine` implementerte en **host-player-modell** hvor en spiller opprettet et rom, andre joinet, og host-spilleren trykket "trekk ball" selv. All state — deltakere, draw-bag, trukne tall, pattern-eval — lå in-memory i Node-prosessen i `RoomState`. Dette er fortsatt hvordan Spill 2 (Rocket/Tallspill) og Spill 3 (Mønsterbingo) fungerer.

Designet passet for det som opprinnelig var en klient-drevet sosial lobby. Draw-bag var en array i RAM, `drawNextNumber` kalte `shift()` og pushet til `game.drawnNumbers`, og `evaluateActivePhase` gikk gjennom deltakernes ticket-grids og så hvem som vant. Hvis serveren restartet mens et spill pågikk, var staten borte.

### Fase 2 — Multi-hall + master-admin krever ny modell

Med GAME1_SCHEDULE (PR 4a→4e, høst 2026) endret scope seg fundamentalt:

- **Daglig-spill fra admin-kalender** — ikke lenger ad-hoc spiller-opprettede rom. Admin oppretter `app_game1_scheduled_games`-rad timer/dager i forveien.
- **Multi-hall** — samme scheduled-game kjøres parallelt i flere haller. Billetter kjøpes på tvers av haller.
- **Master-as-admin** — én "master"-operatør (ikke en spiller) trykker start/pause/stop, og trekking skjer enten via manuell draw-knapp eller auto-draw-tick.
- **Crash recovery** — hvis serveren restartet midt i en økt, må staten kunne rekonstrueres. Derfor må draw-bag + trukne tall være persistert i DB.
- **Purchase-cutoff, ready-flow, fysisk bong** — hele livssyklusen rundt én scheduled-game involverer tabeller som `BingoEngine.RoomState` aldri hadde hjemmel til å eie.

`BingoEngine` ble ikke designet for disse kravene. Modellen "host-player trykker trekking" er inkompatibel med "master-admin trykker, multi-hall-spillere får se resultatet". Derfor ble `Game1DrawEngineService` bygget som en DB-autoritativ parallell-engine, eksplisitt designet for scheduled-games.

### Fase 3 — De to arkitekturene sameksisterer (nåværende state)

- **`Game1DrawEngineService`** — autoritativ engine for *scheduled* Spill 1.
- **`BingoEngine`** (og subklasser `Game2Engine`, `Game3Engine`) — fortsatt autoritativ engine for *ad-hoc* host-room-spill (Spill 2 og Spill 3).
- **For scheduled Spill 1** brukes `BingoEngine.Room` som player-registry + socket-subscription-anker, men *ikke* som draw-engine. `BingoEngine.startGame/drawNextNumber/evaluateActivePhase` kalles **aldri** for scheduled Spill 1.

**PM-beslutning 2026-04-23:** Spill 2 og Spill 3 forblir host-room-modell. Ingen forhåndskjøp, ingen scheduled_games-tabell, ingen master-admin. Dermed vil `BingoEngine` som full live-engine leve videre.

Design-kilde: kommentar i [Game1DrawEngineService.ts:1-7](../../apps/backend/src/game/Game1DrawEngineService.ts):

> "BingoEngine er host-player-room-scoped og inkompatibel med master-as-admin + multi-hall-scheduled-games. Legacy BingoEngine lever videre for andre spill."

---

## Engine-roller per spill-type

### Scheduled Spill 1 (daglig-spill fra admin-kalender)

| Ansvar | Modul | Kilde |
|---|---|---|
| Live draw-engine | `Game1DrawEngineService` | [apps/backend/src/game/Game1DrawEngineService.ts](../../apps/backend/src/game/Game1DrawEngineService.ts) |
| Player-registry | `BingoEngine.Room` (kun `players`-mapet + `currentGame=null`) | [apps/backend/src/game/BingoEngine.ts](../../apps/backend/src/game/BingoEngine.ts) |
| Snapshot-feed til klient | `BingoEngine.getRoomSnapshot` (L2767) | Samme fil |
| Master-orchestrasjon | `Game1MasterControlService` | [apps/backend/src/game/Game1MasterControlService.ts](../../apps/backend/src/game/Game1MasterControlService.ts) |
| Pattern-evaluering | `Game1PatternEvaluator.evaluatePhase` | [apps/backend/src/game/Game1PatternEvaluator.ts](../../apps/backend/src/game/Game1PatternEvaluator.ts) |
| Payout | `Game1PayoutService` | [apps/backend/src/game/Game1PayoutService.ts](../../apps/backend/src/game/Game1PayoutService.ts) |
| Billett-kjøp | `Game1TicketPurchaseService` | [apps/backend/src/game/Game1TicketPurchaseService.ts](../../apps/backend/src/game/Game1TicketPurchaseService.ts) |
| Admin-broadcast | `AdminGame1Broadcaster` → `/admin-game1`-namespace | [apps/backend/src/game/AdminGame1Broadcaster.ts](../../apps/backend/src/game/AdminGame1Broadcaster.ts), [apps/backend/src/sockets/adminGame1Namespace.ts](../../apps/backend/src/sockets/adminGame1Namespace.ts) |

**Livssyklus:**

1. Admin oppretter `app_game1_scheduled_games`-rad (status `upcoming`).
2. Ready-flow åpner purchase-vindu (status `purchase_open`), spillere kjøper billetter (`Game1TicketPurchaseService`).
3. Alle haller trykker klar → status `ready_to_start`.
4. Master trykker start i admin-konsoll → `Game1MasterControlService.startGame(gameId, actor)`:
   - Oppdaterer `scheduled_games.status='running'` (DB-transaksjon).
   - **Delegerer POST-commit til `game1DrawEngineService.startGame(gameId, actorUserId)`** ([Game1MasterControlService.ts:386-388](../../apps/backend/src/game/Game1MasterControlService.ts)).
5. `Game1DrawEngineService.startGame` ([L602-703](../../apps/backend/src/game/Game1DrawEngineService.ts)):
   - Bygger pre-shuffled draw-bag via `DrawBagStrategy`.
   - `INSERT app_game1_game_state(draw_bag_json, draws_completed=0, current_phase=1)`.
   - Genererer `ticket_assignments` for alle ikke-refunderte kjøp.
6. Auto-draw-tick (`Game1AutoDrawTickService`) eller manuell draw kaller `Game1DrawEngineService.drawNext(scheduledGameId)`:
   - Leser `draw_bag_json[draws_completed]`, inserter i `app_game1_draws`.
   - Oppdaterer markings-json per assignment.
   - Kaller `evaluateAndPayoutPhase` → `Game1PatternEvaluator.evaluatePhase` → `Game1PayoutService.payoutPhaseWinners`.
   - Broadcaster POST-commit til `/admin-game1`-namespace via `AdminGame1Broadcaster.onDrawProgressed / onPhaseWon`.
7. Når fase 5 (Fullt Hus) er vunnet eller draw-bag er oppbrukt: `scheduled_games.status='completed'`, `game_state.engine_ended_at=now()`.

### Spill 2 / Spill 3 (ad-hoc host-room)

| Ansvar | Modul | Kilde |
|---|---|---|
| Live draw-engine | `BingoEngine` (via subklasser `Game2Engine`, `Game3Engine`) | [apps/backend/src/game/BingoEngine.ts](../../apps/backend/src/game/BingoEngine.ts), [Game2Engine.ts](../../apps/backend/src/game/Game2Engine.ts), [Game3Engine.ts](../../apps/backend/src/game/Game3Engine.ts) |
| Player-registry | `BingoEngine.Room.players` (samme rom) | Samme |
| Pattern-evaluering | `BingoEngine.evaluateActivePhase` (L1130) | Samme |
| Payout | `BingoEngine.payoutPhaseWinner` (samme evaluateActivePhase-flyt) | Samme |
| Draw-bag | `game.drawBag` (array i RAM, på `GameState`-objektet) | Samme |
| Trukne tall | `game.drawnNumbers` (array i RAM) | Samme |
| Socket-events | Default-namespace `/` — se [sockets/gameEvents.ts](../../apps/backend/src/sockets/gameEvents.ts) | — |

**Livssyklus:**

1. Spiller (host) kaller socket-event `room:create` → `BingoEngine.createRoom` ([L552-606](../../apps/backend/src/game/BingoEngine.ts)) — lager `RoomState` i RAM.
2. Andre spillere kaller `room:join` → `BingoEngine.joinRoom` ([L608-634](../../apps/backend/src/game/BingoEngine.ts)).
3. Host kaller `game:start` → `BingoEngine.startGame` ([L636+](../../apps/backend/src/game/BingoEngine.ts)):
   - Genererer draw-bag in-memory.
   - Oppretter `GameState` i `room.currentGame`.
4. Host kaller `draw:next` → `BingoEngine.drawNextNumber` ([L1902+](../../apps/backend/src/game/BingoEngine.ts)):
   - `game.drawBag.shift()` → `game.drawnNumbers.push()`.
   - Kaller `evaluateActivePhase` for auto-claim-on-draw (Spill 2/3) eller fasebasert claim (Spill 1 host-lobby, ubrukt for scheduled).
5. Socket-handler i [sockets/gameEvents.ts:831-832](../../apps/backend/src/sockets/gameEvents.ts) broadcaster:
   - `draw:new` med `{ number, drawIndex, gameId }`
   - `pattern:won` per vunnet pattern (BIN-694)

**Merk:** Samme `engine`-instans (faktisk en `Game3Engine`, se [index.ts:340](../../apps/backend/src/index.ts)) server G1 / G2 / G3 rooms concurrently. `onDrawCompleted`-hook guards på `variantConfig.patternEvalMode` og `gameSlug` for å skille, så Spill 2-spesifikk jackpot-logikk aktiverer *kun* for G2-rom. Spill 1 host-rom ("bingo"-slug) går fortsatt gjennom `BingoEngine.evaluateActivePhase` — men ingen produksjon-flyt per 2026-04-23 oppretter lenger Spill 1 som host-rom. Scheduled-modellen er den eneste aktive.

---

## Decision tree: når brukes hva?

```
                      ┌──────────────────────────────┐
                      │ Skal en ny draw utføres?     │
                      └──────────────┬───────────────┘
                                     │
                          ┌──────────┴──────────┐
                          │ Har spillet en      │
                          │ scheduled_game_id?  │
                          └──────────┬──────────┘
                                     │
                     ┌───────── JA ──┴── NEI ─────────┐
                     ▼                                ▼
       ┌────────────────────────────┐   ┌─────────────────────────────┐
       │ Game1DrawEngineService     │   │ BingoEngine                 │
       │ .drawNext(scheduledGameId) │   │ .drawNextNumber({roomCode}) │
       │                            │   │                             │
       │ - DB-autoritativ           │   │ - In-memory host-player     │
       │ - Broadcast /admin-game1   │   │ - Broadcast default-ns      │
       │ - Pattern: Game1Pattern... │   │ - Pattern: evaluateActive.. │
       │ - Payout: Game1PayoutSvc   │   │ - Payout: payoutPhaseWinner │
       └────────────────────────────┘   └─────────────────────────────┘
```

**Praktisk regel:**

- Rør **aldri** `BingoEngine.startGame/drawNextNumber/evaluateActivePhase` for kode som håndterer scheduled Spill 1 — det har ingen effekt på `Game1DrawEngineService`-staten og lager bare dead in-memory state.
- Rør **aldri** `Game1DrawEngineService` for Spill 2 og Spill 3 — de har ingen `scheduled_games`-rader å referere til.
- `BingoEngine.Room` (uten `currentGame`) er OK å bruke for scheduled Spill 1 som player-registry, men kun for det. Alle draw-relaterte felter på `GameState` er irrelevante i den rollen.

---

## State-eierskap

| State | Scheduled Spill 1 | Spill 2 / Spill 3 |
|---|---|---|
| Draw-bag | `app_game1_game_state.draw_bag_json` (DB) | `RoomState.currentGame.drawBag` (in-memory) |
| Trukne tall | `app_game1_draws`-rader + `game_state.draws_completed` | `RoomState.currentGame.drawnNumbers` (in-memory) |
| Player-registry | `BingoEngine.Room.players` (in-memory) + `app_game1_ticket_assignments` (DB for billetter) | `BingoEngine.Room.players` (in-memory) |
| Pattern-progresjon | `app_game1_game_state.current_phase` | `RoomState.currentGame.patternResults[].isWon` (in-memory) |
| Payout-historikk | `app_game1_phase_winners` | `RoomState.currentGame.patternResults[].payoutAmount` (in-memory audit via `ComplianceLedger`) |
| Status-state-maskin | `app_game1_scheduled_games.status` (`upcoming → purchase_open → ready_to_start → running → completed/cancelled`) | `RoomState.currentGame.status` (`CREATED → RUNNING → ENDED`) |
| Fysiske bonger | `app_game1_sold_physical_tickets` (DB) | Ikke støttet |

**Kritisk konsekvens av rolledelingen:**

Hvis Node-prosessen restartes midt i en scheduled Spill 1-økt:
1. `Game1DrawEngineService.drawNext` kan kalles igjen og leser state fra DB — plukker opp der den slapp.
2. Men `BingoEngine.Room` er borte (in-memory) — ingen player-registry. Spillere må re-joine via socket for å re-etablere registry.
3. Dette er kjent atferd og akseptert — socket-klienten vil re-subscribe på neste connect.

### Broen mellom de to arkitekturene: `scheduled_game.room_code`

Kolonnen `app_game1_scheduled_games.room_code` er linken mellom den DB-autoritative Game1DrawEngineService-verden og den in-memory BingoEngine-roomen. Player-join-flyten for scheduled Spill 1 lever i [sockets/game1ScheduledEvents.ts](../../apps/backend/src/sockets/game1ScheduledEvents.ts) og gjør følgende:

```
socket.on("game1:join-scheduled", { scheduledGameId }) ⇒
  1. Valider status ∈ {purchase_open, running} og hallId
  2. SELECT room_code FROM app_game1_scheduled_games WHERE id = $1
  3a. Hvis room_code satt:
      engine.joinRoom({ roomCode, ... })            ← BingoEngine (player-registry)
  3b. Hvis room_code NULL (første join):
      engine.createRoom({ ... })                    ← BingoEngine lager ny Room
      game1DrawEngine.assignRoomCode(gameId, code)  ← persister DB-linken
      (race-safe: FOR UPDATE + unique-index idx_app_game1_scheduled_games_room_code)
  4. ACK { roomCode, playerId, snapshot }
```

Race-sikringen er kritisk: to parallelle joins kan begge nå steg 3b samtidig. Første transaction vinner unique-constraint, andre leser vinnerens kode og destroyer sin egen Room for å `joinRoom` i det faktiske rommet. Se kommentar [Game1DrawEngineService.ts:1341-1355](../../apps/backend/src/game/Game1DrawEngineService.ts).

Etter join er room-staten **ikke sentrum for draw-logikk** — det forblir `Game1DrawEngineService` + DB. Den eneste rollen `BingoEngine.Room` har etterpå er:
- Player-registry (socket-ids → userIds for fan-out)
- `getRoomSnapshot(roomCode)` for å levere UI-state til klient (ticket-grids, trukne tall lastet fra DB indirekte via game-state-spørringer)

---

## Socket-broadcasts

To adskilte namespaces:

### `/admin-game1` — master-konsoll

Instansiert av [createAdminGame1Namespace](../../apps/backend/src/sockets/adminGame1Namespace.ts) og injektert i `Game1DrawEngineService` + `Game1MasterControlService` via `setAdminBroadcaster`. Events (kun server→klient):

| Event | Utløses fra | Payload |
|---|---|---|
| `game1:status-update` | `Game1MasterControlService.startGame/pauseGame/resumeGame/stopGame/excludeHall/includeHall` POST-commit | `AdminGame1StatusChangeEvent` |
| `game1:draw-progressed` | `Game1DrawEngineService.drawNext` POST-commit | `AdminGame1DrawProgressedEvent` (ball, drawIndex, phase) |
| `game1:phase-won` | `Game1DrawEngineService.drawNext` POST-commit når en fase avsluttes | `AdminGame1PhaseWonEvent` (winnerIds, patternName, drawIndex) |
| `game1:physical-ticket-won` | `Game1DrawEngineService.drawNext` POST-commit når fysisk bong treffer pattern | `AdminGame1PhysicalTicketWonEvent` (ticketId, pendingPayoutId) |

Alle events er fire-and-forget. Port-implementasjonen i `adminGame1Namespace.ts` kaster aldri; feil logges som warn. Se [AdminGame1Broadcaster.ts:7-11](../../apps/backend/src/game/AdminGame1Broadcaster.ts).

Auth: JWT-handshake med `GAME1_MASTER_WRITE`-rolle. Events fan-outes via `namespace.to('game1:<gameId>').emit(...)` etter at klient har kalt `game1:subscribe { gameId }`.

### Default namespace `/` — spillere

Brukt av både scheduled Spill 1 (player-snapshot-oppdateringer) og Spill 2/3 (full draw-flyt).

| Event | Utløses fra | Semantikk |
|---|---|---|
| `room:update` | `emitRoomUpdate` i `sockets/gameEvents.ts` | Full `RoomSnapshot` fra `engine.getRoomSnapshot(roomCode)` |
| `draw:new` | `sockets/gameEvents.ts:832` — etter `engine.drawNextNumber` | `{ number, drawIndex, gameId }` |
| `pattern:won` | `sockets/gameEvents.ts:841` | `{ patternId, winnerIds, payoutAmount, ... }` |
| `g2:*` / `g3:*` | `emitG2DrawEvents` / `emitG3DrawEvents` | Spill 2/3-spesifikke auto-claim-events |

**Kjent gap for scheduled Spill 1:** Default-namespace får `room:update` og `draw:new` via `sockets/gameEvents.ts` når `BingoEngine.drawNextNumber` kalles. Men for scheduled Spill 1 kalles `BingoEngine.drawNextNumber` *ikke* — det er `Game1DrawEngineService.drawNext` som trekker. Den broadcaster kun til `/admin-game1` (se [Game1DrawEngineService.ts:470-491](../../apps/backend/src/game/Game1DrawEngineService.ts)), ikke til default-namespace. Klient-spillere må derfor enten polle eller re-fetche via REST. Dette er fanget som **PR-C4** i REFACTOR_PLAN — egen PR for å wire default-namespace-broadcast fra `drawNext()` til `room_code`-rommet i BingoEngine.Room.

Koblingen `scheduled_game_id ↔ roomCode` persisteres i `app_game1_scheduled_games.room_code` (PR 4d.1). Se [Game1DrawEngineService.ts:1310-1339](../../apps/backend/src/game/Game1DrawEngineService.ts).

---

## Hvorfor Spill 2 / Spill 3 fortsatt er på host-room-modellen

**PM-beslutning 2026-04-23** (se [REFACTOR_PLAN_2026-04-23.md](./REFACTOR_PLAN_2026-04-23.md) §P1.1):

> Spill 2 / Spill 3 forblir host-room — ingen forhåndskjøp.

Begrunnelse:
- Spill 2 (Rocket/Tallspill) og Spill 3 (Mønsterbingo) har *ad-hoc*-karakter. Spillere velger når å starte en runde, ikke master-admin.
- Ingen purchase-cutoff, ingen scheduled-kalender, ingen multi-hall-ready-flow.
- Auto-claim-on-draw-modellen (3×3 fullt grid eller 5×5 pattern matches) er enklere å validere mot in-memory-state enn DB.
- Ingen fysiske bonger, ingen ready-flow-master, ingen kompleksitet som krever DB-autoritet.

**Konsekvens for refaktor:** `BingoEngine.startGame/drawNextNumber/evaluateActivePhase/payoutPhaseWinner` og `RoomState.currentGame` kan *ikke* slettes uten å brekke Spill 2/3. Dette ble fastslått under P1.1-avklaringen (PM-dialog 2026-04-23).

Hvis Spill 2/3 noen gang migreres til scheduled-modell, kan hele host-player-delen av `BingoEngine` (rundt 2500+ LOC av totale 3886) slettes. Inntil da er den kritisk.

---

## Kjente gap (per 2026-04-23)

Disse er dekket av separate PR-er i refaktor-planen:

- **PR-C1b** (NY): Wire `BingoEngine.destroyRoom()` til å kalles når `app_game1_scheduled_games.status='completed'`. Uten dette lekker `RoomState`-objekter i minne for hver fullførte scheduled Spill 1-økt. Se [BingoEngine.ts:2823](../../apps/backend/src/game/BingoEngine.ts).
- **PR-C4**: Verifisér/fiks socket-broadcast fra `Game1DrawEngineService.drawNext` til spiller-default-namespace. I dag broadcaster den kun til `/admin-game1`.
- **PR-C1**: Gjenbruk `PatternMatcher.ts` overalt hvor patterns evalueres. I dag har `BingoEngine.evaluateActivePhase` (for Spill 2/3), `Game1PatternEvaluator.evaluatePhase` (for scheduled Spill 1) og `PatternMatcher.matchesAny` (generisk) tre parallelle implementasjoner.

---

## Ende-til-ende-trace: ett draw i scheduled Spill 1

For å konkretisere rolledelingen, her er hva som faktisk skjer når master-operatør trykker "trekk ball" eller auto-draw-tick utløser en trekking.

**Trigger:** `Game1AutoDrawTickService` oppdager at intervallet siden siste draw er passert, eller admin-UI sender HTTP POST til master-control-endepunkt.

**1. `Game1DrawEngineService.drawNext(scheduledGameId)` starter transaksjonen:**
```
BEGIN
  SELECT * FROM app_game1_game_state WHERE scheduled_game_id = $1 FOR UPDATE
  SELECT * FROM app_game1_scheduled_games WHERE id = $1 FOR UPDATE
  // Sjekk paused/finished/running-status
  ball = draw_bag_json[draws_completed]
  INSERT INTO app_game1_draws (id, scheduled_game_id, draw_sequence, ball_value, ...)
  // Oppdater markings per ticket assignment
  UPDATE app_game1_ticket_assignments SET markings_json = ... WHERE scheduled_game_id = $1
  // Evaluér pattern for aktiv fase
  for each assignment: Game1PatternEvaluator.evaluatePhase(grid, markings, currentPhase)
  if winners.length > 0:
    Game1PayoutService.payoutPhaseWinners(...)
      - wallet.credit per vinner (atomisk innen transaksjonen)
      - INSERT INTO app_game1_phase_winners
    current_phase++ (eller isFinished hvis Fullt Hus)
  UPDATE app_game1_game_state SET draws_completed = ..., current_phase = ...
  if isFinished:
    UPDATE app_game1_scheduled_games SET status = 'completed'
COMMIT
```

**2. POST-commit (i `.then()`-blokken):**
```
adminBroadcaster.onDrawProgressed({
  gameId: scheduledGameId,
  ballNumber: ball,
  drawIndex: drawsCompleted,
  currentPhase,
  at: Date.now(),
})
// fan-outes til /admin-game1.to(`game1:${scheduledGameId}`).emit("game1:draw-progressed", ...)

if phaseWon:
  adminBroadcaster.onPhaseWon({ gameId, winnerIds, drawIndex, ... })

if Fullt Hus vunnet:
  miniGameOrchestrator.maybeTriggerFor(winnerIds, gameConfigJson)  // fire-and-forget

for each physicalWinner:
  adminBroadcaster.onPhysicalTicketWon({ ticketId, pendingPayoutId, ... })
```

**3. Hva skjer i `BingoEngine.Room`?**

*Ingenting.* Selv om scheduled-spillet kan ha et `room_code` mappet til en `BingoEngine.Room` (via `game1:join-scheduled`-handleren), så endres ikke `Room.currentGame` — den forblir `null` eller uendret. Ingen `GameState.drawBag.shift()` skjer. Ingen `evaluateActivePhase` kjører. Player-registry-mapet (`Room.players`) er helt passiv.

**4. Hvordan får spiller-klienter vite om den nye ballen?**

Per 2026-04-23 — ikke direkte via socket (PR-C4-gap). Default-namespace broadcastes ikke fra `Game1DrawEngineService.drawNext`. Klienter som er på `/admin-game1`-namespace (admin-operatører) får den, men spillere må polle `getRoomSnapshot` eller re-fetche via REST. Dette er ikke en egenskap ved design — det er teknisk gjeld.

Når PR-C4 er ferdig, vil `Game1DrawEngineService.drawNext` POST-commit også broadcaste `draw:new` og `room:update` til default-namespace-rommet som matcher `scheduled_game.room_code`. Da fullføres rolledelingen: admin-namespace får admin-rettede events, default-namespace får spiller-rettede events, og begge utløses av samme DB-commit.

---

## Typiske feil nye utviklere gjør

**Feil 1:** "Spill 1 trekker ikke på admin-siden, la oss kalle `engine.drawNextNumber` fra master-control."

Det vil ikke fungere. `engine.drawNextNumber` skriver kun til in-memory `GameState.drawBag`. For scheduled Spill 1 er den autoritative draw-bagen i `app_game1_game_state.draw_bag_json`. Bruk `game1DrawEngineService.drawNext(scheduledGameId)`.

**Feil 2:** "Jeg la til pattern-logikk i `BingoEngine.evaluateActivePhase`, men den får ikke effekt på scheduled Spill 1-økter."

`evaluateActivePhase` er kun relevant for Spill 2/3. For scheduled Spill 1, endre `Game1PatternEvaluator.evaluatePhase`. Disse er to parallelle implementasjoner — PR-C1 i refaktor-planen gjenforener dem via `PatternMatcher.ts`.

**Feil 3:** "Admin-konsollet får ikke oppdateringer når jeg trekker — la meg emit til default-namespace."

Admin-konsollet er på `/admin-game1`-namespace. Bruk `adminBroadcaster.onDrawProgressed(...)`. Default-namespace er for spillere. For scheduled Spill 1 er default-namespace-broadcast et kjent gap (PR-C4).

**Feil 4:** "Jeg sletter `BingoEngine.startGame` siden scheduled Spill 1 ikke bruker den."

Nei — `BingoEngine.startGame` brukes av Spill 2 og Spill 3 (via subklasser). Sletting brekker de spillene. Se PM-beslutning i REFACTOR_PLAN §P1.1.

**Feil 5:** "Player-registry-logikk burde ligge i `Game1DrawEngineService`."

Nei — `BingoEngine.Room` er bevisst beholdt som player-registry for å gjenbruke socket-, wallet-ensureAccount- og Spillvett-logikken som allerede ligger der. Å flytte dette ville duplisert mye infrastruktur. Design-vedtaket er at scheduled Spill 1 "låner" player-registry-rollen fra BingoEngine uten å bruke dens draw-engine.

---

## Scope-observasjoner for framtidige refaktorer

1. **Ved fremtidig migrering av Spill 2/3 til scheduled-modell:** hele `BingoEngine.startGame/drawNextNumber/evaluateActivePhase/payoutPhaseWinner` kan slettes. Ca 2000+ LOC reduksjon. Estimert innsats: stor — trenger separat `Game2DrawEngineService` + `Game3DrawEngineService` (eller generisk `GameDrawEngine` abstraksjon).

2. **`BingoEngine.Room` som player-registry for scheduled Spill 1 er en overlapping responsibility.** Den gjør ingenting som en lettere `Map<scheduledGameId, Set<socketId>>` ikke kunne gjort. Men player-registry-rollen samhandler med Spillvett-sjekker (`assertWalletAllowedForGameplay`) og wallet-ensureAccount som er ikke-trivielle. Ikke en kandidat for kort-siktig forenkling.

3. **Socket-broadcast-asymmetrien** (`/admin-game1` får events fra draw-engine, default-ns får fra `gameEvents.ts`) er en teknisk gjeld. En ren arkitektur ville hatt én broadcaster-port som servet begge namespaces. PR-C4 nærmer seg dette ved å bygge bro fra draw-engine til default-ns.

4. **`DomainError` lever i `BingoEngine.ts` og importeres av `Game1DrawEngineService.ts`** (se L47, 53). Det er teknisk gjeld at feil-typen bor i en fil som i prinsippet ikke burde være autoritet for scheduled Spill 1. Kandidat for flytt til `apps/backend/src/game/errors.ts` ved neste refaktor-bølge.

---

## Kilder som ble verifisert for denne doc-en

- `apps/backend/src/game/BingoEngine.ts` (3886 LOC) — L296 class, L552 createRoom, L608 joinRoom, L636 startGame, L1130 evaluateActivePhase, L1902 drawNextNumber, L2767 getRoomSnapshot, L2823 destroyRoom
- `apps/backend/src/game/Game1DrawEngineService.ts` (2822 LOC) — L363 class, L602 startGame, L716 drawNext, L1504 evaluateAndPayoutPhase, L1322 getRoomCodeForScheduledGame
- `apps/backend/src/game/Game1MasterControlService.ts` — L205 class, L297 startGame (delegerer til drawEngine L386-388)
- `apps/backend/src/game/Game1PatternEvaluator.ts` (243 LOC) — evaluatePhase (5 faser, 25-bit masker)
- `apps/backend/src/game/Game1PayoutService.ts` — split-rounding + wallet.credit
- `apps/backend/src/game/AdminGame1Broadcaster.ts` — port-interface
- `apps/backend/src/sockets/adminGame1Namespace.ts` — `/admin-game1` JWT-handshake, room-key `game1:<gameId>`
- `apps/backend/src/sockets/gameEvents.ts` — L832 `draw:new`-broadcast for BingoEngine-flyten
- `apps/backend/src/game/Game2Engine.ts`, `Game3Engine.ts` — extends BingoEngine, guards på variantConfig
- `apps/backend/src/index.ts` L340 engine = new Game3Engine, L909 game1MasterControlService, L974 game1DrawEngineService, L988 setDrawEngine
