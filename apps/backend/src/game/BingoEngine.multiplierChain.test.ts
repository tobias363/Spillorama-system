/**
 * BIN-687 / PR-P2: Spillernes spill — multiplier-chain gevinst-regler.
 *
 * Papir-regel (PM-bekreftet 2026-04-22):
 *   - Rad 1 = 3 % av pool, min 50 kr
 *   - Rad 2 = Rad 1 × 2, min 50 kr
 *   - Rad 3 = Rad 1 × 3, min 100 kr
 *   - Rad 4 = Rad 1 × 4, min 100 kr
 *   - Rad 5 (Fullt Hus) = Rad 1 × 10, min 500 kr
 *
 * Alle multipliers refererer til Rad 1, ikke forrige fase. Gulv-regelen
 * gjelder per fase — hvis beregnet pris < min, brukes min. Rad 1 sitt
 * gulv cacher seg som base for Rad N-cascade (papir-regelen "Rad 2 min 50
 * kr" skal gjelde også når Rad 1 ble gulv-justert opp fra lavt pool).
 *
 * Dekning:
 *   1. Fase 1 (3 % av pool) uten gulv-aktivering
 *   2. Fase 1 med gulv-aktivering (lav pool)
 *   3. Fase 2 = Fase 1 × 2 uten gulv
 *   4. Fase 2 med eget gulv aktivert
 *   5. Fullt Hus (Fase 5 × 10) med stort gulv
 *   6. Multi-winner split fungerer på multiplier-total
 *   7. Cascade bygger på gulv-justert Rad 1 (ikke på rå percent-beregning)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { GameVariantConfig, PatternConfig } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

/** Samme grid for alle spillere — gjør multi-winner deterministisk. */
const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class SharedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((row) => [...row]) };
  }
}

function spillernesConfig(): GameVariantConfig {
  // Speiler papir-regelen eksakt. Rad 1 har phase1Multiplier udefinert =
  // fase 1 i cascade. Rad N > 1 refererer alle tilbake til Rad 1 via multiplier.
  const patterns: PatternConfig[] = [
    {
      name: "1 Rad",
      claimType: "LINE",
      prizePercent: 3,
      design: 1,
      winningType: "multiplier-chain",
      minPrize: 50,
    },
    {
      name: "2 Rader",
      claimType: "LINE",
      prizePercent: 0,
      design: 2,
      winningType: "multiplier-chain",
      phase1Multiplier: 2,
      minPrize: 50,
    },
    {
      name: "3 Rader",
      claimType: "LINE",
      prizePercent: 0,
      design: 3,
      winningType: "multiplier-chain",
      phase1Multiplier: 3,
      minPrize: 100,
    },
    {
      name: "4 Rader",
      claimType: "LINE",
      prizePercent: 0,
      design: 4,
      winningType: "multiplier-chain",
      phase1Multiplier: 4,
      minPrize: 100,
    },
    {
      name: "Fullt Hus",
      claimType: "BINGO",
      prizePercent: 0,
      design: 0,
      winningType: "multiplier-chain",
      phase1Multiplier: 10,
      minPrize: 500,
    },
  ];
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns,
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
}

async function setupRoom(entryFee: number, players = 1): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
  guestIds: string[];
}> {
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
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-alice",
  });
  const guestIds: string[] = [];
  for (let i = 1; i < players; i += 1) {
    const { playerId } = await engine.joinRoom({
      roomCode,
      hallId: "hall-1",
      playerName: `Guest${i}`,
      walletId: `w-guest-${i}`,
    });
    guestIds.push(playerId!);
  }
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig: spillernesConfig(),
  });
  return { engine, roomCode, hostId: hostId!, guestIds };
}

function prioritiseDrawBag(
  engine: BingoEngine,
  roomCode: string,
  numbers: number[]
): void {
  const rooms = (
    engine as unknown as {
      rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
    }
  ).rooms;
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

// ── Tester ──────────────────────────────────────────────────────────────────

test("PR-P2: fase 1 = 3 % av pool (ingen gulv-aktivering ved stor pool)", async () => {
  // 2 spillere × entryFee=1000 → pool=2000 kr → 3 % = 60 kr > 50 kr gulv.
  const { engine, roomCode, hostId } = await setupRoom(1000, 2);
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]); // rad 0
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const snap = engine.getRoomSnapshot(roomCode);
  const game = snap.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);
  // 2 vinnere (samme grid) → floor(60 / 2) = 30 kr hver.
  const claims = game.claims.filter((c) => c.type === "LINE");
  assert.equal(claims.length, 2);
  for (const c of claims) {
    assert.equal(c.payoutAmount, 30, "3 % av 2000 = 60, /2 vinnere = 30 kr");
  }
});

