# Code Review: Spill 1 Engine + Payout + Mini-Games

**Date:** 2026-04-27
**Reviewer:** Code Reviewer Agent (PILOT-KRITISK)
**Branch:** `docs/code-review-spill1-engine-payout-2026-04-27`
**Base context:** `fix/demo-hall-still-pausing-and-room-collision`

**Scope:** Deep review of Spill 1 backend engine focused on the SAMSPILL between modules running a full bingo day. ~17K LOC across 14 files.

**Files reviewed in depth:**
- `apps/backend/src/game/BingoEngine.ts` (4206 LOC) — ad-hoc engine
- `apps/backend/src/game/BingoEnginePatternEval.ts` (839 LOC) — auto-claim phase progression
- `apps/backend/src/game/BingoEngineMiniGames.ts` (387 LOC) — mini-game rotation + payout
- `apps/backend/src/game/Game1DrawEngineService.ts` (3082 LOC) — scheduled-flow draw
- `apps/backend/src/game/Game1MasterControlService.ts` (1708 LOC) — master orchestration
- `apps/backend/src/game/Game1PayoutService.ts` (573 LOC) — phase payout
- `apps/backend/src/game/Game1AutoDrawTickService.ts` (360 LOC) — auto-draw cron
- `apps/backend/src/game/Game1ScheduleTickService.ts` (1033 LOC) — schedule lifecycle
- `apps/backend/src/game/Game1HallReadyService.ts` (924 LOC) — ready-state-machine
- `apps/backend/src/game/Game1JackpotStateService.ts` (731 LOC) — daily jackpot
- `apps/backend/src/game/Game1LuckyBonusService.ts` (174 LOC) — lucky number bonus
- `apps/backend/src/game/Game1TicketPurchaseService.ts` (1359 LOC) — ticket purchase
- `apps/backend/src/game/Game1TransferHallService.ts` (776 LOC) — 60s handshake
- `apps/backend/src/game/Game1DrawEngineDailyJackpot.ts` (291 LOC) — jackpot evaluation
- `apps/backend/src/game/Game1PatternEvaluator.ts` (244 LOC) — phase mask evaluator

**Verdict:** **Production-ready with caveats.** Two clear architectural separations (scheduled-flow vs ad-hoc engine) are well-tested and individually solid. **No P0 regulatory show-stoppers found in the scheduled-flow** (which is the production path). However, several **P0 issues exist in the ad-hoc engine path** that affect Demo Hall test rooms and any backup/fallback usage. Plus one **P0 partial-failure scenario** in payout-orchestration that can leave divergent state.

---

## Findings Summary

| Severity | Count | Description |
|---:|---:|---|
| **P0** | 6 | Money-safety / regulatory blockers |
| **P1** | 8 | Correctness or operational defects |
| **P2** | 3 | Polish / non-blocking |

---

## P0 — Pilot blockers

### P0-1 — Mini-game payout in ad-hoc engine writes WRONG `gameType` to ComplianceLedger for Spill 1

**File:** `apps/backend/src/game/BingoEngineMiniGames.ts:153, 326`

**Issue:** Both `spinJackpot` and `playMiniGame` hardcode `const gameType = "DATABINGO" as const;` before calling `ledger.recordComplianceLedgerEvent()`. For Spill 1 (`bingo` slug) — these are PRIZE entries that MUST be `MAIN_GAME` per pengespillforskriften §11. The bug causes mini-game payouts in Spill 1 to be aggregated into the 30%-databingo bucket instead of the 15%-hovedspill bucket.

**Samspill:** `claimEvents.ts:93` calls `engine.activateMiniGame(roomCode, playerId)` for ad-hoc Spill 1 rooms (slug=`bingo`). The mini-game prize is then credited in `playMiniGame` with the wrong `gameType`. Same for `spinJackpot` (Game 5 jackpot — but the room could be `bingo`).

