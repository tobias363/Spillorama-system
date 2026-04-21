/**
 * PR B (variantConfig-admin-kobling): integrasjonstester for BingoEngine
 * med per-farge pattern-matrise (patternsByColor). PM-vedtak 2026-04-21
 * "Option X": hver farge = uavhengig matrise, multi-winner-split innen
 * én farges vinnere.
 *
 * Dekning:
 *   1. Per-farge fixed-beløp: 2 spillere med ulike farger får ulike premier
 *      i samme fase.
 *   2. Multi-winner innen samme farge: splittes likt (uavhengig av andre farger).
 *   3. Forskjellige percent-matriser per farge.
 *   4. Fallback til __default__ for farge uten eksplisitt matrise.
 *   5. Spiller med brett i to farger vinner i begge (aggregeres i winnerIds).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  PATTERNS_BY_COLOR_DEFAULT_KEY,
  type GameVariantConfig,
  type PatternConfig,
} from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

/** Grid der hel rad 0 (1,16,31,46,61) vinner fase 1. Free centre idx 12. */
const WINNING_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

/** Grid for spiller som IKKE vinner på samme balls (tall 71-75). */
const NON_WINNING_GRID = [
  [71, 76, 81, 86, 91], // utenfor 1-75 bag, vil aldri trekkes
  [72, 77, 82, 87, 92],
  [73, 78, 0, 88, 93],
  [74, 79, 83, 89, 94],
  [75, 80, 84, 90, 95],
];

/**
 * Adapter som tildeler gitt grid + farge per (spiller, ticket-index) via
 * en lookup-tabell. Brukt for å kontrollere hvilken farge hver spillers
 * brett har i per-farge-testene.
 */
class PerColorTicketAdapter implements BingoSystemAdapter {
  private readonly lookup: Map<string, { grid: number[][]; color: string; type: string }> = new Map();

  setTicketFor(
    playerName: string,
    ticketIndex: number,
    grid: number[][],
    color: string,
    type = "small",
  ): void {
    this.lookup.set(`${playerName}:${ticketIndex}`, { grid, color, type });
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const entry = this.lookup.get(`${input.player.name}:${input.ticketIndex}`);
    if (entry) {
      return {
        grid: entry.grid.map((row) => [...row]),
        color: entry.color,
        type: entry.type,
      };
    }
    // Default: ikke-vinnende grid, farge fra input.
    return {
      grid: NON_WINNING_GRID.map((row) => [...row]),
      color: input.color,
      type: input.type,
    };
  }
}

/** Build variantConfig med per-farge fixed-priser for fase 1. */
function makePerColorVariant(
  colorPrizes: Record<string, { phase1Prize1: number; mode?: "fixed" | "percent" }>,
): GameVariantConfig {
  const patternsByColor: Record<string, PatternConfig[]> = {
    [PATTERNS_BY_COLOR_DEFAULT_KEY]: [...DEFAULT_NORSK_BINGO_CONFIG.patterns],
  };
  const ticketTypes = [...DEFAULT_NORSK_BINGO_CONFIG.ticketTypes];
  for (const [color, spec] of Object.entries(colorPrizes)) {
    // Sikre at fargen finnes i ticketTypes.
    if (!ticketTypes.some((t) => t.name === color)) {
      ticketTypes.push({ name: color, type: "small", priceMultiplier: 1, ticketCount: 1 });
    }
    const patterns: PatternConfig[] = DEFAULT_NORSK_BINGO_CONFIG.patterns.map((p, i) => {
      if (i === 0) {
        if (spec.mode === "percent") {
          return { ...p, winningType: undefined, prize1: undefined, prizePercent: spec.phase1Prize1 };
        }
        return { ...p, winningType: "fixed", prize1: spec.phase1Prize1, prizePercent: 0 };
      }
      return { ...p };
    });
    patternsByColor[color] = patterns;
  }
  return {
    ...DEFAULT_NORSK_BINGO_CONFIG,
    ticketTypes,
    patternsByColor,
  };
}

