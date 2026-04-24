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
  buildTicketMaskFromGrid5x5,
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

test("PHASE_2_MASKS — C(5,2) = 10 rad-par, hver 10 bits", () => {
  assert.equal(PHASE_2_MASKS.length, 10);
  for (const m of PHASE_2_MASKS) assert.equal(popCount25(m), 10);
});

test("PHASE_3_MASKS — C(5,3) = 10 rad-trippel, hver 15 bits", () => {
  assert.equal(PHASE_3_MASKS.length, 10);
  for (const m of PHASE_3_MASKS) assert.equal(popCount25(m), 15);
});

test("PHASE_4_MASKS — C(5,4) = 5 rad-kvartetter, hver 20 bits", () => {
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

test("ticketMaskMeetsPhase — Phase2 krever 2 horisontale rader", () => {
  // 2 vertikale kolonner (10 bits, men ikke rader) → false
  assert.equal(
    ticketMaskMeetsPhase(COLUMN_MASKS[0] | COLUMN_MASKS[4], Spill1Phase.Phase2),
    false,
  );
  // 2 rader → true
  assert.equal(
    ticketMaskMeetsPhase(ROW_MASKS[0] | ROW_MASKS[1], Spill1Phase.Phase2),
    true,
  );
  // 1 rad → false
  assert.equal(ticketMaskMeetsPhase(ROW_MASKS[0], Spill1Phase.Phase2), false);
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

// ── buildTicketMaskFromGrid5x5 (delt backend+klient adapter-helper) ─────────

const STANDARD_GRID: number[][] = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63], // free center ved (2,2)
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

test("buildTicketMaskFromGrid5x5 — tomt mark-sett → kun free center", () => {
  const mask = buildTicketMaskFromGrid5x5(STANDARD_GRID, new Set());
  assert.equal(mask, 1 << 12);
});

test("buildTicketMaskFromGrid5x5 — full rad 0 markert", () => {
  const mask = buildTicketMaskFromGrid5x5(STANDARD_GRID, new Set([1, 16, 31, 46, 61]));
  assert.equal(mask, ROW_MASKS[0] | (1 << 12));
});

test("buildTicketMaskFromGrid5x5 — full kolonne 0", () => {
  const mask = buildTicketMaskFromGrid5x5(STANDARD_GRID, new Set([1, 2, 3, 4, 5]));
  assert.equal(mask, COLUMN_MASKS[0] | (1 << 12));
});

test("buildTicketMaskFromGrid5x5 — full bingo", () => {
  const all = new Set<number>();
  for (const row of STANDARD_GRID) for (const n of row) if (n !== 0) all.add(n);
  assert.equal(buildTicketMaskFromGrid5x5(STANDARD_GRID, all), PATTERN_MASK_FULL);
});

test("buildTicketMaskFromGrid5x5 — ikke-5×5 grid → null", () => {
  assert.equal(buildTicketMaskFromGrid5x5([[1, 2, 3]], new Set()), null);
  assert.equal(buildTicketMaskFromGrid5x5([], new Set()), null);
  // 5 rader men én for kort
  const malformed = [...STANDARD_GRID];
  malformed[3] = [1, 2, 3];
  assert.equal(buildTicketMaskFromGrid5x5(malformed, new Set()), null);
});

// ── Wire-kompat-kontrakt: ticketMaskMeetsPhase ⟺ remainingBitsForPhase===0 ──

test("wire-kompat: ticketMaskMeetsPhase ⟺ remainingBitsForPhase === 0 (parameterisert)", () => {
  // En rekke test-masker som dekker edge-cases: tom, fase-spesifikke,
  // mix av rader+kolonner, full house. For hver fase skal
  // `ticketMaskMeetsPhase(mask, phase)` returnere nøyaktig det samme som
  // `remainingBitsForPhase(phase, mask) === 0`. Denne ekvivalens-kontrakten
  // er hva backend `meetsPhaseRequirement` og klient `remainingForPattern`
  // begge baserer seg på — drift her ville splitte server/klient-oppførsel.
  const testMasks: { label: string; mask: number }[] = [
    { label: "tom", mask: 0 },
    { label: "kun free center", mask: 1 << 12 },
    { label: "rad 0", mask: ROW_MASKS[0] },
    { label: "kol 0", mask: COLUMN_MASKS[0] },
    { label: "rad 0 + kol 0", mask: ROW_MASKS[0] | COLUMN_MASKS[0] },
    { label: "2 kolonner", mask: COLUMN_MASKS[0] | COLUMN_MASKS[1] },
    { label: "3 kolonner", mask: COLUMN_MASKS[0] | COLUMN_MASKS[1] | COLUMN_MASKS[2] },
    { label: "4 kolonner", mask: COLUMN_MASKS[0] | COLUMN_MASKS[1] | COLUMN_MASKS[2] | COLUMN_MASKS[3] },
    { label: "4 rader (ikke kolonner)", mask: ROW_MASKS[0] | ROW_MASKS[1] | ROW_MASKS[2] | ROW_MASKS[3] },
    { label: "full house minus 1", mask: PATTERN_MASK_FULL ^ 1 },
    { label: "full house", mask: PATTERN_MASK_FULL },
  ];
  for (const { label, mask } of testMasks) {
    for (const phase of Object.values(Spill1Phase)) {
      const meets = ticketMaskMeetsPhase(mask, phase);
      const remaining = remainingBitsForPhase(phase, mask);
      assert.equal(
        meets,
        remaining === 0,
        `drift for phase=${phase}, mask=${label}: meets=${meets}, remaining=${remaining}`,
      );
    }
  }
});

test("wire-kompat: fase 2 godtar 2 rader men IKKE 2 kolonner", () => {
  // Regel-endring 2026-04-24 (Tobias): fase 2/3/4 er horisontale rader,
  // ikke vertikale kolonner. Delt kilde med klient via PHASE_2_MASKS.
  const twoRows = ROW_MASKS[0] | ROW_MASKS[1];
  const twoCols = COLUMN_MASKS[0] | COLUMN_MASKS[1];
  assert.equal(ticketMaskMeetsPhase(twoRows, Spill1Phase.Phase2), true);
  assert.equal(ticketMaskMeetsPhase(twoCols, Spill1Phase.Phase2), false);
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase2, twoRows), 0);
  assert.equal(remainingBitsForPhase(Spill1Phase.Phase2, twoCols) > 0, true);
});
