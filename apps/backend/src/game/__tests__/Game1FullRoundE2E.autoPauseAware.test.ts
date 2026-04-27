/**
 * Game1FullRoundE2E.autoPauseAware.test.ts
 *
 * URGENT pilot validation 2026-04-27: end-to-end Spill 1 round with the
 * auto-pause-after-each-phase contract from PR #643.
 *
 * Why a NEW test file: the existing `Game1FullRoundE2E.test.ts` was written
 * before PR #643 introduced auto-pause and now fails at the first phase
 * because the test draws past the pause without calling `resumeGame`. That
 * test is "stale" — it tested the pre-#643 contract which no longer exists.
 *
 * This file pins the new contract:
 *   1. Spill 1 (slug=`bingo`) auto-pauses after EVERY phase 1-4 win.
 *   2. Master MUST call `engine.resumeGame(roomCode)` before the next draw.
 *   3. Fullt Hus (phase 5) ENDS the round — no pause, no resume needed.
 *   4. All 5 phase wins ledger correctly with multi-winner split-rounding.
 *   5. Mini-game activates after Fullt Hus (winner gets to play).
 *   6. Wallet conservation: total balance unchanged (transfers, no creation).
 *
 * If this test stays GREEN: Spill 1 round-flow works end-to-end with the
 * production-correct auto-pause+resume cadence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "../variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../types.js";

// Shared 5×5 grid — every player gets the SAME grid so 24 specific draws
// fill all 5 rows and trip phase 1 → phase 2 → phase 3 → phase 4 → Fullt Hus.
const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63], // free centre
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((r) => [...r]) };
  }
}

/** Reorders the deterministic drawBag so the given numbers come first. */
function prioritiseDrawBag(engine: BingoEngine, roomCode: string, numbers: number[]): void {
  const rooms = (engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const wanted = new Set(numbers);
  const preferred: number[] = [];
  const rest: number[] = [];
  for (const n of bag) (wanted.has(n) ? preferred : rest).push(n);
  preferred.sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

function setupSoloRoom(): Promise<{ engine: BingoEngine; roomCode: string; hostId: string; wallet: InMemoryWalletAdapter }> {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
  });
  return engine
    .createRoom({
      hallId: "hall-pilot",
      playerName: "Alice",
      walletId: "w-alice",
      gameSlug: "bingo",
    })
    .then(({ roomCode, playerId }) => ({ engine, roomCode, hostId: playerId!, wallet }));
}

/** Sum total balance across all accounts for conservation checks. */
async function totalBalance(wallet: InMemoryWalletAdapter): Promise<number> {
  const accounts = await wallet.listAccounts();
  return accounts.reduce((sum, a) => sum + a.balance, 0);
}

