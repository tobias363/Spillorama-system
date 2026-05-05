/**
 * Unit-tests for `isPerpetualSlug` + `PERPETUAL_SLUGS`.
 *
 * Audit-ref: SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md §2.7 — slug-bypass
 * må dekke ALLE aliaser, ikke bare canonical (`rocket`/`monsterbingo`).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PERPETUAL_SLUGS,
  isPerpetualSlug,
} from "./PerpetualRoundService.js";

test("PERPETUAL_SLUGS includes all Spill 2 aliases (rocket/game_2/tallspill)", () => {
  assert.equal(PERPETUAL_SLUGS.has("rocket"), true);
  assert.equal(PERPETUAL_SLUGS.has("game_2"), true);
  assert.equal(PERPETUAL_SLUGS.has("tallspill"), true);
});

test("PERPETUAL_SLUGS includes all Spill 3 aliases (monsterbingo/mønsterbingo/game_3)", () => {
  assert.equal(PERPETUAL_SLUGS.has("monsterbingo"), true);
  assert.equal(PERPETUAL_SLUGS.has("mønsterbingo"), true);
  assert.equal(PERPETUAL_SLUGS.has("game_3"), true);
});

test("PERPETUAL_SLUGS does NOT include Spill 1 / SpinnGo / Candy", () => {
  assert.equal(PERPETUAL_SLUGS.has("bingo"), false);
  assert.equal(PERPETUAL_SLUGS.has("spillorama"), false);
  assert.equal(PERPETUAL_SLUGS.has("game_5"), false);
  assert.equal(PERPETUAL_SLUGS.has("candy"), false);
});

test("isPerpetualSlug accepts canonical Spill 2/3 slugs", () => {
  assert.equal(isPerpetualSlug("rocket"), true);
  assert.equal(isPerpetualSlug("monsterbingo"), true);
});

test("isPerpetualSlug accepts Spill 2 aliases", () => {
  assert.equal(isPerpetualSlug("tallspill"), true);
  assert.equal(isPerpetualSlug("game_2"), true);
});

test("isPerpetualSlug accepts Spill 3 aliases (incl. norsk ø)", () => {
  assert.equal(isPerpetualSlug("mønsterbingo"), true);
  assert.equal(isPerpetualSlug("game_3"), true);
});

test("isPerpetualSlug is case-insensitive", () => {
  assert.equal(isPerpetualSlug("ROCKET"), true);
  assert.equal(isPerpetualSlug("Rocket"), true);
  assert.equal(isPerpetualSlug("MONSTERBINGO"), true);
  assert.equal(isPerpetualSlug("MønsterBingo"), true);
  assert.equal(isPerpetualSlug("TALLSPILL"), true);
});

test("isPerpetualSlug handles whitespace-tolerant slugs", () => {
  // Slug fra DB/seed kan ha trailing space etter manuell editing.
  assert.equal(isPerpetualSlug("  rocket  "), true);
  assert.equal(isPerpetualSlug("rocket\n"), true);
  assert.equal(isPerpetualSlug("\tmonsterbingo"), true);
});

test("isPerpetualSlug rejects Spill 1 / SpinnGo / Candy / unknown slugs", () => {
  assert.equal(isPerpetualSlug("bingo"), false);
  assert.equal(isPerpetualSlug("spillorama"), false);
  assert.equal(isPerpetualSlug("game_5"), false);
  assert.equal(isPerpetualSlug("candy"), false);
  assert.equal(isPerpetualSlug("themebingo"), false);
  assert.equal(isPerpetualSlug("game_4"), false); // deprecated BIN-496
});

test("isPerpetualSlug rejects null / undefined / empty / non-strings", () => {
  assert.equal(isPerpetualSlug(null), false);
  assert.equal(isPerpetualSlug(undefined), false);
  assert.equal(isPerpetualSlug(""), false);
  assert.equal(isPerpetualSlug("   "), false);
});

test("isPerpetualSlug rejects substrings (no partial match)", () => {
  // Defensiv: bare exact-match etter normalize. En ondsinnet slug som
  // inneholder "rocket" som substring skal IKKE matche.
  assert.equal(isPerpetualSlug("rocket-rom"), false);
  assert.equal(isPerpetualSlug("super-rocket"), false);
  assert.equal(isPerpetualSlug("monsterbingo123"), false);
});
