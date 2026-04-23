/**
 * @vitest-environment happy-dom
 *
 * PatternMiniGrid — verifiserer at mini-gridet tegner samme geometri som
 * backend belønner i `BingoEngine.meetsPhaseRequirement`:
 *   - fase 1 ("1 Rad") → rad ELLER kolonne (10 enkeltlinjer)
 *   - fase 2-4 ("N Rader") → N vertikale kolonner — IKKE horisontale rader
 */
import { describe, it, expect } from "vitest";
import { PatternMiniGrid } from "./PatternMiniGrid.js";

// 2026-04-23 redesign: fill is now a linear-gradient (yellow → orange) per
// mockup `.bingo-cell.hit`. Detect "hit" cells via any substring that only
// appears on the filled variant — we use the unique gradient keyword.
const FILL_BG_KEYWORD = "linear-gradient";
const CENTER_INDEX = 12;
const GRID_SIZE = 5;

type Line = { axis: "row" | "col"; index: number };

interface MiniGridInternals {
  cells: HTMLDivElement[];
  getPhaseCombinations(phase: number): Line[][];
  highlightLines(lines: Line[]): void;
  destroy(): void;
}

function asInternals(grid: PatternMiniGrid): MiniGridInternals {
  return grid as unknown as MiniGridInternals;
}

function filledCellIndices(cells: HTMLDivElement[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].style.background.includes(FILL_BG_KEYWORD)) out.push(i);
  }
  return out;
}

function colCellIndices(col: number): number[] {
  return [0, 1, 2, 3, 4].map((r) => r * GRID_SIZE + col);
}

function rowCellIndices(row: number): number[] {
  return [0, 1, 2, 3, 4].map((c) => row * GRID_SIZE + c);
}

// ── Fase 1: rad eller kolonne ───────────────────────────────────────────────

describe("PatternMiniGrid — fase 1 (rad ELLER kolonne)", () => {
  it("genererer 10 kombinasjoner: 5 rader + 5 kolonner", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getPhaseCombinations(1);
    expect(combos.length).toBe(10);
    // Første 5 = rader, siste 5 = kolonner.
    for (let r = 0; r < 5; r++) expect(combos[r]).toEqual([{ axis: "row", index: r }]);
    for (let c = 0; c < 5; c++) expect(combos[5 + c]).toEqual([{ axis: "col", index: c }]);
    grid.destroy();
  });

  it("rad-combinasjon fyller hele raden (minus center hvis rad 2)", () => {
    const grid = asInternals(new PatternMiniGrid());
    grid.highlightLines([{ axis: "row", index: 0 }]);
    expect(filledCellIndices(grid.cells)).toEqual(rowCellIndices(0));

    grid.highlightLines([{ axis: "row", index: 2 }]);
    // Rad 2 krysser center → 4 celler
    expect(filledCellIndices(grid.cells)).toEqual(rowCellIndices(2).filter((i) => i !== CENTER_INDEX));
    grid.destroy();
  });

  it("kolonne-combinasjon fyller hele kolonnen (minus center hvis kol 2)", () => {
    const grid = asInternals(new PatternMiniGrid());
    grid.highlightLines([{ axis: "col", index: 0 }]);
    expect(filledCellIndices(grid.cells)).toEqual(colCellIndices(0));

    grid.highlightLines([{ axis: "col", index: 2 }]);
    expect(filledCellIndices(grid.cells)).toEqual(colCellIndices(2).filter((i) => i !== CENTER_INDEX));
    grid.destroy();
  });
});

// ── Fase 2-4: kun vertikale kolonner ────────────────────────────────────────