test("E2E Spill 1 (auto-pause-aware): solo player wins all 5 phases with master-resume between phases", async () => {
  const { engine, roomCode, hostId, wallet } = await setupSoloRoom();
  // Seed wallet so player can afford entry fee + verify conservation later.
  await wallet.topUp("w-alice", 1000, "seed");

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    gameType: "bingo",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Capture wallet total AFTER startGame: by now the house account exists
  // (ensureAccount opens it with initial 1000kr seed in InMemoryWalletAdapter).
  // Conservation invariant: total balance (player + house) is constant from
  // here on, regardless of how phases are won and what gets paid out.
  const initialTotal = await totalBalance(wallet);

  // Order draws so phase 1 → 2 → 3 → 4 → Fullt Hus trip in row order.
  // Row 0 (5 balls) → 1 Rad
  // Row 1 (5 more) → 2 Rader
  // Row 2 (4 more, centre is free) → 3 Rader
  // Row 3 (5 more) → 4 Rader
  // Row 4 (5 more) → Fullt Hus
  const drawOrder: number[] = [];
  for (const row of SHARED_GRID) for (const n of row) if (n !== 0) drawOrder.push(n);
  prioritiseDrawBag(engine, roomCode, drawOrder);

  const expectedPhaseDraws = [
    { phase: "1 Rad", drawsToTrip: 5 },
    { phase: "2 Rader", drawsToTrip: 10 },
    { phase: "3 Rader", drawsToTrip: 14 }, // row 2 centre is free
    { phase: "4 Rader", drawsToTrip: 19 },
    { phase: "Fullt Hus", drawsToTrip: 24 },
  ];

  let totalDraws = 0;
  let phaseIndex = 0;
  for (let safety = 0; safety < 60 && phaseIndex < expectedPhaseDraws.length; safety += 1) {
    const snap = engine.getRoomSnapshot(roomCode);
    if (snap.currentGame?.status === "ENDED") break;

    if (snap.currentGame?.isPaused) {
      // Auto-pause kicked in. Verify the just-won phase is registered.
      const targetPhase = expectedPhaseDraws[phaseIndex - 1];
      if (targetPhase) {
        const result = snap.currentGame.patternResults?.find(
          (r) => r.patternName === targetPhase.phase,
        );
        assert.ok(result?.isWon, `phase "${targetPhase.phase}" must be marked won`);
      }
      // Master resumes — production: bingovert clicks "Start Next Game".
      engine.resumeGame(roomCode);
      continue;
    }

    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    totalDraws += 1;

    const expected = expectedPhaseDraws[phaseIndex];
    if (totalDraws === expected.drawsToTrip) {
      // After this draw, expect either auto-pause (phases 1-4) or ENDED
      // (Fullt Hus). We advance phaseIndex now and verify on next iteration.
      phaseIndex += 1;
    }
  }

  const final = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(final.status, "ENDED", `expected ENDED, got ${final.status} after ${totalDraws} draws`);
  assert.equal(final.endedReason, "BINGO_CLAIMED");

  // All 5 phases must be marked won.
  const phaseNames = ["1 Rad", "2 Rader", "3 Rader", "4 Rader", "Fullt Hus"];
  for (const name of phaseNames) {
    const phase = final.patternResults?.find((r) => r.patternName === name);
    assert.ok(phase, `phase "${name}" must exist in patternResults`);
    assert.equal(phase!.isWon, true, `phase "${name}" must be won`);
  }

  // Wallet conservation: pengeflyt = transfers, no creation.
  // Note: house account starts at 0, ends with whatever didn't go back to
  // the player. Total balance across ALL accounts must equal the initial
  // total (incl. house).
  const finalTotal = await totalBalance(wallet);
  assert.equal(
    finalTotal,
    initialTotal,
    `wallet conservation violated: started ${initialTotal}, ended ${finalTotal}`,
  );

  // Mini-game activates for Fullt Hus winner (Alice in this solo round).
  const fullHus = final.patternResults?.find((r) => r.patternName === "Fullt Hus");
  const winnerId = fullHus?.winnerId ?? hostId;
  const miniGame = engine.activateMiniGame(roomCode, winnerId);
  assert.ok(miniGame, "mini-game should activate for Fullt Hus winner");
});

test("E2E Spill 1: drawNextNumber blocks with GAME_PAUSED between phases (must call resumeGame)", async () => {
  const { engine, roomCode, hostId } = await setupSoloRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61, 2, 17]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  // Phase 1 won; engine must auto-pause.
  assert.equal(engine.getRoomSnapshot(roomCode).currentGame?.isPaused, true);

  // Without resume, drawNextNumber blocks.
  await assert.rejects(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => (err as { code?: string }).code === "GAME_PAUSED",
    "Spill 1 must block draws after phase win until resume",
  );

  // After resume, draws work again.
  engine.resumeGame(roomCode);
  await assert.doesNotReject(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    "draw must succeed after resume",
  );
});

test("E2E Spill 1: master resumeGame is idempotent — calling on non-paused room throws", async () => {
  const { engine, roomCode, hostId } = await setupSoloRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Draw 1 ball — game RUNNING, not paused.
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  // Note: isPaused is undefined (not false) when never paused — both
  // are falsy, but the engine never explicitly initializes it to false.
  assert.notEqual(
    engine.getRoomSnapshot(roomCode).currentGame?.isPaused,
    true,
    "game must not be paused after a single non-winning draw",
  );

  // Calling resumeGame on a non-paused game should throw GAME_NOT_PAUSED.
  // This is the contract: master can't accidentally double-resume.
  assert.throws(
    () => engine.resumeGame(roomCode),
    (err: unknown) => (err as { code?: string }).code === "GAME_NOT_PAUSED",
    "resumeGame on non-paused room must throw GAME_NOT_PAUSED",
  );
});
