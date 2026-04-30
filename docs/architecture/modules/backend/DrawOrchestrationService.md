# DrawOrchestrationService

**File:** `apps/backend/src/game/DrawOrchestrationService.ts` (635 LOC)
**Owner-area:** game-runtime
**Last reviewed:** 2026-04-30

## Purpose

Stand-alone service owning the **draw-orchestration flow** for ad-hoc Spill 1/2/3 rooms — extracted in F2-D (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3) so the ~290-line `_drawNextNumberLocked` method (and its public wrapper `drawNextNumber`) is no longer hosted inside `BingoEngine.ts`.

The service handles the full single-draw pipeline:

1. **HIGH-5 per-room mutex** — `drawLocksByRoom` short-circuits concurrent `draw:next` calls for the same room with `DRAW_IN_PROGRESS` instead of queueing them. Cleaned up in `finally` and on `destroyRoom` (via `cleanupRoomCaches`).
2. **Guard chain (in order):** `assertNotScheduled` (CRIT-4) → `assertSpill1NotAdHoc` (K3) → `assertHost` → `assertWalletAllowedForGameplay` → `GAME_PAUSED` (BIN-460) → `DRAW_TOO_FAST` (MEDIUM-1/BIN-253).
3. **MAX_DRAWS_REACHED pre-draw branch** — when `drawnNumbers.length >= maxDrawsPerRound`, runs PHASE3-FIX last-chance `evaluateActivePhase` (gated by `autoClaimPhaseMode`), then ends the round + writes GAME_END checkpoint.
4. **Bag shift** — `game.drawBag.shift()`. If empty, runs the same last-chance path before throwing `NO_MORE_NUMBERS` with reason `DRAW_BAG_EMPTY`.
5. **Per-draw observability** — `logRoomEvent({event:"game.draw"})` (LIVE_ROOM_OBSERVABILITY 2026-04-29) + `bingoAdapter.onNumberDrawn({roomCode, gameId, number, drawIndex:1-based})`.
6. **Variant-config cache-miss auto-bind** — if a Spill 1 room has no cached variantConfig (Render-restart scenario), service emits `[CRIT] VARIANT_CONFIG_AUTO_BOUND` and asks the engine to re-bind `DEFAULT_NORSK_BINGO_CONFIG` via callback. Other slugs skip auto-bind.
7. **Hook chain (with K5 same-cause-counter wiring):**
   - `onDrawCompleted(ctx)` — variant-overridable post-draw hook (G2/G3 use it for auto-claim/pattern-cycling). Errors route through `handleHookError` (does not rethrow).
   - `evaluateActivePhase(room, game)` — gated by `autoClaimPhaseMode`. Same K5 routing.
   - `onLuckyNumberDrawn(ctx)` — fan-out per-player when ball matches the player's `luckyNumber` AND `variantConfig.luckyNumberPrize > 0`. Errors are logged but do not halt the room.
8. **HOEY-3 per-draw checkpoint** — `writeDrawCheckpoint(room, game)` after the hook chain.
9. **FULLTHUS-FIX (2026-04-27) last-chance `evaluateActivePhase`** — fires when `drawnNumbers.length >= maxDrawsPerRound && status === "RUNNING"` so Phase 5 can still claim Fullt Hus on ball 75 (defends against transient `evaluateActivePhase` failures earlier in the chain). After this, the round ENDs with `MAX_DRAWS_REACHED` only if Phase 5 did not already mark it `BINGO_CLAIMED`.
10. **BIN-689 0-based wire `drawIndex`** — `return { number, drawIndex: drawnNumbers.length - 1, gameId }`. Internal hook payloads keep the 1-based `length` semantics (PatternCycler / GAME2_MIN_DRAWS_FOR_CHECK depend on that).

## Public API

