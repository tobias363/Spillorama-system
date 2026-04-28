/**
 * Unified pipeline refactor — Fase 3 unit tests for PatternEvalService.
 *
 * Verifiserer happy path, multi-winner-grupper, recursive phase progression,
 * concurrent mode, error-grener, og at service-en er pure (ingen mutering
 * av input-state).
 *
 * Property-based invariants ligger i:
 *   `apps/backend/src/__tests__/invariants/patternEvalInvariant.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  FLAT_GROUP_KEY,
  PatternEvalError,
  PatternEvalService,
  meetsPhaseRequirement,
  sortWinnerIdsDeterministic,
  type PatternEvalState,
  type PerColorMatrix,
} from "./PatternEvalService.js";
import type {
  PatternDefinition,
  PatternResult,
  Ticket,
} from "../game/types.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

/**
 * 5×5 ticket-fabrikk. Sentercelle = 0 (free space). Caller passerer
 * 25 numre (row-major), `0` for sentercelle posisjon (row 2, col 2).
 *
 * Eksempel:
 *   makeTicket([
 *      1,  2,  3,  4,  5,
 *     16, 17, 18, 19, 20,
 *     31, 32,  0, 33, 34,  // 0 = free centre
 *     46, 47, 48, 49, 50,
 *     61, 62, 63, 64, 65,
 *   ])
 */
function makeTicket(grid25: number[], color?: string, id?: string): Ticket {
  if (grid25.length !== 25) {
    throw new Error(`Ticket må ha 25 celler, fikk ${grid25.length}`);
  }
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    grid.push(grid25.slice(r * 5, (r + 1) * 5));
  }
  const ticket: Ticket = { grid };
  if (color !== undefined) ticket.color = color;
  if (id !== undefined) ticket.id = id;
  return ticket;
}

/**
 * Ticket der hele rad 0 er numrene 1-5 (lett å trigge fase 1 ved å trekke
 * 1-5). Resten av brettet er numre som ikke kolliderer.
 */
function ticketWithRow0(): Ticket {
  return makeTicket([
    1, 2, 3, 4, 5, // row 0 → vinner Phase 1 ved drawn={1,2,3,4,5}
    16, 17, 18, 19, 20,
    31, 32, 0, 33, 34, // free center
    46, 47, 48, 49, 50,
    61, 62, 63, 64, 65,
  ]);
}

/**
 * Ticket med 2 hele rader (0 og 1) ved drawn={1..10}. Trekker dvs. fase 1
 * (én rad) og fase 2 (to rader) på SAMME draw — testet i recursive
 * phase progression.
 */
function ticketWithRows01(): Ticket {
  return makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14, // free center
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
}

/**
 * Standard pattern-config matchende Spill 1: 1 Rad → 2 Rader → Fullt Hus.
 */
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

function makeUnwonResults(patterns: PatternDefinition[]): PatternResult[] {
  return patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));
}

function makeState(overrides: Partial<PatternEvalState> = {}): PatternEvalState {
  const patterns = overrides.patterns ?? makeSpill1Patterns();
  // patterns kan komme inn som readonly fra overrides; copy for makeUnwonResults
  // som forventer mutable array.
  const patternsArr: PatternDefinition[] = [...patterns];
  return {
    gameId: "game-1",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: [],
    tickets: new Map(),
    patterns,
    patternResults: makeUnwonResults(patternsArr),
    ...overrides,
  };
}

// ── Happy path: single winner, single phase ─────────────────────────────────

test("PatternEvalService: happy path — én spiller vinner Phase 1 ved 1 rad komplett", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRow0()]],
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5], // dekker hele rad 0
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1, "én fase advanced");
  assert.equal(result.phasesAdvanced[0]!.patternId, "p1");
  assert.equal(result.phasesAdvanced[0]!.patternName, "1 Rad");
  assert.equal(result.phasesAdvanced[0]!.claimType, "LINE");
  assert.equal(result.phasesAdvanced[0]!.patternIndex, 0);
  assert.deepEqual(result.phasesAdvanced[0]!.winnerIds, ["alice"]);

  assert.equal(result.newClaims.length, 1, "én claim");
  assert.equal(result.newClaims[0]!.playerId, "alice");
  assert.equal(result.newClaims[0]!.patternId, "p1");
  assert.equal(result.newClaims[0]!.colorGroupKey, FLAT_GROUP_KEY);

  assert.equal(result.allCardsClosed, false, "kun phase 1 → ikke ferdig");
});

