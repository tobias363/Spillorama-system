/**
 * Unified pipeline refactor — Fase 4 unit tests for GameOrchestrator.
 *
 * Verifiserer:
 *   - Happy path: advance game by one draw, verify all 4 side-effects
 *     (draw, claims, payout, audit).
 *   - Multi-winner: same draw triggers 2+ claims → all paid out.
 *   - Phase advance: claim triggers phase advance.
 *   - Game-over: claim triggers allCardsClosed → game ends cleanly.
 *   - Compliance: §71 actor_hall_id binding correct on cross-hall scheduled.
 *   - skipPatternEval-path (`buildPatternEvalState` returnerer null).
 *   - skipPayout-path (`buildPayoutInput` returnerer null per advance).
 *   - PayoutWalletCreditError propagerer ut av orchestrator.
 *   - DrawingError propagerer ut av orchestrator.
 *
 * Property-based invariants ligger i:
 *   `apps/backend/src/__tests__/invariants/orchestratorInvariant.test.ts`
 *
 * Equivalence (Old==New) test ligger i:
 *   `apps/backend/src/__tests__/orchestratorEquivalence.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DefaultIdempotencyKeyPort,
  InMemoryAuditPort,
  InMemoryCompliancePort,
  InMemoryWalletPort,
} from "../ports/index.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import {
  DrawingError,
  GameOrchestrator,
  PayoutWalletCreditError,
  type AdvanceGameByOneDrawInput,
  type DrawingGameState,
  type PatternEvalState,
} from "./GameOrchestrator.js";
import type { PatternDefinition, PatternResult, Ticket } from "../game/types.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeOrchestrator() {
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();
  const orchestrator = new GameOrchestrator({ wallet, compliance, audit, keys });
  return { wallet, compliance, audit, keys, orchestrator };
}

function makeTicket(grid25: number[]): Ticket {
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    grid.push(grid25.slice(r * 5, (r + 1) * 5));
  }
  return { grid };
}

function makeSpill1Patterns(): PatternDefinition[] {
  return [
    {
      id: "p1",
      name: "1 Rad",
      claimType: "LINE",
      prizePercent: 25,
      order: 1,
      design: 1,
    },
    {
      id: "p2",
      name: "2 Rader",
      claimType: "LINE",
      prizePercent: 35,
      order: 2,
      design: 2,
    },
    {
      id: "p3",
      name: "Fullt Hus",
      claimType: "BINGO",
      prizePercent: 40,
      order: 3,
      design: 3,
    },
  ];
}

function patternResultsFromPatterns(
  patterns: PatternDefinition[],
): PatternResult[] {
  return patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));
}

/**
 * Builder-helper: lager standard `AdvanceGameByOneDrawInput` med 1 spiller
 * (alice) og 1 ticket. Caller kan overstyre felter.
 */
function makeStandardInput(args: {
  drawingState?: Partial<DrawingGameState>;
  drawnNumbers?: number[];
  patterns?: PatternDefinition[];
  patternResults?: PatternResult[];
  tickets?: Map<string, Ticket[]>;
  totalPrizeCents?: number;
  walletId?: string;
  hallId?: string;
  actorHallId?: string;
  skipPayout?: boolean;
  skipPatternEval?: boolean;
}): AdvanceGameByOneDrawInput {
  const drawingState: DrawingGameState = {
    gameId: "game-1",
    status: "RUNNING",
    drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    drawsCompleted: 0,
    maxDraws: 10,
    ballRange: 75,
    ...(args.drawingState ?? {}),
  };
  const baseDrawnNumbers = args.drawnNumbers ?? [];
  const patterns = args.patterns ?? makeSpill1Patterns();
  const patternResults =
    args.patternResults ?? patternResultsFromPatterns(patterns);
  const tickets =
    args.tickets ??
    new Map<string, Ticket[]>([
      [
        "alice",
        [
          makeTicket([
            1, 2, 3, 4, 5,
            6, 7, 8, 9, 10,
            11, 12, 0, 13, 14,
            15, 16, 17, 18, 19,
            20, 21, 22, 23, 24,
          ]),
        ],
      ],
    ]);

  return {
    drawingState,
    buildPatternEvalState: ({ drawnBall }) => {
      if (args.skipPatternEval) return null;
      const drawnNumbers = [...baseDrawnNumbers, drawnBall];
      const state: PatternEvalState = {
        gameId: drawingState.gameId,
        status: "RUNNING",
        mode: "sequential",
        drawnNumbers,
        tickets,
        patterns,
        patternResults,
      };
      return state;
    },
    buildPayoutInput: (advance, ctx) => {
      if (args.skipPayout) return null;
      // Hver vinner får én default mapping: én wallet pr playerId.
      const winners = advance.winnerIds.map((playerId) => ({
        walletId: args.walletId ?? `wallet-${playerId}`,
        playerId,
        hallId: args.hallId ?? "hall-1",
        claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
      }));
      return {
        gameId: ctx.gameId,
        phaseId: `phase-${advance.patternIndex + 1}`,
        phaseName: advance.patternName,
        winners,
        totalPrizeCents: args.totalPrizeCents ?? 10_000,
        actorHallId: args.actorHallId ?? "hall-1",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      };
    },
  };
}

