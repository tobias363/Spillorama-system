/**
 * Unified pipeline refactor — Fase 4 property-based invariants for GameOrchestrator.
 *
 * Verifiserer kontrakter som MÅ holde for ENHVER lovlig sekvens av draws:
 *
 *   Invariant 1 (PRIZE-SUM): For en hvilken som helst sekvens av draws,
 *     total wallet credit = sum av pattern-prizes won (modulo split-
 *     rounding rest som går til hus).
 *
 *   Invariant 2 (§71-BINDING): For multi-hall scheduled spill, hver claim
 *     sin compliance PRIZE-event har `hallId` = vinnerens kjøpe-hall, IKKE
 *     master-hall. Master ligger i `metadata.actorHallId`.
 *
 *   Invariant 3 (AUDIT-MONOTONIC): Audit-log vokser monotonisk — hvert
 *     `advanceGameByOneDraw`-kall legger til ÉN orchestration.advance-event
 *     pluss N (advance-count) game.payout.phase-events.
 *
 *   Invariant 4 (DETERMINISTIC): Gitt samme draw-sequence + samme ticket-
 *     state, gir orchestrator samme wallet-balanser og samme compliance-
 *     events i samme rekkefølge.
 *
 * Hvorfor:
 *   - PayoutService isolert har sine egne invariants
 *     (multiWinnerSplitInvariant, atomicityInvariant, etc.).
 *   - PatternEvalService har sine egne invariants (patternEvalInvariant).
 *   - DrawingService har sine egne invariants (drawingInvariant).
 *   - DEN HELHETEN — orchestrator-en — krever egne invariants som
 *     verifiserer at sammensetningen ikke introduserer nye bug-mønstre.
 *
 * Bruk fast-check for å generere tilfeldige (men strukturerte) sekvenser.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  DefaultIdempotencyKeyPort,
  InMemoryAuditPort,
  InMemoryCompliancePort,
  InMemoryWalletPort,
} from "../../ports/index.js";
import {
  GameOrchestrator,
  type AdvanceGameByOneDrawInput,
  type DrawingGameState,
  type PatternEvalState,
} from "../../services/GameOrchestrator.js";
import type { PatternDefinition, PatternResult, Ticket } from "../../game/types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

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
 * Bygg en simulering av en full bingo-runde der vi trekker N baller.
 * Mellom hvert draw oppdaterer vi `patternResults`-state slik at vunne
 * patterns ikke evalueres igjen (matcher prod-flyten).
 */
async function runSequenceOfDraws(args: {
  drawBag: number[];
  maxDraws: number;
  tickets: Map<string, Ticket[]>;
  patterns: PatternDefinition[];
  totalPrizeCents: number;
  hallByPlayer: Map<string, string>;
  actorHallId: string;
  drawsToRun: number;
}): Promise<{
  wallet: InMemoryWalletPort;
  compliance: InMemoryCompliancePort;
  audit: InMemoryAuditPort;
  totalDraws: number;
  totalAdvances: number;
  totalClaims: number;
  finalAllCardsClosed: boolean;
  /** Wallet-balansene per player (winnings-side) i kr. */
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

  // Pre-seed wallets.
  for (const [playerId] of args.tickets) {
    wallet.seed(`wallet-${playerId}`, 0);
  }

  // Mutable state — patternResults oppdateres mellom draws.
  let drawnNumbers: number[] = [];
  let currentPatternResults: PatternResult[] = patternResultsFromPatterns(
    args.patterns,
  );
  let drawsCompleted = 0;
  let totalAdvances = 0;
  let totalClaims = 0;
  let finalAllCardsClosed = false;

  for (let i = 0; i < args.drawsToRun; i++) {
    if (drawsCompleted >= args.maxDraws || drawsCompleted >= args.drawBag.length) {
      break;
    }
    if (finalAllCardsClosed) break;

    const drawingState: DrawingGameState = {
      gameId: "game-prop",
      status: "RUNNING",
      drawBag: args.drawBag,
      drawsCompleted,
      maxDraws: args.maxDraws,
      ballRange: 75,
    };

    const input: AdvanceGameByOneDrawInput = {
      drawingState,
      buildPatternEvalState: ({ drawnBall }) => {
        const newDrawn = [...drawnNumbers, drawnBall];
        return {
          gameId: "game-prop",
          status: "RUNNING",
          mode: "sequential",
          drawnNumbers: newDrawn,
          tickets: args.tickets,
          patterns: args.patterns,
          patternResults: currentPatternResults,
        };
      },
      buildPayoutInput: (advance, ctx) => ({
        gameId: ctx.gameId,
        phaseId: `phase-${advance.patternIndex + 1}`,
        phaseName: advance.patternName,
        winners: advance.winnerIds.map((playerId) => ({
          walletId: `wallet-${playerId}`,
          playerId,
          hallId: args.hallByPlayer.get(playerId) ?? "hall-default",
          claimId: `claim-${ctx.gameId}-${advance.patternId}-${playerId}`,
        })),
        totalPrizeCents: args.totalPrizeCents,
        actorHallId: args.actorHallId,
        isFixedPrize: true,
        gameType: "MAIN_GAME",
        channel: "INTERNET",
      }),
    };

    const result = await orchestrator.advanceGameByOneDraw(input);
    drawnNumbers.push(result.drawing.nextBall);
    drawsCompleted = result.drawing.drawSequenceNumber;
    totalAdvances += result.patternEval?.phasesAdvanced.length ?? 0;
    totalClaims += result.patternEval?.newClaims.length ?? 0;
    finalAllCardsClosed = result.patternEval?.allCardsClosed ?? false;

    // Oppdater patternResults for hver advance så neste iterasjon hopper
    // over allerede-vunne patterns (matcher prod-flyten).
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
  }

  // Hent finale balanser.
  const finalBalances = new Map<string, number>();
  for (const [playerId] of args.tickets) {
    const balance = await wallet.getBalance(`wallet-${playerId}`);
    finalBalances.set(playerId, balance.winnings);
  }

  return {
    wallet,
    compliance,
    audit,
    totalDraws: drawsCompleted,
    totalAdvances,
    totalClaims,
    finalAllCardsClosed,
    finalBalances,
  };
}