test("PatternEvalService: ingen vinner → tomme claims, allCardsClosed=false", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRow0()]],
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3], // mangler 4 og 5 → ingen full rad
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 0);
  assert.equal(result.newClaims.length, 0);
  assert.equal(result.allCardsClosed, false);
});

// ── Multi-winner: same draw triggers 2+ tickets to claim same pattern ──────

test("PatternEvalService: multi-winner — 3 spillere vinner Phase 1 samtidig", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRow0()]],
    ["bob", [ticketWithRow0()]],
    ["carol", [ticketWithRow0()]],
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1);
  // Vinnere sortert lex-orden (alice, bob, carol).
  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice", "bob", "carol"]);
  assert.equal(result.newClaims.length, 3, "én claim per vinner");
  // Alle har samme pattern + colorGroupKey (flat-path).
  for (const claim of result.newClaims) {
    assert.equal(claim.patternId, "p1");
    assert.equal(claim.colorGroupKey, FLAT_GROUP_KEY);
  }
  // Claims er sortert lex på playerId.
  assert.deepEqual(result.newClaims.map((c) => c.playerId), ["alice", "bob", "carol"]);
});

test("PatternEvalService: multi-winner — vinnere sortert deterministisk uavhengig av insertion-order", () => {
  const service = new PatternEvalService();
  // Insertion-order: zebra, alice, mike. Forventet output: alice, mike, zebra.
  const tickets = new Map<string, Ticket[]>([
    ["zebra", [ticketWithRow0()]],
    ["alice", [ticketWithRow0()]],
    ["mike", [ticketWithRow0()]],
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice", "mike", "zebra"]);
});

// ── Phase progression: sequential single advance ───────────────────────────

test("PatternEvalService: phase progression — Phase 1 vunnet i runde 1, Phase 2 i runde 2", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRows01()]], // har rader 0+1
  ]);

  // Runde 1: drawn = rad 0 → Phase 1 vinnes.
  const state1 = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
  });
  const result1 = service.evaluateAfterDraw(state1);
  assert.equal(result1.phasesAdvanced.length, 1);
  assert.equal(result1.phasesAdvanced[0]!.patternId, "p1");

  // Runde 2: simuler at caller har markert p1 vunnet, drawn nå dekker rader 0+1.
  const updatedResults = state1.patternResults.map((r) =>
    r.patternId === "p1" ? { ...r, isWon: true, winnerIds: ["alice"] } : r,
  );
  const state2 = makeState({
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    tickets,
    patternResults: updatedResults,
  });
  const result2 = service.evaluateAfterDraw(state2);
  assert.equal(result2.phasesAdvanced.length, 1);
  assert.equal(result2.phasesAdvanced[0]!.patternId, "p2");
  assert.equal(result2.phasesAdvanced[0]!.patternName, "2 Rader");
});

// ── CRITICAL: Recursive phase progression — same draw wins multiple phases ─

test("PatternEvalService: RECURSIVE — samme draw oppfyller Phase 1 + Phase 2 samtidig", () => {
  // Edge-case: én spiller har 2 rader i én ticket. Ved samme draw oppfylles
  // BÅDE phase 1 (≥1 rad) OG phase 2 (≥2 rader). Service skal advance
  // begge fasene i samme kall.
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRows01()]], // har komplette rader 0 + 1
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // dekker rader 0 og 1
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  // Forventet: 2 phases advanced — p1 OG p2.
  assert.equal(result.phasesAdvanced.length, 2, "begge fasene advanced i samme draw");
  assert.equal(result.phasesAdvanced[0]!.patternId, "p1");
  assert.equal(result.phasesAdvanced[1]!.patternId, "p2");

  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice"]);
  assert.deepEqual([...result.phasesAdvanced[1]!.winnerIds], ["alice"]);

  // Forventet: 2 claims (én per phase).
  assert.equal(result.newClaims.length, 2);
  assert.equal(result.newClaims[0]!.patternId, "p1");
  assert.equal(result.newClaims[1]!.patternId, "p2");

  // p3 (Fullt Hus) skal IKKE være vunnet — drawn dekker bare rader 0+1.
  assert.equal(result.allCardsClosed, false);
});

