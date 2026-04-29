## Live-room observability events (2026-04-29)

**Status:** Implementert i fix/rtp-cap-bug-and-live-room-observability (PR pending).

**Bakgrunn:** Tobias-incident 2026-04-29 (game `057c0502-9a0c-48f6-8111-73fe5a49b599`)
viste at engine-loggene knapt fanget 3 minutters live-runde — ÉN strukturert
event ("orphan reservation released") i hele perioden. Når en runde går galt
er post-mortem nesten umulig uten DB-forensics.

Denne PR-en introduserer ~25 nye structured INFO-level lifecycle-events som
ops kan grep-e i Render-loggen for å rekonstruere hva skjedde i en gitt
runde / spiller / hall. Default-på via `BINGO_VERBOSE_ROOM_LOGS=true`. Slå
av med `BINGO_VERBOSE_ROOM_LOGS=false` hvis log-volum blir et problem.

### Event-katalog

Alle events er strukturerte JSON-payloads via pino. Felt-navn er stabile —
ops kan trygt grep-e f.eks. `event=game.pattern.won AND patternName="1 Rad"`.

#### Engine (`module: "engine"`)

| Event | Når | Felt |
|---|---|---|
| `room.created` | `BingoEngine.createRoom` etter `rooms.set()` | `roomCode, hallId, gameSlug, hostPlayerId, walletId, isTestHall?, isHallShared?` |
| `room.player.joined` | `createRoom`/`joinRoom` etter `players.set()` | `roomCode, playerId, walletId, socketId, hallId, role: "host"\|"guest"` |
| `room.player.attached` | `attachPlayerSocket` (re-connect) | `roomCode, playerId, socketId, walletId` |
| `room.player.detached` | `detachSocket` (disconnect) | `roomCode, playerId, socketId, walletId` |
| `room.player.evicted` | `cleanupStaleWalletInIdleRooms` / `cleanupStaleWalletInNonCanonicalRooms` | `roomCode, playerId, walletId, reason: "cleanupStale"\|"cleanupNonCanonical"` |
| `room.player.preserved` | `cleanupStaleWalletInIdleRooms` med `isPreserve` callback returner true | `roomCode, playerId, walletId, reason: "armed"` |
| `game.started` | `startGame` etter game state er bygget | `roomCode, gameId, gameSlug, hallId, eligiblePlayerIds, eligiblePlayerCount, prizePool, payoutPercent, maxPayoutBudget, ticketsByPlayer, entryFee, isTestGame?` |
| `game.player.filtered` | `startGame` filter-step (per drop) | `roomCode, playerId, walletId, reason: "notArmed"\|"notInRoom"\|"blocked"\|"lowBalance"\|"lossLimit"`, og evt. `detail`, `balance`, `entryFee`, `rejectedTicketCount` |
| `game.draw` | `drawNextNumber` etter `drawnNumbers.push()` | `roomCode, gameId, drawIndex, number` |
| `game.pattern.won` | `payoutPhaseWinner` / `submitClaim` etter payout (når `payoutSkipped=false`) | `roomCode, gameId, patternId, patternName, claimId, winnerId, payoutAmount, rtpCapped, faceValue` (+ `phase: "LINE"\|"BINGO"` for ad-hoc) |
| `game.pattern.payout-skipped` | `payoutPhaseWinner` / `submitClaim` når `payout=0 + requestedAfterPolicyAndPool>0` | `roomCode, gameId, patternId, patternName, claimId, playerId, configuredFaceValue, requestedAfterPolicyAndPool, remainingBudget, houseAvailableBalance, reason: "budget-exhausted"\|"house-balance-low"` |
| `game.ended` | `finishPlaySessionsForGame` (én per round-end) | `roomCode, gameId, hallId, endedReason, finalDrawCount, totalPayout, prizePool, claimCount` |

#### Socket (`module: "socket.lifecycle"` / `module: "socket.room"`)

