/**
 * BIN-694: countCompleteRows + countCompleteColumns + countCompleteLines.
 *
 * Norsk 75-ball bingo (avklart av Tobias 2026-04-20): kun horisontale
 * rader og vertikale kolonner teller — INGEN diagonaler.
 *
 *   - 5 horisontale rader
 *   - 5 vertikale kolonner
 *   - 0 diagonaler (fjernet fra tidligere implementasjon)
 *
 * Fase-modell krever separate telle-kilder:
 *   - Fase 1 ("1 Rad"): rows ≥ 1 || cols ≥ 1
 *   - Fase 2-4 ("2/3/4 Rader"): cols ≥ N (kun vertikale)
 *   - Fase 5 ("Fullt Hus"): alle 25 felt
 *
 * Gratis-feltet (grid[2][2] === 0) teller alltid som merket.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { countCompleteLines, countCompleteRows, countCompleteColumns } from "./ticket.js";
import type { Ticket } from "./types.js";

function make5x5(): Ticket {
  // Bingo75 layout: kolonner 1-15, 16-30, 31-45, 46-60, 61-75. Free = (2,2).
  return {
    grid: [
      [1, 16, 31, 46, 61],
      [2, 17, 32, 47, 62],
      [3, 18, 0, 48, 63],
      [4, 19, 33, 49, 64],
      [5, 20, 34, 50, 65],
    ],
  };
}

test("tom brett: 0 komplette linjer", () => {
  assert.equal(countCompleteLines(make5x5(), new Set()), 0);
});

test("én hel horisontal rad (row 0) → 1 linje", () => {
  const marks = new Set([1, 16, 31, 46, 61]);
  assert.equal(countCompleteLines(make5x5(), marks), 1);
});

test("én hel vertikal kolonne (col 0) → 1 linje", () => {
  const marks = new Set([1, 2, 3, 4, 5]);
  assert.equal(countCompleteLines(make5x5(), marks), 1);
});

test("hoveddiagonal merket — teller IKKE (ingen diagonaler i norsk bingo)", () => {
  // Diagonal: (0,0)=1, (1,1)=17, (2,2)=0 (free), (3,3)=49, (4,4)=65
  const marks = new Set([1, 17, 49, 65]);
  assert.equal(countCompleteLines(make5x5(), marks), 0, "diagonal skal IKKE telle");
  assert.equal(countCompleteRows(make5x5(), marks), 0);
  assert.equal(countCompleteColumns(make5x5(), marks), 0);
});

test("motdiagonal merket — teller IKKE", () => {
  const marks = new Set([61, 47, 19, 5]);
  assert.equal(countCompleteLines(make5x5(), marks), 0);
});

test("rad 0 + kolonne 0 krysser — cellen (0,0) delt → 2 linjer", () => {
  const marks = new Set([1, 16, 31, 46, 61, 2, 3, 4, 5]);
  assert.equal(countCompleteLines(make5x5(), marks), 2);
});

test("begge diagonaler merket samtidig — teller ikke", () => {
  const marks = new Set([1, 17, 49, 65, 61, 47, 19, 5]);
  assert.equal(countCompleteLines(make5x5(), marks), 0);
});

test("fullt hus: alle 25 cellene merket → 10 linjer (5 rader + 5 kolonner, INGEN diagonaler)", () => {
  const marks = new Set<number>();
  for (const row of make5x5().grid) {
    for (const n of row) if (n !== 0) marks.add(n);
  }
  assert.equal(countCompleteLines(make5x5(), marks), 10, "5 rader + 5 kolonner = 10");
  assert.equal(countCompleteRows(make5x5(), marks), 5);
  assert.equal(countCompleteColumns(make5x5(), marks), 5);
});

test("free-feltet teller alltid som merket (i midt-raden + midt-kolonnen)", () => {
  // Hel rad 2 (gjennom free): 3, 18, 0=free, 48, 63 → bruker trenger 3, 18, 48, 63
  const marks = new Set([3, 18, 48, 63]);
  assert.equal(countCompleteRows(make5x5(), marks), 1, "rad 2 kompletteres med free");
});

test("BIN-694 fase 1 regresjon: hel kolonne teller som 1 linje (for fase 1 kan være kolonne ELLER rad)", () => {
  const marks = new Set([1, 2, 3, 4, 5]); // kol 0
  assert.equal(countCompleteColumns(make5x5(), marks), 1);
  assert.equal(countCompleteRows(make5x5(), marks), 0);
  assert.equal(countCompleteLines(make5x5(), marks), 1);
});

test("BIN-694 fase 2 regresjon: 2 horisontale rader gir 0 kolonner (fase 2 krever kolonner)", () => {
  // Rad 0 + rad 1 merket
  const marks = new Set([
    1, 16, 31, 46, 61,  // rad 0
    2, 17, 32, 47, 62,  // rad 1
  ]);
  assert.equal(countCompleteRows(make5x5(), marks), 2);
  assert.equal(countCompleteColumns(make5x5(), marks), 0, "ingen hele kolonner enda");
});

test("3×5-brett (Databingo60): 3 rader + 5 kolonner = 8 mulige (uendret — ingen diagonaler)", () => {
  const ticket: Ticket = {
    grid: [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
    ],
  };
  // Merk hele rad 0 — 1 linje (ingen diagonal siden ikke square)
  assert.equal(countCompleteLines(ticket, new Set([1, 2, 3, 4, 5])), 1);
  // Merk hele brett — 3 rader + 5 kolonner = 8
  const all = new Set<number>();
  for (let n = 1; n <= 15; n += 1) all.add(n);
  assert.equal(countCompleteLines(ticket, all), 8);
});

test("kombinasjon: rad 0 + kolonne 0 krysser — 2 linjer totalt (ingen diagonaler teller)", () => {
  const marks = new Set([1, 16, 31, 46, 61, 2, 3, 4, 5]); // rad 0 + kol 0
  assert.equal(countCompleteRows(make5x5(), marks), 1);
  assert.equal(countCompleteColumns(make5x5(), marks), 1);
  assert.equal(countCompleteLines(make5x5(), marks), 2);
});