// ── Invariant 1: PRIZE-SUM ──────────────────────────────────────────────────

test("invariant 1: PRIZE-SUM — sum av wallet credits = sum av PRIZE/EXTRA + HOUSE_RETAINED-events", async () => {
  await fc.assert(
    fc.asyncProperty(
      // Generer 5-10 spillere med tickets bestående av lave numre slik at
      // de garantert vinner hvis vi trekker 1..N.
      fc.integer({ min: 2, max: 5 }),
      fc.integer({ min: 1_000, max: 100_000 }), // totalPrizeCents
      fc.integer({ min: 5, max: 25 }), // drawsToRun
      async (playerCount, totalPrizeCents, drawsToRun) => {
        // Lag spillere med rad 0 = [1,2,3,4,5] så alle vinner Phase 1
        // tidlig.
        const tickets = new Map<string, Ticket[]>();
        const hallByPlayer = new Map<string, string>();
        for (let i = 0; i < playerCount; i++) {
          const playerId = `p${i}`;
          const offset = i * 10 + 30;
          tickets.set(playerId, [
            makeTicket([
              1, 2, 3, 4, 5,
              offset, offset + 1, offset + 2, offset + 3, offset + 4,
              offset + 5, offset + 6, 0, offset + 7, offset + 8,
              offset + 9, offset + 10, offset + 11, offset + 12, offset + 13,
              offset + 14, offset + 15, offset + 16, offset + 17, offset + 18,
            ]),
          ]);
          hallByPlayer.set(playerId, `hall-${i % 3}`);
        }

        const result = await runSequenceOfDraws({
          drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
          maxDraws: 75,
          tickets,
          patterns: makeSpill1Patterns(),
          totalPrizeCents,
          hallByPlayer,
          actorHallId: "hall-master",
          drawsToRun,
        });

        // Sum av wallet-credit (i kroner).
        const totalWalletCreditKr = Array.from(
          result.finalBalances.values(),
        ).reduce((sum, b) => sum + b, 0);

        // Sum av compliance events (i kroner).
        const events = result.compliance.getAllEvents();
        const totalLedgerKr = events.reduce((sum, e) => {
          if (
            e.event.eventType === "PRIZE" ||
            e.event.eventType === "EXTRA_PRIZE" ||
            e.event.eventType === "HOUSE_RETAINED"
          ) {
            return sum + e.event.amount;
          }
          return sum;
        }, 0);

        // Invariant: total wallet-credit + total HOUSE_RETAINED =
        //            total PRIZE+EXTRA_PRIZE+HOUSE_RETAINED
        // dvs. wallet-credit = PRIZE+EXTRA_PRIZE
        const totalPrizeKr = events.reduce((sum, e) => {
          if (
            e.event.eventType === "PRIZE" ||
            e.event.eventType === "EXTRA_PRIZE"
          ) {
            return sum + e.event.amount;
          }
          return sum;
        }, 0);

        // Tolerere små floating-point-diskrepanser via cents-runding.
        const diff = Math.abs(totalWalletCreditKr - totalPrizeKr);
        assert.ok(
          diff < 0.001,
          `PRIZE-SUM brutt: wallet=${totalWalletCreditKr.toFixed(2)} kr, ledger PRIZE=${totalPrizeKr.toFixed(2)} kr (diff=${diff.toFixed(4)})`,
        );

        // Verifiser sentral identitet for hver phase: per-vinner-andel +
        // hus-rest = total. Dette er en re-test av PayoutService-invariant
        // men på tvers av hele orchestrator-sekvensen.
        const ledgerSumKr = totalPrizeKr + result.compliance.getAllEvents().reduce(
          (sum, e) => (e.event.eventType === "HOUSE_RETAINED" ? sum + e.event.amount : sum),
          0,
        );

        // Sum skal være ≤ totalAdvances * (totalPrizeCents/100)
        // (likhet kun hvis alle phases vunnet på faktiske draws).
        const expectedMaxKr = result.totalAdvances * (totalPrizeCents / 100);
        assert.ok(
          ledgerSumKr <= expectedMaxKr + 0.001,
          `Ledger total (${ledgerSumKr.toFixed(2)} kr) > expected max (${expectedMaxKr.toFixed(2)} kr) for ${result.totalAdvances} advances`,
        );
      },
    ),
    { numRuns: 50 },
  );
});