// ── Happy path ──────────────────────────────────────────────────────────────

test("GameOrchestrator: happy path — first draw, no winners yet, just draws ball", async () => {
  const { wallet, compliance, audit, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);

  // Drawing: ball 1 (drawBag[0]). Ingen vinnere ennå (kun 1 av 24 numre på alice's brett).
  const result = await orchestrator.advanceGameByOneDraw(makeStandardInput({}));

  assert.equal(result.drawing.nextBall, 1, "drawing returned ball 1");
  assert.equal(result.drawing.drawSequenceNumber, 1);
  assert.equal(result.drawing.isLastDraw, false);
  assert.notEqual(result.patternEval, null, "pattern-eval ble kjørt");
  assert.equal(
    result.patternEval!.phasesAdvanced.length,
    0,
    "ingen vinnere ennå — ingen phase advance",
  );
  assert.equal(result.payouts.length, 0);
  assert.equal(result.shouldEndGame, false);

  // Wallet uberørt.
  const balance = await wallet.getBalance("wallet-alice");
  assert.equal(balance.winnings, 0);
  assert.equal(balance.deposit, 0);

  // Compliance uberørt.
  assert.equal(compliance.count(), 0);

  // Audit har ÉN orchestration-summary.
  const summary = audit.findByAction("game.orchestration.advance");
  assert.equal(summary.length, 1);
  assert.equal(summary[0]!.resourceId, "game-1");
  assert.equal(
    (summary[0]!.details as Record<string, unknown>)?.drawnBall,
    1,
  );
});

test("GameOrchestrator: happy path — Phase 1 wins on 5th ball, alice gets paid", async () => {
  const { wallet, compliance, audit, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);

  // Etter 4 baller har alice rad 1 nesten klar; på ball 5 vinner hun Phase 1.
  // Vi simulerer state der drawnNumbers allerede er [1,2,3,4] og draws_completed=4.
  const input = makeStandardInput({
    drawingState: {
      gameId: "game-1",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4],
    walletId: "wallet-alice",
    totalPrizeCents: 10_000,
  });

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.drawing.nextBall, 5);
  assert.equal(result.drawing.drawSequenceNumber, 5);
  assert.notEqual(result.patternEval, null);
  assert.equal(
    result.patternEval!.phasesAdvanced.length,
    1,
    "Phase 1 (1 Rad) vunnet",
  );
  assert.equal(result.patternEval!.phasesAdvanced[0]!.patternName, "1 Rad");
  assert.equal(
    result.patternEval!.newClaims.length,
    1,
    "ÉN claim — alice vinner",
  );
  assert.equal(result.payouts.length, 1);
  assert.equal(result.payouts[0]!.payout!.totalWinners, 1);
  assert.equal(result.payouts[0]!.payout!.prizePerWinnerCents, 10_000);
  assert.equal(result.shouldEndGame, false, "Phase 1 ≠ BINGO → fortsetter");

  // Wallet kreditert 100 kr (10_000 øre = 100 kr) til winnings.
  const balance = await wallet.getBalance("wallet-alice");
  assert.equal(balance.winnings, 100);
  assert.equal(balance.deposit, 0);

  // Compliance har ÉN PRIZE-event.
  const events = compliance.getAllEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event.eventType, "PRIZE");
  assert.equal(events[0]!.event.amount, 100);
  assert.equal(events[0]!.event.hallId, "hall-1");
  assert.equal(events[0]!.event.gameType, "MAIN_GAME");

  // Audit har:
  //   1. PayoutService game.payout.phase
  //   2. GameOrchestrator game.orchestration.advance
  const payoutAudit = audit.findByAction("game.payout.phase");
  const summaryAudit = audit.findByAction("game.orchestration.advance");
  assert.equal(payoutAudit.length, 1, "PayoutService logget én summary");
  assert.equal(summaryAudit.length, 1, "Orchestrator logget én summary");
  assert.equal(
    (summaryAudit[0]!.details as Record<string, unknown>)?.phasesAdvancedCount,
    1,
  );
  assert.equal(
    (summaryAudit[0]!.details as Record<string, unknown>)?.totalPaidCents,
    10_000,
  );
});

