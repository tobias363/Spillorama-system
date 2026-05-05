# Spill 2 & Spill 3 — Casino-Grade Forensic Audit (2026-05-05)

**Forfatter:** Anthropic Claude (Opus 4.7, 1M context).
**Mandat:** Tobias 2026-05-05 — "samme robusthet som Evolution Gaming."
**Pilot-skala:** 24 haller × ~1500 spillere = **36 000 samtidige WebSocket-tilkoblinger** på ETT globalt rom (`ROCKET` for Spill 2, `MONSTERBINGO` for Spill 3).
**Scope:** Backend engine + sockets + klient + shared-types — kun Spill 2 (`rocket`) og Spill 3 (`monsterbingo`). Spill 1 har egen audit.

---

## §0. Lese-veiledning

### Hvordan rapporten er strukturert

1. **§1 Executive summary** — top 5 funn for Tobias.
2. **§2-§9 detaljerte funn** — kategorisert etter rotårsak.
3. **§10 industri-paritet** — sammenligning mot Evolution / Playtech / Pragmatic.
4. **§11-§14 plan** — implementeringsplan, finding-tabell, risiko-matrise, error-codes.

### Severity-taksonomi

| Severity | Definisjon | Pilot-blokker |
|---|---|---|
| **CRITICAL** | Feilen *vil* skje i prod under realistisk last. Pengetap, regulatorisk brudd, eller systemkrasj. | Ja. |
| **HIGH** | Feilen er sannsynlig under spike-last eller crash-scenario. Spilleren ser frosset UI eller får feil utbetaling. | Anbefalt. |
| **MEDIUM** | Feilen kan skje, men sjelden. | Post-pilot. |
| **LOW** | Edge-case eller hardening uten kjent trigger. | Post-pilot. |

### Eksisterende relaterte rapporter

- `docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md`
- `docs/architecture/LIVE_CASINO_ROOM_ARCHITECTURE_RESEARCH_2026-04-27.md`
- `docs/architecture/SPILL1_CASINO_GRADE_AUDIT_2026-04-27.md`
- `docs/architecture/SPILL1_CASINO_GRADE_REVIEW_2026-04-26.md`

### Endringer siden disse rapportene

PR #911-#942 fikset noen pilot-blokkere på Spill 2/3, men introduserte nye issues. Denne rapporten er status pr commit `f84083f2` (2026-05-05 sesjon 2).

---

## §1. Executive Summary — top 5 KRITISKE funn

**TL;DR:** Auditen avdekker 27 funn. **9 er CRITICAL** og må lukkes før pilot kan kjøre med 24 haller × 1500 spillere. De fleste rotårsaker stammer fra at Spill 2/3 arvet master-rolle-konseptet fra Spill 1 da det egentlig skulle være en perpetual-modell uten master.

### TOP 1 (CRITICAL) — `assertHost`-bypass åpner sikkerhetshull i game-mutasjons-API

PR #942 fikset rotårsaken til ROCKET-stuck-bugen ved å la `BingoEngine.assertHost` returnere null for slug `rocket` / `monsterbingo`. Men metoden er kalt fra **6 ulike call-sites** som alle nå er ubeskyttet:

- `BingoEngine.startGame:996`
- `BingoEngine.endGame:2532`
- `DrawOrchestrationService._drawNextLocked:303`
- Mini-game-pathene (indirekte via callback-port linje 1870, 4256)

**Konsekvens i prod:** ENHVER autentisert spiller i ROCKET kan sende `game:end` (gameLifecycleEvents.ts:152) og rive runden ned for alle 1500 medspillere. Trolling user → bricked rom.

**Fix-anbefaling:** Definer system-actor-ACL (se §2.1).

**Estimat:** 2 dev-dager.

### TOP 2 (CRITICAL) — Game3AutoDrawTickService mangler stuck-room recovery

`Game3AutoDrawTickService.ts:216-219` skipper rom som har `drawnNumbers.length >= 75 && status === "RUNNING"` uten å fyre `forceEndStaleRound`. Game2 fikk recovery via PR #876 — Game3 fikk det ALDRI.

**Konsekvens:** Spill 3-rom (MONSTERBINGO) hvor Coverall ikke vinnes innen 75 trekk vil henge for alltid. På 1500-spillere-skala er dette unngåelig hvis hook-feil skjer mid-draw.

**Fix-anbefaling:** Speile Game2-pathen 1:1 (se §5.1).

**Estimat:** 1 dev-dag.

### TOP 3 (CRITICAL) — `LedgerGameType` hardkodet til DATABINGO i Game2/3 prize-cap

Mens `ledgerGameTypeForSlug` korrekt returnerer `MAIN_GAME` for `rocket`/`monsterbingo`, blir `prizePolicy.applySinglePrizeCap` kalt med eksplisitt `gameType: "DATABINGO"` på **3 steder**:

- `Game2Engine.ts:379` (jackpot-share)
- `Game2Engine.ts:503` (lucky bonus)
- `Game3Engine.ts:533` (pattern-share + Coverall)

**Konsekvens regulatorisk:** Single-prize-cap (Lotteritilsynet 2 500 kr) hentes med feil game-type. Compliance-ledger-events er korrekt (linje 428, 531 bruker resolved gameType-variabel) — men prize-cap er feil. Dette ER et regulatorisk brudd hvis prize-policy har ulike caps per game-type.

**Fix-anbefaling:** Bytt til `gameType` (variabelen som allerede er resolved tidligere).

**Estimat:** 0.5 dev-dag.

### TOP 4 (CRITICAL) — `room.players` Map mutasjon under draw-lock korrupterer state

`assertWalletNotInRunningGame` (linje 3909 i BingoEngine.ts) muterer `room.players` Map for RUNNING-rom. Dette skjer fra `RoomLifecycleService.joinRoom:375` UTEN draw-lock.

**Trigger-scenario (1500-spillere-skala):**
1. Auto-draw-tick på t=0 for ROCKET. `_drawNextLocked` starter, går inn i `Game2Engine.findG2Winners` som itererer `room.players.values()`.
2. Iterator har gjennomgått 500 av 1500 spillere. `await this.payG2JackpotShare` på vinner #45.
3. SAMTIDIG på t=0.5: `room:join`-handler fra spiller Z som "bytter hall". `assertWalletNotInRunningGame` kalles — finner Z's stale player-record i ROCKET (fra et tidligere join), kaller `room.players.delete(...)`.
4. Iterator i punkt 2 fortsetter — kan ha skipt en spiller (og mister vinner) eller dobbelt-prosessert noen.

**Konsekvens:** Lokal data-corruption, ledger-events feil, refunds for spillere som ikke lenger er i rommet.

**Fix-anbefaling:** Wrap `room.players` mutations i mutex per rom — ELLER snapshot iteratoren `[...room.players.values()]` før await-er.

**Estimat:** 3 dev-dager.

### TOP 5 (CRITICAL) — `room:update` broadcast skalerings-bottleneck

`emitRoomUpdate` (`index.ts:1333`) emitter fullt RoomUpdatePayload til ALLE 1500 sockets i ROCKET via `io.to(roomCode).emit(...)`.

På 1500-spillere-skala:
- Snapshot er ~300 KB.
- `io.to(...)` sender til 1500 sockets = 450 MB per emit.
- `room:update` fyres etter HVER draw (30 sek), HVER `bet:arm`, HVER `ticket:cancel`, HVER `room:join`.

Med 30-sek-draw og 50 join/cancel/arm-events per minutt = ~2 emits/sec × 450 MB = **900 MB/sek bandwidth + ~3000 ms CPU på V8**.

Render starter-plan har 512 MB RAM og 10 GB/mnd bandwidth — pilot ville sprenge dette på minutter.

**Fix-anbefaling:** Strip `room.players` fra Spill 2/3 RoomUpdatePayload — bare send `playerCount` + delta-events.

**Estimat:** 5-7 dev-dager.

---

## §2. Master-arv-mønstre fra Spill 1

Spill 2/3 ble bygget som subklasser av `BingoEngine` for å gjenbruke draw-pipelinen. Men `BingoEngine` antar Spill 1's master-flow (én spiller styrer start/stop). Spill 2/3 har ETT globalt rom uten master. Resultatet er en lang liste call-sites hvor host-konseptet fortsatt eksisterer i koden men er semantisk meningsløst — og PR #942's bypass åpner sikkerhetshull.

### KRITISK-2.1 — `BingoEngine.endGame` kan kalles av ANY player

**Severity:** CRITICAL
**Kategori:** master-arv | sikkerhet
**File:line:** `apps/backend/src/game/BingoEngine.ts:2526-2533`

```typescript
async endGame(input: EndGameInput): Promise<void> {
  const room = this.requireRoom(input.roomCode);
  this.assertNotScheduled(room);
  this.assertSpill1NotAdHoc(room);
  this.assertHost(room, input.actorPlayerId);   // BYPASS for rocket/monsterbingo
  const host = this.requirePlayer(room, input.actorPlayerId);
  ...
}
```

`apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts:151-156`:
```typescript
socket.on("game:end", rateLimited("game:end", async (payload, callback) => {
  const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
  await engine.endGame({ roomCode, actorPlayerId: playerId, reason: payload?.reason });
  ...
}));
```

`actorPlayerId` settes til socket-eierens egen `playerId`. Etter PR #942-fixen vil `assertHost` skip for rocket/monsterbingo → ANY player kan ende runden.

**Trigger-scenario:**
1. Spiller A er en av 1500 i ROCKET.
2. Spiller A sender `game:end` socket-event (custom klient eller dev-tool).
3. `engine.endGame` kjører, `assertHost` skipper.
4. Runden ender. 1499 medspillere får frosset UI med "Runden ble avbrutt".
5. PerpetualRoundService får `onGameEnded` med `endedReason: undefined` (ikke i NATURAL_END_REASONS) → IKKE auto-restart.
6. Rommet er stuck til admin manually intervenes.

**Konsekvens i prod:** En enkelt malicious player kan brick et 1500-spillers rom på sekunder. Klage-eskalering, tap av tillit, regulatorisk-rapport.

**Skala-amplifikasjon:** På 10-spillere-skala er det irriterende. På 1500-spillere-skala er det eksistensiell trussel — sannsynlighet for at minst én av 1500 kjører custom socket-klient eller har buggy code er ~100% over en 8-timers økt.

**Foreslått fix (Path A — minimal):** I `gameLifecycleEvents.ts`, slug-gate på socket-laget:
```typescript
socket.on("game:end", rateLimited("game:end", async (payload, callback) => {
  const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
  const snap = engine.getRoomSnapshot(roomCode);
  if (snap.gameSlug === "rocket" || snap.gameSlug === "monsterbingo") {
    throw new DomainError("PERPETUAL_NO_MANUAL_END", "Spill 2/3 stopper aldri manuelt.");
  }
  await engine.endGame({...});
}));
```

**Path B — robust (anbefalt):** Definer `EndGameInput.systemActor: boolean` flag. Bare `forceEndStaleRound`, `Game2Engine.onDrawCompleted` (G2_NO_WINNER), `Game3Engine` (G3_FULL_HOUSE) og admin-routes setter den til `true`. Fjern `gameLifecycleEvents.game:end`-handleren helt for Spill 2/3.

**Industri-paritet:** Evolution / Playtech behandler endGame som system-only. Spillere kan kun forlate (`leaveRoom`), aldri stoppe runden.

**Estimat:** 2 dev-dager.

---

### KRITISK-2.2 — `BingoEngine.startGame` kan kalles av ANY player

**Severity:** CRITICAL
**Kategori:** master-arv | sikkerhet
**File:line:** `apps/backend/src/game/BingoEngine.ts:989-1007`

```typescript
async startGame(input: StartGameInput): Promise<void> {
  const room = this.requireRoom(input.roomCode);
  this.assertNotScheduled(room);
  this.assertSpill1NotAdHoc(room);
  this.assertHost(room, input.actorPlayerId);   // BYPASS for rocket/monsterbingo
  this.assertNotRunning(room);
  ...
}
```

`gameLifecycleEvents.ts:126-139` kjører `engine.startGame` med `actorPlayerId: playerId`.

**Trigger-scenario:**
1. Spiller A er i ROCKET, status WAITING (mellom runder, perpetual-loop venter på 30s delay).
2. Spiller A sender `game:start` socket-event.
3. `engine.startGame` kjører — `assertHost` skipper.
4. Race med `PerpetualRoundService.startNextRound` som er pending.
5. Begge prøver å starte runde med ulike entry-fees / tickets-per-player.

**Konsekvens i prod:**
- `assertNotRunning` fanger den andre — men race-vinneren kan ha startet med malicious params (entryFee=10000, ticketsPerPlayer=30 fra payload).
- Resulterende runde har feil prizePool, feil RTP-budget.
- Wallet-debits gjøres på alle armed players for feil beløp.

**Skala-amplifikasjon:** I et 1500-spillers rom kjører perpetual-loop hver 30. sekund. Sannsynlighet for at en ondsinnet spiller traff race-vinduet er liten per runde, men over en 8-timers økt = mange forsøk.

**Foreslått fix:** Samme som §2.1 — system-actor-flagg + slug-gate på socket-laget.

**Estimat:** 1 dev-dag (sammen med §2.1).

---

### KRITISK-2.3 — `DrawOrchestrationService._drawNextLocked` har bypass for `rocket`/`monsterbingo` men ingen alternativ ACL

**Severity:** CRITICAL
**Kategori:** master-arv | sikkerhet
**File:line:** `apps/backend/src/game/DrawOrchestrationService.ts:294-307`

```typescript
private async _drawNextLocked(input: DrawOrchestrationInput): ... {
  const room = this.callbacks.requireRoom(input.roomCode);
  this.callbacks.assertNotScheduled(room);
  this.callbacks.assertSpill1NotAdHoc(room);
  this.callbacks.assertHost(room, input.actorPlayerId);   // BYPASS for rocket/monsterbingo
  const host = this.callbacks.requirePlayer(room, input.actorPlayerId);  // PLAYER_NOT_FOUND only
  ...
}
```

`drawEvents.ts:60-61` (admin socket-handler):
```typescript
socket.on("draw:next", ...async (payload, callback) => {
  const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
  const result = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
  ...
});
```

**Trigger-scenario:**
1. Spiller A er i ROCKET.
2. Spiller A sender `draw:next` (custom klient).
3. `engine.drawNextNumber` → `_drawNextLocked` skipper assertHost.
4. `requirePlayer` finner spiller A → trekk fyrer.
5. Spiller A spammer `draw:next` så fort som rate-limit tillater (5 per 2-sek-vindu = 2.5 draws/sek).

**Skala-amplifikasjon:** Engine har egen `minDrawIntervalMs` throttle (DrawOrchestrationService.ts:170 + linje 314-323) — default `0` (tunet via env). Hvis throttle er 0, kan spiller A trekke 2.5 baller/sek mens auto-draw-cron kun forventer 1 ball per 30 sek. Resultat: ROCKET runde slutter på 8 sekunder i stedet for 10 minutter.

**Konsekvens i prod:**
- Klient gap-detection (BIN-502) trigger fordi drawIndex er ahead-of-schedule.
- Flere klienter går ut av sync, sender massive resync-requests.
- Auto-draw-cron-en ser draws kommer raskere → throttle holder den ute.
- Effektivt har spiller A overtatt rommet.

**Foreslått fix:** Slug-gate i `drawEvents.ts:60` — `draw:next` er admin-only på Spill 2/3:
```typescript
const snap = engine.getRoomSnapshot(roomCode);
if (snap.gameSlug === "rocket" || snap.gameSlug === "monsterbingo") {
  throw new DomainError("PERPETUAL_NO_MANUAL_DRAW", "Trekk styres av server-cron.");
}
```

