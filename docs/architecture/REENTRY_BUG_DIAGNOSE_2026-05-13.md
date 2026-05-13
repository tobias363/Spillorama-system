# Spill 1 — Re-entry under aktiv trekning (bug I15)

**Status:** Bug bekreftet og diagnostisert. Klar for implementasjons-fix.
**Dato:** 2026-05-13
**Klassifisering:** **Implementasjons-bug** (én funksjon, én fil, < 30 linjer endring)
**Pilot-blokker:** Ja for "test-flow under aktiv runde", men kun annoyance for live-pilot
  (spilleren kan vente til runden slutter eller kjøre `unmountGame` riktig via `/web/`-shell).

## Bug-rapport

Tobias, 2026-05-13:

> "etter at jeg starter spill går ut av lobbyen for deretter å gå inn igjen
> så kommer jeg ikke inn i rommet under en trekning, må vente til trekning
> er ferdig før jeg kan gå inn"

## Reproduksjons-test

`tests/e2e/spill1-reentry-during-draw.spec.ts` — kjøre med:

```bash
npm run dev:nuke   # i annen terminal
npx playwright test --config=tests/e2e/playwright.config.ts spill1-reentry-during-draw
```

Forventet status per 2026-05-13 (før fix):

```
🚨 BUG I15 REPRODUSERT: re-join feilet med:
  - [Game1] Room join feilet — mounter lobby-fallback istedenfor å vise feil:
    {code: PLAYER_ALREADY_IN_ROOM, message: Spiller Spiller finnes allerede i rommet. Bruk room:resume for reconnect.}

Server-side trail: engine.joinRoom (kalt via game1ScheduledEvents.ts:324)
kaster PLAYER_ALREADY_IN_ROOM fordi assertWalletNotAlreadyInRoom() finner
eksisterende player-record fra forrige session (detachSocket rydder bare
socketId, ikke selve player-record). Klient mounter Game1LobbyFallback
istedenfor å sync-e til pågående runde.
```

Test-tid 12-25 sek. Test BLIR GRØNN når fix-en lander.

## Root cause

**File:** `apps/backend/src/sockets/game1ScheduledEvents.ts:288-365` (function `joinScheduledGame`)

`game1:join-scheduled`-handler kaller `engine.joinRoom` direkte uten å
sjekke for eksisterende player-record først:

```ts
// apps/backend/src/sockets/game1ScheduledEvents.ts:283-330
/**
 * Hovedflyt: player-join inn i schedulert rom.
 *
 * - Hvis room_code allerede satt: joinRoom (reconnect-trygg — samme wallet
 *   → samme player per eksisterende joinRoom-logikk).      // ← FEIL ANTAKELSE
 * ...
 */
async function joinScheduledGame(...) {
  ...
  if (row.room_code) {
    if (isHallShared) {
      try { await engine.setRoomHallSharedAndPersist(row.room_code, true); }
      catch (err) { ... }
    }
    // Eksisterende rom — gjenta join (idempotent hvis samme wallet).
    let roomCode: string;
    let playerId: string;
    try {
      const joined = await engine.joinRoom({              // ← HER
        roomCode: row.room_code,
        hallId,
        playerName,
        walletId: user.walletId,
        socketId,
      });
      ...
```

`engine.joinRoom` er IKKE idempotent — den kaster `PLAYER_ALREADY_IN_ROOM`
hvis samme wallet allerede er bound:

```ts
// apps/backend/src/game/RoomLifecycleService.ts:393-394
this.callbacks.assertWalletNotInRunningGame(walletId, roomCode);   // evicts (no throw)
this.callbacks.assertWalletNotAlreadyInRoom(room, walletId);       // THROWS PLAYER_ALREADY_IN_ROOM

// apps/backend/src/game/BingoEngine.ts:4198-4211
private assertWalletNotAlreadyInRoom(room: RoomState, walletId: string): void {
  ...
  const existing = [...room.players.values()].find((p) => p.walletId === normalizedWalletId);
  if (existing) {
    throw new DomainError(
      "PLAYER_ALREADY_IN_ROOM",
      `Spiller ${existing.name} finnes allerede i rommet. Bruk room:resume for reconnect.`
    );
  }
}
```

## Hvorfor player-record fortsatt finnes etter back-to-lobby

Lobby-back-flyten (`returnToShellLobby` i `apps/backend/public/web/lobby.js:587-608`)
kaller `unmountGame()` → `GameApp.destroy()` → `socket.disconnect()`.

Backend-side reagerer i `lifecycleEvents.ts:64` `socket.on("disconnect")`
→ `engine.detachSocket(socket.id)` (`BingoEngine.ts:3802-3831`).

**Viktig design-valg:** `detachSocket` setter KUN `player.socketId = undefined`
— den fjerner IKKE selve player-record fra `room.players`-mapen. Dette er
**intentionalt** for at reconnect skal kunne plukke opp armed-state /
lucky-numbers / ticket-buy-in.