test("PatternEvalService: RECURSIVE — Phase 1 vunnet, Phase 2 IKKE samme draw → kun 1 advance", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRow0()]], // har bare 1 hel rad (rad 0)
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5], // bare rad 0 dekket
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  // Forventet: kun 1 phase advanced — p1.
  assert.equal(result.phasesAdvanced.length, 1);
  assert.equal(result.phasesAdvanced[0]!.patternId, "p1");
  assert.equal(result.allCardsClosed, false);
});

// ── Boundary: last pattern in last phase → game complete ───────────────────

test("PatternEvalService: boundary — Fullt Hus vunnet → allCardsClosed=true", () => {
  // Ticket med alle 24 numre + free centre, drawn dekker alt.
  const service = new PatternEvalService();
  const fullHouseTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const tickets = new Map<string, Ticket[]>([["alice", [fullHouseTicket]]]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  // Forventet: alle 3 faser advanced (p1, p2, p3) — recursive progression.
  assert.equal(result.phasesAdvanced.length, 3);
  assert.equal(result.phasesAdvanced[0]!.patternId, "p1");
  assert.equal(result.phasesAdvanced[1]!.patternId, "p2");
  assert.equal(result.phasesAdvanced[2]!.patternId, "p3");
  assert.equal(result.phasesAdvanced[2]!.claimType, "BINGO");

  // Forventet: spillet er ferdig.
  assert.equal(result.allCardsClosed, true, "BINGO vunnet → allCardsClosed");
});

test("PatternEvalService: BINGO mid-game — Phase 1+2 vunnet tidligere, Fullt Hus i denne draw", () => {
  const service = new PatternEvalService();
  const fullHouseTicket = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  const tickets = new Map<string, Ticket[]>([["alice", [fullHouseTicket]]]);
  const patterns = makeSpill1Patterns();
  // Simuler at p1 og p2 allerede vunnet.
  const patternResults: PatternResult[] = [
    { patternId: "p1", patternName: "1 Rad", claimType: "LINE", isWon: true, winnerIds: ["alice"] },
    { patternId: "p2", patternName: "2 Rader", claimType: "LINE", isWon: true, winnerIds: ["alice"] },
    { patternId: "p3", patternName: "Fullt Hus", claimType: "BINGO", isWon: false },
  ];
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    tickets,
    patterns,
    patternResults,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1);
  assert.equal(result.phasesAdvanced[0]!.patternId, "p3");
  assert.equal(result.allCardsClosed, true);
});

// ── Concurrent mode ─────────────────────────────────────────────────────────

test("PatternEvalService: concurrent — flere patterns evalueres parallelt", () => {
  const service = new PatternEvalService();

  // Custom patterns med eksplisitte 25-bit masker.
  // mask 0x1F = bits 0-4 = rad 0. mask 0x3E0 = bits 5-9 = rad 1.
  const patterns: PatternDefinition[] = [
    {
      id: "row0",
      name: "Custom Row 0",
      claimType: "LINE",
      prizePercent: 30,
      order: 1,
      design: 0,
      mask: 0x1F, // rad 0
    },
    {
      id: "row1",
      name: "Custom Row 1",
      claimType: "LINE",
      prizePercent: 30,
      order: 2,
      design: 0,
      mask: 0x3E0, // rad 1
    },
  ];

  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRows01()]], // har rader 0+1
    ["bob", [ticketWithRow0()]], // har bare rad 0
  ]);
  const state = makeState({
    mode: "concurrent",
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    tickets,
    patterns,
    patternResults: makeUnwonResults(patterns),
  });

  const result = service.evaluateAfterDraw(state);

  // Begge patterns evalueres. row0 vinnes av begge (alice, bob). row1 vinnes
  // kun av alice (bob har ikke rad 1).
  assert.equal(result.phasesAdvanced.length, 2);
  const row0Phase = result.phasesAdvanced.find((p) => p.patternId === "row0");
  const row1Phase = result.phasesAdvanced.find((p) => p.patternId === "row1");
  assert.deepEqual([...row0Phase!.winnerIds], ["alice", "bob"]);
  assert.deepEqual([...row1Phase!.winnerIds], ["alice"]);

  // Begge patterns vunnet → allCardsClosed.
  assert.equal(result.allCardsClosed, true);
});

