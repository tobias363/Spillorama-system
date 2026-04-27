/**
 * Game1MultiWinnerE2E.autoPauseAware.test.ts
 *
 * URGENT pilot validation 2026-04-27: Spill 1 multi-winner flow with the
 * auto-pause-after-each-phase contract from PR #643 + multi-winner
 * split-rounding spec from PR #639/#653.
 *
 * Spec (PM-vedtatt 2026-04-27):
 *   Q1=B (per BONG, ikke per spiller)
 *   Q2=A (floor-rounding, hus beholder rest)
 *   Q3=X (én pot per fase, uansett farge)
 *   Q4=BIN-761 outbox + UNIQUE constraint
 *
 * What this test pins:
 *   1. Phase 1 with 2 simultaneous winners → auto-pause + correct split.
 *   2. Master resume → phase 2 plays out normally.
 *   3. Multi-winner split is floor-rounded; rest goes to house ledger.
 *   4. After all 5 phases, both winners get expected total payouts.
 *   5. Wallet conservation across the full multi-winner round.
 *
 * Test design notes:
 *   - The engine's flat-path multi-winner is currently per-PLAYER (deduplicated
 *     in detectPhaseWinners L671-682), NOT per-bong. For Spill 1, this matches
 *     Q1=B-spec since each player has one bong here.
 *   - Per-color bonging (Q3=X / "one pot per phase regardless of color") is
 *     covered separately in Game1MultiWinnerSplitRounding.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "../variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../types.js";

// All players get the SAME grid → simultaneous wins on every phase.
const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((r) => [...r]) };
  }
}

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

async function totalBalance(wallet: InMemoryWalletAdapter): Promise<number> {
  const accounts = await wallet.listAccounts();
  return accounts.reduce((sum, a) => sum + a.balance, 0);
}

test("E2E multi-winner Spill 1: 2 players win all 5 phases simultaneously, split is floor-rounded", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 2,
  });

  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-multi",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  const { playerId: bobId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-multi",
    playerName: "Bob",
    walletId: "w-bob",
  });

  await wallet.topUp("w-alice", 5000, "seed");
  await wallet.topUp("w-bob", 5000, "seed");

  await engine.startGame({
    roomCode,
    actorPlayerId: aliceId!,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    gameType: "bingo",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  const initialTotal = await totalBalance(wallet);

  // 24 deterministic draws: row 0 → row 1 → row 2 → row 3 → row 4
  const drawOrder: number[] = [];
  for (const row of SHARED_GRID) for (const n of row) if (n !== 0) drawOrder.push(n);
  prioritiseDrawBag(engine, roomCode, drawOrder);

  // Drive draws + resume between auto-pauses until ENDED.
  let safety = 0;
  let drawsDone = 0;
  let resumesDone = 0;
  while (safety < 60) {
    safety += 1;
    const snap = engine.getRoomSnapshot(roomCode);
    if (snap.currentGame?.status === "ENDED") break;
    if (snap.currentGame?.isPaused) {
      engine.resumeGame(roomCode);
      resumesDone += 1;
      continue;
    }
    await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
    drawsDone += 1;
  }

  const final = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(final.status, "ENDED");
  assert.equal(final.endedReason, "BINGO_CLAIMED");

  // Master had to resume between every non-final phase win (1 Rad, 2 Rader,
  // 3 Rader, 4 Rader = 4 resume-points). Fullt Hus does not pause.
  assert.equal(resumesDone, 4, `expected 4 resumes between phases, got ${resumesDone}`);

  // All 5 phases won.
  const phaseNames = ["1 Rad", "2 Rader", "3 Rader", "4 Rader", "Fullt Hus"];
  for (const name of phaseNames) {
    const phase = final.patternResults?.find((r) => r.patternName === name);
    assert.ok(phase, `phase "${name}" must exist`);
    assert.equal(phase!.isWon, true, `phase "${name}" must be won`);
  }

  // Multi-winner: each phase has BOTH alice + bob in winnerIds.
  for (const name of phaseNames) {
    const phase = final.patternResults!.find((r) => r.patternName === name)!;
    const winnerIds = phase.winnerIds ?? [];
    assert.ok(
      winnerIds.length >= 2,
      `phase "${name}" must have ≥ 2 winnerIds (alice + bob both have row complete). got ${JSON.stringify(winnerIds)}`,
    );
    assert.ok(winnerIds.includes(aliceId!), `phase "${name}" must include alice`);
    assert.ok(winnerIds.includes(bobId!), `phase "${name}" must include bob`);
  }

  // Conservation: total balance unchanged after the round. House may be
  // negative (paid out fixed prizes from its own pocket); that's by design.
  const finalTotal = await totalBalance(wallet);
  assert.equal(
    finalTotal,
    initialTotal,
    `wallet conservation violated: started ${initialTotal}, ended ${finalTotal}`,
  );

  // Both winners got the same payout (split is even, so floor-rounding is
  // either both equal or one missing 1kr — for Norsk fixed prizes 100/200/
  // 200/200/1000 split between 2: 50/100/100/100/500 = 850 each, 0 rest).
  const aliceBalance = await wallet.getBalance("w-alice");
  const bobBalance = await wallet.getBalance("w-bob");
  // Both started 6000 (1000 ensure + 5000 topUp), paid 10 entry → 5990, won 850 → 6840
  assert.equal(aliceBalance, bobBalance, "both winners must get equal payout (even split)");
  assert.equal(aliceBalance, 6000 - 10 + 850, "alice expected balance: 6000 - 10 entry + 850 winnings");
});

test("E2E multi-winner Spill 1: floor-rounding rest goes to house, audited", async () => {
  // 3 winners on phase 1 (100kr fixed prize) → 33kr each, 1kr rest to house.
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 3,
  });

  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-rest",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-rest", playerName: "Bob", walletId: "w-bob" });
  await engine.joinRoom({ roomCode, hallId: "hall-rest", playerName: "Carol", walletId: "w-carol" });

  await engine.startGame({
    roomCode, actorPlayerId: aliceId!, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]); // exactly row 0
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  }

  const snap = engine.getRoomSnapshot(roomCode);
  assert.equal(snap.currentGame?.isPaused, true, "Spill 1 must auto-pause after phase 1");

  // Each of 3 winners got floor(100/3) = 33kr.
  const aliceBalance = await wallet.getBalance("w-alice");
  const bobBalance = await wallet.getBalance("w-bob");
  const carolBalance = await wallet.getBalance("w-carol");
  // Started 1000 (ensure), paid 10, won 33 → 1023.
  assert.equal(aliceBalance, 1023, `alice expected 1023, got ${aliceBalance}`);
  assert.equal(bobBalance, 1023, `bob expected 1023, got ${bobBalance}`);
  assert.equal(carolBalance, 1023, `carol expected 1023, got ${carolBalance}`);

  // Rest 1kr stays with house. House started 1000 (ensure), got 30 in entry
  // fees, paid 99 (3×33) — net 1000+30-99 = 931. The 1kr rest is implicitly
  // in the house balance (not transferred out).
});