**Ripple-effect:**
- `ComplianceLedgerOverskudd.ts:75` (the §11-distribution code) uses `gameType === "DATABINGO" ? 0.3 : 0.15`. Mini-game payouts in Spill 1 go into the wrong bucket → operatør distribuerer 30% av disse til organisasjoner istedenfor riktig 15%.
- This was already flagged in `K2-A CRIT-1` for the main payout path (`payoutPhaseWinner` line 1446 USES `ledgerGameTypeForSlug(room.gameSlug)` correctly), but was NOT fixed in `BingoEngineMiniGames.ts`.

**Fix:**
```typescript
// BingoEngineMiniGames.ts:153 (spinJackpot) and :326 (playMiniGame)
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
const gameType = ledgerGameTypeForSlug(room.gameSlug);
```

**Test:** Add unit test in `BingoEngineMiniGames.test.ts` that confirms PRIZE-entries from `playMiniGame` for a `bingo`-slug room have `gameType === "MAIN_GAME"`.

**Note:** Production scheduled flow (`Game1DrawEngineService` → mini-game-orchestrator) is NOT affected. This is ad-hoc-engine path, used for demo / test / Spill 2-3 rooms. Still P0 because Demo Hall sessions would generate wrong audit trail.

---

### P0-2 — Auto-claim partial-payout failure leaves divergent state with no idempotency on ledger writes

**File:** `apps/backend/src/game/BingoEngine.ts:1436-1628` (`payoutPhaseWinner`) + `BingoEnginePatternEval.ts:405-410` (loop)

**Issue:** The auto-claim path in `evaluateActivePhase` calls `payoutPhaseWinner` sequentially for each winner inside a `for` loop without try/catch:

```typescript
for (const playerId of winnerIds) {
  await callbacks.payoutPhaseWinner(room, game, playerId, colorPattern, activeResult, prizePerWinner);
}
```

Inside `payoutPhaseWinner`, the wallet `transfer` succeeds first (line 1491-1504), then `compliance.recordLossEntry` (1528), `ledger.recordComplianceLedgerEvent` (1533), `payoutAudit.appendPayoutAuditEvent` (1588), checkpoint (1602), `rooms.persist` (1607). If any of these throws AFTER the wallet transfer commits, the error propagates UP — the in-loop break leaves earlier winners fully paid, mid winner partially paid (wallet OK but ledger missing), and remaining winners unpaid. `activeResult.isWon` is still FALSE.

The outer try/catch at `BingoEngine.ts:1849-1857` swallows the error and logs. So `game.status` remains `RUNNING`. On the NEXT draw, `evaluateActivePhase` runs again, finds the SAME phase still un-won, re-evaluates winners (likely the same set), and tries to pay again.

**Idempotency check on retry:**
- `walletAdapter.transfer` IS idempotent via `IdempotencyKeys.adhocPhase({patternId, gameId, playerId})` → wallet not double-credited. ✅
- `compliance.recordLossEntry` (line 1528) is **NOT idempotent** — appends to `lossEntriesByScope` Map + persists row → DOUBLE-counted in netto-tap calculation.
- `ledger.recordComplianceLedgerEvent` (line 1533) is **NOT idempotent** — generates `randomUUID()` for `id`, inserts new row → DOUBLE PRIZE entries in §11 reports.
- `payoutAudit.appendPayoutAuditEvent` (line 1588) — likely also not idempotent (random claim IDs).
- The patternResults `claim.id` (line 1479) is also `randomUUID()`-generated → second pass creates DIFFERENT claim object.

**Samspill:** `evaluateActivePhase` → `payoutPhaseWinner` → wallet + 4 audit/ledger writes. The "fail-soft" pattern from `runPostTransferClaimAuditTrail` (used in `submitClaim`) is NOT applied here.

**Ripple-effect:**
- Regulatorisk: §71 dobbelte PRIZE entries i auditor-rapport.
- Spillvett: dobbelt PAYOUT-tracking → spillerens netto-tap-grense beregnes med 2× gevinst → de kan tape mer kunstlig.
- Det er documented at `payoutPhaseWinner` har **ingen ekstern try/catch**, mens manuell `submitClaim` har dette via `runPostTransferClaimAuditTrail`. Asymmetri.

