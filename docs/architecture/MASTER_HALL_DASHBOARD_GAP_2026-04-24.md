# Master-hall dashboard + game-flow — Gap-analyse
_2026-04-24 — audit for Spill 1 pilot_

**Forfatter:** Claude Opus 4.7 audit-agent
**Scope:** Master-hall dashboard + multi-hall game-flow for Spill 1. Sammenlikner legacy Unity-backend (commit `5fda0f78:legacy/unity-backend/`) med nåværende TypeScript-stack, særlig sett i lys av Tobias' observasjon at `BINGO_SINGLE_ACTIVE_ROOM_PER_HALL=true` + auto-draw har skjult en kjerne-legacy-adferd: _"line-won STOPPER spillet, master starter neste fase manuelt."_

Alle kode-referanser er forankret i fil + linje. Bruker `git show 5fda0f78:<path>` for legacy-filer; nåværende kode refereres via absolute path.

---

## 1. Sammendrag

1. **Auto-pause ved LINE-won mangler.** Legacy `GameProcess.js:521-554` + `checkIfAutoPauseGame` (gamehelper/game1-process.js:2031-2041) kaller `stopGame` _for hver phase-winner_ når det finnes en online vinner, eller draw ≥ 75. `stopGame` clearer timer, setter `isPaused=true`, broadcaster `toggleGameStatus=Pause`, og nullstiller `otherData.agents.isReady=false` for alle agenter. Master må manuelt gjennom `startManualGame`/`resumeGame` igjen. Ny stack (`Game1DrawEngineService.drawNext` linje 963-1025) øker kun `current_phase` og lar `Game1AutoDrawTickService` (254 linjer) fortsette uavbrutt helt til Fullt Hus. **Konsekvens:** bingoverter og TV mister halvveis-pausene som var designet for fysisk bong-kontroll og Bingo-utrop.

2. **`isReady` nullstilles ikke mellom faser.** I legacy var `otherData.agents[].isReady=false` re-satt hver gang spillet ble auto-paused (GameProcess.js:3906-3909). Ingen tilsvarende logikk i `Game1HallReadyService.ts` — `is_ready` persisterer fra `markReady` til scheduler-tick flipper `purchase_open → ready_to_start → running`. Multi-fase-gjentagelsen finnes ikke i datamodellen.