async function setupRoomWithAdapter(adapter: PerColorTicketAdapter): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
  guestId: string;
}> {
  const engine = new BingoEngine(adapter, new InMemoryWalletAdapter(), { minDrawIntervalMs: 0 });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });
  return { engine, roomCode, hostId: hostId!, guestId: guestId! };
}

/** Overstyr drawBag — setter gitt tall først. */
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

// ── Tester ─────────────────────────────────────────────────────────────────

test("PR B: to spillere med ulike farger får ulike fixed-premier i samme fase", async () => {
  const adapter = new PerColorTicketAdapter();
  // Alice har Small White winning-grid, Bob har Small Yellow winning-grid.
  adapter.setTicketFor("Alice", 0, WINNING_GRID, "Small White");
  adapter.setTicketFor("Bob", 0, WINNING_GRID, "Small Yellow");

  const variantConfig = makePerColorVariant({
    "Small White":  { phase1Prize1: 100 },  // Alice får 100 kr
    "Small Yellow": { phase1Prize1: 50 },   // Bob får 50 kr
  });

  const { engine, roomCode, hostId } = await setupRoomWithAdapter(adapter);
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);

  const aliceClaim = game.claims.find((c) => c.playerId === hostId);
  const bobClaim = game.claims.find((c) => c.playerId !== hostId);
  assert.ok(aliceClaim);
  assert.ok(bobClaim);
  // Per Option X: hver farge har egen matrise — uavhengig premie.
  assert.equal(aliceClaim!.payoutAmount, 100, "Small White → 100 kr");
  assert.equal(bobClaim!.payoutAmount, 50, "Small Yellow → 50 kr");
});

test("PR B: multi-winner i samme farge splittes innen farge-gruppen", async () => {
  const adapter = new PerColorTicketAdapter();
  // Begge Alice + Bob har Small White winning-grid → de deler Small White-premien.
  adapter.setTicketFor("Alice", 0, WINNING_GRID, "Small White");
  adapter.setTicketFor("Bob", 0, WINNING_GRID, "Small White");

  const variantConfig = makePerColorVariant({
    "Small White": { phase1Prize1: 100 },
  });

  const { engine, roomCode, hostId } = await setupRoomWithAdapter(adapter);
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);
  assert.equal(phase1?.winnerIds?.length, 2, "begge spillere skal være i winnerIds");

  const aliceClaim = game.claims.find((c) => c.playerId === hostId);
  const bobClaim = game.claims.find((c) => c.playerId !== hostId);
  assert.ok(aliceClaim);
  assert.ok(bobClaim);
  // 100 kr / 2 = 50 kr hver.
  assert.equal(aliceClaim!.payoutAmount, 50);
  assert.equal(bobClaim!.payoutAmount, 50);
});

test("PR B: blandet split — én alene i White (100 kr), to deler Yellow (25 kr hver fra 50 kr)", async () => {
  const adapter = new PerColorTicketAdapter();
  adapter.setTicketFor("Alice", 0, WINNING_GRID, "Small White");
  adapter.setTicketFor("Bob", 0, WINNING_GRID, "Small Yellow");
  adapter.setTicketFor("Bob", 1, WINNING_GRID, "Small Yellow");
  // Trenger en tredje spiller for Yellow-split.
  // Lag ekstra setup: bruk joinRoom én gang til.

  const variantConfig = makePerColorVariant({
    "Small White":  { phase1Prize1: 100 },
    "Small Yellow": { phase1Prize1: 50 },
  });

  const engine = new BingoEngine(adapter, new InMemoryWalletAdapter(), { minDrawIntervalMs: 0 });
  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  const { playerId: bobId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });
  const { playerId: charlieId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Charlie", walletId: "w-charlie",
  });
  adapter.setTicketFor("Charlie", 0, WINNING_GRID, "Small Yellow");

  await engine.startGame({
    roomCode, actorPlayerId: aliceId!, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;

  const aliceClaim = game.claims.find((c) => c.playerId === aliceId);
  const bobClaim = game.claims.find((c) => c.playerId === bobId);
  const charlieClaim = game.claims.find((c) => c.playerId === charlieId);
  assert.ok(aliceClaim);
  assert.ok(bobClaim);
  assert.ok(charlieClaim);
  // White: Alice alene → 100 kr.
  assert.equal(aliceClaim!.payoutAmount, 100);
  // Yellow: Bob + Charlie deler → 50/2 = 25 kr hver.
  assert.equal(bobClaim!.payoutAmount, 25);
  assert.equal(charlieClaim!.payoutAmount, 25);
});

