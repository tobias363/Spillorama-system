/**
 * BIN-689: Kvikkis integration — full bingo-runde med DEFAULT_QUICKBINGO_CONFIG.
 *
 * Regel fra papir-plan: "Førstemann med full bong vinner 1000 kr".
 *
 * Kvikkis gjenbruker BingoEngine + 75-ball drawbag. Forskjellen fra
 * norsk 5-fase bingo ligger KUN i patterns-listen:
 *   - norsk bingo: 5 patterns (1 Rad → Fullt Hus)
 *   - kvikkis:     1 pattern (Fullt Hus direkte, 1000 kr fast)
 *
 * Testene verifiserer at engine behandler single-pattern-listen som
 * forventet: runden ender KUN når Fullt Hus trigges, og premien er
 * enten 1000 kr (solo) eller floor(1000/N) per spiller ved multi-
 * winner-split. Ingen fase 1-4-evalueringer skjer (ingen LINE-patterns
 * finnes i configen).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_QUICKBINGO_CONFIG } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

// ── Fixture-grids (speil fra BingoEngine.fivePhase.test.ts) ────────────────

const PLAYER_A_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

const PLAYER_B_GRID = [
  [6, 21, 35, 51, 66],
  [7, 22, 36, 52, 67],
  [8, 23, 0, 53, 68],
  [9, 24, 37, 54, 69],
  [10, 25, 38, 55, 70],
];

class PerPlayerTicketAdapter implements BingoSystemAdapter {
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const nameHash = input.player.name.charCodeAt(0);
    const grid = nameHash < "M".charCodeAt(0) ? PLAYER_A_GRID : PLAYER_B_GRID;
    return { grid: grid.map((row) => [...row]) };
  }
}

async function setupRoom(): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
  guestId: string;
}> {
  const engine = new BingoEngine(
    new PerPlayerTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Zoe", walletId: "w-zoe",
  });
  return { engine, roomCode, hostId: hostId!, guestId: guestId! };
}

/** Overstyr drawBag — setter de gitte tallene først så testen blir deterministisk. */
function prioritiseDrawBag(engine: BingoEngine, roomCode: string, numbers: number[]): void {
  const rooms = (engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const preferred: number[] = [];
  const rest: number[] = [];
  const wanted = new Set(numbers);
  for (const n of bag) {
    if (wanted.has(n)) preferred.push(n);
    else rest.push(n);
  }
  preferred.sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

// ── Tester ────────────────────────────────────────────────────────────────

test("BIN-689: Kvikkis-runde — solo vinner får 1000 kr når Fullt Hus trigges", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  // RTP-cap-bug-fix 2026-04-29: entryFee=600 × 2 spillere = 1200 pool;
  // budget=1140 (95%) → 1000 kr Fullt Hus ≤ budget → fullt utbetalt.
  // (Tidligere brukte testen entryFee=500 som ga budget=950; med fixed-
  // prize-bypass passerte testen, men nå capper vi alltid til budget.)
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 600,
    ticketsPerPlayer: 1,
    payoutPercent: 95,
    gameType: "quickbingo",
    variantConfig: DEFAULT_QUICKBINGO_CONFIG,
  });

  // Alle 24 tall (unntatt free=0) fra PLAYER_A_GRID → Fullt Hus.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);

  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  assert.equal(game.status, "ENDED", "Kvikkis-runden skal avsluttes ved Fullt Hus");
  assert.equal(game.endedReason, "BINGO_CLAIMED");

  // Kun én pattern-result: Fullt Hus, vunnet av hostId, 1000 kr.
  const results = game.patternResults ?? [];
  assert.equal(results.length, 1, "Kvikkis skal ha kun én pattern-result");
  const full = results[0];
  assert.equal(full!.patternName, "Fullt Hus");
  assert.equal(full!.isWon, true);
  assert.equal(full!.winnerId, hostId);
  assert.equal(full!.payoutAmount, 1000, "solo vinner skal få hele fastpremien 1000 kr");
});

test("BIN-689: Kvikkis-runde fortsetter ikke etter delvis utfylt bong (ingen LINE-faser)", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 500,
    ticketsPerPlayer: 1,
    payoutPercent: 95,
    gameType: "quickbingo",
    variantConfig: DEFAULT_QUICKBINGO_CONFIG,
  });

  // Kun 5 tall (en hel rad) — dette vinner fase 1 i norsk bingo, men i
  // Kvikkis er det ingen fase 1. Runden må fortsette.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  assert.equal(game.status, "RUNNING", "runden skal fortsette — ingen Fullt Hus ennå");
  const results = game.patternResults ?? [];
  // Kun Fullt Hus-pattern finnes i Kvikkis, og den er ikke vunnet enda.
  assert.equal(results.length, 1);
  assert.equal(results[0]!.isWon, false);
});

test("BIN-689: Kvikkis multi-winner split — 2 spillere deler 1000 kr likt", async () => {
  // Begge spillere får identisk grid → begge vinner Fullt Hus på samme ball.
  const engine = new BingoEngine(
    new PerPlayerTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0 },
  );
  (engine as unknown as {
    bingoAdapter: { createTicket: (input: CreateTicketInput) => Promise<Ticket> };
  }).bingoAdapter = {
    createTicket: async () => ({ grid: PLAYER_A_GRID.map((r) => [...r]) }),
  };
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-alice",
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Zoe",
    walletId: "w-zoe",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 800,
    ticketsPerPlayer: 1,
    payoutPercent: 95,
    gameType: "quickbingo",
    variantConfig: DEFAULT_QUICKBINGO_CONFIG,
  });

  // Begge spillere har samme grid → Fullt Hus trigges på samme ball for begge.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  assert.equal(game.status, "ENDED");

  // Floor-split: 1000 / 2 = 500 per spiller.
  const aliceClaim = game.claims.find((c) => c.playerId === hostId && c.type === "BINGO");
  const zoeClaim = game.claims.find((c) => c.playerId === guestId && c.type === "BINGO");
  assert.ok(aliceClaim, "Alice skal ha BINGO-claim");
  assert.ok(zoeClaim, "Zoe skal ha BINGO-claim");
  assert.equal(aliceClaim!.valid, true);
  assert.equal(zoeClaim!.valid, true);
  assert.equal(aliceClaim!.payoutAmount, 500, "Alice skal få halv split = 500 kr");
  assert.equal(zoeClaim!.payoutAmount, 500, "Zoe skal få halv split = 500 kr");
});