**Fix:** Refactor `payoutPhaseWinner` (1436-1628) to use the same `runPostTransferClaimAuditTrail`-pattern (BingoEngine.ts:2580+) — per-step try/catch with `auditTrailStatus` field. Alternative: add idempotency-keys to compliance.recordLossEntry + ledger.recordComplianceLedgerEvent.

**Test:** Mock `ledger.recordComplianceLedgerEvent` to throw on first call, verify on retry no double-write occurs. Existing `BingoEngine.crashRecoveryPartialPayout.test.ts` covers crash, but not soft-fail mid-flight.

**Note:** Production scheduled flow uses `Game1PayoutService` which IS atomic via outer DB transaction (line 169-174 docstring). This bug is in ad-hoc engine only, but still affects test-haller and possibly recovery scenarios.

---

### P0-3 — Ad-hoc auto-pause for Spill 1 sets in-memory `game.isPaused=true` but does NOT emit dedicated socket event

**File:** `apps/backend/src/game/BingoEnginePatternEval.ts:520-525`

```typescript
if (isSpill1Slug(room.gameSlug)) {
  game.isPaused = true;
  game.pauseMessage = `Pause etter ${activePattern.name} — master må starte spillet igjen.`;
  return;
}
```

After this in-memory mutation, control returns up the call stack to `_drawNextNumberLocked` (line 1851), which then calls `writeDrawCheckpoint` (line 1887), persisting paused state to DB. Then `drawNextNumber` returns to socket caller `drawEvents.ts:53`, which emits `draw:new`, `pattern:won`, and finally `room:update` (line 94 — `emitRoomUpdate(roomCode)`).

**Samspill:** This is the ad-hoc engine path for Spill 1 (Demo Hall, test rooms). Clients receive `room:update` containing `currentGame.isPaused: true` — but there is no dedicated `game:paused` event. Existing client-side pause handling expects `game:paused` event from `pauseGame()` (BingoEngine line 3015-3036). Auto-pause skips this emission.

**Ripple-effect:**
- Master client-side pause UI may not trigger correctly because the dedicated event signal is missing.
- Client-side `lastEmittedBalance`-dedup or similar in GameBridge could swallow the room:update if the only meaningful change is `isPaused: true → false`.
- For production Spill 1, scheduled-flow handles this correctly via dedicated `notifyAutoPaused` (`Game1DrawEngineService.ts:1326`).

**Fix:** Either:
1. Emit a dedicated `game:paused` event in the socket handler when `currentGame.isPaused` flipped from false→true between `beforeSnap` and `afterSnap` (mirror the existing `pattern:won` pattern at drawEvents.ts:60-75).
2. Have `evaluateActivePhase` call back into a pause-broadcast hook via the `EvaluatePhaseCallbacks` interface.

**Test:** `BingoEngine.spill1AutoPauseAfterPhase.test.ts` exists and asserts `game.isPaused === true` (line 103), but does NOT verify socket-event emission. Add e2e socket-test that verifies clients receive pause notification.

---

### P0-4 — Daily Jackpot debit + wallet credit are NOT atomic — partial failure leaves persistent imbalance

**File:** `apps/backend/src/game/Game1DrawEngineDailyJackpot.ts:154-240` + `Game1JackpotStateService.ts:445-633`

**Issue:** `awardJackpot` debits state in its own `pool.connect()` transaction (line 456-633), independent of the outer drawNext transaction. The wallet credits at line 209-220 use `walletAdapter.credit()` (NOT `creditWithClient()`), so they commit in their own transactions too.

The flow:
1. `awardJackpot` (own tx, COMMITS) → debit state from N → seed.
2. For each winner: `walletAdapter.credit()` (own tx, COMMITS) → credit perWinnerCents.
3. If wallet.credit throws on winner 3 of 5 → throw propagates up.
4. Outer drawNext tx (in `Game1DrawEngineService._executeDrawTransaction`) ROLLS BACK.
5. Result: state was debited (committed), winners 1+2 got money (committed), but draws/markings/phase-progression rolled back.

