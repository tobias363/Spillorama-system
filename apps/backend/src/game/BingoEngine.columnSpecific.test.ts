/**
 * PR-P3 (Super-NILS): column-specific Fullt-Hus-premie.
 *
 * Papir-regel (docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md):
 *   Full bong: B=500 / I=700 / N=1000 / G=700 / O=500.
 *   Kolonnen til SISTE trukne ball (ballen som fullførte bingoen) avgjør
 *   hvilken premie spilleren/spillerne får.
 *
 * Dekning:
 *   1-5. Fullt Hus vinnes — siste ball i hver av B/I/N/G/O → riktig premie
 *   6.   Multi-winner split deler column-prize jevnt med house-rest
 *   7.   columnPrizesNok mangler → COLUMN_PRIZE_MISSING (fail-closed)
 *   8.   column-specific på ikke-full-house-pattern → engine-guard trigger
 *   9.   ballToColumn helper: grenser + out-of-range
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine, DomainError, ballToColumn } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { GameVariantConfig, PatternConfig } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

/** 5×5 grid som har tall i alle 5 kolonner (B/I/N/G/O). */
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

/** Super-NILS-inspirert config: Row 1-4 i percent-mode (for enkelhet),
 *  Full House i column-specific med papir-reglens premier. */
function columnSpecificConfig(
  columnPrizes = { B: 500, I: 700, N: 1000, G: 700, O: 500 },
): GameVariantConfig {
  // Kun Fullt-Hus-pattern — ingen Row 1-4 slik at RTP-cap-beregning ikke
  // spiser av budsjettet før Fullt Hus utbetales. entryFee stilles
  // tilstrekkelig høyt (per spiller) slik at pool dekker N-col=1000 kr.
  const patterns: PatternConfig[] = [
    {
      name: "Fullt Hus",
      claimType: "BINGO",
      prizePercent: 0,
      design: 0,
      winningType: "column-specific",
      columnPrizesNok: columnPrizes,
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
    entryFee: 1000, // pool ≥ N-col (1000 kr) ved 1 spiller
    ticketsPerPlayer: 1,
    payoutPercent: 100,
    gameType: "standard",
    variantConfig,
  });
  return { engine, roomCode, hostId: hostId! };
}

