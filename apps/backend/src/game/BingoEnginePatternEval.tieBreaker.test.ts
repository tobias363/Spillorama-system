/**
 * PR-T1 KRITISK 4 (casino-grade research 2026-04-28):
 * Deterministisk multi-winner tie-breaker — `firstWinnerId` og iterasjons-
 * rekkefølge for payout/audit/loyalty må være 100 % stabil på tvers av:
 *
 *   - Map/Set-insertion-order (insertion-order varierer ved
 *     restoreRoomFromSnapshot etter crash-recovery)
 *   - DB-rekkefølge (Postgres garanterer ingen rekkefølge uten ORDER BY)
 *   - Repeatability ved retry / replay
 *
 * Tobias-krav (research §6 "KRITISK 4"): "100% sikkerhet at den bongen som
 * først fullfører en rad får gevinsten — eller minst at det er deterministisk".
 *
 * Vi bruker lex-orden på playerId (UUID) som tie-breaker for ad-hoc-engine
 * fordi Ticket-objektet ikke bærer purchase-timestamp (alle bonger genereres
 * samtidig ved startGame()). Scheduled Spill 1 (Game1DrawEngineService) bruker
 * (purchased_at ASC, assignmentId ASC) i SQL ORDER BY — testet separat i
 * Game1DrawEngineService.test-suiten.
 *
 * Dekning:
 *   1. Pure function — `sortWinnerIdsDeterministic` lex-sorterer Set
 *   2. Pure function — håndterer tomme arrays
 *   3. Pure function — preserverer alle elementer (ingen drop)
 *   4. Multi-winner same-draw: lavest playerId lex-orden vinner `firstWinnerId`
 *   5. Restart-simulering: rebuild Map med ulik insertion-order → samme
 *      firstWinnerId
 *   6. Multi-winner via concurrent patterns (PR-P5): samme tie-breaker-regel
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { sortWinnerIdsDeterministic } from "./BingoEnginePatternEval.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type { GameVariantConfig, CustomPatternDefinition } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket, RoomState, GameState, Player } from "./types.js";

// ── Pure-function tester ──────────────────────────────────────────────────

test("PR-T1: sortWinnerIdsDeterministic — lex-orden ASC", () => {
  const ids = ["zzz", "aaa", "mmm"];
  assert.deepEqual(
    sortWinnerIdsDeterministic(ids),
    ["aaa", "mmm", "zzz"],
    "lex-sort ASC: a < m < z",
  );
});

test("PR-T1: sortWinnerIdsDeterministic — Set-input lex-sortert", () => {
  // Set bevarer insertion-order; vi vil at output skal være lex-orden uavhengig.
  const ids = new Set(["uuid-c", "uuid-a", "uuid-b"]);
  assert.deepEqual(
    sortWinnerIdsDeterministic(ids),
    ["uuid-a", "uuid-b", "uuid-c"],
    "Set-input → lex-sort, ikke insertion-order",
  );
});

test("PR-T1: sortWinnerIdsDeterministic — tom input → tom output", () => {
  assert.deepEqual(sortWinnerIdsDeterministic([]), []);
  assert.deepEqual(sortWinnerIdsDeterministic(new Set()), []);
});

test("PR-T1: sortWinnerIdsDeterministic — alle elementer bevart", () => {
  const ids = ["x", "y", "z", "a", "b"];
  const sorted = sortWinnerIdsDeterministic(ids);
  assert.equal(sorted.length, 5, "ingen elementer droppes");
  assert.deepEqual(sorted, ["a", "b", "x", "y", "z"]);
});

test("PR-T1: sortWinnerIdsDeterministic — UUID-lik input gir stabil orden", () => {
  // Realistiske UUID-IDer (16 byte hex med bindestreker). Lex-orden er
  // deterministisk på string-content.
  const ids = [
    "ffaa1234-5678-9abc-def0-123456789abc",
    "00aa1234-5678-9abc-def0-123456789abc",
    "88aa1234-5678-9abc-def0-123456789abc",
  ];
  const sorted = sortWinnerIdsDeterministic(ids);
  assert.equal(sorted[0]!.startsWith("00"), true, "00... først");
  assert.equal(sorted[1]!.startsWith("88"), true, "88... midt");
  assert.equal(sorted[2]!.startsWith("ff"), true, "ff... sist");
});

test("PR-T1: sortWinnerIdsDeterministic — repeated calls gir samme output", () => {
  const ids = ["c", "a", "b"];
  const a = sortWinnerIdsDeterministic(ids);
  const b = sortWinnerIdsDeterministic(ids);
  const c = sortWinnerIdsDeterministic(ids);
  assert.deepEqual(a, b, "repeated call gir samme orden");
  assert.deepEqual(b, c);
});

// ── Integration: end-to-end via BingoEngine.evaluateActivePhase ────────────

const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class SharedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((row) => [...row]) };
  }
}

/**
 * Setup en room med 3 spillere som alle har identisk grid → garantert
 * multi-winner på samme ball. Vi overstyrer playerId så vi får kontroll
 * på lex-orden i testen.
 */
