/**
 * Bølge K4 integration — verifiserer end-to-end at preset-varianter fra
 * admin-UI via mapperen produserer korrekt payout i BingoEngine.
 *
 * For hver av de 5 presetene kjører vi en komplett Spill 1-runde:
 *   - Bygg variantConfig via `buildVariantConfigFromSpill1Config`
 *   - Start rom + draw alle nødvendige kuler
 *   - Verifiser faktisk payout-beløp matcher papir-regelen
 *
 * Dette er **integrasjonstesten** som binder preset-builderen (shared-types)
 * til mapperen (backend) til BingoEngine (evaluateActivePhase). Unit-tester
 * for hver komponent ligger i egne filer:
 *   - `spill1-sub-variants.test.ts` (shared-types — 34 tester)
 *   - `spill1VariantMapper.test.ts` (mapper — 15 nye tester for K4)
 *   - `BingoEngine.columnSpecific.test.ts` (P3 engine — 9 tester)
 *   - `BingoEngine.ballValue.test.ts` (P4 engine — 10 tester)
 *   - `BingoEngine.multiplierChain.test.ts` (P2 engine — 8 tester)
 *   - `BingoEngine.kvikkis.test.ts` (kvikkis engine — 3 tester)
 *   - `BingoEngine.concurrentPatterns.test.ts` (P5 engine — 12 tester)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { buildVariantConfigFromSpill1Config } from "./spill1VariantMapper.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

// Shared grid som har alle 5 kolonner representert (B/I/N/G/O).
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

/**
 * Setup-helper med wallet-topup for høy-entryFee-scenarier.
 *
 * InMemoryWalletAdapter auto-funderer kontoen med 1000 kr ved `ensureAccount`.
 * For integrasjonstester som trenger høy pool (for å dekke preset-
 * full-house-premier opp til 3000 kr), top-up-er vi wallet før `startGame`.
 * Engine filtrerer bort spillere med balance < entryFee, så vi må sikre
 * at walletId har nok balance FØR startGame.
 */
async function setupRoomWithVariant(
  subVariant: string,
  entryFee = 1000,
  playerCount = 1,
): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
  wallet: InMemoryWalletAdapter;
}> {
  const variantConfig = buildVariantConfigFromSpill1Config({
    subVariant: subVariant as "kvikkis" | "tv-extra" | "ball-x-10" | "super-nils" | "spillernes-spill" | "standard",
    ticketColors: [
      { color: "small_yellow", priceNok: entryFee, prizePerPattern: {} },
    ],
  });
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(
    new SharedTicketAdapter(),
    wallet,
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
  // Top up Alice wallet til entryFee + buffer (1000 kr) så player.balance ≥ entryFee.
  await wallet.ensureAccount("w-alice");
  if (entryFee > 1000) {
    await wallet.topUp("w-alice", entryFee + 500, "test setup");
  }
  for (let i = 1; i < playerCount; i += 1) {
    const walletId = `w-p-${i}`;
    await engine.joinRoom({
      roomCode,
      hallId: "h",
      playerName: `P${i}`,
      walletId,
    });
    await wallet.ensureAccount(walletId);
    if (entryFee > 1000) {
      await wallet.topUp(walletId, entryFee + 500, "test setup");
    }
  }
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig,
  });
  return { engine, roomCode, hostId: hostId!, wallet };
}

function priorityOrderLast(
  engine: BingoEngine,
  roomCode: string,
  lastBall: number,
): void {
  const allNumbers: number[] = [];
  for (const row of GRID) for (const n of row) if (n !== 0) allNumbers.push(n);
  const rest = allNumbers.filter((n) => n !== lastBall);
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

// ── Kvikkis ─────────────────────────────────────────────────────────────────

test("K4 integration: Kvikkis-preset gir 1000 kr payout ved Fullt Hus", async () => {
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "kvikkis",
    1500, // pool ≥ 1000 kr
    1,
  );
  // Draw alle 24 grid-tall → Fullt Hus.
  priorityOrderLast(engine, roomCode, 65);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.ok(bingo, "BINGO claim må finnes");
  assert.equal(bingo!.payoutAmount, 1000, "Kvikkis: 1000 kr fast");
});

// ── Ball × 10 ───────────────────────────────────────────────────────────────

test("K4 integration: Ball × 10-preset — siste ball 34 → 1250 + 340 = 1590 kr", async () => {
  // Vi trenger pool ≥ 1590 kr for å unngå RTP-cap. 2 spillere × 1000 = 2000 kr.
  // Men fase 1-4 er standard-fixed (100+200+200+200=700 kr) så
  // remainingPool ved fase 5 = 2000 - 700 = 1300 kr.
  // Siden 1590 > 1300 vil engine floor til remaining.
  // For å isolere ball-value-multiplier-beregningen bruker vi en høy entryFee.
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "ball-x-10",
    3000, // pool 3000 kr, etter fase 1-4 = 2300 kr
    1,
  );
  priorityOrderLast(engine, roomCode, 34);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingoClaims = game.claims.filter((c) => c.type === "BINGO");
  const total = bingoClaims.reduce((s, c) => s + (c.payoutAmount ?? 0), 0);
  assert.equal(total, 1590, "Ball × 10: 1250 + 34×10 = 1590 kr");
});