test("PatternEvalService: concurrent — kun delvis vunnet → allCardsClosed=false", () => {
  const service = new PatternEvalService();
  const patterns: PatternDefinition[] = [
    {
      id: "row0",
      name: "Custom Row 0",
      claimType: "LINE",
      prizePercent: 30,
      order: 1,
      design: 0,
      mask: 0x1F,
    },
    {
      id: "row4",
      name: "Custom Row 4",
      claimType: "LINE",
      prizePercent: 30,
      order: 2,
      design: 0,
      mask: 0x1f00000, // rad 4 — ikke vunnet
    },
  ];

  const tickets = new Map<string, Ticket[]>([["alice", [ticketWithRow0()]]]);
  const state = makeState({
    mode: "concurrent",
    drawnNumbers: [1, 2, 3, 4, 5], // bare rad 0
    tickets,
    patterns,
    patternResults: makeUnwonResults(patterns),
  });

  const result = service.evaluateAfterDraw(state);

  // Kun row0 vunnet, row4 fortsatt åpen.
  assert.equal(result.phasesAdvanced.length, 1);
  assert.equal(result.phasesAdvanced[0]!.patternId, "row0");
  assert.equal(result.allCardsClosed, false);
});

test("PatternEvalService: concurrent — pattern uten mask hoppes over (defensiv)", () => {
  const service = new PatternEvalService();
  const patterns: PatternDefinition[] = [
    {
      id: "no-mask",
      name: "No Mask",
      claimType: "LINE",
      prizePercent: 30,
      order: 1,
      design: 0,
      // mask: undefined → skipper
    },
  ];

  const tickets = new Map<string, Ticket[]>([["alice", [ticketWithRow0()]]]);
  const state = makeState({
    mode: "concurrent",
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
    patterns,
    patternResults: makeUnwonResults(patterns),
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 0);
  // patternResults tomme → ingen wonIds → patterns.every(...) = false.
  // Men localWonIds-set tomt og pattern hoppes over → ikke lagt til localWonIds.
  // Dvs. allCardsClosed = patterns.every(p => localWonIds.has(p.id)) = false.
  assert.equal(result.allCardsClosed, false);
});

// ── Per-color matrix ────────────────────────────────────────────────────────

test("PatternEvalService: per-color — vinnere grupperes per ticket-color", () => {
  const service = new PatternEvalService();
  const yellowTicket = makeTicket(
    [
      1, 2, 3, 4, 5,
      16, 17, 18, 19, 20,
      31, 32, 0, 33, 34,
      46, 47, 48, 49, 50,
      61, 62, 63, 64, 65,
    ],
    "Yellow",
    "ticket-y",
  );
  const purpleTicket = makeTicket(
    [
      1, 2, 3, 4, 5, // også rad 0 dekket
      26, 27, 28, 29, 30,
      36, 37, 0, 38, 39,
      51, 52, 53, 54, 55,
      66, 67, 68, 69, 70,
    ],
    "Purple",
    "ticket-p",
  );

  // Per-color matrise: Yellow og Purple har egne pattern-versjoner.
  const yellowP1: PatternDefinition = {
    id: "p1",
    name: "1 Rad Yellow",
    claimType: "LINE",
    prizePercent: 25,
    order: 1,
    design: 1,
    prize1: 100,
  };
  const purpleP1: PatternDefinition = {
    id: "p1",
    name: "1 Rad Purple",
    claimType: "LINE",
    prizePercent: 30,
    order: 1,
    design: 1,
    prize1: 200,
  };
  const matrix: PerColorMatrix = {
    patternsByColor: new Map([
      ["Yellow", [yellowP1]],
      ["Purple", [purpleP1]],
    ]),
  };

  const patterns = [yellowP1]; // bare 1 fase for enkelhets skyld
  const tickets = new Map<string, Ticket[]>([
    ["alice", [yellowTicket]],
    ["bob", [purpleTicket]],
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
    patterns,
    patternResults: makeUnwonResults(patterns),
    perColorMatrix: matrix,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1);
  const advance = result.phasesAdvanced[0]!;

  // Begge vinnere unique på tvers av color-grupper.
  assert.deepEqual([...advance.winnerIds], ["alice", "bob"]);

  // To color-grupper: Yellow + Purple, sortert lex.
  const colorKeys = [...advance.winnerGroups.keys()];
  assert.deepEqual(colorKeys, ["Purple", "Yellow"], "color-keys sortert lex");

  const yellowGroup = advance.winnerGroups.get("Yellow")!;
  const purpleGroup = advance.winnerGroups.get("Purple")!;
  assert.deepEqual([...yellowGroup.winnerIds], ["alice"]);
  assert.deepEqual([...purpleGroup.winnerIds], ["bob"]);

  // Per-color-pattern brukes som resolvedPattern.
  assert.equal(yellowGroup.resolvedPattern.name, "1 Rad Yellow");
  assert.equal(yellowGroup.resolvedPattern.prize1, 100);
  assert.equal(purpleGroup.resolvedPattern.name, "1 Rad Purple");
  assert.equal(purpleGroup.resolvedPattern.prize1, 200);

  // Claims-rader: én per (player, color).
  assert.equal(result.newClaims.length, 2);
});

test("PatternEvalService: per-color — multi-color winner får én claim per farge", () => {
  // Spiller har brett i 2 farger som BEGGE oppfyller fasen → 2 claims for
  // samme spiller i samme advance.
  const service = new PatternEvalService();
  const yellow = makeTicket(
    [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 33, 34, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65],
    "Yellow",
  );
  const red = makeTicket(
    [1, 2, 3, 4, 5, 26, 27, 28, 29, 30, 36, 37, 0, 38, 39, 51, 52, 53, 54, 55, 66, 67, 68, 69, 70],
    "Red",
  );

  const yellowP1: PatternDefinition = {
    id: "p1", name: "Yellow", claimType: "LINE", prizePercent: 25, order: 1, design: 1,
  };
  const redP1: PatternDefinition = {
    id: "p1", name: "Red", claimType: "LINE", prizePercent: 25, order: 1, design: 1,
  };
  const matrix: PerColorMatrix = {
    patternsByColor: new Map([["Yellow", [yellowP1]], ["Red", [redP1]]]),
  };

  const tickets = new Map<string, Ticket[]>([["alice", [yellow, red]]]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
    patterns: [yellowP1],
    patternResults: makeUnwonResults([yellowP1]),
    perColorMatrix: matrix,
  });

  const result = service.evaluateAfterDraw(state);

  // Én phase, alice deduplikert i winnerIds, men 2 claims (Yellow + Red).
  assert.equal(result.phasesAdvanced.length, 1);
  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice"]);
  assert.equal(result.newClaims.length, 2);
  const colorsClaimed = result.newClaims.map((c) => c.colorGroupKey).sort();
  assert.deepEqual(colorsClaimed, ["Red", "Yellow"]);
});

test("PatternEvalService: per-color — ukjent farge faller tilbake til __default__", () => {
  const service = new PatternEvalService();
  const grayTicket = makeTicket(
    [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 33, 34, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65],
    "Gray", // ikke i matrisen
  );
  const defaultP1: PatternDefinition = {
    id: "p1", name: "Default", claimType: "LINE", prizePercent: 25, order: 1, design: 1, prize1: 50,
  };
  const matrix: PerColorMatrix = {
    patternsByColor: new Map([["__default__", [defaultP1]]]),
  };

  const tickets = new Map<string, Ticket[]>([["alice", [grayTicket]]]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
    patterns: [defaultP1],
    patternResults: makeUnwonResults([defaultP1]),
    perColorMatrix: matrix,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1);
  const grayGroup = result.phasesAdvanced[0]!.winnerGroups.get("Gray")!;
  assert.equal(grayGroup.resolvedPattern.name, "Default");
  assert.equal(grayGroup.resolvedPattern.prize1, 50);
});

// ── NOT_RUNNING / empty inputs ──────────────────────────────────────────────

test("PatternEvalService: NOT_RUNNING → tom resultat", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([["alice", [ticketWithRow0()]]]);
  const state = makeState({
    status: "NOT_RUNNING",
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 0);
  assert.equal(result.newClaims.length, 0);
  assert.equal(result.allCardsClosed, false);
});

test("PatternEvalService: tomme patterns → tom resultat", () => {
  const service = new PatternEvalService();
  const state = makeState({
    patterns: [],
    patternResults: [],
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 0);
  assert.equal(result.newClaims.length, 0);
  assert.equal(result.allCardsClosed, false);
});

test("PatternEvalService: tom tickets → tom resultat", () => {
  const service = new PatternEvalService();
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets: new Map(),
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 0);
  assert.equal(result.allCardsClosed, false);
});

test("PatternEvalService: alle patterns allerede vunnet → allCardsClosed=true, ingen advance", () => {
  const service = new PatternEvalService();
  const patterns = makeSpill1Patterns();
  const allWon: PatternResult[] = patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: true,
    winnerIds: ["alice"],
  }));
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets: new Map([["alice", [ticketWithRow0()]]]),
    patternResults: allWon,
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 0);
  assert.equal(result.allCardsClosed, true);
});

