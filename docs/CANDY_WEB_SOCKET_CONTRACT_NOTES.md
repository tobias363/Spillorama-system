# Candy Web Socket Contract Notes

Kilder brukt:

- `backend/src/index.ts`
- `backend/src/game/types.ts`
- `Candy/Assets/Script/Theme1RoundRenderState.cs`
- `Candy/Assets/Script/Theme1DisplayState.cs`
- `Candy/Assets/Script/Theme1StateBuilder.cs`
- `Candy/Assets/Script/APIManager.Theme1RealtimeDedicatedPatterns.cs`
- `Candy/Assets/Script/APIManager.Theme1RealtimeBuildInput.cs`
- `Candy/Assets/Script/NumberGenerator.cs`
- `Candy/Assets/Script/PaylineManager.cs`

## Faktisk realtime-wire-format

Backend sender i praksis `RoomSnapshot + scheduler` i alle room-snapshots som kommer fra `emitRoomUpdate(...)`, selv om enkelte callback-signaturer i `index.ts` er skrevet som bare `RoomSnapshot`.

Det betyr at web-klienten kan behandle disse som:

- `room:update` push: `RoomSnapshot & { scheduler: CandyRoomSchedulerState }`
- `room:create` ack snapshot: samme shape
- `room:join` ack snapshot: samme shape
- `room:resume` ack snapshot: samme shape
- `game:start` ack snapshot: samme shape
- `game:end` ack snapshot: samme shape
- `draw:next` ack snapshot: samme shape
- `ticket:mark` ack snapshot: samme shape
- `ticket:reroll` ack snapshot: samme shape
- `claim:submit` ack snapshot: samme shape
- `room:state` ack snapshot: samme shape

## Event-navn

### Client -> server

| Event | Payload | Ack |
| --- | --- | --- |
| `room:create` | `{ accessToken?, playerName?, walletId?, hallId? }` | `{ roomCode, playerId, snapshot }` |
| `room:join` | `{ accessToken?, playerName?, walletId?, hallId?, roomCode }` | `{ roomCode, playerId, snapshot }` |
| `room:resume` | `{ accessToken?, roomCode, playerId }` | `{ snapshot }` |
| `room:configure` | `{ accessToken?, roomCode, playerId, entryFee? }` | `{ snapshot, entryFee }` |
| `bet:arm` | `{ accessToken?, roomCode, playerId, armed? }` | `{ snapshot, armed, armedPlayerIds }` |
| `game:start` | `{ accessToken?, roomCode, playerId, entryFee?, ticketsPerPlayer? }` | `{ snapshot }` |
| `game:end` | `{ accessToken?, roomCode, playerId, reason? }` | `{ snapshot }` |
| `draw:next` | `{ accessToken?, roomCode, playerId }` | `{ number, snapshot }` |
| `draw:extra:purchase` | `{ accessToken?, roomCode, playerId, requestedCount?, packageId? }` | `{ denied: true }` |
| `ticket:mark` | `{ accessToken?, roomCode, playerId, number }` | `{ snapshot }` |
| `ticket:reroll` | `{ accessToken?, roomCode, playerId, ticketsPerPlayer?, ticketIndex? }` | `{ snapshot, ticketsPerPlayer, ticketCount, rerolledTicketIndexes }` |
| `claim:submit` | `{ accessToken?, roomCode, playerId, type }` | `{ snapshot }` |
| `room:state` | `{ accessToken?, roomCode }` | `{ snapshot }` |

### Server -> client

| Event | Payload | Notat |
| --- | --- | --- |
| `room:update` | `RoomSnapshot & { scheduler }` | broadcast til hele rommet |
| `draw:new` | `{ number, source? }` | manuell draw sender bare `number`; auto-draw sender også `source: "auto"` |

## Payload-antakelser

### Auth og identitet

- `accessToken` er definert som optional i TypeScript-signaturene i backend, men brukes i praksis for auth.
- `playerName` og `walletId` finnes i payload-typene for `room:create` og `room:join`, men backend løser identitet fra access token og bruker ikke disse verdiene som source of truth.
- `hallId` er optional i payload-typen, men kreves i praksis ved create/join fordi backend kaller `requireActiveHallIdFromInput(...)`.

### Snapshot-innhold

- `currentGame.tickets` er autoritativ ticket-kilde når en runde kjører.
- `preRoundTickets` er ikke garantert komplett for alle spillere i `room:update`.
  `emitRoomUpdate(roomCode, playerId)` broadcaster én og samme payload til hele rommet, og kan dermed inneholde pre-round tickets bare for aktørspilleren som trigget oppdateringen.
- `room:state` kan returnere snapshot uten lokale `preRoundTickets` hvis brukeren kan lese rommet men ikke matcher en spiller i rommet.

### Theme1-spesifikke hull i backend-kontrakten

Disse verdiene finnes i Unity-flyten, men sendes ikke fra backend-snapshotet:

- aktive Theme1-patterns
- pattern masks
- topper payout-tabell
- ferdig formatterte topper prize labels
- preferred near pattern per kort
- Theme1-spesifikke HUD-strenger

Web-mapperen i `candy-web/src/domain/theme1/mappers/mapRoomSnapshotToTheme1.ts` gjør derfor disse antakelsene:

- default aktive patterns = alle 16 mønstre fra `PaylineManager`
- default pattern masks = portet 1:1 fra `PaylineManager.Build_payline_templates()`
- payout-slot mapping = portet 1:1 fra `GameManager.ResolvePayoutSlotIndex(...)`
- topper labels/payouts må injiseres via mapper-options hvis web-klienten skal speile Unity-topperen nøyaktig
- hvis `playerId` ikke er oppgitt, velges først en spiller med synlige tickets; deretter host/første spiller som fallback

### Formatering i web-mapperen

- Unity formatterer hovedsakelig heltall via `FormatWholeNumber(...)`, så web-mapperen normaliserer penger til hele tall for HUD/card-labels.
- `Theme1RoundRenderState` i web bevarer Unity-lignende feltnavn.
- `Theme1RoundRenderModel` er en avledet web-view-model med `hud`, `toppers`, `recentBalls`, `boards` og `meta`.

## Praktisk konsekvens for neste steg

- Ikke endre backend-wire-format for Theme1 nå.
- Hvis web-klienten trenger helt korrekt topper-strip og pattern-priser, legg de inn som lokale config-/mapper-options i `candy-web`, ikke som ad hoc tolkning av snapshotet.
- Ved reconnect eller oppstart bør klienten bruke `room:state`/`room:resume` for å sikre eget `playerId` og egne synlige tickets før rendering.