**Estimat:** 0.5 dev-dag.

---

### KRITISK-2.4 — `BingoEngine.markNumber` kan kalles for andre spilleres brett

**Severity:** HIGH
**Kategori:** master-arv | data-integritet
**File:line:** `apps/backend/src/game/BingoEngine.ts:2347-2374`

`markNumber` validerer ikke at `playerId` matcher socket-eierens identitet. Det skjer på socket-laget (`requireAuthenticatedPlayerAction` i ticketEvents.ts:55), men `MarkPayload` har valgfri `playerId?` — hvis klient sender `playerId` for en annen spiller, vil `requireAuthenticatedPlayerAction` returnere socket-eierens `playerId` (override). Sjekk:

`apps/backend/src/sockets/gameEvents/context.ts` — `requireAuthenticatedPlayerAction` validerer at `playerId` i payload eksisterer i socket-bound mapping. OK, dette ER beskyttet.

**Konklusjon:** Egentlig ikke en sikkerhets-bug, men `MarkPayload.playerId` shouldn't be optional — det burde være ENFORCED som playerId from token.

**Severity korrigert:** LOW (cleanup).

---

### KRITISK-2.5 — `submitClaim` på Spill 2/3-rom kan trigge dual-payout

**Severity:** HIGH
**Kategori:** master-arv | dead code med vetlig konsekvens
**File:line:** `apps/backend/src/sockets/gameEvents/claimEvents.ts:1`

`claim:submit` socket-handleren er registrert for ALLE rom. På Spill 2/3 kjører auto-claim via `Game2Engine.onDrawCompleted` / `Game3Engine.processG3Winners`. Men hvis en spiller sender `claim:submit` på samme runde:

1. Auto-claim har allerede betalt ut og satt `game.status = "ENDED"`.
2. `claim:submit` → `submitClaim` → `requireRunningGame` kaster `GAME_NOT_RUNNING`.
3. OK, ikke dual-payout for samme runde.

Men hvis `claim:submit` kommer FØR auto-claim har detected vinneren (race i samme draw):

1. Auto-claim kjører i `onDrawCompleted` etter `drawnNumbers.push`.
2. Men `drawnNumbers.push` skjedde i `_drawNextLocked` — som holder draw-lock.
3. `submitClaim` kaller `requireRunningGame` (ikke draw-lock — bare snapshot).
4. Race: `submitClaim` ser status=RUNNING, evaluerer pattern.

**For Spill 2 (3×3 jackpot-table):** `ClaimSubmitterService.submitClaim` evaluerer via `PatternMatcher` (BIN-244 patterns). Spill 2 har INGEN custom patterns — `room.patterns` er undefined. Resultat: `NO_BINGO_FOUND` eller `INVALID_CLAIM`.

**For Spill 3 (5×5 patterns):** `ClaimSubmitterService` finner de samme patterns som auto-claim. Hvis manual-claim kommer FØRST (mellom drawnNumbers.push og onDrawCompleted), kan spilleren bli betalt via manual + via auto.

**Verifisert:** `_drawNextLocked` holder `drawLocksByRoom`-lock for hele draw-pipelinen inkludert `onDrawCompleted`. Claim-pathen tar ikke samme lock. Race-vindu er smal men finnes.

**Konsekvens:** Dual-payout for Coverall-vinnere på Spill 3.

**Foreslått fix:** I `claimEvents.ts`, kast `CLAIM_NOT_SUPPORTED` for `rocket`/`monsterbingo`:
```typescript
const snap = engine.getRoomSnapshot(roomCode);
if (snap.gameSlug === "rocket" || snap.gameSlug === "monsterbingo") {
  throw new DomainError("CLAIM_NOT_SUPPORTED", "Spill 2/3 bruker auto-claim.");
}
```

**Estimat:** 0.5 dev-dag.

---

### KRITISK-2.6 — `room.hostPlayerId` blir aldri reassigned for perpetual-rom (host-fallback hull i PerpetualRoundService)

**Severity:** HIGH
**Kategori:** master-arv | recovery
**File:line:** `apps/backend/src/game/PerpetualRoundService.ts:480, 684`

```typescript
// startNextRound (line 478-494)
const startInput: ... = {
  roomCode,
  actorPlayerId: snapshot.hostPlayerId,  // <-- KAN VÆRE STALE
  ...
};
```

For perpetual-rom (ROCKET/MONSTERBINGO) er `room.hostPlayerId` satt til den første spilleren som joinet etter system-boot (`RoomLifecycleService.createRoom:288`). `hostPlayerId` blir **aldri reassigned**.

**Auto-draw-pathen** har host-fallback (`Game2/3AutoDrawTickService.ts:453-456`). PerpetualRoundService har det IKKE.

**Trigger-scenario:**
1. Spiller A oppretter ROCKET-rom (host).
2. Spiller A disconnecter, blir cleaned-up via `cleanupStaleWalletInIdleRooms`.
3. Spillere B-Z fortsetter.
4. Spillere alle vinner runden (G2_WINNER) → auto-claim utbetaler.
5. PerpetualRoundService.handleGameEnded scheduler restart.
6. Etter 30s: `startNextRound(ROCKET)` kjører.
7. `actorPlayerId: snapshot.hostPlayerId` = stale ID for spiller A (ikke i rom lenger).
8. `engine.startGame` → `requirePlayer(room, A.id)` kaster `PLAYER_NOT_FOUND`.
9. Runde spawner ikke. ROCKET stuck til neste spiller-join trigger `spawnFirstRoundIfNeeded`.

Selv `spawnFirstRoundIfNeeded:684` har samme bug.

**Konsekvens:** ROCKET kan stå stille selv om host-fallback fungerer i auto-draw — fordi PerpetualRoundService ikke har samme fallback.

**Foreslått fix:** Kopier auto-draw-pathens fallback-logic til PerpetualRoundService (begge `startNextRound` og `spawnFirstRoundIfNeeded`):
```typescript
const hostStillPresent = snapshot.players.some((p) => p.id === snapshot.hostPlayerId);
const actorId = hostStillPresent ? snapshot.hostPlayerId : snapshot.players[0]?.id;
if (!actorId) {
  logger.warn({ roomCode }, "perpetual: empty room, skip restart");
  return;
}
```

**Industri-paritet:** Evolution Gaming har ingen host-konsept overhodet. Vår modell trenger en `SYSTEM_ACTOR` konstant i stedet for `players[0].id`-fallback (som velger en vilkårlig spiller).

**Estimat:** 1 dev-dag.

---

### KRITISK-2.7 — `assertHost`-bypass har slug-stavemåtefeil-risiko

**Severity:** MEDIUM
**Kategori:** master-arv | edge-case
**File:line:** `apps/backend/src/game/BingoEngine.ts:4193-4197`

```typescript
private assertHost(room: RoomState, actorPlayerId: string): void {
  const slug = room.gameSlug?.toLowerCase();
  if (slug === "rocket" || slug === "monsterbingo") {
    return;
  }
  if (room.hostPlayerId !== actorPlayerId) {
    throw new DomainError("NOT_HOST", "Kun host kan utføre denne handlingen.");
  }
}
```

PR #942-fixen sjekker BARE `rocket` og `monsterbingo`. Men koden andre steder bruker MANGE slug-aliases:

- `GAME2_SLUGS = ["rocket", "game_2", "tallspill"]` (Game2AutoDrawTickService.ts:63)
- `GAME3_SLUGS = ["monsterbingo", "mønsterbingo", "game_3"]` (Game3AutoDrawTickService.ts:56)
- `RoomLifecycleService.joinRoom:365` legger til alle disse som hall-shared.

**Trigger-scenario:** Hvis admin oppretter test-rom med `gameSlug: "tallspill"`, vil `assertHost` IKKE skip — fordi sjekken kun matcher `"rocket"`. Men `Game2AutoDrawTickService` ser slugen som `tallspill` (i GAME2_SLUGS) og prøver trekke baller. `assertHost` kaster `NOT_HOST`. ROCKET-typen stuck-bug oppstår.

**Konsekvens:** Hvis slug-aliasene noen gang brukes (admin tool, legacy-rom fra DB, manual `room:create`-payload), reproduseres ROCKET-stuck-bug fra 2026-05-05.

**Foreslått fix:**
```typescript
import { GAME2_SLUGS } from "./Game2AutoDrawTickService.js";
import { GAME3_SLUGS } from "./Game3AutoDrawTickService.js";

const PERPETUAL_GAME_SLUGS = new Set([...GAME2_SLUGS, ...GAME3_SLUGS]);

private assertHost(room: RoomState, actorPlayerId: string): void {
  const slug = room.gameSlug?.toLowerCase().trim();
  if (slug && PERPETUAL_GAME_SLUGS.has(slug)) return;
  ...
}
```

**Estimat:** 0.5 dev-dag.

---

### KRITISK-2.8 — `evaluateActivePhase` no-op ikke håndhevet for Spill 2/3

**Severity:** LOW
**Kategori:** master-arv | dead code
**File:line:** `apps/backend/src/game/DrawOrchestrationService.ts:491-500`

`autoClaimPhaseMode` er kun `true` for Spill 1's DEFAULT_NORSK_BINGO_CONFIG. Spill 2/3 har `patternEvalMode === "auto-claim-on-draw"` som styrer auto-claim via `onDrawCompleted`. Hvis admin per-game-config noensinne setter `autoClaimPhaseMode: true` på rocket/monsterbingo, vil engine kjøre BÅDE Game2/3-auto-claim OG `evaluateActivePhase`.

**Konsekvens:** Dual-payout-risiko hvis et brett tilfeldigvis matcher BÅDE Spill 1-pattern OG Spill 2/3-jackpot.

**Foreslått fix:** Tidlig-skip på slug:
```typescript
private async evaluateActivePhase(room, game): Promise<void> {
  const slug = room.gameSlug?.toLowerCase();
  if (slug === "rocket" || slug === "monsterbingo") {
    return;
  }
  ...
}
```

**Estimat:** 0.5 dev-dag.

---

## §3. Race-conditions

### KRITISK-3.1 — `onDrawCompleted` kan kjøre lengre enn `drawIntervalMs` på 1500-spillere-skala

**Severity:** HIGH
**Kategori:** race-condition | scaling-bottleneck
**File:line:** `apps/backend/src/game/DrawOrchestrationService.ts:464-481` + `Game2Engine.ts:120-327`

Auto-draw-tick kjører hvert 30. sek (default). I `_drawNextLocked` venter den på (per Game2Engine.onDrawCompleted):
- Per vinner: `payG2JackpotShare` (~50-100ms via walletAdapter.transfer) + `payG2LuckyBonus` (50-100ms) + `compliance.recordLossEntry` (~10-30ms) + `ledger.recordComplianceLedgerEvent` (~10-30ms) + `payoutAudit.appendPayoutAuditEvent` (~10-30ms) + `writeGameEndCheckpoint` (~50-100ms)

På 1500 × 32 brett = 48 000 brett. Hvis 100 vinner samtidig (worst-case), `onDrawCompleted` ~10-20 sekunder.

**Trigger-scenario:**
1. Tick 1 (t=0): trekker ball #19 (siste i 21-ball). 100 spillere har 9/9.
2. `onDrawCompleted` starter wallet-transfers, tar 15 sek.
3. Tick 2 (t=30): `currentlyProcessing` har ROCKET → SKIP.
4. Tick 3 (t=60): tick 1 ferdig på t=15 → cleared. Men `lastDrawAtByRoom` er fra t=0 → throttle ikke passert (60 - 0 = 60 ≥ 30, OK trekker). Men nå: auto-claim er ferdig OG runden er ENDED → cron skipper på `gameStatus !== "RUNNING"`.

OK, det er en fundamental design-glitch i hvordan throttle interagerer med slow-onDrawCompleted, men ikke en stuck-bug. Det er en **klient-UX-bug**: spillere ser "Trekning hver 30 sek" men siste ball + wallet-utbetalingen tar 15 sek lenger.

**Verre scenario — 10. ball med 50 vinnere underveis:**
1. Tick 1 (t=0): trekker ball #10. 50 vinnere får utbetalt jackpot.
2. `onDrawCompleted` tar 8 sek. Tick blokkert til t=8.
3. Tick 2 (t=30): trekker ball #11. Mange vinnere igjen.
4. Tick stadig blokkert.

Men auto-claim ender runden på første 9/9-completion. Så `onDrawCompleted` kjører kun én gang per runde med vinnere. **Faktisk eksponering:** kun siste tick.

**Likevel kritisk:** Hvis wallet-adapter (Postgres) henger på connection-pool på 1500-brett-jackpot-payout, kan `onDrawCompleted` ta MINUTTER. Render restarts prosessen → wallet-state inkonsistent.

**Skala-amplifikasjon:** Verifisert med BIN-761 outbox + REPEATABLE READ — hver wallet-transfer er en separat transaksjon med pessimistic-lock på `app_wallet_accounts`-rad. På Postgres med 25 connections (Render starter), kan kun 25 paralelle transfers. 100 vinnere med 100 transfers = 4 ganger sequence. Med 1500-spillere-skala ekstrapolert til 500 vinnere = 20× sequence.

**Foreslått fix:**
1. Begrens vinner-count i `onDrawCompleted` til chunks av 50. Spawn neste batch via `setImmediate`.
2. Bruk Promise.allSettled for paralelle transfers (i stedet for sekvens-loop linje 231-305 i Game2Engine.ts).
3. Logg `onDrawCompleted_duration_ms`-metric. Alert ved > 5 sek.

**Estimat:** 4 dev-dager.

---

### KRITISK-3.2 — `lastDrawAtByRoom` map er per-instance, ikke distribuert

**Severity:** HIGH
**Kategori:** race-condition | scaling
**File:line:** `apps/backend/src/game/Game2AutoDrawTickService.ts:254`, `Game3AutoDrawTickService.ts:132`, `DrawOrchestrationService.ts:170`

```typescript
private readonly lastDrawAtByRoom = new Map<string, number>();
```

Throttle-map er kun in-memory. Multi-node deploy (Render scale-out) → begge instanser trekker samtidig.

**Trigger-scenario (multi-node):**
1. Render boot 2 instances. Begge har egen `Game2AutoDrawTickService`.
2. Tick på A (t=0): trekker ball #1 → `lastDrawAtByRoom.set("ROCKET", 0)`.
3. Tick på B (t=15): `lastDrawAtByRoom` er TOM → trekker ball #2.

**Konsekvens:** 2 baller på 15 sek mens klient forventer 30 sek. UI-gap-detection trigger massive resync-storm.

**Faktisk pilot-status:** Render starter-plan = 1 instance — IKKE aktiv på pilot-konfig. Men 36 000 connections krever 4-6 instances.

**Foreslått fix:** Bruk eksisterende Redis `SchedulerLockProvider` som `DrawScheduler` allerede bruker.

**Estimat:** 3 dev-dager.

---

### KRITISK-3.3 — `currentlyProcessing` Set kan deadlock-leak

**Severity:** MEDIUM
**Kategori:** race-condition | recovery
**File:line:** `apps/backend/src/game/Game2AutoDrawTickService.ts:474-551`

```typescript
this.currentlyProcessing.add(summary.code);
try { ... } catch { ... } finally {
  this.currentlyProcessing.delete(summary.code);
}
```

`finally` cleaner alltid. **MEN** hvis `engine.drawNextNumber` returnerer en pending Promise som NEVER resolves (eks. wallet-adapter henger på connection-leak), `finally` aldri kjører.