// ── Idempotency: same input → same output ──────────────────────────────────

test("PatternEvalService: idempotent — samme state gir samme output (1000 ganger)", () => {
  const service = new PatternEvalService();
  const tickets = new Map<string, Ticket[]>([
    ["alice", [ticketWithRow0()]],
    ["bob", [ticketWithRow0()]],
  ]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
  });

  const expected = service.evaluateAfterDraw(state);

  for (let i = 0; i < 1000; i++) {
    const result = service.evaluateAfterDraw(state);
    assert.deepEqual(
      {
        phasesAdvanced: result.phasesAdvanced.map((p) => ({
          ...p,
          winnerIds: [...p.winnerIds],
          winnerGroups: [...p.winnerGroups.entries()].map(([k, v]) => [
            k,
            { ...v, winnerIds: [...v.winnerIds] },
          ]),
        })),
        newClaims: [...result.newClaims],
        allCardsClosed: result.allCardsClosed,
      },
      {
        phasesAdvanced: expected.phasesAdvanced.map((p) => ({
          ...p,
          winnerIds: [...p.winnerIds],
          winnerGroups: [...p.winnerGroups.entries()].map(([k, v]) => [
            k,
            { ...v, winnerIds: [...v.winnerIds] },
          ]),
        })),
        newClaims: [...expected.newClaims],
        allCardsClosed: expected.allCardsClosed,
      },
    );
  }
});

