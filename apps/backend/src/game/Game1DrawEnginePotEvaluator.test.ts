/**
 * Agent IJ2 — tester for ordinær-prize-helpers i Game1DrawEnginePotEvaluator.
 *
 * Dekker:
 *   - `computeOrdinaryWinCentsByHallPerColor`:
 *     - split på per-farge-gruppe størrelse
 *     - jackpot lagt til firstWinner's farge
 *     - fallback til 0 ved manglende pattern-config
 *   - `computeOrdinaryWinCentsByHallFlat`:
 *     - flat-path split på totalPhasePrize / winners.length
 *     - per-winner jackpot etter firstWinner's farge
 *     - multi-hall returnerer én entry per unik hall
 *
 * Hensikten med disse helperne er at Innsatsen-pot (capType='total') skal
 * kunne trimme pot-payout ned til (cap - ordinær) etter legacy-semantikk.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeOrdinaryWinCentsByHallFlat,
  computeOrdinaryWinCentsByHallPerColor,
} from "./Game1DrawEnginePotEvaluator.js";
import type { Game1WinningAssignment } from "./Game1PayoutService.js";

function w(overrides: Partial<Game1WinningAssignment> & { userId: string }): Game1WinningAssignment & { userId: string } {
  return {
    assignmentId: overrides.assignmentId ?? "a-1",
    walletId: overrides.walletId ?? "wal-1",
    hallId: overrides.hallId ?? "hall-a",
    ticketColor: overrides.ticketColor ?? "yellow",
    ...overrides,
  };
}

// ── computeOrdinaryWinCentsByHallPerColor ───────────────────────────────────

test("perColor: én vinner, én farge, ingen jackpot → totalPhasePrize går til firstWinner", () => {
  const winners = [w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" })];
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners,
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 10_000_00,
    patternsForColor: () => ({ totalPhasePrizeCents: 500_00 }),
    jackpotForColor: () => 0,
  });
  assert.equal(result.size, 1);
  assert.equal(result.get("hall-a"), 500_00);
});

test("perColor: 2 vinnere samme farge → hver får full prize (Tolkning A, ingen split)", () => {
  // Per-vinner-per-farge (PM 2026-05-08): begge får 1001_00 hver, IKKE
  // floor(1001_00 / 2). Helper-en returnerer ordinær for firstWinner i
  // hallen — som under ny semantikk er full per-color prize.
  const winners = [
    w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" }),
    w({ userId: "u-2", hallId: "hall-a", ticketColor: "yellow", assignmentId: "a-2" }),
  ];
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners,
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 10_000_00,
    patternsForColor: () => ({ totalPhasePrizeCents: 1001_00 }),
    jackpotForColor: () => 0,
  });
  assert.equal(result.get("hall-a"), 1001_00);
});

test("perColor: jackpot legges til firstWinner-farge", () => {
  const winners = [w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" })];
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners,
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 10_000_00,
    patternsForColor: () => ({ totalPhasePrizeCents: 500_00 }),
    jackpotForColor: (c) => (c === "yellow" ? 200_00 : 0),
  });
  assert.equal(result.get("hall-a"), 500_00 + 200_00);
});

test("perColor: multi-hall, ulike farger → én entry per hall", () => {
  const winners = [
    w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" }),
    w({ userId: "u-2", hallId: "hall-b", ticketColor: "red", assignmentId: "a-2" }),
  ];
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners,
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 10_000_00,
    patternsForColor: (color) =>
      color === "yellow"
        ? { totalPhasePrizeCents: 500_00 }
        : { totalPhasePrizeCents: 300_00 },
    jackpotForColor: () => 0,
  });
  assert.equal(result.size, 2);
  assert.equal(result.get("hall-a"), 500_00);
  assert.equal(result.get("hall-b"), 300_00);
});

test("perColor: pattern-config null → fallback 0 for den hallen", () => {
  const winners = [w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" })];
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners,
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 10_000_00,
    patternsForColor: () => null,
    jackpotForColor: () => 0,
  });
  assert.equal(result.get("hall-a"), 0);
});

test("perColor: tom vinnerliste → tom map", () => {
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners: [],
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 0,
    patternsForColor: () => null,
    jackpotForColor: () => 0,
  });
  assert.equal(result.size, 0);
});

test("perColor: helper kaster internt → fallback 0, andre halls upåvirket", () => {
  const winners = [
    w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" }),
    w({ userId: "u-2", hallId: "hall-b", ticketColor: "red", assignmentId: "a-2" }),
  ];
  const result = computeOrdinaryWinCentsByHallPerColor({
    winners,
    phase: 5,
    drawSequenceAtWin: 57,
    potCents: 0,
    patternsForColor: (color) => {
      if (color === "yellow") throw new Error("boom");
      return { totalPhasePrizeCents: 300_00 };
    },
    jackpotForColor: () => 0,
  });
  assert.equal(result.get("hall-a"), 0, "yellow feilet → 0");
  assert.equal(result.get("hall-b"), 300_00, "red upåvirket");
});

// ── computeOrdinaryWinCentsByHallFlat ───────────────────────────────────────

test("flat: én vinner → hele totalPhasePrize til firstWinner", () => {
  const winners = [w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" })];
  const result = computeOrdinaryWinCentsByHallFlat({
    winners,
    totalPhasePrizeCents: 500_00,
    jackpotForColor: () => 0,
  });
  assert.equal(result.get("hall-a"), 500_00);
});

test("flat: 3 vinnere → floor-split, alle får samme", () => {
  const winners = [
    w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" }),
    w({ userId: "u-2", hallId: "hall-b", ticketColor: "red", assignmentId: "a-2" }),
    w({ userId: "u-3", hallId: "hall-c", ticketColor: "green", assignmentId: "a-3" }),
  ];
  const result = computeOrdinaryWinCentsByHallFlat({
    winners,
    totalPhasePrizeCents: 1000_00,
    jackpotForColor: () => 0,
  });
  const expected = Math.floor(1000_00 / 3);
  assert.equal(result.get("hall-a"), expected);
  assert.equal(result.get("hall-b"), expected);
  assert.equal(result.get("hall-c"), expected);
});

test("flat: jackpot per firstWinner's farge", () => {
  const winners = [
    w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" }),
    w({ userId: "u-2", hallId: "hall-b", ticketColor: "red", assignmentId: "a-2" }),
  ];
  const result = computeOrdinaryWinCentsByHallFlat({
    winners,
    totalPhasePrizeCents: 1000_00,
    jackpotForColor: (c) => (c === "yellow" ? 500_00 : 100_00),
  });
  const split = Math.floor(1000_00 / 2);
  assert.equal(result.get("hall-a"), split + 500_00);
  assert.equal(result.get("hall-b"), split + 100_00);
});

test("flat: jackpot-helper kaster → fallback til bare split", () => {
  const winners = [w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" })];
  const result = computeOrdinaryWinCentsByHallFlat({
    winners,
    totalPhasePrizeCents: 500_00,
    jackpotForColor: () => {
      throw new Error("jackpot-boom");
    },
  });
  assert.equal(result.get("hall-a"), 500_00);
});

test("flat: flere winners samme hall → firstWinner tas, split er global", () => {
  const winners = [
    w({ userId: "u-1", hallId: "hall-a", ticketColor: "yellow" }),
    w({ userId: "u-2", hallId: "hall-a", ticketColor: "red", assignmentId: "a-2" }),
    w({ userId: "u-3", hallId: "hall-b", ticketColor: "green", assignmentId: "a-3" }),
  ];
  const result = computeOrdinaryWinCentsByHallFlat({
    winners,
    totalPhasePrizeCents: 900_00,
    jackpotForColor: (c) => (c === "yellow" ? 100_00 : c === "green" ? 50_00 : 0),
  });
  const split = Math.floor(900_00 / 3);
  // hall-a firstWinner = u-1 med yellow → split + 100
  assert.equal(result.get("hall-a"), split + 100_00);
  // hall-b firstWinner = u-3 med green → split + 50
  assert.equal(result.get("hall-b"), split + 50_00);
});

test("flat: tom vinnerliste → tom map", () => {
  const result = computeOrdinaryWinCentsByHallFlat({
    winners: [],
    totalPhasePrizeCents: 1000_00,
    jackpotForColor: () => 0,
  });
  assert.equal(result.size, 0);
});
