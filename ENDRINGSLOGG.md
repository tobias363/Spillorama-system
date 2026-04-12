# Endringslogg — Spillorama bingo-backend

**Periode:** 12. april 2026  
**Branch:** `codex/track-unity-source-of-truth`

---

## Oversikt

Alle endringer er gjort i `backend/` og dekker tre prosjektområder:

1. **Web Shell Lobby** — lobby-API og statusinformasjon til frontend
2. **Sikkerhetsutbedring Fase 0** — kritiske autentiserings- og integritetsfeil
3. **Sikkerhetsutbedring Fase 1** — snapshot-korrekthet og crash-recovery
4. **Sikkerhetsutbedring Fase 2** — økonomi og regulatoriske hull
5. **Sikkerhetsutbedring Fase 3** — distribuert drift og robusthet

---

## Web Shell Lobby

### BIN-263/264 — Lobby-API og spillstatus

**Fil:** `backend/src/index.ts`

Lagt til `GET /api/games/status` — returnerer live spillstatus per slug (`OPEN`, `STARTING`, `CLOSED`) med `nextRoundAt` fra `DrawScheduler`. Lobbyen poller dette hvert 30. sekund.

```
GET /api/games/status
→ { "bingo": { "status": "OPEN", "nextRoundAt": null } }
```

**Filer:** `backend/public/web/lobby.js`, `backend/public/web/index.html`

- Lagt til `gameStatus: {}` i `lobbyState`
- `/api/games/status` hentes parallelt med øvrige lobby-data
- `buildStatusBadge(slug)` returnerer fargekodede HTML-badges
- `scheduleStatusRefresh()` poller hvert 30s
- CSS for badges: `.lobby-tile-status--open` (grønn), `--starting` (gul), `--closed` (grå)

---

## Sikkerhetsutbedring Fase 0

### BIN-237 — WebSocket connection-time autentisering

**Fil:** `backend/src/index.ts`

Lagt til `io.use()` middleware som validerer JWT-token ved tilkoblingstidspunkt. Klienter med ugyldig token avvises med `UNAUTHORIZED` før tilkoblingen etableres. Klienter uten token settes som `socket.data.authenticated = false` (tillates for bakoverkompatibilitet med Unity).

### BIN-238 — NOT_ARMED_FOR_GAME guard i submitClaim

**Fil:** `backend/src/game/BingoEngine.ts`

Separerte billettkontroll i `submitClaim()` i to eksplisitte feil:
- `NOT_ARMED_FOR_GAME` — spilleren deltok ikke i runden og har ingen billetter
- `TICKET_NOT_FOUND` — spiller mangler brett i aktivt spill

### BIN-239 — Idempotency-nøkler på utbetalingstransaksjoner

**Fil:** `backend/src/game/BingoEngine.ts`

Lagt til `idempotencyKey` på begge payout-kall:
- `{ idempotencyKey: "line-payout-{claim.id}" }`
- `{ idempotencyKey: "bingo-payout-{claim.id}" }`

Forhindrer dobbeltutbetaling ved retry etter nettverksfeil.

### BIN-240 — Checkpointing aktivert som standard

**Fil:** `backend/src/index.ts`

Endret `BINGO_CHECKPOINT_ENABLED`-default fra `false` til `true`. Checkpointing er nå aktivert i production med mindre det eksplisitt overstyres til `false`.

### BIN-242 — BINGO_ALREADY_CLAIMED guard

**Fil:** `backend/src/game/BingoEngine.ts`

Lagt til `game.bingoWinnerId`-sjekk i `submitClaim()` før BINGO-validering. Forhindrer race condition der to spillere kan sende BINGO samtidig og begge få godkjent krav.

```typescript
if (game.bingoWinnerId) {
  reason = "BINGO_ALREADY_CLAIMED";
}
```

---

## Sikkerhetsutbedring Fase 1

### BIN-243 — Autorativ trekketilstand (drawBag) i snapshot

**Filer:** `backend/src/game/types.ts`, `backend/src/game/BingoEngine.ts`

`GameSnapshot` manglet `drawBag` — bare `drawnNumbers` og `remainingNumbers` ble lagret. Det gjorde at recovery ikke kunne reprodusere korrekt neste trekk.

- Lagt til `drawBag: number[]` i `GameSnapshot`-interfacet
- `serializeGame()` lagrer nå `[...game.drawBag]` (full ordnet sekvens)
- `remainingNumbers` beholdes som `game.drawBag.length` (bakoverkompatibilitet)