test("PR B: farge uten eksplisitt matrise bruker __default__ (100 kr 1 Rad)", async () => {
  const adapter = new PerColorTicketAdapter();
  // Alice har en "Small Purple"-farge som IKKE er i patternsByColor →
  // skal falle til __default__.
  adapter.setTicketFor("Alice", 0, WINNING_GRID, "Small Purple");

  const variantConfig = makePerColorVariant({
    "Small White": { phase1Prize1: 100 },
    // Ingen Small Purple-oppføring.
  });

  const { engine, roomCode, hostId } = await setupRoomWithAdapter(adapter);
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const aliceClaim = game.claims.find((c) => c.playerId === hostId);
  assert.ok(aliceClaim);
  // __default__ = DEFAULT_NORSK_BINGO_CONFIG 1 Rad = fixed 100 kr.
  assert.equal(aliceClaim!.payoutAmount, 100);
});

test("PR B: spiller med vinnende brett i to farger vinner i begge (aggregert i winnerIds)", async () => {
  const adapter = new PerColorTicketAdapter();
  // Alice har 2 brett: ett Small White + ett Small Yellow, begge vinner fase 1.
  adapter.setTicketFor("Alice", 0, WINNING_GRID, "Small White");
  adapter.setTicketFor("Alice", 1, WINNING_GRID, "Small Yellow");
  // Bob har et ikke-vinnende Yellow-brett så det er bare Alice som vinner.
  adapter.setTicketFor("Bob", 0, NON_WINNING_GRID, "Small Yellow");

  const variantConfig = makePerColorVariant({
    "Small White":  { phase1Prize1: 100 },
    "Small Yellow": { phase1Prize1: 50 },
  });

  const { engine, roomCode, hostId } = await setupRoomWithAdapter(adapter);
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 2,
    payoutPercent: 80, gameType: "standard", variantConfig,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);
  // winnerIds dedupliseres → Alice er kun én gang selv om hun vant i to farger.
  assert.deepEqual(phase1?.winnerIds, [hostId]);

  // Men Alice får TO claims (en per farge) med forskjellige beløp.
  const aliceClaims = game.claims.filter((c) => c.playerId === hostId);
  assert.equal(aliceClaims.length, 2, "Alice skal ha to claims — én per farge");
  const payoutAmounts = aliceClaims.map((c) => c.payoutAmount).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(payoutAmounts, [50, 100], "50 kr (Yellow) + 100 kr (White)");
});

test("PR B: flat-path uendret når patternsByColor ikke er satt (regresjon)", async () => {
  const adapter = new PerColorTicketAdapter();
  adapter.setTicketFor("Alice", 0, WINNING_GRID, "Small White");
  adapter.setTicketFor("Bob", 0, WINNING_GRID, "Small Yellow");

  // Ingen patternsByColor — bruker DEFAULT_NORSK_BINGO_CONFIG direkte.
  const { engine, roomCode, hostId } = await setupRoomWithAdapter(adapter);
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);
  // Flat-path: 100 kr / 2 vinnere = 50 kr hver (uavhengig av farge).
  const aliceClaim = game.claims.find((c) => c.playerId === hostId);
  const bobClaim = game.claims.find((c) => c.playerId !== hostId);
  assert.equal(aliceClaim!.payoutAmount, 50);
  assert.equal(bobClaim!.payoutAmount, 50);
});