async function setupMultiWinnerRoom(
  customPlayerIds?: [string, string, string],
): Promise<{
  engine: BingoEngine;
  roomCode: string;
  playerIds: [string, string, string];
}> {
  const engine = new BingoEngine(
    new SharedGridAdapter(),
    new InMemoryWalletAdapter(),
    {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
      dailyLossLimit: 1_000_000,
      monthlyLossLimit: 10_000_000,
    },
  );

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-test",
    playerName: "Alice",
    walletId: "w-alice",
  });
  const { playerId: g1 } = await engine.joinRoom({
    roomCode, hallId: "hall-test", playerName: "Bob", walletId: "w-bob",
  });
  const { playerId: g2 } = await engine.joinRoom({
    roomCode, hallId: "hall-test", playerName: "Carol", walletId: "w-carol",
  });

  // Evt overstyr playerId for å kontrollere lex-orden i testen.
  if (customPlayerIds) {
    const rooms = (engine as unknown as {
      rooms: Map<string, RoomState>;
    }).rooms;
    const room = rooms.get(roomCode)!;
    const original: Player[] = [...room.players.values()];
    const renamed: Player[] = original.map((p, i) => ({
      ...p,
      id: customPlayerIds[i]!,
    }));
    room.players = new Map(renamed.map((p) => [p.id, p]));
    if (room.hostPlayerId === hostId) {
      room.hostPlayerId = customPlayerIds[0]!;
    }
    return {
      engine,
      roomCode,
      playerIds: customPlayerIds,
    };
  }

  return {
    engine,
    roomCode,
    playerIds: [hostId!, g1!, g2!],
  };
}

function prioritiseDrawBag(engine: BingoEngine, roomCode: string, numbers: number[]): void {
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const wanted = new Set(numbers);
  const preferred: number[] = [];
  const rest: number[] = [];
  for (const n of bag) {
    if (wanted.has(n)) preferred.push(n);
    else rest.push(n);
  }
  preferred.sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

test(
  "PR-T1: multi-winner — laveste playerId lex-orden får firstWinnerId uavhengig av Map-insertion-order",
  async () => {
    // Insertion-order: zzz, aaa, mmm. Lex-orden: aaa, mmm, zzz.
    // Forventning: firstWinnerId = "aaa" (lex-min).
    const { engine, roomCode, playerIds } = await setupMultiWinnerRoom([
      "uuid-zzz",
      "uuid-aaa",
      "uuid-mmm",
    ]);

    await engine.startGame({
      roomCode,
      actorPlayerId: playerIds[0]!,
      entryFee: 200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });

    // Trekk rad 1 (alle har identisk grid → alle 3 vinner samtidig).
    prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: playerIds[0]! });
    }

    const snapshot = engine.getRoomSnapshot(roomCode);
    const game = snapshot.currentGame!;
    const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
    assert.ok(phase1, "1 Rad-pattern må finnes");
    assert.equal(phase1!.isWon, true, "fase 1 skal være vunnet");

    // ASSERT: firstWinnerId er deterministisk = laveste playerId lex-orden.
    assert.equal(
      phase1!.winnerId,
      "uuid-aaa",
      `firstWinnerId må være lex-min (uuid-aaa). Faktisk: ${phase1!.winnerId}`,
    );

    // ASSERT: winnerIds er sortert deterministisk.
    assert.deepEqual(
      phase1!.winnerIds,
      ["uuid-aaa", "uuid-mmm", "uuid-zzz"],
      "winnerIds må være lex-sortert ASC",
    );

    // ASSERT: alle 3 vinnere fikk claim med valid=true (ingen droppet).
    const validClaims = game.claims.filter(
      (c) => c.type === "LINE" && c.valid,
    );
    assert.equal(validClaims.length, 3, "alle 3 vinnere skal ha gyldig claim");
  },
);

