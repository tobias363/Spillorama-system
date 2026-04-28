# Code Review — Multi-Hall Socket Coordination + Lifecycle (Spill 1)

**Dato:** 2026-04-27
**Reviewer:** Independent code reviewer (post-PR #677/#674/#675)
**Scope:** Socket events (room/ticket/draw/claim/admin), canonical room routing, rate-limiting, lifecycle/reconnect.
**Verdikt:** **REQUEST_CHANGES** — 8 P0-funn (pilot-blokkere), 5 P1, 4 P2.

PR #677 (canonical-aware lookup) løste de mest synlige rom-kollisjons-feilene fra pilot-økten 2026-04-27, men avdekket samtidig flere klasser av relaterte bugs som ennå ikke er lukket. Denne reviewen fokuserer på de utestående SAMSPILL-problemene mellom socket-laget, BingoEngine, Game1DrawEngineService og persistens.

---

## P0 — Pilot-blokkere

### P0-1: `BingoEngine.createRoom` faller silent tilbake til random-kode ved kollisjon — bryter canonical-room-garantien

**Lokasjon:** `apps/backend/src/game/BingoEngine.ts:754-757`

```ts
const existingCodes = new Set(this.rooms.keys());
const code = input.roomCode && !existingCodes.has(input.roomCode)
  ? input.roomCode
  : makeRoomCode(existingCodes);
```

**ISSUE:** Når caller eksplisitt sender `roomCode: "BINGO_<groupId>"` og rommet allerede finnes, returnerer `createRoom` en `4RCQSX`-stil random-kode i stedet for å feile. Caller (`roomEvents.ts:436`) lagrer `newRoom.roomCode` og fortsetter — så klienten ender med `roomCode: "X4RCQSX"` mens andre haller fortsatt bruker canonical `BINGO_<groupId>`. Dette er nøyaktig den klassen av bugs PR #677 forsøkte å lukke.

**SAMSPILL:** roomEvents (auto-create) + BingoEngine.createRoom + listing-via-canonical lookup. Bugen er ikke synlig i log fordi `createRoom` ikke loggar fallback-en.

**RACE-RISK:** To samtidige `room:join BINGO1` fra hall A og hall B i samme group. Begge sjekker `engine.findRoomByCode(canonicalMapping.roomCode)` → ingen rom → begge går til auto-create. Hall A vinner racen → rommet får canonical-kode. Hall B's `createRoom` ser at canonical-code er taken → silent fallback til random-kode → Hall B får eget random-rom. Tilbake til pre-PR #677-buggen, bare nå usynlig (ingen feilmelding).

**FIX:**
```ts
if (input.roomCode && existingCodes.has(input.roomCode.trim().toUpperCase())) {
  throw new DomainError(
    "ROOM_CODE_CONFLICT",
    `Rom-kode ${input.roomCode} finnes allerede — caller må joine eksisterende rom i stedet.`,
  );
}
const code = input.roomCode?.trim().toUpperCase() ?? makeRoomCode(existingCodes);
```
Caller-pathen i `roomEvents.ts` må fange `ROOM_CODE_CONFLICT` og re-runne `findRoomByCode` + join-grenen (deterministisk loop, max 1 iterasjon i prod siden canonical-code er deterministisk).

**TEST mangler:** Race-scenario hvor to `room:join BINGO1` calls fra forskjellige haller i samme group ankommer samtidig. Dagens `roomEvents.canonicalAwareLookup.test.ts` dekker kun sekvensiell flyt.

---

### P0-2: Scheduled Spill 1 multi-hall er knust — `joinRoom` kaster HALL_MISMATCH for ikke-master-haller

**Lokasjon:** `apps/backend/src/sockets/game1ScheduledEvents.ts:240-247` + `apps/backend/src/game/BingoEngine.ts:793`

```ts
// game1ScheduledEvents.ts: scheduled-rom opprettes uten effectiveHallId
const created = await engine.createRoom({
  hallId,
  ...,
  gameSlug: "bingo",
  ...(isTestHall ? { isTestHall: true } : {}),
});
```

```ts
// BingoEngine.joinRoom:
if (!room.isHallShared && room.hallId !== hallId) {
  throw new DomainError("HALL_MISMATCH", "Rommet tilhører en annen hall.");
}
```

**ISSUE:** Scheduled Spill 1 har `participating_halls_json: [hallA, hallB, hallC, hallD]` (cross-hall). Den FØRSTE spilleren som joiner bestemmer `room.hallId`. Når hall B's første spiller deretter joiner (line 187) → `engine.joinRoom` → HALL_MISMATCH → ack-failure → spilleren kommer aldri inn. Pilot 4-haller-link kan ikke kjøre.

**SAMSPILL:** game1ScheduledEvents.joinScheduledGame → BingoEngine.joinRoom → assertHallShared. Mangler `effectiveHallId: null`-flagget for scheduled multi-hall.

**RACE-RISK:** Worse — selv hall A's andre spiller (på samme hall) kan rammes hvis `assignRoomCode` race førte til at "vinner-rommet" har `room.hallId !== hallA`.

**FIX:**
```ts
// game1ScheduledEvents.ts:240
const halls = Array.isArray(row.participating_halls_json) ? row.participating_halls_json : [];
const isMultiHall = halls.length > 1;
const created = await engine.createRoom({
  hallId,
  ...,
  gameSlug: "bingo",
  ...(isMultiHall ? { effectiveHallId: null } : {}),
  ...(isTestHall ? { isTestHall: true } : {}),
});
```
Eksisterende rom (line 187-194) trenger samme — men der må `engine.joinRoom` selv konsultere `participating_halls_json` for hvilke hall-IDs som er tillatt. Alternativt: scheduled flow eier `participating_halls_json`-sjekken og passerer cross-hall-tillatelse via en ny `engine.joinRoomAsScheduled` som skipper HALL_MISMATCH eksplisitt.

**TEST mangler:** Multi-hall scheduled join (hall A first → hall B second). Ingen test i `game1JoinScheduled.test.ts` dekker dette.

---

### P0-3: `chat:send` blokkerer cross-hall chat i shared rooms (Spill 2/3 + group-of-halls Spill 1)

**Lokasjon:** `apps/backend/src/sockets/gameEvents/chatEvents.ts:86-87` + `apps/backend/src/game/BingoEngine.ts:4054-4065`

```ts
// chatEvents.ts:86
if (player.hallId !== snapshot.hallId) {
  throw new DomainError("FORBIDDEN", "Spilleren tilhører en annen hall enn rommet.");
}
```

```ts
// BingoEngine.serializeRoom: isHallShared er IKKE eksponert
private serializeRoom(room: RoomState): RoomSnapshot {
  return {
    code: room.code, hallId: room.hallId, /* ... ingen isHallShared */
  };
}
```

**ISSUE:** Spill 2 (ROCKET) og Spill 3 (MONSTERBINGO) er globale shared-rooms; group-of-halls Spill 1 (BINGO_<groupId>) er gruppe-shared. `room.hallId` er den hallen som opprettet rommet — ikke en gyldig "rom tilhører X"-sannhet for shared rooms. `chat:send` avviser legitim cross-hall chat med FORBIDDEN.

**SAMSPILL:** chatEvents → BingoEngine.serializeRoom. RoomSnapshot mangler `isHallShared`-felt + handler-en mangler bypass-grenen.

**RACE-RISK:** Ingen race — pure logikk-feil. Men 100% av Spill 2/3-chat for ikke-master-haller går tapt.

**FIX:**
```ts
// 1. RoomSnapshot type får isHallShared?: boolean
// 2. BingoEngine.serializeRoom inkluderer ...(room.isHallShared ? { isHallShared: true } : {})
// 3. chatEvents.ts:86 oppdateres:
if (!snapshot.isHallShared && player.hallId !== snapshot.hallId) {
  throw new DomainError("FORBIDDEN", "...");
}
```

**TEST mangler:** `chatEvents.failClosed.test.ts` har bare hall-mismatch-fail-closed for ikke-shared rom. Mangler shared-room-pass-grenen.

---

### P0-4: `getHallGroupIdForHall` er non-deterministisk når en hall er i flere grupper

**Lokasjon:** `apps/backend/src/index.ts:2967-2974` + `apps/backend/migrations/20260424000000_hall_groups.sql:139-144`

```ts
// index.ts:
const groups = await hallGroupService.list({ hallId, limit: 1, status: "active" });
return groups[0]?.id ?? null;
```

```sql
-- DB:
CREATE TABLE app_hall_group_members (
  group_id  TEXT NOT NULL,
  hall_id   TEXT NOT NULL,
  PRIMARY KEY (group_id, hall_id)
);
```

**ISSUE:** PK er `(group_id, hall_id)`, så en hall kan være medlem av flere grupper samtidig. `list({hallId, limit: 1})` ORDER BY name ASC, så valget er stabilt for én lookup, men hvis admin endrer gruppe-navn (eller migrerer en hall mellom grupper) kan canonical room-code FLIPS midt i en aktiv runde. Resultat: Spillere fra samme hall havner i ULIKE rom hvis de connecter på hver sin side av navn-endringen.

**SAMSPILL:** HallGroupService.list → roomEvents.canonical-mapping → BingoEngine.findRoomByCode. Ingen invariant tvinger "én hall — én aktiv gruppe".

**RACE-RISK:** Admin migrerer Hall A fra Group X til Group Y mens Group X kjører en runde. Eksisterende spillere er i `BINGO_X`. Nye joins fra Hall A → `getHallGroupIdForHall` returnerer Y → kanonisk kode `BINGO_Y` → lager nytt rom → split brain.

**FIX:**
1. DB-constraint: `CREATE UNIQUE INDEX uq_app_hall_group_members_hall_active ON app_hall_group_members(hall_id) WHERE deleted_at IS NULL` (krever ny `deleted_at`-kolonne på members) — eller bytt PK til `(hall_id)` med `group_id` som FK.
2. Alternativ: `getHallGroupIdForHall` cacher grupping per (hallId, currentRoundEpoch) så aktive runder bevarer mapping.

**TEST mangler:** Verifisere at multi-membership ikke er mulig (DB-constraint test).

---

### P0-5: AdminHallEvents mangler hallId-scope for HALL_OPERATOR — kan pause/force-end andre hallers spill

**Lokasjon:** `apps/backend/src/sockets/adminHallEvents.ts:220-229, 322-353, 387-435`

```ts
function requireAuthenticatedAdmin(socket: Socket) {
  if (!canAccessAdminPermission(admin.role, "ROOM_CONTROL_WRITE")) {
    throw Object.assign(new Error("Mangler rettigheten ROOM_CONTROL_WRITE."), { code: "FORBIDDEN" });
  }
  return admin;
}
```

**ISSUE:** `ROOM_CONTROL_WRITE` har `["ADMIN", "HALL_OPERATOR"]`. Handleren sjekker rolle, men IKKE at HALL_OPERATOR-eier-hallId matcher rom-hallId. En HALL_OPERATOR for hall A kan kalle `admin:pause-game` med `roomCode` for hall B's rom og pause/force-end deres aktive runde. Tilsvarende for `admin:hall-balance` (kan se andre hallers wallet-balanser) og `admin:room-ready` (kan trigge falske ready-broadcasts).

**SAMSPILL:** RBAC-sjekk skjer i isolasjon; handleren konsulterer ikke `admin.hallId` mot `engine.getRoomSnapshot(roomCode).hallId`. Tilsvarende mønster i `adminOpsEvents.ts:84-110` — ingen hallId-scope.

**RACE-RISK:** Misbruks-account eller bugged HALL_OPERATOR-klient kan paralysere alle hallers spill ved å spamme `admin:force-end` på random rom-koder.

**FIX:** I `requireAuthenticatedAdmin` (eller en ny `requireAuthenticatedAdminForHall(roomCode)`):
```ts
if (admin.role === "HALL_OPERATOR") {
  const targetHallId = engine.getRoomSnapshot(roomCode).hallId;
  // Hent admin's primary_hall_id fra getUserFromAccessToken (lagre på socket.data ved admin:login)
  if (admin.hallId !== targetHallId) {
    throw Object.assign(new Error("HALL_OPERATOR kan kun styre egen hall."), { code: "FORBIDDEN" });
  }
}
```
+ For shared rooms (Spill 2/3): operator kan ikke pause shared rom (kun ADMIN). Eksplisitt `if (room.isHallShared && admin.role !== "ADMIN") throw FORBIDDEN`.

**TEST mangler:** HALL_OPERATOR forsøker `admin:pause-game` for annen hall → forventer FORBIDDEN.

---

### P0-6: Scheduled Spill 1-rom bruker IKKE canonical room-code — kan kollidere med ad-hoc canonical rom

**Lokasjon:** `apps/backend/src/sockets/game1ScheduledEvents.ts:240-247` (ingen `roomCode:` arg) vs. `apps/backend/src/sockets/gameEvents/roomEvents.ts:284-322` (canonical)

**ISSUE:** Scheduled-flyt kaller `engine.createRoom({hallId, gameSlug: "bingo", ...})` UTEN `roomCode` — så engine genererer `makeRoomCode` (random `4RCQSX`-stil). Ad-hoc-flyt for samme hall lager `BINGO_<groupId>`. Begge kan eksistere samtidig:

1. Hall A spillere som join-er via "Spill nå"-knappen → `BINGO_<groupId>` (ad-hoc)
2. Schedulert spill 19:00 starter → opprettes som `XYZ123` (random)
3. Begge rom har `gameSlug: "bingo"` og overlapper hall A.

Spillere fra ad-hoc-flyt og schedulert-flyt havner i ULIKE rom selv om de er i samme hall — split brain.

**SAMSPILL:** game1ScheduledEvents.joinScheduledGame ved nytt rom (line 240) — caller respekterer ikke canonical-mapping. Hvis rommet ble assigned via `assignRoomCode` etter at en ad-hoc canonical eksisterte, fanges det opp i `assignRoomCode` race-handler — men IKKE motsatt vei.

**RACE-RISK:** Pre-pilot scenario: scheduler oppretter rom for tomorrows 19:00-spill litt før kl 19:00 (purchase_open). Spillere joiner via Spill nå-knapp i mellomtiden → ad-hoc canonical lages med `BINGO_<groupId>`. Når scheduler trigger participation → forsøker `engine.createRoom` med eget hash → får random kode → assignRoomCode lykkes → to parallelle rom for samme spill.

**FIX:** Scheduled-flyt må bruke canonical:
```ts
const canonicalGroupId = await getHallGroupIdForHall(hallId);
const canonical = getCanonicalRoomCode("bingo", hallId, canonicalGroupId);
const created = await engine.createRoom({
  hallId, ...,
  gameSlug: "bingo",
  roomCode: canonical.roomCode,
  effectiveHallId: canonical.effectiveHallId,
});
```
Plus boot-sweep må flagge collision: hvis canonical-rom eksisterer ad-hoc og scheduler ber om samme kode → escalere til admin-pause.

**TEST mangler:** Scheduled vs ad-hoc kollisjon for samme hall.

---

### P0-7: `bet:arm` reservasjon-deduplisering bryter for cross-hall canonical rooms (Spill 2/3)

**Lokasjon:** `apps/backend/src/sockets/gameEvents/roomEvents.ts:181-184`

```ts
const armCycleId = deps.getArmCycleId?.(roomCode);
const idempotencyKey = armCycleId
  ? `arm-${roomCode}-${playerId}-${armCycleId}-${newTotalWeighted}`
  : `arm-${roomCode}-${playerId}-${newTotalWeighted}`;
```

**ISSUE:** `roomCode` er `ROCKET` eller `MONSTERBINGO` for shared globale rom. `playerId` er per-room (et UUID generert i `joinRoom`). To haller har separate playerId-er per "samme spiller" hvis de joiner ulike sessions, men vanligvis er det per-room playerId.

For cross-hall canonical rom kan to forskjellige spillere fra hver sin hall få identisk arm-cycle + samme `newTotalWeighted` (sjelden men mulig). Selv om playerId er forskjellig, så er det OK — men hvis en spiller i pilot reconnecter med samme walletId men ny playerId (etter cleanup), kan en gammel `arm-${roomCode}-${oldPlayerId}-${cycle}-X`-reservasjon fortsatt være aktiv mens ny `arm-${roomCode}-${newPlayerId}-${cycle}-X` lages — to reservasjoner mot samme wallet samtidig.

**SAMSPILL:** roomEvents.bet:arm → reservePreRoundDelta → walletAdapter.reserve. Idempotency-key bruker playerId, men playerId regenereres ved cleanup (cleanupStaleWalletInIdleRooms sletter player → re-join lager ny UUID).

**RACE-RISK:** Spiller arm-er 5 brett (reservasjon R1, 50 kr) → klient disconnect → reconnect → cleanupStaleWalletInIdleRooms sletter player → ny player-id → arm-er 5 brett igjen → reservasjon R2 (50 kr). Wallet har nå 100 kr reservert mens spiller bare har valgt 5 brett.

**FIX:** Bruk `walletId` i stedet for `playerId` i idempotency-keyen:
```ts
const walletId = deps.getWalletIdForPlayer?.(roomCode, playerId);
const idempotencyKey = `arm-${roomCode}-${walletId}-${armCycleId ?? "v0"}-${newTotalWeighted}`;
```
Dette sikrer at samme spiller (selv etter playerId-regenerering) deler reservation.

**TEST mangler:** Reservasjon-deduplisering når spiller blir cleanup-rensa og rejoiner.

---

### P0-8: `draw:next` emit-rekkefølge gir mulig client-state-divergens når `pattern:won`-emit feiler

**Lokasjon:** `apps/backend/src/sockets/gameEvents/drawEvents.ts:53-94`

```ts
const { number, drawIndex, gameId } = await engine.drawNextNumber({...});
io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });
// ... emit pattern:won for hver vunnet pattern (synkron loop)
const snapshot = await emitRoomUpdate(roomCode);
ackSuccess(callback, { number, snapshot });
```

**ISSUE:** Hvis `io.to(...).emit("pattern:won", ...)` kaster (svært sjeldent men mulig under last) eller emit-en queue-er bak en treghet, så gir vi `room:update` (som har isWon=true) etter en draw:new uten matching pattern:won-event. Klienten vil aldri vise win-popup. Worse: `await emitRoomUpdate` kan i seg selv kaste hvis engine.getRoomSnapshot kaster (krasj-race med `destroyRoom`) → klienten har trekket ball men ikke fått snapshot-update — UI viser fortsatt forrige bingo-board.

**SAMSPILL:** drawEvents → engine.drawNextNumber (DB checkpoint) → io-broadcast → emitRoomUpdate. Ingen kompensering hvis broadcast-step feiler post-checkpoint.

**RACE-RISK:** Master force-end (`admin:force-end`) underway parallelt med en draw:next. drawNextNumber holder `drawLocksByRoom`-mutex. force-end (`engine.endGame`) venter ikke på lock; resultatet er at den ENDS gamet midt i drawNextNumber-locking — drawNextNumber kommer tilbake med "RUNNING"-state via `requireRunningGame`, men når emitRoomUpdate kjøres er gamet ENDED → klient får mismatch.

**FIX:**
1. Pakk emit-loopen i try/catch så pattern:won-feil ikke aborter resten:
```ts
try {
  for (const r of afterResults) { /* emit pattern:won */ }
} catch (err) {
  logger.error({err, roomCode}, "pattern:won emit-loop feilet midt i draw");
}
```
2. `engine.endGame` bør respektere drawLocksByRoom-mutex eller eksplisitt avvise hvis lock holdes (ikke vente — fail-fast).

**TEST mangler:** Race der `admin:force-end` ankommer mellom `await drawNextNumber` og `await emitRoomUpdate`.

---

## P1 — Polish / mindre kritiske

### P1-1: Disconnect rydder ikke reservasjoner — TTL-sweeper er fail-safe men løs ende

**Lokasjon:** `apps/backend/src/sockets/gameEvents/lifecycleEvents.ts:39-47` + `BingoEngine.detachSocket:3624-3648`

`disconnect` setter kun `socketId = undefined` og kaller `socketRateLimiter.cleanup`. Reservasjoner (BIN-693) blir værende til 30-min TTL-sweep. Hvis spiller never rejoiner (lukker browser-fanen permanent) blir penger låst. Reservasjon-cleanup kunne triggers fra disconnect for spillere som ikke har aktiv runde (status `WAITING`).

**FIX:** I detachSocket, hvis room.currentGame?.status !== "RUNNING", kall releaseReservation. Eller — bedre — la TTL-sweep håndtere det og dokumenter at MAX 30 min lock er akseptabelt.

---

### P1-2: `admin:room-ready` validerer ikke at rommet faktisk er i WAITING/PRE-ROUND-status

**Lokasjon:** `adminHallEvents.ts:281-319`

Operator kan trigge "room-ready" mid-RUNNING (klienten viser countdown for neste runde mens den nåværende fortsatt kjører). Klient-pop-up-flyt blir forvirrende.

**FIX:** `if (resolveActiveGameStatus(roomCode) === "RUNNING") throw "ALREADY_RUNNING"`.

---

### P1-3: `room:state` for ROOM_NOT_FOUND triggers SPA auto-create — auth-bypass-vektor for ukjente rom

**Lokasjon:** `roomEvents.ts:563-586`

`room:state` med ukjent rom-kode lar feilen propagere til klient som så auto-creater. En unauthenticated-eqv klient kan probe rom-koder. Auth gjør at det ikke faktisk er sårbart, men feilmeldingen lekker rom-eksistens.

**FIX:** Generic feilmelding (samme melding for "ROOM_NOT_FOUND" og "FORBIDDEN").

---

### P1-4: AdminOpsService broadcast-rom har ingen hall-scoping for HALL_OPERATOR/SUPPORT

**Lokasjon:** `adminOpsEvents.ts:103-110` + `index.ts:2745-2750`

Alle som har `OPS_CONSOLE_READ` (ADMIN, SUPPORT) joiner samme `admin:ops` rom. HALL_OPERATOR har IKKE OPS_CONSOLE_READ (correct), men SUPPORT-rolle ser alle hallers ops-events. Hvis SUPPORT-konto blir kompromittert eksponeres alle haller. Audit-trail viser ikke hvilke events SUPPORT så.

**FIX:** Per-hall sub-room: `admin:ops:hall:<id>` som bruker joiner basert på rolle. ADMIN joiner alle, SUPPORT joiner kun sin tilknyttede hall (krever DB-tilknytning).

---

### P1-5: `armCycleId` invalideres ved disarmAllPlayers, IKKE ved game-end fra annen flyt

**Lokasjon:** `apps/backend/src/util/roomState.ts:119-125`

`disarmAllPlayers` (kalt fra `game:start`) bumper armCycle. Men `engine.endGame` (force-end) kaller IKKE disarmAllPlayers — så hvis force-end skjer mens spillere har armed brett til neste runde, beholder de cycle-id-en. Etter force-end + ny round-start kommer reservasjoner fra forrige cycle som "duplikater" mot neste runde.

**FIX:** `engine.endGame` bør broadcaste/trigge `disarmAllPlayers` eller emit et signal til socket-laget.

---

## P2 — Nice-to-have

### P2-1: Rate-limit per-walletId teller ikke admin-events
HALL_OPERATOR med tilgang til 4 haller kan spamme `admin:pause-game` 10/sek per hall via 4 separate connections (én per hall). Per-walletId-limiter ville fanget det.

### P2-2: `getCanonicalRoomCode` cacher ikke groupId-oppslaget
Hver `room:create`/`room:join` BINGO1 kjører ny DB-query. For pilot 4 haller × 50 spillere er det neglisjerbart, men når vi skalerer til 50 haller blir det merkbart.

### P2-3: `cleanupStaleWalletInIdleRooms` river ikke rom som er helt tomme
Etter at alle spillere har disconnected og blitt cleanup-rensa, blir IDLE-rom med 0 players liggende i `engine.rooms`. Forstyrrer findRoomByCode-canonical-lookup for nye joiners (rommet finnes uten spillere). Lav konsekvens fordi joiner-en bare joiner et tomt rom.

### P2-4: `markRoomAsScheduled` race ved Redis restart
Kommentaren på linje 832-835 sier race-vinduet ikke er mulig fordi createRoom returnerer synkront. Men ved en Redis-restart der state lastes inn, kan rommet eksistere uten scheduledGameId — markRoomAsScheduled må kjøres på første join (linje 213). Logikken er der, men er fail-soft (warn) — ikke fail-closed. Hvis scheduledGameId ikke settes, kjører ad-hoc engine på et scheduled rom → CRIT-4-bugen.

---

## Race-conditions oppdaget (oppsummering)

1. **P0-1**: Two simultaneous `room:join BINGO1` for canonical room → silent random-code fallback (createRoom-bug).
2. **P0-7**: Reconnect under bet:arm → ny playerId → duplikat reservasjon (idempotency-key bruker playerId).
3. **P0-8**: `admin:force-end` mellom `drawNextNumber` og `emitRoomUpdate` → snapshot-mismatch.
4. **P1-5**: `engine.endGame` bumper ikke armCycleId → cross-cycle reservasjon-deduplisering bryter.
5. **P0-4**: Hall flyttet mellom grupper midt i en runde → canonical-flip → split brain.
6. **P0-6**: Scheduled vs ad-hoc canonical-rom for samme hall → split brain.

---

## Anbefalt prioritering før pilot

**Stoppblokkere (må fikses før første simulert dag):**
1. P0-2 (multi-hall scheduled HALL_MISMATCH) — uten denne fungerer ikke pilot 4-haller.
2. P0-3 (chat blokkert i shared rooms) — synlig i pilot.
3. P0-5 (HALL_OPERATOR cross-hall control) — sikkerhets-/regulatorisk-blokker.
4. P0-1 (createRoom silent fallback) — ekspr-rekkefølge bug.

**Bør fikses før første ekte pilot-dag:**
5. P0-6 (scheduled vs ad-hoc canonical) — kan unngås ved å disable Spill nå-knapp før schedule, men er fragil.
6. P0-7 (reservation duplikat) — penger låst, dårlig UX.
7. P0-4 (hall multi-group) — DB-constraint må legges inn.
8. P0-8 (force-end race med draw) — sjeldent men data-risiko.

**Etter pilot:**
9. Alle P1 og P2.

---

## Filer reviewed (alle absolutte stier)

- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/roomEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/ticketEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/drawEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/claimEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/context.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/chatEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/lifecycleEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/gameEvents/deps.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/adminHallEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/adminOpsEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/game1ScheduledEvents.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/sockets/game1PlayerBroadcasterAdapter.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/util/canonicalRoomCode.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/util/roomState.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/util/roomHelpers.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/middleware/socketRateLimit.ts`
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/game/BingoEngine.ts` (relevante seksjoner)
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/game/Game1DrawEngineService.ts` (assignRoomCode)
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/admin/HallGroupService.ts` (list)
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/src/index.ts` (wire-up)
- `/Users/tobiashaugen/Projects/Spillorama-system/apps/backend/migrations/20260424000000_hall_groups.sql`