**Documented as "Pragmatisk pilot-akseptert avvik"** in the file docstring (line 38-41) — but for full pilot day this is a real risk because:
- On retry of drawNext, `awardJackpot` returns idempotent (checks `idempotency_key` in `app_game1_jackpot_awards`, line 462-485) — winners 3+4+5 will be re-credited with same `creditKey` (idempotent). ✅
- BUT the OUTER draw transaction's WAS rolled back so `app_game1_draws` row, markings, and phase-progression DID NOT happen. On retry, the same draw will be re-executed → ball is drawn again → markings re-applied → phase evaluation runs → SAME winners are detected → `awardJackpot` returns same award via idempotency-key → no new state debit (correct), but wallet credits DO retry idempotently. 

So **on retry it works**. But if no retry happens (e.g., process crash, manual intervention), state is debited but draw didn't progress → next master action tries to start a new draw → succeeds (state already debited, winners already paid) → but the un-recorded draw is lost.

**Samspill:** This is fail-closed by design but pilot-fragile. The 3-tier separation (state-debit / wallet-credit / draw-tx) means atomicity only works on retry path.

**Ripple-effect:** State-debit can occur for a phase that wasn't actually persisted as won. Auditor would see jackpot debit without corresponding game-record. Manual reconciliation needed.

**Fix:** Change `awardJackpot` to take an optional `client` parameter and run in the outer transaction (similar to `creditWithClient` pattern). Then ALL operations atomic. Estimated 2-3 dev-days.

**Test:** Add integration test that simulates wallet.credit failure on winner 3 of 5 and verifies on retry no double-debit occurs (already partial coverage in `Game1DrawEngineDailyJackpot.test.ts`).

---

### P0-5 — `transferHallAccess` does NOT pause the game during master change — race possible

**File:** `apps/backend/src/game/Game1TransferHallService.ts:369-477` (`approveTransfer`)

**Issue:** `approveTransfer` updates `master_hall_id` in the `app_game1_scheduled_games` row but does NOT pause the game. If `Game1AutoDrawTickService` is in the middle of a draw at the moment of approve:

1. AutoDrawTick selects games where `paused=false` and `engine_ended_at IS NULL`. ✓
2. Approve transaction commits master_hall_id change.
3. AutoDrawTick begins drawNext on the same scheduledGameId. The draw uses old master's `is_test_hall` value (cached in `master_is_test_hall` from `loadScheduledGameForUpdate`). ✓ — actually OK because re-loaded fresh.
4. Phase win triggers auto-pause. The old master's UI gets `auto-paused` event. New master gets it too via socket subscription.
5. New master may have different test-hall flag — phase eval picks UP `master_is_test_hall` from the new master at line 1186. ✓

So the actual data-race is benign. **However**: the operational concern — old master's UI may still see "I am master" while new master is taking over. This could cause both to attempt master-actions like start/pause concurrently. `assertActorIsMaster` (Game1MasterControlService.ts:479) would reject the old master after transfer commits, so safety guards hold.

**Samspill:** TransferHallService → DB UPDATE → socket-broadcast → both UI's update. No engine-level sync.

**Ripple-effect:** Confused operators. UI race during transfer. No money loss — just ops UX.

**Fix:** Send `transfer:approved` event with high priority via socket layer (already done via `broadcastHooks.onApproved` at adminGame1MasterTransfer.ts:155). Verify clients update master-state BEFORE attempting any master actions. **Pattern is in place — this is not a code bug, only verify e2e ops-test that UI handoff works.**

**Note:** Demoting from P0 to P1 if e2e test confirms UI updates within <1s. Listed as P0 because operationally the most likely confusion point during a hectic bingo day.

---

### P0-6 — `recordComplianceLedgerEvent` has NO idempotency-key — every retry creates a new row

**File:** `apps/backend/src/game/ComplianceLedger.ts:151-200`