3. **Per-agent ready-liste mangler.** Legacy bruker `game.otherData.agents[]`-array med `{id, hallId, hallName, isReady, scannedTickets:{isSold,isPending,isScanned}}`-records — én per fysisk agent i hallen. Ny stack har én bool per hall (`app_game1_hall_ready_status.is_ready`). Master-konsollet kan derfor ikke vise "Agent 1 klar, Agent 2 ikke klar" (jf. legacy Start-Game "not ready"-popup, `PM_HANDOFF_2026-04-23` P0 #2.4 og `LEGACY_1_TO_1_MAPPING` §3.2). Master-UI har kun grønn/oransje per hall.

4. **Red/Green/Yellow-fargekoding på hall-badge mangler.** `agentcashinoutController.js:5157-5223` (`setHallStausWithColorCode`) bygger et tre-bucket-skjema (`redHalls/greenHalls/yellowHalls`) basert på kombinert `isReady + scannedTickets.isSold + isPending + isScanned`. Broadcastes som `onHallReady`-event til alle haller i hall-gruppa. Ny stack har kun binary `isReady / excluded / waiting` i `Game1MasterConsole.ts:605-615` (`hallStatusBadge`). Vi mister "hall har skannet-men-ikke-markert-klar" = gul, og "hall har pending-scans" = gul.

5. **`AdminHallDisplayLogin` + hall-kiosk-socket mangler.** Legacy hadde `Socket.on("AdminHallDisplayLogin")` (game1.js:123-131) for TV-kiosk per hall — TV logget seg på et spesifikt `{roomId, HallId}`-par og fikk deretter alle `GameFinishAdmin`/`BingoWinningAdmin`/`onHallReady`-events. Ny stack har `admin-display:login` (`adminDisplayEvents.ts:115-129`) og `hall:<id>:display`-rom, men disse eventene er read-only for current-game-state — de aggregeres via `TvScreenService.getState` (pull-basert). Ingen per-hall-dashboard-events.

6. **`transferHallAccess` (master-overføring 60s handshake) mangler helt.** Legacy `AdminController.js:253-522` + `admnEvents.js:95-120`. Ingen ny-stack-ekvivalent (grep `transferHall` returnerer 0 treff i `apps/backend/src/`). Hvis master-hall mister strøm eller bingovert blir syk midt i dagen, må admin DB-edite `daily_schedule.hall_ids_json.masterHallId` og stoppe alle upcoming games. Pilot-blokker for operasjon med 4 haller.

7. **Hall-gruppe-rom-socket mangler.** Legacy `admnEvents.js:5-15` hadde `Socket.on("joinHall")` som gjorde `Socket.join(hallId)` slik at TV/agent-terminal i hall B fikk `adminHallEvents`-broadcasts fra master-hall A. Ny stack har `hall:<hallId>:display`-rom (adminDisplayEvents.ts:145) og `group:<groupHallId>` (adminGame1Master.ts:125-129), men `/admin-game1`-namespacet bruker `game1:<gameId>`-rom, ikke `group:<groupId>`. Hall-B-TV får ikke `game1:master-action`-broadcasts.

8. **`StartGame`-event mangler for master.** Legacy `game1.js:85-93` + `GameProcess.StartGame(Socket, data)`: én socket-event som master trigget fra Next Game-panelet. Ny stack krever HTTP `POST /api/admin/game1/games/:gameId/start` (adminGame1Master.ts:185-220). Socket-eventen `game1:master-action` broadcastes etter at start er utført (adminGame1Master.ts:124), men der er ingen socket-hook for å _trigge_ start. Dette er en bevisst arkitektur-endring (socket-til-HTTP), men fører til at `NextGamePanel.ts` (agent-portal) og `Game1MasterConsole.ts` (admin) bruker to ulike paradigmer som ikke er koblet sammen.

---

## 2. Legacy-flyt (Unity-backend)

### 2.1 Hall-link struktur

**Mongo-schemaer (commit 5fda0f78):**

```js
// legacy/unity-backend/App/Models/groupHall.js:3-31
const GroupHallSchema = new Schema({
  name: String,
  groupHallId: String,
  halls: Array,       // array av hall-referanser (id, name, status)
  agents: Array,
  products: Array,
  status: { type: String, default: 'active' },
  tvId: Number
});

// legacy/unity-backend/App/Models/hall.js:3-63
const HallSchema = new Schema({
  name: String,
  number: String,
  agents: Array,
  hallId: String,
  ip: String,            // IP til hallens terminal — brukt for master-verifisering (GameController.js:1693-1706)
  groupHall: Object,     // embedded {id, name}
  activeAgents: Array,
  hallCashBalance: Number,
  hallDropsafeBalance: Number,
  ...
});

// legacy/unity-backend/App/Models/dailySchedule.js:3-59
const dailyScheduleSchema = new Schema({
  groupHalls: Array,
  halls: Array,          // alle deltakende haller
  allHallsId: Array,
  masterHall: Object,    // { id, name } — én per dailySchedule
  stopGame: Boolean,
  status: String,        // active/running/finish
  specialGame: Boolean,
  otherData: Mixed       // inneholder transferHall-state m.m.
});

// legacy/unity-backend/App/Models/game.js:3-200 (417 linjer totalt)
const GameSchema = new Schema({
  gameType: String,      // 'game_1'
  gameName: String,
  halls: Array,           // samme som dailySchedule — kopiert ved spawn
  allHallsId: Array,
  masterHall: Object,     // kopiert fra dailySchedule.masterHall
  groupHalls: Array,
  parentGameId: ObjectId, // → dailySchedule
  status: String,         // active/running/finish
  isMasterGame: Boolean,
  isSubGame: Boolean,
  ...
  otherData: Mixed        // INNEHOLDER: masterHallId, agents[], unclaimedWinners,
                          //              pendingWinners, isPaused, pauseGameStats,
                          //              currentPattern, transferHall, gameSecondaryStatus,
                          //              isMinigame*, isClosed, isTestGame, ...
});
```

**Masterhall-rollen** settes ved spawn av daglig schedule (ikke ved runtime start). `masterHall = { id, name }` i dailySchedule + `otherData.masterHallId` i game-doc. IP-verifisering av master-agenten skjer via `GameController.js:1693-1706`:

```js
let masterHallId =  room[0].otherData.masterHallId;
let masterHallIp = await Sys.App.Services.HallServices.getSingleHallData({_id: masterHallId}, ["ip"]);
if(masterHallIp?.ip == ipOfAgent){
  console.log("Action taken by master agent", masterHallIp.ip, ipOfAgent);
  // → master-privilegier
}
```

**`groupHalls: Array`** på spill-doc: legacy lagret hele gruppe-strukturen inline (`[{id, name, status}]`). Siden flere haller kunne delta i samme kjørende runde, gjentas informasjonen per-rad, ingen normalisert many-to-many. Legacy `getOnGoingGame` (`AdminController.js:54-114`) beriker response med `myGroupHalls` filtrert på `status='active'` (ikke stoppede haller).

### 2.2 Ready-state per spiller

**Legacy holder ready-state per AGENT, ikke per hall.** Se `agentcashinoutController.js:4182-4263` (`updateGameHallStatus`):

```js
updateGameHallStatus: async function (req, res) {
  let agentId = req.session.details.id;
  let hallId = req.session.details.hall[0].id;
  let isReady = req.body.isReady;
  // ...
  let data = await Sys.Game.Game1.Services.GameServices.updateGameNested(
    { _id: req.body.gameId },
    { $set: { "otherData.agents.$[current].isReady": (isReady == "true") ? true : false } },
    { arrayFilters: [{ "current.id": ObjectId(agentId), "current.hallId": ObjectId(hallId) }], new: true }
  );
```

`otherData.agents[]` er et array med én rad per agent i alle deltakende haller:

```js
[
  { id: agent1Id, hallId: hallAId, hallName: "Hall A", isReady: true,
    scannedTickets: { isSold: true, isPending: false, isScanned: true } },
  { id: agent2Id, hallId: hallAId, hallName: "Hall A", isReady: false, ... },
  { id: agent3Id, hallId: hallBId, hallName: "Hall B", isReady: true, ... },
  ...
]
```

**Fargelogikk** (`agentcashinoutController.js:5157-5223`, `setHallStausWithColorCode`):

- `redHalls` — hall er `!isReady` og ikke master
- `greenHalls` — hall er `isReady && isScanned && isSold && !isPending`, _eller_ master-hall med scanned+sold
- `yellowHalls` — alt annet (delvis klar, pending scans, etc.)

Broadcastes som:
```js
Sys.Io.of('admin').to(hallId).emit('onHallReady', {
  gameId, redHalls, greenHalls, yellowHalls
});
// ...eller
Sys.Io.of('admin').emit('onHallReady', { ... });
```

**Dashboard-view** (`hallsStatusForGame`, `agentcashinoutController.js:4124-4167`) aggregerer til to buckets `readyHalls` + `notreadyHalls` (binary, for visuell liste "klare/ikke klare") og brukes i Start-Game-popupen "Agents not ready yet: 1, 2, 4".

### 2.3 Game-flow state machine

**Legacy:**

```
active (dailySchedule spawned, game-rad opprettet)
  │
  │  agenter markerer "klar" per hall
  │  (master ser redHalls/greenHalls/yellowHalls)
  │
  │  master trykker "Start Next Game" (Agent V1.0 panel)
  │  → startManualGame(gameId) [agentcashinoutController.js:1722, 1785-2290]
  │     → 2-min-countdown med notification-broadcast (`countDownToStartTheGame`)
  │     → startGame(game) [agentcashinoutController.js:2238-2291]
  │         → Sys.Game.Game1.Controllers.GameProcess.StartGame(gameId)
  ▼
running
  │
  │  auto-draw timer (seconds-per-kule) trekker kuler
  │  checkForWinners(gameId, ball) [GameProcess.js:120-556]
  │
  │  for hver phase-winner:
  │    isAutoPauseGame = hasOnlineWinner || isAutoStopped || withdrawBallCount >= 75
  │    hvis true:
  │      setTimeout → stopGame(gameId, "english", bySystem=true) [GameProcess.js:3853-3944]
  │        → Timeout.clear(`${gameId}_timer`)
  │        → updateGame { "otherData.isPaused": true, "otherData.pauseGameStats.isPausedBySystem": true }
  │        → emit "toggleGameStatus" { status: "Pause", bySystem: true, message: "Checking the claimed tickets." }
  │        → update "otherData.agents.$[].isReady": false   ← VIKTIG
  │        → emit "toggleGameStatus" til alle haller med oppdatert agents-liste
  │        → settlePendingWinners → skriver onlineWinners til winners[]
  ▼
paused (otherData.isPaused=true, status=running fortsatt)
  │
  │  master/bingovert sjekker fysiske bonger manuelt
  │  master klikker "Resume" (Agent V1.0 panel)
  │  → resumeGame({ gameId, action: "Resume" }) [GameProcess.js:3946-4012]
  │     → update { "otherData.isPaused": false }
  │     → emit "toggleGameStatus" { status: "Resume", message }
  │     → gameInterval(gameId) [restart auto-draw-timeren]
  │
  ▼
running (neste fase)
  │
  │  ... gjentas for Rad 2, Rad 3, Rad 4, Fullt Hus ...
  │
  │  ved Fullt Hus:
  │    phase = 5, isFinished = true
  │    → gameFinished [GameProcess.js:988-1158]
  ▼
finish (status=finish)
  │
  │  mini-game (Wheel/Chest/Mystery/Color Draft) hvis konfigurert
  │  otherData.gameSecondaryStatus kan fortsette som "running" under mini-game
  │
  ▼
finish (slutt)
```

**Viktige detaljer:**

- `status:'running'` forblir `running` selv om spillet er pauset (`isPaused=true`). Kun ved `gameFinished` blir `status='finish'`.
- `gameSecondaryStatus` er "parallell-status" under mini-game-fasen. Full House-spillet er `status='finish'`, men mini-gamet er `gameSecondaryStatus='running'`.
- Legacy har ingen eksplisitt `LINE_WON`-state — bingo-utrop, pause og ready-reset oppstår som side-effekter av `stopGame`.

### 2.4 Master-kontroll-knapper

Per `LEGACY_1_TO_1_MAPPING_2026-04-23.md` §3.2 "Agent-/Bingovert-portal" og `WIREFRAME_CATALOG.md` PDF 11 + PDF 15 (Agent V2.0 + V1.0 Latest):

**Next Game-panel:**
- `Start Next Game` (kun i Manual-mode, krever alle agenter klare eller bekreftet override)
- `PAUSE Game and check for Bingo` (åpner fysisk-bong-sjekk-modal med 5×5 grid)
- `Resume` (restart auto-draw etter pause)
- `Register More Tickets` (scan initial/final ID per farge)
- `Register Sold Tickets` (scan final ID per farge)

**Start-Game "not ready"-popup** (WF_B_Spillorama Admin_CR_21_02_2024 PDF 7):
> "Agents not ready yet: Agent 1, Agent 2, Agent 4"
> [Cancel] [Start Anyway] (override)

**Jackpot-confirm** (WF_B_Spillorama Admin_CR_21_02_2024): popup hvis runde har jackpot-aktiv Full House — master må bekrefte jackpot-threshold før start.

**2-minutters countdown** broadcast til alle deltakende haller etter Start-klikk (`notificationStartTime`-felt på game-doc), deretter faktisk `StartGame`.

**PAUSE + Check for Bingo:**
- Master trykker PAUSE (via den auto-utløste pausen, eller manuell knapp)
- Modal åpner: "Enter Ticket Number → GO → Pattern-validate"
- 5×5 grid vises med pattern-highlight
- "Winning Patterns"-liste viser alle vinnerlinjer med Status: `Cashout` | `Rewarded`
- "Reward All"-knapp deler ut gevinst til alle fysiske winners i én batch

**Transfer Hall Access** (`admnEvents.js:103-121`):
- Master hall kan trykke "Transfer Master" til en annen deltakende hall
- Ny hall får popup (`hallTransferRequest`) med 60s TTL til å akseptere
- Admin kan godkjenne/avvise fra sentral admin-UI
- Ved approve: `daily_schedule.masterHall` oppdateres + alle child-games `otherData.masterHallId` oppdateres + `pageRefresh` sendes til begge haller

---

## 3. Nåværende backend

### 3.1 Hva finnes

**Kjerneservices:**

| Service | Fil | Ansvar |
|---|---|---|
| `Game1MasterControlService` | `apps/backend/src/game/Game1MasterControlService.ts` (1083 linjer) | `startGame / pauseGame / resumeGame / stopGame / excludeHall / includeHall / recordTimeoutDetected`. All state i `app_game1_scheduled_games.status` |
| `Game1HallReadyService` | `apps/backend/src/game/Game1HallReadyService.ts` (400 linjer) | `markReady / unmarkReady / getReadyStatusForGame / allParticipatingHallsReady / assertPurchaseOpenForHall`. Én rad per (gameId, hallId) i `app_game1_hall_ready_status` |
| `Game1DrawEngineService` | `apps/backend/src/game/Game1DrawEngineService.ts` (2571 linjer) | Auto-draw-orchestrering, phase-evaluering, payout-delegation, physical-ticket håndtering |
| `Game1AutoDrawTickService` | `apps/backend/src/game/Game1AutoDrawTickService.ts` (254 linjer) | JobScheduler-tick som trigger `drawEngine.drawNext()` per kjørende game. Faste intervaller — ingen line-win-pause |
| `Game1ScheduleTickService` | `apps/backend/src/game/Game1ScheduleTickService.ts` (930+) | Scheduler-tick for state-transisjoner: `scheduled → purchase_open → ready_to_start → running` |
| `AdminGame1Broadcaster` | `apps/backend/src/game/AdminGame1Broadcaster.ts` | Publiserer `game1:status-update / draw-progressed / phase-won / physical-ticket-won` til `/admin-game1` namespace |
| `HallGroupService` | `apps/backend/src/admin/HallGroupService.ts` | CRUD for hall-grupper via `app_hall_groups` + `app_hall_group_members` |
| `TvScreenService` | `apps/backend/src/game/TvScreenService.ts` (542 linjer) | Public TV-state per hall via `/api/tv/:hallId/:tvToken/state` |

**State machine** (app_game1_scheduled_games.status, migration 20260428000000_game1_scheduled_games.sql:85-96):
```
scheduled → purchase_open → ready_to_start → running → paused → completed | cancelled
```

**HTTP endpoints** (adminGame1Master.ts):
```
POST /api/admin/game1/games/:gameId/start
POST /api/admin/game1/games/:gameId/pause
POST /api/admin/game1/games/:gameId/resume
POST /api/admin/game1/games/:gameId/stop
POST /api/admin/game1/games/:gameId/exclude-hall
POST /api/admin/game1/games/:gameId/include-hall
GET  /api/admin/game1/games/:gameId
```

**Ready endpoints** (adminGame1Ready.ts):
```
POST /api/admin/game1/halls/:hallId/ready    { gameId, digitalTicketsSold? }
POST /api/admin/game1/halls/:hallId/unready  { gameId }
GET  /api/admin/game1/games/:gameId/ready-status
```

**Socket namespaces:**
- `/admin-game1` (adminGame1Namespace.ts:1-256) — JWT-handshake-auth med GAME1_MASTER_WRITE. Events ut: `game1:status-update`, `game1:draw-progressed`, `game1:phase-won`, `game1:physical-ticket-won`. `game1:subscribe { gameId }` joiner rom `game1:<gameId>`.
- `/` default namespace — `admin:hall-event` (adminHallEvents.ts), `admin-display:*` (adminDisplayEvents.ts).

**Admin-UI:**
- `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` (615 linjer) — spill-detalj-visning + start/pause/resume/stop-knapper + exclude-hall. Bruker `/admin-game1`-socket + 5s HTTP-polling fallback.
- `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` (615+ linjer) — room-basert (BingoEngine roomCode) som brukes av Spill 2/3. Har `selfReady`-bool og "broadcast ready"-knapp med 2-min countdown, men kobles ikke mot Spill 1 scheduled_games eller `markReady`-endpointet. Har kommentert-inn "Pilot-MVP: én agent per hall" (NextGamePanel.ts:64-66).

**Tilleggs-felt i scheduled_games:**
```
master_hall_id            TEXT NOT NULL FK → app_halls(id)
group_hall_id             TEXT NOT NULL FK → app_hall_groups(id)
participating_halls_json  JSONB NOT NULL (array av hall-IDer; master implicit)
excluded_hall_ids_json    JSONB DEFAULT '[]' (dead code i ny stack)
started_by_user_id        TEXT FK → app_users(id)
stopped_by_user_id        TEXT
stop_reason               TEXT
```

### 3.2 Hva mangler

| # | Mangel | Alvorlighet | Kilde-evidens |
|---|---|---|---|
| A | **Auto-pause ved LINE/phase-won** | P0 (pilot-blokker) | Grep `pauseAfterPhase / auto.*pause / haltOnWin` i `apps/backend/src/game/` → 0 treff. `Game1DrawEngineService.drawNext` linje 1012-1025 øker kun `current_phase`. |
| B | **Reset `is_ready` mellom faser** | P0 | `Game1HallReadyService.markReady` (linje 146-190) er idempotent UPSERT uten reset-logikk. Ingen "fase-skifte"-hook kaller unmarkReady på alle haller. |
| C | **Per-agent ready-liste** | P0 (legacy paritet) | `app_game1_hall_ready_status` har én rad per (gameId, hallId). Ingen `agent_id`-kolonne. `NextGamePanel.ts:66` bekrefter "Pilot-MVP: én agent per hall". |
| D | **Red/Green/Yellow-fargekoding** | P1 | `Game1MasterConsole.ts:605-615` (`hallStatusBadge`) har kun `excluded / ready / waiting`. Ingen sammensatt `isSold/isPending/isScanned`-vurdering. |
| E | **`AdminHallDisplayLogin`-flyt** | P1 | Grep `AdminHallDisplayLogin` i `apps/backend/src/` → 0 treff. `admin-display:login` finnes, men er room-kode-basert (`/`-namespace `roomCode`), ikke scheduled-game-basert. |
| F | **`transferHallAccess` master-overføring 60s** | P0 (ops) | Grep `transferHall` → 0 treff. Bekreftet i RESEARCH_HALL_SPILL1_BINDING §1.3. |
| G | **Hall-gruppe-rom-socket (join group / fan-out)** | P1 | `admnEvents.js:5-15` har `Socket.on("joinHall")`. Ny stack har `hall:<id>:display` (TV-kiosk-scope) og `group:<groupHallId>` (admin-scope), men ikke `group:<groupHallId>` fan-out fra `/admin-game1`-namespacet. |
| H | **Master "Start Game"-popup ("agents not ready: 1,2,4")** | P0 | `Game1MasterConsole.ts:337-352` (`onStart`) viser kun excluded-halls-confirm, ikke per-agent-ready-sjekk. `NextGamePanel.ts:480-484` har selfReady-sjekk, men ikke per-agent-liste. |
| I | **Jackpot-confirm før Start** | P1 | Ingen jackpot-pre-start-sjekk i `Game1MasterConsole` eller `Game1MasterControlService.startGame`. |
| J | **2-min countdown broadcast til haller** | P1 | `NextGamePanel.ts:130-141` har `startCountdown` lokalt, men ingen backend-broadcast. `Game1MasterControlService.startGame` setter `actual_start_time=NOW()` uten notification-window. Legacy `notificationStartTime` mappes ikke til live countdown. |
| K | **TV-UI rendrer ikke ready-status** | P0 | Grep `ready-status-update / allReady / hallReady` i `apps/admin-web/src/pages/tv/` → 0 treff. TV har ikke ready-indikatorer for deltakende haller. |
| L | **`onHallReady`-broadcast med farge-buckets** | P1 | Backend broadcaster `game1:ready-status-update` med `{isReady: bool, allReady: bool}` (adminGame1Ready.ts:174-189). Legacy-kontrakten var `{redHalls[], greenHalls[], yellowHalls[]}` + per-agent payload. |
| M | **Bingo-announcement-event (legacy `BingoAnnouncement`)** | P2 | `Game1DrawEngineService` har ikke `BingoAnnouncement`-event. `game1:phase-won` finnes, men har ikke dedikert lyd/UX-cue-trigger. |
| N | **`NextGamePanel` koblet til Spill 1 scheduled_games** | P0 | `NextGamePanel.ts:41-48` importerer `listAgentRooms, startNextGame, ...` fra `agent-next-game.ts` — disse bruker room-code (BingoEngine), ikke scheduled_game_id (Game 1-scheduler). Agent-portalen kan derfor ikke starte Spill 1-runder direkte. |
| O | **Master-console kobles til `/admin-game1`-namespace, ikke `/`-namespace** | P1 | Sosial for `Game1MasterConsole` (adminGame1Socket.ts) er `/admin-game1`. Agent-portal (NextGamePanel) bruker `/`-namespace (`AgentHallSocket`). Ingen cross-listening → hall-event (pause/resume) fra agent-portal trigger ikke master-konsoll-oppdatering. |
| P | **Agent ↔ master-hall-scope for ready/pauser** | P1 | `assertHallScopeForReadyFlow` (adminGame1Ready.ts) krever at AGENT er i target-hallen. Riktig. Men `Game1MasterControlService.assertActorIsMaster` aksepterer AGENT-rollen globalt hvis `actor.hallId === master_hall_id`. Ingen distinksjon mellom HALL_OPERATOR og AGENT for master-actions. |
| Q | **`storeGamesData` / per-game agent-snapshot mangler** | P1 | Legacy kopierer `masterHall`, `halls[]`, `otherData.agents[]` til game-doc ved spawn (GameController.js lines ~storeGamesData, kopierer fra dailySchedule). Ny stack kopierer master_hall_id + participating_halls_json, men IKKE agent-liste. |
| R | **`stopGame` auto-refund samspiller ikke med pause-mellom-faser** | P1 | `Game1MasterControlService.stopGame` (linje 647-760) kjører `ticketPurchaseService.refundAllForGame` som fail-closed per rad. Hvis master "stopper" midt i Fase 3 (etter Rad 2 vunnet), refunderes ALT — inkludert Rad 1-vinnere som allerede har fått payout. Mulig double-state-issue: payouts krediteres, men billetter refunderes. |
| S | **Audit av `stop_after_phase` eller `phase_win_paused` mangler** | P2 | `MASTER_AUDIT_ACTIONS` har `start/pause/resume/stop/exclude_hall/include_hall/timeout_detected`. Ingen egen audit for "auto-pause etter phase-winner". |
| T | **`isPaused`-flag i domain-modellen** | P1 | Ny state er `running → paused` (master-initiert). Legacy hadde both `status='running'` og `otherData.isPaused=true` — en sidestate. Semantikken var: `status` = "rundens grove fase" (active → running → finish); `isPaused` = "timer stopped midt i running". Ny stack har disse kollapset. Konsekvens: state-chart er enklere, men dekker ikke "running-men-auto-paused-for-bingo-check". |

### Mulige "delvis finnes"-forbehold

- **Timer enforcement on master.** `Game1MasterControlService.recordTimeoutDetected` skriver `timeout_detected`-audit hvis noe oppdager at master ikke har startet innen forventet tid — men det kalles ikke automatisk av scheduler eller tick-service. Ingen auto-escalation (RESEARCH_HALL_SPILL1_BINDING §9.2 gap).
- **Draw-pause via `pauseGame`.** Master _kan_ pause manuelt når som helst via POST /pause — men må trykke selv; ingen auto-pause på phase-won triggers dette.
- **Ready-panel i agent-portal.** `NextGamePanel.ts:405-443` (`renderReadyPanel`) har `selfReady`-toggle og "broadcast-ready"-knapp; fungerer for room-basert Spill 2/3 men ikke for Spill 1 scheduled_games.

---

## 4. Wireframe-referanser

Basert på `WIREFRAME_CATALOG.md` + `LEGACY_1_TO_1_MAPPING_2026-04-23.md`.

**Kritiske wireframes (ikke direkte sitert, men nevnes i catalog):**

| Wireframe | Dato | Relevant indeks |
|---|---|---|
| PDF 7: `WF_B_Spillorama Admin_CR_21_02_2024_V1.0.pdf` | 2024-02-21 | 11 sider. Inneholder Role Management, Close Day, Import Player, Hall Number. **Start Game "not ready"-popup** (→ mapping §3.1, LEGACY_1_TO_1 linje 25) |
| PDF 11: `WF_B_Spillorama Agent V2.0- 10.07.2024.pdf` | 2024-07-10 | 30 sider. **Next Game-panel** + Cash In/Out + Unique ID. Wireframe-katalog PDF 11 §11.1 dashboard-widgets (Ongoing Games, Cash Summary, Top 5 Players) |
| PDF 15: `WF_B_Spillorama Agent V1.0- 06.01.2025 (1).pdf` | 2025-01-06 | 30 sider. **Siste Agent-portal-design** — inkluderer Register More Tickets, Register Sold Tickets. Spesielt §15.1 og §15.3 gir pattern-details for start-game-flyten |

**Wireframe-katalog mangler eksplisitt "master-dashboard"-dokumentasjon.** Selv om PDF 11 + PDF 15 refereres, er innholdet i `WIREFRAME_CATALOG.md` kun aggregert abstrakt (`Dashboard Widgets: ...`). Grep etter `master / Master / ready / Ready / multi-hall` i `WIREFRAME_CATALOG.md` returnerer ingen direkte treff på master-hall-linkede flows.

**Handling:** master-hall-dashboard-spesifikasjonen er kun bevart i kode-dumpen (agentcashinoutController.js + GameProcess.js + game.js/dailySchedule.js). Wireframe-kilden antas å være én av PDF 11/15, men er ikke destillert i MD-katalog. Å gjenskape wireframe-spesifikasjon for master-hall-dashboard krever fresh PDF-gjennomgang av de to filene (ikke i denne auditen).

**Det som er tydelig dokumentert:**

- `LEGACY_1_TO_1_MAPPING §3.2 linje 146`: "Next Game-panel (Register More Tickets, Register Sold Tickets, Start Next Game, PAUSE/Resume, Info popup med Ready/Not Ready agents)"
- `LEGACY_1_TO_1_MAPPING §3.2 linje 149`: "Start Next Game (only Manual-mode; 'Agents not ready yet: Agent 1, 2, 4' popup, Jackpot-confirm, 2min-countdown)"
- `LEGACY_1_TO_1_MAPPING §3.2 linje 150`: "PAUSE Game and check for Bingo (ticket-popup med 5×5 grid, pattern-highlight, Winning Patterns-liste Status: Cashout/Rewarded, Reward All-knapp)"
- `MASTER_PLAN_SPILL1_PILOT §2.4`: "Per-agent ready-state" — P0 pilot-blokker, estimat 1-2 dager

**Wireframe-evidens vs. kode-evidens:**

For denne auditen er _kode-evidens dominerende_. Legacy-koden (GameProcess.js + agentcashinoutController.js + admnEvents.js) gir presise event-navn og datamodell; wireframene gir UX-intensjon men referansen til eksakt datafelt er indirekte.

---

## 5. Gap-liste (prioritert)

| # | Gap | Legacy-kilde | Dagens-status | Alvorlighet | Est. dager |
|---|-----|--------------|---------------|-------------|-----------|
| 1 | **Auto-pause ved LINE/phase-won** | `GameProcess.js:521-554, 3853-3944`; `gamehelper/game1-process.js:2031-2041` (`checkIfAutoPauseGame`) | `Game1DrawEngineService.drawNext` øker kun `current_phase`; ingen pause-hook | P0 | 3-4 |
| 2 | **Reset ready-state mellom faser** | `GameProcess.js:3905-3909` sets `otherData.agents.$[].isReady=false` | `Game1HallReadyService` persisterer ready gjennom hele run | P0 | 1-2 |
| 3 | **Per-agent ready-state** | `otherData.agents[]` med `{id, hallId, hallName, isReady, scannedTickets}` | `app_game1_hall_ready_status` har én bool per hall | P0 | 2-3 |
| 4 | **`NextGamePanel` for Spill 1 scheduled_games** | Legacy: samme `Start Next Game`-knapp for alle game-typer (unified Agent V1.0) | Ny stack: `NextGamePanel` er room-kode-basert (Spill 2/3); `Game1MasterConsole` er scheduled_game-basert (Spill 1). Ingen gjenbruk/sammensying | P0 | 2-3 |
| 5 | **Start-Game "agents not ready"-popup m/override** | `agentcashinoutController.js:4124-4167`; wireframe PDF 7 | `Game1MasterConsole.onStart` har ikke ready-per-agent-popup (kun excluded-halls-confirm) | P0 | 1-2 |
| 6 | **`transferHallAccess` (60s master-overføring)** | `admnEvents.js:95-121` + `AdminController.js:253-522` | Mangler helt (grep returnerer 0 treff) | P0 (ops) | 3-4 |
| 7 | **TV-rendrer ready-status per hall** | `BingoHallDisplay.cs` subscriber på `onHallReady` via socket | `TVScreenPage.ts` ignorerer `game1:ready-status-update` | P0 | 2-3 |
| 8 | **Red/Green/Yellow farge-buckets (`onHallReady`)** | `agentcashinoutController.js:5157-5223` + broadcast-struct | Kun binary badge i `Game1MasterConsole.hallStatusBadge` | P1 | 1-2 |
| 9 | **`StartGame` socket-event for master (legacy paritet)** | `game1.js:85-93` → `GameProcess.StartGame(Socket, data)` | Kun HTTP; socket-path mangler | P2 | 1 |
| 10 | **2-min countdown broadcast ved Start** | `startManualGame` + `countDownToStartTheGame`-event | `NextGamePanel.ts:130-141` lokal countdown; ingen backend-broadcast | P1 | 1-2 |
| 11 | **Jackpot-confirm-popup før Start** | Wireframe PDF 7 (Start-Game flyt) + `startManualGame` jackpot-valideringskode | Ingen pre-start jackpot-validering | P1 | 1 |
| 12 | **Hall-gruppe-rom-socket fan-out for `game1:master-action`** | `admnEvents.js:5-27` (`joinHall` + `joinRoom`) | `/admin-game1`-namespacet bruker `game1:<gameId>` room, ikke `group:<groupId>`-fan-out; `adminGame1Master.ts:125-129` broadcaster i default-ns | P1 | 1 |
| 13 | **Master → slave-hall `pageRefresh`-event** | `admnEvents.js`, `transferHallAccess` emit `pageRefresh` til begge haller | Ingen ekvivalent | P1 | 0.5 |
| 14 | **PAUSE + Check for Bingo (fysisk bong-sjekk)** | Wireframe PDF 11/15; backend: `agentBingoController` + `agentGameCheckBingo` + `adminExtraGameNoti` | Backend PT4 finnes (delvis, `PhysicalTicketPayoutService` + `app_physical_ticket_pending_payouts`), men admin-UI "Enter Ticket Number → GO → pattern-validate" mangler | P0 | 5-7 (i MASTER_PLAN K3) |
| 15 | **`isPaused`-sidestate i domain** | `status='running' + otherData.isPaused=true` | Kun `status='paused'` (master-initiert) — ingen "auto-paused-for-bingo-check"-delstate | P1 | 1-2 (kobles med gap #1) |
| 16 | **`pauseGameStats.isPausedBySystem` flag** | `GameProcess.js:3895` — tydelig `bySystem`-flagg + `isWithoutAnnouncement` | Ikke implementert | P2 | 0.5 |
| 17 | **`gameSecondaryStatus` for mini-game-fase** | `game.js` otherData.gameSecondaryStatus = 'running' under mini-game | Mini-game-orkestrering skjer fire-and-forget; ingen side-state på scheduled_game | P2 | 1 |
| 18 | **Auto-escalation hvis master ikke starter** | Ingen eksplisitt legacy-kilde; var operasjonell manuell intervensjon | `MASTER_PLAN §2.7` flagger som P0; må spec'es nytt | P0 | 1 |
| 19 | **Per-hall payout-cap / hall cash-balance-guard** | Ingen (legacy: manuell agent-kasse) | `RESEARCH_HALL_SPILL1_BINDING §7.3` — ingen cap-sjekk | P1 | 1-2 |
| 20 | **Compliance-multi-hall-ledger-bug** | `§71 pengespillforskriften` krever per-hall-attribution | `Game1TicketPurchaseService.insertPurchaseRow` logger mot master-hallens house-account uavhengig av kjøpe-hall | P0 (reg) | 2-3 |
| 21 | **`excluded_hall_ids_json` brukes ikke (dead code)** | Kolonne finnes på scheduled_games, men logikken bor i `app_game1_hall_ready_status.excluded_from_game` | Fjern kolonne eller fyll inn konsistent | P2 | 0.5 |
| 22 | **`SUPPORT`-rollens ready-bypass er udokumentert** | — | `adminGame1Ready.ts:57-84` lar SUPPORT markere ANY hall ready; uten dokumentert intensjon | P2 | 0.5 |
| 23 | **Auto-refund ved `stopGame` kollidert med mid-fase-payout** | — | `Game1MasterControlService.stopGame → refundAllForGame` kan refundere billetter som allerede har fått phase-payout | P1 | 2-3 |
| 24 | **`BingoAnnouncement`-event** | `GameProcess.js:537-554` | `game1:phase-won` finnes, men ingen dedikert lyd/utrops-trigger | P2 | 1 |
| 25 | **Dual multi-hall-schema (`app_draw_sessions` vs `app_game1_scheduled_games`)** | — | Begge aktive; BIN-515 og GAME1_SCHEDULE parallelle; `app_draw_sessions` dead code for Spill 1 | P2 | 1-2 |

**Total P0-estimat** (gap #1-7 + #14 + #18 + #20): 21-32 dev-dager
**Total P1-estimat**: 13-20 dev-dager
**Total P2-estimat**: 5-8 dev-dager
**Sum**: 39-60 dev-dager

---

## 6. Foreslått implementasjonsplan

### Bølge 1 (P0 pilot-blokkere — må være på plass før én simulert dag kan kjøres)

#### Task 1.1 — Auto-pause ved phase-won
**Formål:** Master-hall skal få kontroll mellom hver pattern-fase.
**Filer:**
- `apps/backend/src/game/Game1DrawEngineService.ts` — ny flag `pause_after_phase_won` på game_state + sjekk i `drawNext` før neste kule; hvis phaseResult.phaseWon → UPDATE `paused=true` + emit admin-event.
- `apps/backend/src/game/Game1AutoDrawTickService.ts` — query må filtrere ut `paused=true` (allerede implementert, verifiser).
- `apps/backend/src/game/Game1MasterControlService.ts` — `resumeGame` må kunne håndtere "resume-etter-auto-pause" uten å kreve `status='paused'` (må støtte "running+auto-paused").
- ny migration `20260502000000_game1_auto_pause_on_phase.sql` — legg til kolonne `paused_at_phase INT NULL` på `app_game1_game_state`.
- nye tester: `Game1DrawEngineService.phaseWonAutoPause.test.ts` verifiserer at ingen flere draws skjer etter phase-won til master har trykket resume.
**Acceptance:**
- Etter Rad 1 vunnet: `app_game1_game_state.paused=true`, ingen nye draws i `Game1AutoDrawTickService.tick()`.
- Master-UI får `game1:status-update` med `action='auto_pause'` (ny action) + `phase` i payload.
- Master kan trykke "Resume" i eksisterende UI for å fortsette.
- TV viser "Bingo! Sjekker gevinst-bong..." banner.

#### Task 1.2 — Reset ready-state mellom faser
**Formål:** Legacy-paritet: etter auto-pause må haller markere seg klare på nytt før master kan starte Rad 2.
**Filer:**
- `apps/backend/src/game/Game1HallReadyService.ts` — ny `resetAllReadyForGame(gameId)` som setter `is_ready=false, ready_at=NULL` for alle haller i spillet. Idempotent.
- `apps/backend/src/game/Game1DrawEngineService.ts` — etter auto-pause-update, kall resetAllReadyForGame.
- Oppdater `Game1MasterControlService.resumeGame` til å kreve `allParticipatingHallsReady` før resume (eller ha en override-confirm-flagg).
**Acceptance:**
- Etter Rad 1 vunnet: alle haller har `is_ready=false` og får ny "klar"-knapp i UI.
- `game1:ready-status-update` broadcastes for alle haller med `{isReady: false, allReady: false}`.

#### Task 1.3 — Per-agent ready-state
**Formål:** Legacy `otherData.agents[]` paritet. Master-UI kan vise "Agent 1 klar, Agent 2 ikke klar" per hall.
**Filer:**
- ny migration `20260503000000_game1_agent_ready_status.sql` — ny tabell `app_game1_agent_ready_status (game_id, hall_id, agent_user_id, is_ready, ready_at, ...)`.
- utvid `Game1HallReadyService` (eller ny `Game1AgentReadyService`) med `markAgentReady/unmarkAgentReady/getAgentReadyForGame`.
- `getReadyStatusForGame` berikes med per-hall agent-liste.
- `Game1MasterConsole.ts` rendrer nested agent-liste under hver hall.
- `NextGamePanel.ts:renderReadyPanel` viser kolleger og egen status.
**Acceptance:**
- Master ser liste: "Hall A (2/3 klare): Agent1✓ Agent2✗ Agent3✓".
- Start-Game-popup lister "Agents not ready yet: Agent 2 (Hall A), Agent 4 (Hall B)".

#### Task 1.4 — Foren agent-portal + master-console mot Spill 1 scheduled_games
**Formål:** Én felles "Next Game"-flyt for Spill 1. I dag bruker agent `NextGamePanel.ts` (room-kode) og master `Game1MasterConsole.ts` (scheduled_game-id).
**Filer:**
- Ny `apps/admin-web/src/pages/agent-portal/Spill1NextGamePanel.ts` som speiler `NextGamePanel`-layout, men kaller `adminGame1Master`-endepunkter + `adminGame1Ready`.
- `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` utvides med agent-portal-features (Register Tickets, Jackpot-confirm).
- `apps/backend/src/sockets/adminGame1Namespace.ts` utvides med `game1:hall-event` (pause/resume/force-end trigger fra hall).
**Acceptance:**
- Én enhetlig agent-portal-side for Spill 1 Next-Game-flyt.
- Master og AGENT/HALL_OPERATOR kan begge starte/pause/resume — med korrekt scope-sjekk.

#### Task 1.5 — Start-Game "agents not ready"-popup + override
**Formål:** Legacy-paritet — hvis master trykker Start mens haller ikke er klare, vis popup med liste og valg "Cancel / Start Anyway".
**Filer:**
- `Game1MasterConsole.ts:onStart` utvides til å hente `ready-status` før Start og vise liste over non-ready halls/agents.
- Server-side: `Game1MasterControlService.startGame` aksepterer ny `confirmUnreadyHalls: string[]`-parameter som matcher `confirmExcludedHalls`-mønsteret.
**Acceptance:**
- Master kan trykke Start selv om ikke alle er klare, men må eksplisitt bekrefte hvilke haller som ikke er klare.
- Audit logger `unreadyConfirmed: ["hallB"]` i start-entryet.

#### Task 1.6 — `transferHallAccess` master-overføring
**Formål:** Runtime flytting av master-rollen mellom haller.
**Filer:**
- ny migration `20260504000000_game1_transfer_hall.sql` — ny tabell `app_game1_master_transfer_requests (game_id, from_hall_id, to_hall_id, requested_at, valid_till, status, ...)`.
- ny `Game1TransferHallService.ts` — `requestTransfer / approveTransfer / rejectTransfer / expireOldRequests`.
- nye routes `POST /api/admin/game1/games/:gameId/transfer-master/{request,approve,reject}`.
- socket-events `game1:transfer-request / game1:transfer-response`.
- UI i Game1MasterConsole + agent-portal.
**Acceptance:**
- Master i hall A kan trykke "Transfer Master til hall B" → hall B får 60s-popup → accept eller reject.
- Ved accept: `scheduled_games.master_hall_id` oppdateres til hall B; master-scope flyttes; audit logger transfer.

#### Task 1.7 — TV rendrer ready-status + phase-won-banner
**Formål:** TV viser "Hall A ✓, Hall B ✗ (venter)", og "Bingo! Rad 1" mellom faser.
**Filer:**
- `apps/admin-web/src/pages/tv/TVScreenPage.ts` — legg til subscribe til `game1:ready-status-update` + `game1:phase-won`.
- `apps/backend/src/game/TvScreenService.ts` — utvid state med `participatingHalls[]` + per-hall `isReady`.
- `apps/backend/src/sockets/adminDisplayEvents.ts` — forward `game1:ready-status-update` til `hall:<id>:display`-rom.
**Acceptance:**
- Fysisk TV i hallen viser alle deltakende haller som ikoner: grønn=klar, rød=ikke klar, grå=ekskludert.
- Ved phase-won: "BINGO! Rad 1" banner i 3s, deretter tilbake til ball-visning.

### Bølge 2 (P1 paritet — bør være før GA)

#### Task 2.1 — Red/Green/Yellow-fargekoding (`onHallReady`-legacy-format)
**Files:** `Game1HallReadyService.ts`, `adminGame1Ready.ts`, `Game1MasterConsole.ts`
**Acceptance:** Master ser 3 buckets som legacy.

#### Task 2.2 — 2-min countdown broadcast
**Files:** `Game1MasterControlService.startGame`, `AdminGame1Broadcaster`, `TvScreenService`
**Acceptance:** TV + agent-portal + spillere viser synkronisert countdown etter Start.

#### Task 2.3 — Jackpot-confirm pre-start
**Files:** `Game1MasterConsole.ts:onStart`, backend: `Game1MasterControlService.startGame` returnerer `jackpotWarning` hvis draw-threshold er satt.
**Acceptance:** Master må eksplisitt bekrefte jackpot-threshold før Start.

#### Task 2.4 — Hall-gruppe-rom-socket (`group:<id>` fan-out)
**Files:** `adminGame1Namespace.ts`, ny `group:subscribe`-event på `/admin-game1`.
**Acceptance:** Alle haller i gruppa får `game1:master-action` uten å måtte kjenne `gameId` på forhånd.

#### Task 2.5 — `isPaused`-sidestate + `pauseGameStats`
**Files:** ny migration som legger til `pause_reason`, `paused_by_system` på `game_state`. Integreres med gap #1.

#### Task 2.6 — PAUSE + Check for Bingo-modal (fysisk bong-sjekk-UI)
**Files:** `apps/admin-web/src/pages/agent-portal/CheckForBingoModal.ts` (ny); kobler til `PhysicalTicketPayoutService`.
**Acceptance:** Agent kan i pause-tilstand sjekke fysisk bong, se 5×5 grid, og "Reward All" batch.

#### Task 2.7 — Auto-refund vs. mid-fase payout-audit
**Files:** `Game1MasterControlService.stopGame` + `refundAllForGame` — må skille mellom "refund-alt" (før første fase vunnet) og "refund-bare-unpaid" (etter første fase). Krever ekstra felt `refund_policy: 'all' | 'unpaid'`.
**Acceptance:** Hvis master stopper etter Rad 2 vunnet, refunderer vi ikke Rad 1-vinnernes billetter (som allerede har fått payout).

### Bølge 3 (P2 kvalitetsforbedring — post-pilot)

- Task 3.1 — `BingoAnnouncement`-event (gap #24)
- Task 3.2 — `gameSecondaryStatus` for mini-game (gap #17)
- Task 3.3 — `excluded_hall_ids_json` dead-code cleanup (gap #21)
- Task 3.4 — Dual multi-hall-schema pensjonering (gap #25)
- Task 3.5 — SUPPORT-rollens ready-bypass dokumenteres eller fjernes (gap #22)
- Task 3.6 — Legacy `StartGame`-socket-event for client-paritet (gap #9)

---

## 7. Åpne spørsmål til Tobias

1. **Pause-varighet: hva er ønsket oppførsel for mellom-fase-pause?** Legacy kjørte auto-pause inntil master manuelt trykker Resume (gap #1). Skal ny stack ha en timeout-override (f.eks. auto-resume etter 2 min hvis master ikke gjør noe), eller skal vi speile legacy-adferd 1:1 (uendelig pause)?

2. **Per-agent ready (gap #3): hvor mange agenter per hall forventes i pilot?** MASTER_PLAN §2.4 estimerte 1-2 dager — men datamodell-utvidelsen er mer omfattende (ny tabell, ny service, UI-rendering). Hvis pilot er "én agent per hall" som NextGamePanel.ts:66 antyder, kan vi utsette per-agent til post-pilot?

3. **`transferHallAccess` (gap #6): ønsker vi legacy-semantikk (agent-initiert, admin-godkjent, 60s TTL), eller en enklere variant (master-initiert direkte-overføring uten admin-godkjenning)?** RESEARCH_HALL_SPILL1_BINDING §1.3 peker på risiko ved direkte-overføring (ingen bekreftelse at target-hallen er bemannet).

4. **Wireframe PDF 11 + PDF 15: ble det produsert bilde-rendering av "Next Game / Start Game"-popup-varianten?** WIREFRAME_CATALOG.md har ikke destillert detaljer. Hvis PDF-ene fremdeles er tilgjengelige, bør de gjennomleses for å bekrefte UX-detaljer for Bølge 1 Task 1.4 + 1.5.

5. **Red/Green/Yellow-buckets (gap #8): var det 3 eller 4 statuser?** Legacy-koden har `redHalls/greenHalls/yellowHalls`. Men wireframes kan ha hatt en fjerde (f.eks. "grå = ekskludert"). Vil Tobias bekrefte før vi dupliserer 3-bucket-semantikken?

6. **Auto-refund vs. mid-fase payout (gap #23): ønsker vi å tillate "stop etter Rad 2, behold Rad 1 payouts", eller er "stop = full-refund alt" OK for pilot?** Den "myke" varianten er komplisert; den "harde" varianten kan frustrere bingoverter hvis de må stoppe pga. strøm/nett i hall B men hall A allerede har mottatt payout.

7. **Legacy socket-events (gap #9, #14): skal vi porte `StartGame`-socket-eventet for Unity-klient-paritet?** PM_HANDOFF antyder at Unity er avkoblet — men TV-display + agent-terminal kan fortsatt bruke socket-events via web-shell. Hvor mye legacy-socket-paritet må vi holde?

8. **`isPaused`-sidestate (gap #15, Task 2.5): OK å kollapse til én `status='paused'`, eller ønsker vi legacy-paritet med `status='running' + isPaused=true`?** Sistnevnte er mer nøyaktig mot legacy men bryter den nye state-machine-modellen.

9. **Jackpot daglig akkumulering (+4000/dag, max 30k) — MASTER_PLAN §2.3:** er denne realiteten implementert via admin-manuell oppdatering i legacy, eller er det kodet cron-jobb? Relevant for gap #11 (jackpot-confirm pre-start) — vi må vite hva som vises i popupen.

10. **`transferHallAccess` TTL: 60s er legacy-default — skal vi beholde dette eller kanskje redusere til 30s siden moderne nett er raskere?** Kosmetisk, men relevant for UX.

---

## 8. Konklusjon

Av de ~25 identifiserte gapene er **10 P0** (blokkerer simulert dag), **9 P1** (bør være før GA), og **6 P2** (post-pilot). De mest kritiske gapene clusterer seg rundt én underliggende design-forskjell:

> **Legacy = synkron, master-drevet fase-for-fase-kontroll.**
> **Ny stack = autonom draw-engine med master-override-hooks.**

For Spill 1 pilot med 4 haller er legacy-paritet på disse punktene ikke forhandlbar, fordi:

1. Bingovert må ha tid til å sjekke fysiske bonger mellom pattern-faser (gap #1).
2. Halls må re-markere ready for å bekrefte at agent fortsatt er ved pulten (gap #2).
3. Master-hall må kunne overtas runtime hvis en hall mister strøm (gap #6).

Gap #1-3 (auto-pause + ready-reset + per-agent ready) bør prioriteres som én sammenkoblet implementasjonsbølge — de deler samme kode-hotspot (`Game1DrawEngineService.drawNext` + `Game1HallReadyService`) og teste-scenario (multi-fase multi-hall simulert runde).

**Anbefalt første PR etter audit:** Task 1.1 (auto-pause) alene, som standalone PR med utvidede tester. Dette etablerer fundamentet før per-agent-delene (#3) og transfer-hall-delene (#6) bygges på toppen.

---

## Appendix A — Nøkkel-kildehenvisninger

### Legacy (commit `5fda0f78`)

**Controllers / Services:**
- `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` (6261 linjer) — StartGame, checkForWinners, stopGame, resumeGame, gameFinished, minigame-orkestrering
- `legacy/unity-backend/Game/Game1/Controllers/GameController.js` (4056 linjer) — Game1Room, subscribeRoom, purchaseTickets, startBroadcast, leftRoom, adminHallDisplayLogin, master-agent-IP-verifisering
- `legacy/unity-backend/Game/Game1/Sockets/game1.js` (257 linjer) — alle 25 socket-events
- `legacy/unity-backend/Game/AdminEvents/AdminController/AdminController.js` (578 linjer) — getNextGame, getOnGoingGame, getHallBalance, getHallStatus, transferHallAccess, approveTransferHallAccess
- `legacy/unity-backend/Game/AdminEvents/Sockets/admnEvents.js` (126 linjer) — joinHall, joinRoom, getNextGame, getOngoingGame, onHallReady, transferHallAccess
- `legacy/unity-backend/App/Controllers/agentcashinoutController.js` (5300+ linjer) — updateGameHallStatus, setHallStausWithColorCode, hallsStatusForGame, startGame, startManualGame
- `legacy/unity-backend/gamehelper/game1-process.js` (3328 linjer) — checkIfAutoPauseGame, getWinnersOnWithdrawBall, settlePendingWinners, refreshGameOnFinish

**Models:**
- `legacy/unity-backend/App/Models/game.js` (417 linjer) — GameSchema med halls, allHallsId, masterHall, groupHalls, otherData
- `legacy/unity-backend/App/Models/dailySchedule.js` (59 linjer) — masterHall, halls, allHallsId, groupHalls, otherData (inneholder transferHall)
- `legacy/unity-backend/App/Models/hall.js` (63 linjer) — HallSchema med ip, activeAgents, hallCashBalance
- `legacy/unity-backend/App/Models/groupHall.js` (31 linjer) — GroupHallSchema

### Ny stack

**Services:**
- `apps/backend/src/game/Game1MasterControlService.ts` (1083 linjer) — master start/pause/resume/stop/exclude/include
- `apps/backend/src/game/Game1HallReadyService.ts` (400 linjer) — per-hall ready-signalering
- `apps/backend/src/game/Game1DrawEngineService.ts` (2571 linjer) — draw-engine, phase-evaluering, payout-delegation
- `apps/backend/src/game/Game1AutoDrawTickService.ts` (254 linjer) — JobScheduler-drevet auto-draw
- `apps/backend/src/game/Game1ScheduleTickService.ts` (930+) — state-maskin-transisjoner
- `apps/backend/src/game/TvScreenService.ts` (542 linjer) — public TV-state
- `apps/backend/src/admin/HallGroupService.ts` — hall-grupper CRUD

**Routes:**
- `apps/backend/src/routes/adminGame1Master.ts` (463 linjer) — master HTTP-endepunkter
- `apps/backend/src/routes/adminGame1Ready.ts` (354 linjer) — ready HTTP-endepunkter
- `apps/backend/src/routes/adminRooms.ts` (323 linjer) — room-kode-basert flyt (Spill 2/3)

**Sockets:**
- `apps/backend/src/sockets/adminGame1Namespace.ts` (255 linjer) — `/admin-game1`-namespace for master-konsoll
- `apps/backend/src/sockets/adminHallEvents.ts` (391 linjer) — `admin:hall-event` fan-out (BIN-515)
- `apps/backend/src/sockets/adminDisplayEvents.ts` — TV-display socket-flyt

**Admin-web:**
- `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` (615 linjer) — master-konsoll for Spill 1
- `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` (615+ linjer) — room-kode-basert agent-portal (Spill 2/3)
- `apps/admin-web/src/pages/tv/TVScreenPage.ts` (358 linjer) — TV-kiosk-side
- `apps/admin-web/src/pages/games/master/adminGame1Socket.ts` — `/admin-game1`-socket-klient

### Migrations

- `apps/backend/migrations/20260428000000_game1_scheduled_games.sql` — master_hall_id, group_hall_id, participating_halls_json, excluded_hall_ids_json, status
- `apps/backend/migrations/20260428000100_game1_hall_ready_status.sql` — is_ready, ready_at, digital_tickets_sold, physical_tickets_sold, excluded_from_game
- `apps/backend/migrations/20260428000200_game1_master_audit.sql` — audit-logger for master-actions
- `apps/backend/migrations/20260424000000_hall_groups.sql` — hall-grupper (BIN-665)
- `apps/backend/migrations/20260416000001_multi_hall_linked_draws.sql` — parallell draw-sessions-schema (BIN-515)

### Dokumentasjon

- `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`
- `docs/architecture/RESEARCH_HALL_SPILL1_BINDING_2026-04-24.md`
- `docs/architecture/RESEARCH_SPILL1_BACKEND_PARITY_2026-04-24.md`
- `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`
- `docs/architecture/LEGACY_TV_DESIGN_SPEC_2026-04-24.md`
- `docs/architecture/WIREFRAME_CATALOG.md`
- `docs/architecture/SPILLKATALOG.md`

---

## Appendix B — PM-låste svar på de 10 åpne spørsmålene (2026-04-24)

Tobias (PM) har gjennomgått §7 og låst produktvalgene nedenfor. Disse
svarene er kanoniske — implementasjons-PR-er skal referere til dette
appendikset, ikke §7.

### B.1 Pause-varighet (§7.1)

**LÅST: uendelig pause.** Bingovert må fysisk trykke Resume for å
fortsette. Ingen timeout-basert auto-resume. Konsistent med legacy
`stopGame`-semantikk.

### B.2 Per-agent ready (§7.2)

**LÅST: kun ved INITIAL start-of-round, ikke mellom faser.**

- **Start-of-round** (før Rad 1): wireframe krever
  _"Agents not ready yet: Agent 1, 2, 4"_-popup
  (kilde: `LEGACY_1_TO_1_MAPPING:149`). Per-hall 🔴/🟠/🟢-status må
  være grønn/rød før Start-knappen aktiveres. Pilot-krav.
- **Mellom faser** (post-LINE, pre-BINGO): **master alene avgjør.**
  Ingen re-bekreftelse fra andre haller. Master trykker Resume
  ubetinget — spillet fortsetter umiddelbart. Se B.8.

Konsekvens: Task 1.2 ("reset ready mellom faser") er **annullert**
2026-04-24 etter presisering fra Tobias. Gap #2 i §5 nedgraderes til
"POLICY: reset ikke nødvendig — master er autoritativ mellom faser".

### B.3 `transferHallAccess`-semantikk (§7.3)

**LÅST: legacy 1:1 (agent-initiert, 60s TTL).** Ingen admin-godkjenning-
mellomtrinn. Master i hall A sender tilbud → target-hall B aksepterer
direkte. Kilde: `RESEARCH_HALL_SPILL1_BINDING:74-76`.

### B.4 Wireframe PDF 11 + 15 (§7.4)

**LÅST: ikke relevant — allerede destillert.** `WIREFRAME_CATALOG.md`
dekker PDF 11 (Agent V2.0) og PDF 15 (Agent V1.0 Latest). Ingen ekstra
PDF-gjennomgang nødvendig.

### B.5 Hall-status farge-kode (§7.5)

**LÅST: 3 farger med presis semantikk.**

| Farge | Tilstand | Effekt |
|-------|----------|--------|
| 🔴 Rød | `playerCount == 0` | Ekskludert automatisk fra neste trekning |
| 🟠 Oransje | Spillere finnes, men `finalScanDone=false` ELLER `readyConfirmed=false` | Blokkerer Start-knapp |
| 🟢 Grønn | Alle spillere telt, final-scan gjort, agent har trykket Klar | Klar for start |

**Start-regel:** master kan bare starte når alle haller er enten 🔴
eller 🟢. Oransje blokkerer. Røde haller kan eksplisitt ekskluderes via
`confirmExcludeRedHalls`-parameter i `startGame`.

### B.6 Refund-policy ved `stopGame` (§7.6)

**LÅST: `"No refunds after game starts"` — hard policy.** Kilde:
`WIREFRAME_CATALOG:378`. Gap #23 i §5 er over-spec — ingen mid-fase
refund skal implementeres. `stopGame` avbryter runden uten å refundere
betalte payouts. Tidligere-fase-vinnere beholder sine gevinster.

### B.7 Legacy `StartGame`-socket-event (§7.7)

**LÅST: ingen Unity-paritet.** Unity-klienten er pensjonert.
Web-shell + TS-backend er kanonisk. Gap #9 + #14 nedprioriteres til
post-pilot documentation only.

### B.8 `isPaused` sidestate (§7.8)

**LÅST: teknisk beslutning delegert til implementerende agent.**
Product-kravet er:

- Agent/master må kunne manuelt stoppe + starte spillet.
- Auto-stop ved LINE-vinn (og hver påfølgende phase-vinn).
- Master trykker Resume → spillet fortsetter **ubetinget** (ingen
  re-ready-sjekk fra andre haller mellom faser — se B.2).

Om det løses med `status='paused'` eller `status='running' +
isPaused=true` er intern.

**Ingen ekstra autoriserings-sjekk mellom faser.** Resume-endepunkter
skal IKKE kreve `HALLS_NOT_READY`-guard; bare status-flip +
broadcast.

### B.9 Jackpot daglig akkumulering (§7.9)

**LÅST: legacy 1:1.** Starter 2000 kr, +4000/dag, max 30.000. Draw-
thresholds 50→55→56→57. Implementeres via cron (daglig akkumulerings-
tick). Kilde: `SPILL1_FULL_VARIANT_CATALOG:70`.

### B.10 `transferHallAccess` TTL (§7.10)

**LÅST: 60s.** Legacy-default beholdes.

---

## Appendix C — Hall-ready scan-flyt (presisert av Tobias 2026-04-24)

Etter B.5 er farge-logikken avhengig av eksakt bong-registrering, ikke
estimat. Flyten er:

1. **Start-scan** (før salg): agent skanner første bong øverst i
   bunken. Systemet lagrer `start_ticket_id`.
2. **Agent selger bonger** (runden pågår).
3. **Slutt-scan** (etter salg): agent skanner den nye øverste bongen.
   Systemet lagrer `final_scan_ticket_id` og regner
   `sold_range = [start_ticket_id, final_scan_ticket_id - 1]`.
4. **Klar-bekreftelse**: agent trykker "Klar" → `readyConfirmed=true`.
5. Hall går 🟠 → 🟢.

**Viktige implikasjoner:**

- Ingen manuell override nødvendig — alt er faktisk regnskap.
- Digital-only haller (ingen fysiske bonger) får `finalScanDone=true`
  automatisk og kan gå grønn på `readyConfirmed` alene.
- **Mellom faser (B.8 auto-pause): ingenting nullstilles.** Scan-data
  beholdes, `readyConfirmed` beholdes. Det skal aldri selges bonger
  under trekning, så re-scan er aldri nødvendig. Master trykker Resume
  ubetinget (se B.2).

Implementert i `feat/game1-hall-status-color-scan-flow` (Task HS).

---

## Appendix D — Implementasjons-status (kontinuerlig)

Oppdateres av PM når hver Bølge 1-task åpnes som PR.

| Task | Branch / PR | Status |
|------|-------------|--------|
| 1.1 Auto-pause ved phase-won | `feat/game1-auto-pause-phase-won` | 🟡 Agent jobber |
| 1.2 Reset ready mellom faser | — | ❌ **Annullert 2026-04-24** (B.2/B.8 — master alene) |
| HS Hall-status farge + scan-flyt | `feat/game1-hall-status-color-scan-flow` | 🟡 Agent jobber |
| 1.4 Foren agent-portal + master-konsoll | — | ⏳ Ikke startet |
| 1.5 "Agents not ready"-popup + override (kun start-of-round) | — | ⏳ Ikke startet |
| 1.6 `transferHallAccess` master-overføring | — | ⏳ Ikke startet |
| 1.7 TV ready-status + phase-won-banner | — | ⏳ Ikke startet |