### BIN-244 — Per-billett kryss-struktur i snapshot

**Filer:** `backend/src/game/types.ts`, `backend/src/game/BingoEngine.ts`

`serializeGame()` flatet ut `Set<number>[]` per spiller til en enkelt `number[]`. For spillere med flere brett var det umulig å deserialisere hvilke kryss som tilhørte hvilket brett.

- `GameSnapshot.marks` endret fra `Record<string, number[]>` til `Record<string, number[][]>`
- `serializeGame()` bevarer nå per-billett-struktur: `marksByTicket.map(s => [...s])`

### BIN-245 — Reell crash-recovery av spilltilstand

**Filer:**
- `backend/src/adapters/PostgresBingoSystemAdapter.ts`
- `backend/src/game/BingoEngine.ts`
- `backend/src/index.ts`

**Problemet:** Serverstart markerte alltid ufullstendige spill som `ENDED`, selv om fullstendig snapshot fantes i PostgreSQL.

**Løsning:**

`PostgresBingoSystemAdapter.getLatestCheckpointData(gameId)` — ny metode som henter både `snapshot` og `players` fra siste checkpoint-rad.

`BingoEngine.restoreRoomFromSnapshot(roomCode, hallId, hostPlayerId, players, snapshot, gameSlug?)` — ny public metode som rekonstruerer `RoomState` + `GameState` fra en `GameSnapshot`:
- `Record<string, number[][]>` → `Map<string, Set<number>[]>` (BIN-244)
- `drawBag` restoreres fra snapshot (BIN-243)
- Game settes til status `RUNNING` slik at auto-draw kan fortsette

Startup-recovery i `index.ts` — erstatter gammel "mark-all-ENDED"-logikk:
1. For hvert ufullstendig spill: hent `getLatestCheckpointData()`
2. Hvis gyldig snapshot med `drawBag`: kall `restoreRoomFromSnapshot()`
3. Fallback til `markGameEnded()` om snapshot mangler eller restore feiler

---

## Sikkerhetsutbedring Fase 2

### BIN-252 — Fjern `payoutPercent ?? 100` default

**Fil:** `backend/src/game/BingoEngine.ts`

`payoutPercent ?? 100` var en farlig fallback — kall-stier som glemte feltet ville gi 100% utbetaling automatisk.

- Default fjernet
- Kaster nå `MISSING_PAYOUT_PERCENT` hvis feltet ikke er satt eksplisitt

### BIN-241 — Fjern klartekstlogging av drawBag

**Fil:** `backend/src/game/BingoEngine.ts`

Hele trekkesekvensen ble logget som `RNG_DRAW_BAG` ved spillstart. Enhver med loggtilgang kunne forutsi alle fremtidige trekk — alvorlig regulatorisk brudd.

- `RNG_DRAW_BAG`-loggen erstattet med `RNG_DRAW_BAG_HASH`
- Logger SHA-256 hash av drawBag: `createHash("sha256").update(JSON.stringify(drawBag)).digest("hex")`
- Full sekvens bevares i PostgreSQL-checkpoint (BIN-243)

### BIN-248 — GAME_END checkpoint for alle sluttbaner

**Fil:** `backend/src/game/BingoEngine.ts`

`GAME_END`-checkpoint ble kun skrevet i manuell `endGame()`. De tre andre sluttbanene (`MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY`, `BINGO_CLAIMED`) satte bare status i minnet — PostgreSQL-session forble `RUNNING`.

- Ny privat helper `writeGameEndCheckpoint(room, game)` — fail-soft (logger, kaster ikke)
- Lagt til i alle 4 sluttbaner:
  - `MAX_DRAWS_REACHED` (pre-draw guard)
  - `DRAW_BAG_EMPTY`
  - `MAX_DRAWS_REACHED` (etter siste trekk)
  - `BINGO_CLAIMED` (etter at payout er utbetalt)
  - `endGame()` bruker nå samme helper

### BIN-250 — Kompensasjonsbasert oppstartssekvens

**Fil:** `backend/src/game/BingoEngine.ts`

I `startGame()` ble buy-in trukket fra wallet før `room.currentGame` ble etablert. Feil etter debitering, men før spilltilstand, resulterte i at spillere mistet penger uten aktiv runde.

- `debitedPlayers: Player[]`-liste akkumuleres under wallet-transfer-loopen
- Ved feil midt i loopen: alle allerede-debiterte spillere refunderes automatisk
- Kritisk feil ved refund logges som `CRITICAL` for manuell oppfølging