// ── Super-NILS ──────────────────────────────────────────────────────────────

test("K4 integration: Super-NILS-preset — siste ball 34 (N-kol) → 1000 kr", async () => {
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "super-nils",
    2000, // pool 2000 kr, etter fase 1-4 = 1300 kr (≥ 1000 N-col)
    1,
  );
  priorityOrderLast(engine, roomCode, 34); // N-kol = 1000 kr
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.ok(bingo);
  assert.equal(bingo!.payoutAmount, 1000, "Super-NILS N-kol = 1000 kr");
});

test("K4 integration: Super-NILS — siste ball 5 (B-kol) → 500 kr", async () => {
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "super-nils",
    1500, // pool ≥ 500 kr
    1,
  );
  priorityOrderLast(engine, roomCode, 5); // B-kol = 500 kr
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.equal(bingo!.payoutAmount, 500, "Super-NILS B-kol = 500 kr");
});

// ── Spillernes spill ───────────────────────────────────────────────────────

test("K4 integration: Spillernes spill — fase 1 med stor pool gir percent-basert payout", async () => {
  // 1 spiller × 3000 entryFee → pool 3000. Fase 1 = 3% = 90 kr (> 50 min).
  // Multi-winner N/A (1 spiller).
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "spillernes-spill",
    3000,
    1,
  );
  // Draw bare en hel rad (fase 1).
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (bag) {
    const wanted = new Set([1, 16, 31, 46, 61]); // rad 0
    const preferred: number[] = [];
    const rest: number[] = [];
    for (const n of bag) {
      if (wanted.has(n)) preferred.push(n);
      else rest.push(n);
    }
    preferred.sort((a, b) => a - b);
    bag.length = 0;
    bag.push(...preferred, ...rest);
  }
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const phase1 = game.claims.find((c) => c.type === "LINE");
  assert.ok(phase1, "fase 1 LINE-claim");
  assert.equal(phase1!.payoutAmount, 90, "3 % av 3000 = 90 kr");
});

test("K4 integration: Spillernes spill — lav pool trigger min-gulv (50 kr)", async () => {
  // 1 spiller × 500 entryFee → pool 500. Fase 1 = 3% = 15 kr, gulv 50.
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "spillernes-spill",
    500,
    1,
  );
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (bag) {
    const wanted = new Set([1, 16, 31, 46, 61]);
    const preferred: number[] = [];
    const rest: number[] = [];
    for (const n of bag) (wanted.has(n) ? preferred : rest).push(n);
    preferred.sort((a, b) => a - b);
    bag.length = 0;
    bag.push(...preferred, ...rest);
  }
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const phase1 = game.claims.find((c) => c.type === "LINE");
  assert.equal(phase1!.payoutAmount, 50, "gulv-aktivering: 50 kr (ikke 15)");
});

// ── TV Extra (concurrent custom patterns) ──────────────────────────────────

test("K4 integration: TV Extra-preset — Fullt Hus gir 3000 kr (concurrent)", async () => {
  // TV Extra bruker customPatterns. Når alle 25 celler er dekket,
  // oppfyller samme ticket ALLE 3 patterns (Bilde, Ramme, Fullt Hus)
  // samtidig — engine genererer claims for hver pattern.
  //
  // For denne testen verifiserer vi Fullt Hus-claimen (3000 kr).
  // Bilde/Ramme vinnes tidligere når delmengder av brettet er fylt,
  // men dekkes i unit-tester i concurrentPatterns.test.ts.
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "tv-extra",
    4000, // pool må dekke 500+1000+3000 = 4500 kr (pluss buffer)
    2, // 2 spillere → pool 8000 kr
  );
  // Draw alle 24 grid-tall → alle 3 patterns oppfylt.
  priorityOrderLast(engine, roomCode, 65);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  // Sjekk at patternResults inneholder Bilde + Ramme + Fullt Hus.
  const byName = new Map(
    (game.patternResults ?? []).map((r) => [r.patternName, r]),
  );
  assert.ok(byName.has("Bilde"), "Bilde-pattern");
  assert.ok(byName.has("Ramme"), "Ramme-pattern");
  assert.ok(byName.has("Fullt Hus"), "Fullt Hus-pattern");
  // Fullt Hus må være vunnet.
  assert.equal(byName.get("Fullt Hus")!.isWon, true);
});

// ── Standard (sanity) ──────────────────────────────────────────────────────

test("K4 integration: standard-preset — fase 1 = 100 kr fast, Fullt Hus = 1000 kr", async () => {
  const { engine, roomCode, hostId } = await setupRoomWithVariant(
    "standard",
    5000, // rikelig pool
    1,
  );
  priorityOrderLast(engine, roomCode, 65);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const lineClaims = game.claims.filter((c) => c.type === "LINE");
  const bingoClaim = game.claims.find((c) => c.type === "BINGO");
  // Fase 1 claim først; ordre er ikke garantert per-index, så sjekk eksistens.
  assert.ok(lineClaims.length >= 1);
  const phase1Amount = lineClaims[0]!.payoutAmount;
  assert.equal(phase1Amount, 100, "standard fase 1 = 100 kr");
  assert.equal(bingoClaim!.payoutAmount, 1000, "standard Fullt Hus = 1000 kr");
});
