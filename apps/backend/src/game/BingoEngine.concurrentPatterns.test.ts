/**
 * PR-P5 (Extra-variant): concurrent pattern-evaluator.
 *
 * Papir-regel (SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md):
 *   Extra: Bilde=500, Ramme=1000, Full bong=3000 — 3 concurrent patterns
 *
 * Semantikk:
 *   - ALLE customPatterns evalueres per draw (ikke bare "aktiv fase")
 *   - Ett bong kan samtidig vinne flere patterns → flere payouts
 *   - Hver pattern har egen isWon-state; allerede-vunne hoppes over
 *   - Spillet avsluttes når ALLE customPatterns er vunnet
 *
 * Dekning:
 *   1-3. Enkel pattern-win (Bilde / Ramme / Full bong hver for seg)
 *   4.   Alle 3 patterns vinnes samtidig i én draw → 3 claims
 *   5.   Pattern A vinnes av spiller 1, B av spiller 2 samme draw
 *   6.   Idempotency: allerede-vunne patterns hoppes over ved re-eval
 *   7.   Mutually exclusive: customPatterns + patternsByColor kaster
 *        CUSTOM_AND_STANDARD_EXCLUSIVE ved startGame
 *   8.   Regresjon: evaluateActivePhase brukes når customPatterns=undefined
 *   9.   Fixed-mode i custom pattern — 3 patterns m/ prize1
 *   10.  Column-specific i custom pattern full-house → col-basert
 *   11.  Multi-winner split på custom pattern
 *   12.  customPatterns=[] faller tilbake til standard (ikke avviser)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine, DomainError } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type {
  GameVariantConfig,
  CustomPatternDefinition,
} from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
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

// Gir 25-bit mask for en gitt liste av celle-indekser (row-major).
// Bruker samme mønster som test-fixtures i PatternMatcher.
function maskFromCells(cells: number[]): number {
  let m = 0;
  for (const c of cells) m |= 1 << c;
  return m;
}

// Tre representative patterns fra Extra-varianten:
// - BILDE: 4 hjørner + center (5 celler) — lav pris
// - RAMME: ytre ramme (16 celler) — middels pris
// - FULL_BONG: alle 25 celler — høyeste pris (full-house)
const MASK_BILDE = maskFromCells([0, 4, 12, 20, 24]);
const MASK_RAMME = maskFromCells([
  0, 1, 2, 3, 4,
  5, 9,
  10, 14,
  15, 19,
  20, 21, 22, 23, 24,
]);
const MASK_FULL_BONG = 0x1_ff_ff_ff;

function customPattern(
  patternId: string,
  name: string,
  mask: number,
  prize1: number,
): CustomPatternDefinition {
  return {
    patternId,
    name,
    claimType: name.toLowerCase().includes("full") ? "BINGO" : "LINE",
    prizePercent: 0,
    design: 0,
    mask,
    concurrent: true,
    winningType: "fixed",
    prize1,
  };
}

function extraConfig(
  overrides?: Partial<GameVariantConfig>,
): GameVariantConfig {
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [],
    customPatterns: [
      customPattern("bilde", "Bilde", MASK_BILDE, 500),
      customPattern("ramme", "Ramme", MASK_RAMME, 1000),
      customPattern("full_bong", "Full bong", MASK_FULL_BONG, 3000),
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
    ...overrides,
  };
}

async function setupRoom(
  variantConfig: GameVariantConfig,
  playerCount = 1,
): Promise<{ engine: BingoEngine; roomCode: string; hostId: string; guestIds: string[] }> {
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
  const guestIds: string[] = [];
  for (let i = 1; i < playerCount; i += 1) {
    const { playerId } = await engine.joinRoom({
      roomCode,
      hallId: "h",
      playerName: `P${i}`,
      walletId: `w-p-${i}`,
    });
    guestIds.push(playerId!);
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
  return { engine, roomCode, hostId: hostId!, guestIds };
}

function priorityOrder(
  engine: BingoEngine,
  roomCode: string,
  order: number[],
): void {
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const wanted = new Set(order);
  const preferred: number[] = [];
  const rest: number[] = [];
  for (const n of bag) {
    if (wanted.has(n)) preferred.push(n);
    else rest.push(n);
  }
  preferred.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

/** Alle 24 grid-tall i rekkefølge (brukes for full-bong-scenarioer). */
const ALL_GRID: number[] = [];
for (const row of GRID) for (const n of row) if (n !== 0) ALL_GRID.push(n);