test(
  "PR-T1: restart-simulering — rebuild Map med flippet insertion-order gir samme firstWinnerId",
  async () => {
    // Test-strategi: kjør samme spill 2 ganger med ulik insertion-rekkefølge
    // (host = ulik spiller hver gang). Hvis sort er stabil må firstWinnerId
    // være samme for begge kjøringer (lex-min av playerIds).
    //
    // Run A: host = "uuid-aaa" (lex-min), 2 gjester med høyere lex-IDer.
    // Run B: host = "uuid-zzz" (lex-max), 2 gjester med lavere lex-IDer.
    //
    // I begge tilfeller skal lex-min vinne firstWinnerId.

    // ── Run A ──
    const a = await setupMultiWinnerRoom([
      "uuid-aaa", // host (insertion-order [0])
      "uuid-mmm",
      "uuid-zzz",
    ]);
    await a.engine.startGame({
      roomCode: a.roomCode,
      actorPlayerId: a.playerIds[0]!,
      entryFee: 200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });
    prioritiseDrawBag(a.engine, a.roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await a.engine.drawNextNumber({ roomCode: a.roomCode, actorPlayerId: a.playerIds[0]! });
    }
    const phase1A = a.engine.getRoomSnapshot(a.roomCode).currentGame!
      .patternResults!.find((r) => r.patternName === "1 Rad")!;

    // ── Run B (samme spillere, ulik host = ulik insertion-order i Map) ──
    const b = await setupMultiWinnerRoom([
      "uuid-zzz", // host (insertion-order [0]) — lex-max
      "uuid-aaa", // [1] — lex-min, satt etter
      "uuid-mmm", // [2]
    ]);
    await b.engine.startGame({
      roomCode: b.roomCode,
      actorPlayerId: b.playerIds[0]!,
      entryFee: 200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });
    prioritiseDrawBag(b.engine, b.roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await b.engine.drawNextNumber({ roomCode: b.roomCode, actorPlayerId: b.playerIds[0]! });
    }
    const phase1B = b.engine.getRoomSnapshot(b.roomCode).currentGame!
      .patternResults!.find((r) => r.patternName === "1 Rad")!;

    // ASSERT: begge kjøringer gir SAMME firstWinnerId (lex-min) selv om
    // insertion-rekkefølge i Map er ulik. Dette beviser at sort er stabil
    // på tvers av rebuild fra ulike DB-rekkefølger / Map-rekonstruksjoner.
    assert.equal(
      phase1A.winnerId,
      "uuid-aaa",
      "Run A: firstWinnerId = lex-min uuid-aaa",
    );
    assert.equal(
      phase1B.winnerId,
      "uuid-aaa",
      "Run B: firstWinnerId = lex-min uuid-aaa (samme som A)",
    );
    assert.equal(
      phase1A.winnerId,
      phase1B.winnerId,
      "Run A og Run B må gi identisk firstWinnerId — beviser deterministisk tie-breaker",
    );

    // ASSERT: winnerIds-rekkefølge er identisk på tvers av runs.
    assert.deepEqual(
      phase1A.winnerIds,
      phase1B.winnerIds,
      "winnerIds må være identisk sortert i begge runs",
    );
    assert.deepEqual(
      phase1A.winnerIds,
      ["uuid-aaa", "uuid-mmm", "uuid-zzz"],
      "winnerIds = lex-sort av [aaa, mmm, zzz]",
    );
  },
);

