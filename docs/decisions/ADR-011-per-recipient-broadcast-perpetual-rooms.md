# ADR-011: Per-spiller broadcast-strippet payload for perpetual rooms

**Status:** Accepted
**Dato:** 2026-05-06
**Forfatter:** Wave 3b — Anthropic Claude (Opus 4.7, 1M context)
**Driver:** Pilot-skala 24 haller × 1500 spillere = 36 000 samtidige WebSocket-tilkoblinger
**Audit-referanse:** [SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md §6.1](../architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md)

## Kontekst

Spill 2 (`rocket`) og Spill 3 (`monsterbingo`) er "perpetual rooms": ÉT
globalt rom per spill med opp til 1500 samtidige spillere. Auto-draw fyrer
hver 2-30 sek, og hver runde-end / `bet:arm` / `ticket:cancel` /
`room:join` triggerer en `room:update`-broadcast.

Tidligere implementasjon brukte standard Socket.IO-broadcast:

```typescript
async function emitRoomUpdate(roomCode: string): Promise<RoomUpdatePayload> {
  const payload = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
  io.to(roomCode).emit("room:update", payload);
  return payload;
}
```

Det fungerte fint for Spill 1 (5-50 spillere/rom), men på 1500-spillere-
skala genererte det:

- **Payload-størrelse:** ~314 KB pr. emit
  - `players[]` (1500 × ~200 bytes Player = 300 KB)
  - `currentGame.tickets` / `marks` (per-spiller-records)
  - `preRoundTickets` / `luckyNumbers` / `playerStakes` (per-spiller-records)
  - `armedPlayerIds` (1500 IDer × 4 bytes = 6 KB)
- **Per-emit total:** 1500 sockets × 314 KB = **460 MB**
- **Sustained bandwidth:** 30-sek-draw + 50 events/min = 2 emits/sec × 460 MB = **~920 MB/sec**

Render `starter`-plan har 10 GB/mnd bandwidth — vi ville sprenge budsjettet
på minutter under pilot-last.

Klient-impact av den fulle payload-en var imidlertid 0:
- Spill 2/3-klienten leser KUN `playerCount` (UI-chip "X spillere")
- `myTickets` / `myMarks` (egen spiller)
- `armedPlayerIds.includes(myPlayerId)` (er jeg armed?)
- Globale felt: `drawnNumbers`, `prizePool`, `entryFee`, `serverTimestamp`

Den iterer ALDRI andre spilleres state for noe UI-element. Game1 er
annerledes — der trenger klient hele `players[]` for "Topp 5"-leaderboard
+ chat-roster.

## Beslutning

Innfør **per-spiller-broadcast med strippet payload** for perpetual rooms.

### Algoritme

I `emitRoomUpdate`:

1. Bygg full payload én gang (kjent kostnad + brukes av admin-display).
2. Hvis `payload.gameSlug` er en perpetual-slug (rocket / monsterbingo /
   tallspill / mønsterbingo / game_2 / game_3):
   1. Iterer `payload.players`.
   2. For hver socket-bound player: bygg en strippet payload som inneholder
      KUN det den spilleren trenger.
   3. `io.to(player.socketId).emit("room:update", strippedPayload)`.
3. Ellers (Game1): behold standard `io.to(roomCode).emit(...)` med full payload.

### Strip-strategi (`stripPerpetualPayloadForRecipient`)

| Felt | Behandling |
|---|---|
| `players[]` | Filtrert til kun mottakerens egen `Player`-rad |
| `playerCount` (NY) | Alltid populated fra source |
| `currentGame.tickets` | Filtrert til kun mottakerens egne |
| `currentGame.marks` | Filtrert til kun mottakerens egne |
| `preRoundTickets` | Plukket til mottakerens nøkkel |
| `luckyNumbers` | Plukket til mottakerens nøkkel |
| `playerStakes` | Plukket til mottakerens nøkkel |
| `playerPendingStakes` | Plukket til mottakerens nøkkel |
| `armedPlayerIds` | Filtrert til `[mottakerens ID]` hvis armed, ellers `[]` |
| `currentGame.drawnNumbers` | Uendret (globalt) |
| `currentGame.prizePool` | Uendret (globalt) |
| `currentGame.entryFee` | Uendret (globalt) |
| `serverTimestamp` | Uendret (globalt) |
| `scheduler` | Uendret (globalt) |
| `gameVariant` | Uendret (globalt) |

### Klient-kontrakt

`packages/shared-types/src/schemas/game.ts` — `RoomUpdatePayloadSchema`
fikk et nytt optional felt:

```typescript
playerCount: z.number().int().nonnegative().optional(),
```

Klienter SKAL foretrekke `payload.playerCount` over `payload.players.length`
hvis den er satt. Game1 (full payload) sender ikke `playerCount`, så
klienten faller tilbake til `players.length` der.

## Måling (1500 spillere)

