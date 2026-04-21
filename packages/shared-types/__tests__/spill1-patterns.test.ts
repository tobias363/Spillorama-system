/**
 * Spill1Phase klassifisering + PHASE_MASKS geometri + popcount/remaining
 * helpers. Delt kilde for backend `meetsPhaseRequirement` og klient
 * `remainingForPattern`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  Spill1Phase,
  ROW_MASKS,
  COLUMN_MASKS,
  PHASE_1_MASKS,
  PHASE_2_MASKS,
  PHASE_3_MASKS,
  PHASE_4_MASKS,
  FULL_HOUSE_MASKS,
  PHASE_MASKS,
  classifyPhaseFromPatternName,
  popCount25,
  ticketMaskMeetsPhase,
  remainingBitsForPhase,
} from "../src/spill1-patterns.js";
import { PATTERN_MASK_FULL } from "../src/game.js";

test("ROW_MASKS — 5 rader, hver dekker 5 bits", () => {
  assert.equal(ROW_MASKS.length, 5);
  for (const m of ROW_MASKS) assert.equal(popCount25(m), 5);
  // Union av alle rader = full house
  let union = 0;
  for (const m of ROW_MASKS) union |= m;
  assert.equal(union, PATTERN_MASK_FULL);
});

test("COLUMN_MASKS — 5 kolonner, hver dekker 5 bits", () => {
  assert.equal(COLUMN_MASKS.length, 5);
  for (const m of COLUMN_MASKS) assert.equal(popCount25(m), 5);
  let union = 0;
  for (const m of COLUMN_MASKS) union |= m;
  assert.equal(union, PATTERN_MASK_FULL);
});

test("PHASE_1_MASKS — 10 masker (5 rader + 5 kolonner)", () => {
  assert.equal(PHASE_1_MASKS.length, 10);
  for (const m of PHASE_1_MASKS) assert.equal(popCount25(m), 5);
});

test("PHASE_2_MASKS — C(5,2) = 10 kolonne-par, hver 10 bits", () => {
  assert.equal(PHASE_2_MASKS.length, 10);
  for (const m of PHASE_2_MASKS) assert.equal(popCount25(m), 10);
});

test("PHASE_3_MASKS — C(5,3) = 10 kolonne-trippel, hver 15 bits", () => {
  assert.equal(PHASE_3_MASKS.length, 10);
  for (const m of PHASE_3_MASKS) assert.equal(popCount25(m), 15);
});

test("PHASE_4_MASKS — C(5,4) = 5 kolonne-kvartetter, hver 20 bits", () => {
  assert.equal(PHASE_4_MASKS.length, 5);
  for (const m of PHASE_4_MASKS) assert.equal(popCount25(m), 20);
});

test("FULL_HOUSE_MASKS — alle 25 bits", () => {
  assert.equal(FULL_HOUSE_MASKS.length, 1);
  assert.equal(FULL_HOUSE_MASKS[0], PATTERN_MASK_FULL);
  assert.equal(popCount25(FULL_HOUSE_MASKS[0]), 25);
});

test("PHASE_MASKS — lookup-tabell peker til samme arrays", () => {
  assert.equal(PHASE_MASKS[Spill1Phase.Phase1], PHASE_1_MASKS);
  assert.equal(PHASE_MASKS[Spill1Phase.Phase2], PHASE_2_MASKS);
  assert.equal(PHASE_MASKS[Spill1Phase.Phase3], PHASE_3_MASKS);
  assert.equal(PHASE_MASKS[Spill1Phase.Phase4], PHASE_4_MASKS);
  assert.equal(PHASE_MASKS[Spill1Phase.FullHouse], FULL_HOUSE_MASKS);
});

test("classifyPhaseFromPatternName — norske navn", () => {
  assert.equal(classifyPhaseFromPatternName("1 Rad"), Spill1Phase.Phase1);
  assert.equal(classifyPhaseFromPatternName("2 Rader"), Spill1Phase.Phase2);
  assert.equal(classifyPhaseFromPatternName("3 Rader"), Spill1Phase.Phase3);
  assert.equal(classifyPhaseFromPatternName("4 Rader"), Spill1Phase.Phase4);
  assert.equal(classifyPhaseFromPatternName("Fullt Hus"), Spill1Phase.FullHouse);
});

test("classifyPhaseFromPatternName — engelsk legacy-navn", () => {
  assert.equal(classifyPhaseFromPatternName("Row 1"), Spill1Phase.Phase1);
  assert.equal(classifyPhaseFromPatternName("Row 2"), Spill1Phase.Phase2);
  assert.equal(classifyPhaseFromPatternName("Row 3"), Spill1Phase.Phase3);
  assert.equal(classifyPhaseFromPatternName("Row 4"), Spill1Phase.Phase4);
  assert.equal(classifyPhaseFromPatternName("Full House"), Spill1Phase.FullHouse);
  assert.equal(classifyPhaseFromPatternName("Coverall"), Spill1Phase.FullHouse);
});

test("classifyPhaseFromPatternName — case + whitespace-robust", () => {
  assert.equal(classifyPhaseFromPatternName("  1 rad  "), Spill1Phase.Phase1);
  assert.equal(classifyPhaseFromPatternName("2RADER"), Spill1Phase.Phase2);
  assert.equal(classifyPhaseFromPatternName("fullt hus"), Spill1Phase.FullHouse);
});

test("classifyPhaseFromPatternName — ukjent navn → null", () => {
  assert.equal(classifyPhaseFromPatternName("Stjerne"), null);
  assert.equal(classifyPhaseFromPatternName("Bilde"), null);
  assert.equal(classifyPhaseFromPatternName("Ramme"), null);
  assert.equal(classifyPhaseFromPatternName(""), null);
  assert.equal(classifyPhaseFromPatternName("random"), null);
});

test("popCount25 — edge cases", () => {
  assert.equal(popCount25(0), 0);
  assert.equal(popCount25(PATTERN_MASK_FULL), 25);
  assert.equal(popCount25(0b11111), 5);
});

test("ticketMaskMeetsPhase — Phase1 kun på hel rad eller kolonne", () => {
  // Rad 0 komplett
  assert.equal(ticketMaskMeetsPhase(ROW_MASKS[0], Spill1Phase.Phase1), true);
  // Kol 2 komplett
  assert.equal(ticketMaskMeetsPhase(COLUMN_MASKS[2], Spill1Phase.Phase1), true);
  // 4 bits — ikke en hel linje
  assert.equal(ticketMaskMeetsPhase(0b01111, Spill1Phase.Phase1), false);
});

test("ticketMaskMeetsPhase — Phase2 krever 2 vertikale kolonner", () => {
  // 2 horisontale rader (10 bits, men ikke kolonner) → false
  assert.equal(
    ticketMaskMeetsPhase(ROW_MASKS[0] | ROW_MASKS[1], Spill1Phase.Phase2),
    false,
  );
  // 2 kolonner → true
  assert.equal(
    ticketMaskMeetsPhase(COLUMN_MASKS[0] | COLUMN_MASKS[4], Spill1Phase.Phase2),
    true,
  );
  // 1 kolonne → false
  assert.equal(ticketMaskMeetsPhase(COLUMN_MASKS[0], Spill1Phase.Phase2), false);
});

test("ticketMaskMeetsPhase — FullHouse krever alle 25 bits", () => {
  assert.equal(ticketMaskMeetsPhase(PATTERN_MASK_FULL, Spill1Phase.FullHouse), true);
  assert.equal(ticketMaskMeetsPhase(PATTERN_MASK_FULL ^ 1, Spill1Phase.FullHouse), false);
});

test("remainingBitsForPhase — tom bong", () => {
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase1, 0), 5);
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase2, 0), 10);
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase3, 0), 15);
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase4, 0), 20);
  assert.equal(remainingBitsForPhase(Spill1Phase.FullHouse, 0), 25);
});

test("remainingBitsForPhase — free center markert (bit 12)", () => {
  const ticket = 1 << 12;
  // Phase1 ved kol 2 trenger bare 4 til
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase1, ticket), 4);
});

test("remainingBitsForPhase — full bong = 0 overalt", () => {
  for (const phase of Object.values(Spill1Phase)) {
    assert.equal(remainingBitsForPhase(phase, PATTERN_MASK_FULL), 0);
  }
});
