/**
 * K2-A CRIT-1: tester for ledgerGameTypeForSlug.
 *
 * Verifiserer at Spill 1-3 (hovedspill: bingo/rocket/monsterbingo + legacy-
 * aliaser) returnerer MAIN_GAME, mens SpinnGo (spillorama / game_5) og
 * ukjente slugs returnerer DATABINGO. Spill 2/3 ble lagt til 2026-04-30
 * etter `WIREFRAME_PARITY_AUDIT_2026-04-30.md` som flagget §11-distribusjon-
 * bug (30% i stedet for 15% for hovedspill).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";

test("ledgerGameTypeForSlug: 'bingo' → MAIN_GAME (Spill 1)", () => {
  assert.equal(ledgerGameTypeForSlug("bingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'game_1' → MAIN_GAME (Spill 1 legacy-alias)", () => {
  assert.equal(ledgerGameTypeForSlug("game_1"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: case-insensitive for 'BINGO'", () => {
  assert.equal(ledgerGameTypeForSlug("BINGO"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("Bingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: trimmer whitespace rundt slug", () => {
  assert.equal(ledgerGameTypeForSlug("  bingo  "), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("\tbingo\n"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'rocket' → MAIN_GAME (Spill 2 — hovedspill)", () => {
  assert.equal(ledgerGameTypeForSlug("rocket"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'game_2' → MAIN_GAME (Spill 2 legacy-alias)", () => {
  assert.equal(ledgerGameTypeForSlug("game_2"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'tallspill' → MAIN_GAME (Spill 2 alias)", () => {
  assert.equal(ledgerGameTypeForSlug("tallspill"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'monsterbingo' → MAIN_GAME (Spill 3 — hovedspill)", () => {
  assert.equal(ledgerGameTypeForSlug("monsterbingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'mønsterbingo' → MAIN_GAME (Spill 3 admin-UI-alias)", () => {
  assert.equal(ledgerGameTypeForSlug("mønsterbingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'game_3' → MAIN_GAME (Spill 3 legacy-alias)", () => {
  assert.equal(ledgerGameTypeForSlug("game_3"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: case-insensitive for Spill 2/3-slugs", () => {
  assert.equal(ledgerGameTypeForSlug("ROCKET"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("Rocket"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("MONSTERBINGO"), "MAIN_GAME");
  // mønsterbingo bruker ø (lower-case) — case-insensitive lookup må gjenkjenne MØNSTERBINGO.
  assert.equal(ledgerGameTypeForSlug("MØNSTERBINGO"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("MønsterBingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'spillorama' → DATABINGO (SpinnGo / Spill 4)", () => {
  assert.equal(ledgerGameTypeForSlug("spillorama"), "DATABINGO");
});

test("ledgerGameTypeForSlug: 'game_5' → DATABINGO (SpinnGo legacy-alias)", () => {
  assert.equal(ledgerGameTypeForSlug("game_5"), "DATABINGO");
});

test("ledgerGameTypeForSlug: ukjent slug → DATABINGO", () => {
  assert.equal(ledgerGameTypeForSlug("unknown"), "DATABINGO");
});

test("ledgerGameTypeForSlug: null/undefined/empty → DATABINGO", () => {
  assert.equal(ledgerGameTypeForSlug(null), "DATABINGO");
  assert.equal(ledgerGameTypeForSlug(undefined), "DATABINGO");
  assert.equal(ledgerGameTypeForSlug(""), "DATABINGO");
  assert.equal(ledgerGameTypeForSlug("   "), "DATABINGO");
});