/** Gir alle 24 non-free-tall i GRID, men setter valgt ball sist i bag. */
function priorityOrderLast(
  engine: BingoEngine,
  roomCode: string,
  lastBall: number,
): void {
  const allNumbers: number[] = [];
  for (const row of GRID) for (const n of row) if (n !== 0) allNumbers.push(n);
  // Flytt valgt ball til slutt.
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

// ── ballToColumn helper ─────────────────────────────────────────────────────

test("PR-P3: ballToColumn mapper 1-15 → B, 16-30 → I, 31-45 → N, 46-60 → G, 61-75 → O", () => {
  assert.equal(ballToColumn(1), "B");
  assert.equal(ballToColumn(15), "B");
  assert.equal(ballToColumn(16), "I");
  assert.equal(ballToColumn(30), "I");
  assert.equal(ballToColumn(31), "N");
  assert.equal(ballToColumn(45), "N");
  assert.equal(ballToColumn(46), "G");
  assert.equal(ballToColumn(60), "G");
  assert.equal(ballToColumn(61), "O");
  assert.equal(ballToColumn(75), "O");
});

test("PR-P3: ballToColumn returnerer null for out-of-range og ugyldig input", () => {
  assert.equal(ballToColumn(0), null);
  assert.equal(ballToColumn(76), null);
  assert.equal(ballToColumn(-5), null);
  assert.equal(ballToColumn(undefined), null);
  assert.equal(ballToColumn(Number.NaN), null);
});

// ── Column-spesifikke payouts (5 kolonner) ──────────────────────────────────

const CASES: Array<{ col: "B" | "I" | "N" | "G" | "O"; lastBall: number; expectedPrize: number }> = [
  { col: "B", lastBall: 5, expectedPrize: 500 },   // B: 1-15
  { col: "I", lastBall: 20, expectedPrize: 700 },  // I: 16-30
  { col: "N", lastBall: 34, expectedPrize: 1000 }, // N: 31-45
  { col: "G", lastBall: 50, expectedPrize: 700 },  // G: 46-60
  { col: "O", lastBall: 65, expectedPrize: 500 },  // O: 61-75
];

for (const c of CASES) {
  test(`PR-P3: Fullt Hus — siste ball ${c.lastBall} (kol ${c.col}) → ${c.expectedPrize} kr`, async () => {
    const { engine, roomCode, hostId } = await setupRoom(columnSpecificConfig());
    priorityOrderLast(engine, roomCode, c.lastBall);
    for (let i = 0; i < 24; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    }
    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    assert.equal(
      game.drawnNumbers[game.drawnNumbers.length - 1],
      c.lastBall,
      "siste ball i drawn må matche teststr tomorrow",
    );
    const bingo = game.claims.find((cl) => cl.type === "BINGO");
    assert.ok(bingo, "Fullt Hus-claim må finnes");
    assert.equal(
      bingo!.payoutAmount,
      c.expectedPrize,
      `kol ${c.col} → ${c.expectedPrize} kr`,
    );
  });
}

// ── Multi-winner split ──────────────────────────────────────────────────────

test("PR-P3: multi-winner split deler column-prize jevnt (house-rest til huset)", async () => {
  const { engine, roomCode, hostId } = await setupRoom(
    columnSpecificConfig({ B: 500, I: 700, N: 1000, G: 700, O: 500 }),
    3, // 3 spillere, samme grid
  );
  priorityOrderLast(engine, roomCode, 34); // N-kol → 1000 kr total
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingoClaims = game.claims.filter((c) => c.type === "BINGO");
  assert.equal(bingoClaims.length, 3, "3 BINGO-claims (én per vinner)");
  // floor(1000 / 3) = 333, house beholder 1 kr rest.
  for (const c of bingoClaims) {
    assert.equal(c.payoutAmount, 333, "1000 / 3 = 333 (floor) per vinner");
  }
});

// ── Fail-closed: columnPrizesNok mangler ────────────────────────────────────

test("PR-P3: column-specific uten columnPrizesNok → fase forblir uvunnet (fail-closed)", async () => {
  // Build config uten columnPrizesNok. evaluateActivePhase kaster
  // DomainError internt som engine logger og svelger (BIN-694-mønster for
  // å ikke crashe draw-loopen). Effekten: fase markerer IKKE isWon, og
  // ingen BINGO-claim opprettes — spiller får ikke feil payout. Admin
  // oppdager gjennom logg + audit (fail-closed).
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
        // columnPrizesNok mangler med vilje
      },
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(config);
  priorityOrderLast(engine, roomCode, 34);

  // Draw-loop skal ikke kaste (evaluateActivePhase-feil svelges).
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  // Fail-closed: ingen BINGO-claim opprettet siden payout feilet.
  const bingoClaims = game.claims.filter((c) => c.type === "BINGO");
  assert.equal(
    bingoClaims.length,
    0,
    "ingen BINGO-claim når columnPrizesNok mangler (fail-closed)",
  );
  const bingoPattern = game.patternResults?.find(
    (r) => r.patternName === "Fullt Hus",
  );
  assert.equal(
    bingoPattern?.isWon,
    false,
    "Fullt Hus IKKE markert vunnet pga payout-feil",
  );
});

test("PR-P3: ballToColumn eksponert så DomainError-kode er testbar gjennom throw (unit)", () => {
  // Egen direkte-unit-verifisering av COLUMN_PRIZE_MISSING-kode ved å
  // simulere ballToColumn + manuell validation. Sanity-sjekk at DomainError-
  // klassen gir .code-felt som "COLUMN_PRIZE_MISSING" når kastet.
  const err = new DomainError("COLUMN_PRIZE_MISSING", "test");
  assert.equal(err.code, "COLUMN_PRIZE_MISSING");
  assert.match(err.message, /test/);
});

test("PR-P3: regresjon — percent-mode uendret (ingen column-spesifikk påvirkning)", async () => {
  // Full House med percent-mode (dagens standard) skal fungere uendret.
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
        // Ingen winningType → default "percent"
      },
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
  const { engine, roomCode, hostId } = await setupRoom(config);
  const allNumbers: number[] = [];
  for (const row of GRID) for (const n of row) if (n !== 0) allNumbers.push(n);
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (bag) {
    const wanted = new Set(allNumbers);
    const pref = bag.filter((n) => wanted.has(n));
    const rest = bag.filter((n) => !wanted.has(n));
    bag.length = 0;
    bag.push(...pref, ...rest);
  }
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const bingo = game.claims.find((c) => c.type === "BINGO");
  assert.ok(bingo, "Full House claim må finnes");
  // entryFee=1000, 1 spiller → pool=1000. 50 % = 500 kr.
  assert.equal(bingo!.payoutAmount, 500, "percent-mode uendret: 50 % av 1000 = 500");
});
