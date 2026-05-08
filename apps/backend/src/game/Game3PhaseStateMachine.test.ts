/**
 * Game3PhaseStateMachine — smoke-tests som dokumenterer kontrakten for
 * sequential phase-with-pause + auto-start.
 *
 * Per Tobias-direktiv 2026-05-08 (minimal-implementasjon): 7 fokuserte
 * tester som dekker happy-path og hovedovergangene. Ikke uttømmende —
 * edge-cases tas i oppfølgings-PR ved behov.
 *
 * Test-matrise:
 *   1. Sequential: vinner Rad 1 → state.pausedUntilMs satt + advance
 *   2. shouldDrawNext: skipper i pause-vindu, OK etter pause
 *   3. Multi-vinner: 2 vinnere → hver får floor(pot/2), rest til hus
 *   4. Fullt Hus terminerer runden
 *   5. 75 baller uten Fullt Hus → markDrawBagEmpty ender runden
 *   6. Auto-start: under threshold → no-start
 *   7. Auto-start: ≥ threshold → start
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  GAME3_PHASE_NAMES,
  GAME3_PHASE_COUNT,
  createInitialPhaseState,
  evaluatePhaseAndPay,
  shouldDrawNext,
  shouldAutoStartRound,
  markDrawBagEmpty,
  ticketMatchesPhase,
  findPhaseWinners,
  type Game3PhaseIndex,
  type PhaseMask,
  type TicketMatch,
} from "./Game3PhaseStateMachine.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

/**
 * Bygg en 25-bit mask fra rad-indeks (0-4). Rad 0 = bit 0-4, Rad 1 = bit
 * 5-9, etc. Tilsvarer hvordan Row 1-4 er definert i PatternMatcher.ts.
 */
function rowMask(rowIdx: 0 | 1 | 2 | 3 | 4): number {
  const startBit = rowIdx * 5;
  let m = 0;
  for (let i = 0; i < 5; i++) m |= 1 << (startBit + i);
  return m;
}

const FULL_HOUSE_MASK = (1 << 25) - 1; // alle 25 bits satt

/**
 * Bygg phase-masks for 5 faser: Rad 1-4 (one mask each) + Fullt Hus.
 *
 * Spill 3 har 1 mask per "Rad N"-fase (fixed row). I praksis kan engine
 * ha flere masks hvis flere posisjoner gir samme premie, men for testen
 * holder det med 1 mask per fase.
 */
function buildPhaseMasks(): PhaseMask[] {
  return [
    { index: 0, masks: [rowMask(0)] }, // Rad 1
    { index: 1, masks: [rowMask(1)] }, // Rad 2
    { index: 2, masks: [rowMask(2)] }, // Rad 3
    { index: 3, masks: [rowMask(3)] }, // Rad 4
    { index: 4, masks: [FULL_HOUSE_MASK] }, // Fullt Hus
  ];
}

/** Bygg en TicketMatch fra player-id og hvilke rader som er fullt markert. */
function ticket(
  playerId: string,
  ticketId: string,
  ...completedRows: Array<0 | 1 | 2 | 3 | 4>
): TicketMatch {
  let mask = 0;
  for (const r of completedRows) mask |= rowMask(r);
  return { playerId, ticketId, ticketMask: mask };
}

const PAUSE_MS = 3000;

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Game3PhaseStateMachine — fase-konstanter", () => {
  test("GAME3_PHASE_COUNT = 5 og navn er Rad 1-4 + Fullt Hus", () => {
    assert.equal(GAME3_PHASE_COUNT, 5);
    assert.deepEqual([...GAME3_PHASE_NAMES], [
      "Rad 1",
      "Rad 2",
      "Rad 3",
      "Rad 4",
      "Fullt Hus",
    ]);
  });
});

describe("Game3PhaseStateMachine — pattern-matching helpers", () => {
  test("ticketMatchesPhase: subset-match (ticket har alle bits i mask)", () => {
    const phase: PhaseMask = { index: 0, masks: [rowMask(0)] };
    // Ticket med Rad 1 fullført → match
    assert.equal(
      ticketMatchesPhase(rowMask(0), phase),
      true,
    );
    // Ticket med kun delvis Rad 1 (4 av 5 bits) → no match
    const partialRow1 = rowMask(0) & ~(1 << 0); // mangler bit 0
    assert.equal(ticketMatchesPhase(partialRow1, phase), false);
  });

  test("findPhaseWinners filtrerer ut tickets som ikke matcher", () => {
    const phase: PhaseMask = { index: 0, masks: [rowMask(0)] };
    const tickets = [
      ticket("p1", "t1", 0), // matcher Rad 1
      ticket("p2", "t2", 1), // har Rad 2, ikke Rad 1
      ticket("p3", "t3", 0, 1), // matcher Rad 1 (har også Rad 2)
    ];
    const winners = findPhaseWinners(tickets, phase);
    assert.equal(winners.length, 2);
    assert.deepEqual(
      winners.map((w) => w.playerId).sort(),
      ["p1", "p3"],
    );
  });
});