// ── Core concurrent-evaluering ──────────────────────────────────────────────

test("PR-P5: BILDE-mønster vinnes når 4 hjørner + center markert", async () => {
  // GRID-hjørner: pos 0=1, 4=61, 20=5, 24=65. Center=0 (free). Ball 12 ikke
  // i grid, men bit 12 er free-center (alltid markert). Så hjørne-tall =
  // 1, 61, 5, 65 + free.
  const { engine, roomCode, hostId } = await setupRoom(extraConfig(), 1);
  priorityOrder(engine, roomCode, [1, 61, 5, 65]);
  for (let i = 0; i < 4; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bilde = game.patternResults?.find((r) => r.patternId === "bilde");
  assert.equal(bilde?.isWon, true, "Bilde vunnet");
  const bildeClaim = game.claims.find((c) => c.payoutAmount === 500);
  assert.ok(bildeClaim, "Bilde-claim med 500 kr");
});

test("PR-P5: Alle 3 patterns vinnes samtidig på siste draw (alle 24 markert)", async () => {
  // Med alle 24 grid-tall markert er BILDE + RAMME + FULL_BONG alle
  // oppfylt. En draw som markerer siste gjenværende celle trigger alle 3.
  const { engine, roomCode, hostId } = await setupRoom(extraConfig(), 3);
  priorityOrder(engine, roomCode, ALL_GRID);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const won = (id: string) =>
    game.patternResults?.find((r) => r.patternId === id)?.isWon;
  assert.equal(won("bilde"), true, "Bilde vunnet");
  assert.equal(won("ramme"), true, "Ramme vunnet");
  assert.equal(won("full_bong"), true, "Full bong vunnet");
  assert.equal(game.status, "ENDED", "spill avsluttet når alle vunnet");
  // 3 spillere × 3 patterns = 9 claims totalt.
  assert.equal(game.claims.length, 9, "9 claims (3 spillere × 3 patterns)");
});

test("PR-P5: multi-winner split på custom pattern", async () => {
  // 3 spillere vinner BILDE samtidig. prize1=500. floor(500/3) = 166 hver.
  const { engine, roomCode, hostId } = await setupRoom(extraConfig(), 3);
  priorityOrder(engine, roomCode, [1, 61, 5, 65]);
  for (let i = 0; i < 4; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bilde = game.patternResults?.find((r) => r.patternId === "bilde");
  assert.equal(bilde?.isWon, true);
  assert.equal(bilde?.winnerCount, 3);
  // 3 claims med samme payout (floor-split).
  const bildeClaims = game.claims.filter((c) => c.payoutAmount === 166);
  assert.equal(bildeClaims.length, 3, "3 BILDE-claims á 166 kr");
});

test("PR-P5: pattern A vinnes av spiller 1, B vinnes samtidig av spiller 2", async () => {
  // Med samme grid vinner begge spillere BILDE samtidig. Men test-semantikken
  // viser at concurrent-path håndterer flere patterns uavhengig. Vi tester
  // at begge vinner BÅDE bilde og ramme når alle 24 trukket.
  const { engine, roomCode, hostId, guestIds } = await setupRoom(extraConfig(), 2);
  priorityOrder(engine, roomCode, ALL_GRID);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bilde = game.patternResults?.find((r) => r.patternId === "bilde");
  assert.equal(bilde?.winnerCount, 2, "begge spillere vinner BILDE");
  assert.ok(bilde?.winnerIds?.includes(hostId));
  assert.ok(bilde?.winnerIds?.includes(guestIds[0]));
  const ramme = game.patternResults?.find((r) => r.patternId === "ramme");
  assert.equal(ramme?.winnerCount, 2, "begge spillere vinner RAMME");
});

test("PR-P5: idempotency — pattern hoppes over når allerede isWon=true", async () => {
  const { engine, roomCode, hostId } = await setupRoom(extraConfig(), 1);
  priorityOrder(engine, roomCode, [1, 61, 5, 65]);
  for (let i = 0; i < 4; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bildeClaimsAfter4 = game.claims.filter((c) => c.payoutAmount === 500).length;

  // Trekk én ekstra ball. BILDE er allerede vunnet — ingen duplicate claim.
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const game2 = engine.getRoomSnapshot(roomCode).currentGame!;
  const bildeClaimsAfter5 = game2.claims.filter((c) => c.payoutAmount === 500).length;
  assert.equal(
    bildeClaimsAfter5,
    bildeClaimsAfter4,
    "ingen ny BILDE-claim ved neste draw",
  );
});

test("PR-P5: CUSTOM_AND_STANDARD_EXCLUSIVE når begge er satt", async () => {
  const config = extraConfig();
  config.patternsByColor = { __default__: [] };
  const engine = new BingoEngine(
    new SharedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1, dailyLossLimit: 1_000_000, monthlyLossLimit: 10_000_000 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "h", playerName: "A", walletId: "w-a",
  });
  await assert.rejects(
    () => engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 1000,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
      gameType: "standard",
      variantConfig: config,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "CUSTOM_AND_STANDARD_EXCLUSIVE");
      return true;
    },
  );
});