```typescript
export class DrawOrchestrationService {
  constructor(
    bingoAdapter: BingoSystemAdapter,
    minDrawIntervalMs: number,
    maxDrawsPerRound: number,
    callbacks: DrawOrchestrationCallbacks,
  )

  async drawNext(input: DrawOrchestrationInput): Promise<{
    number: number
    drawIndex: number   // 0-based BIN-689 wire-level
    gameId: string
  }>

  cleanupRoomCaches(roomCode: string): void

  // Test-only introspection (cast through `unknown`):
  __getLockState(roomCode: string): Promise<unknown> | undefined
  __getLastDrawAt(roomCode: string): number | undefined
}

export interface DrawOrchestrationInput {
  roomCode: string
  actorPlayerId: string
}

export interface DrawOrchestrationCallbacks {
  // Lookup helpers (engine owns the room store + assertion helpers).
  requireRoom(roomCode: string): RoomState
  requirePlayer(room: RoomState, playerId: string): Player
  requireRunningGame(room: RoomState): GameState

  // Guards (engine retains ownership because they're reused by other engine methods).
  assertNotScheduled(room: RoomState): void
  assertSpill1NotAdHoc(room: RoomState): void
  assertHost(room: RoomState, actorPlayerId: string): void
  assertWalletAllowedForGameplay(walletId: string, nowMs: number): void

  // Phase + variant hooks (engine owns the wallet/ledger writes for auto-claim payouts).
  evaluateActivePhase(room: RoomState, game: GameState): Promise<void>
  onDrawCompleted(ctx: { room, game, lastBall, drawIndex, variantConfig? }): Promise<void>
  onLuckyNumberDrawn(ctx: { room, game, player, luckyNumber, lastBall, drawIndex, variantConfig }): Promise<void>

  // K5 circuit-breaker plumbing (engine owns the counter + halt-the-room).
  handleHookError(hook: EngineHookName, room: RoomState, game: GameState | undefined, err: unknown): void
  resetHookErrorCounter(roomCode: string, hook: EngineHookName): void

  // Checkpoint + play-session bookkeeping.
  writeDrawCheckpoint(room: RoomState, game: GameState): Promise<void>
  writeGameEndCheckpoint(room: RoomState, game: GameState): Promise<void>
  finishPlaySessionsForGame(room: RoomState, game: GameState, endedAtMs: number): Promise<void>

  // Engine-owned per-room caches (variantConfig + lucky-numbers).
  getVariantConfigForRoom(roomCode: string): GameVariantConfig | undefined
  autoBindSpill1VariantConfig(roomCode: string): GameVariantConfig
  getLuckyNumbersForRoom(roomCode: string): Map<string, number> | undefined
}
```

## Dependencies

**Calls (downstream):**
- `BingoSystemAdapter.onNumberDrawn` — admin/Postgres draw-event sink (1-based drawIndex internally).
- `BingoSystemAdapter.onCheckpoint` — gated by `writeDrawCheckpoint` / `writeGameEndCheckpoint` callbacks (engine owns recovery wiring; service just routes through callback).
- Callbacks (engine-internal helpers): all 14 listed above. The service never reaches into `RoomStateStore`, `WalletAdapter`, `ComplianceLedger`, `PrizePolicyManager`, etc. directly — every cross-cutting concern is routed through the callback port.
- `logRoomEvent` from `util/roomLogVerbose.js` — structured `game.draw` log event per draw.
- `DomainError` from `errors/DomainError.js` — `DRAW_IN_PROGRESS`, `GAME_PAUSED`, `DRAW_TOO_FAST`, `NO_MORE_NUMBERS`.

**Called by (upstream):**
- `BingoEngine.drawNextNumber` — thin delegate (~3 lines: forward to `service.drawNext`).
- Indirectly: every Socket.IO `draw:next` handler via `gameEvents.ts`, the scheduler late-bind `onAutoDraw` wiring, `Game1DrawEngineService` cross-engine bridge, and admin namespaces.

## Invariants

- **No internal game/room state.** The service owns only two Maps:
  - `drawLocksByRoom: Map<string, Promise<unknown>>` — HIGH-5 per-room mutex.
  - `lastDrawAtByRoom: Map<string, number>` — MEDIUM-1/BIN-253 per-room last-draw timestamp.
  Both are evicted via `cleanupRoomCaches(roomCode)` which the engine invokes from its `cleanupRoomLocalCaches` callback inside `RoomLifecycleService.destroyRoom`.

- **Lock release is defensive.** The `finally` block only deletes the lock entry if the in-flight promise still matches its own — prevents a teardown race where `destroyRoom` cleared the map mid-draw.

- **Lock returns immediately on contention.** When a lock is held, the service throws `DRAW_IN_PROGRESS` instead of `await`-ing the in-flight promise. Queueing would amplify back-to-back retries from a slow admin panel.

- **Hook-error contract (K5):** `onDrawCompleted` and `evaluateActivePhase` errors route through `handleHookError`-callback. The service does NOT re-throw — the engine's K5 circuit-breaker decides whether to halt the room. `onLuckyNumberDrawn` errors are logged-and-continued (not routed through K5) because lucky-number is a per-player bonus that should never block the round.

- **PHASE3-FIX last-chance evaluation runs before round-end on both pre-draw MAX_DRAWS and DRAW_BAG_EMPTY branches.** Symmetric so Phase 5 (Fullt Hus) can still claim if `evaluateActivePhase` was interrupted earlier in the chain by a transient ledger/wallet failure.