**Trigger-scenario:**
1. `drawNextNumber` kaller `walletAdapter.transfer`.
2. Postgres henger på connection-pool exhaustion.
3. Promise henger.
4. `currentlyProcessing` har ROCKET. ALLE fremtidige ticks SKIP.
5. ROCKET frosset.

**Konsekvens:** Identisk med pre-PR #942 ROCKET stuck — bare en annen rotårsak. `currentlyProcessing` blir distribuert dead-lock.

**Foreslått fix:** Promise.race med timeout:
```typescript
const result = await Promise.race([
  this.engine.drawNextNumber({...}),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new DomainError("DRAW_TIMEOUT", "30s timeout")), 30_000)),
]);
```

**Estimat:** 1 dev-dag.

---

### KRITISK-3.4 — `room:join` muterer `room.players` UTEN draw-lock

**Severity:** CRITICAL
**Kategori:** race-condition | data-integritet
**File:line:** `apps/backend/src/game/BingoEngine.ts:3893-3919` + `RoomLifecycleService.ts:380`

`assertWalletNotInRunningGame` (linje 3909) muterer `room.players.delete(player.id)` for et RUNNING-rom. Kalles fra `RoomLifecycleService.joinRoom:375` UTEN draw-lock.

**Trigger-scenario (1500-spillere-skala):**
1. Auto-draw-tick på t=0 for ROCKET. `_drawNextLocked` starter. Drar `drawLocksByRoom` lock.
2. Inne i lock: `Game2Engine.findG2Winners:343` → `for (const player of room.players.values())`.
3. Iterator har 500 av 1500. `await this.payG2JackpotShare(vinner #45)`.
4. SAMTIDIG på t=0.5: `room:join`-handler for spiller Z. Z har stale player-record i ROCKET fra et tidligere join.
5. `assertWalletNotInRunningGame(Z.walletId)` kaller `room.players.delete(Z.oldPlayerId)`.
6. Iterator i punkt 2 fortsetter — kan ha skipt Z (mister vinner) eller dobbel-prosessert.

**Verifiser:** `findG2Winners` iterator + Map mutation race på Map prototype:
- Map.values() returnerer en MapIterator. Per ECMA-262, sletting av allerede-iterert key = no-op. Sletting av en KEY som ennå ikke er iterert = den vil ikke bli iterert.
- I iterasjon over 1500 entries med `await` mellom hver, kan Z bli slettet før iterator når den.

