# BingoEngine

**File:** `apps/backend/src/game/BingoEngine.ts` (4464 LOC)
**Owner-area:** game-runtime
**Last reviewed:** 2026-04-30

## Purpose

Authoritative in-process engine for ad-hoc multiplayer bingo rooms — owns room state, player lifecycle, draw bag, claim evaluation, payout/wallet transfer, jackpot/mini-game triggers, and crash-recovery checkpointing.

It is the host-player-room-scoped runtime that powers the "Spill" experience for ad-hoc rooms (default Spill 1 ad-hoc, Spill 2 via `Game2Engine`, Spill 3 via `Game3Engine`). Scheduled Spill 1 multi-hall games run on the parallel `Game1DrawEngineService` (DB-backed, master-as-admin) and never share runtime state with this engine — see `assertSpill1NotAdHoc` (PR #735) which fail-closes any attempt to start a scheduled Spill 1 here.

## Public API

```typescript
export class BingoEngine {
  // Construction + hydration
  constructor(opts: BingoEngineOptions)
  async hydratePersistentState(): Promise<void>

  // Room lifecycle
  async createRoom(input: CreateRoomInput): Promise<{ roomCode, playerId }>
  async joinRoom(input: JoinRoomInput): Promise<{ roomCode, playerId }>
  destroyRoom(roomCode: string): void
  listRooms(): RoomSummary[]
  getRoomSnapshot(roomCode: string): RoomSnapshot

  // Round lifecycle
  async startGame(input: StartGameInput): Promise<void>
  async drawNextNumber(input: DrawNextInput): Promise<{ number, drawIndex, gameId }>
  async pauseGame(roomCode: string): Promise<void>
  async resumeGame(roomCode: string): Promise<void>
  async endGame(input: EndGameInput): Promise<void>

  // Player actions
  async markNumber(input: MarkNumberInput): Promise<void>
  async submitClaim(input: SubmitClaimInput): Promise<ClaimRecord>
  async chargeTicketReplacement(...): Promise<void>

  // Mini-game / jackpot (delegates to BingoEngineMiniGames)
  async spinJackpot(roomCode, playerId): Promise<{ segmentIndex, prizeAmount, ... }>
  async playMiniGame(roomCode, playerId, _selectedIndex?): Promise<{ type, segmentIndex, prizeAmount, prizeList }>

  // Compliance / spillevett admin
  async setPlayerLossLimits(input): Promise<PlayerComplianceSnapshot>
  async setTimedPause(input): Promise<PlayerComplianceSnapshot>
  async setSelfExclusion(walletId): Promise<PlayerComplianceSnapshot>
  async clearSelfExclusion(walletId): Promise<PlayerComplianceSnapshot>
  async awardExtraPrize(input): Promise<...>
  async upsertPrizePolicy(input): Promise<...>

  // Reporting / accounting (delegates to ComplianceLedger)
  async recordAccountingEvent(input): Promise<...>
  async runDailyReportJob(input?): Promise<...>
  async createOverskuddDistributionBatch(input): Promise<...>

  // Wallet sync
  async refreshPlayerBalancesForWallet(walletId): Promise<string[]>

  // Hooks (overridable by subclasses Game2Engine / Game3Engine)
  protected async onDrawCompleted(ctx): Promise<void>
  protected async onLuckyNumberDrawn(ctx): Promise<void>
}

// Standalone helpers
export function lossLimitAmountFromTransfer(fromTx, total): number
export function ballToColumn(ball: number): "B" | "I" | "N" | "G" | "O" | null
export { DomainError }
```

## Dependencies

**Calls (downstream):**
- `WalletAdapter` — buy-in transfer, payout transfer, refund. Always with `idempotencyKey` + `targetSide`. Phase-payout transfer is now routed via `PhasePayoutService` (F2-A).
- `PhasePayoutService.computeAndPayPhase` (F2-A) — extracted cap-and-transfer flow used by `payoutPhaseWinner` (auto-claim path) and `ClaimSubmitterService` LINE/BINGO branches.
- `ClaimSubmitterService.submitClaim` (F2-B) — extracted claim-submission flow (validation, LINE/BINGO branches, post-transfer audit-trail). Engine method `submitClaim` is now a thin delegate that resolves `room`/`game` and forwards to the service.
- `RoomLifecycleService.createRoom` / `joinRoom` / `destroyRoom` / `listRoomSummaries` / `getRoomSnapshot` (F2-C) — extracted room-lifecycle flow. The engine retains ownership of the per-room caches (variantConfigByRoom, luckyNumbersByPlayer, roomLastRoundStartMs) which the service evicts via `cleanupRoomLocalCaches` callback on `destroyRoom`.
- `DrawOrchestrationService.drawNext` (F2-D) — extracted draw-orchestration flow (HIGH-5 mutex, MEDIUM-1/BIN-253 interval, MAX_DRAWS_REACHED / DRAW_BAG_EMPTY end-of-round handling, post-draw hook chain `onDrawCompleted` → `evaluateActivePhase` → `onLuckyNumberDrawn`, HOEY-3 checkpoint, FULLTHUS-FIX last-chance, BIN-689 0-based wire `drawIndex`). The engine method `drawNextNumber` is now a thin delegate. The service owns `drawLocksByRoom` + `lastDrawAtByRoom` Maps; the engine's `cleanupRoomLocalCaches` callback routes through `drawOrchestrationService.cleanupRoomCaches` on `destroyRoom`.
- `ComplianceManager` — pre-armament check (block/limit/pause), `recordLossEntry({type:"BUYIN"|"PAYOUT", amount})`, play-session bookkeeping.
- `ComplianceLedger` — `recordComplianceLedgerEvent` for STAKE/PRIZE/EXTRA_PRIZE/HOUSE_RETAINED + `makeHouseAccountId(hallId, gameType, channel)`.
- `PrizePolicyManager` — single-prize-cap (2500 kr §11), extra-draw policy lookups, denial audit. (Also injected into `PhasePayoutService` so the service applies the same cap.)
- `PayoutAuditTrail` — append per-payout audit row with hash-chain.
- `BingoEnginePatternEval.evaluateActivePhase` / `evaluateConcurrentPatterns` — phase + custom pattern evaluation (delegates via `buildEvaluatePhaseCallbacks`).
- `BingoEngineMiniGames.activateJackpot` / `spinJackpot` / `activateMiniGame` / `playMiniGame` — jackpot + mini-game lifecycle.
- `BingoEngineRecovery.serializeGameForRecovery` / `writeDrawCheckpoint` / `writeGameEndCheckpoint` / `writePayoutCheckpointWithRetry` / `refundDebitedPlayers` / `restoreRoomFromSnapshot`.
- `BingoSystemAdapter.onCheckpoint` — Postgres-backed checkpoint sink.
- `RoomStateStore` — in-memory + persistent room snapshot store.
- `LoyaltyPointsHookPort` — `game.win` events (fire-and-forget).
- `SplitRoundingAuditPort` — house-retained-rest audit hook.
- `ClaimAuditTrailRecoveryPort` — post-transfer audit-trail recovery (CRIT-6).
- `RoomLifecycleStore` (PR #732 K2) — atomic state transitions replacing 3-way Maps.

**Called by (upstream):**
- `apps/backend/src/index.ts` — boot wiring (`new BingoEngine(...)`).
- `apps/backend/src/sockets/gameEvents/context.ts` + `roomEvents.ts` + `claimEvents.ts` + `deps.ts` — every Socket.IO `room:*` / `claim:submit` / `game:start` handler.
- `apps/backend/src/sockets/adminGame1Namespace.ts` + `adminHallEvents.ts` + `adminDisplayEvents.ts` — admin/master views.
- `apps/backend/src/sockets/miniGameSocketWire.ts` — mini-game choice events.
- `apps/backend/src/sockets/game1ScheduledEvents.ts` — wires scheduled-engine bridge for cross-engine room cleanup.
- `apps/backend/src/admin/AdminOpsService.ts` — admin clear-stuck-room endpoint.
- `apps/backend/src/util/schedulerSetup.ts` — scheduler late-binding.
- `apps/backend/src/middleware/errorReporter.ts` — DomainError formatting.
- Subclasses `Game2Engine`, `Game3Engine`.

## Invariants

- Wallet-balance is never negative — `walletAdapter.transfer` is the only mutation path; insufficient-funds paths throw `WalletError("INSUFFICIENT_FUNDS")` before any state change.
- Every `claim.payoutAmount > 0` corresponds to (1) one `walletAdapter.transfer` from `house-{hallId}-{gameType}-{channel}` to player wallet AND (2) one `ledger.recordComplianceLedgerEvent({eventType:"PRIZE"})` with same `claimId` — both succeed or the engine logs CRITICAL + pushes to `ClaimAuditTrailRecoveryPort` for reconciliation.
- Mutations always pass an `idempotencyKey` derived from `IdempotencyKeys.*` — buy-in, refund, jackpot, mini-game, payout, replacement-ticket each have their own key namespace. Retry is safe.
- §11 single-prize-cap (2500 kr) is enforced via `PrizePolicyManager` before payout; any over-cap amount truncates and is logged.
- Multi-winner split is deterministic — `sortWinnerIdsDeterministic` (lex on `playerId`) makes `firstWinnerId` and per-winner ledger order stable across Map insertion-order and crash-recovery rebuilds (PR #695 KRITISK-4).
- Spill 1 (`gameSlug ∈ {"bingo","game_1","norsk-bingo"}`) MUST pause after each phase win (`game.isPaused = true`) — caller must explicitly resume. Other slugs recurse through phases on the same draw (PR #643).
- `isProductionRuntime === true` ⇒ scheduled Spill 1 cannot start as ad-hoc — `assertSpill1NotAdHoc` throws (PR #735).
- Loss-limit only counts the deposit-side of buy-ins (`lossLimitAmountFromTransfer`) — winnings-side spending does not increase net-loss.
- `currentGame` is always either `null` or in one of `{WAITING, RUNNING, ENDED}`; no other states leak past `startGame` / `drawNextNumber` / `endGame`.

## Test coverage

- `apps/backend/src/game/BingoEngine.test.ts` — main suite (multi-thousand LOC, covers create/join/start/draw/claim happy-path + edge cases).
- `apps/backend/src/game/__tests__/BingoEngine.phaseProgressionWithZeroBudget.test.ts` — RTP-cap zero-budget regression (PR #733).
- `apps/backend/src/game/__tests__/BingoEngine.rtpCap.test.ts` — payout cap to RTP-budget + house-balance (PR #726).
- `apps/backend/src/game/__tests__/BingoEngine.miniGameAutoClaim.test.ts` — auto-claim Fullt Hus triggers mini-game (PR #727).
- `apps/backend/src/game/__tests__/BingoEngine.preserveArmedOnReconnect.scenario.test.ts` — armed-state preserved across reconnect (PR #724).
- `apps/backend/src/game/__tests__/BingoEngine.startGame.orphanReservationRelease.test.ts` — orphan reservations released in startGame (PR #723).
- `apps/backend/src/game/__tests__/BingoEngine.cleanupStaleWalletInIdleRooms.preserveArmed.test.ts` — armed players survive stale-wallet sweep.
- `apps/backend/src/game/BingoEngine.crit6Atomicity.test.ts` + `crit6PostTransferRecovery.test.ts` — CRIT-6 atomic claim + post-transfer audit-trail recovery (PR #581).
- `apps/backend/src/game/BingoEngine.crashRecoveryPartialPayout.test.ts` — crash mid-payout recovery.
- `apps/backend/src/game/BingoEngine.demoHallBypass.test.ts` + `demoHallPayout.test.ts` — Demo Hall bypass (PR #660).
- `apps/backend/src/game/BingoEngine.fivePhase.test.ts`, `concurrentPatterns.test.ts`, `multiplierChain.test.ts`, `columnSpecific.test.ts`, `subVariantPresets.test.ts` — pattern winning-type matrix.
- `apps/backend/src/game/BingoEngine.spill1AutoPauseAfterPhase.test.ts` + `spill1QuarantineEnforcement.test.ts` — Spill 1 phase-pause + dual-engine quarantine (PR #643, #735).
- `apps/backend/src/game/BingoEngine.lossLimitSplit.test.ts` + `splitRoundingLoyalty.test.ts` — wallet-split + house-retained loyalty.
- `apps/backend/src/game/__tests__/Game1FullRoundE2E.test.ts` — end-to-end full round (entry → draws → BINGO → payout).

## Operational notes

Common failures + how to diagnose:
- `INSUFFICIENT_FUNDS` from buy-in or wallet transfer — check `app_wallet_accounts.deposit_balance + winnings_balance` for player; check `ComplianceManager` blocks first (`canPlay=false`).
- `Wallet house-... mangler saldo` / payout failure — house wallet underfunded; `house-{hallId}-{gameType}-{channel}` account in `app_wallet_accounts` has `available_balance < payoutAmount`. Top up via admin overskudd-batch reverse or manual ledger correction.
- Engine stuck in pause — check `room.currentGame.isPaused` + `pauseMessage` (Spill 1: phase-win auto-pause; non-Spill-1: manual pause only).
- Round didn't end after Fullt Hus — check `game.endedReason`. `BINGO_CLAIMED` = normal; `MAX_DRAWS_REACHED` = capped; `DRAW_BAG_EMPTY` = bag exhausted; missing = engine still RUNNING (check `game.status`).
- `GAME_RUNNING` on ticket replacement — replacement is round-locked, only allowed pre-start.
- `NOT_ARMED_FOR_GAME` on submitClaim — player did not pay buy-in this round; check `app_play_sessions` for armed-state entries.
- `CRITICAL: Checkpoint failed after game start` — `bingoAdapter.onCheckpoint` threw; round still proceeds in-memory but recovery on restart is impossible. Investigate Postgres connectivity/locks.
- "RECONCILIATION: N refund(s) failed" — buy-in refund failed during partial start failure. Engine logs `failedRefunds[]` with playerId/walletId/amount; manual ledger entry needed.
- `ROOM_ALREADY_EXISTS` during recovery — `restoreRoomFromSnapshot` called twice on same room; check startup hydration is single-pass.
- Stale balance after 2nd+ payout — fixed in PR #553 (W1-hotfix); engine now refreshes via `refreshPlayerBalancesForWallet` instead of optimistic `+=`.

## Recent significant changes

- F2-D `refactor/f2d-extract-draw-orchestration-service` (#756): extracted the draw-orchestration flow (`drawNextNumber` + `_drawNextNumberLocked`) into a new `DrawOrchestrationService`. BingoEngine.ts: 4364 → 4464 LOC after the F2-C → F2-D step (+100, dominated by the new callback-port builder; the inline draw method dropped -248 LOC of pure orchestration logic). The engine method `drawNextNumber` is now a thin delegate; the HIGH-5 mutex (`drawLocksByRoom`) and MEDIUM-1/BIN-253 last-draw timestamps (`lastDrawAtByRoom`) live on the service. The K5 circuit-breaker counter and halt-the-room plumbing remain on the engine — the service routes hook errors through callbacks. Behavior unchanged. See `docs/architecture/modules/backend/DrawOrchestrationService.md`.
- F2-C `refactor/f2c-extract-room-lifecycle-service` (#755): extracted the room-lifecycle flow (`createRoom` / `joinRoom` / `destroyRoom` / `listRoomSummaries` / `getRoomSnapshot`) into a new `RoomLifecycleService`. BingoEngine.ts: 4434 → 4364 LOC (-70). The engine methods are now thin delegates; the K2 lifecycleStore plumbing is hidden behind `releaseAndForgetEviction` / `disarmAllPlayersForRoom` callbacks, and per-room cache eviction (variantConfigByRoom, luckyNumbersByPlayer, drawLocksByRoom, lastDrawAtByRoom, roomLastRoundStartMs) is decoupled via `cleanupRoomLocalCaches`. Behavior unchanged. See `docs/architecture/modules/backend/RoomLifecycleService.md`.
- F2-B `refactor/f2b-extract-claim-submitter` (#749): extracted the full `submitClaim` flow (validation, LINE/BINGO branches, post-transfer audit-trail, recovery-event helper) into a new `ClaimSubmitterService`. BingoEngine.ts: 5330 → 4434 LOC (-659). The engine method `submitClaim` is now a thin delegate (~10 lines: resolve room+game, forward). Behavior unchanged — all idempotency-keys, ledger ordering, PR #741 test-hall semantics, and PILOT-EMERGENCY 2026-04-28 unconditional state-mutation preserved. See `docs/architecture/modules/backend/ClaimSubmitterService.md`.
- F2-A `refactor/f2a-extract-phase-payout-service` (#743): extracted the cap-and-transfer flow from `payoutPhaseWinner` + `submitClaim` LINE/BINGO branches into a new `PhasePayoutService`. BingoEngine.ts: 5436 → 5330 LOC (-106). Behavior unchanged — same idempotency-keys, cap order, logging fields. See `docs/architecture/modules/backend/PhasePayoutService.md`.
- PR #735 (`dc0acfc1`, K3 Bølge): added `assertSpill1NotAdHoc` guard so production retail cannot start a scheduled Spill 1 on the ad-hoc engine — fail-closes regulatorily.
- PR #732 (`7a2c0991`, K2 Bølge): atomic `RoomLifecycleStore` replaces three separate Maps that could drift.
- PR #727 (`b697215e`): trigger mini-game in auto-claim phase for Fullt Hus winner — fixes prod incident 2026-04-29 where mini-game popup never showed.
- PR #726 (`89aab7d2`): cap pattern payout to available RTP-budget + house-balance, add live-room observability.
- PR #725 (`cc7ec64a`): `bet:arm` enforces loss-limit with partial-buy + delayed-render UX.
- PR #724 (`4e255b65`): preserve players with armed/reservation state during stale-wallet cleanup.
- PR #723 (`c1816ad8`): release orphan reservations in startGame to prevent locked-saldo bug.
- PR #717 (`bea47642`): extract `DomainError` from `BingoEngine` to `errors/DomainError.ts` (Stage-1 quick-win).
- PR #695 (`358e8df2`): PR-T1 — deterministic multi-winner tie-breaker (KRITISK-4) via `sortWinnerIdsDeterministic`.
- PR #692 (`8ee441f3`): KRITISK payout-guard + percent-mode mapper-fallback (no-winnings + game-stops).
- PR #687 (`ac9f0539`): gate REST purchase on compliance pre-debit (§23/§66 brudd).
- PR #660 (`05baf614`): Demo Hall bypass — don't pause/end on pattern-win for test halls.
- PR #643 (`7b241a22`): KRITISK — ad-hoc engine auto-pauses after phase-win for Spill 1.
- PR #595 (`4581b3bd`): KRITISK — fixed prizes house-guaranteed (1700 kr paid out even with thin pool).
- PR #595, #604: defensive last-chance `evaluateActivePhase` in endGame + DRAW_BAG_EMPTY + pre-draw MAX_DRAWS guard.
- PR #581 (`2164fc32`): CRIT-6 K3 atomic claim coordinator — recovery-port for post-transfer audit-trail failures.
- PR #389 (`92ca9c78`): split BingoEngine.ts (3886 → 3133 LOC) — extracted `BingoEngineMiniGames`, `BingoEngineRecovery`, `BingoEnginePatternEval`.

## Refactor status (audit-rapport REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md)

- HV-3 in progress: BingoEngine reduced from 5436 → 4464 LOC across F2-A (-106), F2-B (-659), F2-C (-70), and F2-D (+100 net but -248 LOC of orchestration logic; the increase comes from the new callback-port builder). Cumulative ~18% engine-size reduction across four iterations. Engine is still the largest module in the repo but the high-leverage submitClaim+payout chain, the room-lifecycle entry-points, and the draw-orchestration pipeline are now isolated in dedicated services. Audit recommends further extracting the compliance/admin section (loss-limits, self-exclusion, prize-policy, daily-report) into a dedicated `BingoEngineComplianceFacade`.
- F2-A complete: `PhasePayoutService` extracted (cap-and-transfer flow shared across `payoutPhaseWinner`, `submitClaim` LINE, `submitClaim` BINGO). See `docs/architecture/modules/backend/PhasePayoutService.md`.
- F2-B complete: `ClaimSubmitterService` extracted (validation + LINE/BINGO branches + post-transfer audit-trail). Engine method is now a thin delegate that owns only `requireRoom` + `requireRunningGame`. See `docs/architecture/modules/backend/ClaimSubmitterService.md`.
- F2-C complete: `RoomLifecycleService` extracted (createRoom + joinRoom + destroyRoom + read-side projections). Engine methods are now thin delegates; the K2 atomic destroy flow is preserved via callbacks. See `docs/architecture/modules/backend/RoomLifecycleService.md`.
- F2-D complete: `DrawOrchestrationService` extracted (HIGH-5 mutex + MEDIUM-1/BIN-253 interval + guards + bag-shift + hook chain + checkpoint + FULLTHUS-FIX). Engine method `drawNextNumber` is now a thin delegate; the per-room mutex + last-draw timestamp Maps live on the service. See `docs/architecture/modules/backend/DrawOrchestrationService.md`.
- **TODO future bølge:** harmonize `Game1DrawEngineService.Game1PayoutService` with `PhasePayoutService` so scheduled retail games and ad-hoc games share the same cap chain.
- **TODO future bølge:** harmonize `Game1DrawEngineService.processDraw` with `DrawOrchestrationService.drawNext` so scheduled retail Spill 1 and ad-hoc games share the same orchestration. Currently blocked because the scheduled engine is DB-backed (no in-memory `RoomState`) — would need a `RoomState` adapter pattern.
- Method `_drawNextLocked` (now inside `DrawOrchestrationService`) is ~290 LOC and would benefit from being broken into smaller phases (pre-draw guards, draw-from-bag, post-draw evaluation, broadcast).

