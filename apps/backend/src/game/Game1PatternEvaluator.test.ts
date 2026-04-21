/**
 * GAME1_SCHEDULE PR 4c Bolk 1: Tester for Game1PatternEvaluator.
 *
 * Dekker:
 *   - buildTicketMask: 5x5 grid + markings → 25-bit int med centre-free-bit
 *   - evaluatePhase: alle 5 faser, happy-path + nær-miss
 *   - Fase 1 "1 Rad": horisontal ELLER vertikal
 *   - Fase 2-4: N horisontale rader (ikke vertikal, ikke diagonaler)
 *   - Fase 5 "Fullt Hus": alle 25 bits
 *   - remainingForPhase: "igjen"-semantikk
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTicketMask,
  evaluatePhase,
  remainingForPhase,
  masksForPhase,
  PHASE_1_ONE_ROW,
  PHASE_2_TWO_ROWS,
  PHASE_3_THREE_ROWS,
  PHASE_4_FOUR_ROWS,
  PHASE_5_FULL_HOUSE,
  FULL_HOUSE_MASK,
  TOTAL_PHASES,
} from "./Game1PatternEvaluator.js";

// ── Test-helpers ─────────────────────────────────────────────────────────────

/** Lag et 5x5 grid med free centre på idx 12. */
function gridFromArr(nums: Array<number | null>): Array<number | null> {
  assert.equal(nums.length, 25, "helper krever 25-celle input");
  return nums;
}

/** Marker alle cellene i row-index `r` i markings-arrayet. */
function markRow(markings: boolean[], r: number): boolean[] {
  const out = markings.slice();
  for (let c = 0; c < 5; c++) out[r * 5 + c] = true;
  return out;
}

/** Marker alle cellene i col-index `c` i markings-arrayet. */
function markCol(markings: boolean[], c: number): boolean[] {
  const out = markings.slice();
  for (let r = 0; r < 5; r++) out[r * 5 + c] = true;
  return out;
}

function emptyMarkings(): boolean[] {
  return new Array(25).fill(false);
}

function emptyGrid(): Array<number | null> {
  const g: Array<number | null> = [];
  for (let i = 0; i < 25; i++) g.push(i === 12 ? 0 : i + 1);
  return g;
}

// ── Sanity constants ────────────────────────────────────────────────────────

test("TOTAL_PHASES = 5", () => {
  assert.equal(TOTAL_PHASES, 5);
});

test("FULL_HOUSE_MASK har 25 bits satt", () => {
  let count = 0;
  let m = FULL_HOUSE_MASK;
  while (m !== 0) {
    count += m & 1;
    m >>>= 1;
  }
  assert.equal(count, 25);
});

test("masksForPhase returnerer riktig antall pr fase", () => {
  assert.equal(masksForPhase(PHASE_1_ONE_ROW).length, 10, "5 rader + 5 kolonner");
  assert.equal(masksForPhase(PHASE_2_TWO_ROWS).length, 10, "C(5,2)");
  assert.equal(masksForPhase(PHASE_3_THREE_ROWS).length, 10, "C(5,3)");
  assert.equal(masksForPhase(PHASE_4_FOUR_ROWS).length, 5, "C(5,4)");
  assert.equal(masksForPhase(PHASE_5_FULL_HOUSE).length, 1);
  assert.equal(masksForPhase(99).length, 0, "ukjent fase");
});

// ── buildTicketMask ─────────────────────────────────────────────────────────

test("buildTicketMask: free centre (idx 12) er alltid satt uansett markings", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  const mask = buildTicketMask(grid, markings);
  assert.equal(
    (mask & (1 << 12)) !== 0,
    true,
    "bit 12 (centre) skal være satt"
  );
  // Alle andre bits skal være 0.
  assert.equal(mask, 1 << 12);
});

test("buildTicketMask: returnerer 0 for ugyldig grid-lengde", () => {
  const grid: Array<number | null> = [1, 2, 3];
  assert.equal(buildTicketMask(grid, []), 0);
});

test("buildTicketMask: markings kombineres med free centre", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  markings[0] = true;
  markings[1] = true;
  const mask = buildTicketMask(grid, markings);
  assert.equal((mask & 1) !== 0, true);
  assert.equal((mask & 2) !== 0, true);
  assert.equal((mask & (1 << 12)) !== 0, true);
});

// ── evaluatePhase: Fase 1 "1 Rad" ───────────────────────────────────────────

test("Fase 1: hel horisontal rad 0 → vinner", () => {
  const grid = emptyGrid();
  const markings = markRow(emptyMarkings(), 0);
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, true);
  assert.ok(result.matchedMask !== null);
});

test("Fase 1: hel horisontal rad 2 (med centre-free) → vinner", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  // Marker idx 10, 11, 13, 14 (rad 2 minus centre). Centre kommer gratis.
  markings[10] = true;
  markings[11] = true;
  markings[13] = true;
  markings[14] = true;
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, true);
});

test("Fase 1: hel vertikal kolonne 0 → vinner", () => {
  const grid = emptyGrid();
  const markings = markCol(emptyMarkings(), 0);
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, true);
});