test(
  "PR-T1: multi-winner med samme grid → alle får gyldig claim (ingen droppes)",
  async () => {
    // Sanity: tie-breaker-fix må ikke endre split-antall eller -beløp,
    // bare rekkefølgen. 3 vinnere → 100/3 = 33 kr hver med rest til hus.
    const { engine, roomCode, playerIds } = await setupMultiWinnerRoom();
    await engine.startGame({
      roomCode,
      actorPlayerId: playerIds[0]!,
      entryFee: 200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });
    prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: playerIds[0]! });
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const phase1 = game.patternResults!.find((r) => r.patternName === "1 Rad")!;
    assert.equal(phase1.winnerIds!.length, 3, "alle 3 vinnere registrert");
    const lineClaims = game.claims.filter(
      (c) => c.type === "LINE" && c.valid,
    );
    assert.equal(lineClaims.length, 3, "alle 3 fikk claim");
    // Default 100 kr / 3 = 33 kr (floor). Verifisér at split-beløpet ikke
    // er regreget av tie-breaker-endringen.
    for (const c of lineClaims) {
      assert.equal(c.payoutAmount, 33, `hver vinner får 33 kr (floor 100/3)`);
    }
  },
);

// ── Concurrent patterns (PR-P5) — samme tie-breaker-regel ──────────────────

function maskFromCells(cells: number[]): number {
  let m = 0;
  for (const c of cells) m |= 1 << c;
  return m;
}

const MASK_BILDE = maskFromCells([0, 4, 12, 20, 24]);

function customPattern(
  patternId: string,
  name: string,
  mask: number,
  prize1: number,
): CustomPatternDefinition {
  return {
    patternId,
    name,
    claimType: "LINE",
    prizePercent: 0,
    design: 0,
    mask,
    concurrent: true,
    winningType: "fixed",
    prize1,
  };
}

function extraConfig(): GameVariantConfig {
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [],
    customPatterns: [
      customPattern("bilde", "Bilde", MASK_BILDE, 600),
    ],
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    maxBallValue: 75,
    drawBagSize: 75,
  };
}

test(
  "PR-T1: concurrent patterns (PR-P5) — winnerIds sortert lex-deterministisk",
  async () => {
    const engine = new BingoEngine(
      new SharedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      },
    );
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-test",
      playerName: "Alice",
      walletId: "w-alice",
    });
    const { playerId: g1 } = await engine.joinRoom({
      roomCode, hallId: "hall-test", playerName: "Bob", walletId: "w-bob",
    });
    const { playerId: g2 } = await engine.joinRoom({
      roomCode, hallId: "hall-test", playerName: "Carol", walletId: "w-carol",
    });

    // Overstyr player-ids for kontroll på lex-orden.
    const rooms = (engine as unknown as {
      rooms: Map<string, RoomState>;
    }).rooms;
    const room = rooms.get(roomCode)!;
    const players = [...room.players.values()];
    // Insertion-order: zzz, aaa, mmm — lex-min er aaa.
    const newIds = ["uuid-zzz", "uuid-aaa", "uuid-mmm"];
    const renamed = players.map((p, i) => ({ ...p, id: newIds[i]! }));
    room.players = new Map(renamed.map((p) => [p.id, p]));
    room.hostPlayerId = "uuid-zzz"; // host er insertion-[0]

    await engine.startGame({
      roomCode,
      actorPlayerId: "uuid-zzz",
      entryFee: 200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: extraConfig(),
    });

    // BILDE = celler 0, 4, 12, 20, 24. Grid:
    //   pos 0  = 1, pos 4  = 61
    //   pos 12 = 0 (free)
    //   pos 20 = 5, pos 24 = 65
    // Trenger ball 1, 61, 5, 65 (pos 12 er free-center).
    prioritiseDrawBag(engine, roomCode, [1, 61, 5, 65]);
    for (let i = 0; i < 4; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: "uuid-zzz" });
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const bilde = game.patternResults!.find((r) => r.patternId === "bilde")!;
    assert.equal(bilde.isWon, true, "BILDE vunnet av 3 spillere");
    assert.deepEqual(
      bilde.winnerIds,
      ["uuid-aaa", "uuid-mmm", "uuid-zzz"],
      "concurrent winnerIds må også være lex-sortert (samme tie-breaker)",
    );
    assert.equal(
      bilde.winnerId,
      "uuid-aaa",
      "concurrent firstWinnerId = lex-min",
    );
    // Suppress unused-vars warnings — guests are joined for fixture state.
    void hostId;
    void g1;
    void g2;
  },
);
