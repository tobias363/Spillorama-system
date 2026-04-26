/**
 * K2-A CRIT-1: tester for ledgerGameTypeForSlug.
 *
 * Verifiserer at Spill 1 (bingo) returnerer MAIN_GAME, alle andre slugs
 * (inkl. SpinnGo, Spill 2/3 og ukjente) returnerer DATABINGO som default.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";

test("ledgerGameTypeForSlug: 'bingo' → MAIN_GAME (Spill 1)", () => {
  assert.equal(ledgerGameTypeForSlug("bingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: case-insensitive for 'BINGO'", () => {
  assert.equal(ledgerGameTypeForSlug("BINGO"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("Bingo"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: trimmer whitespace rundt slug", () => {
  assert.equal(ledgerGameTypeForSlug("  bingo  "), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("\tbingo\n"), "MAIN_GAME");
});

test("ledgerGameTypeForSlug: 'spillorama' → DATABINGO (SpinnGo)", () => {
  assert.equal(ledgerGameTypeForSlug("spillorama"), "DATABINGO");
});

test("ledgerGameTypeForSlug: 'rocket' → DATABINGO (Spill 2 — egen task)", () => {
  assert.equal(ledgerGameTypeForSlug("rocket"), "DATABINGO");
});

test("ledgerGameTypeForSlug: 'monsterbingo' → DATABINGO (Spill 3 — egen task)", () => {
  assert.equal(ledgerGameTypeForSlug("monsterbingo"), "DATABINGO");
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
