/**
 * Unified pipeline refactor — Fase 4 EQUIVALENCE TEST (CRITICAL).
 *
 * Verifiserer at "ny flyt via GameOrchestrator" produserer NØYAKTIG samme
 * effekter som "gammel flyt via direkte komposisjon av Drawing + PatternEval
 * + Payout". Dette er safety-net-en for migrering — uten denne kan vi ikke
 * trygt rute prod-call-sites gjennom orchestrator-en.
 *
 * **Hva er "OLD" og "NEW" her?**
 *
 *   - OLD: vi kaller DrawingService, PatternEvalService og PayoutService
 *     direkte (uten orchestrator), step-for-step, slik som
 *     `BingoEngine._drawNextNumberLocked` ville gjort hvis det var migrert
 *     til services-laget. Audit-logging gjøres MANUELT (matcher prod-
 *     pattern der hver service-call har sin egen audit-side-effekt).
 *
 *   - NEW: vi kaller `GameOrchestrator.advanceGameByOneDraw` som
 *     komponerer de 3 service-kallene internt. Orchestrator-en logger
 *     EKSTRA `game.orchestration.advance`-summary, men payout-events er
 *     identiske.
 *
 * **Hvorfor matter dette?**
 *
 *   PR-en endrer ingen service-kontrakter — kun introduserer en ny
 *   composition-primitive. Hvis OLD og NEW gir samme wallet-state +
 *   samme compliance-events + samme payout-rekkefølge, er det BEVIS for
 *   at orchestrator-en er en ren refactor.
 *
 *   Ekstra audit-event fra orchestrator (orchestration.advance) er
 *   forventet differanse — vi sjekker at den IKKE forskyver eksisterende
 *   audit-events, men kommer som tillegg.
 *
 * **30-draw bingo-runde med multiple phases.**
 *
 *   Vi simulerer en realistisk Spill 1-runde med:
 *   - 3 spillere på ulike haller (multi-hall §71-test)
 *   - 75-ball draw-bag
 *   - Sekvensiell pattern-progressjon (Phase 1 → Phase 2 → Phase 3 BINGO)
 *   - Multi-winner split med rest til hus
 *
 *   Equivalence-assertions:
 *   - Identisk draw-sekvens (selvsagt — DrawingService er pure).
 *   - Identiske wallet-balanser per spiller etter alle draws.
 *   - Identisk antall compliance-events.
 *   - Identisk sum compliance-events.
 *   - Identisk hallId-binding per PRIZE-event.
 *   - Identisk rekkefølge på compliance-events (insertion-order).
 *   - Identisk antall game.payout.phase audit-events (orchestration.advance
 *     er additive).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DefaultIdempotencyKeyPort,
  InMemoryAuditPort,
  InMemoryCompliancePort,
  InMemoryWalletPort,
} from "../ports/index.js";
import {
  DrawingService,
  type DrawingGameState,
} from "../services/DrawingService.js";
import {
  PatternEvalService,
  type PatternEvalState,
} from "../services/PatternEvalService.js";
import { PayoutService } from "../services/PayoutService.js";
import {
  GameOrchestrator,
  type AdvanceGameByOneDrawInput,
} from "../services/GameOrchestrator.js";
import type { PatternDefinition, PatternResult, Ticket } from "../game/types.js";

// ── Shared fixtures ─────────────────────────────────────────────────────────

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

interface RoundFixture {
  drawBag: number[];
  maxDraws: number;
  drawsToRun: number;
  tickets: Map<string, Ticket[]>;
  hallByPlayer: Map<string, string>;
  totalPrizeCents: number;
  actorHallId: string;
  gameId: string;
  patterns: PatternDefinition[];
}

function makeRoundFixture(): RoundFixture {
  // 3 spillere, 3 haller, alle har rad 0 = [1..5] for tidlig phase 1.
  // Alice har full bingo for Phase 3.
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  // Bob har rad 0 + rad 1 (numre 1-10).
  const bobTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    51, 52, 0, 53, 54,
    55, 56, 57, 58, 59,
    60, 61, 62, 63, 64,
  ]);
  // Carol har bare rad 0.
  const carolTicket = makeTicket([
    1, 2, 3, 4, 5,
    25, 26, 27, 28, 29,
    30, 31, 0, 32, 33,
    34, 35, 36, 37, 38,
    39, 40, 41, 42, 43,
  ]);

  const tickets = new Map<string, Ticket[]>([
    ["alice", [aliceTicket]],
    ["bob", [bobTicket]],
    ["carol", [carolTicket]],
  ]);

  const hallByPlayer = new Map<string, string>([
    ["alice", "hall-A"],
    ["bob", "hall-B"],
    ["carol", "hall-C"],
  ]);

  return {
    drawBag: Array.from({ length: 75 }, (_, i) => i + 1), // 1..75
    maxDraws: 75,
    drawsToRun: 30,
    tickets,
    hallByPlayer,
    totalPrizeCents: 1_700, // gir 566/566/568 ved 3-way split (rest 2 øre)
    actorHallId: "hall-master",
    gameId: "game-equiv",
    patterns: makeSpill1Patterns(),
  };
}

// ── OLD-flow simulator (uten GameOrchestrator) ──────────────────────────────

/**
 * Simulerer "OLD"-flyten: kaller DrawingService, PatternEvalService og
 * PayoutService direkte uten GameOrchestrator. Dette matcher hva
 * `BingoEngine._drawNextNumberLocked` ville gjort hvis det var migrert
 * til services-laget — men UTEN orchestrator-en som komponerer dem.
 *
 * Returnerer det samme baseline-sett av ports + tracking-data.
 */
