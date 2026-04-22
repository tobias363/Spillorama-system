/**
 * PR-P4 (Ball × 10): ball-value-multiplier Fullt-Hus-premie.
 *
 * Papir-regel (SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md):
 *   Full bong = 1250 + (bingo-tall × 10)
 *
 * Dvs.: Fullt Hus-premie = baseFullHousePrizeNok + lastBall × multiplier.
 * Bruker rå ball-nummerverdi (ikke kolonne som P3).
 *
 * Dekning:
 *   1-3. Siste ball 1 / 34 / 65 → base + ball × mult
 *   4.   Multi-winner split på multiplier-total
 *   5-6. Felter mangler → fail-closed (fase uvunnet)
 *   7.   multiplier = 0 → fail-closed
 *   8.   DomainError-kode-sanity
 *   9.   Regresjon: percent-mode urørt
 *   10.  Regresjon: P3 column-specific urørt
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine, DomainError } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { GameVariantConfig, PatternConfig } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class SharedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: GRID.map((row) => [...row]) };
  }
}

function ballValueConfig(
  // Bruk null som sentinel for "mangler" — `undefined` + default-param
  // ville erstattet manglende verdi med default.
  base: number | null = 1250,
  mult: number | null = 10,
): GameVariantConfig {
  const fullHouse: PatternConfig = {
    name: "Fullt Hus",
    claimType: "BINGO",
    prizePercent: 0,
    design: 0,
    winningType: "ball-value-multiplier",
  };
  if (base !== null) fullHouse.baseFullHousePrizeNok = base;
  if (mult !== null) fullHouse.ballValueMultiplier = mult;
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [fullHouse],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
}

async function setupRoom(
  variantConfig: GameVariantConfig,
  playerCount = 1,
): Promise<{ engine: BingoEngine; roomCode: string; hostId: string }> {
  const engine = new BingoEngine(
    new SharedTicketAdapter(),
    new InMemoryWalletAdapter(),
    {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
      dailyLossLimit: 1_000_000,
      monthlyLossLimit: 10_000_000,
    },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
  });
  for (let i = 1; i < playerCount; i += 1) {
    await engine.joinRoom({
      roomCode,
      hallId: "h",
      playerName: `P${i}`,
      walletId: `w-p-${i}`,
    });
  }
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 1000,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig,
  });
  return { engine, roomCode, hostId: hostId! };
}

/**
 * Sorter drawBag slik at valgt ball trekkes SIST av de 24 grid-tallene
 * (dvs. den fullfører Full House). `lastBall` MÅ være i GRID — ellers
 * vinner spillet aldri Full House.
 */
function priorityOrderLast(
  engine: BingoEngine,
  roomCode: string,
  lastBall: number,
): void {
  const allGridNumbers: number[] = [];
  for (const row of GRID) for (const n of row) if (n !== 0) allGridNumbers.push(n);
  if (!allGridNumbers.includes(lastBall)) {
    throw new Error(
      `priorityOrderLast: lastBall ${lastBall} er ikke i GRID — ` +
        "test-scenarioet kan ikke vinne Full House",
    );
  }
  const rest = allGridNumbers.filter((n) => n !== lastBall);
  const ordered = [...rest, lastBall];
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const wanted = new Set(ordered);
  const preferred: number[] = [];
  const leftover: number[] = [];
  for (const n of bag) {
    if (wanted.has(n)) preferred.push(n);
    else leftover.push(n);
  }
  preferred.sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...leftover);
}

// ── Core payout-beregning ────────────────────────────────────────────────────

// Siste ball må være i GRID — ellers vinnes Full House aldri. GRID har
// 1, 34, 65 representative for lav/mellom/høy. Ball 45 brukt i papir-regel
// er ikke i test-grid, så vi bruker 34 som N-kol-proxy.
const CASES: Array<{ lastBall: number; expectedPrize: number }> = [
  { lastBall: 1, expectedPrize: 1250 + 1 * 10 },   // 1260
  { lastBall: 34, expectedPrize: 1250 + 34 * 10 }, // 1590
  { lastBall: 65, expectedPrize: 1250 + 65 * 10 }, // 1900
];