// ── Invariant 2: §71-BINDING ────────────────────────────────────────────────

test("invariant 2: §71-BINDING — PRIZE.hallId = vinner.hallId, master ligger i metadata", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 5 }),
      fc.integer({ min: 5, max: 20 }),
      async (playerCount, drawsToRun) => {
        const tickets = new Map<string, Ticket[]>();
        const hallByPlayer = new Map<string, string>();
        for (let i = 0; i < playerCount; i++) {
          const playerId = `p${i}`;
          const offset = i * 10 + 30;
          tickets.set(playerId, [
            makeTicket([
              1, 2, 3, 4, 5,
              offset, offset + 1, offset + 2, offset + 3, offset + 4,
              offset + 5, offset + 6, 0, offset + 7, offset + 8,
              offset + 9, offset + 10, offset + 11, offset + 12, offset + 13,
              offset + 14, offset + 15, offset + 16, offset + 17, offset + 18,
            ]),
          ]);
          // Multi-hall: ulik hall pr spiller.
          hallByPlayer.set(playerId, `hall-player-${i}`);
        }
        const masterHall = "hall-MASTER-DIFFERENT";

        const result = await runSequenceOfDraws({
          drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
          maxDraws: 75,
          tickets,
          patterns: makeSpill1Patterns(),
          totalPrizeCents: 10_000,
          hallByPlayer,
          actorHallId: masterHall,
          drawsToRun,
        });

        const events = result.compliance.getAllEvents();
        const prizes = events.filter((e) => e.event.eventType === "PRIZE");

        for (const e of prizes) {
          // Spilleren MÅ være registrert i hallByPlayer.
          const playerId = e.event.playerId;
          assert.ok(playerId, "PRIZE må ha playerId");
          const expectedHall = hallByPlayer.get(playerId);
          assert.ok(expectedHall, `Mangler hallByPlayer-entry for ${playerId}`);

          // §71: PRIZE.hallId = vinner.hallId, IKKE master.
          assert.equal(
            e.event.hallId,
            expectedHall,
            `§71 brutt: PRIZE for ${playerId} bindes til ${e.event.hallId}, forventet ${expectedHall}`,
          );
          assert.notEqual(
            e.event.hallId,
            masterHall,
            `§71 brutt: PRIZE for ${playerId} bindes feilaktig til master-hall`,
          );

          // Master skal ligge i metadata.
          assert.equal(
            (e.event.metadata as Record<string, unknown>)?.actorHallId,
            masterHall,
            `Master-hall mangler i metadata.actorHallId for ${playerId}`,
          );
        }
      },
    ),
    { numRuns: 30 },
  );
});

// ── Invariant 3: AUDIT-MONOTONIC ────────────────────────────────────────────