// ── Multi-winner ────────────────────────────────────────────────────────────

test("GameOrchestrator: multi-winner — 2 spillere vinner samtidig, split likt", async () => {
  const { wallet, compliance, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);
  wallet.seed("wallet-bob", 0);

  // Begge har rad 1: 1,2,3,4,5.
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const bobTicket = makeTicket([
    1, 2, 3, 4, 5,
    25, 26, 27, 28, 29,
    30, 31, 0, 32, 33,
    34, 35, 36, 37, 38,
    39, 40, 41, 42, 43,
  ]);

  const tickets = new Map<string, Ticket[]>([
    ["alice", [aliceTicket]],
    ["bob", [bobTicket]],
  ]);

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-multi",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4],
    tickets,
    totalPrizeCents: 17_000, // 170 kr / 2 = 85 kr per vinner, ingen rest
  });
  // Override walletId-mapping per spiller.
  const orig = input.buildPayoutInput;
  input.buildPayoutInput = (advance, ctx) => {
    const base = orig(advance, ctx);
    if (!base) return null;
    return {
      ...base,
      winners: advance.winnerIds.map((playerId) => ({
        walletId: `wallet-${playerId}`,
        playerId,
        hallId: "hall-1",
        claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
      })),
    };
  };

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.patternEval!.phasesAdvanced.length, 1);
  assert.equal(result.payouts.length, 1);
  assert.equal(result.payouts[0]!.payout!.totalWinners, 2);
  assert.equal(result.payouts[0]!.payout!.prizePerWinnerCents, 8_500);
  assert.equal(result.payouts[0]!.payout!.houseRetainedCents, 0);

  // Begge wallets kreditert 85 kr.
  const aliceBalance = await wallet.getBalance("wallet-alice");
  const bobBalance = await wallet.getBalance("wallet-bob");
  assert.equal(aliceBalance.winnings, 85);
  assert.equal(bobBalance.winnings, 85);

  // 2 PRIZE-events.
  const events = compliance.getAllEvents();
  const prizeEvents = events.filter((e) => e.event.eventType === "PRIZE");
  assert.equal(prizeEvents.length, 2);
});

test("GameOrchestrator: multi-winner split med rest → HOUSE_RETAINED skrives", async () => {
  const { wallet, compliance, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);
  wallet.seed("wallet-bob", 0);
  wallet.seed("wallet-carol", 0);

  // 3 vinnere på rad 1.
  const ticket = (offset: number) =>
    makeTicket([
      1, 2, 3, 4, 5,
      offset + 1, offset + 2, offset + 3, offset + 4, offset + 5,
      offset + 11, offset + 12, 0, offset + 13, offset + 14,
      offset + 15, offset + 16, offset + 17, offset + 18, offset + 19,
      offset + 20, offset + 21, offset + 22, offset + 23, offset + 24,
    ]);

  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticket(50)]],
    ["bob", [ticket(60)]],
    ["carol", [ticket(40)]],
  ]);

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-3way",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4],
    tickets,
    totalPrizeCents: 1_700, // 1700 / 3 = 566.66... → 566 hver, rest 2 øre
  });
  // Override så hver vinner får sin egen wallet.
  const orig = input.buildPayoutInput;
  input.buildPayoutInput = (advance, ctx) => {
    const base = orig(advance, ctx);
    if (!base) return null;
    return {
      ...base,
      winners: advance.winnerIds.map((playerId) => ({
        walletId: `wallet-${playerId}`,
        playerId,
        hallId: "hall-1",
        claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
      })),
    };
  };

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.payouts[0]!.payout!.totalWinners, 3);
  assert.equal(result.payouts[0]!.payout!.prizePerWinnerCents, 566);
  assert.equal(result.payouts[0]!.payout!.houseRetainedCents, 2);

  // Compliance har 3 PRIZE + 1 HOUSE_RETAINED.
  const events = compliance.getAllEvents();
  const prizes = events.filter((e) => e.event.eventType === "PRIZE");
  const retained = events.filter(
    (e) => e.event.eventType === "HOUSE_RETAINED",
  );
  assert.equal(prizes.length, 3);
  assert.equal(retained.length, 1);
  assert.equal(retained[0]!.event.amount, 0.02, "rest 2 øre = 0.02 kr");
});