for (const c of CASES) {
  test(`PR-P4: Fullt Hus — siste ball ${c.lastBall} → base(1250) + ${c.lastBall}×10 = ${c.expectedPrize} kr`, async () => {
    // Pool må være ≥ expectedPrize for å unngå RTP-cap. 1 spiller × 1000 kr
    // dekker 1260 (case 1). Case 2 (1590) og 3 (1900) trenger 2 spillere
    // × 1000 = 2000 kr pool.
    const players = c.expectedPrize > 1000 ? 2 : 1;
    const { engine, roomCode, hostId } = await setupRoom(
      ballValueConfig(),
      players,
    );
    priorityOrderLast(engine, roomCode, c.lastBall);
    for (let i = 0; i < 24; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    }
    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    assert.equal(
      game.drawnNumbers[game.drawnNumbers.length - 1],
      c.lastBall,
      "siste ball må matche test-spec",
    );
    const bingoClaims = game.claims.filter((cl) => cl.type === "BINGO");
    assert.ok(bingoClaims.length > 0, "Fullt Hus-claim må finnes");
    const totalPayout = bingoClaims.reduce(
      (sum, cl) => sum + (cl.payoutAmount ?? 0),
      0,
    );
    assert.equal(
      totalPayout,
      c.expectedPrize,
      `total payout = base + ball × mult = ${c.expectedPrize}`,
    );
  });
}

test("PR-P4: multi-winner split = floor(total / count) med house-rest", async () => {
  // 3 spillere × 1000 = pool 3000. Last ball = 34 → 1250 + 340 = 1590.
  // floor(1590 / 3) = 530, rest = 0 (deler jevnt).
  const { engine, roomCode, hostId } = await setupRoom(ballValueConfig(), 3);
  priorityOrderLast(engine, roomCode, 34);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingoClaims = game.claims.filter((c) => c.type === "BINGO");
  assert.equal(bingoClaims.length, 3, "3 BINGO-claims");
  for (const c of bingoClaims) {
    assert.equal(c.payoutAmount, 530, "floor(1590 / 3) = 530 per vinner");
  }
});

// ── Fail-closed: felt mangler ───────────────────────────────────────────────

test("PR-P4: ball-value-multiplier uten baseFullHousePrizeNok → fase uvunnet", async () => {
  const config = ballValueConfig(null, 10);
  const { engine, roomCode, hostId } = await setupRoom(config);
  priorityOrderLast(engine, roomCode, 34);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(
    game.claims.filter((c) => c.type === "BINGO").length,
    0,
    "ingen BINGO-claim når base mangler",
  );
  const fullHouse = game.patternResults?.find((r) => r.patternName === "Fullt Hus");
  assert.equal(fullHouse?.isWon, false, "Fullt Hus IKKE vunnet");
});

test("PR-P4: ball-value-multiplier uten ballValueMultiplier → fase uvunnet", async () => {
  const config = ballValueConfig(1250, null);
  const { engine, roomCode, hostId } = await setupRoom(config);
  priorityOrderLast(engine, roomCode, 34);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(
    game.claims.filter((c) => c.type === "BINGO").length,
    0,
    "ingen BINGO-claim når multiplier mangler",
  );
});

test("PR-P4: ball-value-multiplier = 0 → fail-closed (guard mult > 0)", async () => {
  const config = ballValueConfig(1250, 0);
  const { engine, roomCode, hostId } = await setupRoom(config);
  priorityOrderLast(engine, roomCode, 34);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(
    game.claims.filter((c) => c.type === "BINGO").length,
    0,
    "ingen BINGO-claim når multiplier=0",
  );
});

test("PR-P4: DomainError-kode BALL_VALUE_FIELDS_MISSING er gyldig", () => {
  const err = new DomainError("BALL_VALUE_FIELDS_MISSING", "test");
  assert.equal(err.code, "BALL_VALUE_FIELDS_MISSING");
});

// ── Regresjon: andre winning-typer uendret ─────────────────────────────────

test("PR-P4: regresjon — percent-mode full_house urørt", async () => {
  const config: GameVariantConfig = {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [
      {
        name: "Full House",
        claimType: "BINGO",
        prizePercent: 50,
        design: 0,
      },
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(config);
  priorityOrderLast(engine, roomCode, 65);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.equal(bingo?.payoutAmount, 500, "percent-mode: 50 % av 1000 = 500");
});

test("PR-P4: regresjon — P3 column-specific full_house urørt", async () => {
  const config: GameVariantConfig = {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [
      {
        name: "Fullt Hus",
        claimType: "BINGO",
        prizePercent: 0,
        design: 0,
        winningType: "column-specific",
        columnPrizesNok: { B: 500, I: 700, N: 1000, G: 700, O: 500 },
      },
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(config);
  priorityOrderLast(engine, roomCode, 34); // N-kol → 1000 kr
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.equal(bingo?.payoutAmount, 1000, "P3 column-specific uendret");
});