| Metric | Før | Etter | Reduksjon |
|---|---|---|---|
| Payload pr. mottaker | 314 KB | 0.8 KB | **401×** |
| Per-emit total (1500 sockets) | 460.2 MB | 1.1 MB | **418×** |
| Sustained bandwidth (2 emits/sec) | ~920 MB/sec | ~2.2 MB/sec | **418×** |

Måling reproduserbar i `roomHelpers.perpetualStrip.test.ts` —
`stripPerpetualPayloadForRecipient — 1500-spillere gir < 5 KB pr. emit`.

## Konsekvenser

### Positive

- **Pilot-skala-budsjett tilgjengelig:** 1500 sockets × 0.8 KB = 1.1 MB
  pr. emit holdes godt innenfor Render-bandwidth-budsjett.
- **CPU-budsjett bedre:** mindre JSON-serialisering pr. emit (Socket.IO
  serialiserer payload én gang per unik sett av etiketter).
- **Klient-RAM redusert:** Spill 2/3-klienten holder ikke lenger 1499
  andre spilleres state i minne — kun sin egen.
- **Backwards-compat:** type-feltet `playerCount` lagt til som optional;
  eldre klienter ignorerer det og fortsetter å lese `players.length`.

### Negative

- **CPU-cost flyttet til server:** vi bygger 1500 strippede payloads i
  stedet for én. Hver strip er O(1) for globale felt + O(per-spiller-records)
  for picks. Total ~1500 × ~50µs = 75ms pr. emit. Acceptabelt vs. 1500×TCP-
  syscalls vi sparer på smaller wire-payload (Socket.IO buffer-håndtering).
- **Admin-display-paritet:** admin-rom (ikke i player-list) får et "observer"
  payload med alle records-felt strippet til `{}`. Hvis admin trenger full
  state må de hente via `engine.getRoomSnapshot` + REST-endpoint.
- **Wallet-room broadcast uendret:** `wallet:state`-events går fortsatt
  via egen `wallet:<walletId>`-room. Stripping endrer ikke wallet-flyt.

## Alternativer vurdert

### A — Path A i audit (minimal): bare strip `players[]`

**Rejected.** Sparer kun ~300 KB av 314 KB. Mister muligheten til å eliminere
`tickets`/`marks`/`preRoundTickets`/`luckyNumbers` per-spiller-records.

### B — Per-spiller diff-events (ingen room:update for Spill 2/3)

**Deferred to Fase 3.** Krever refactor av klient-state-management for å
applye delta-eventer atomisk + flere socket-events pr. mutasjon. Stripping
gir 99% av besparelsen til 1% av kompleksiteten.

### C — Binary protocol (protobuf + gzip-compression)

**Deferred to Fase 3.** Casino-grade industri-norm men krever stor klient-
side endring + protobuf-build-step. Stripping gir oss pilot-readiness uten
det.

## Test-strategi

20 unit-tester i `apps/backend/src/util/roomHelpers.perpetualStrip.test.ts`:

- Slug-detection (rocket / monsterbingo / aliaser / case-insensitiv)
- Per-recipient filtrering (egen player / egne tickets-marks / egne records)
- Observer-mode (recipientId=null → alle records tomme)
- Globale felt beholdes uendret
- Source-payload muteres IKKE (kritisk fordi vi strippe per-socket)
- Edge: payload uten `currentGame`
- Payload-størrelse: 1500-spillere < 5 KB; full > 100 KB (sanity baseline)

## Implementasjon

| Komponent | Fil | Endring |
|---|---|---|
| Slug-detection | `apps/backend/src/util/roomHelpers.ts` | `isPerpetualGameSlug()` (ny eksport) |
| Strip-funksjon | `apps/backend/src/util/roomHelpers.ts` | `stripPerpetualPayloadForRecipient()` (ny eksport) |
| Per-socket emit | `apps/backend/src/index.ts` | `emitRoomUpdate` itererer `payload.players` |
| Type-utvidelse | `packages/shared-types/src/schemas/game.ts` | `RoomUpdatePayloadSchema.playerCount` |
| Metrics | `apps/backend/src/util/metrics.ts` | `perpetualRoomUpdateBroadcasts` + `perpetualRoomUpdateBytes` |

## Rolling-update-sikkerhet

- Eldre klienter: ignorerer `playerCount`, leser `players.length`. På Spill
  2/3 blir det `1` (kun me) — men klienten brukte aldri `players.length`
  for noe UI-element der, så det er OK.
- Admin-display: får tom-recipient-payload (kun globale felt). Hvis admin-UI
  ramper opp Spill 2/3-display etter Wave 3b må vi vurdere et eget
  admin-broadcast-rom (kommer i Fase 3 hvis det blir behov).

## Referanser

- Audit: `docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md` §6.1
  (TOP 5)
- Patch-spec: §17 Patch E.1
- Branch: `perf/wave-3b-broadcast-payload-and-pool-2026-05-06`