| Event | Når | Felt |
|---|---|---|
| `socket.connected` | `registerLifecycleEvents` (ved tilkobling) | `socketId, ip, userAgent` |
| `socket.disconnected` | `socket.on("disconnect")` | `socketId, reason` |
| `socket.room.create-request` | `room:create` handler etter identity-resolve | `socketId, walletId, hallId, requestedSlug` |
| `socket.bet:arm` | `bet:arm` handler etter validering | `socketId, playerId, roomCode, wantArmed, ticketSelectionCount, totalQty` |
| `socket.ticket:cancel` | `ticket:cancel` handler etter `cancelPreRoundTicket` | `socketId, playerId, roomCode, ticketId, removedTicketCount, fullyDisarmed` |

#### Scheduler (`module: "scheduler"`)

| Event | Når | Felt |
|---|---|---|
| `auto.round.tick` | `onAutoStart` / `onAutoDraw` ved meningfulle state-endringer | `roomCode, gameId?, action: "started"\|"skipped"\|"drew"\|"ended", reason?, number?, drawIndex?, source?` |

### Eksempler (post-incident-grepping)

#### "Hva skjedde i game `057c0502` rundt klokken 14:18?"

```bash
grep '"gameId":"057c0502"' render.log | jq -r '"\(.time) \(.event) \(.msg // "")"' | head -50
```

Skal returnere kronologisk:
- `room.created` (hallId, hostPlayerId)
- `room.player.joined` × N
- `socket.bet:arm` × N (per bong-kjøp)
- `game.started` (eligiblePlayerIds, prizePool, maxPayoutBudget)
- `game.draw` × M (per ball)
- `game.pattern.won` per fase som ble betalt
- `game.pattern.payout-skipped` for fase som ble capped
- `game.ended` (endedReason, totalPayout)

#### "Hvor mange bongs ble cap-skippet i går?"

```bash
grep '"event":"game.pattern.payout-skipped"' render.log | wc -l
```

#### "Hvilke spillere ble filtert ut av startGame siste time?"

```bash
grep '"event":"game.player.filtered"' render.log | jq '.reason' | sort | uniq -c
```

### Volum-vurderinger

Per typisk runde med 10 spillere × 24 draws + 5 faser:
- `room.created` × 1
- `room.player.joined` × 10 + reconnects
- `game.player.filtered` × 0-5 (kun ved drops)
- `game.started` × 1
- `game.draw` × 24
- `game.pattern.won` / `payout-skipped` × 5
- `game.ended` × 1
- `auto.round.tick` × ~25 (per draw + start/end)

Sum: ~70 events per runde i base-case. Med 4 haller × 100 runder/dag =
~28k events/dag. Render-loggen takler det fint, men hvis det blir et
problem kan flagget slås av med `BINGO_VERBOSE_ROOM_LOGS=false` (events
forsvinner; eksisterende ERROR/WARN-logger berøres ikke).

### Privacy-vurdering

- Ingen real-name eller email-felter logges.
- `walletId` er internal UUID (ikke direkte koblet til personnummer).
- `socketId`, `gameId`, `roomCode` er alle internal IDs.
- IP og user-agent (kun ved `socket.connected`) er minimal — Render har
  allerede HTTP request-logging på samme nivå.

### Implementasjon

Helper-funksjon: `apps/backend/src/util/roomLogVerbose.ts`

```typescript
import { logRoomEvent } from "../util/roomLogVerbose.js";
const log = rootLogger.child({ module: "engine" });

logRoomEvent(log, { roomCode, gameId, playerId }, "room.player.joined");
```

Gating-flagget `BINGO_VERBOSE_ROOM_LOGS` parses fra env via
`parseBooleanEnv` (default `true`). Cached etter første kall —
`resetRoomVerboseFlagForTest()` finnes for unit-tester.

### Etter rollout

1. **Smoke-test 24h:** verifiser at events strømmer korrekt i Render-prod.
2. **Justere volum:** hvis ops opplever for høy støy, slå av flagget
   med `BINGO_VERBOSE_ROOM_LOGS=false`.
3. **Iterere katalog:** hvis nye events trengs (eks. `mini-game.spin`,
   `jackpot.activated`), legg til via samme `logRoomEvent` mønster.
   Husk å oppdatere denne katalogen så ops kan grep dem.

---

**Reference:** Tobias prod-incident 2026-04-29 14:18-14:19 (engine logget
29 identiske `Wallet house-... mangler saldo` errors før runden endte).
PR `fix/rtp-cap-bug-and-live-room-observability` lukker både den underliggende
bug-en og observability-gapet i samme commit.
