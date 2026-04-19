/**
 * BIN-672: defense-in-depth tests for the 5×5 ticket format guarantee.
 *
 * Every hole we plugged in commits 1–5 has a test here. If any of these
 * fail in the future, someone has reopened the door to the BIN-619/
 * BIN-671 regression where missing-gameSlug silently produced 3×5
 * Databingo60 tickets in a Bingo75 game.
 *
 * Run via:
 *   npx tsx --test apps/backend/src/game/ticket.bin672.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTicketForGame,
  BINGO75_SLUGS,
  GAME2_SLUGS,
  GAME3_SLUGS,
  DATABINGO60_SLUGS,
  uses75Ball,
  usesDatabingo60,
} from "./ticket.js";
import { DomainError } from "./BingoEngine.js";

test("BIN-672: generateTicketForGame throws on undefined gameSlug", () => {
  assert.throws(
    // @ts-expect-error — runtime-guard test: caller bypass
    () => generateTicketForGame(undefined),
    (err: Error) => err instanceof DomainError && err.code === "UNKNOWN_GAME_SLUG",
    "undefined slug must throw DomainError(UNKNOWN_GAME_SLUG)",
  );
});

test("BIN-672: generateTicketForGame throws on empty string", () => {
  assert.throws(
    () => generateTicketForGame(""),
    (err: Error) => err instanceof DomainError,
    "empty-string slug must throw",
  );
});

test("BIN-672: generateTicketForGame throws on unknown slug", () => {
  assert.throws(
    () => generateTicketForGame("rocket-v2-beta"),
    (err: Error) => err instanceof DomainError && /rocket-v2-beta/.test(err.message),
    "unknown slug must throw with the slug in the message",
  );
});

test("BIN-672: error message lists all recognized slugs", () => {
  try {
    generateTicketForGame("does-not-exist");
    assert.fail("should have thrown");
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    const msg = err.message;
    for (const slug of [...BINGO75_SLUGS, ...GAME2_SLUGS, ...GAME3_SLUGS, ...DATABINGO60_SLUGS]) {
      assert.ok(
        msg.includes(slug),
        `error message should list "${slug}" — got: ${msg}`,
      );
    }
  }
});

test("BIN-672: 'bingo' slug produces 5×5 grid with free centre", () => {
  const t = generateTicketForGame("bingo");
  assert.equal(t.grid.length, 5, "5 rows");
  assert.equal(t.grid[0].length, 5, "5 cols");
  assert.equal(t.grid[2][2], 0, "centre is free (0)");
});

test("BIN-672: 'game_1' alias also produces 5×5", () => {
  const t = generateTicketForGame("game_1");
  assert.equal(t.grid.length, 5);
  assert.equal(t.grid[0].length, 5);
});

test("BIN-672: explicit 'databingo' slug still gets 3×5 (opt-in)", () => {
  const t = generateTicketForGame("databingo");
  assert.equal(t.grid.length, 3, "3 rows");
  assert.equal(t.grid[0].length, 5, "5 cols");
});

test("BIN-672: 'databingo60' + 'bingo60' aliases also produce 3×5", () => {
  for (const slug of ["databingo60", "bingo60"]) {
    const t = generateTicketForGame(slug);
    assert.equal(t.grid.length, 3, `3 rows for ${slug}`);
    assert.equal(t.grid[0].length, 5, `5 cols for ${slug}`);
  }
});

test("BIN-672: 'rocket' slug produces 3×3", () => {
  const t = generateTicketForGame("rocket");
  assert.equal(t.grid.length, 3);
  assert.equal(t.grid[0].length, 3);
});

test("BIN-672: 'monsterbingo' slug produces 5×5 WITHOUT free centre", () => {
  const t = generateTicketForGame("monsterbingo");
  assert.equal(t.grid.length, 5);
  assert.equal(t.grid[0].length, 5);
  assert.notEqual(t.grid[2][2], 0, "Game 3 has NO free centre — middle cell should be a real number");
});

test("BIN-672: slug-set predicates stay disjoint (no overlap)", () => {
  const all = new Map<string, string>();
  for (const [name, set] of [
    ["BINGO75", BINGO75_SLUGS],
    ["GAME2", GAME2_SLUGS],
    ["GAME3", GAME3_SLUGS],
    ["DATABINGO60", DATABINGO60_SLUGS],
  ] as const) {
    for (const slug of set) {
      const prior = all.get(slug);
      assert.ok(
        !prior,
        `slug "${slug}" appears in BOTH ${prior} and ${name} — must be disjoint`,
      );
      all.set(slug, name);
    }
  }
});

test("BIN-672: uses75Ball + usesDatabingo60 helpers agree with the sets", () => {
  assert.equal(uses75Ball("bingo"), true);
  assert.equal(uses75Ball("game_1"), true);
  assert.equal(uses75Ball("databingo"), false);
  assert.equal(uses75Ball(undefined), false);
  assert.equal(usesDatabingo60("databingo"), true);
  assert.equal(usesDatabingo60("bingo"), false);
  assert.equal(usesDatabingo60(undefined), false);
});