// ── Phase advance / Recursive ───────────────────────────────────────────────

test("GameOrchestrator: recursive phase progression — én ball fullfører Phase 1+2", async () => {
  const { wallet, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);

  // Alice har 2 rader klare etter ball 10: rad 0 (1-5) og rad 1 (6-10).
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const tickets = new Map<string, Ticket[]>([["alice", [aliceTicket]]]);

  // Etter 9 baller (1-9), neste = 10 fullfører rad 1 → recursion fullfører
  // Phase 1 (1 Rad — én rad) OG Phase 2 (2 Rader — to rader) i samme draw.
  const input = makeStandardInput({
    drawingState: {
      gameId: "game-recursive",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 9,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    tickets,
    walletId: "wallet-alice",
    totalPrizeCents: 5_000,
  });

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.drawing.nextBall, 10);
  assert.equal(result.drawing.isLastDraw, true, "10 == maxDraws=10");
  assert.equal(
    result.patternEval!.phasesAdvanced.length,
    2,
    "Phase 1 OG Phase 2 vinnes i samme draw",
  );
  assert.equal(result.payouts.length, 2);
  assert.equal(result.payouts[0]!.payout!.totalWinners, 1);
  assert.equal(result.payouts[1]!.payout!.totalWinners, 1);

  // Alice fikk 50 + 50 = 100 kr totalt.
  const balance = await wallet.getBalance("wallet-alice");
  assert.equal(balance.winnings, 100);

  assert.equal(result.shouldEndGame, true, "isLastDraw=true → end");
});

test("GameOrchestrator: BINGO/Fullt Hus vunnet → allCardsClosed → shouldEndGame", async () => {
  const { wallet, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);

  // Alice har full bingo etter 24 baller (1-24, free centre).
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const tickets = new Map<string, Ticket[]>([["alice", [aliceTicket]]]);

  // Drawn 1..23, neste ball 24 fullfører Fullt Hus (og rad 0,1,2,3,4 i recursion).
  const input = makeStandardInput({
    drawingState: {
      gameId: "game-bingo",
      status: "RUNNING",
      drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
      drawsCompleted: 23,
      maxDraws: 75,
      ballRange: 75,
    },
    drawnNumbers: Array.from({ length: 23 }, (_, i) => i + 1),
    tickets,
    walletId: "wallet-alice",
    totalPrizeCents: 10_000,
  });

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.drawing.nextBall, 24);
  // Phase 1+2+3 vinnes i samme draw via recursion.
  assert.equal(result.patternEval!.phasesAdvanced.length, 3);
  assert.equal(result.patternEval!.allCardsClosed, true);
  assert.equal(
    result.shouldEndGame,
    true,
    "Fullt Hus vunnet → game over",
  );

  // Phase 3 skal være claimType=BINGO.
  const bingoAdvance = result.patternEval!.phasesAdvanced.find(
    (a) => a.claimType === "BINGO",
  );
  assert.notEqual(bingoAdvance, undefined);
  assert.equal(bingoAdvance!.patternName, "Fullt Hus");

  // Alice fikk 3 × 100 kr = 300 kr.
  const balance = await wallet.getBalance("wallet-alice");
  assert.equal(balance.winnings, 300);
});

// ── §71 multi-hall actor_hall_id binding ───────────────────────────────────