test("PR-P2: fase 1 gulv aktiveres når pool er lav", async () => {
  // 1 spiller entryFee=500 → pool=500 → 3 % = 15 kr < 50 kr gulv.
  const { engine, roomCode, hostId } = await setupRoom(500);
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const claim = game.claims.find((c) => c.type === "LINE");
  assert.equal(
    claim?.payoutAmount,
    50,
    "gulvet (50 kr) brukt når 3 % gir mindre"
  );
});

test("PR-P2: fase 2 = fase 1 × 2 (60 × 2 = 120 kr, over 50 kr gulv)", async () => {
  // 2 spillere × entryFee=1000 → pool=2000. Fase 1 = 60, fase 2 = 120 kr.
  // Fase 2 krever 2 horisontale rader. Delt på 2 vinnere → 60 kr hver.
  const { engine, roomCode, hostId } = await setupRoom(1000, 2);
  // Rad 0 + rad 1 = {1,16,31,46,61, 2,17,32,47,62}. Dette vinner både fase 1
  // (1 rad) og fase 2 (2 rader).
  prioritiseDrawBag(
    engine,
    roomCode,
    [1, 16, 31, 46, 61, 2, 17, 32, 47, 62]
  );
  for (let i = 0; i < 10; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  // patternResults bærer patternName + payoutAmount per fase (total før split).
  const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
  assert.equal(phase2?.isWon, true);
  assert.equal(
    phase2?.payoutAmount,
    60,
    "fase 2 per-winner = fase 1 (60) × 2 = 120, /2 vinnere = 60 kr"
  );
  // Kontrollér at 2 claims ble opprettet for fase 2 (samme patternName).
  const phase2Claims = game.claims.filter(
    (c) => c.type === "LINE" && c.payoutAmount === 60
  );
  assert.equal(phase2Claims.length, 2, "2 claims for fase 2");
});

test("PR-P2: fase 1 gulv-justert base brukes som cascade-basis for fase 2", async () => {
  // entryFee=500 → pool=500, fase 1 rå 3 % = 15 kr, gulv-justert til 50 kr.
  // Fase 2 = 50 × 2 = 100 kr (over 50 kr gulv for fase 2).
  // Bekrefter cascade bygger på GULV-JUSTERT fase 1, ikke 15 × 2 = 30 kr.
  const { engine, roomCode, hostId } = await setupRoom(500);
  prioritiseDrawBag(
    engine,
    roomCode,
    [1, 16, 31, 46, 61, 2, 17, 32, 47, 62]
  );
  for (let i = 0; i < 10; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  // Fase 2 payout leses fra patternResults (total før split).
  const phase2Result = game.patternResults?.find((r) => r.patternName === "2 Rader");
  const phase2Claim = { payoutAmount: phase2Result?.payoutAmount };
  assert.equal(
    phase2Claim?.payoutAmount,
    100,
    "cascade fra gulv (50 × 2 = 100 kr), ikke fra rå (30 × 2 = 60 kr)"
  );
});

test("PR-P2: fase 2 gulv aktiveres når fase 1 × 2 < fase 2 min", async () => {
  // For å teste fase 2 sitt eget gulv: vi trenger fase 1 × 2 < 50 kr.
  // Med min-fase-1=50 kr (gulv), fase 1 × 2 = 100 kr ≥ 50 kr alltid.
  // Derfor tester vi en custom config med fase 2 min=500 for å demonstrere.
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
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-a",
  });
  const customPatterns: PatternConfig[] = [
    {
      name: "1 Rad",
      claimType: "LINE",
      prizePercent: 3,
      design: 1,
      winningType: "multiplier-chain",
      minPrize: 50,
    },
    {
      name: "2 Rader",
      claimType: "LINE",
      prizePercent: 0,
      design: 2,
      winningType: "multiplier-chain",
      phase1Multiplier: 2,
      minPrize: 500, // HØYT gulv for å demonstrere floor-aktivering
    },
  ];
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 1000,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig: {
      ticketTypes: [
        { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
      ],
      patterns: customPatterns,
      patternEvalMode: "auto-claim-on-draw",
      autoClaimPhaseMode: true,
      maxBallValue: 75,
      drawBagSize: 75,
    },
  });
  // Pool=1000, fase 1 gulv=50, fase 2 = 50×2 = 100 < 500 gulv → brukes 500.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61, 2, 17, 32, 47, 62]);
  for (let i = 0; i < 10; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  // Fase 2 payout leses fra patternResults (total før split).
  const phase2Result = game.patternResults?.find((r) => r.patternName === "2 Rader");
  const phase2Claim = { payoutAmount: phase2Result?.payoutAmount };
  assert.equal(
    phase2Claim?.payoutAmount,
    500,
    "fase 2 gulv (500) overstyrer cascade-verdi (100)"
  );
});