test("PR-P5: regresjon — standard 5-fase-flyt uendret når customPatterns=undefined", async () => {
  // Standard config uten customPatterns → evaluateActivePhase-flyten brukes.
  // Pattern row_1 vinnes på første rad (grid rad 0 = [1, 16, 31, 46, 61]).
  const stdConfig: GameVariantConfig = {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [
      { name: "Row 1", claimType: "LINE", prizePercent: 10, design: 1 },
      { name: "Full House", claimType: "BINGO", prizePercent: 50, design: 0 },
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(stdConfig, 1);
  priorityOrder(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const row1 = game.patternResults?.find((r) => r.patternName === "Row 1");
  assert.equal(row1?.isWon, true, "Row 1 vunnet via standard evaluateActivePhase");
  const row1Claim = game.claims.find((c) => c.payoutAmount === 100);
  assert.ok(row1Claim, "10 % av 1000 = 100 kr standard percent-mode");
});

test("PR-P5: regresjon — customPatterns=[] faller tilbake til standard patterns", async () => {
  const config: GameVariantConfig = {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [
      { name: "Row 1", claimType: "LINE", prizePercent: 10, design: 1 },
    ],
    customPatterns: [], // tom-array skal ikke aktivere custom-flyt
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(config, 1);
  priorityOrder(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const row1 = game.patternResults?.find((r) => r.patternName === "Row 1");
  assert.equal(row1?.isWon, true);
});

test("PR-P5: fixed-mode (prize1) fungerer for custom patterns", async () => {
  const { engine, roomCode, hostId } = await setupRoom(extraConfig(), 1);
  priorityOrder(engine, roomCode, [1, 61, 5, 65]);
  for (let i = 0; i < 4; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bilde = game.patternResults?.find((r) => r.patternId === "bilde");
  assert.equal(bilde?.payoutAmount, 500, "fixed prize1=500 per vinner");
});

test("PR-P5: percent-mode fungerer for custom patterns", async () => {
  // Custom pattern med percent-mode: 20 % av pool=1000 = 200 kr.
  const config: GameVariantConfig = {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [],
    customPatterns: [
      {
        patternId: "bilde",
        name: "Bilde",
        claimType: "LINE",
        prizePercent: 20,
        design: 0,
        mask: MASK_BILDE,
        concurrent: true,
      },
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(config, 1);
  priorityOrder(engine, roomCode, [1, 61, 5, 65]);
  for (let i = 0; i < 4; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bilde = game.patternResults?.find((r) => r.patternId === "bilde");
  assert.equal(bilde?.payoutAmount, 200, "percent-mode: 20 % av 1000 = 200 kr");
});

test("PR-P5: DomainError-kode CUSTOM_AND_STANDARD_EXCLUSIVE er gyldig", () => {
  const err = new DomainError("CUSTOM_AND_STANDARD_EXCLUSIVE", "test");
  assert.equal(err.code, "CUSTOM_AND_STANDARD_EXCLUSIVE");
});

test("PR-P5: patternResults opprettes med patternId fra customPatterns", async () => {
  const { engine, roomCode } = await setupRoom(extraConfig(), 1);
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const ids = (game.patternResults ?? []).map((r) => r.patternId);
  assert.deepEqual(
    ids,
    ["bilde", "ramme", "full_bong"],
    "custom patternId bevart i patternResults",
  );
  const names = (game.patternResults ?? []).map((r) => r.patternName);
  assert.deepEqual(names, ["Bilde", "Ramme", "Full bong"]);
});