async function runOldFlow(fixture: RoundFixture): Promise<{
  wallet: InMemoryWalletPort;
  compliance: InMemoryCompliancePort;
  audit: InMemoryAuditPort;
  drawSequence: number[];
  finalBalances: Map<string, number>;
}> {
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();

  const drawingService = new DrawingService();
  const patternEvalService = new PatternEvalService();
  const payoutService = new PayoutService({
    wallet,
    compliance,
    audit,
    keys,
  });

  // Pre-seed wallets.
  for (const [playerId] of fixture.tickets) {
    wallet.seed(`wallet-${playerId}`, 0);
  }

  let drawnNumbers: number[] = [];
  let currentPatternResults = freshPatternResults(fixture.patterns);
  let drawsCompleted = 0;
  const drawSequence: number[] = [];

  for (let i = 0; i < fixture.drawsToRun; i++) {
    if (drawsCompleted >= fixture.maxDraws) break;
    if (currentPatternResults.every((r) => r.isWon)) break;

    // Step 1: Drawing
    const drawingState: DrawingGameState = {
      gameId: fixture.gameId,
      status: "RUNNING",
      drawBag: fixture.drawBag,
      drawsCompleted,
      maxDraws: fixture.maxDraws,
      ballRange: 75,
    };
    const drawing = drawingService.drawNext(drawingState);
    drawnNumbers.push(drawing.nextBall);
    drawsCompleted = drawing.drawSequenceNumber;
    drawSequence.push(drawing.nextBall);

    // Step 2: Pattern eval
    const patternEvalState: PatternEvalState = {
      gameId: fixture.gameId,
      status: "RUNNING",
      mode: "sequential",
      drawnNumbers,
      tickets: fixture.tickets,
      patterns: fixture.patterns,
      patternResults: currentPatternResults,
    };
    const patternEval = patternEvalService.evaluateAfterDraw(patternEvalState);

    // Step 3: Per phase advance — kall payoutPhase direkte
    for (const advance of patternEval.phasesAdvanced) {
      await payoutService.payoutPhase({
        gameId: fixture.gameId,
        phaseId: `phase-${advance.patternIndex + 1}`,
        phaseName: advance.patternName,
        winners: advance.winnerIds.map((playerId) => ({
          walletId: `wallet-${playerId}`,
          playerId,
          hallId: fixture.hallByPlayer.get(playerId) ?? "hall-default",
          claimId: `claim-${fixture.gameId}-${advance.patternId}-${playerId}`,
        })),
        totalPrizeCents: fixture.totalPrizeCents,
        actorHallId: fixture.actorHallId,
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      });
    }

    // Step 4: Oppdater patternResults så neste iterasjon hopper over
    // allerede-vunne patterns (matcher prod-flyten).
    currentPatternResults = currentPatternResults.map((r) => {
      const advance = patternEval.phasesAdvanced.find(
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

    if (patternEval.allCardsClosed) break;
  }

  const finalBalances = new Map<string, number>();
  for (const [playerId] of fixture.tickets) {
    const b = await wallet.getBalance(`wallet-${playerId}`);
    finalBalances.set(playerId, b.winnings);
  }

  return { wallet, compliance, audit, drawSequence, finalBalances };
}

// ── NEW-flow simulator (med GameOrchestrator) ──────────────────────────────

/**
 * Simulerer "NEW"-flyten: bruker GameOrchestrator.advanceGameByOneDraw
 * som komponerer de samme 3 services. Mellom hvert kall oppdaterer caller
 * patternResults (matcher OLD-flyten).
 */
async function runNewFlow(fixture: RoundFixture): Promise<{
  wallet: InMemoryWalletPort;
  compliance: InMemoryCompliancePort;
  audit: InMemoryAuditPort;
  drawSequence: number[];
  finalBalances: Map<string, number>;
}> {
  const wallet = new InMemoryWalletPort();
  const compliance = new InMemoryCompliancePort();
  const audit = new InMemoryAuditPort();
  const keys = new DefaultIdempotencyKeyPort();
  const orchestrator = new GameOrchestrator({
    wallet,
    compliance,
    audit,
    keys,
  });

  for (const [playerId] of fixture.tickets) {
    wallet.seed(`wallet-${playerId}`, 0);
  }

  let drawnNumbers: number[] = [];
  let currentPatternResults = freshPatternResults(fixture.patterns);
  let drawsCompleted = 0;
  const drawSequence: number[] = [];

  for (let i = 0; i < fixture.drawsToRun; i++) {
    if (drawsCompleted >= fixture.maxDraws) break;
    if (currentPatternResults.every((r) => r.isWon)) break;

    const input: AdvanceGameByOneDrawInput = {
      drawingState: {
        gameId: fixture.gameId,
        status: "RUNNING",
        drawBag: fixture.drawBag,
        drawsCompleted,
        maxDraws: fixture.maxDraws,
        ballRange: 75,
      },
      buildPatternEvalState: ({ drawnBall }) => ({
        gameId: fixture.gameId,
        status: "RUNNING",
        mode: "sequential",
        drawnNumbers: [...drawnNumbers, drawnBall],
        tickets: fixture.tickets,
        patterns: fixture.patterns,
        patternResults: currentPatternResults,
      }),
      buildPayoutInput: (advance, ctx) => ({
        gameId: ctx.gameId,
        phaseId: `phase-${advance.patternIndex + 1}`,
        phaseName: advance.patternName,
        winners: advance.winnerIds.map((playerId) => ({
          walletId: `wallet-${playerId}`,
          playerId,
          hallId: fixture.hallByPlayer.get(playerId) ?? "hall-default",
          claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
        })),
        totalPrizeCents: fixture.totalPrizeCents,
        actorHallId: fixture.actorHallId,
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    };

    const result = await orchestrator.advanceGameByOneDraw(input);
    drawnNumbers.push(result.drawing.nextBall);
    drawsCompleted = result.drawing.drawSequenceNumber;
    drawSequence.push(result.drawing.nextBall);

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

  const finalBalances = new Map<string, number>();
  for (const [playerId] of fixture.tickets) {
    const b = await wallet.getBalance(`wallet-${playerId}`);
    finalBalances.set(playerId, b.winnings);
  }

  return { wallet, compliance, audit, drawSequence, finalBalances };
}

// ── EQUIVALENCE TEST ────────────────────────────────────────────────────────

test("EQUIVALENCE: OLD-flow == NEW-flow over 30-draw bingo round", async () => {
  const fixture = makeRoundFixture();

  const old = await runOldFlow(fixture);
  const nu = await runNewFlow(fixture);

  // ── 1. Identisk draw-sekvens ────────────────────────────────────────────
  assert.deepEqual(
    old.drawSequence,
    nu.drawSequence,
    "Draw-sekvens MÅ være identisk (begge bruker DrawingService deterministisk)",
  );
  console.log(`[EQUIV] Draws: ${old.drawSequence.length} (max 30)`);

  // ── 2. Identiske wallet-balanser ─────────────────────────────────────────
  assert.equal(
    old.finalBalances.size,
    nu.finalBalances.size,
    "balance map size",
  );
  for (const [playerId, oldBalance] of old.finalBalances) {
    const newBalance = nu.finalBalances.get(playerId);
    assert.equal(
      newBalance,
      oldBalance,
      `Wallet-balanse for ${playerId}: OLD=${oldBalance} NEW=${newBalance}`,
    );
  }
  console.log(
    `[EQUIV] Balances: ${[...old.finalBalances.entries()]
      .map(([p, b]) => `${p}=${b}kr`)
      .join(", ")}`,
  );

  // ── 3. Identisk antall compliance-events ─────────────────────────────────
  const oldEvents = old.compliance.getAllEvents();
  const newEvents = nu.compliance.getAllEvents();
  assert.equal(
    newEvents.length,
    oldEvents.length,
    `Compliance event-count: OLD=${oldEvents.length} NEW=${newEvents.length}`,
  );
  console.log(`[EQUIV] Compliance events: ${oldEvents.length}`);

  // ── 4. Identisk rekkefølge på compliance-events ──────────────────────────
  for (let i = 0; i < oldEvents.length; i++) {
    const o = oldEvents[i]!.event;
    const n = newEvents[i]!.event;
    assert.equal(
      n.eventType,
      o.eventType,
      `Event ${i}: type OLD=${o.eventType} NEW=${n.eventType}`,
    );
    assert.equal(
      n.amount,
      o.amount,
      `Event ${i} (${o.eventType}): amount OLD=${o.amount} NEW=${n.amount}`,
    );
    assert.equal(
      n.hallId,
      o.hallId,
      `Event ${i} (${o.eventType}): hallId OLD=${o.hallId} NEW=${n.hallId}`,
    );
    assert.equal(
      n.gameType,
      o.gameType,
      `Event ${i}: gameType OLD=${o.gameType} NEW=${n.gameType}`,
    );
    assert.equal(
      n.channel,
      o.channel,
      `Event ${i}: channel OLD=${o.channel} NEW=${n.channel}`,
    );
    assert.equal(
      n.gameId,
      o.gameId,
      `Event ${i}: gameId OLD=${o.gameId} NEW=${n.gameId}`,
    );
    assert.equal(
      n.playerId,
      o.playerId,
      `Event ${i}: playerId OLD=${o.playerId} NEW=${n.playerId}`,
    );
    assert.equal(
      n.walletId,
      o.walletId,
      `Event ${i}: walletId OLD=${o.walletId} NEW=${n.walletId}`,
    );
    assert.equal(
      n.claimId,
      o.claimId,
      `Event ${i}: claimId OLD=${o.claimId} NEW=${n.claimId}`,
    );
  }
  console.log(
    `[EQUIV] All ${oldEvents.length} compliance events match in order, type, amount, hallId, claimId`,
  );

  // ── 5. Identisk audit (game.payout.phase ekvivalent — orchestration.advance er additive) ─
  const oldPayoutPhase = old.audit.findByAction("game.payout.phase");
  const newPayoutPhase = nu.audit.findByAction("game.payout.phase");
  assert.equal(
    newPayoutPhase.length,
    oldPayoutPhase.length,
    `Antall game.payout.phase audit-events: OLD=${oldPayoutPhase.length} NEW=${newPayoutPhase.length}`,
  );
  console.log(
    `[EQUIV] game.payout.phase audit-events: ${oldPayoutPhase.length}`,
  );

  // NEW skal HA orchestration.advance audit-events (ekstra), OLD skal IKKE.
  const newOrch = nu.audit.findByAction("game.orchestration.advance");
  const oldOrch = old.audit.findByAction("game.orchestration.advance");
  assert.equal(
    oldOrch.length,
    0,
    "OLD-flow logger IKKE orchestration.advance",
  );
  assert.equal(
    newOrch.length,
    nu.drawSequence.length,
    `NEW-flow logger ÉN orchestration.advance per draw (${nu.drawSequence.length})`,
  );
  console.log(
    `[EQUIV] orchestration.advance: OLD=0 NEW=${newOrch.length} (additive)`,
  );

  // ── 6. Identisk audit-payload for game.payout.phase ──────────────────────
  for (let i = 0; i < oldPayoutPhase.length; i++) {
    const o = oldPayoutPhase[i]!;
    const n = newPayoutPhase[i]!;
    assert.equal(o.resourceId, n.resourceId, `payout.phase ${i}: resourceId`);
    const od = o.details as Record<string, unknown>;
    const nd = n.details as Record<string, unknown>;
    assert.equal(od.phaseId, nd.phaseId, `payout.phase ${i}: phaseId`);
    assert.equal(od.phaseName, nd.phaseName, `payout.phase ${i}: phaseName`);
    assert.equal(od.winnerCount, nd.winnerCount, `payout.phase ${i}: winnerCount`);
    assert.equal(
      od.totalPrizeCents,
      nd.totalPrizeCents,
      `payout.phase ${i}: totalPrizeCents`,
    );
    assert.equal(
      od.perWinnerCents,
      nd.perWinnerCents,
      `payout.phase ${i}: perWinnerCents`,
    );
    assert.equal(
      od.houseRetainedCents,
      nd.houseRetainedCents,
      `payout.phase ${i}: houseRetainedCents`,
    );
  }

  console.log(
    "[EQUIV] ✓ ALL EQUIVALENCE ASSERTIONS PASSED — OLD == NEW for 30-draw bingo round",
  );
});

// ── Sub-equivalence: empty-tickets edge case ────────────────────────────────

test("EQUIVALENCE: empty tickets — OLD og NEW ender begge uten payouts", async () => {
  const fixture: RoundFixture = {
    drawBag: Array.from({ length: 10 }, (_, i) => i + 1),
    maxDraws: 5,
    drawsToRun: 5,
    tickets: new Map(),
    hallByPlayer: new Map(),
    totalPrizeCents: 10_000,
    actorHallId: "hall-1",
    gameId: "game-empty",
    patterns: makeSpill1Patterns(),
  };

  const old = await runOldFlow(fixture);
  const nu = await runNewFlow(fixture);

  assert.deepEqual(old.drawSequence, nu.drawSequence);
  assert.equal(old.compliance.count(), nu.compliance.count());
  assert.equal(old.compliance.count(), 0, "Ingen vinnere → ingen events");
  assert.equal(
    old.audit.findByAction("game.payout.phase").length,
    nu.audit.findByAction("game.payout.phase").length,
  );
});

// ── Sub-equivalence: single-winner full-bingo race ──────────────────────────

test("EQUIVALENCE: single winner — full bingo i 24 draws", async () => {
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const fixture: RoundFixture = {
    drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
    maxDraws: 75,
    drawsToRun: 30,
    tickets: new Map([["alice", [aliceTicket]]]),
    hallByPlayer: new Map([["alice", "hall-A"]]),
    totalPrizeCents: 10_000,
    actorHallId: "hall-master",
    gameId: "game-solo",
    patterns: makeSpill1Patterns(),
  };

  const old = await runOldFlow(fixture);
  const nu = await runNewFlow(fixture);

  // Begge skal ende ved BINGO på draw 24 — ikke fortsette til 30.
  assert.equal(old.drawSequence.length, nu.drawSequence.length);
  assert.ok(
    old.drawSequence.length <= 24,
    `Begge skal ende senest ved 24 (BINGO på ball 24), faktisk ${old.drawSequence.length}`,
  );
  assert.equal(old.finalBalances.get("alice"), nu.finalBalances.get("alice"));
  assert.equal(
    old.finalBalances.get("alice"),
    300,
    "Alice vinner alle 3 phases → 100 + 100 + 100 = 300 kr",
  );
});

// ── Sub-equivalence: large prize with split rounding ───────────────────────

test("EQUIVALENCE: split-rounding edge case (1700 / 3) — sum HOUSE_RETAINED matcher", async () => {
  const fixture = makeRoundFixture(); // 3 vinnere, 1700 prize → 566/566/568 + rest 2 øre

  const old = await runOldFlow(fixture);
  const nu = await runNewFlow(fixture);

  const sumHouseRetained = (port: InMemoryCompliancePort) =>
    port
      .getAllEvents()
      .filter((e) => e.event.eventType === "HOUSE_RETAINED")
      .reduce((s, e) => s + e.event.amount, 0);

  assert.equal(
    sumHouseRetained(nu.compliance),
    sumHouseRetained(old.compliance),
    "HOUSE_RETAINED-sum må være lik mellom OLD og NEW",
  );
  // Sjekk at vi faktisk har minst én HOUSE_RETAINED-event (rounding rest).
  assert.ok(
    sumHouseRetained(old.compliance) > 0,
    "Test-fixture skal forsere HOUSE_RETAINED (1700/3 har rest 2 øre per phase)",
  );
});
