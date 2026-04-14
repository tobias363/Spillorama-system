import { describe, it, expect } from "vitest";
import { hasAnyCompleteLine, hasFullBingo, checkClaims } from "./ClaimDetector.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a 3x5 grid with sequential numbers starting at `start`. */
function make3x5(start = 1): number[][] {
  return [
    [start, start + 1, start + 2, start + 3, start + 4],
    [start + 5, start + 6, start + 7, start + 8, start + 9],
    [start + 10, start + 11, start + 12, start + 13, start + 14],
  ];
}

/** Create a 5x5 grid with free space at center (index [2][2] = 0). */
function make5x5(start = 1): number[][] {
  let n = start;
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    const row: number[] = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        row.push(0); // free space
      } else {
        row.push(n++);
      }
    }
    grid.push(row);
  }
  return grid;
}

// ── hasAnyCompleteLine ──────────────────────────────────────────────────────

describe("hasAnyCompleteLine", () => {
  describe("3x5 grid", () => {
    it("returns false when no numbers are marked", () => {
      const grid = make3x5();
      expect(hasAnyCompleteLine(grid, new Set())).toBe(false);
    });

    it("detects a complete row", () => {
      const grid = make3x5();
      // Mark entire first row: 1,2,3,4,5
      const marks = new Set([1, 2, 3, 4, 5]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("detects a complete middle row", () => {
      const grid = make3x5();
      // Mark entire second row: 6,7,8,9,10
      const marks = new Set([6, 7, 8, 9, 10]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("detects a complete column", () => {
      const grid = make3x5();
      // First column: 1, 6, 11
      const marks = new Set([1, 6, 11]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("detects a complete last column", () => {
      const grid = make3x5();
      // Last column: 5, 10, 15
      const marks = new Set([5, 10, 15]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("returns false with partial row", () => {
      const grid = make3x5();
      // 4 out of 5 in first row
      const marks = new Set([1, 2, 3, 4]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(false);
    });

    it("returns false with partial column", () => {
      const grid = make3x5();
      // 2 out of 3 in first column
      const marks = new Set([1, 6]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(false);
    });
  });

  describe("5x5 grid with free space", () => {
    it("returns false when no numbers are marked", () => {
      const grid = make5x5();
      expect(hasAnyCompleteLine(grid, new Set())).toBe(false);
    });

    it("detects a complete row", () => {
      const grid = make5x5();
      // First row: 1,2,3,4,5
      const marks = new Set([1, 2, 3, 4, 5]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("detects center row with free space (only 4 marks needed)", () => {
      const grid = make5x5();
      // Center row [2]: 11, 12, 0(free), 13, 14
      const marks = new Set([11, 12, 13, 14]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("detects center column with free space", () => {
      const grid = make5x5();
      // Column 2: 3, 8, 0(free), 17, 22
      const marks = new Set([3, 8, 17, 22]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(true);
    });

    it("returns false with scattered marks", () => {
      const grid = make5x5();
      const marks = new Set([1, 7, 13, 19]);
      expect(hasAnyCompleteLine(grid, marks)).toBe(false);
    });
  });
});

// ── hasFullBingo ────────────────────────────────────────────────────────────

describe("hasFullBingo", () => {
  describe("3x5 grid", () => {
    it("returns false when no numbers marked", () => {
      const grid = make3x5();
      expect(hasFullBingo(grid, new Set())).toBe(false);
    });

    it("returns false with all but one marked", () => {
      const grid = make3x5();
      // Mark 1-14, missing 15
      const marks = new Set(Array.from({ length: 14 }, (_, i) => i + 1));
      expect(hasFullBingo(grid, marks)).toBe(false);
    });

    it("returns true when all 15 cells marked", () => {
      const grid = make3x5();
      const marks = new Set(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(hasFullBingo(grid, marks)).toBe(true);
    });

    it("returns true with extra marks beyond grid numbers", () => {
      const grid = make3x5();
      // All 15 + some extras
      const marks = new Set(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(hasFullBingo(grid, marks)).toBe(true);
    });
  });

  describe("5x5 grid with free space", () => {
    it("returns true when all non-free cells marked (24 marks)", () => {
      const grid = make5x5();
      // Numbers are 1-24 (free space is 0 at center)
      const marks = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
      expect(hasFullBingo(grid, marks)).toBe(true);
    });

    it("returns false with 23 of 24 non-free cells marked", () => {
      const grid = make5x5();
      // Missing number 24
      const marks = new Set(Array.from({ length: 23 }, (_, i) => i + 1));
      expect(hasFullBingo(grid, marks)).toBe(false);
    });
  });
});

// ── checkClaims ─────────────────────────────────────────────────────────────

describe("checkClaims", () => {
  it("returns both false with no drawn numbers", () => {
    const tickets = [{ grid: make3x5() }];
    const result = checkClaims(tickets, [], []);
    expect(result).toEqual({ canClaimLine: false, canClaimBingo: false });
  });

  it("detects LINE across multiple tickets", () => {
    const tickets = [
      { grid: make3x5(1) },  // row 1: 1,2,3,4,5
      { grid: make3x5(20) }, // row 1: 20,21,22,23,24
    ];
    // Only complete the first row of ticket 2
    const drawn = [20, 21, 22, 23, 24];
    const result = checkClaims(tickets, [], drawn);
    expect(result.canClaimLine).toBe(true);
    expect(result.canClaimBingo).toBe(false);
  });

  it("detects BINGO when all cells marked", () => {
    const tickets = [{ grid: make3x5(1) }];
    const drawn = Array.from({ length: 15 }, (_, i) => i + 1);
    const result = checkClaims(tickets, [], drawn);
    expect(result.canClaimLine).toBe(true);
    expect(result.canClaimBingo).toBe(true);
  });

  it("merges ticketMarks with drawnNumbers", () => {
    const grid = make3x5();
    // First row: 1,2,3,4,5
    // Draw 1,2,3 — ticketMarks has 4,5 pre-marked
    const tickets = [{ grid }];
    const drawn = [1, 2, 3];
    const ticketMarks = [[4, 5]];
    const result = checkClaims(tickets, ticketMarks, drawn);
    expect(result.canClaimLine).toBe(true);
  });

  it("handles empty tickets array", () => {
    const result = checkClaims([], [], []);
    expect(result).toEqual({ canClaimLine: false, canClaimBingo: false });
  });

  it("works with 5x5 grid and free space", () => {
    const grid = make5x5();
    // Center row: 11, 12, 0(free), 13, 14
    const tickets = [{ grid }];
    const drawn = [11, 12, 13, 14];
    const result = checkClaims(tickets, [], drawn);
    expect(result.canClaimLine).toBe(true);
    expect(result.canClaimBingo).toBe(false);
  });
});