- **FULLTHUS-FIX (2026-04-27) preserves `BINGO_CLAIMED` over `MAX_DRAWS_REACHED`.** The post-draw `MAX_DRAWS_REACHED` block re-checks `game.status === "RUNNING"` before overwriting — if a recursive `evaluateActivePhase` already ENDed the round with `BINGO_CLAIMED`, that wins.

- **0-based wire `drawIndex` only on the return value.** Internal hook payloads (`onDrawCompleted`, `onLuckyNumberDrawn`, `onNumberDrawn`) keep the 1-based `drawnNumbers.length` semantics — `PatternCycler.step()` and `GAME2_MIN_DRAWS_FOR_CHECK` depend on that.

- **Variant-config auto-bind is Spill-1-only and CRIT-logged.** Other slugs (`rocket`, `monsterbingo`, `spillorama`) skip the auto-bind entirely. The engine owns the actual cache (so the service doesn't need to know about `DEFAULT_NORSK_BINGO_CONFIG`); the service just calls `autoBindSpill1VariantConfig` on cache-miss.

- **`assertNotScheduled` runs before `assertSpill1NotAdHoc`** so a scheduled-Spill-1 room rejects with `USE_SCHEDULED_API` (referencing `Game1DrawEngineService`) instead of the production-runtime guard message. Both errors share the same code by design (audit §2.1).

- **`drawNextNumber` is the only public entry on the engine** for the draw flow. The service's `drawNext` is internal — never called directly from socket handlers (they route through the engine's delegate). This keeps the public-API surface single-sourced through `BingoEngine`.

## Test coverage

- `apps/backend/src/game/__tests__/DrawOrchestrationService.test.ts` — F2-D unit tests for the wiring + delegate-pattern + service-level invariants (23 cases across 10 sections). Pins:
  - HIGH-5 lock acquired-and-released around a draw.
  - HIGH-5 concurrent calls reject with `DRAW_IN_PROGRESS`.
  - Guard chain firing: `USE_SCHEDULED_API` (scheduled), `USE_SCHEDULED_API` (production retail Spill 1 non-test-hall), `NOT_HOST`, `GAME_PAUSED`, `DRAW_TOO_FAST` (with seconds-formatted message).
  - `DRAW_BAG_EMPTY` ENDs the round with reason `DRAW_BAG_EMPTY`.
  - `MAX_DRAWS_REACHED` post-draw block ENDs the round; pre-draw branch fires when length is already at cap.
  - K5 hook-failure routes through `handleHookError` without rethrow; subsequent draws still work.
  - Lucky-number hook: fires on match + `luckyNumberPrize > 0`; silent when `luckyNumberPrize === 0`.
  - Spill 1 cache-miss auto-binds `DEFAULT_NORSK_BINGO_CONFIG` via engine callback.
  - `bingoAdapter.onNumberDrawn` fires per draw with ascending 1-based `drawIndex`.
  - HOEY-3 per-draw `DRAW` checkpoint fires.
  - Cleanup contract: `cleanupRoomCaches` clears both Maps; engine's `destroyRoom` routes through it.
  - BIN-689: `drawNext` returns 0-based `drawIndex` on the wire (length - 1).

- `apps/backend/src/game/BingoEngine.test.ts` — main suite. Many tests exercise the service end-to-end via `engine.drawNextNumber` (e.g. `MEDIUM-1: drawNextNumber enforces minimum draw interval`, `KRITISK-5/6: checkpoint captures RecoverableGameSnapshot with drawBag and structured marks`, `BIN-615 PR-C3: onLuckyNumberDrawn` series, full-round happy-paths).

- `apps/backend/src/game/__tests__/BingoEngine.engineCircuitBreaker.test.ts` — K5 same-cause counter + halt-the-room semantics. Confirms the service routes hook errors through the engine's circuit-breaker correctly.