// ── Pure: input not mutated ────────────────────────────────────────────────

test("PatternEvalService: pure — input-state ikke mutert", () => {
  const service = new PatternEvalService();
  const ticket = ticketWithRows01();
  const tickets = new Map<string, Ticket[]>([["alice", [ticket]]]);
  const drawn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const patterns = makeSpill1Patterns();
  const patternResults = makeUnwonResults(patterns);

  const state: PatternEvalState = {
    gameId: "game-1",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: drawn,
    tickets,
    patterns,
    patternResults,
  };

  service.evaluateAfterDraw(state);

  // Verify drawn ikke mutert.
  assert.deepEqual([...state.drawnNumbers], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // patternResults uendret — caller skal markere isWon selv.
  for (const r of state.patternResults) {
    assert.equal(r.isWon, false);
  }
});

// ── Error: malformed input ─────────────────────────────────────────────────

test("PatternEvalService: error — tom gameId → INVALID_STATE", () => {
  const service = new PatternEvalService();
  const state = makeState({ gameId: "" });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("gameId"),
  );
});

test("PatternEvalService: error — ugyldig status → INVALID_STATE", () => {
  const service = new PatternEvalService();
  const state = makeState({ status: "PAUSED" as PatternEvalState["status"] });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("status"),
  );
});

test("PatternEvalService: error — ugyldig mode → INVALID_STATE", () => {
  const service = new PatternEvalService();
  const state = makeState({ mode: "weird" as PatternEvalState["mode"] });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("mode"),
  );
});

test("PatternEvalService: error — drawnNumbers ikke array → INVALID_STATE", () => {
  const service = new PatternEvalService();
  const state = makeState({
    drawnNumbers: "not-array" as unknown as number[],
  });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("drawnNumbers"),
  );
});

test("PatternEvalService: error — tickets ikke Map → INVALID_STATE", () => {
  const service = new PatternEvalService();
  const state = makeState({
    tickets: {} as unknown as Map<string, Ticket[]>,
  });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("tickets"),
  );
});

test("PatternEvalService: error — patternResults.length mismatch → PATTERN_RESULTS_MISMATCH", () => {
  const service = new PatternEvalService();
  const patterns = makeSpill1Patterns();
  const truncatedResults = patterns.slice(0, 1).map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));
  const state = makeState({
    patterns,
    patternResults: truncatedResults,
  });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "PATTERN_RESULTS_MISMATCH",
  );
});

test("PatternEvalService: error — patternResults inneholder ukjent patternId → PATTERN_RESULTS_MISMATCH", () => {
  const service = new PatternEvalService();
  const patterns = makeSpill1Patterns();
  const wrongResults: PatternResult[] = [
    { patternId: "wrong-id", patternName: "Wrong", claimType: "LINE", isWon: false },
    { patternId: "p2", patternName: "2 Rader", claimType: "LINE", isWon: false },
    { patternId: "p3", patternName: "Fullt Hus", claimType: "BINGO", isWon: false },
  ];
  const state = makeState({
    patterns,
    patternResults: wrongResults,
  });

  assert.throws(
    () => service.evaluateAfterDraw(state),
    (err: unknown) =>
      err instanceof PatternEvalError &&
      err.code === "PATTERN_RESULTS_MISMATCH",
  );
});