describe("PatternMiniGrid — fase 2-4 bruker KUN vertikale kolonner", () => {
  it("fase 2 → C(5,2) = 10 kolonne-par", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getPhaseCombinations(2);
    expect(combos.length).toBe(10);
    for (const combo of combos) {
      expect(combo.length).toBe(2);
      for (const line of combo) {
        expect(line.axis).toBe("col");
      }
    }
    grid.destroy();
  });

  it("fase 3 → C(5,3) = 10 kolonne-tripler", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getPhaseCombinations(3);
    expect(combos.length).toBe(10);
    for (const combo of combos) {
      expect(combo.length).toBe(3);
      for (const line of combo) expect(line.axis).toBe("col");
    }
    grid.destroy();
  });

  it("fase 4 → C(5,4) = 5 kolonne-firere", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getPhaseCombinations(4);
    expect(combos.length).toBe(5);
    for (const combo of combos) {
      expect(combo.length).toBe(4);
      for (const line of combo) expect(line.axis).toBe("col");
    }
    grid.destroy();
  });

  it("fase 2-kombinasjon fyller nøyaktig 2 kolonner (10 celler, 9 hvis kol 2 er med)", () => {
    const grid = asInternals(new PatternMiniGrid());
    // Kol 0 + kol 1 — ingen krysser center
    grid.highlightLines([
      { axis: "col", index: 0 },
      { axis: "col", index: 1 },
    ]);
    expect(filledCellIndices(grid.cells).length).toBe(10);
    expect(grid.cells[CENTER_INDEX].style.background.includes(FILL_BG_KEYWORD)).toBe(false);

    // Kol 0 + kol 2 — kol 2 krysser center
    grid.highlightLines([
      { axis: "col", index: 0 },
      { axis: "col", index: 2 },
    ]);
    expect(filledCellIndices(grid.cells).length).toBe(9);
    expect(grid.cells[CENTER_INDEX].style.background.includes(FILL_BG_KEYWORD)).toBe(false);
    grid.destroy();
  });

  it("fase 4-kombinasjon fyller 4 kolonner; den utelatte kolonnen er tom", () => {
    const grid = asInternals(new PatternMiniGrid());
    const combos = grid.getPhaseCombinations(4);
    for (const combo of combos) {
      grid.highlightLines(combo);
      const usedCols = new Set(combo.map((l) => l.index));
      const missingCol = [0, 1, 2, 3, 4].find((c) => !usedCols.has(c))!;
      for (const idx of colCellIndices(missingCol)) {
        expect(grid.cells[idx].style.background.includes(FILL_BG_KEYWORD)).toBe(false);
      }
    }
    grid.destroy();
  });

  it("center-cellen (bit 12) fylles aldri for noen fase", () => {
    const grid = asInternals(new PatternMiniGrid());
    for (const phase of [1, 2, 3, 4]) {
      for (const combo of grid.getPhaseCombinations(phase)) {
        grid.highlightLines(combo);
        expect(grid.cells[CENTER_INDEX].style.background.includes(FILL_BG_KEYWORD)).toBe(false);
      }
    }
    grid.destroy();
  });
});

// ── Guardrails ──────────────────────────────────────────────────────────────

describe("PatternMiniGrid — edge cases", () => {
  it("ukjent design (≥5) clearer gridet", () => {
    const grid = new PatternMiniGrid();
    const internals = asInternals(grid);
    internals.highlightLines([{ axis: "row", index: 0 }]); // farg noe
    grid.setDesign(99);
    expect(filledCellIndices(internals.cells)).toEqual([]);
    grid.destroy();
  });

  it("design 0 med tom mask gir ingen highlight", () => {
    const grid = new PatternMiniGrid();
    grid.setDesign(0, []);
    expect(filledCellIndices(asInternals(grid).cells)).toEqual([]);
    grid.destroy();
  });

  it("design 0 med 25-cellers mask highlighter fylte celler minus center", () => {
    const grid = new PatternMiniGrid();
    const mask = new Array(25).fill(1);
    grid.setDesign(0, mask);
    const filled = filledCellIndices(asInternals(grid).cells);
    expect(filled.length).toBe(24);
    expect(filled).not.toContain(CENTER_INDEX);
    grid.destroy();
  });

  it("fase > 4 gir ingen kombinasjoner (og clearer gridet)", () => {
    const grid = asInternals(new PatternMiniGrid());
    expect(grid.getPhaseCombinations(5)).toEqual([]);
    expect(grid.getPhaseCombinations(0)).toEqual([]);
    grid.destroy();
  });
});