describe("Game3PhaseStateMachine — sequential fase med pause", () => {
  test("Rad 1 vunnet → state.pausedUntilMs satt + advance til fase 1", () => {
    const state = createInitialPhaseState();
    const phaseMasks = buildPhaseMasks();
    const tickets = [ticket("p1", "t1", 0)]; // Rad 1 fullført
    const now = 1_000_000;

    const result = evaluatePhaseAndPay({
      state,
      phaseMasks,
      tickets,
      potCents: 10_000, // 100 kr
      pauseBetweenRowsMs: PAUSE_MS,
      now,
    });

    assert.equal(result.kind, "WINNERS");
    if (result.kind !== "WINNERS") return; // type narrowing

    // Vinner får hele poten (én vinner)
    assert.equal(result.payouts.length, 1);
    assert.equal(result.payouts[0]?.payoutCents, 10_000);
    assert.equal(result.houseRetainedCents, 0);
    assert.equal(result.phaseIndex, 0);

    // Ny tilstand: pause satt, advanced til Rad 2
    assert.equal(result.newState.currentPhaseIndex, 1);
    assert.equal(result.newState.pausedUntilMs, now + PAUSE_MS);
    assert.deepEqual(result.newState.phasesWon, [0]);
    assert.equal(result.newState.status, "ACTIVE");
  });

  test("shouldDrawNext skipper trekk i pause-vindu, OK etter pause", () => {
    const now = 1_000_000;
    const pausedState = {
      ...createInitialPhaseState(),
      currentPhaseIndex: 1 as Game3PhaseIndex,
      pausedUntilMs: now + PAUSE_MS,
    };

    // I pause-vindu
    const r1 = shouldDrawNext(pausedState, now + 1000);
    assert.equal(r1.skip, true);
    if (r1.skip) {
      assert.equal(r1.reason, "PAUSED");
    }

    // Etter pause utløpt
    const r2 = shouldDrawNext(pausedState, now + PAUSE_MS + 1);
    assert.equal(r2.skip, false);

    // ENDED state alltid skip
    const endedState = { ...pausedState, status: "ENDED" as const };
    const r3 = shouldDrawNext(endedState, now + PAUSE_MS + 10_000);
    assert.equal(r3.skip, true);
    if (r3.skip) {
      assert.equal(r3.reason, "ENDED");
    }
  });

  test("evaluatePhaseAndPay returnerer PAUSED i pause-vindu", () => {
    const now = 1_000_000;
    const pausedState = {
      ...createInitialPhaseState(),
      currentPhaseIndex: 1 as Game3PhaseIndex,
      pausedUntilMs: now + PAUSE_MS,
    };
    const phaseMasks = buildPhaseMasks();
    const tickets = [ticket("p1", "t1", 1)]; // Rad 2 fullført, men i pause

    const result = evaluatePhaseAndPay({
      state: pausedState,
      phaseMasks,
      tickets,
      potCents: 10_000,
      pauseBetweenRowsMs: PAUSE_MS,
      now: now + 1000, // før pause utløp
    });

    assert.equal(result.kind, "PAUSED");
    if (result.kind === "PAUSED") {
      assert.equal(result.resumesAtMs, now + PAUSE_MS);
    }
  });
});

describe("Game3PhaseStateMachine — pot-deling flat", () => {
  test("2 vinnere → hver får floor(pot/2), 0 rest", () => {
    const state = createInitialPhaseState();
    const phaseMasks = buildPhaseMasks();
    const tickets = [
      ticket("p1", "t1", 0), // matcher Rad 1
      ticket("p2", "t2", 0), // matcher Rad 1
    ];

    const result = evaluatePhaseAndPay({
      state,
      phaseMasks,
      tickets,
      potCents: 10_000, // 100 kr
      pauseBetweenRowsMs: PAUSE_MS,
      now: 1_000_000,
    });

    assert.equal(result.kind, "WINNERS");
    if (result.kind !== "WINNERS") return;

    assert.equal(result.payouts.length, 2);
    assert.equal(result.payouts[0]?.payoutCents, 5000);
    assert.equal(result.payouts[1]?.payoutCents, 5000);
    assert.equal(result.houseRetainedCents, 0);
  });

  test("3 vinnere på pot 10001 → hver får floor(10001/3)=3333, 2 til hus", () => {
    const state = createInitialPhaseState();
    const phaseMasks = buildPhaseMasks();
    const tickets = [
      ticket("p1", "t1", 0),
      ticket("p2", "t2", 0),
      ticket("p3", "t3", 0),
    ];

    const result = evaluatePhaseAndPay({
      state,
      phaseMasks,
      tickets,
      potCents: 10_001,
      pauseBetweenRowsMs: PAUSE_MS,
      now: 1_000_000,
    });

    assert.equal(result.kind, "WINNERS");
    if (result.kind !== "WINNERS") return;

    assert.equal(result.payouts.length, 3);
    for (const p of result.payouts) {
      assert.equal(p.payoutCents, 3333);
    }
    // 10001 - 3 * 3333 = 10001 - 9999 = 2
    assert.equal(result.houseRetainedCents, 2);
  });
});