- `apps/backend/src/game/__tests__/BingoEngine.miniGameAutoClaim.test.ts` — auto-claim Fullt Hus triggers mini-game (PR #727). Exercises the post-draw `evaluateActivePhase` path inside the service.

- `apps/backend/src/game/__tests__/BingoEngine.phaseProgressionWithZeroBudget.test.ts` — RTP-cap zero-budget regression (PR #733). Exercises auto-claim-phase-mode through the service.

- `apps/backend/src/game/__tests__/BingoEngine.testHall.endsRoundOnFullHus.test.ts` — confirms Demo Hall + test-hall bypass through assertSpill1NotAdHoc still works inside the service guard chain.

- `apps/backend/src/game/__tests__/Game1FullRoundE2E.test.ts` — end-to-end full round (entry → draws → BINGO → payout). Top-to-bottom integration through `drawNextNumber`.

## Operational notes

The service has only two pieces of state, so operational issues come from the wired callbacks:

- `DRAW_IN_PROGRESS` — concurrent `draw:next` from two sockets (host in two tabs, or two admin panels). Expected; clients should retry once instead of stacking.
- `DRAW_TOO_FAST` — caller hit the `minDrawIntervalMs` rate-limit. Message includes seconds-remaining; client should disable the button until then.
- `GAME_PAUSED` — admin paused the game (manual) or Spill 1 phase-pause (PR #643). Resume via `engine.resumeGame`.
- `USE_SCHEDULED_API` — either:
  1. Scheduled Spill 1 hit the ad-hoc engine (`assertNotScheduled`). Caller must route through `Game1DrawEngineService`.
  2. Production retail Spill 1 without `isTestHall=true` hit BingoEngine (`assertSpill1NotAdHoc`). Production is required to use the scheduled-engine path.
- `NOT_HOST` — non-host actor invoked draw. UI gating bug or stale player state.
- `NO_MORE_NUMBERS` — bag exhausted (`DRAW_BAG_EMPTY`) or `MAX_DRAWS_REACHED`. Round is now `ENDED`; check `game.endedReason`.
- `[CRIT] VARIANT_CONFIG_AUTO_BOUND` log line — Spill 1 room hit `drawNext` with no cached variantConfig (Render restart). Service triggers the engine to re-bind `DEFAULT_NORSK_BINGO_CONFIG`. Recoverable but flag for ops to investigate cache-tap pattern.
- `onDrawCompleted hook failed` log line — variant hook (G2 PatternCycler / G3 auto-claim) threw. K5 same-cause counter increments; halt at threshold (3 same-cause within 60s) emits `EngineDegradedEvent`.
- `evaluateActivePhase hook failed` log line — auto-claim path threw. Critical because it touches wallet + ledger; investigate `INSUFFICIENT_FUNDS` or transient Postgres errors first.

## Recent significant changes

- F2-D `refactor/f2d-extract-draw-orchestration-service` (#756): extracted from `BingoEngine.ts`. Behavior fully equivalent to the inline implementation:
  - Same HIGH-5 mutex semantics (in-flight rejected with `DRAW_IN_PROGRESS`, lock cleared in `finally`).
  - Same MEDIUM-1/BIN-253 interval enforcement and `DRAW_TOO_FAST` formatting.
  - Same guard ordering (`assertNotScheduled` → `assertSpill1NotAdHoc` → `assertHost` → `assertWalletAllowedForGameplay` → `GAME_PAUSED` → `DRAW_TOO_FAST`).
  - Same MAX_DRAWS_REACHED pre-draw + post-draw branches with PHASE3-FIX last-chance + FULLTHUS-FIX 2026-04-27 preservation of `BINGO_CLAIMED`.
  - Same DRAW_BAG_EMPTY last-chance evaluation.
  - Same K5 routing through `handleHookError` for `onDrawCompleted` + `evaluateActivePhase`; logged-and-continued for `onLuckyNumberDrawn`.
  - Same HOEY-3 per-draw checkpoint + HOEY-6/BIN-248 GAME_END checkpoint.
  - Same LIVE_ROOM_OBSERVABILITY 2026-04-29 `game.draw` log event.
  - Same BIN-689 0-based wire `drawIndex` (length - 1) with internal 1-based hook payloads.
  - Same Spill-1-only variant-config cache-miss auto-bind via callback.

## Refactor status (audit-rapport REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md)

- F2-D complete. The `_drawNextNumberLocked` method (~290 LOC) plus its public wrapper `drawNextNumber` is now isolated in this service. BingoEngine line-count dropped from 4434 → 4464 LOC after F2-C → F2-D — the engine grew slightly because the F2-D extraction added the callback-port builder (`buildDrawOrchestrationCallbacks`) but lost the inline draw method; net the engine drops -248 LOC of orchestration logic to the service. Cumulative HV-3 reduction across F2-A/B/C/D: 5436 → 4464 LOC (~18% engine-size reduction across four extractions).
- **Future bølge:** consider breaking `_drawNextLocked` (~290 LOC inside the service) into smaller phases — pre-draw guards, draw-from-bag, post-draw evaluation, broadcast — which would let each phase be tested in isolation without the full engine + room + game state machine.
- **Future bølge:** unify the ad-hoc draw path with `Game1DrawEngineService.processDraw` so scheduled retail Spill 1 and ad-hoc games share the same orchestration service. Out of scope for F2-D because the scheduled engine is DB-backed (no in-memory `RoomState`) and would require a `RoomState` adapter pattern.
- **Possible follow-up:** move the K5 circuit-breaker counter (`roomErrorCounter`) and halt-the-room plumbing (`handleHookError`) into the service. Kept on the engine for F2-D because the counter is shared with `submitClaim` (via `ClaimSubmitterService`) and `evaluateActivePhase`.
