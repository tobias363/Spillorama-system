/**
 * @vitest-environment happy-dom
 *
 * PatternMiniGrid cycle tests (PR-5 C1 — Design-4 verify).
 *
 * Unity parity: PrefabBingoGame1Pattern.Four_Row_Animation (PrefabBingoGame1Pattern.cs:237-261)
 * iterates `i` from 4 down to 0, each frame filling all 25 cells (minus
 * centre-12) and then UNSETTING row `i`. So the sequence of "missing"
 * rows is 4 → 3 → 2 → 1 → 0, and each displayed frame has exactly one
 * row of empty cells.
 *
 * Web port: PatternMiniGrid.getRowCombinations(4) returns C(5,4) = 5
 * combinations of 4 rows that are *kept* highlighted. The missing row
 * per combination is the one NOT in the list:
 *   [0,1,2,3] → missing 4
 *   [0,1,2,4] → missing 3
 *   [0,1,3,4] → missing 2
 *   [0,2,3,4] → missing 1
 *   [1,2,3,4] → missing 0
 * This matches Unity's 4→0 order.
 */
import { describe, it, expect } from "vitest";
import { PatternMiniGrid } from "./PatternMiniGrid.js";

const FILL_COLOR = "#ffe83d";
const CENTER_INDEX = 12;
const GRID_SIZE = 5;

interface MiniGridInternals {
  cells: HTMLDivElement[];
  getRowCombinations(count: number): number[][];
  highlightRows(indices: number[]): void;
  destroy(): void;
}

/** Test helper: access private methods for unit-level verification. */
function asInternals(grid: PatternMiniGrid): MiniGridInternals {
  return grid as unknown as MiniGridInternals;
}

function filledCellIndices(cells: HTMLDivElement[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].style.background === FILL_COLOR) out.push(i);
  }
  return out;
}

describe("PatternMiniGrid — Design-4 Four-row animation (Unity parity)", () => {
  it("getRowCombinations(4) returns the 5 combinations in Unity order (unsatt rad 4→0)", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getRowCombinations(4);
    expect(combos).toEqual([
      [0, 1, 2, 3], // unsatt = 4
      [0, 1, 2, 4], // unsatt = 3
      [0, 1, 3, 4], // unsatt = 2
      [0, 2, 3, 4], // unsatt = 1
      [1, 2, 3, 4], // unsatt = 0
    ]);
    grid.destroy();
  });

  it("each combination fills exactly 4 rows × 5 cols minus centre (19 cells)", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getRowCombinations(4);

    for (const combo of combos) {
      grid.highlightRows(combo);
      const filled = filledCellIndices(grid.cells);
      // 4 rows × 5 cols = 20 cells, minus centre if centre row is in combo.
      const centerRow = Math.floor(CENTER_INDEX / GRID_SIZE);
      const expectedCount = combo.includes(centerRow) ? 19 : 20;
      expect(filled.length).toBe(expectedCount);

      // The "missing" row (0..4) NOT in combo should have zero filled cells.
      const missingRow = [0, 1, 2, 3, 4].find((r) => !combo.includes(r))!;
      for (let c = 0; c < GRID_SIZE; c++) {
        const idx = missingRow * GRID_SIZE + c;
        expect(grid.cells[idx].style.background).not.toBe(FILL_COLOR);
      }
    }
    grid.destroy();
  });

  it("never fills the centre cell (index 12 is always the free space)", () => {
    const grid = asInternals(new PatternMiniGrid());
    for (const combo of grid.getRowCombinations(4)) {
      grid.highlightRows(combo);
      expect(grid.cells[CENTER_INDEX].style.background).not.toBe(FILL_COLOR);
    }
    grid.destroy();
  });
});

describe("PatternMiniGrid — Design 1-3 row combinations (regression)", () => {
  it("Design 1 cycles 5 rows then 5 columns (10 steps total)", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getRowCombinations(1);
    expect(combos.length).toBe(10);
    // First 5 are row indices, last 5 are column indices (negative).
    for (let i = 0; i < 5; i++) expect(combos[i]).toEqual([i]);
    for (let i = 0; i < 5; i++) expect(combos[5 + i]).toEqual([-(i + 1)]);
    grid.destroy();
  });

  it("Design 2 generates C(5,2) = 10 row pairs", () => {
    const grid = asInternals(new PatternMiniGrid());
    expect(grid.getRowCombinations(2).length).toBe(10);
    grid.destroy();
  });

  it("Design 3 generates C(5,3) = 10 row triples", () => {
    const grid = asInternals(new PatternMiniGrid());
    expect(grid.getRowCombinations(3).length).toBe(10);
    grid.destroy();
  });
});