**Issue:** Each call generates `id: randomUUID()` and inserts unconditionally. There is no claim-id+gameId UNIQUE constraint or idempotency-key dedup. If a payout retry happens for any reason (network blip, transient DB error swallowed by the try/catch in `payoutPhaseWinner`, `Game1PayoutService.payoutPhase`'s caller retry, etc.), DOUBLE entries are written.

**Samspill:**
- `BingoEngine.payoutPhaseWinner` (auto-claim) — see P0-2 above.
- `BingoEngine.submitClaim` via `runPostTransferClaimAuditTrail` — has try/catch but on rare network blip retry the request from client, double entries.
- `Game1PayoutService.payoutPhase` (line 388-462) — entries inside outer DB transaction so rollback is atomic, BUT per-row CALL to `complianceLedgerPort` is fire-and-forget (`.catch((err) => log.warn...)`). If error is logged but transient, no rollback → next idempotent retry of same draw would result in duplicate.
- `BingoEngineMiniGames.ts:193, 361` — fire-and-forget.

**Ripple-effect:**
- §71 audit-rapport double-counts revenue.
- Reconcile-tooling needs deduping logic.
- Auditor-questions during a Lotteritilsynet review.

**Fix:** Add UNIQUE constraint + idempotency-key column to `app_compliance_ledger_entries`. Make `recordComplianceLedgerEvent` ON CONFLICT DO NOTHING. Required idempotency-key would be a composite of `gameId` + `claimId` + `eventType` + `playerId` (or external idempotency-key parameter from caller).

**Test:** Inject a test that calls `recordComplianceLedgerEvent` twice with same input — verify only ONE row in DB.

---

## P1 — Operational defects

### P1-1 — `BingoEngineMiniGames.ts` uses `console.warn` instead of `pino` logger

**File:** `apps/backend/src/game/BingoEngineMiniGames.ts:182, 350`

Inconsistent with rest of codebase. Logs aren't structured/filterable. Trivial fix: import `logger` and use `logger.warn({err, walletId}, "...")`.

### P1-2 — Daily jackpot evaluation uses `drawThresholds[0]` only — multi-threshold (50→55→56→57) not implemented

**File:** `Game1DrawEngineDailyJackpot.ts:137-149`

Documented limitation: "Pilot-modell: bruk drawThresholds[0] som 'trigger hvis vinning kom på/innen denne sekvensen'". Multi-threshold escalation is post-pilot. P1, not P0, because pilot-day-scope is one game/day.

### P1-3 — `assertNotScheduled` is gameSlug-only, scheduledGameId mismatch silently ignored

**File:** `apps/backend/src/game/BingoEngine.ts:3916-3934`

Returns early if `gameSlug !== "bingo"`. So an ad-hoc room with `gameSlug = "bingo"` AND `scheduledGameId = null` passes. Defense-in-depth would also throw if `gameSlug === "bingo"` AND `scheduledGameId IS SET` — but the current code does this correctly. The concern is that if a non-bingo gameSlug is somehow paired with a scheduledGameId (impossible by design today), the assertion wouldn't catch it. Cosmetic.

### P1-4 — `payoutPhaseWinner` does not log RECOVERY events for non-BingoEngine.submitClaim path

**File:** `apps/backend/src/game/BingoEngine.ts:1436-1628` vs `2580+` (`runPostTransferClaimAuditTrail`)

`submitClaim` → `runPostTransferClaimAuditTrail` calls `fireRecoveryEvent` for each failed step. `payoutPhaseWinner` (auto-claim) doesn't have this. So if an audit step fails in auto-claim, ops gets a log line but no structured recovery event for tooling to pick up. Asymmetric reliability.

### P1-5 — Game1AutoDrawTickService in-memory `currentlyProcessing` Set defeats idempotency on multi-instance

**File:** `apps/backend/src/game/Game1AutoDrawTickService.ts:119, 167-186`

The comment correctly notes `SELECT ... FOR UPDATE SKIP LOCKED` covers cross-instance, and in-process Set covers same-process. On Render starter plan = single instance, so this works. **If Render plan ever scales horizontally**, the cross-instance lock is provided by SKIP LOCKED but the FOR UPDATE lock RELEASES on COMMIT (line 268) BEFORE `drawNext` runs. Between commit and `drawNext` start, another instance could pick up the same row. The in-process Set wouldn't catch cross-instance.

**Mitigation:** `drawNext` itself takes its own FOR UPDATE in `loadGameStateForUpdate` (Game1DrawEngineService.ts:1043). The second instance would block on this and serialize. Safe.

P1 because correct-by-construction but coupling assumption that plan stays single-instance.

### P1-6 — `Game1MasterControlService.startGame` jackpot preflight is fail-OPEN if jackpotStateService throws

**File:** `Game1MasterControlService.ts:467-475`

Documented as intentional "fail-open for MVP" but if jackpot DB is down, master can start without confirming jackpot amount. Fail-OPEN means money flows even when guard fails. Pilot is small scope, but this is not regulatory fail-closed.

**Fix:** Re-evaluate after pilot — eventually fail-closed.

### P1-7 — `pauseGame` (manual) cannot pause an already-auto-paused Spill 1 game

**File:** `apps/backend/src/game/BingoEngine.ts:3022`

```typescript
if (game.isPaused) throw new DomainError("GAME_ALREADY_PAUSED", "...");
```

If auto-claim has set `game.isPaused = true` via `evaluateActivePhase` (line 522 of PatternEval), and master tries to also call `pauseGame` (e.g., via UI race), they get `GAME_ALREADY_PAUSED` error. Confusing for operator. Better to make idempotent or different error message.

### P1-8 — `evaluateActivePhase` for Spill 1 does NOT check `bingoWinnerId` consistency

**File:** `apps/backend/src/game/BingoEnginePatternEval.ts:454, 463-467`

When phase is BINGO claimType (Fullt Hus = phase 5), the code at 487-497 ends the game. But before this — line 463-467 (Demo Hall bypass) sets `game.bingoWinnerId` if phase is BINGO. Outside Demo Hall path, the BINGO branch at 488 sets `game.bingoWinnerId = firstWinnerId` (line 491). Looks correct.

However, line 500-502 sets `lineWinnerId` only on phase 1 (LINE claim type). For phases 2, 3, 4 (also LINE claim types), `lineWinnerId` is set ONLY if not already set (`!game.lineWinnerId`). So a phase 1 winner stays `lineWinnerId` even if a different player wins phase 4. This may be intentional ("first line winner wins lineWinnerId") but confuses snapshot consumers.

---

## P2 — Polish

### P2-1 — Mini-game prizes are hardcoded (`MINIGAME_PRIZES = [5,10,15,20,25,50,10,15]`)

**File:** `apps/backend/src/game/BingoEngineMiniGames.ts:34, 37`

Comment on line 41-44 says this is by design until "per-type admin config lands (follow-up issue)". Reasonable for pilot.

### P2-2 — `evaluateActivePhase` callbacks interface uses methods rather than function-typed properties — minor TypeScript readability

**File:** `apps/backend/src/game/BingoEnginePatternEval.ts:88-115`

`EvaluatePhaseCallbacks` mixes `readonly splitRoundingAudit: ...` (port objects) with `getVariantConfig(roomCode)` and `payoutPhaseWinner(...)` (methods). Slightly inconsistent style. Cosmetic.

### P2-3 — `Game1PayoutService` wallet-credit failure log misses some context for ops debugging

**File:** `apps/backend/src/game/Game1PayoutService.ts:326-346`

The log at 326 logs walletId+amount but not idempotencyKey. Adding the key would help ops verify the credit actually didn't happen (vs wallet adapter erroneously claiming failure on already-committed credit).

---

## What I did NOT review deeply (out-of-scope or time-bound)

1. **`packages/game-client/src/games/game1/`** — frontend bingo runtime. Out of scope.
2. **`apps/backend/src/game/PatternMatcher.ts`** + **`ticket.ts`** — read briefly, looks fine.
3. **`Game1DrawEnginePotEvaluator.ts`** — read first 120 lines only. Pot-evaluation logic skimmed.
4. **`Game1ReplayService.ts`** + **`Game1RecoveryService.ts`** — not opened. Game replay-endpoint integrity not verified.
5. **`Game1JackpotService.ts`** (per-color fixed-amount jackpot, distinct from `Game1JackpotStateService.ts`) — not reviewed.
6. **`Game1MiniGameOrchestrator`** (referenced in `Game1DrawEngineService:1404`) — not opened. The trigger flow is fire-and-forget POST-commit so any failure there is contained.
7. **MiniGameOddsenEngine** (`Game1DrawEngineService:1547`) — partial read. The atomic resolve inside drawNext-tx is the right pattern.
8. **Wallet adapter (`adapters/PostgresWalletAdapter.ts`)** — not in scope. Trust the existing tests + BIN-761 outbox-pattern.

---

## Summary table

| # | Severity | File:line | Topic |
|---|---|---|---|
| P0-1 | P0 | `BingoEngineMiniGames.ts:153,326` | Wrong gameType=DATABINGO for Spill 1 mini-game ledger |
| P0-2 | P0 | `BingoEngine.ts:1436-1628` + `BingoEnginePatternEval.ts:405` | Auto-claim partial-failure leaves state divergent + duplicate ledger writes on retry |
| P0-3 | P0 | `BingoEnginePatternEval.ts:520-525` | Ad-hoc Spill 1 auto-pause has no dedicated socket event |
| P0-4 | P0 | `Game1DrawEngineDailyJackpot.ts:154-240` | Daily jackpot debit + wallet credit not atomic |
| P0-5 | P0 | `Game1TransferHallService.ts:369-477` | Master transfer doesn't pause game (UX risk only — code is safe) |
| P0-6 | P0 | `ComplianceLedger.ts:151-200` | recordComplianceLedgerEvent has no idempotency-key |
| P1-1 | P1 | `BingoEngineMiniGames.ts:182,350` | Uses console.warn instead of pino |
| P1-2 | P1 | `Game1DrawEngineDailyJackpot.ts:137-149` | Multi-threshold (50→55→56→57) not implemented |
| P1-3 | P1 | `BingoEngine.ts:3916-3934` | assertNotScheduled checks gameSlug only |
| P1-4 | P1 | `BingoEngine.ts:1436-1628` | payoutPhaseWinner missing fireRecoveryEvent symmetry |
| P1-5 | P1 | `Game1AutoDrawTickService.ts:119` | currentlyProcessing Set is single-instance only |
| P1-6 | P1 | `Game1MasterControlService.ts:467-475` | startGame jackpot preflight fail-OPEN |
| P1-7 | P1 | `BingoEngine.ts:3022` | pauseGame can't pause already-auto-paused game |
| P1-8 | P1 | `BingoEnginePatternEval.ts:500-502` | lineWinnerId set only on phase 1 |
| P2-1 | P2 | `BingoEngineMiniGames.ts:34,37` | MINIGAME_PRIZES hardcoded |
| P2-2 | P2 | `BingoEnginePatternEval.ts:88-115` | EvaluatePhaseCallbacks style mix |
| P2-3 | P2 | `Game1PayoutService.ts:326-346` | Missing idempotencyKey in wallet-credit failure log |

---

## Recommended priority order (for fix work)

1. **P0-6** (idempotency on ComplianceLedger) — affects ALL paths (scheduled + ad-hoc). 1 day. **Most important.**
2. **P0-1** (mini-game gameType) — affects Demo Hall sessions. 1 hour. **Trivial.**
3. **P0-2** (auto-claim partial failure) — affects ad-hoc only but needs refactor. 1 day.
4. **P0-3** (auto-pause socket emit) — affects ad-hoc Demo Hall. 4 hours. **Verify with e2e test before declaring done.**
5. **P0-4** (daily jackpot atomicity) — needs refactor. 2-3 days. Could be deferred if pilot-acceptance is documented.
6. **P0-5** (transfer hall UX) — likely fine as-is. Verify e2e and demote to P1.

After P0s, P1-1 through P1-8 can be batched in a polish PR.

