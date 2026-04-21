/**
 * GAME1_SCHEDULE PR 4c Bolk 1: Tester for Game1PatternEvaluator.
 *
 * Dekker:
 *   - buildTicketMask: 5x5 grid + markings → 25-bit int med centre-free-bit
 *   - evaluatePhase: alle 5 faser, happy-path + nær-miss
 *   - Fase 1 "1 Rad": horisontal ELLER vertikal
 *   - Fase 2-4: N vertikale kolonner (ikke rader, ikke diagonaler).
 *     Merk: norsk databingo Spill 1 navngir fase 2-4 "N Rader" men
 *     geometrien er kolonner — se BingoEngine.ts:1168-1170.
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

// ── evaluatePhase: Fase 2 "2 Rader" (= 2 vertikale kolonner) ────────────────

test("Fase 2: 2 vertikale kolonner → vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markCol(markings, 1);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 2: 2 horisontale rader → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(
    result.isWinner,
    false,
    "fase 2 krever 2 vertikale kolonner, horisontale rader teller ikke"
  );
});

test("Fase 2: 1 vertikal + 1 horisontal → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markRow(markings, 0);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(
    result.isWinner,
    false,
    "fase 2 krever 2 vertikale kolonner, horisontal teller ikke"
  );
});

test("Fase 2: col 0 + col 4 (ikke-tilstøtende) → vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markCol(markings, 4);
  const result = evaluatePhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 2: col 0 markert + centre-free → remaining = 4 (beste kandidat col 0 + col 2)", () => {
  const grid = emptyGrid();
  const markings = markCol(emptyMarkings(), 0);
  // Beste kandidat: col 0 + col 2. Col 0 er komplett, col 2 har idx 12
  // (centre) gratis — mangler idx 2, 7, 17, 22 = 4.
  const remaining = remainingForPhase(grid, markings, PHASE_2_TWO_ROWS);
  assert.equal(remaining, 4);
});

// ── evaluatePhase: Fase 3 "3 Rader" (= 3 vertikale kolonner) ────────────────

test("Fase 3: 3 vertikale kolonner → vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markCol(markings, 2);
  markings = markCol(markings, 4);
  const result = evaluatePhase(grid, markings, PHASE_3_THREE_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 3: 2 vertikale kolonner → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markCol(markings, 1);
  const result = evaluatePhase(grid, markings, PHASE_3_THREE_ROWS);
  assert.equal(result.isWinner, false);
});

test("Fase 3: 3 horisontale rader → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 2);
  markings = markRow(markings, 4);
  const result = evaluatePhase(grid, markings, PHASE_3_THREE_ROWS);
  assert.equal(
    result.isWinner,
    false,
    "fase 3 krever 3 vertikale kolonner, rader teller ikke"
  );
});

// ── evaluatePhase: Fase 4 "4 Rader" (= 4 vertikale kolonner) ────────────────

test("Fase 4: 4 vertikale kolonner → vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markCol(markings, 1);
  markings = markCol(markings, 2);
  markings = markCol(markings, 3);
  const result = evaluatePhase(grid, markings, PHASE_4_FOUR_ROWS);
  assert.equal(result.isWinner, true);
});

test("Fase 4: 3 vertikale kolonner → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markCol(emptyMarkings(), 0);
  markings = markCol(markings, 1);
  markings = markCol(markings, 2);
  const result = evaluatePhase(grid, markings, PHASE_4_FOUR_ROWS);
  assert.equal(result.isWinner, false);
});

test("Fase 4: 4 horisontale rader → IKKE vinner", () => {
  const grid = emptyGrid();
  let markings = markRow(emptyMarkings(), 0);
  markings = markRow(markings, 1);
  markings = markRow(markings, 2);
  markings = markRow(markings, 3);
  const result = evaluatePhase(grid, markings, PHASE_4_FOUR_ROWS);
  assert.equal(
    result.isWinner,
    false,
    "fase 4 krever 4 vertikale kolonner, rader teller ikke"
  );
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

// ── Audit-funn #8 tillegg: edge-case + defensiv semantikk ───────────────────
//
// 5 nye tester som dokumenterer kontrakten for input-validering og
// defensive invariants — slik at Agent 3's Fase 5-konsolidering og senere
// refactors ikke kan bryte stille. Referanse: scope-plan GO fra PM.

test("edge-case: buildTicketMask med markings kortere enn 25 → manglende celler tolkes som umarkerte", () => {
  // Kontrakt i JSDoc: "markings.length må være 25. Kortere → vi bruker det
  // som finnes; manglende celler tolkes som umarkerte." Testen låser denne
  // tolkningen så den ikke kan regresse stille til "kast feil" eller
  // "tolk som markert".
  const grid = emptyGrid();
  const shortMarkings = [true, true, true]; // kun idx 0..2 markert
  const mask = buildTicketMask(grid, shortMarkings);
  // Forventet: idx 0, 1, 2 satt + centre (idx 12) satt, ingen andre.
  assert.equal((mask & 1) !== 0, true, "idx 0 markert");
  assert.equal((mask & 2) !== 0, true, "idx 1 markert");
  assert.equal((mask & 4) !== 0, true, "idx 2 markert");
  assert.equal((mask & (1 << 12)) !== 0, true, "centre alltid markert");
  // Ingen ander bits.
  assert.equal(mask, 1 | 2 | 4 | (1 << 12));
});

test("edge-case: buildTicketMask med markings[12]=false → centre fortsatt satt (defensiv)", () => {
  // JSDoc: "Celle=0 er free centre (idx 12) og teller alltid som markert
  // (selv om markings.marked[12] skulle være false — defensiv semantikk)."
  // Låser at sentrum-bit er grid-drevet, ikke markings-drevet.
  const grid = emptyGrid();
  const markings = new Array(25).fill(false);
  markings[12] = false; // eksplisitt falsk
  const mask = buildTicketMask(grid, markings);
  assert.equal(
    (mask & (1 << 12)) !== 0, true,
    "centre skal være markert uansett markings[12]",
  );
});

test("edge-case: buildTicketMask med null-celler i grid → null teller som vanlig (ikke-centre)", () => {
  // Grid-typen er `(number | null)[]`. null-celler er ikke centre (kun 0
  // er centre), så de trenger eksplisitt markings for å telle.
  const grid: Array<number | null> = new Array(25).fill(1);
  grid[12] = 0; // centre
  grid[3] = null; // umarkert null-celle
  const markings = new Array(25).fill(false);
  const mask = buildTicketMask(grid, markings);
  // Kun centre satt — null-celle ved idx 3 skal IKKE være auto-markert.
  assert.equal(mask, 1 << 12, "null-celle != 0 → ikke auto-markert");

  // Nå marker idx 3 eksplisitt — skal da settes.
  markings[3] = true;
  const mask2 = buildTicketMask(grid, markings);
  assert.equal(
    (mask2 & (1 << 3)) !== 0, true,
    "null-celle med eksplisitt marking=true skal settes",
  );
});

test("edge-case: evaluatePhase med ugyldig fase (0, 6, -1, NaN) → isWinner=false", () => {
  // masksForPhase returnerer [] for ukjente faser, og evaluatePhase
  // returnerer {false, null} når candidates er tom. Låser denne
  // fail-closed-semantikken for alle "ugyldige" input — spesielt viktig
  // siden fase-nummer kommer fra DB-queries som kan inneholde rusk.
  const grid = emptyGrid();
  const markings = new Array(25).fill(true);
  for (const bad of [0, 6, -1, 99, Number.NaN]) {
    const result = evaluatePhase(grid, markings, bad);
    assert.equal(
      result.isWinner, false,
      `fase=${bad}: skal aldri returnere isWinner=true`,
    );
    assert.equal(result.matchedMask, null);
  }
});

test("edge-case: remainingForPhase returnerer Infinity for ugyldig fase", () => {
  // Unik kontrakt — Infinity signaliserer "ingen kandidat", brukes av
  // kall-steder som "igjen"-tellere så UI ikke viser tall som "0" feilaktig.
  const grid = emptyGrid();
  const markings = new Array(25).fill(true);
  for (const bad of [0, 6, -1, 99]) {
    const remaining = remainingForPhase(grid, markings, bad);
    assert.equal(
      remaining, Infinity,
      `fase=${bad}: remaining skal være Infinity (ingen kandidat-masks)`,
    );
  }
});
