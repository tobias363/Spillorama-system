/**
 * Forensic test (Tobias 2026-04-27): Hypothesis-probe for "Spill 1 sitter
 * fast i fase '2 Rader' selv om bonger har 4 fulle rader. Klient sier
 * '2 Rader -- klar!' men server detekterer ikke vinnere."
 *
 * HYPOTHESE: Tobias' bonger er pre-round-arms (forhandskjop mid-round)
 * som ikke commit-er til den AKTIVE rundens game.tickets.
 *
 * ANTI-HYPOTHESE (etter PR #495 round-state-isolation):
 *   - PlayScreen.ts:410 viser KUN myTickets under RUNNING.
 *   - TicketGridHtml.ts:341-352 setter activePattern=null pa pre-round-brett.
 *   - Foretter ingen "klar!"-footer pa pre-round-brett under RUNNING.
 *
 * Bonus-hypothese: variantConfig.autoClaimPhaseMode false -> 0 server-vinn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

// Grid med 4 fulle horisontale rader (rad 0-3) hvis tall trekkes:
//   rad 0: 1, 2, 3, 4, 5
//   rad 1: 11, 12, 13, 14, 15
//   rad 2: 21, 22, 0, 23, 24 (free center)
//   rad 3: 31, 32, 33, 34, 35
//   rad 4: 41, 42, 43, 44, 45
const FOUR_ROW_GRID = [
  [1, 2, 3, 4, 5],
  [11, 12, 13, 14, 15],
  [21, 22, 0, 23, 24],
  [31, 32, 33, 34, 35],
  [41, 42, 43, 44, 45],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FOUR_ROW_GRID.map((row) => [...row]) };
  }
}

function prioritiseDrawBag(engine: BingoEngine, roomCode: string, numbers: number[]): void {
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
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

function snapshotPatterns(engine: BingoEngine, roomCode: string): {
  active: string | null;
  won: Array<{ name: string; wonAtDraw?: number; payoutAmount?: number }>;
  status: string;
} {
  const game = engine.getRoomSnapshot(roomCode).currentGame;
  if (!game) return { active: null, won: [], status: "?" };
  const won = (game.patternResults ?? [])
    .filter((r) => r.isWon)
    .map((r) => ({ name: r.patternName, wonAtDraw: r.wonAtDraw, payoutAmount: r.payoutAmount }));
  const active = (game.patternResults ?? []).find((r) => !r.isWon)?.patternName ?? null;
  return { active, won, status: game.status };
}

// ── Test 1: BASELINE — happy path med 4 fulle rader ──────────────────────
//
// RTP-CAP-BUG-FIX 2026-04-29: pool=135 (45×3), budget=108 (80%). Faste
// premier 100/200/200/200 = 700 kr. Kun 1 Rad fullt utbetalt; 2 Rader capet
// til 8 kr (resterende budget); 3-4 Rader payoutSkipped. Test verifiserer
// at fasene fortsatt markeres som vunnet selv når payout=0.
test("BASELINE: 4 fulle rader (Norsk-config) -> phase 1-4 won + active=Fullt Hus", async () => {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Tobias",
    walletId: "w-tobias",
    gameSlug: "bingo",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 3,
    payoutPercent: 80,
    gameType: "bingo",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // 19 baller fra rad 0-3 (rad 2 har free center 0 ekskludert)
  const fourRowsBalls = [
    1, 2, 3, 4, 5,
    11, 12, 13, 14, 15,
    21, 22, 23, 24,
    31, 32, 33, 34, 35,
  ];
  prioritiseDrawBag(engine, roomCode, fourRowsBalls);

  for (let i = 0; i < fourRowsBalls.length; i += 1) {
    // PR #643 (`fix(spill1): KRITISK — ad-hoc-engine auto-pauser etter
    // fase-vinning`): Spill 1 ad-hoc pauser etter hver fase-vinn for å
    // matche prod-flyt der master må starte spillet igjen. I tester
    // simulerer vi master-resume inline.
    const snapBefore = engine.getRoomSnapshot(roomCode);
    if (snapBefore.currentGame?.isPaused) {
      engine.resumeGame(roomCode);
    }
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    const snap = snapshotPatterns(engine, roomCode);
    if (snap.status === "ENDED") break;
  }

  const final = snapshotPatterns(engine, roomCode);
  console.log(
    `[BASELINE] status=${final.status} active=${final.active} won=[${final.won
      .map((w) => `${w.name}@${w.wonAtDraw}/${w.payoutAmount}kr`)
      .join(", ")}]`,
  );

  // RTP-cap-bug-fix 2026-04-29: alle 4 faser skal være MARKERT som vunnet,
  // selv om 3-4 Rader er capped til 0 (post-budget-exhaustion). Test
  // verifiserer at runden fortsetter sekvensielt selv ved tomme buffere.
  assert.ok(
    final.won.find((w) => w.name === "1 Rad"),
    "1 Rad skal være won",
  );
  assert.ok(
    final.won.find((w) => w.name === "2 Rader"),
    "2 Rader skal være won",
  );
  assert.ok(
    final.won.find((w) => w.name === "3 Rader"),
    "3 Rader skal være won",
  );
  assert.ok(
    final.won.find((w) => w.name === "4 Rader"),
    "4 Rader skal være won",
  );
  assert.equal(final.active, "Fullt Hus", "Active skal være Fullt Hus");

  // Verifiser at total payout er innenfor RTP-budget (108 kr).
  const totalPaid = final.won.reduce((sum, w) => sum + (w.payoutAmount ?? 0), 0);
  assert.ok(totalPaid <= 108, `Total payout ${totalPaid} skal være ≤ RTP-budget 108`);
});

// ── Test 2: ALT-HYPOTHESE (a) — UTEN autoClaimPhaseMode → 0 server-vinn ──
//
// Hvis variantConfig defaulter til DEFAULT_STANDARD_CONFIG (uten
// autoClaimPhaseMode), kjorer ikke evaluateActivePhase. 4 fulle
// rader pa client gir 0 server-vinn.
test("ALT-HYPOTHESE (a): standard fallback (uten autoClaim) -> 0 server-vinn ved 4 fulle rader", async () => {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Tobias",
    walletId: "w-tobias",
  });

  // STARTGAME UTEN variantConfig -> defaulter til DEFAULT_STANDARD_CONFIG
  // som IKKE har autoClaimPhaseMode -> evaluateActivePhase kjorer aldri.
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 3,
    payoutPercent: 80,
    // NO gameType, NO variantConfig -> "standard"
  });

  const fourRowsBalls = [
    1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 31, 32, 33, 34, 35,
  ];
  prioritiseDrawBag(engine, roomCode, fourRowsBalls);

  for (let i = 0; i < fourRowsBalls.length; i += 1) {
    // PR #643 (`fix(spill1): KRITISK — ad-hoc-engine auto-pauser etter
    // fase-vinning`): Spill 1 ad-hoc pauser etter hver fase-vinn for å
    // matche prod-flyt der master må starte spillet igjen. I tester
    // simulerer vi master-resume inline.
    const snapBefore = engine.getRoomSnapshot(roomCode);
    if (snapBefore.currentGame?.isPaused) {
      engine.resumeGame(roomCode);
    }
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    const snap = snapshotPatterns(engine, roomCode);
    if (snap.status === "ENDED") break;
  }

  const final = snapshotPatterns(engine, roomCode);
  console.log(
    `[ALT-HYPOTHESE-A] status=${final.status} active=${final.active} won=[${final.won
      .map((w) => `${w.name}`)
      .join(", ")}]`,
  );

  // Med 4 fulle rader trukket men UTEN auto-claim: server detekterer
  // ingen vinnere. Patterns forblir alle UN-WON. Status = RUNNING.
  assert.equal(final.status, "RUNNING", "Status forblir RUNNING uten auto-claim");
  assert.equal(final.won.length, 0, "Ingen patterns markert won uten auto-claim");
  console.log(
    `[ALT-HYPOTHESE-A] CONFIRMED: 4 rader, 0 server-vinn fordi autoClaimPhaseMode mangler. ` +
    `Active pattern: ${final.active ?? "(ingen)"}.`
  );
});

// ── Test 3: KOMPLEMENTAR — game.tickets uendret etter mid-round draw ──
test("KOMPLEMENTAR: game.tickets uendret gjennom flere draws", async () => {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Tobias",
    walletId: "w-tobias",
    gameSlug: "bingo",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 3,
    payoutPercent: 80,
    gameType: "bingo",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  const rooms = (engine as unknown as {
    rooms: Map<string, {
      currentGame?: { tickets: Map<string, Ticket[]> };
    }>;
  }).rooms;

  const initial = rooms.get(roomCode)?.currentGame?.tickets.get(hostId!) ?? [];
  const initialCount = initial.length;
  console.log(`[KOMPLEMENTAR] Initial tickets: ${initialCount}`);

  prioritiseDrawBag(engine, roomCode, [50, 51, 52, 53, 54]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    const tickets = rooms.get(roomCode)?.currentGame?.tickets.get(hostId!) ?? [];
    assert.equal(
      tickets.length,
      initialCount,
      `Ticket-count maintain (var ${initialCount}, na ${tickets.length} etter ${i + 1} draws)`,
    );
  }

  console.log(`[KOMPLEMENTAR] CONFIRMED: ${initialCount} tickets stable through 5 draws`);
});