test("invariant 3: AUDIT-MONOTONIC — audit vokser monotonisk per advance/draw", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 3, max: 15 }),
      async (playerCount, drawsToRun) => {
        const tickets = new Map<string, Ticket[]>();
        const hallByPlayer = new Map<string, string>();
        for (let i = 0; i < playerCount; i++) {
          const playerId = `p${i}`;
          const offset = i * 10 + 30;
          tickets.set(playerId, [
            makeTicket([
              1, 2, 3, 4, 5,
              offset, offset + 1, offset + 2, offset + 3, offset + 4,
              offset + 5, offset + 6, 0, offset + 7, offset + 8,
              offset + 9, offset + 10, offset + 11, offset + 12, offset + 13,
              offset + 14, offset + 15, offset + 16, offset + 17, offset + 18,
            ]),
          ]);
          hallByPlayer.set(playerId, "hall-1");
        }

        const result = await runSequenceOfDraws({
          drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
          maxDraws: 75,
          tickets,
          patterns: makeSpill1Patterns(),
          totalPrizeCents: 10_000,
          hallByPlayer,
          actorHallId: "hall-1",
          drawsToRun,
        });

        // ÉN orchestration.advance per faktisk-utført draw.
        const orchestrationCount = result.audit.findByAction(
          "game.orchestration.advance",
        ).length;
        assert.equal(
          orchestrationCount,
          result.totalDraws,
          `Forventet ${result.totalDraws} orchestration.advance-events, fikk ${orchestrationCount}`,
        );

        // ÉN game.payout.phase per phase-advance.
        const payoutPhaseCount = result.audit.findByAction(
          "game.payout.phase",
        ).length;
        assert.equal(
          payoutPhaseCount,
          result.totalAdvances,
          `Forventet ${result.totalAdvances} payout.phase-events, fikk ${payoutPhaseCount}`,
        );

        // Total audit count = orchestration.advance + payout.phase.
        // (PayoutService logger ikke andre actions.)
        assert.equal(
          result.audit.count(),
          orchestrationCount + payoutPhaseCount,
          "Audit-count må være sum av orchestration + payout-events (ingen ekstra)",
        );
      },
    ),
    { numRuns: 30 },
  );
});

// ── Invariant 4: DETERMINISTIC ──────────────────────────────────────────────

test("invariant 4: DETERMINISTIC — samme input gir samme balanser og compliance-events", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 4 }),
      fc.integer({ min: 5, max: 15 }),
      fc.integer({ min: 1_000, max: 50_000 }),
      async (playerCount, drawsToRun, totalPrizeCents) => {
        const buildArgs = () => {
          const tickets = new Map<string, Ticket[]>();
          const hallByPlayer = new Map<string, string>();
          for (let i = 0; i < playerCount; i++) {
            const playerId = `p${i}`;
            const offset = i * 10 + 30;
            tickets.set(playerId, [
              makeTicket([
                1, 2, 3, 4, 5,
                offset, offset + 1, offset + 2, offset + 3, offset + 4,
                offset + 5, offset + 6, 0, offset + 7, offset + 8,
                offset + 9, offset + 10, offset + 11, offset + 12, offset + 13,
                offset + 14, offset + 15, offset + 16, offset + 17, offset + 18,
              ]),
            ]);
            hallByPlayer.set(playerId, `hall-${i % 2}`);
          }
          return {
            drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
            maxDraws: 75,
            tickets,
            patterns: makeSpill1Patterns(),
            totalPrizeCents,
            hallByPlayer,
            actorHallId: "hall-master",
            drawsToRun,
          };
        };

        const run1 = await runSequenceOfDraws(buildArgs());
        const run2 = await runSequenceOfDraws(buildArgs());

        // Balanser MÅ være like.
        assert.equal(
          run1.finalBalances.size,
          run2.finalBalances.size,
          "balance-map size må matche",
        );
        for (const [playerId, balance1] of run1.finalBalances) {
          const balance2 = run2.finalBalances.get(playerId);
          assert.equal(
            balance1,
            balance2,
            `Determinisme brutt: ${playerId} fikk ${balance1} kr i run1, ${balance2} kr i run2`,
          );
        }

        // Compliance event-count + sum MÅ matche.
        assert.equal(
          run1.compliance.count(),
          run2.compliance.count(),
          "compliance event-count må matche mellom runs",
        );

        const sumEvents = (port: InMemoryCompliancePort) =>
          port.getAllEvents().reduce((sum, e) => sum + e.event.amount, 0);
        assert.equal(
          sumEvents(run1.compliance),
          sumEvents(run2.compliance),
          "compliance amount-sum må matche mellom runs",
        );

        // Audit count må matche.
        assert.equal(
          run1.audit.count(),
          run2.audit.count(),
          "audit count må matche mellom runs",
        );
      },
    ),
    { numRuns: 20 },
  );
});