describe("Game3PhaseStateMachine — runde-end", () => {
  test("Fullt Hus vunnet → status=ENDED, endedReason=FULL_HOUSE", () => {
    const state = {
      ...createInitialPhaseState(),
      currentPhaseIndex: 4 as Game3PhaseIndex, // Fullt Hus
      phasesWon: [0, 1, 2, 3] as Game3PhaseIndex[],
    };
    const phaseMasks = buildPhaseMasks();
    const tickets = [ticket("p1", "t1", 0, 1, 2, 3, 4)]; // alle rader = Fullt Hus

    const result = evaluatePhaseAndPay({
      state,
      phaseMasks,
      tickets,
      potCents: 100_000,
      pauseBetweenRowsMs: PAUSE_MS,
      now: 1_000_000,
    });

    assert.equal(result.kind, "WINNERS");
    if (result.kind !== "WINNERS") return;

    assert.equal(result.newState.status, "ENDED");
    assert.equal(result.newState.endedReason, "FULL_HOUSE");
    // Ingen pause etter Fullt Hus — ingen neste fase
    assert.equal(result.newState.pausedUntilMs, null);
    assert.deepEqual(result.newState.phasesWon, [0, 1, 2, 3, 4]);
  });

  test("75 baller uten Fullt Hus → markDrawBagEmpty avslutter runden", () => {
    const state = {
      ...createInitialPhaseState(),
      currentPhaseIndex: 3 as Game3PhaseIndex, // Aktiv på Rad 4 fortsatt
      phasesWon: [0, 1, 2] as Game3PhaseIndex[],
    };

    const ended = markDrawBagEmpty(state);
    assert.equal(ended.status, "ENDED");
    assert.equal(ended.endedReason, "DRAW_BAG_EMPTY");
    // Phases-won bevares
    assert.deepEqual(ended.phasesWon, [0, 1, 2]);

    // shouldDrawNext returnerer skip på ENDED-state
    const r = shouldDrawNext(ended, 1_000_000);
    assert.equal(r.skip, true);
    if (r.skip) {
      assert.equal(r.reason, "ENDED");
    }
  });

  test("ingen vinnere → fase forblir aktiv, ingen advance", () => {
    const state = createInitialPhaseState();
    const phaseMasks = buildPhaseMasks();
    const tickets = [ticket("p1", "t1", 1)]; // har Rad 2, ikke Rad 1

    const result = evaluatePhaseAndPay({
      state,
      phaseMasks,
      tickets,
      potCents: 10_000,
      pauseBetweenRowsMs: PAUSE_MS,
      now: 1_000_000,
    });

    assert.equal(result.kind, "NO_WINNERS");
    if (result.kind === "NO_WINNERS") {
      assert.equal(result.phaseIndex, 0);
    }
  });
});

describe("Game3PhaseStateMachine — auto-start", () => {
  test("under threshold → no-start", () => {
    const result = shouldAutoStartRound({
      roomStatus: "WAITING",
      ticketsSold: 5,
      minTicketsToStart: 20,
    });
    assert.equal(result, false);
  });

  test("≥ threshold → start", () => {
    const result = shouldAutoStartRound({
      roomStatus: "WAITING",
      ticketsSold: 20,
      minTicketsToStart: 20,
    });
    assert.equal(result, true);
  });

  test("threshold = 0 → start så snart minst én ticket er solgt", () => {
    assert.equal(
      shouldAutoStartRound({
        roomStatus: "WAITING",
        ticketsSold: 0,
        minTicketsToStart: 0,
      }),
      false,
    );
    assert.equal(
      shouldAutoStartRound({
        roomStatus: "WAITING",
        ticketsSold: 1,
        minTicketsToStart: 0,
      }),
      true,
    );
  });

  test("RUNNING/ENDED rom starter aldri på nytt", () => {
    const baseInput = { ticketsSold: 100, minTicketsToStart: 20 };
    assert.equal(
      shouldAutoStartRound({ ...baseInput, roomStatus: "RUNNING" }),
      false,
    );
    assert.equal(
      shouldAutoStartRound({ ...baseInput, roomStatus: "ENDED" }),
      false,
    );
  });
});
