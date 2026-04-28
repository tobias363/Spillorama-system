/**
 * Unified pipeline refactor — Fase 3 integration test for PatternEvalService.
 *
 * Demonstrerer wire-up-mønsteret som `Game1DrawEngineService.evaluatePhase`
 * og `BingoEnginePatternEval.evaluateActivePhase` vil bruke i Fase 4
 * (GameOrchestrator).
 *
 * Verifiserer:
 *   - PatternEvalService kan kjøre mot et realistisk in-memory game-snapshot
 *     bygget fra `BingoEngine`-style tickets + drawnNumbers + patternResults.
 *   - Sequential mode ↔ recursive phase progression matcher prod-flyten i
 *     `BingoEnginePatternEval.evaluateActivePhase`.
 *   - Multi-runde-flyt: caller tar resultat, oppdaterer patternResults,
 *     re-evaluerer.
 *   - Per-color matrix-bruk speilkopierer prod-flyten.
 *
 * Hvorfor:
 *   Når Fase 4 lander GameOrchestrator må vi være sikre på at sammensetningen
 *   `(state.draw + state.patternResults) → PatternEvalState → PatternEvalResult`
 *   ikke forandrer semantikken for prod-koden. Denne testen er lakmus-papiret.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  FLAT_GROUP_KEY,
  PatternEvalService,
  type PatternEvalState,
  type PerColorMatrix,
} from "./PatternEvalService.js";
import type {
  PatternDefinition,
  PatternResult,
  Ticket,
} from "../game/types.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeTicket(grid25: number[], color?: string): Ticket {
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    grid.push(grid25.slice(r * 5, (r + 1) * 5));
  }
  const ticket: Ticket = { grid };
  if (color !== undefined) ticket.color = color;
  return ticket;
}

function makeSpill1Patterns(): PatternDefinition[] {
  return [
    { id: "p1", name: "1 Rad", claimType: "LINE", prizePercent: 25, order: 1, design: 1 },
    { id: "p2", name: "2 Rader", claimType: "LINE", prizePercent: 35, order: 2, design: 2 },
    { id: "p3", name: "Fullt Hus", claimType: "BINGO", prizePercent: 40, order: 3, design: 3 },
  ];
}

function applyAdvancesToResults(
  results: readonly PatternResult[],
  result: ReturnType<PatternEvalService["evaluateAfterDraw"]>,
): PatternResult[] {
  return results.map((r) => {
    const advance = result.phasesAdvanced.find((a) => a.patternId === r.patternId);
    if (!advance) return r;
    return {
      ...r,
      isWon: true,
      winnerIds: [...advance.winnerIds],
      winnerCount: advance.winnerIds.length,
    };
  });
}

// ── Integration: full Spill 1 round end-to-end ─────────────────────────────

test("Integration: Spill 1 — full runde fra phase 1 → phase 2 → BINGO via flere draws", () => {
  // Simuler realistisk Spill 1-runde: 3 spillere, hver med ÉN ticket.
  // Vi simulerer 3 sekvensielle "draws" der drawn-set vokser, og
  // sjekker at PatternEvalService rapporterer riktig per draw.
  const service = new PatternEvalService();

  // Alice: full house ved drawn=1-24.
  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  // Bob: kun rad 0 ved drawn=1-5; ingen flere rader ved drawn=1-24.
  const bobTicket = makeTicket([
    1, 2, 3, 4, 5,
    25, 26, 27, 28, 29,
    30, 31, 0, 32, 33,
    34, 35, 36, 37, 38,
    39, 40, 41, 42, 43,
  ]);
  // Carol: ingen wins.
  const carolTicket = makeTicket([
    51, 52, 53, 54, 55,
    56, 57, 58, 59, 60,
    61, 62, 0, 63, 64,
    65, 66, 67, 68, 69,
    70, 71, 72, 73, 74,
  ]);
  const tickets = new Map<string, Ticket[]>([
    ["alice", [aliceTicket]],
    ["bob", [bobTicket]],
    ["carol", [carolTicket]],
  ]);

  const patterns = makeSpill1Patterns();
  let patternResults: PatternResult[] = patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));

  // ── Draw 1: drawn = 1..5 → Phase 1 vinnes av alice + bob ────────────────
  const state1: PatternEvalState = {
    gameId: "integration-spill1",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
    patterns,
    patternResults,
  };
  const result1 = service.evaluateAfterDraw(state1);
  assert.equal(result1.phasesAdvanced.length, 1, "draw 1 → bare phase 1");
  assert.equal(result1.phasesAdvanced[0]!.patternId, "p1");
  assert.deepEqual([...result1.phasesAdvanced[0]!.winnerIds], ["alice", "bob"]);
  assert.equal(result1.allCardsClosed, false);

  // Caller-side: oppdater patternResults med vinnerne.
  patternResults = applyAdvancesToResults(patternResults, result1);
  assert.equal(patternResults[0]!.isWon, true);
  assert.equal(patternResults[1]!.isWon, false);
  assert.equal(patternResults[2]!.isWon, false);

  // ── Draw 2: drawn = 1..10 → Phase 2 vinnes av alice (bob har ikke 2 rader) ─
  const state2: PatternEvalState = {
    gameId: "integration-spill1",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: Array.from({ length: 10 }, (_, i) => i + 1),
    tickets,
    patterns,
    patternResults,
  };
  const result2 = service.evaluateAfterDraw(state2);
  assert.equal(result2.phasesAdvanced.length, 1);
  assert.equal(result2.phasesAdvanced[0]!.patternId, "p2");
  assert.deepEqual([...result2.phasesAdvanced[0]!.winnerIds], ["alice"]);
  assert.equal(result2.allCardsClosed, false);

  patternResults = applyAdvancesToResults(patternResults, result2);

  // ── Draw 3: drawn = 1..24 → Fullt Hus vinnes av alice ───────────────────
  const state3: PatternEvalState = {
    gameId: "integration-spill1",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: Array.from({ length: 24 }, (_, i) => i + 1),
    tickets,
    patterns,
    patternResults,
  };
  const result3 = service.evaluateAfterDraw(state3);
  assert.equal(result3.phasesAdvanced.length, 1);
  assert.equal(result3.phasesAdvanced[0]!.patternId, "p3");
  assert.deepEqual([...result3.phasesAdvanced[0]!.winnerIds], ["alice"]);
  assert.equal(result3.allCardsClosed, true, "BINGO vunnet → spill ferdig");
});

test("Integration: Spill 1 — recursive phase progression i én draw (fast-forward)", () => {
  // Kobles tett til evaluateActivePhase rekursjons-mønster: hvis caller
  // mister flere draws (e.g. crash recovery), kan en evaluation advance
  // FLERE faser i samme kall.
  const service = new PatternEvalService();
  const ticket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);

  const patterns = makeSpill1Patterns();
  const state: PatternEvalState = {
    gameId: "integration-fastforward",
    status: "RUNNING",
    mode: "sequential",
    // Hopp direkte til drawn=1-24 (full house er allerede oppfylt).
    drawnNumbers: Array.from({ length: 24 }, (_, i) => i + 1),
    tickets: new Map([["alice", [ticket]]]),
    patterns,
    patternResults: patterns.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: false,
    })),
  };

  const result = service.evaluateAfterDraw(state);

  // Forventet: alle 3 faser advanced (recursion).
  assert.equal(result.phasesAdvanced.length, 3, "recursive: alle faser i én eval");
  assert.equal(result.phasesAdvanced[0]!.patternId, "p1");
  assert.equal(result.phasesAdvanced[1]!.patternId, "p2");
  assert.equal(result.phasesAdvanced[2]!.patternId, "p3");
  assert.equal(result.allCardsClosed, true);

  // Total claims = 3 (alice vinner alle 3 phases).
  assert.equal(result.newClaims.length, 3);
  for (const claim of result.newClaims) {
    assert.equal(claim.playerId, "alice");
  }
});

test("Integration: per-color matrix — Yellow-spillere og Purple-spillere får per-farge claims", () => {
  const service = new PatternEvalService();

  // Alice har Yellow ticket. Bob har Purple ticket. Begge oppfyller phase 1
  // ved drawn=1-5.
  const yellowTicket = makeTicket([
    1, 2, 3, 4, 5,
    16, 17, 18, 19, 20,
    31, 32, 0, 33, 34,
    46, 47, 48, 49, 50,
    61, 62, 63, 64, 65,
  ], "Yellow");
  const purpleTicket = makeTicket([
    1, 2, 3, 4, 5,
    26, 27, 28, 29, 30,
    36, 37, 0, 38, 39,
    51, 52, 53, 54, 55,
    66, 67, 68, 69, 70,
  ], "Purple");

  const patterns = makeSpill1Patterns();
  // Per-color matrise med ulike prize1 per color.
  const yellowVariant = patterns.map((p) => ({ ...p, name: `${p.name} Y`, prize1: 100 }));
  const purpleVariant = patterns.map((p) => ({ ...p, name: `${p.name} P`, prize1: 200 }));
  const matrix: PerColorMatrix = {
    patternsByColor: new Map([
      ["Yellow", yellowVariant],
      ["Purple", purpleVariant],
    ]),
  };

  const state: PatternEvalState = {
    gameId: "integration-percolor",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets: new Map([["alice", [yellowTicket]], ["bob", [purpleTicket]]]),
    patterns,
    patternResults: patterns.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: false,
    })),
    perColorMatrix: matrix,
  };

  const result = service.evaluateAfterDraw(state);

  // Phase 1 advanced med 2 unique winners (alice, bob) i 2 grupper.
  assert.equal(result.phasesAdvanced.length, 1);
  const advance = result.phasesAdvanced[0]!;
  assert.deepEqual([...advance.winnerIds], ["alice", "bob"]);
  assert.equal(advance.winnerGroups.size, 2);

  // Verifiser per-color resolved patterns.
  const yellowGroup = advance.winnerGroups.get("Yellow")!;
  const purpleGroup = advance.winnerGroups.get("Purple")!;
  assert.equal(yellowGroup.resolvedPattern.prize1, 100);
  assert.equal(purpleGroup.resolvedPattern.prize1, 200);

  // Caller bruker resolvedPattern til prize-resolution via PayoutService:
  // for hver group: payout(totalPrize=resolvedPattern.prize1, winners=group.winnerIds, ...)
  // Dette mønstret er hva GameOrchestrator (Fase 4) vil implementere.
});

test("Integration: TV Extra (concurrent mode) — multiple custom patterns vinnes parallelt", () => {
  const service = new PatternEvalService();

  // 3 custom patterns med ulike masks — alle kan vinnes uavhengig.
  const patterns: PatternDefinition[] = [
    {
      id: "row0",
      name: "Top Row",
      claimType: "LINE",
      prizePercent: 25,
      order: 1,
      design: 0,
      mask: 0x1F, // bits 0-4
    },
    {
      id: "col0",
      name: "Left Column",
      claimType: "LINE",
      prizePercent: 25,
      order: 2,
      design: 0,
      mask: 0x108421, // col 0 (bits 0,5,10,15,20)
    },
    {
      id: "diag",
      name: "Main Diagonal",
      claimType: "BINGO",
      prizePercent: 50,
      order: 3,
      design: 0,
      // diagonal: bits 0, 6, 12, 18, 24
      mask: (1 << 0) | (1 << 6) | (1 << 12) | (1 << 18) | (1 << 24),
    },
  ];

  // Alice har en ticket der både row 0 OG col 0 er dekket av drawn=1-25
  // (alle numre i de relevante celler).
  const ticket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const state: PatternEvalState = {
    gameId: "integration-concurrent",
    status: "RUNNING",
    mode: "concurrent",
    drawnNumbers: Array.from({ length: 24 }, (_, i) => i + 1),
    tickets: new Map([["alice", [ticket]]]),
    patterns,
    patternResults: patterns.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: false,
    })),
  };

  const result = service.evaluateAfterDraw(state);

  // Forventet: alle 3 custom patterns vinnes parallelt av alice.
  assert.equal(result.phasesAdvanced.length, 3);
  for (const advance of result.phasesAdvanced) {
    assert.deepEqual([...advance.winnerIds], ["alice"]);
  }
  // Alle patterns vunnet → allCardsClosed.
  assert.equal(result.allCardsClosed, true);
});

test("Integration: simulert GameOrchestrator-loop — DrawingService + PatternEvalService", () => {
  // Demonstrerer hvordan Fase 4 GameOrchestrator vil koble Fase 2 +
  // Fase 3 sammen. Dette er IKKE en wire-up av faktisk DrawingService
  // (vi simulerer den), men viser data-flyten.
  const service = new PatternEvalService();

  const aliceTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const tickets = new Map<string, Ticket[]>([["alice", [aliceTicket]]]);
  const patterns = makeSpill1Patterns();
  let patternResults: PatternResult[] = patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));

  // Pre-shuffled bag (matcher det DrawingService ville returnert per draw).
  const drawBag = Array.from({ length: 75 }, (_, i) => i + 1);
  const drawnSoFar: number[] = [];

  // Total faser advancert gjennom hele runden.
  const allAdvances: ReturnType<typeof service.evaluateAfterDraw>["phasesAdvanced"][number][] = [];

  // Loop: trekk én ball om gangen, evaluér etter hver.
  for (let i = 0; i < 24; i++) {
    drawnSoFar.push(drawBag[i]!);

    const state: PatternEvalState = {
      gameId: "orchestrator-loop",
      status: "RUNNING",
      mode: "sequential",
      drawnNumbers: drawnSoFar,
      tickets,
      patterns,
      patternResults,
    };
    const result = service.evaluateAfterDraw(state);

    // Aggregér advances.
    for (const adv of result.phasesAdvanced) {
      allAdvances.push(adv);
    }

    // Caller-side: oppdater patternResults før neste loop.
    patternResults = applyAdvancesToResults(patternResults, result);

    if (result.allCardsClosed) {
      break;
    }
  }

  // Etter loop: alle 3 phases skal være advancert (én eller flere ganger
  // blant draws — typisk én gang siden recursion-typisk hopper). Nøyaktig
  // antall avhenger av når patterns vinnes.
  const advancedPatternIds = new Set(allAdvances.map((a) => a.patternId));
  assert.ok(advancedPatternIds.has("p1"), "p1 må være advancert");
  assert.ok(advancedPatternIds.has("p2"), "p2 må være advancert");
  assert.ok(advancedPatternIds.has("p3"), "p3 må være advancert");

  // patternResults skal vise alle som vunnet etter loop.
  assert.ok(patternResults.every((r) => r.isWon));
});

test("Integration: caller-side prize-resolution-mønster", () => {
  // Demonstrerer hvordan caller bruker PatternEvalService-resultatet sammen
  // med PayoutService (Fase 1). Vi simulerer prize-resolution her — i prod
  // vil GameOrchestrator gjøre dette via PayoutService.payoutPhase(...).
  const service = new PatternEvalService();

  const ticket1 = makeTicket([
    1, 2, 3, 4, 5,
    16, 17, 18, 19, 20,
    31, 32, 0, 33, 34,
    46, 47, 48, 49, 50,
    61, 62, 63, 64, 65,
  ]);
  const ticket2 = makeTicket([
    1, 2, 3, 4, 5,
    26, 27, 28, 29, 30,
    36, 37, 0, 38, 39,
    51, 52, 53, 54, 55,
    66, 67, 68, 69, 70,
  ]);

  const patterns: PatternDefinition[] = [
    {
      id: "p1",
      name: "1 Rad",
      claimType: "LINE",
      prizePercent: 0,
      order: 1,
      design: 1,
      winningType: "fixed",
      prize1: 1000, // 1000 kr fast premie
    },
  ];

  const state: PatternEvalState = {
    gameId: "integration-prize",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets: new Map([["alice", [ticket1]], ["bob", [ticket2]]]),
    patterns,
    patternResults: [
      { patternId: "p1", patternName: "1 Rad", claimType: "LINE", isWon: false },
    ],
  };
  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1);
  const advance = result.phasesAdvanced[0]!;

  // Caller-side: bruk advance.winnerGroups.get(FLAT_GROUP_KEY)!.resolvedPattern
  // til prize-resolution. (PayoutService.payoutPhase tar prize i øre.)
  const flatGroup = advance.winnerGroups.get(FLAT_GROUP_KEY)!;
  const totalPrizeNok = flatGroup.resolvedPattern.prize1!; // 1000
  const totalPrizeCents = totalPrizeNok * 100; // 100_000

  // Forventet PayoutService-call (ikke utført her):
  //   payoutService.payoutPhase({
  //     gameId: state.gameId,
  //     phaseId: advance.patternId,
  //     phaseName: advance.patternName,
  //     winners: advance.winnerIds.map(playerId => ({
  //       walletId, playerId, hallId, claimId
  //     })),
  //     totalPrizeCents: 100_000,
  //     ...
  //   });
  assert.equal(totalPrizeCents, 100_000);
  assert.equal(advance.winnerIds.length, 2);
});