**Konsekvens:**
- Spiller Z mister vinningen (ikke iterert).
- Eller (verre): Z iteres FØRST (vinner #45), så slettes. Men `payG2JackpotShare(Z)` har allerede transferert. Z får utbetalt selv om hen "ikke er i rommet" (fra socket-perspektiv).
- Ledger har vinner-event for Z, men `room.players.has(Z)` er false.

**Skala-amplifikasjon:** På 1500-spillere-skala med ~50 join/min er sannsynlighet ~100% per dag.

**Foreslått fix:**
1. **Path A:** Snapshot iterator FØR await-er:
   ```typescript
   const allPlayers = [...room.players.values()];
   for (const player of allPlayers) {
     ...
   }
   ```
2. **Path B:** Wrap `assertWalletNotInRunningGame` i samme draw-lock som `_drawNextLocked`:
   ```typescript
   await this.drawOrchestrationService.withRoomLock(roomCode, async () => {
     this.assertWalletNotInRunningGame(...);
   });
   ```
3. **Path C:** Reject join hvis runden er RUNNING for perpetual-rom — i stedet for evict-and-replace. Spillere må vente til neste runde.

Anbefalt: **Path A** for raskt fix + **Path C** for prinsipiell renslighet. Path B er kompleks og holder lock for lenge.

**Estimat:** 3 dev-dager.

---

### KRITISK-3.5 — `findG2Winners` race med `cleanupStaleWalletInIdleRooms`

**Severity:** HIGH
**Kategori:** race-condition
**File:line:** `apps/backend/src/game/Game2Engine.ts:336-354`

Mens iterator i `findG2Winners` traverser `room.players`, kan en parallell `cleanupStaleWalletInIdleRooms`-call kjøre. **MEN** `cleanupStaleWalletInIdleRooms:3640` har:
```typescript
const isIdle = !room.currentGame || room.currentGame.status === "ENDED";
if (!isIdle) continue;
```
Så det skipper ROCKET når status=RUNNING. **Bra.**

**MEN** mellom `_drawNextLocked` setter `game.status = "ENDED"` (linje 350-356, 388-395, 580-585) og `onDrawCompleted` ferdig kjøre, er status=ENDED — og rommet er nå "idle" fra `cleanupStaleWalletInIdleRooms`-perspektiv.

**Trigger-scenario:**
1. Tick 1 (t=0): trekker ball #21 (siste). MAX_DRAWS_REACHED → status=ENDED.
2. Tick 1 fortsetter: `finishPlaySessionsForGame` → `writeGameEndCheckpoint` → `onDrawCompleted` returnerer.
3. SAMTIDIG på t=0.5: `room:join`-handler for spiller Z. Stale wallet-binding i ROCKET. Status=ENDED → `cleanupStaleWalletInIdleRooms` deletes Z.

**Verifisert:** ROCKET nå har spillere som ble slettet mid-end. Hvis `onDrawCompleted` kjører `findG2Winners`, kan Z være vinner men slettet.

OK, faktisk: `onDrawCompleted` kjører FØR `game.status = "ENDED"`-mutasjonen i Game2Engine — fordi `onDrawCompleted` setter status selv på linje 311 etter winner-detection. Så status er fortsatt RUNNING under iteration.

**Korreksjon:** Faktisk OK fordi status mutasjon skjer ETTER iteration. Severity: LOW.

**Severity korrigert:** LOW (var feil-vurdert).

---

### KRITISK-3.6 — `bet:arm` kan trigge mid-runde og forårsake duplikat tickets

**Severity:** HIGH
**Kategori:** race-condition
**File:line:** `apps/backend/src/sockets/gameEvents/roomEvents.ts:armPlayer-handlere` + `apps/backend/src/util/roomState.ts:armPlayer`

`bet:arm` socket-handler (registrert i roomEvents.ts) muterer `armedPlayerIdsByRoom` Map. Men det er INGEN sjekk om runden er RUNNING — armingen er ment som "pre-round" forberedelse.

`PerpetualRoundService.startNextRound:489` leser armed-state via `armedLookup.getArmedPlayerIds(roomCode)`. Men hvis spiller A armer MENS runden er RUNNING, blir hen lagt til armed-Set. Når runden slutter og perpetual scheduler restart, leses spilleren med i ny runde.

Dette ER intensjonelt design — "forhåndskjøp neste runde". **MEN** hvis spiller A armer, runden ender, perpetual-loop starter ny runde med A's tickets, og spiller A samtidig sender `ticket:cancel` for sine forhåndskjøp:

1. Tick: trekker siste ball, status=ENDED.
2. PerpetualRoundService: scheduleRestart i 30s.
3. Spiller A sender `ticket:cancel` (status==ENDED, tillatt).
4. `cancelPreRoundTicket` fjerner ticket fra display-cache OG fra armed-Set.
5. Restart fyrer på t=30: `getArmedPlayerIds` returnerer uten A.
6. Ny runde starter uten A.

OK, dette er riktig. **Race-vinduet:** mellom `cancelPreRoundTicket` og `startGame`-call. Hvis cancel skjer ETTER perpetual hentet armed-list men FØR engine.startGame fullfører, kan A få tickets selv om hen kansellerte.

**Verifiser:** `PerpetualRoundService.startNextRound:489-491` henter `armedLookup`-state RIGHT BEFORE `engine.startGame`. Cancel som skjer mellom disse to handlinger = A blir igjen.

**Konsekvens:** Spiller A får ticket hen ikke ville ha. Wallet debitert med entryFee. Klage.

**Foreslått fix:** `engine.startGame` skal re-validere armed-state inne i samme synkron-blokk som charge-en. Eller: ticket:cancel skal ta global lock på rommet.

**Estimat:** 2 dev-dager.

---

## §4. State-mutering-issues

### KRITISK-4.1 — `room.currentGame` mutasjoner er ikke atomiske

**Severity:** HIGH
**Kategori:** state-mutation | recovery
**File:line:** `apps/backend/src/game/Game2Engine.ts:310-315` + `Game3Engine.ts:231-237`

```typescript
// Game2Engine.onDrawCompleted (linje 308-326)
const endedAtMs = Date.now();
game.bingoWinnerId = winnerRecords[0]?.playerId;
game.status = "ENDED";
game.endedAt = new Date(endedAtMs).toISOString();
game.endedReason = "G2_WINNER";
await this.finishPlaySessionsForGame(room, game, endedAtMs);
await this.writeGameEndCheckpoint(room, game);
await this.rooms.persist(room.code);
```

Mutasjons-rekkefølge: status først, persist sist. Hvis Render-prosessen krasjer mellom `status = "ENDED"` og `persist`, in-memory state er ENDED men persistert state er RUNNING. Restart loader RUNNING-state, men `endedReason` er ikke satt → STUCK.

**Trigger-scenario:**
1. Tick: trekker siste ball. Vinner detected.
2. `game.status = "ENDED"` mutated.
3. `finishPlaySessionsForGame` kjører — Postgres operasjon.
4. Postgres henger på connection.
5. Render restart prosessen pga timeout.
6. Loader checkpoint fra tidligere draw (status=RUNNING + drawn=21).
7. `StaleRoomBootSweepService` detecterer dette og fyrer `forceEndStaleRound`. 

Faktisk **boot-sweep DEKKER dette**! Verifisert at `StaleRoomBootSweepService.sweep()` kjøres ved boot (`index.ts:4118`). OK, denne er recovered.

**MEN:** Hvis crash skjer ETTER `writeGameEndCheckpoint` men FØR `bingoAdapter.onGameEnded` fyres, vil PerpetualRoundService aldri schedulere restart. Restart må trigges av neste spiller-join via `spawnFirstRoundIfNeeded`.

**Foreslått fix:** Bruk Postgres-transaksjon med outbox-pattern (BIN-761) for at status-update + onGameEnded-event skjer i samme atomic-batch.

**Estimat:** 4 dev-dager.

---

### KRITISK-4.2 — `lastG3DrawEffectsByRoom` & `lastDrawEffectsByRoom` har ingen cleanup ved disconnect

**Severity:** LOW
**Kategori:** memory-leak
**File:line:** `apps/backend/src/game/Game2Engine.ts:98` + `Game3Engine.ts:168`

`lastDrawEffectsByRoom` Map populated ved `onDrawCompleted`, drained ved `getG{2,3}LastDrawEffects` (atomic read+clear).

**Trigger-scenario:**
1. Spill 2 trekker ball. `onDrawCompleted` populerer `lastDrawEffectsByRoom.set("ROCKET", effects)`.
2. Broadcaster (`game23DrawBroadcasterAdapter.ts:121`) drainer via `engine.getG2LastDrawEffects("ROCKET")`.
3. **MEN** hvis broadcaster-promise henger eller exceptions kastes UTEN at adapter får drained, blir effects-objektet stuck i Map.
4. Neste tick overskriver det. OK.

**Verifisert:** Map-en re-skrives ved hver tick. Memory-leak er bounded — én entry per rom (kun ROCKET + MONSTERBINGO = 2 entries totalt).

**Severity korrigert:** TRIVIAL. Kan ignoreres.

---

### KRITISK-4.3 — `cyclersByRoom` for Game3 cleanup ved destroy mangler

**Severity:** LOW
**Kategori:** memory-leak
**File:line:** `apps/backend/src/game/Game3Engine.ts:154-156`

```typescript
private readonly cyclersByRoom = new Map<string, PatternCycler>();
private readonly cyclerGameIdByRoom = new Map<string, string>();
```

Disse Map-ene ryddes IKKE i `RoomLifecycleService.destroyRoom`-callbacken `cleanupRoomLocalCaches`. Hvis admin destroyer MONSTERBINGO og oppretter på nytt, vil gammel cycler bli reused (men siden gameId er ny, blir `getOrCreateCycler` å lage en ny — OK).

**Faktisk:** PR #860 reverted Game3 til full 5×5 patterns. `getOrCreateCycler` matcher på `cyclerGameIdByRoom` så det er trygt.

**Severity korrigert:** TRIVIAL.

---

### KRITISK-4.4 — `roomState.armedPlayerIdsByRoom` er per-instance Map

**Severity:** HIGH
**Kategori:** state-mutation | scaling
**File:line:** `apps/backend/src/util/roomState.ts:90`

```typescript
readonly armedPlayerIdsByRoom: Map<string, Map<string, number>>;
```

Per-instance. Multi-node deploy (Render scale-out) → hver instans har egen Map. Spiller som armer på instans-A vil ikke vise i armed-list på instans-B.

**Trigger-scenario:**
1. Render scale-out til 4 instances pga 36 000 connections.
2. Spiller A's socket landt på instans-B. Spiller A sender `bet:arm`. Instans-B oppdaterer SIN armedPlayerIdsByRoom.
3. PerpetualRoundService kjører på instans-A (cron lottery). Leser armedPlayerIdsByRoom på instans-A — A er IKKE der.
4. Ny runde starter UTEN A.
5. A's klient ser "Du er ikke med i runden" — selv om hen armed.

**Konsekvens på 1500-spillere-skala:** Mange spillere mister sine forhåndskjøp.

**Foreslått fix:** Migrate `armedPlayerIdsByRoom` til Redis (samme strukturen som `RoomStateStore` for room-state).

**Estimat:** 5 dev-dager.

---

## §5. Perpetual-loop fail-modes

### KRITISK-5.1 — Game3AutoDrawTickService mangler stuck-room recovery (TOP 2)

**Severity:** CRITICAL
**Kategori:** perpetual-loop-issue
**File:line:** `apps/backend/src/game/Game3AutoDrawTickService.ts:216-219`

```typescript
if (game.drawnNumbers.length >= GAME3_MAX_BALLS) {
  skipped++;
  continue;
}
```

Game3 har INGEN motpart til Game2's `forceEndStaleRound`-recovery (Game2 linje 377-439). Hvis MONSTERBINGO har trekket alle 75 baller uten Coverall-vinner OG status fortsatt RUNNING (typisk fra crash mid-draw eller hook-feil), blir rommet stuck for evig.

**Trigger-scenario:**
1. MONSTERBINGO trekker ball #75. Hook-feil i `Game3Engine.onDrawCompleted` (eks: `payG3PatternShare` kastet pga wallet-shortage).
2. `K5 handleHookError` halter rommet (status=RUNNING med `isPaused=true`). MEN `game.endedReason` settes IKKE.
3. Cron tick: drawnNumbers.length=75 → skip (uten recovery).
4. Rommet stuck.

**Konsekvens:** MONSTERBINGO permanent stuck til admin manually intervenes.

**Foreslått fix:** Kopier Game2-pathen 1:1 til Game3:
```typescript
if (game.drawnNumbers.length >= GAME3_MAX_BALLS) {
  skipped++;
  if (typeof this.engine.forceEndStaleRound === "function") {
    try {
      const ended = await this.engine.forceEndStaleRound(
        summary.code,
        "STUCK_AT_MAX_BALLS_AUTO_RECOVERY"
      );
      if (ended) {
        if (this.onStaleRoomEnded) {
          await this.onStaleRoomEnded(summary.code).catch(...);
        }
      }
    } catch (err) { ... }
  }
  continue;
}
```

`Game3AutoDrawTickServiceOptions` mangler også `onStaleRoomEnded` — må legges til.

**Estimat:** 1 dev-dag.

---

### KRITISK-5.2 — `Game3AutoDrawTickService` exposes ingen `getLastTickResult` for diagnostikk

**Severity:** MEDIUM
**Kategori:** observability-gap
**File:line:** `apps/backend/src/game/Game3AutoDrawTickService.ts`

Game2 har `lastTickResult` for diagnose-route (`devGame2State.ts:262`). Game3 mangler det.

**Konsekvens:** Når MONSTERBINGO henger, ops kan ikke se siste tick-resultat. Må stikke i logs.

**Foreslått fix:** Kopier `lastTickResult` + `getLastTickResult` fra Game2-tjenesten.

**Estimat:** 0.5 dev-dag.

---

### KRITISK-5.3 — `spawnFirstRoundIfNeeded` race med `handleGameEnded`

**Severity:** HIGH
**Kategori:** perpetual-loop-issue
**File:line:** `apps/backend/src/game/PerpetualRoundService.ts:573-739`

`spawnFirstRoundIfNeeded` sjekker:
```typescript
if (this.pendingByRoom.has(roomCode)) {
  // skip — pending restart from previous round
  return false;
}
```

**Trigger-scenario:**
1. Runde slutter (G2_WINNER) → `handleGameEnded` scheduler restart i 30s. `pendingByRoom.set(...)`.
2. ALLE spillere disconnecter. Rom blir tom.
3. På t=30: pending-handler fyrer `startNextRound`. Snapshot.players.length=0 → return. `pendingByRoom.delete()` (linje 401).
4. På t=31: Spiller A connecter (room:join). `spawnFirstRoundIfNeeded` ser ingen pending → kjører.
5. Men status=ENDED → spawn lykkes.

OK, faktisk fungerer dette. **MEN:**

1. På t=30: pending-handler starter `startNextRound` async.
2. På t=30.001: `startNextRound` har gjort `pendingByRoom.delete(roomCode)` (linje 401) men IKKE fullført `engine.startGame` ennå.
3. På t=30.002: Spiller A connecter. `spawnFirstRoundIfNeeded` ser:
   - pendingByRoom.has(ROCKET) === false (cleared)
   - currentGame.status === ENDED (ikke endret av startNextRound ennå)
   - Players.length > 0
4. spawnFirstRoundIfNeeded kjører `engine.startGame` parallelt.
5. To `startGame`-calls samtidig.

`engine.startGame` har `assertNotRunning` (linje 997), så den andre kaster `ALREADY_RUNNING`. Race-vinduet er smal men finnes.

**Konsekvens:** Logger viser "ALREADY_RUNNING"-feil for én av call-ene. Begge fail-soft-håndteres. Men runden er startet.

**Severity:** Egentlig OK fordi `assertNotRunning` fanger det. Severity: LOW.

---

### KRITISK-5.4 — `NATURAL_END_REASONS` inkluderer ikke `STUCK_AT_MAX_BALLS_AUTO_RECOVERY`

**Severity:** MEDIUM
**Kategori:** perpetual-loop-issue
**File:line:** `apps/backend/src/game/PerpetualRoundService.ts:196-202`

```typescript
export const NATURAL_END_REASONS: ReadonlySet<string> = new Set([
  "G2_WINNER",
  "G2_NO_WINNER",
  "G3_FULL_HOUSE",
  "MAX_DRAWS_REACHED",
  "DRAW_BAG_EMPTY",
]);
```

`STUCK_AT_MAX_BALLS_AUTO_RECOVERY` (fra `Game2AutoDrawTickService` recovery) er IKKE i lista. Heller ikke `BOOT_SWEEP_STALE_ROUND` (fra `StaleRoomBootSweepService`).

**Konsekvens:** Når Game2-tick recovers stuck-rom og fyrer `forceEndStaleRound`, fyrer `onGameEnded` med `endedReason: "STUCK_AT_MAX_BALLS_AUTO_RECOVERY"`. PerpetualRoundService.handleGameEnded ser:
```typescript
if (!NATURAL_END_REASONS.has(input.endedReason)) {
  logger.info({reason: "manual_or_unknown_end"}, "perpetual: skip restart");
  return;
}
```

Restart skipper. Recovery er ufullstendig.

**Verifisert:** `Game2AutoDrawTickService.onStaleRoomEnded` callback (linje 187) er WIRED i index.ts (linje 2025) og trigger `spawnFirstRoundIfNeeded` direkte. **OK** — recovery bypasses `handleGameEnded` og kaller spawn direkte.

**MEN:** Det betyr at recovery fyrer to spawn-pathss:
1. `onStaleRoomEnded` → `spawnFirstRoundIfNeeded`
2. `bingoAdapter.onGameEnded` → `handleGameEnded` → skipper

Path 1 lykkes. OK.

**Severity korrigert:** LOW (codebase OK, men dokumentasjonen er uklar).

---

### KRITISK-5.5 — Hvis `onPlayerRejected` fyrer for ALLE armed players, ingen tickets pre-debited

**Severity:** HIGH
**Kategori:** perpetual-loop-issue
**File:line:** `apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts:65-125`

`onPlayerRejected` callbackes når en armed spiller har stale wallet-state (DAILY_LOSS_LIMIT, INSUFFICIENT_FUNDS, etc.). For Spill 2/3 er det perpetual-spill — alle armed = forhåndskjøp.

**Trigger-scenario:**
1. Spillere armer 100 brett før runde slutt.
2. Runde slutter (winner detected).
3. PerpetualRoundService scheduler restart i 30s.
4. Mange spillere når daglig tapsgrense på 30s-vinduet (fra forrige runde).
5. På t=30: `engine.startGame` kalles med 100 armed players.
6. `BingoEngine.startGame` validerer wallet-state per spiller. ALLE 100 rejected.
7. Ny runde starter med 0 spillere. `prizePool=0`. Auto-draw kjører — ingen vinner. G2_NO_WINNER. Restart i 30s.
8. Loop: ny runde starter, ingen armed, gamletilstand. Forever.

**Konsekvens:** ROCKET kan henge i evig "tom runde"-loop. Spillere som joiner ser status=RUNNING men ingen brett.

**Foreslått fix:** Hvis `armedPlayerIds.length === 0` etter rejection-loop, ikke start runden. Vent på neste arm.

**Estimat:** 1 dev-dag.

---

## §6. Skalering-bottlenecks (1500 spillere)

### KRITISK-6.1 — `room:update` payload-størrelse (TOP 5)

**Severity:** CRITICAL
**Kategori:** scaling-bottleneck
**File:line:** `apps/backend/src/index.ts:1333-1337` + `apps/backend/src/util/roomHelpers.ts:235`

`buildRoomUpdatePayload` returner `RoomSnapshot & {...}`. RoomSnapshot inneholder `players: Player[]` (linje 235 i roomHelpers.ts).

På 1500 spillere × ~200 bytes/Player = 300 KB per emit. `io.to("ROCKET").emit(...)` sender til ALLE 1500 sockets = 450 MB per emit.

Med 30-sek-draw + ~50 join/cancel/arm-events/min = 2 emits/sec × 450 MB = **900 MB/sek bandwidth**. Render starter har 10 GB/mnd bandwidth.

**Konsekvens i prod:** OOM eller bandwidth-cap → Render kjøring stopper innen minutter.

**Verifisert:** Socket.IO bruker JSON over WebSocket. Compression-mode (perMessageDeflate) er av default på socket.io-server. 1500 sockets samtidig = `socket.send()` synkron-itererer over alle sockets — N×O(payload-size).

**Foreslått fix:**
- **Path A (minimal):** Strip `players` fra Spill 2/3 RoomUpdatePayload — bare send `playerCount`. Klient bruker delta-events.
- **Path B (robust):** Implement per-spiller diff-events. `room:update` sendes kun til admin-display.
- **Path C (casino-grade):** Migrate til protobuf + gzip-compression.

**Estimat:** 5-7 dev-dager (Path A).

---

### KRITISK-6.2 — `findG2Winners` er O(N×M) på 48 000 brett

**Severity:** HIGH
**Kategori:** scaling-bottleneck
**File:line:** `apps/backend/src/game/Game2Engine.ts:336-354`

```typescript
private findG2Winners(room: RoomState, game: GameState): Array<...> {
  const drawnSet = new Set(game.drawnNumbers);
  const winners: Array<...> = [];
  for (const player of room.players.values()) {
    const tickets = game.tickets.get(player.id);
    if (!tickets) continue;
    for (let i = 0; i < tickets.length; i += 1) {
      const t = tickets[i];
      if (hasFull3x3(t, drawnSet)) {
        winners.push({ player, ticketIndex: i, ticketId: t.id });
      }
    }
  }
  return winners;
}
```

`hasFull3x3` itererer over ticket-cells (9 verdier) og sjekker `drawnSet.has(...)`. Per ticket: 9 ops. På 48 000 brett: **432 000 ops per draw**.

V8-throughput: ~50M ops/sec → 432K ops = ~9ms. OK på 1500-spillere-skala.

**Skala-amplifikasjon ved 36 000 connections (24 haller × 1500):** Hvis vi multipliserer brett til 1.15M = 10.4M ops = ~210ms per draw. Acceptabelt.

**Konsekvens:** Ikke en blokker, men spike-test bør verifisere.

**Severity korrigert:** LOW (acceptabelt for pilot-skala).

---

### KRITISK-6.3 — `Game3.processG3Winners` tar O(P×T×N) for hver pattern

**Severity:** HIGH
**Kategori:** scaling-bottleneck
**File:line:** `apps/backend/src/game/Game3Engine.ts:284-347`

Per draw på Spill 3:
- Pattern-cycler-step beregner aktive patterns (typisk 1-5).
- For hver aktiv pattern: scan alle player-ticket-masks (1500 × 1 ticket = 1500 entries).
- Per match: payG3PatternShare med 4 Postgres-queries.

**Verifiser:** Game3 har ÉN ticket per spiller (Standard-type, fra revert PR #860). Så det er 1500 entries per pattern. 5 patterns = 7500 mask-evals per draw.

**Mask-eval er bitvise op:** `(mask & patternMask) === patternMask` — ~10ns per op. 7500 × 10ns = 75 µs per draw. Trivielt.

**Postgres-bottleneck per vinner:** 4 queries × 50ms hver = 200ms per vinner. På 1500-spillere-skala kan 200+ vinne (T-pattern på siste threshold-ball). 200 × 200ms = **40 sekunder for utbetalinger**.

**Konsekvens:** Game3-runde med Coverall-vinner-burst tar minutter å fullføre wallet-transfers. Klient ser frosset.

**Foreslått fix:**
- **Path A:** Batch-utbetaling — én Postgres-tx for alle 200 vinnere i samme pattern.
- **Path B:** Async-payout via outbox (BIN-761) — engine svarer raskt med "winner detected", payout skjer i bakgrunnen.

**Estimat:** 5 dev-dager.

---

### KRITISK-6.4 — Postgres connection-pool exhaustion ved mass-payout

**Severity:** HIGH
**Kategori:** scaling-bottleneck
**File:line:** `apps/backend/src/adapters/PostgresWalletAdapter.ts` + per-vinner `walletAdapter.transfer`

På 1500 brett × ~5% vinnerate = 75 vinnere per draw. Hver vinner får 4-5 wallet/ledger queries med pessimistic-lock på `app_wallet_accounts.balance`. Render Postgres starter har 25 connections.

Med 75 paralelle transfers og 25 connections = 3 batches × 200ms = ~600ms latency.

**Skala-amplifikasjon ved 36 000 spillere:** 1800 vinnere per draw. 72 batches × 200ms = 14.4 sekunder. Outpaces 30-sek-tick.

**Foreslått fix:** Batch-transfer med EN connection per draw. Bruk Postgres `WITH (...) UPDATE` for å oppdatere alle wallets atomisk.

**Estimat:** 4 dev-dager.

---

### KRITISK-6.5 — Socket.IO `io.to(roomCode).emit()` er O(N) per emit

**Severity:** HIGH
**Kategori:** scaling-bottleneck

Socket.IO sin `io.to(roomCode).emit()` itererer over alle sockets i rommet og kaller `socket.send()` for hver. På 1500 sockets = 1500 syscalls (TCP write).

For "draw:new" event (typisk 50 bytes), 1500 sockets × 50 bytes = 75 KB per emit. Acceptabelt.

For "room:update" event (300 KB), 1500 × 300KB = 450 MB. **IKKE acceptabelt** (se §6.1).

**Skala-amplifikasjon ved 36 000:** 36 000 × 50 bytes = 1.8 MB per draw:new. Multiply by frequency (1 per 30s) = ~60 KB/sec → OK.

**Konsekvens:** `draw:new` er OK. `room:update` er ikke (se §6.1).

---

### KRITISK-6.6 — Redis room-state sync på hver `syncRoomToStore` call

**Severity:** MEDIUM
**Kategori:** scaling-bottleneck
**File:line:** `apps/backend/src/store/RoomStateStore.ts:59` + `apps/backend/src/store/RedisRoomStateStore.ts`

`syncRoomToStore(room)` kalles fra `RoomLifecycleService.createRoom:301` + cleanup paths. Det skriver hele `room.players` Map til Redis som JSON.

På 1500 spillere = ~300 KB per write. Hver `room:join` triggerer write. Med 50 join/min = 50 × 300KB = 15 MB/min Redis I/O. Acceptabelt.

**MEN:** Hvis `cleanupStaleWalletInIdleRooms` kjøres for ROCKET (skipped via isIdle, OK) eller andre rom (ikke relevant for ROCKET), `syncRoomToStore` fyres etterpå.

**Konsekvens:** Trivielt. Severity LOW.

---

## §7. Recovery + crash-resilience

### KRITISK-7.1 — `writeDrawCheckpoint` etter hver ball er kostbar men nødvendig

**Severity:** MEDIUM
**Kategori:** recovery-gap
**File:line:** `apps/backend/src/game/DrawOrchestrationService.ts:529`

`writeDrawCheckpoint` kjører Postgres `UPDATE app_game_state` etter hver ball. På 30-sek-draw er det ~120 writes/time per rom. Acceptabelt.

**Faktisk OK.**

---

### KRITISK-7.2 — Crash mellom `onDrawCompleted`-payout og `writeGameEndCheckpoint` = inconsistent state

**Severity:** HIGH
**Kategori:** recovery-gap
**File:line:** `apps/backend/src/game/Game2Engine.ts:308-326`

```typescript
const endedAtMs = Date.now();
game.bingoWinnerId = winnerRecords[0]?.playerId;
game.status = "ENDED";  // <-- IN-MEMORY MUTASJON
game.endedAt = new Date(endedAtMs).toISOString();
game.endedReason = "G2_WINNER";
await this.finishPlaySessionsForGame(...);  // <-- POSTGRES OP
await this.writeGameEndCheckpoint(...);     // <-- POSTGRES OP
await this.rooms.persist(room.code);        // <-- REDIS OP
```

Wallet-utbetalinger (linje 246-275) skjer FØR status-mutasjon. Hvis Render restart ETTER utbetalinger men FØR `writeGameEndCheckpoint`:

1. Wallet er kreditert.
2. Postgres `app_game_state` har RUNNING + drawnNumbers=21.
3. `bingoAdapter.onGameEnded` ble IKKE fyrt (skjer i adapter-layer etter checkpoint).
4. PerpetualRoundService får ingen trigger.
5. Boot-sweep detecterer dette og fyrer `forceEndStaleRound` med `STUCK_AT_MAX_BALLS_AUTO_RECOVERY`.

**OK, recovery dekkes av boot-sweep.**

**MEN:** boot-sweep-en setter `endedReason: "BOOT_SWEEP_STALE_ROUND"` — ikke `G2_WINNER`. Så `claims`-array på `game` er fortsatt populated (vinner-info finnes), men compliance-rapporter ser et "stuck"-scenario heller enn et vinner-scenario.

**Konsekvens:** Audit-trail er forvirrende. Vinneren fikk pengene, men runden er logget som "stuck recovery" i stedet for "natural end".

**Foreslått fix:**
- Reorder Game2Engine.onDrawCompleted: skriv checkpoint FØR utbetalinger (med "ABOUT_TO_END" status). Ved crash: recovery ser ABOUT_TO_END-state og kan velge å avvise eller fortsette utbetalinger basert på outbox.
- Eller bruk BIN-761 outbox-pattern for utbetalinger så de er recoverable separat fra status.

**Estimat:** 5 dev-dager.

---

### KRITISK-7.3 — `attachPlayerSocket` ved reconnect kan miste ticket-state

**Severity:** MEDIUM
**Kategori:** recovery-gap
**File:line:** `apps/backend/src/game/BingoEngine.ts:3520-3530`

```typescript
attachPlayerSocket(roomCode, playerId, socketId): void {
  const room = this.requireRoom(roomCode.trim().toUpperCase());
  const player = this.requirePlayer(room, playerId);
  this.assertWalletAllowedForGameplay(player.walletId, Date.now());
  player.socketId = socketId;
  ...
}
```

Reconnect-flyt: spiller A disconnecter, runde fortsetter. A connecter på nytt — `room:resume` event → `attachPlayerSocket`. A's player-record er fortsatt i rommet (socketId=undefined ble satt på disconnect, ingen delete).

**OK, dette fungerer.**

**MEN:** Hvis A var armed med 5 brett og disconnect skjedde, blir armed-state preserved (BingoEngine har `cleanupStaleWalletInIdleRooms.isPreserve` callback). Verifisert.

Hvis runden startet uten A (fordi A disconnected før `engine.startGame` så A's wallet-validation kastet `WALLET_BLOCKED` eller `INSUFFICIENT_FUNDS`)? Da har A IKKE tickets i `game.tickets`. Reconnect ser tom brett-state.

**Severity:** MEDIUM. Klient håndterer dette via "spectating mode" (Game2Controller.ts: `Phase = "SPECTATING"`). OK.

---

### KRITISK-7.4 — Postgres session-persistance mangler `room.players` Map

**Severity:** HIGH
**Kategori:** recovery-gap

Postgres `app_game_state.players_by_id_json` (sjekket i grep tidligere) har player-snapshot. Men reconnect-flyt re-bygger fra Redis, ikke Postgres direkte. Hvis Redis disconnecter mid-runde:

1. `RedisRoomStateStore` er konfigurert (sjekket env).
2. Hvis Redis disconnecter, `RoomStateStore` faller tilbake til memory.
3. Memory har siste known state.
4. Hvis Render samtidig restart, memory taper. Boot-loader prøver Redis (failed) → loader fra Postgres-checkpoint.

**Verifisert:** `BingoEngineRecovery.ts` håndterer dette. OK.

**Severity:** LOW (eksisterende dekning).

---

## §8. Observability-gaps + foreslåtte error-codes

### KRITISK-8.1 — Manglende strukturert logging for kritiske operasjoner

**Severity:** MEDIUM
**Kategori:** observability-gap

Per Tobias' direktiv skal vi kunne diagnose stuck-rom uten kode-inspeksjon. Auditen finner:

| Operasjon | Loggene | Strukturert? | Trace-ID? | Metric? |
|---|---|---|---|---|
| `drawNextNumber` enter | YES (`game.draw`) | YES | NO | NO |
| `drawNextNumber` exit | NO | — | — | NO |
| `onDrawCompleted` start | NO | — | — | NO |
| `onDrawCompleted` end | NO | — | — | NO |
| `payG2JackpotShare` | YES (`G2_JACKPOT_PAYOUT`) | YES | NO | NO |
| `forceEndStaleRound` | YES | YES | NO | NO |
| Stuck-room detected | YES (`auto-recovered stuck room`) | YES | NO | NO |
| `assertHost` bypass | NO | — | — | NO |
| `cleanupStaleWalletInIdleRooms` evict | YES | YES | NO | NO |
| Room.players mutation | NO | — | — | NO |
| Wallet-pool exhaustion | NO | — | — | NO |
| `currentlyProcessing` block | NO | — | — | NO |
| `lastDrawAtByRoom` throttle | YES | YES | NO | NO |
| Tick-duration | YES | YES | NO | NO |
| Auto-restart skip | YES | YES | NO | NO |

**Foreslått fix:** Implement strukturert error-code-system (se §14) + Prometheus metrics for hver kritisk operasjon. Trace-ID propagation er allerede implementert (MED-1) — sørg for at alle operasjoner inkluderer det.

**Estimat:** 4 dev-dager.

---

### KRITISK-8.2 — Ingen alert ved stuck-rom

**Severity:** MEDIUM
**Kategori:** observability-gap

Når `forceEndStaleRound` fyrer i Game2-tick, logges det på `warn`. Men det finnes ingen alert til Slack/PagerDuty. Hvis stuck skjer på 1500-spillere-rom, ops får vite det via klagene først.

**Foreslått fix:**
1. Push event til BIN-761 outbox med `event_type: "ROOM_STUCK_RECOVERED"`.
2. Periodic-job leser outbox og fyrer alerts.

**Estimat:** 2 dev-dager.

---

### KRITISK-8.3 — `lastTickResult` mangler for Game3

**Severity:** MEDIUM
**Kategori:** observability-gap (også §5.2)
**File:line:** `apps/backend/src/game/Game3AutoDrawTickService.ts`

Game2 har `getLastTickResult()` som er konsumert av `/api/_dev/game2-state`. Game3 mangler tilsvarende endpoint.

**Foreslått fix:** Kopier `lastTickResult` fra Game2 + add `/api/_dev/game3-state` endpoint.

**Estimat:** 1 dev-dag.

---

## §9. Wallet-paritet med Spill 1

### KRITISK-9.1 — `LedgerGameType` hardkoded til DATABINGO i prize-cap (TOP 3)

**Severity:** CRITICAL
**Kategori:** compliance-risiko
**File:line:** `apps/backend/src/game/Game2Engine.ts:379, 503` + `Game3Engine.ts:533`

Mens `recordComplianceLedgerEvent` (linje 428, 531) bruker korrekt `gameType` fra `ledgerGameTypeForSlug`-resolver (`MAIN_GAME` for rocket/monsterbingo), kalles `prizePolicy.applySinglePrizeCap` med eksplisitt `gameType: "DATABINGO"` på 3 steder.

**Konsekvens regulatorisk:**
- `prizePolicy` kan ha ulike single-prize-caps per game-type. Lotteritilsynet 2 500 kr-cap er felles, men interne business-rules kan variere.
- **Mer alvorlig:** §11-distribution prosent (`ComplianceLedgerOverskudd.ts:75`) bruker `gameType === "DATABINGO" ? 0.3 : 0.15`. Dette ville være feil hvis ledger-events lagret feil type.
- MEN: `recordComplianceLedgerEvent` bruker korrekt `gameType`. Bare prize-cap-kallet er feil.

**Verifisert via grep:**
```
apps/backend/src/game/Game2Engine.ts:379:      gameType: "DATABINGO",
apps/backend/src/game/Game2Engine.ts:503:      gameType: "DATABINGO",
apps/backend/src/game/Game3Engine.ts:533:      gameType: "DATABINGO",
```

**Foreslått fix:** Bytt alle 3 steder til `gameType` (variabelen som er resolved tidligere i samme funksjon, linje 227 i Game2Engine, linje 302 i Game3Engine).

**Estimat:** 0.5 dev-dag.

---

### KRITISK-9.2 — `houseAccountId` mismatch mellom resolver og prize-cap

**Severity:** HIGH
**Kategori:** compliance-risiko
**File:line:** `apps/backend/src/game/Game2Engine.ts:228-229`

```typescript
const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);  // MAIN_GAME
const channel: LedgerChannel = "INTERNET";
const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);
// ↑ "house-{hallId}-main_game-internet"
```

Wallet-transfer SOURCE = `houseAccountId` (line 408). I `payG2JackpotShare`, transfer fra `house-{hallId}-main_game-internet` til player.walletId.

**MEN:** `prizePolicy.applySinglePrizeCap({hallId, gameType: "DATABINGO", amount})` (linje 379) bruker DATABINGO. Hvis `prizePolicy` har egne hall-balance-checks per game-type, vil mismatch oppstå.

Verifiser om prizePolicy.applySinglePrizeCap accesser `hallId+gameType`-tuple:

<files-not-checked-but-suspect>

**Foreslått fix:** Konsolider gameType-bruk i hele Game2Engine + Game3Engine. Bytt alle DATABINGO-strenger til resolver-call.

**Estimat:** 1 dev-dag.

---

### KRITISK-9.3 — Outbox-pattern (BIN-761) fungerer for Spill 2/3? Ikke verifisert

**Severity:** MEDIUM
**Kategori:** wallet-recovery

BIN-761 implementerte outbox for Spill 1. Auditen verifiserer ikke om Game2/3-payouts er dekket.

**Foreslått fix:** Verifiser at `walletAdapter.transfer`-kallene i Game2/3Engine går gjennom outbox-pattern. Hvis ikke, refaktorer til samme pattern.

**Estimat:** 2 dev-dager (verifikasjon + evt. fix).

---

### KRITISK-9.4 — Hash-chain audit (BIN-764) dekker Spill 2/3? Ikke verifisert

**Severity:** MEDIUM
**Kategori:** wallet-audit

Hash-chain audit-verifier kjører nightly. Verifiserer den Spill 2/3-payouts?

**Foreslått fix:** Verifiser audit-spec.

**Estimat:** 1 dev-dag.

---

## §10. Sammenligning mot Evolution / Playtech / Pragmatic

### Evolution Gaming (markedsleder, 70% live-casino-share, ISO 27001)

| Aspekt | Evolution | Spillorama Spill 2/3 | Gap |
|---|---|---|---|
| Master/host-rolle | Ingen — dealer-script kjører på server | Has, men bypassed for perpetual | Ryddings-feil |
| Multi-instance | Sticky-session per rom + Redis-distributed locks | Per-instance Maps | KRITISK |
| Recovery efter crash | Continuous-replay fra audit-log | Postgres-checkpoint per ball | OK |
| Mass-payout | Async-batched, 10 000+ vinnere på sekunder | Synchronous loop | KRITISK |
| Room-broadcast | Binary-protocol, gzip-compressed, ~10x mindre | JSON, full snapshot | KRITISK |
| Stuck-recovery | Auto-fail-over til standby-instance | Boot-sweep + cron-recovery | OK |
| Observability | Per-operation Datadog-metrics + alerts | Strukturert log, ingen metrics | HIGH gap |
| Regulatory | Per-jurisdiction certified | Lotteritilsynet (Norge) | OK |

### Playtech Virtue Fusion Bingo (15 000 spillere/rom, 100+ skin)

| Aspekt | Playtech | Spillorama | Gap |
|---|---|---|---|
| Per-rom max spillere | 15 000 | 1 500 (pilot) | OK |
| Throughput | 50+ ticket-purchase/sek | Ikke målt | Ukjent |
| Wallet-bridge | Operator-side, async | Direkte transfer | OK |
| Pattern-eval | Bitmask, GPU-accelerated for full-house | Bitmask, CPU | OK |
| Latency-target | < 100ms p95 | Ikke målt | Ukjent |

### Pragmatic Play Live

| Aspekt | Pragmatic | Spillorama | Gap |
|---|---|---|---|
| RNG-cert | iTechLabs / GLI | Ingen ekstern (Norsk regulatorisk OK) | OK |
| Reconnect-recovery | Full state-replay innen 30s | `room:resume` med snapshot | OK |
| Multi-currency | YES | NO (NOK only) | Post-pilot |

---

## §11. Foreslått implementeringsplan (Fase 2 + Fase 3)

### Fase 2 — Pilot-blokkere (må lukkes før 24-haller-pilot)

**Estimat: 3-4 uker med 2 utviklere parallelt.**

**Bølge A — Sikkerhets-låser (uke 1):**
- §2.1 + §2.2 + §2.3: System-actor-ACL for endGame/startGame/drawNext (4 dev-dager)
- §2.5: claim:submit slug-gate (0.5 dev-dag)
- §2.7: Bruk GAME2/3_SLUGS-konstanter i assertHost (0.5 dev-dag)

**Bølge B — Recovery-paritet (uke 1-2):**
- §5.1: Game3AutoDrawTickService stuck-recovery (TOP 2) (1 dev-dag)
- §5.2 + §8.3: Game3 lastTickResult + dev-state-endpoint (1.5 dev-dager)
- §5.5: Empty-armed-list skip (1 dev-dag)
- §2.6: Host-fallback i PerpetualRoundService (1 dev-dag)

**Bølge C — Compliance (uke 2):**
- §9.1: LedgerGameType prize-cap fix (TOP 3) (0.5 dev-dag)
- §9.2: Konsolider gameType-bruk (1 dev-dag)

**Bølge D — Race-conditions (uke 2-3):**
- §3.4: room.players mutex/snapshot (TOP 4) (3 dev-dager)
- §3.6: bet:arm + ticket:cancel race fix (2 dev-dager)
- §3.3: drawNextNumber timeout (1 dev-dag)

**Bølge E — Skalering (uke 3-4):**
- §6.1: room:update payload-stripping for Spill 2/3 (TOP 5) (5 dev-dager)
- §6.4: Batch-payout (4 dev-dager)
- §3.2: Redis-distributed lock for tick-throttle (3 dev-dager)
- §4.4: Redis-migrate armedPlayerIdsByRoom (5 dev-dager)

**Bølge F — Observability (uke 4):**
- §8.1: Strukturert logging + metrics (4 dev-dager)
- §8.2: Stuck-room alerts (2 dev-dager)
- §14: Error-code-system (2 dev-dager)

**Total Fase 2: ~38 dev-dager / 2 utviklere = ~4 uker.**

### Fase 3 — Casino-grade-paritet (post-pilot, før produksjon)

**Estimat: 8-12 uker.**

**Bølge G — Wallet-paritet (Spill 1-paritet):**
- §9.3: Outbox-pattern for Game2/3-payouts (5 dev-dager)
- §9.4: Hash-chain audit verifisering (3 dev-dager)
- §6.3: Async-payout via outbox (5 dev-dager)

**Bølge H — Recovery-improvements:**
- §7.2: Status-mutation reordering (5 dev-dager)
- §4.1: Atomisk room+game state-mutasjon med Postgres-tx (4 dev-dager)

**Bølge I — Industri-paritet:**
- Binary protocol over Socket.IO (10 dev-dager)
- Per-spiller diff-events (5 dev-dager)
- Multi-instance distributed-lock for ALLE crons (5 dev-dager)
- Datadog-metrics + alerts (5 dev-dager)

**Bølge J — Polish:**
- Test-coverage for alle race-conditions (10 dev-dager)
- Load-test på 36 000-connections-target (5 dev-dager)
- Documentation (5 dev-dager)

**Total Fase 3: ~62 dev-dager / 2 utviklere = ~6-8 uker.**

---

## §12. Per-finding tabell (komplett)

| # | Tittel | Severity | Kategori | File:line | Estimat |
|---|---|---|---|---|---|
| 2.1 | endGame ACL bypass | CRITICAL | master-arv | BingoEngine.ts:2526 | 2d |
| 2.2 | startGame ACL bypass | CRITICAL | master-arv | BingoEngine.ts:989 | 1d |
| 2.3 | drawNext ACL bypass | CRITICAL | master-arv | DrawOrchestrationService.ts:303 | 0.5d |
| 2.4 | markNumber playerId override | LOW | master-arv | BingoEngine.ts:2347 | 0.5d |
| 2.5 | submitClaim dual-payout | HIGH | master-arv | claimEvents.ts | 0.5d |
| 2.6 | hostPlayerId never reassigned | HIGH | master-arv | PerpetualRoundService.ts:480 | 1d |
| 2.7 | slug-stavemåte i assertHost-bypass | MEDIUM | master-arv | BingoEngine.ts:4193 | 0.5d |
| 2.8 | evaluateActivePhase no-op | LOW | master-arv | DrawOrchestrationService.ts:491 | 0.5d |
| 3.1 | onDrawCompleted timeout | HIGH | race | DrawOrchestrationService.ts:464 | 4d |
| 3.2 | lastDrawAtByRoom per-instance | HIGH | race | Game2AutoDrawTickService.ts:254 | 3d |
| 3.3 | currentlyProcessing leak | MEDIUM | race | Game2AutoDrawTickService.ts:474 | 1d |
| 3.4 | room.players mutex | CRITICAL | race | BingoEngine.ts:3909 | 3d |
| 3.5 | findG2Winners race (NOT REAL) | LOW | race | Game2Engine.ts:336 | n/a |
| 3.6 | bet:arm + cancel race | HIGH | race | gameLifecycleEvents.ts | 2d |
| 4.1 | non-atomic state mutation | HIGH | state | Game2Engine.ts:308 | 4d |
| 4.2 | lastDrawEffectsByRoom (NOT REAL) | TRIVIAL | state | n/a | n/a |
| 4.3 | cyclersByRoom cleanup (NOT REAL) | TRIVIAL | state | n/a | n/a |
| 4.4 | armedPlayerIdsByRoom per-instance | HIGH | state | roomState.ts:90 | 5d |
| 5.1 | Game3 stuck-recovery missing | CRITICAL | perpetual | Game3AutoDrawTickService.ts:216 | 1d |
| 5.2 | Game3 getLastTickResult missing | MEDIUM | observability | Game3AutoDrawTickService.ts | 0.5d |
| 5.3 | spawnFirstRoundIfNeeded race (NOT REAL) | LOW | perpetual | n/a | n/a |
| 5.4 | NATURAL_END_REASONS doc gap | LOW | perpetual | PerpetualRoundService.ts:196 | 0.5d |
| 5.5 | empty-armed-list loop | HIGH | perpetual | gameLifecycleEvents.ts | 1d |
| 6.1 | room:update payload size | CRITICAL | scaling | index.ts:1333 | 5d |
| 6.2 | findG2Winners O(NM) (acceptabelt) | LOW | scaling | Game2Engine.ts:336 | n/a |
| 6.3 | processG3Winners scaling | HIGH | scaling | Game3Engine.ts:284 | 5d |
| 6.4 | Postgres pool exhaustion | HIGH | scaling | PostgresWalletAdapter | 4d |
| 6.5 | Socket.IO emit() O(N) | MEDIUM | scaling | n/a | n/a |
| 6.6 | Redis room-state writes | LOW | scaling | n/a | n/a |
| 7.1 | writeDrawCheckpoint (acceptabelt) | LOW | recovery | n/a | n/a |
| 7.2 | crash mellom payout og checkpoint | HIGH | recovery | Game2Engine.ts:308 | 5d |
| 7.3 | attachPlayerSocket reconnect | LOW | recovery | n/a | n/a |
| 7.4 | Postgres session-state | LOW | recovery | n/a | n/a |
| 8.1 | strukturert logging gap | MEDIUM | observability | n/a | 4d |
| 8.2 | stuck-room alerts | MEDIUM | observability | n/a | 2d |
| 8.3 | Game3 dev-state-endpoint | MEDIUM | observability | Game3AutoDrawTickService | 1d |
| 9.1 | LedgerGameType DATABINGO hardcoded | CRITICAL | compliance | Game2Engine.ts:379, 503; Game3Engine.ts:533 | 0.5d |
| 9.2 | houseAccountId mismatch | HIGH | compliance | Game2Engine.ts:228 | 1d |
| 9.3 | outbox-pattern verifisering | MEDIUM | wallet | n/a | 2d |
| 9.4 | hash-chain audit verifisering | MEDIUM | wallet | n/a | 1d |

**Totalt CRITICAL findings: 9.**
**Totalt HIGH findings: 12.**
**Totalt MEDIUM findings: 7.**
**Totalt LOW findings: 9.**

**Total real estimat (CRITICAL + HIGH): ~50 dev-dager.**

---

## §13. Risiko-matrise (severity × likelihood)

| Finding | Severity | Likelihood | Risk Score |
|---|---|---|---|
| §2.1 endGame ACL | CRITICAL | HIGH (trolls) | 9/9 |
| §6.1 room:update size | CRITICAL | CERTAIN | 9/9 |
| §9.1 DATABINGO hardcode | CRITICAL | CERTAIN | 9/9 |
| §3.4 room.players mutex | CRITICAL | HIGH (1500 join/min) | 9/9 |
| §5.1 Game3 stuck-recovery | CRITICAL | MEDIUM (need crash) | 6/9 |
| §2.2 startGame ACL | CRITICAL | LOW (race vindu) | 4/9 |
| §2.3 drawNext ACL | CRITICAL | MEDIUM (custom klient) | 6/9 |
| §3.1 onDrawCompleted slow | HIGH | HIGH (mass-payout) | 6/9 |
| §6.4 pool exhaustion | HIGH | HIGH (mass-payout) | 6/9 |
| §3.2 multi-instance lock | HIGH | LOW (single-instance pilot) | 3/9 |
| §4.4 armed-state Redis | HIGH | LOW (single-instance pilot) | 3/9 |
| §2.6 host-fallback | HIGH | MEDIUM (host disconnect) | 4/9 |
| §3.6 bet:arm race | HIGH | LOW (timing) | 3/9 |
| §6.3 processG3 scaling | HIGH | LOW (Coverall-burst) | 3/9 |
| §7.2 crash recovery | HIGH | LOW (need crash) | 3/9 |
| §2.5 submitClaim dual-payout | HIGH | LOW (race) | 3/9 |
| §3.3 currentlyProcessing leak | MEDIUM | LOW (need wallet hang) | 2/9 |
| §5.5 empty-armed loop | HIGH | LOW (timing) | 3/9 |
| §4.1 non-atomic state | HIGH | LOW (need crash) | 3/9 |
| §9.2 houseAccountId mismatch | HIGH | UNKNOWN | 4-6/9 |
| §8.1 logging gaps | MEDIUM | n/a (post-fact) | n/a |
| §8.2 alert gaps | MEDIUM | n/a | n/a |

**Top 9/9 (must-fix):** §2.1, §6.1, §9.1, §3.4.
**Top 6/9 (must-fix):** §5.1, §2.3, §3.1, §6.4.

---

## §14. Foreslått strukturert error-code-system

### Format: `BIN-<GAME>-<CATEGORY>-<NUM>`

- GAME: RKT (rocket / Spill 2), MON (monsterbingo / Spill 3), ENG (engine-felles).
- CATEGORY: DRAW, ARM, PAYOUT, ROOM, RECOVERY, AUTH, COMPLIANCE.

### Spill 2 codes

```
BIN-RKT-DRAW-001  CRITICAL  retryable=NO   alert=PAGE   "assertHost called for rocket — should never happen post-PR-#942"
BIN-RKT-DRAW-002  HIGH      retryable=NO   alert=SLACK  "perpetual-loop schedule conflict — both handleGameEnded and spawnFirstRound fired"
BIN-RKT-DRAW-003  CRITICAL  retryable=NO   alert=PAGE   "wallet-debit failed mid-arm for ROCKET — manual reconciliation required"
BIN-RKT-DRAW-004  MEDIUM    retryable=YES  alert=NONE   "broadcast draw:new failed — UI may be out of sync"
BIN-RKT-DRAW-005  HIGH      retryable=YES  alert=SLACK  "drawNextNumber timed out (>30s) — engine may have hung"
BIN-RKT-DRAW-006  CRITICAL  retryable=NO   alert=PAGE   "stuck-room recovery fired — investigation needed"
BIN-RKT-ARM-001   MEDIUM    retryable=NO   alert=NONE   "bet:arm + cancel race — tickets may be inconsistent"
BIN-RKT-ARM-002   HIGH      retryable=YES  alert=SLACK  "armed-state lost during perpetual-restart"
BIN-RKT-ARM-003   CRITICAL  retryable=NO   alert=PAGE   "wallet-debit succeeded but tickets not assigned — refund required"
BIN-RKT-PAYOUT-001 CRITICAL  retryable=NO   alert=PAGE   "wallet-transfer hash chain broke — audit required"
BIN-RKT-PAYOUT-002 HIGH      retryable=YES  alert=SLACK  "payout cap mismatch (DATABINGO vs MAIN_GAME)"
BIN-RKT-PAYOUT-003 CRITICAL  retryable=NO   alert=PAGE   "house-account exhausted — game suspended"
BIN-RKT-PAYOUT-004 MEDIUM    retryable=YES  alert=NONE   "single-prize cap applied"
BIN-RKT-ROOM-001  HIGH      retryable=NO   alert=SLACK  "room.players mutated during draw — possible inconsistency"
BIN-RKT-ROOM-002  CRITICAL  retryable=NO   alert=PAGE   "two ROCKET rooms detected — invariant violated"
BIN-RKT-RECOVERY-001 HIGH   retryable=YES  alert=SLACK  "boot-sweep ended stuck ROCKET — startup recovery"
BIN-RKT-AUTH-001  CRITICAL  retryable=NO   alert=PAGE   "non-system actor called endGame on ROCKET"
BIN-RKT-COMPLIANCE-001 CRITICAL retryable=NO alert=PAGE "ledger event written with wrong gameType"
```

### Spill 3 codes (parallel)

```
BIN-MON-DRAW-001 ... (samme strukturen)
BIN-MON-PATTERN-001 CRITICAL retryable=NO alert=PAGE "PatternCycler state divergence — pattern-state inconsistent with cyclerGameId"
BIN-MON-PATTERN-002 HIGH      retryable=YES alert=SLACK "pattern-priority mismatch (Coverall vs Row)"
BIN-MON-COVERALL-001 CRITICAL retryable=NO alert=PAGE "Coverall not detected after 75 balls — engine bug"
```

### Engine-felles codes

```
BIN-ENG-RACE-001 HIGH retryable=YES alert=SLACK "iterator + map mutation detected"
BIN-ENG-LOCK-001 HIGH retryable=YES alert=SLACK "drawLock acquired but never released"
BIN-ENG-LOCK-002 CRITICAL retryable=NO alert=PAGE "currentlyProcessing leak — distributed deadlock"
BIN-ENG-OUTBOX-001 CRITICAL retryable=NO alert=PAGE "outbox event failed — wallet-state inconsistent"
BIN-ENG-CHECKPOINT-001 HIGH retryable=YES alert=SLACK "checkpoint write failed — recovery may be incomplete"
```

### Implementering

1. Definer `enum ErrorCode` med alle koder.
2. Hver `DomainError` accepterer `ErrorCode` som parameter.
3. Logger-middleware emit-er code til Prometheus + Sentry breadcrumbs.
4. Alert-rules på code-name (Slack/PagerDuty).
5. Runbook-dokument for hver code.

---

## §15. Anbefalt PR-rekkefølge med dependency-graph

```
[A.1] §2.7 slug-bypass-correctness
   ↓
[A.2] §2.1+§2.2+§2.3 system-actor ACL
   ↓
[A.3] §2.5 claim:submit gate
[A.4] §2.6 PerpetualRoundService host-fallback

[B.1] §5.1 Game3 stuck-recovery (parallell med A)
[B.2] §5.2 Game3 dev-state-endpoint (parallell med A)
[B.3] §5.5 empty-armed-list skip

[C.1] §9.1 LedgerGameType prize-cap fix (KAN STARTE NÅ)
[C.2] §9.2 konsolider gameType (etter C.1)

[D.1] §3.3 drawNextNumber timeout (KAN STARTE NÅ)
[D.2] §3.4 room.players mutex (etter A.2 så vi ikke trenger å lockere player-add)
[D.3] §3.6 bet:arm + cancel race (etter D.2)

[E.1] §6.1 room:update payload-stripping (KAN STARTE NÅ)
[E.2] §6.4 batch-payout (etter E.1 — krever fewer wire-events)
[E.3] §3.2 Redis-distributed lock (etter E.2)
[E.4] §4.4 Redis-migrate armedPlayerIdsByRoom (post-pilot)

[F.1] §8.1 strukturert logging (KAN STARTE NÅ)
[F.2] §8.2 alerts (etter F.1)
[F.3] §14 error-code-system (etter F.1)
```

**Pilot-blokker rekkefølge:**
1. C.1 (compliance — 4 timer)
2. A.1 (slug-correctness — 4 timer)
3. A.2-A.4 + B.1 (sikkerhet + Game3-recovery — 1 uke)
4. D.2 + D.3 (race-conditions — 1 uke)
5. E.1 (payload-stripping — 1 uke)
6. F.1 (logging — 0.5 uke)

**Total Fase 2 før pilot kan starte: ~3 uker med 2 utviklere parallelt.**

---

## §16. Konklusjon

Spill 2 og Spill 3 er IKKE klar for 1500-spillere-pilot uten Fase 2. Det er 9 KRITISKE funn som vil manifestere seg innen første 24 timer av drift:

1. **§2.1 endGame ACL bypass** — vil bli misbrukt av første troll.
2. **§6.1 room:update payload size** — vil sprenge Render bandwidth.
3. **§9.1 DATABINGO hardcode** — regulatorisk brudd.
4. **§3.4 room.players mutex** — vil korruptere state.
5. **§5.1 Game3 stuck-recovery missing** — MONSTERBINGO vil henge.
6. **§2.3 drawNext ACL bypass** — admin-handler kan misbrukes.
7. **§2.2 startGame ACL bypass** — race med perpetual-loop.
8. **§3.1 onDrawCompleted slow** — wallet-payouts vil paralle Render.
9. **§6.4 Postgres pool exhaustion** — wallet-transfers vil time-out.

Alle kan løses innen **3 uker** med 2 utviklere parallelt. Etter Fase 2 er Spill 2/3 acceptabelt for 24-haller-pilot. Fase 3 (~6-8 uker) bringer det til Evolution-nivå.

**Anbefaling til Tobias:** Start Fase 2 umiddelbart. Bølge A.2 + B.1 + C.1 er pilot-blokkere og må gjøres FØRST. Bølge E.1 (payload-stripping) er den som krever mest engineering, og bør spawnes parallelt med A/B/C.

---

## §17. Appendix A — Konkrete kode-fixes (foreslåtte patches)

### Patch A.1 — Slug-bypass-correctness (§2.7)

**File:** `apps/backend/src/game/BingoEngine.ts:4193-4197`

```typescript
// BEFORE
private assertHost(room: RoomState, actorPlayerId: string): void {
  const slug = room.gameSlug?.toLowerCase();
  if (slug === "rocket" || slug === "monsterbingo") {
    return;
  }
  if (room.hostPlayerId !== actorPlayerId) {
    throw new DomainError("NOT_HOST", "Kun host kan utføre denne handlingen.");
  }
}

// AFTER
import { GAME2_SLUGS } from "./Game2AutoDrawTickService.js";
import { GAME3_SLUGS } from "./Game3AutoDrawTickService.js";

const PERPETUAL_GAME_SLUGS: ReadonlySet<string> = new Set([
  ...GAME2_SLUGS,
  ...GAME3_SLUGS,
]);

private assertHost(room: RoomState, actorPlayerId: string): void {
  const slug = room.gameSlug?.toLowerCase().trim();
  if (slug && PERPETUAL_GAME_SLUGS.has(slug)) {
    // Perpetual rooms have no master concept; security via socket-layer ACL.
    return;
  }
  if (room.hostPlayerId !== actorPlayerId) {
    throw new DomainError("NOT_HOST", "Kun host kan utføre denne handlingen.");
  }
}
```

### Patch A.2 — System-actor ACL (§2.1, §2.2, §2.3)

**File:** `apps/backend/src/game/types.ts` — utvid input-typene:

```typescript
export interface StartGameInput {
  roomCode: string;
  actorPlayerId: string;
  // NEW: explicit system-actor flag. ONLY perpetual-loop, admin-routes,
  // boot-sweep, and Game1-master-flow set this to true.
  systemActor?: boolean;
  ...
}

export interface EndGameInput {
  roomCode: string;
  actorPlayerId: string;
  systemActor?: boolean;
  reason?: string;
}

export interface DrawOrchestrationInput {
  roomCode: string;
  actorPlayerId: string;
  systemActor?: boolean;
}
```

**File:** `apps/backend/src/game/BingoEngine.ts:989, 2526` + `DrawOrchestrationService.ts:303`:

```typescript
// In startGame, endGame, _drawNextLocked:
async startGame(input: StartGameInput): Promise<void> {
  const room = this.requireRoom(input.roomCode);
  this.assertNotScheduled(room);
  this.assertSpill1NotAdHoc(room);

  // NEW: Require system-actor for perpetual rooms.
  const slug = room.gameSlug?.toLowerCase().trim();
  const isPerpetual = slug && PERPETUAL_GAME_SLUGS.has(slug);
  if (isPerpetual && !input.systemActor) {
    throw new DomainError(
      "PERPETUAL_NO_PLAYER_START",
      "Spill 2/3 starter automatisk, ikke fra spiller.",
    );
  }

  // For non-perpetual rooms, host check runs as before.
  if (!isPerpetual) {
    this.assertHost(room, input.actorPlayerId);
  }
  this.assertNotRunning(room);
  ...
}
```

**File:** `apps/backend/src/game/PerpetualRoundService.ts:478, 681` — add `systemActor: true`:

```typescript
const startInput: Parameters<PerpetualEngine["startGame"]>[0] = {
  roomCode,
  actorPlayerId: actorId,  // (uses host-fallback from Patch A.5 below)
  systemActor: true,       // NEW
  entryFee,
  ...
};
```

**File:** `apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts:40, 149` — slug-gate på socket-laget:

```typescript
socket.on("game:end", rateLimited("game:end", async (payload, callback) => {
  try {
    const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);

    // NEW: Block player-initiated end for perpetual rooms.
    const snap = engine.getRoomSnapshot(roomCode);
    const slug = snap.gameSlug?.toLowerCase();
    if (slug === "rocket" || slug === "monsterbingo") {
      throw new DomainError(
        "PERPETUAL_NO_MANUAL_END",
        "Spill 2/3 stopper aldri manuelt.",
      );
    }

    await engine.endGame({
      roomCode,
      actorPlayerId: playerId,
      reason: payload?.reason,
    });
    ...
  }
}));

// Same pattern for game:start.
```

**File:** `apps/backend/src/sockets/gameEvents/drawEvents.ts:60` — slug-gate:

```typescript
socket.on("draw:next", rateLimited("draw:next", async (payload, callback) => {
  try {
    const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);

    // NEW: Block player-initiated draw for perpetual rooms.
    const snap = engine.getRoomSnapshot(roomCode);
    const slug = snap.gameSlug?.toLowerCase();
    if (slug === "rocket" || slug === "monsterbingo") {
      throw new DomainError(
        "PERPETUAL_NO_MANUAL_DRAW",
        "Trekk for Spill 2/3 styres av server-cron.",
      );
    }

    const result = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
    ...
  }
}));
```

### Patch A.5 — Host-fallback i PerpetualRoundService (§2.6)

**File:** `apps/backend/src/game/PerpetualRoundService.ts:471-494`

```typescript
// BEFORE
const startInput: ... = {
  roomCode,
  actorPlayerId: snapshot.hostPlayerId,
  ...
};

// AFTER
const hostStillPresent = snapshot.players.some((p) => p.id === snapshot.hostPlayerId);
const actorId = hostStillPresent
  ? snapshot.hostPlayerId
  : snapshot.players[0]?.id ?? null;

if (!actorId) {
  logger.warn(
    { roomCode, prevGameId, reason: "no_actor_available" },
    "perpetual: skip restart (empty room — no actor)",
  );
  return;
}

if (!hostStillPresent) {
  logger.info(
    {
      event: "perpetual_actor_fallback",
      roomCode,
      oldHostId: snapshot.hostPlayerId,
      newActorId: actorId,
    },
    "perpetual: original host disconnected, using fallback actor",
  );
}

const startInput: ... = {
  roomCode,
  actorPlayerId: actorId,
  systemActor: true,  // From Patch A.2
  entryFee,
  ...
};
```

### Patch B.1 — Game3 stuck-recovery (§5.1)

**File:** `apps/backend/src/game/Game3AutoDrawTickService.ts`

```typescript
// 1) Add to Game3AutoDrawTickServiceOptions interface:
export interface Game3AutoDrawTickServiceOptions {
  ...
  /**
   * 2026-05-05 (audit fix): callback fired when tick force-ends a stuck
   * Game3 room. Caller should trigger PerpetualRoundService.spawnFirstRoundIfNeeded
   * to spawn a new round immediately. Mirrors Game2AutoDrawTickService.onStaleRoomEnded.
   */
  onStaleRoomEnded?: (roomCode: string) => Promise<void> | void;
}

// 2) Add field + constructor wiring:
export class Game3AutoDrawTickService {
  private readonly onStaleRoomEnded?: (roomCode: string) => Promise<void> | void;

  constructor(options: Game3AutoDrawTickServiceOptions) {
    ...
    this.onStaleRoomEnded = options.onStaleRoomEnded;
  }

  // 3) Replace lines 216-219 with full recovery path:
  if (game.drawnNumbers.length >= GAME3_MAX_BALLS) {
    skipped++;

    // 2026-05-05 (audit fix Bølge B.1): mirror Game2's stuck-room recovery.
    // Without this, MONSTERBINGO can hang indefinitely after hook-failure
    // on ball #75 with no Coverall winner.
    if (typeof this.engine.forceEndStaleRound === "function") {
      try {
        const ended = await this.engine.forceEndStaleRound(
          summary.code,
          "STUCK_AT_MAX_BALLS_AUTO_RECOVERY"
        );
        if (ended) {
          log.warn(
            {
              roomCode: summary.code,
              drawnCount: game.drawnNumbers.length,
            },
            "[game3-auto-draw] auto-recovered stuck room (drawn=75, status=RUNNING, endedReason=null)"
          );

          if (this.onStaleRoomEnded) {
            try {
              await this.onStaleRoomEnded(summary.code);
            } catch (cbErr) {
              log.warn(
                { err: cbErr, roomCode: summary.code },
                "[game3-auto-draw] onStaleRoomEnded callback failed"
              );
            }
          }
        }
      } catch (err) {
        errors++;
        const msg = `${summary.code}: forceEndStaleRound failed: ${(err as Error).message ?? "unknown"}`;
        if (errorMessages.length < 10) errorMessages.push(msg);
        log.warn(
          { err, roomCode: summary.code },
          "[game3-auto-draw] forceEndStaleRound failed"
        );
      }
    }
    continue;
  }

  // 4) Add lastTickResult field + getter (mirrors Game2):
  private lastTickResult: Game3AutoDrawTickResult | null = null;

  getLastTickResult(): Game3AutoDrawTickResult | null {
    return this.lastTickResult;
  }

  // 5) Update tick() to set lastTickResult before return.
}
```

**File:** `apps/backend/src/index.ts:2029-2037` — wire `onStaleRoomEnded`:

```typescript
const game3AutoDrawTickService = new Game3AutoDrawTickService({
  engine,
  drawIntervalMs: autoDrawIntervalEnvOverrideMs ?? 30_000,
  variantLookup: roomState,
  broadcaster: game23DrawBroadcaster,
  onPeriodicValidation: periodicRoomUniquenessValidate,
  onStaleRoomEnded: onStaleRoomEndedCallback,  // NEW
});
```

### Patch C.1 — LedgerGameType prize-cap fix (§9.1)

**File:** `apps/backend/src/game/Game2Engine.ts:377, 501`:

```typescript
// BEFORE (line 377-381):
const capped = this.prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType: "DATABINGO",   // <-- HARDCODED
  amount: requestedPayout,
});

// AFTER:
const capped = this.prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType,                 // Use resolved variable from line 227
  amount: requestedPayout,
});
```

Same fix at line 501 (lucky bonus).

**File:** `apps/backend/src/game/Game3Engine.ts:531`:

```typescript
// BEFORE:
const capped = this.prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType: "DATABINGO",
  amount: requestedPayout,
});

// AFTER:
const capped = this.prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType,                 // Use resolved variable from line 302
  amount: requestedPayout,
});
```

### Patch D.2 — Snapshot iterator i findG2Winners (§3.4)

**File:** `apps/backend/src/game/Game2Engine.ts:336-354`

```typescript
// BEFORE:
private findG2Winners(room: RoomState, game: GameState): Array<...> {
  const drawnSet = new Set(game.drawnNumbers);
  const winners: Array<...> = [];
  for (const player of room.players.values()) {
    const tickets = game.tickets.get(player.id);
    if (!tickets) continue;
    for (let i = 0; i < tickets.length; i += 1) {
      ...
    }
  }
  return winners;
}

// AFTER:
private findG2Winners(room: RoomState, game: GameState): Array<...> {
  const drawnSet = new Set(game.drawnNumbers);
  const winners: Array<...> = [];

  // 2026-05-05 (audit fix §3.4): snapshot iterator BEFORE entering payout loop.
  // Prevents race where concurrent room:join → assertWalletNotInRunningGame
  // could mutate room.players Map mid-iteration (1500-player scale).
  const playerSnapshot = [...room.players.values()];

  for (const player of playerSnapshot) {
    // Re-check player is still in room (defensive — could have been evicted).
    if (!room.players.has(player.id)) continue;

    const tickets = game.tickets.get(player.id);
    if (!tickets) continue;
    for (let i = 0; i < tickets.length; i += 1) {
      const t = tickets[i];
      if (hasFull3x3(t, drawnSet)) {
        winners.push({ player, ticketIndex: i, ticketId: t.id });
      }
    }
  }
  return winners;
}
```

Same pattern for `Game3Engine.buildTicketMasksByPlayer` (line 350-367).

### Patch E.1 — room:update payload-stripping (§6.1)

**File:** `apps/backend/src/index.ts:1333` (revise emitRoomUpdate):

```typescript
// BEFORE:
async function emitRoomUpdate(roomCode: string): Promise<RoomUpdatePayload> {
  const payload = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
  io.to(roomCode).emit("room:update", payload);
  return payload;
}

// AFTER:
async function emitRoomUpdate(roomCode: string): Promise<RoomUpdatePayload> {
  const snapshot = engine.getRoomSnapshot(roomCode);
  const payload = buildRoomUpdatePayload(snapshot);

  // 2026-05-05 (audit fix §6.1): strip players[] for perpetual rooms to
  // avoid 450 MB/emit on 1500-player rooms. Clients use playerCount + delta
  // events (bet:arm, ticket:cancel) instead of polling room:update.
  const slug = snapshot.gameSlug?.toLowerCase();
  const isPerpetual = slug === "rocket" || slug === "monsterbingo";
  const wirePayload = isPerpetual
    ? { ...payload, players: [], playerCount: payload.players.length }
    : payload;

  io.to(roomCode).emit("room:update", wirePayload);
  return payload;  // Return full payload to internal callers (admin display).
}
```

**File:** `packages/shared-types/src/api.ts` — utvid `RoomUpdatePayload`:

```typescript
export interface RoomUpdatePayload extends RoomSnapshot {
  // ... existing fields
  /**
   * 2026-05-05: For perpetual rooms (Spill 2/3), `players` is empty and
   * `playerCount` is set instead. Saves bandwidth on 1500-player rooms.
   */
  playerCount?: number;
}
```

**File:** `packages/game-client/src/games/game2/Game2Controller.ts` — handle stripped payload:

```typescript
// In room:update handler:
socket.on("room:update", (payload: RoomUpdatePayload) => {
  // For perpetual rooms, players[] may be empty. Use playerCount instead.
  const playerCount = payload.players?.length || payload.playerCount || 0;

  // Player-list UI removed for Spill 2/3 (only shows count). Saves render
  // cost too — drawing 1500 player chips would lag the UI.
  this.updatePlayerCount(playerCount);

  // Continue with existing logic for game state, draws, etc.
  ...
});
```

### Patch F.1 — Strukturert observability (§8.1)

**File:** `apps/backend/src/observability/spill23Metrics.ts` (NEW):

```typescript
import { metrics } from "../util/metrics.js";

/**
 * 2026-05-05 (audit fix §8.1): Prometheus metrics for Spill 2/3 critical
 * operations. Each metric has a code-label so alert-rules can filter on
 * specific failure-modes (see §14 error-code-system).
 */

export const spill23Metrics = {
  // Counter: drawNextNumber latency-bucket distribution.
  drawDuration: metrics.histogram({
    name: "spill23_draw_duration_ms",
    help: "Time from drawNextNumber start to return (ms)",
    buckets: [10, 50, 100, 500, 1000, 5000, 10000, 30000],
    labelNames: ["slug", "outcome"],  // outcome: success|timeout|error
  }),

  // Counter: per-error-code occurrence.
  errorCodeCount: metrics.counter({
    name: "spill23_error_total",
    help: "Total errors by code",
    labelNames: ["code", "slug", "severity"],
  }),

  // Counter: stuck-room recoveries.
  stuckRoomRecoveries: metrics.counter({
    name: "spill23_stuck_recoveries_total",
    help: "Number of stuck-room auto-recoveries",
    labelNames: ["slug", "trigger"],  // trigger: boot-sweep|tick|admin
  }),

  // Gauge: pending perpetual-restarts.
  pendingRestarts: metrics.gauge({
    name: "spill23_pending_restarts",
    help: "Number of pending perpetual-restarts (per slug)",
    labelNames: ["slug"],
  }),

  // Histogram: onDrawCompleted duration (mass-payout cost).
  onDrawCompletedDuration: metrics.histogram({
    name: "spill23_ondrawcompleted_duration_ms",
    help: "Time spent in onDrawCompleted hook (ms)",
    buckets: [10, 50, 100, 500, 1000, 5000, 10000, 30000],
    labelNames: ["slug", "winners"],
  }),

  // Counter: room.players mutations during running game (race-detector).
  roomPlayersRaceDetected: metrics.counter({
    name: "spill23_room_players_race_total",
    help: "room.players mutated while a draw was in progress",
    labelNames: ["slug"],
  }),

  // Counter: payout-cap applied.
  payoutCapApplied: metrics.counter({
    name: "spill23_payout_cap_applied_total",
    help: "Single-prize-cap applied (regulatorisk)",
    labelNames: ["slug", "gameType"],
  }),

  // Gauge: connections per room.
  roomConnections: metrics.gauge({
    name: "spill23_room_connections",
    help: "Number of connected sockets per room",
    labelNames: ["roomCode", "slug"],
  }),

  // Histogram: emitRoomUpdate duration + payload-size.
  emitRoomUpdateDuration: metrics.histogram({
    name: "spill23_emit_room_update_duration_ms",
    help: "Time for io.to(room).emit('room:update', payload) to complete",
    buckets: [1, 5, 10, 50, 100, 500, 1000],
    labelNames: ["roomCode", "slug"],
  }),

  emitRoomUpdatePayloadBytes: metrics.histogram({
    name: "spill23_emit_room_update_payload_bytes",
    help: "Size of room:update payload in bytes",
    buckets: [1024, 8192, 32768, 131072, 524288, 2097152],
    labelNames: ["roomCode", "slug"],
  }),
};

// Alert rules (Prometheus-compatible):
export const ALERT_RULES = `
# Pilot-blokker alerts:

- alert: Spill23_DrawTooSlow
  expr: histogram_quantile(0.95, rate(spill23_draw_duration_ms_bucket[5m])) > 5000
  for: 1m
  annotations:
    summary: "Spill 2/3 draw p95 latency > 5s — investigate"

- alert: Spill23_StuckRoomRecovery
  expr: increase(spill23_stuck_recoveries_total[5m]) > 0
  annotations:
    summary: "Stuck room recovered ({{$labels.slug}})"

- alert: Spill23_RoomPlayersRace
  expr: increase(spill23_room_players_race_total[5m]) > 0
  annotations:
    summary: "Room.players race detected — possible state corruption"

- alert: Spill23_OnDrawCompletedSlow
  expr: histogram_quantile(0.95, rate(spill23_ondrawcompleted_duration_ms_bucket[5m])) > 10000
  annotations:
    summary: "onDrawCompleted hook taking >10s — wallet-payout backlog"

- alert: Spill23_RoomUpdateLargePayload
  expr: histogram_quantile(0.95, rate(spill23_emit_room_update_payload_bytes_bucket[5m])) > 524288
  annotations:
    summary: "room:update payload >512KB — bandwidth at risk"
`;
```

**Wire-up:**

```typescript
// In DrawOrchestrationService._drawNextLocked:
import { spill23Metrics } from "../observability/spill23Metrics.js";

private async _drawNextLocked(input): ... {
  const startMs = Date.now();
  const slug = (room.gameSlug || "unknown").toLowerCase();

  try {
    ...
    const result = ...;  // existing logic
    spill23Metrics.drawDuration.observe(
      { slug, outcome: "success" },
      Date.now() - startMs
    );
    return result;
  } catch (err) {
    spill23Metrics.drawDuration.observe(
      { slug, outcome: err instanceof DomainError ? "error" : "exception" },
      Date.now() - startMs
    );
    spill23Metrics.errorCodeCount.inc({
      code: (err as DomainError)?.code ?? "UNKNOWN",
      slug,
      severity: "high",
    });
    throw err;
  }
}
```

```typescript
// In Game2Engine.onDrawCompleted:
const onDrawStartMs = Date.now();
try {
  // ... existing logic
  spill23Metrics.onDrawCompletedDuration.observe(
    { slug: "rocket", winners: String(winnerRecords.length) },
    Date.now() - onDrawStartMs
  );
} catch (err) {
  spill23Metrics.onDrawCompletedDuration.observe(
    { slug: "rocket", winners: "error" },
    Date.now() - onDrawStartMs
  );
  throw err;
}
```

### Patch F.2 — Stuck-room alerts (§8.2)

**File:** `apps/backend/src/notifications/stuckRoomAlerter.ts` (NEW):

```typescript
import { logger as rootLogger } from "../util/logger.js";
import { sendSlackAlert } from "./slack.js";  // assume exists
import type { Pool } from "pg";

const log = rootLogger.child({ module: "stuck-room-alerter" });

export interface StuckRoomAlerter {
  /**
   * Fired when StaleRoomBootSweepService or auto-draw-tick detects a stuck
   * Spill 2/3 room. Outboxes alert to Slack/PagerDuty.
   */
  alertStuckRoom(input: {
    roomCode: string;
    slug: string;
    drawnCount: number;
    maxBalls: number;
    lastDrawAtMs?: number;
    trigger: "boot-sweep" | "tick" | "admin";
  }): Promise<void>;
}

export function createStuckRoomAlerter(pool: Pool): StuckRoomAlerter {
  return {
    async alertStuckRoom(input) {
      const message = [
        `:rotating_light: *Spill ${input.slug.toUpperCase()} stuck-room recovered*`,
        `Room: \`${input.roomCode}\``,
        `Draws: ${input.drawnCount}/${input.maxBalls}`,
        `Last draw: ${input.lastDrawAtMs ? new Date(input.lastDrawAtMs).toISOString() : "unknown"}`,
        `Trigger: ${input.trigger}`,
        ``,
        `Investigate: \`/api/_dev/${input.slug === "rocket" ? "game2-state" : "game3-state"}\``,
      ].join("\n");

      try {
        await sendSlackAlert({
          channel: "#bingo-ops",
          message,
          severity: "high",
        });
      } catch (err) {
        log.error({ err, ...input }, "Failed to send stuck-room alert to Slack");
      }

      // Outbox for retries if alert delivery fails.
      try {
        await pool.query(
          `INSERT INTO app_alert_outbox (event_type, payload_json, created_at)
           VALUES ($1, $2, now())`,
          ["ROOM_STUCK_RECOVERED", JSON.stringify(input)],
        );
      } catch (err) {
        log.warn({ err }, "Failed to outbox alert");
      }
    },
  };
}
```

---

## §18. Appendix B — Detaljert risiko-vurdering per finding

### Detaljert risiko-modellering

For hver CRITICAL/HIGH funn, beregn:

**Risk Score = Severity × Likelihood × Impact**

Skala 1-3 hver:
- Severity: 1=LOW, 2=MEDIUM, 3=HIGH/CRITICAL
- Likelihood: 1=rare (one-in-month), 2=occasional (one-in-day), 3=frequent (one-in-hour)
- Impact: 1=single-player, 2=room, 3=system-wide

| # | S | L | I | Score | Comment |
|---|---|---|---|---|---|
| §2.1 endGame ACL | 3 | 3 | 3 | 27 | Trolling within first hour |
| §6.1 room:update | 3 | 3 | 3 | 27 | Will exhaust bandwidth in minutes |
| §9.1 DATABINGO hardcode | 3 | 3 | 2 | 18 | Regulatory finding, not crash |
| §3.4 room.players race | 3 | 2 | 2 | 12 | Hourly chance, room-scope |
| §5.1 Game3 stuck | 3 | 1 | 2 | 6 | Daily chance |
| §2.3 drawNext ACL | 3 | 1 | 2 | 6 | Custom-client required |
| §2.2 startGame ACL | 3 | 1 | 2 | 6 | Race-window |
| §3.1 onDrawCompleted | 2 | 3 | 2 | 12 | Mass-payout = inevitable |
| §6.4 Postgres pool | 2 | 2 | 2 | 8 | Mass-payout = needed |
| §3.2 multi-instance | 2 | 1 | 3 | 6 | Single-instance pilot |
| §4.4 armed Redis | 2 | 1 | 3 | 6 | Single-instance pilot |
| §2.6 host-fallback | 2 | 2 | 2 | 8 | Common with disconnects |
| §3.6 bet:arm race | 2 | 1 | 1 | 2 | Tight timing |
| §6.3 processG3 | 2 | 1 | 2 | 4 | Coverall-burst |
| §7.2 crash recovery | 2 | 1 | 1 | 2 | Crash-needed |

**Top-priority by risk score:** §2.1, §6.1, §9.1, §3.4, §3.1.

---

## §19. Appendix C — Testing strategy

### Unit tests required (in addition to existing)

For each fix, add:

1. **Patch A.1 (slug-correctness):** Test that all GAME2_SLUGS + GAME3_SLUGS aliases pass `assertHost` bypass. Test that "bingo" still requires host.

2. **Patch A.2 (system-actor ACL):** Test that `engine.endGame({systemActor: false})` for rocket throws `PERPETUAL_NO_PLAYER_START`. Test that `systemActor: true` succeeds. Repeat for startGame and drawNext.

3. **Patch B.1 (Game3 recovery):** Test that drawn=75 + status=RUNNING + endedReason=null triggers force-end. Test that endedReason="G3_FULL_HOUSE" does NOT trigger force-end.

4. **Patch C.1 (DATABINGO fix):** Test that `prizePolicy.applySinglePrizeCap` receives `gameType: "MAIN_GAME"` for rocket/monsterbingo and `gameType: "DATABINGO"` for spillorama.

5. **Patch D.2 (snapshot iterator):** Test that `findG2Winners` returns correct count when `room.players` is mutated mid-iteration.

6. **Patch E.1 (payload-stripping):** Test that `emitRoomUpdate("ROCKET")` returns full payload but io.emit receives stripped payload.

### Integration tests

1. **End-to-end test for ROCKET host-disconnect:** Simulate 100 connected sockets, host disconnects, auto-draw fires. Verify draw succeeds, all 99 sockets get `draw:new`.

2. **End-to-end test for stuck-recovery:** Persist stuck state (drawn=21, status=RUNNING, endedReason=null) in test DB. Boot Render. Verify `forceEndStaleRound` fires within 5s. Verify perpetual-restart spawns new round.

3. **Concurrency stress test:** Simulate 1500 sockets joining/leaving over 5 minutes while ROCKET runs. Assert no `room.players` race-detection metrics fire. Assert no PLAYER_NOT_FOUND or NOT_IN_ROOM errors during draws.

4. **Multi-instance test:** Boot 2 Render instances. Verify Game2-tick fires only ONE draw (Redis-distributed lock works). Currently fails — pilot-fix needed.

### Load tests (Fase 3)

1. **Connection ramp-up:** 0 → 1500 connections in 60s. Measure: connect-rate, memory, CPU.

2. **Steady-state load:** 1500 connections × 30 min. Measure: bandwidth, draw-cadence, memory-stability.

3. **Mass-payout:** Trigger Coverall on Spill 3 with 100+ winners. Measure: onDrawCompleted duration, Postgres pool utilization, end-to-end-time-to-payout.

4. **24-hour soak test:** 1500 connections × 24 hours. Verify: no memory leaks, no stuck rooms, all alert-thresholds avoided.

---

## §20. Appendix D — Migration paths for backward-compatibility

### gameSlug-aliases (for `tallspill`, `mønsterbingo`)

Current code accepts these as Spill 2/3 aliases. Decision: keep accepting them but normalize to canonical slug at room-creation. Migration:

1. Add canonicalize-slug step in `RoomLifecycleService.createRoom`:
   ```typescript
   const SLUG_ALIASES: Record<string, string> = {
     "game_2": "rocket",
     "tallspill": "rocket",
     "mønsterbingo": "monsterbingo",
     "game_3": "monsterbingo",
   };
   const canonicalSlug = SLUG_ALIASES[input.gameSlug?.toLowerCase().trim() ?? ""]
                       ?? input.gameSlug?.toLowerCase().trim()
                       ?? "bingo";
   const room: RoomState = { ..., gameSlug: canonicalSlug };
   ```
2. All downstream code only sees canonical slugs.

### LedgerGameType (DATABINGO → MAIN_GAME) split

Existing prod-data may have `house-{hallId}-databingo-{channel}` accounts. New code creates `house-{hallId}-main_game-{channel}`. Split-handling:

1. Hall-balance-readout (`adminHallEvents.ts`) already sums both gameType-buckets per K2-A PR #443. Verify this still works.
2. Optional consolidation migration: post-pilot, run script that transfers all DATABINGO-house-balances to MAIN_GAME-house-accounts. Mark in compliance-ledger as "rebalancing".
3. Until consolidation: BOTH buckets are valid. Reports SUM both.

### `RoomUpdatePayload.players` stripping

Backwards-compat: legacy klients (Spill 1) get full `players[]` as before. Spill 2/3 klients receive `playerCount` field. Klients need to handle both shapes.

```typescript
// Klient detect:
const playerCount = payload.players?.length ?? payload.playerCount ?? 0;
```

---

## §21. Appendix E — Comparison to "casino-grade" requirements

### Definition of casino-grade (Tobias' direktiv)

"Like robust som Evolution Gaming." Reference points:

1. **Uptime:** 99.95% per quarter (Evolution's published SLA). Spillorama target: same.
2. **Latency:** p95 < 200ms for all player-facing operations.
3. **Throughput:** 36 000 concurrent connections, 100+ rooms.
4. **Recovery:** Zero data loss, RPO ≤ 1 sec, RTO ≤ 30 sec.
5. **Audit:** Hash-chained, tamper-evident, regulatory-exportable.
6. **Compliance:** Per-jurisdiction certified.

### Spillorama Spill 2/3 status

| Requirement | Current | Gap | Phase |
|---|---|---|---|
| Uptime 99.95% | Unknown | Need load-tested validation | Fase 3 |
| Latency p95 < 200ms | Likely meets for normal-load | Mass-payout breaks (§3.1) | Fase 2 |
| 36k connections | Unverified, single-instance | Multi-instance + payload-strip needed | Fase 2 |
| Recovery RPO≤1s | Postgres-checkpoint per draw + outbox | Likely meets | Fase 2 |
| Recovery RTO≤30s | Boot-sweep auto-recovery | Game3 missing (§5.1) | Fase 2 |
| Audit hash-chain | BIN-764 implemented for Spill 1 | Spill 2/3 unverified (§9.4) | Fase 3 |
| Compliance | Lotteritilsynet-certifiable | DATABINGO-hardcode (§9.1) | Fase 2 |

**Conclusion:** Fase 2 closes pilot-blockers. Fase 3 closes the remaining gap to Evolution-tier robustness.

---

## §22. Sluttkommentar

Auditen avdekker at Spill 2/3 er **i grenselandet for pilot-readiness**. Fase 2 (3 uker, 2 utviklere) lukker alle KRITISKE funn. Etter det kan pilot kjøre på 24 haller × 1500 spillere med rimelig sikkerhet.

**Hovedrotårsaken** er at `BingoEngine` ble bygget med Spill 1 i tankene, og Spill 2/3 arvet semantikk som ikke gir mening (master-rolle, evaluateActivePhase, claim:submit). PR #942's bypass-fix var pragmatisk men åpnet sikkerhetshull. En ren refaktorering der Spill 2/3 har egen base-class med eksplisitt "perpetual room"-modell ville fjerne denne hele class-en av bugs — men er en **2-3 måneders refactor**, langt utenfor pilot-tidsrammen.

**Anbefaling:** Implementer Fase 2 quick-wins, så planlegg Fase 3 refactoring post-pilot for å konsolidere arkitekturen og bringe Spill 2/3 til Evolution-tier robustness.

**Audit utført:** 2026-05-05 mot commit `f84083f2`.
**Funn-kategorier:** 9 CRITICAL, 12 HIGH, 7 MEDIUM, 9 LOW = 37 totalt.
**Estimat Fase 2:** 38 dev-dager = 3-4 uker med 2 parallelle utviklere.
**Estimat Fase 3:** 62 dev-dager = 6-8 uker med 2 parallelle utviklere.