---

## Sikkerhetsutbedring Fase 3

### BIN-253 — Minimumsintervall for manuell draw

**Fil:** `backend/src/game/BingoEngine.ts`

Ingen intern beskyttelse mot rapid-fire draw-kall via admin-API.

- Konstant `MIN_MANUAL_DRAW_INTERVAL_MS = 500`
- `roomLastDrawMs: Map<string, number>` sporer tidspunkt for siste trekk per rom
- `drawNextNumber()` kaster `DRAW_TOO_FAST` hvis < 500ms siden forrige trekk
- `roomLastDrawMs` oppdateres etter hvert vellykket trekk

### BIN-254 — Loggfør riktig aktør-ID ved admin-trekk

**Fil:** `backend/src/index.ts`

Admin draw-next-endepunktet brukte `snapshot.hostPlayerId` som actor-ID — admin-brukerens identitet ble aldri logget.

- `requireAdminPermissionUser()` returnerer nå en navngitt variabel `adminUser`
- Logger: `adminWallet`, `adminName`, `roomCode`, `number`

### BIN-247 — Spiller-basert rate limiting

**Filer:** `backend/src/middleware/socketRateLimit.ts`, `backend/src/index.ts`

Rate-begrensning ble sporet på `socketId`. Reconnect ga ny `socketId` og nullstilte tellere — omgåelse av rate limits var trivielt.

- `SocketRateLimiter.checkByKey(key, eventName)` — ny metode med vilkårlig nøkkel
- `rateLimited()` sjekker nå to nøkler:
  1. `socket.id` (for uautentiserte hendelser)
  2. `socket.data.user?.walletId` (for autentiserte spillere)
- Reconnect nullstiller ikke wallet-baserte tellere

### BIN-249 — Redis-persistering feilhåndtering

**Fil:** `backend/src/store/RedisRoomStateStore.ts`

`set()` kalte `persistAsync().catch(() => {})` — eventuelle feil som unngikk inner-catch ble stille svelget.

- `.catch(() => {})` erstattet med `.catch((err) => logger.error(...))`
- Feil som unngår inner-try/catch logges nå med full kontekst

### BIN-251 — Redis state store koblet inn i BingoEngine

**Filer:** `backend/src/game/BingoEngine.ts`, `backend/src/index.ts`

`RoomStateStore`/`RedisRoomStateStore` eksisterte men ble ikke brukt av BingoEngine — romtilstand levde kun i intern `Map`.

- `ComplianceOptions.roomStateStore?: RoomStateStore` — nytt valgfritt felt
- `BingoEngine` tar imot og lagrer store-referansen
- Privat `syncRoomToStore(room)` kaller `this.roomStateStore?.set(room.code, room)`
- Kalles ved strukturelle mutasjoner: `createRoom`, `destroyRoom`, `restoreRoomFromSnapshot`
- `roomStateStore` sendes fra `index.ts` ved konstruksjon av engine

---

## Filer endret

| Fil | Issues |
|-----|--------|
| `backend/src/index.ts` | BIN-237, BIN-240, BIN-245, BIN-251, BIN-254, BIN-263/264/266 |
| `backend/src/game/BingoEngine.ts` | BIN-238, BIN-239, BIN-241, BIN-242, BIN-243, BIN-244, BIN-245, BIN-248, BIN-250, BIN-251, BIN-252, BIN-253 |
| `backend/src/game/types.ts` | BIN-243, BIN-244 |
| `backend/src/adapters/PostgresBingoSystemAdapter.ts` | BIN-245 |
| `backend/src/store/RedisRoomStateStore.ts` | BIN-249, BIN-251 |
| `backend/src/middleware/socketRateLimit.ts` | BIN-247 |
| `backend/public/web/lobby.js` | BIN-263/264/266 |
| `backend/public/web/index.html` | BIN-263/264 |

---

## Gjenstående (Fase 4)

| Issue | Tittel | Type |
|-------|--------|------|
| BIN-246 | RNG-sertifisering fra akkreditert testlab | Ekstern prosess |
| BIN-255 | Concurrency-, recovery- og wallet-feiltester | Kode |
| BIN-256 | Dokumenter trekksikkerhetsmodell for sertifisering | Dokumentasjon |
| BIN-257 | Sett WebSocket `maxHttpBufferSize` | Kode (5 min) |
| BIN-258 | Korriger misvisende kommentarer og funksjonsnavn | Kode |
| BIN-259 | Implementer payout audit hash-kjede | Kode |