test("PR-P2: multi-winner-split på multiplier-total", async () => {
  // 2 spillere × entryFee=1000 → pool=2000.
  // Fase 1 = 3 % av 2000 = 60 kr. Begge vinner samtidig → 30 kr hver.
  const { engine, roomCode, hostId } = await setupRoom(1000, 2);
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const claims = game.claims.filter((c) => c.type === "LINE");
  assert.equal(claims.length, 2, "to LINE-claims");
  for (const c of claims) {
    assert.equal(c.payoutAmount, 30, "floor(60 / 2) = 30 kr hver");
  }
});

test("PR-P2: Fullt Hus = fase 1 × 10, gulv aktivert ved lav pool", async () => {
  // 1 spiller entryFee=1000 → pool=1000. Fase 1 = 3% = 30 → gulv 50 kr.
  // Fullt Hus = 50 × 10 = 500 kr → matcher eget gulv 500 kr nøyaktig.
  const { engine, roomCode, hostId } = await setupRoom(1000);
  const allNumbers: number[] = [];
  for (const row of SHARED_GRID) for (const n of row) if (n !== 0) allNumbers.push(n);
  prioritiseDrawBag(engine, roomCode, allNumbers);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.ok(bingo, "Fullt Hus skal være claimet");
  // Cascade: fase 1 gulv=50, FH = 50×10 = 500 = gulv 500. Begge er like.
  // RTP-cap: payoutBudget = pool × 100 % = 1000 kr. FH skal få 500 kr,
  // men tidligere faser har allerede tatt 50+100+150+200 = 500 fra
  // remainingPool (cascade-modell bruker pool via phase1BasePrize).
  // Remaining pool etter fase 1-4 = 1000 - (50+100+150+200) = 500 kr → OK.
  const payout = bingo!.payoutAmount ?? 0;
  assert.equal(payout, 500, "FH cascade = 50 × 10 = 500 kr (matcher gulv)");
});

test("PR-P2: eksisterende percent-modus er uendret (regresjon)", async () => {
  // Custom config med rene percent-pattern (ingen multiplier-chain).
  // Verifiserer at legacy-path ikke er rørt av nye PR-P2-endringer.
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
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-a",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 1000,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig: {
      ticketTypes: [
        { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
      ],
      patterns: [
        { name: "Rad 1", claimType: "LINE", prizePercent: 10, design: 1 },
        { name: "Full House", claimType: "BINGO", prizePercent: 50, design: 0 },
      ],
      patternEvalMode: "auto-claim-on-draw",
      autoClaimPhaseMode: true,
      maxBallValue: 75,
      drawBagSize: 75,
    },
  });
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const claim = game.claims.find((c) => c.type === "LINE");
  assert.equal(
    claim?.payoutAmount,
    100,
    "percent-modus uendret: 10 % av 1000 = 100 kr"
  );
});

test("PR-P2: eksisterende fixed-modus er uendret (regresjon)", async () => {
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
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-a",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 1000,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig: {
      ticketTypes: [
        { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
      ],
      patterns: [
        {
          name: "Rad 1",
          claimType: "LINE",
          prizePercent: 0,
          design: 1,
          winningType: "fixed",
          prize1: 250,
        },
        { name: "Full House", claimType: "BINGO", prizePercent: 50, design: 0 },
      ],
      patternEvalMode: "auto-claim-on-draw",
      autoClaimPhaseMode: true,
      maxBallValue: 75,
      drawBagSize: 75,
    },
  });
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const claim = game.claims.find((c) => c.type === "LINE");
  assert.equal(claim?.payoutAmount, 250, "fixed-modus uendret: prize1 = 250 kr");
});