test("GameOrchestrator: §71 — vinner-hall vs master-hall bindes korrekt i compliance", async () => {
  const { wallet, compliance, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);
  wallet.seed("wallet-bob", 0);

  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const bobTicket = makeTicket([
    1, 2, 3, 4, 5,
    25, 26, 27, 28, 29,
    30, 31, 0, 32, 33,
    34, 35, 36, 37, 38,
    39, 40, 41, 42, 43,
  ]);
  const tickets = new Map<string, Ticket[]>([
    ["alice", [aliceTicket]],
    ["bob", [bobTicket]],
  ]);

  // Master-hall er hall-master. Alice er på hall-A, Bob er på hall-B.
  // Begge vinner Phase 1 på samme draw.
  const input: AdvanceGameByOneDrawInput = {
    drawingState: {
      gameId: "game-cross-hall",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    buildPatternEvalState: ({ drawnBall }) => ({
      gameId: "game-cross-hall",
      status: "RUNNING",
      mode: "sequential",
      drawnNumbers: [1, 2, 3, 4, drawnBall],
      tickets,
      patterns: makeSpill1Patterns(),
      patternResults: patternResultsFromPatterns(makeSpill1Patterns()),
    }),
    buildPayoutInput: (advance, ctx) => ({
      gameId: ctx.gameId,
      phaseId: `phase-${advance.patternIndex + 1}`,
      phaseName: advance.patternName,
      // Per-vinner hallId: alice → hall-A, bob → hall-B.
      winners: advance.winnerIds.map((playerId) => ({
        walletId: `wallet-${playerId}`,
        playerId,
        hallId: playerId === "alice" ? "hall-A" : "hall-B",
        claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
      })),
      totalPrizeCents: 10_000,
      actorHallId: "hall-master", // Master-hall
      isFixedPrize: true,
      gameType: "MAIN_GAME",
      channel: "INTERNET",
    }),
  };

  await orchestrator.advanceGameByOneDraw(input);

  // §71-binding: PRIZE-event.hallId MÅ være vinnerens hall-id, ikke
  // master. Sjekk eksplisitt.
  const events = compliance.getAllEvents();
  const prizes = events.filter((e) => e.event.eventType === "PRIZE");
  assert.equal(prizes.length, 2);

  const aliceEvent = prizes.find((e) => e.event.playerId === "alice");
  const bobEvent = prizes.find((e) => e.event.playerId === "bob");

  assert.notEqual(aliceEvent, undefined, "alice fikk PRIZE-event");
  assert.notEqual(bobEvent, undefined, "bob fikk PRIZE-event");
  assert.equal(
    aliceEvent!.event.hallId,
    "hall-A",
    "§71: alice's PRIZE bindes til hall-A (kjøpe-hall), ikke hall-master",
  );
  assert.equal(
    bobEvent!.event.hallId,
    "hall-B",
    "§71: bob's PRIZE bindes til hall-B (kjøpe-hall), ikke hall-master",
  );

  // Master-hall er logget i metadata for traceability.
  assert.equal(
    (aliceEvent!.event.metadata as Record<string, unknown>)?.actorHallId,
    "hall-master",
  );
  assert.equal(
    (bobEvent!.event.metadata as Record<string, unknown>)?.actorHallId,
    "hall-master",
  );
});

// ── Skip-paths ──────────────────────────────────────────────────────────────

test("GameOrchestrator: skipPatternEval — buildPatternEvalState=null → bare draw", async () => {
  const { wallet, compliance, audit, orchestrator } = makeOrchestrator();

  const result = await orchestrator.advanceGameByOneDraw(
    makeStandardInput({ skipPatternEval: true }),
  );

  assert.equal(result.drawing.nextBall, 1);
  assert.equal(result.patternEval, null, "pattern-eval skippet");
  assert.equal(result.payouts.length, 0);
  assert.equal(compliance.count(), 0);
  // Audit skal fortsatt logge orchestration-summary.
  assert.equal(audit.findByAction("game.orchestration.advance").length, 1);
});

test("GameOrchestrator: skipPayout — buildPayoutInput=null → advance registrert uten payout", async () => {
  const { wallet, compliance, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-1",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4],
    skipPayout: true,
  });

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.patternEval!.phasesAdvanced.length, 1);
  assert.equal(
    result.payouts.length,
    1,
    "advance registrert i payouts-array",
  );
  assert.equal(
    result.payouts[0]!.payout,
    null,
    "men payout=null fordi caller skippet",
  );
  // Wallet uberørt.
  const balance = await wallet.getBalance("wallet-alice");
  assert.equal(balance.winnings, 0);
  // Compliance uberørt.
  assert.equal(compliance.count(), 0);
});

// ── Error propagation ──────────────────────────────────────────────────────