test("Fase 1: hel vertikal kolonne 2 (med centre-free) → vinner", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  // Marker idx 2, 7, 17, 22 (col 2 minus centre).
  markings[2] = true;
  markings[7] = true;
  markings[17] = true;
  markings[22] = true;
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, true);
});

test("Fase 1: 4 markerte i rad 0 → ikke vinner, remaining=1", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  markings[0] = true;
  markings[1] = true;
  markings[2] = true;
  markings[3] = true;
  // markings[4] umarkert.
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, false);
  const remaining = remainingForPhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(remaining, 1);
});

test("Fase 1: diagonal (0, 6, 12, 18, 24) → IKKE vinner (kun rad + kolonne)", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  markings[0] = true;
  markings[6] = true;
  // 12 = centre, gratis
  markings[18] = true;
  markings[24] = true;
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, false, "diagonal teller ikke i Spill 1");
});

// ── evaluatePhase: Fase 2 "2 Rader" ─────────────────────────────────────────

test("Fase 2: 2 horisontale rader → vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 2: 1 horisontal + 1 vertikal kolonne → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markCol(markings, 0);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(
    result.isWinner,
    false,
    "fase 2 krever 2 horisontale rader, vertikal teller ikke"
  );
});

test("Fase 2: rad 0 + rad 4 (ikke-tilstøtende) → vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 4);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 2: rad 0 markert + centre-free → remaining = 4 (beste kandidat rad 0 + rad 2)", () => {
  const grid = emptyGrid();
  const markings = markRow(emptyMarkings(), 0);
  // Beste kandidat: rad 0 + rad 2. Rad 0 er komplett, rad 2 har idx 12
  // (centre) gratis — mangler idx 10, 11, 13, 14 = 4.
  const remaining = remainingForPhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(remaining, 4);
});

// ── evaluatePhase: Fase 3 "3 Rader" ─────────────────────────────────────────

test("Fase 3: 3 horisontale rader → vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 2);
  markings = markRow(markings, 4);
  const result = evaluatePhase(grid, markings, PHASE_3_THREE_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 3: 2 horisontale rader → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  const result = evaluatePhase(grid, markings, PHASE_3_THREE_ROWS);
  assert.equal(result.isWinner, false);
});

// ── evaluatePhase: Fase 4 "4 Rader" ─────────────────────────────────────────

test("Fase 4: 4 horisontale rader → vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  markings = markRow(markings, 2);
  markings = markRow(markings, 3);
  const result = evaluatePhase(grid, markings, PHASE_4_FOUR_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 4: 3 horisontale rader → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  markings = markRow(markings, 2);
  const result = evaluatePhase(grid, markings, PHASE_4_FOUR_ROWS);
  assert.equal(result.isWinner, false);
});

// ── evaluatePhase: Fase 5 "Fullt Hus" ───────────────────────────────────────

test("Fase 5: alle 25 markert (incl. centre-free) → vinner", () => {
  const grid = emptyGrid();
  const markings = new Array(25).fill(true);
  const result = evaluatePhase(grid, markings, PHASE_5_FULL_HOUSE);
  assert.equal(result.isWinner, true);
  assert.equal(result.matchedMask, FULL_HOUSE_MASK);
});

test("Fase 5: 4 rader markert, rad 4 gjenstår → IKKE vinner, remaining=5", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  markings = markRow(markings, 2);
  markings = markRow(markings, 3);
  const result = evaluatePhase(grid, markings, PHASE_5_FULL_HOUSE);
  assert.equal(result.isWinner, false);
  const remaining = remainingForPhase(grid, markings, PHASE_5_FULL_HOUSE);
  assert.equal(remaining, 5);
});

test("Fase 5: alle untatt 1 markert → remaining=1", () => {
  const grid = emptyGrid();
  const markings = new Array(25).fill(true);
  markings[7] = false;
  const remaining = remainingForPhase(grid, markings, PHASE_5_FULL_HOUSE);
  assert.equal(remaining, 1);
});

// ── Kryssjekk mot legacy-cases ─────────────────────────────────────────────

test("legacy cross-check: rad 2 med kun centre-free → ikke vinner fase 1", () => {
  // Rad 2 celler: 10, 11, 12(free), 13, 14. Kun 12 markert.
  const grid = emptyGrid();
  const markings = emptyMarkings();
  // Ingen eksplisitt markings — kun free centre.
  const result = evaluatePhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(result.isWinner, false);
  const remaining = remainingForPhase(grid, markings, PHASE_1_ONE_ROW);
  assert.equal(
    remaining,
    4,
    "rad 2 trenger 4 til (10, 11, 13, 14) — sentrum teller"
  );
});

test("legacy cross-check: col 2 med kun centre-free → remaining = 4", () => {
  const grid = emptyGrid();
  const markings = emptyMarkings();
  const remaining = remainingForPhase(grid, markings, PHASE_1_ONE_ROW);
  // Best kandidat er rad 2 eller col 2 — begge trenger 4.
  assert.equal(remaining, 4);
});