// ── Pure helpers exported for test reuse ───────────────────────────────────

test("sortWinnerIdsDeterministic: lex-sort fra Set", () => {
  const ids = new Set(["zebra", "alice", "mike"]);
  assert.deepEqual(sortWinnerIdsDeterministic(ids), ["alice", "mike", "zebra"]);
});

test("sortWinnerIdsDeterministic: lex-sort fra array", () => {
  assert.deepEqual(
    sortWinnerIdsDeterministic(["zebra", "alice", "mike"]),
    ["alice", "mike", "zebra"],
  );
});

test("sortWinnerIdsDeterministic: tom input → tom output", () => {
  assert.deepEqual(sortWinnerIdsDeterministic([]), []);
});

test("meetsPhaseRequirement: Phase 1 → 1 rad → match", () => {
  const ticket = ticketWithRow0();
  const drawn = new Set([1, 2, 3, 4, 5]);
  const pattern: PatternDefinition = {
    id: "p1", name: "1 Rad", claimType: "LINE", prizePercent: 25, order: 1, design: 1,
  };
  assert.equal(meetsPhaseRequirement(pattern, ticket, drawn), true);
});

test("meetsPhaseRequirement: Phase 1 → ikke full rad → no match", () => {
  const ticket = ticketWithRow0();
  const drawn = new Set([1, 2, 3]); // bare 3 av 5
  const pattern: PatternDefinition = {
    id: "p1", name: "1 Rad", claimType: "LINE", prizePercent: 25, order: 1, design: 1,
  };
  assert.equal(meetsPhaseRequirement(pattern, ticket, drawn), false);
});

test("meetsPhaseRequirement: BINGO → fullt hus → match", () => {
  const ticket = makeTicket([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 13, 14,
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  ]);
  const drawn = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  const pattern: PatternDefinition = {
    id: "p3", name: "Fullt Hus", claimType: "BINGO", prizePercent: 40, order: 3, design: 3,
  };
  assert.equal(meetsPhaseRequirement(pattern, ticket, drawn), true);
});

test("meetsPhaseRequirement: BINGO → mangler 1 → no match", () => {
  const ticket = makeTicket([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 13, 14,
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  ]);
  const drawn = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    15, 16, 17, 18, 19, 20, 21, 22, 23]); // mangler 24
  const pattern: PatternDefinition = {
    id: "p3", name: "Fullt Hus", claimType: "BINGO", prizePercent: 40, order: 3, design: 3,
  };
  assert.equal(meetsPhaseRequirement(pattern, ticket, drawn), false);
});

// ── Realistic Spill 1 scenario ─────────────────────────────────────────────