test("GameOrchestrator: DrawingError propagerer ut (game ikke RUNNING)", async () => {
  const { orchestrator } = makeOrchestrator();

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-paused",
      status: "NOT_RUNNING",
      drawBag: [1, 2, 3],
      drawsCompleted: 0,
      maxDraws: 3,
      ballRange: 75,
    },
  });

  await assert.rejects(
    () => orchestrator.advanceGameByOneDraw(input),
    (err: unknown) => {
      assert.ok(err instanceof DrawingError);
      assert.equal((err as DrawingError).code, "GAME_NOT_RUNNING");
      return true;
    },
  );
});

test("GameOrchestrator: DrawingError propagerer ut (draw bag exhausted)", async () => {
  const { orchestrator } = makeOrchestrator();

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-exhausted",
      status: "RUNNING",
      drawBag: [1, 2, 3],
      drawsCompleted: 3,
      maxDraws: 3,
      ballRange: 75,
    },
  });

  await assert.rejects(
    () => orchestrator.advanceGameByOneDraw(input),
    (err: unknown) => {
      assert.ok(err instanceof DrawingError);
      assert.equal((err as DrawingError).code, "MAX_DRAWS_REACHED");
      return true;
    },
  );
});

test("GameOrchestrator: PayoutWalletCreditError propagerer ut (wallet ikke seedet)", async () => {
  const { orchestrator } = makeOrchestrator();
  // wallet-alice ikke seedet → InMemoryWalletPort.credit kaster ikke for
  // ukjent wallet (den auto-seeder), så vi simulerer feil ved å bruke
  // negativt beløp via custom buildPayoutInput.
  //
  // Faktisk: InMemoryWalletPort.credit lager wallet automatisk hvis ikke
  // eksisterer. For å forsere PayoutWalletCreditError må vi bruke en
  // injection-stub for payoutService.

  // Lag en stub PayoutService som alltid kaster.
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();
  const stubPayout = {
    async payoutPhase(): Promise<never> {
      throw new PayoutWalletCreditError(
        "Stub payout failure",
        new WalletError("INSUFFICIENT_FUNDS", "ikke nok"),
      );
    },
  };
  const orch = new GameOrchestrator({
    wallet,
    compliance,
    audit,
    keys,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payoutService: stubPayout as any,
  });

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-1",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4],
  });

  await assert.rejects(
    () => orch.advanceGameByOneDraw(input),
    (err: unknown) => {
      assert.ok(err instanceof PayoutWalletCreditError);
      return true;
    },
  );
});

// ── isLastDraw / shouldEndGame ─────────────────────────────────────────────

test("GameOrchestrator: isLastDraw=true → shouldEndGame=true (selv uten claim)", async () => {
  const { orchestrator } = makeOrchestrator();

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-last",
      status: "RUNNING",
      drawBag: [1, 2, 3],
      drawsCompleted: 2,
      maxDraws: 3,
      ballRange: 75,
    },
    // Tom tickets-map → ingen vinnere mulig.
    tickets: new Map(),
  });

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.drawing.isLastDraw, true);
  assert.equal(result.patternEval!.phasesAdvanced.length, 0);
  assert.equal(
    result.shouldEndGame,
    true,
    "isLastDraw=true → shouldEndGame=true",
  );
});

// ── Audit-log integrity ────────────────────────────────────────────────────

test("GameOrchestrator: audit-log inkluderer drawing+pattern+payout-summary", async () => {
  const { wallet, audit, orchestrator } = makeOrchestrator();
  wallet.seed("wallet-alice", 0);

  const input = makeStandardInput({
    drawingState: {
      gameId: "game-audit",
      status: "RUNNING",
      drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      drawsCompleted: 4,
      maxDraws: 10,
      ballRange: 75,
    },
    drawnNumbers: [1, 2, 3, 4],
    walletId: "wallet-alice",
    totalPrizeCents: 25_000,
  });

  await orchestrator.advanceGameByOneDraw(input);

  const summary = audit.findByAction("game.orchestration.advance");
  assert.equal(summary.length, 1);
  const details = summary[0]!.details as Record<string, unknown>;
  assert.equal(details.drawnBall, 5);
  assert.equal(details.drawSequenceNumber, 5);
  assert.equal(details.isLastDraw, false);
  assert.equal(details.phasesAdvancedCount, 1);
  assert.equal(details.newClaimsCount, 1);
  assert.equal(details.allCardsClosed, false);
  assert.equal(details.payoutCount, 1);
  assert.equal(details.totalPaidCents, 25_000);
});
