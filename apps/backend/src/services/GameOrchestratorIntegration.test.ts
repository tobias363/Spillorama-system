/**
 * Unified pipeline refactor — Fase 4 integration test for GameOrchestrator.
 *
 * Verifiserer at orchestrator-en kan kjøre mot eksisterende prod-infrastruktur
 * (`WalletAdapter` + `ComplianceLedgerPort` + `AuditLogService`) gjennom
 * adapter-wrappers (`WalletAdapterPort`, `ComplianceAdapterPort`,
 * `AuditAdapterPort`). Dette er broen som lar produksjons-call-sites
 * migrere inkrementelt mot orchestrator-en uten å bytte ut hele
 * infrastrukturen i én PR.
 *
 * Test-strategi:
 *   - Bruk `InMemoryWalletAdapter` (ekte adapter, ikke port).
 *   - Bruk `InMemoryAuditLogStore` + `AuditLogService` (ekte service).
 *   - Bruk `StubComplianceLedgerPort` som teller events (samme mønster
 *     som `PayoutServiceWithAdapters.test.ts`).
 *
 * Verifiserer:
 *   - GameOrchestrator komponerer Drawing + PatternEval + Payout uten å
 *     forskyve adapter-typene (cents-baserte beregninger holder).
 *   - End-to-end: én full Spill 1-runde fra start til BINGO med multi-
 *     winner.
 *   - Compliance-events havner på legacy ComplianceLedgerPort (med kroner-
 *     beløp, matcher prod-konvensjonen).
 *   - Audit-events skrives via AuditLogService.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type {
  ComplianceLedgerEventInput,
  ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import { DefaultIdempotencyKeyPort } from "../ports/IdempotencyKeyPort.js";
import {
  AuditAdapterPort,
  ComplianceAdapterPort,
  WalletAdapterPort,
} from "./adapters/index.js";
import {
  GameOrchestrator,
  type AdvanceGameByOneDrawInput,
  type DrawingGameState,
} from "./GameOrchestrator.js";
import type { PatternDefinition, PatternResult, Ticket } from "../game/types.js";

// ── Stub helpers ────────────────────────────────────────────────────────────

class StubComplianceLedgerPort implements ComplianceLedgerPort {
  events: ComplianceLedgerEventInput[] = [];

  async recordComplianceLedgerEvent(
    input: ComplianceLedgerEventInput,
  ): Promise<void> {
    this.events.push(input);
  }
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
    { id: "p1", name: "1 Rad", claimType: "LINE", prizePercent: 25, order: 1, design: 1 },
    { id: "p2", name: "2 Rader", claimType: "LINE", prizePercent: 35, order: 2, design: 2 },
    { id: "p3", name: "Fullt Hus", claimType: "BINGO", prizePercent: 40, order: 3, design: 3 },
  ];
}

function freshPatternResults(
  patterns: PatternDefinition[],
): PatternResult[] {
  return patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));
}

// ── Integration: full Spill 1 round end-to-end ─────────────────────────────

test("Integration: GameOrchestrator + adapter-bridges — full Spill 1-runde til BINGO", async () => {
  // Setup ekte adapter-infrastruktur.
  const walletAdapter = new InMemoryWalletAdapter();
  await walletAdapter.createAccount({
    accountId: "wallet-alice",
    initialBalance: 0,
  });
  await walletAdapter.createAccount({
    accountId: "wallet-bob",
    initialBalance: 0,
  });

  const legacyComplianceLedger = new StubComplianceLedgerPort();
  const auditStore = new InMemoryAuditLogStore();
  const auditService = new AuditLogService(auditStore);

  // Wire orchestrator via adapter-bridges.
  const orchestrator = new GameOrchestrator({
    wallet: new WalletAdapterPort(walletAdapter),
    compliance: new ComplianceAdapterPort(legacyComplianceLedger),
    audit: new AuditAdapterPort(auditService),
    keys: new DefaultIdempotencyKeyPort(),
  });

  // Test-data.
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const bobTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    51, 52, 0, 53, 54,
    55, 56, 57, 58, 59,
    60, 61, 62, 63, 64,
  ]);
  const tickets = new Map<string, Ticket[]>([
    ["alice", [aliceTicket]],
    ["bob", [bobTicket]],
  ]);
  const patterns = makeSpill1Patterns();

  let drawnNumbers: number[] = [];
  let currentPatternResults = freshPatternResults(patterns);
  let drawsCompleted = 0;
  const maxDraws = 75;
  const drawBag = Array.from({ length: 75 }, (_, i) => i + 1);

  // Run 30 draws or until BINGO.
  for (let i = 0; i < 30; i++) {
    if (drawsCompleted >= maxDraws) break;
    if (currentPatternResults.every((r) => r.isWon)) break;

    const drawingState: DrawingGameState = {
      gameId: "game-integ",
      status: "RUNNING",
      drawBag,
      drawsCompleted,
      maxDraws,
      ballRange: 75,
    };

    const input: AdvanceGameByOneDrawInput = {
      drawingState,
      buildPatternEvalState: ({ drawnBall }) => ({
        gameId: "game-integ",
        status: "RUNNING",
        mode: "sequential",
        drawnNumbers: [...drawnNumbers, drawnBall],
        tickets,
        patterns,
        patternResults: currentPatternResults,
      }),
      buildPayoutInput: (advance, ctx) => ({
        gameId: ctx.gameId,
        phaseId: `phase-${advance.patternIndex + 1}`,
        phaseName: advance.patternName,
        winners: advance.winnerIds.map((playerId) => ({
          walletId: `wallet-${playerId}`,
          playerId,
          hallId: playerId === "alice" ? "hall-A" : "hall-B",
          claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
        })),
        totalPrizeCents: 10_000, // 100 kr per phase
        actorHallId: "hall-master",
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    };

    const result = await orchestrator.advanceGameByOneDraw(input);
    drawnNumbers.push(result.drawing.nextBall);
    drawsCompleted = result.drawing.drawSequenceNumber;

    if (result.patternEval) {
      currentPatternResults = currentPatternResults.map((r) => {
        const advance = result.patternEval!.phasesAdvanced.find(
          (a) => a.patternId === r.patternId,
        );
        if (!advance) return r;
        return {
          ...r,
          isWon: true,
          winnerIds: [...advance.winnerIds],
          winnerCount: advance.winnerIds.length,
        };
      });
    }

    if (result.shouldEndGame) break;
  }

  // ── Assertions ──────────────────────────────────────────────────────────

  // Alice fikk Phase 1 (split 50kr/50kr med Bob), Phase 2 (split 50/50),
  // Phase 3 BINGO solo (100 kr). Total: 50+50+100 = 200 kr.
  // Bob fikk Phase 1 + Phase 2: 50+50 = 100 kr.
  const aliceBalance = await walletAdapter.getBothBalances("wallet-alice");
  const bobBalance = await walletAdapter.getBothBalances("wallet-bob");
  assert.equal(aliceBalance.winnings, 200, "alice fikk 50+50+100=200 kr");
  assert.equal(bobBalance.winnings, 100, "bob fikk 50+50=100 kr");

  // Compliance: 5 PRIZE-events (2 phases med 2 vinnere + 1 BINGO solo).
  const prizeEvents = legacyComplianceLedger.events.filter(
    (e) => e.eventType === "PRIZE",
  );
  assert.equal(prizeEvents.length, 5, "Forventet 5 PRIZE-events");

  // §71-binding: alice → hall-A, bob → hall-B (kjøpe-hall, IKKE master).
  const aliceEvents = prizeEvents.filter((e) => e.playerId === "alice");
  const bobEvents = prizeEvents.filter((e) => e.playerId === "bob");
  for (const e of aliceEvents) {
    assert.equal(e.hallId, "hall-A", "§71: alice's PRIZE bindes til hall-A");
  }
  for (const e of bobEvents) {
    assert.equal(e.hallId, "hall-B", "§71: bob's PRIZE bindes til hall-B");
  }

  // Master-hall i metadata.
  for (const e of prizeEvents) {
    assert.equal(
      (e.metadata as Record<string, unknown> | undefined)?.actorHallId,
      "hall-master",
      "metadata.actorHallId må være master-hall",
    );
  }

  // Audit-log skal ha:
  //   - 3 game.payout.phase (PayoutService)
  //   - N game.orchestration.advance (GameOrchestrator)
  const allEvents = await auditStore.list({});
  const payoutEvents = allEvents.filter((e) => e.action === "game.payout.phase");
  const orchEvents = allEvents.filter(
    (e) => e.action === "game.orchestration.advance",
  );
  assert.equal(payoutEvents.length, 3, "Forventet 3 payout.phase audit-events");
  assert.ok(orchEvents.length > 0, "Orchestrator skal logge per draw");

  console.log(
    `[INTEG] Round complete: ${drawsCompleted} draws, alice=${aliceBalance.winnings}kr, bob=${bobBalance.winnings}kr, ${prizeEvents.length} PRIZE-events`,
  );
});

// ── Integration: split-rounding via real adapter ───────────────────────────

test("Integration: GameOrchestrator + adapter-bridges — multi-winner split with HOUSE_RETAINED", async () => {
  const walletAdapter = new InMemoryWalletAdapter();
  await walletAdapter.createAccount({
    accountId: "wallet-A",
    initialBalance: 0,
  });
  await walletAdapter.createAccount({
    accountId: "wallet-B",
    initialBalance: 0,
  });
  await walletAdapter.createAccount({
    accountId: "wallet-C",
    initialBalance: 0,
  });

  const legacyComplianceLedger = new StubComplianceLedgerPort();
  const auditStore = new InMemoryAuditLogStore();
  const auditService = new AuditLogService(auditStore);

  const orchestrator = new GameOrchestrator({
    wallet: new WalletAdapterPort(walletAdapter),
    compliance: new ComplianceAdapterPort(legacyComplianceLedger),
    audit: new AuditAdapterPort(auditService),
    keys: new DefaultIdempotencyKeyPort(),
  });

  // 3 vinnere som alle har rad 0 = [1,2,3,4,5].
  const ticket = (offset: number) =>
    makeTicket([
      1, 2, 3, 4, 5,
      offset, offset + 1, offset + 2, offset + 3, offset + 4,
      offset + 5, offset + 6, 0, offset + 7, offset + 8,
      offset + 9, offset + 10, offset + 11, offset + 12, offset + 13,
      offset + 14, offset + 15, offset + 16, offset + 17, offset + 18,
    ]);
  const tickets = new Map<string, Ticket[]>([
    ["A", [ticket(30)]],
    ["B", [ticket(45)]],
    ["C", [ticket(60)]],
  ]);
  const patterns = makeSpill1Patterns();

  // Simuler ball 5 fullfører Phase 1.
  const drawingState: DrawingGameState = {
    gameId: "game-split",
    status: "RUNNING",
    drawBag: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    drawsCompleted: 4,
    maxDraws: 10,
    ballRange: 75,
  };

  const input: AdvanceGameByOneDrawInput = {
    drawingState,
    buildPatternEvalState: ({ drawnBall }) => ({
      gameId: "game-split",
      status: "RUNNING",
      mode: "sequential",
      drawnNumbers: [1, 2, 3, 4, drawnBall],
      tickets,
      patterns,
      patternResults: freshPatternResults(patterns),
    }),
    buildPayoutInput: (advance, ctx) => ({
      gameId: ctx.gameId,
      phaseId: `phase-${advance.patternIndex + 1}`,
      phaseName: advance.patternName,
      winners: advance.winnerIds.map((playerId) => ({
        walletId: `wallet-${playerId}`,
        playerId,
        hallId: `hall-${playerId}`,
        claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
      })),
      totalPrizeCents: 1_700, // 1700/3 = 566.66 → 566/566/566 + rest 2 øre
      actorHallId: "hall-master",
      isFixedPrize: true,
      gameType: "MAIN_GAME",
      channel: "INTERNET",
    }),
  };

  const result = await orchestrator.advanceGameByOneDraw(input);

  assert.equal(result.payouts.length, 1);
  assert.equal(result.payouts[0]!.payout!.totalWinners, 3);
  assert.equal(result.payouts[0]!.payout!.prizePerWinnerCents, 566);
  assert.equal(result.payouts[0]!.payout!.houseRetainedCents, 2);

  // Hver vinner fikk 5.66 kr (566 øre).
  const a = await walletAdapter.getBothBalances("wallet-A");
  const b = await walletAdapter.getBothBalances("wallet-B");
  const c = await walletAdapter.getBothBalances("wallet-C");
  assert.equal(a.winnings, 5.66);
  assert.equal(b.winnings, 5.66);
  assert.equal(c.winnings, 5.66);

  // Compliance: 3 PRIZE + 1 HOUSE_RETAINED.
  const events = legacyComplianceLedger.events;
  const prizes = events.filter((e) => e.eventType === "PRIZE");
  const retained = events.filter((e) => e.eventType === "HOUSE_RETAINED");
  assert.equal(prizes.length, 3);
  assert.equal(retained.length, 1);
  assert.equal(retained[0]!.amount, 0.02);
});