test("PatternEvalService: realistisk Spill 1 — 3 spillere, multi-fase rekursiv vinning", () => {
  // Scenario: 3 spillere kjøper bonger. Drawn-state etter 24 baller (alle 1-24).
  // Alice har komplett 5×5 (alle numre 1-24 + free centre).
  // Bob har bare 1 rad — vi må passe på at hans ticket KUN har én rad
  // dekket av numre 1-24 og ikke flere ved tilfeldighet.
  // Carol har ingen.
  // Forventet: Phase 1 = alice + bob, Phase 2-3 = kun alice (recursion).
  const service = new PatternEvalService();
  const fullHouse = makeTicket([
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ]);
  // Bob har rad 0 = (1,2,3,4,5). Resten av brettet er numre > 24 så han har
  // KUN 1 hel rad og ingen kolonner dekket (ellers ville han fått phase 1
  // via kolonne også, men det er fortsatt phase 1 så det er OK).
  const oneRow = makeTicket([
    1, 2, 3, 4, 5,
    25, 26, 27, 28, 29,
    30, 31, 0, 32, 33,
    34, 35, 36, 37, 38,
    39, 40, 41, 42, 43,
  ]);
  const noWin = makeTicket([
    51, 52, 53, 54, 55,
    56, 57, 58, 59, 60,
    61, 62, 0, 63, 64,
    65, 66, 67, 68, 69,
    70, 71, 72, 73, 74,
  ]);

  const tickets = new Map<string, Ticket[]>([
    ["alice", [fullHouse]],
    ["bob", [oneRow]],
    ["carol", [noWin]],
  ]);
  const state = makeState({
    drawnNumbers: Array.from({ length: 24 }, (_, i) => i + 1),
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  // Phase 1: alice OG bob vinner (begge har rad 0). Phase 2-3: kun alice.
  assert.equal(result.phasesAdvanced.length, 3);
  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice", "bob"]);
  assert.deepEqual([...result.phasesAdvanced[1]!.winnerIds], ["alice"]);
  assert.deepEqual([...result.phasesAdvanced[2]!.winnerIds], ["alice"]);

  // Total claims: 2 (p1) + 1 (p2) + 1 (p3) = 4.
  assert.equal(result.newClaims.length, 4);

  assert.equal(result.allCardsClosed, true);
});

// ── Diagnostics: error has structured details ──────────────────────────────

test("PatternEvalService: error har strukturert details for transport-mapping", () => {
  const service = new PatternEvalService();
  let captured: PatternEvalError | null = null;
  try {
    service.evaluateAfterDraw(makeState({ status: "BAD" as PatternEvalState["status"] }));
  } catch (err) {
    if (err instanceof PatternEvalError) captured = err;
  }
  assert.notEqual(captured, null);
  assert.equal(captured!.name, "PatternEvalError");
  assert.equal(captured!.code, "INVALID_STATE");
  assert.ok(captured!.details);
  assert.equal(captured!.details!.gameId, "game-1");
});

// ── Concurrent mode marks-set behavior ─────────────────────────────────────

test("PatternEvalService: concurrent — bruker player marks-set når satt", () => {
  // Concurrent støtter klient-merket evaluering — hvis player har eksplisitt
  // marks-set bruker vi den i stedet for drawnSet (matcher PR-P5-flowen).
  const service = new PatternEvalService();
  const patterns: PatternDefinition[] = [{
    id: "row0", name: "Row 0", claimType: "LINE", prizePercent: 30, order: 1, design: 0,
    mask: 0x1F,
  }];

  const ticket = ticketWithRow0();
  const tickets = new Map<string, Ticket[]>([["alice", [ticket]]]);
  // marks-set inneholder bare {1,2,3,4,5}, drawn er tomt.
  const marks = new Map<string, ReadonlySet<number>[]>([
    ["alice", [new Set([1, 2, 3, 4, 5])]],
  ]);
  const state = makeState({
    mode: "concurrent",
    drawnNumbers: [], // INGEN draws
    tickets,
    marks,
    patterns,
    patternResults: makeUnwonResults(patterns),
  });

  const result = service.evaluateAfterDraw(state);

  // Selv om drawn er tom, bruker concurrent-mode marks-set → vinner.
  assert.equal(result.phasesAdvanced.length, 1);
  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice"]);
});

test("PatternEvalService: concurrent — falle tilbake til drawnSet når marks tom", () => {
  const service = new PatternEvalService();
  const patterns: PatternDefinition[] = [{
    id: "row0", name: "Row 0", claimType: "LINE", prizePercent: 30, order: 1, design: 0,
    mask: 0x1F,
  }];

  const ticket = ticketWithRow0();
  const tickets = new Map<string, Ticket[]>([["alice", [ticket]]]);
  // Tom marks-set → fall tilbake til drawnSet.
  const marks = new Map<string, ReadonlySet<number>[]>([
    ["alice", [new Set()]],
  ]);
  const state = makeState({
    mode: "concurrent",
    drawnNumbers: [1, 2, 3, 4, 5],
    tickets,
    marks,
    patterns,
    patternResults: makeUnwonResults(patterns),
  });

  const result = service.evaluateAfterDraw(state);

  assert.equal(result.phasesAdvanced.length, 1);
  assert.deepEqual([...result.phasesAdvanced[0]!.winnerIds], ["alice"]);
});

// ── PhaseAdvance.patternIndex correctness ──────────────────────────────────

test("PatternEvalService: PhaseAdvance.patternIndex matcher posisjon i state.patterns", () => {
  const service = new PatternEvalService();
  const ticket = ticketWithRows01();
  const tickets = new Map<string, Ticket[]>([["alice", [ticket]]]);
  const state = makeState({
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    tickets,
  });

  const result = service.evaluateAfterDraw(state);

  // p1 → index 0, p2 → index 1.
  assert.equal(result.phasesAdvanced[0]!.patternIndex, 0);
  assert.equal(result.phasesAdvanced[1]!.patternIndex, 1);
});