`room:join` og `room:create` (`roomEvents.ts:287-861`) håndterer dette
korrekt: de kjører `findPlayerInRoomByWallet(snapshot, walletId)` først
og kaller `engine.attachPlayerSocket(roomCode, existingPlayer.id, newSocketId)`
hvis den finner eksisterende player. KUN hvis player ikke finnes (helt ny
join) går de videre til `engine.joinRoom`.

**`game1:join-scheduled`-handleren har IKKE denne guarden.** Den kaller
`engine.joinRoom` direkte og lar `assertWalletNotAlreadyInRoom` kaste.

## Hvorfor `room:resume` ikke trigges

> **Beslektet fallgruve:** Se [PITFALLS_LOG.md §7.13](../engineering/PITFALLS_LOG.md)
> — "PLAYER_ALREADY_IN_ROOM ved upgrade fra hall-default til scheduled-game"
> (PR #1218). Den fikset SAMME bug-klasse for plan-advance / hall-upgrade,
> men KUN i `handleScheduledGameDelta`-pathen. Initial-join-pathen (denne bug-en)
> ble glemt.

Klienten har en eksisterende fallback for `PLAYER_ALREADY_IN_ROOM` —
men KUN i `handleScheduledGameDelta` (plan-advance-flyten,
`Game1Controller.ts:1325-1361`):

```ts
const errCode = (result.error as { code?: string } | undefined)?.code;
if (errCode === "PLAYER_ALREADY_IN_ROOM" && this.actualRoomCode) {
  // Bruk room:resume for å sync state
  const resume = await this.deps.socket.resumeRoom({
    roomCode: this.actualRoomCode,
    scheduledGameId: nextScheduledGameId,
  });
  ...
}
```

Initial-join (`Game1Controller.ts:672-753`) har IKKE samme fallback. Den
faller direkte til `Game1LobbyFallback` ved `!joinResult.ok`:

```ts
// Game1Controller.ts:717-753
if (!joinResult.ok || !joinResult.data) {
  console.warn(
    "[Game1] Room join feilet — mounter lobby-fallback istedenfor å vise feil:",
    joinResult.error,
  );
  this.loader.hide();
  this.clearScreen();
  this.lobbyFallback = new Game1LobbyFallback({...});
  void this.lobbyFallback.start();
  return;
}
```

Klienten har ingen mulighet til å re-attach når serveren sier
`PLAYER_ALREADY_IN_ROOM` ved initial join.

## Klassifisering: implementasjon, ikke struktur

**Ikke strukturell** fordi:

1. **Mønsteret er allerede etablert** — `room:create` og `room:join` har
   `findPlayerInRoomByWallet` + `attachPlayerSocket`-guarden (3 steder i
   `roomEvents.ts`). Vi trenger bare å lime samme guard inn i
   `joinScheduledGame`.
2. **Ingen ny tabell, ny event, eller ny arkitektur-pattern.** Bare en
   ekstra guard-blokk i én service-funksjon.
3. **Backwards-compatible** — fresh joins (helt nye spillere uten
   eksisterende record) faller fortsatt til `engine.joinRoom`.
4. **Eksisterende test-helpers brukes** — `findPlayerInRoomByWallet`
   eksporteres fra `roomHelpers.ts` og er allerede i scope via
   `deps.findPlayerInRoomByWallet` i `RoomEventDeps`.

## Foreslått fix (impl-only, ikke skrevet her)

```ts
// apps/backend/src/sockets/game1ScheduledEvents.ts:288 — inside joinScheduledGame
if (row.room_code) {
  if (isHallShared) {
    try { await engine.setRoomHallSharedAndPersist(row.room_code, true); }
    catch (err) { ... }
  }

  // ▼▼▼ NY GUARD — match room:join/room:create-mønsteret ▼▼▼
  // Re-attach hvis samme wallet allerede er i rommet (typisk når spiller
  // navigerer tilbake til lobby og inn igjen mid-runde — detachSocket
  // beholder player-record, vi bare oppdaterer socketId).
  const existingSnapshot = engine.getRoomSnapshot(row.room_code);
  const existingPlayer = findPlayerInRoomByWallet(existingSnapshot, user.walletId);
  if (existingPlayer) {
    engine.attachPlayerSocket(row.room_code, existingPlayer.id, socketId);
    await markScheduledRoom(row.room_code, row, isHallShared, hallId);
    const snapshot = engine.getRoomSnapshot(row.room_code);
    return {
      roomCode: row.room_code,
      playerId: existingPlayer.id,
      snapshot,
    };
  }
  // ▲▲▲ slutt ny guard ▲▲▲

  // Eksisterende rom uten samme wallet — full join.
  let roomCode: string;
  let playerId: string;
  try {
    const joined = await engine.joinRoom({ ... });
    ...
```

`findPlayerInRoomByWallet` må importeres fra
`apps/backend/src/util/roomHelpers.ts` (eller injectes via `deps`-objektet
— `deps.findPlayerInRoomByWallet` er allerede tilgjengelig i andre
socket-event-deps; se `gameEvents/deps.ts:41`).

## Hva med room:resume?

`room:resume` finnes som event-handler (`roomEvents.ts:863+`) og er den
"riktige" reconnect-pathen — men klienten kaller den KUN fra
`handleScheduledGameDelta` (plan-advance), ikke fra initial join. Vi
kunne også fikset bug-en ved å lære klienten å falle tilbake til
`room:resume` ved `PLAYER_ALREADY_IN_ROOM` (samme pattern som linje
1335-1361). Men:

- **Server-side fix er enklere** — én ekstra guard-blokk vs. å endre
  klient-flyt + sikre at `room:resume` returnerer riktig snapshot for
  alle scheduled-game-tilfeller (Demo-hall + multi-hall).
- **Server-side fix er konsistent** — andre room-join-events har samme
  guard. Asymmetrien mellom `joinScheduledGame` og `room:create` /
  `room:join` er bug-source.
- **Klient-side fix krever bridge-state-reset** — `applySnapshot` etter
  `room:resume` må håndtere at klienten allerede har sett deler av
  snapshot fra forrige session.

Anbefaling: **fix backend først**, vurder eventuelt klient-`room:resume`-fallback
som defense-in-depth senere.

## Hvorfor existing player.name er "Spiller" i feilmeldingen

Feilmeldingen sier "Spiller Spiller finnes allerede i rommet". Det er
fordi `Game1Controller.resolvePlayerName` (line 1283-1297) defaulter til
`"Spiller"` hvis `sessionStorage.spillorama.dev.user.displayName` ikke er
satt — som er typisk i dev-test-rigg. Dette er ikke bug, bare display-detalj.

## Side-effects å sjekke

1. **Lucky number** — `luckyNumbersByPlayer.get(roomCode)?.get(player.id)`
   bør overleve re-attach siden vi gjenbruker `existingPlayer.id`.
2. **Armed tickets / pre-round-bonger** — bevares fordi vi ikke kaller
   `cleanupStaleWalletInIdleRooms`-flyten.
3. **Ticket-grid synchronization** — `room:update` emitt umiddelbart
   etter `attachPlayerSocket` slik at klient får fersh snapshot.
4. **Wallet binding** — uendret. Wallet-id var allerede bound; vi bytter
   bare socketId.

## Test-coverage gap som bør lukkes parallelt

- `apps/backend/src/sockets/__tests__/` mangler unit-test for
  `game1:join-scheduled` reconnect-pathen. Etter fix bør vi legge til
  `game1ScheduledEvents.reconnect.test.ts` som verifiserer at:
  - To raske kall til `game1:join-scheduled` fra samme walletId returnerer
    samme `playerId` (ikke kaster).
  - Lucky number / pre-round-bonger overlever.
  - socket-id på player-record oppdateres til siste kall.

## Klassifisering for BUG_CATALOG.md

```markdown
| I15 | `game1:join-scheduled` kaller `engine.joinRoom` direkte uten å sjekke
       for eksisterende player via `findPlayerInRoomByWallet` først. Resultat:
       spiller som navigerer tilbake til lobby og inn igjen mid-runde får
       `PLAYER_ALREADY_IN_ROOM` og lander på `Game1LobbyFallback`-overlay i
       stedet for pågående runde. `room:join` og `room:create` har riktig
       re-attach-guard; `joinScheduledGame` mangler den. Fix: legg
       `findPlayerInRoomByWallet` + `attachPlayerSocket`-guard i
       `apps/backend/src/sockets/game1ScheduledEvents.ts:295` (rett etter
       `setRoomHallSharedAndPersist`-blokken, før `engine.joinRoom`-call).
       | Implementasjons | TODO | 🔴 Bekreftet via test |
```

## Referanser

- Repro-test: [`tests/e2e/spill1-reentry-during-draw.spec.ts`](../../tests/e2e/spill1-reentry-during-draw.spec.ts)
- Backend join-handler: [`apps/backend/src/sockets/game1ScheduledEvents.ts:288-365`](../../apps/backend/src/sockets/game1ScheduledEvents.ts)
- Reference-guard i `room:create`: [`apps/backend/src/sockets/gameEvents/roomEvents.ts:372-397`](../../apps/backend/src/sockets/gameEvents/roomEvents.ts)
- Reference-guard i `room:join`: [`apps/backend/src/sockets/gameEvents/roomEvents.ts:771-806`](../../apps/backend/src/sockets/gameEvents/roomEvents.ts)
- Helper: [`apps/backend/src/util/roomHelpers.ts:71-78`](../../apps/backend/src/util/roomHelpers.ts)
- `assertWalletNotAlreadyInRoom`: [`apps/backend/src/game/BingoEngine.ts:4198-4211`](../../apps/backend/src/game/BingoEngine.ts)
- Klient-fallback (kun for plan-advance, ikke initial): [`packages/game-client/src/games/game1/Game1Controller.ts:1325-1361`](../../packages/game-client/src/games/game1/Game1Controller.ts)
