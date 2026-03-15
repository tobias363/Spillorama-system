import assert from "node:assert/strict";
import test from "node:test";
import {
  countNearMissCandyPatternFamilies,
  findCompletedCandyPatternFamilies,
  findNearMissCandyPatternFamilies,
  resolveCandyPatternPayoutAmounts,
} from "./candyPatterns.js";
import type { Ticket } from "./types.js";

function createTicket(numbers: number[]): Ticket {
  return {
    numbers,
    grid: [
      numbers.slice(0, 5),
      numbers.slice(5, 10),
      numbers.slice(10, 15),
    ],
  };
}

test("findNearMissCandyPatternFamilies resolves one-to-go for Candy row family", () => {
  const ticket = createTicket([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const marks = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  const matches = findNearMissCandyPatternFamilies(ticket, marks);
  const fullGridFamily = matches.find((match) => match.topperSlotIndex === 0);

  assert.ok(fullGridFamily);
  assert.equal(fullGridFamily.displayPatternNumber, 12);
  assert.equal(fullGridFamily.missingNumber, 15);
});

test("countNearMissCandyPatternFamilies skips already settled topper slots", () => {
  const ticket = createTicket([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const marks = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  const unresolvedCount = countNearMissCandyPatternFamilies(ticket, marks);
  const settledCount = countNearMissCandyPatternFamilies(ticket, marks, new Set([0]));

  assert.ok(unresolvedCount > 0);
  assert.ok(settledCount < unresolvedCount);
});

test("findCompletedCandyPatternFamilies still resolves completed family matches", () => {
  const ticket = createTicket([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const marks = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

  const matches = findCompletedCandyPatternFamilies(ticket, marks);
  assert.ok(matches.some((match) => match.displayPatternNumber === 12));
});

test("resolveCandyPatternPayoutAmounts returns fixed real payouts per bong for 1 kr stake", () => {
  assert.deepEqual(resolveCandyPatternPayoutAmounts(4, 75, 4), [
    1500,
    500,
    300,
    200,
    100,
    100,
    40,
    40,
    10,
    8,
    3,
    3,
  ]);
});

test("resolveCandyPatternPayoutAmounts scales linearly with stake per bong", () => {
  assert.deepEqual(resolveCandyPatternPayoutAmounts(8, 75, 4), [
    3000,
    1000,
    600,
    400,
    200,
    200,
    80,
    80,
    20,
    16,
    6,
    6,
  ]);
});
