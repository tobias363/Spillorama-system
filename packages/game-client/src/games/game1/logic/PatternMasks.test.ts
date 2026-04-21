/**
 * @vitest-environment node
 *
 * Client mirror of `apps/backend/src/game/PatternMatcher.test.ts` — keeps the
 * two sides wire-compatible. If backend masks change, these tests fail here
 * and catch the drift.
 */
import { describe, it, expect } from "vitest";
import {
  ROW_1_MASKS,
  ROW_2_MASKS,
  ROW_3_MASKS,
  ROW_4_MASKS,
  FULL_HOUSE_MASK,
  getBuiltInPatternMasks,
  buildTicketMaskFromGrid,
  remainingForPattern,
  displayNameForPattern,
  activePatternFromState,
} from "./PatternMasks.js";

describe("PatternMasks — mask counts", () => {
  it("Row 1 has 10 masks (5 rows + 5 cols)", () => {
    expect(ROW_1_MASKS.length).toBe(10);
  });
  it("Row 2 has 10 masks", () => expect(ROW_2_MASKS.length).toBe(10));
  it("Row 3 has 9 masks (legacy omits 235)", () => expect(ROW_3_MASKS.length).toBe(9));
  it("Row 4 has 5 masks", () => expect(ROW_4_MASKS.length).toBe(5));
  it("Full House mask covers all 25 bits", () => expect(FULL_HOUSE_MASK).toBe(0x1ffffff));
});

describe("PatternMasks — getBuiltInPatternMasks", () => {
  it("maps known names", () => {
    expect(getBuiltInPatternMasks("Row 1")).toBe(ROW_1_MASKS);
    expect(getBuiltInPatternMasks("Row 4")).toBe(ROW_4_MASKS);
    expect(getBuiltInPatternMasks("Full House")).toEqual([FULL_HOUSE_MASK]);
    expect(getBuiltInPatternMasks("Coverall")).toEqual([FULL_HOUSE_MASK]);
  });
  it("returns null for unknown pattern", () => {
    expect(getBuiltInPatternMasks("Picture")).toBeNull();
  });
});

describe("PatternMasks — buildTicketMaskFromGrid", () => {
  const grid = [
    [1, 16, 31, 46, 61],
    [2, 17, 32, 47, 62],
    [3, 18, 0, 48, 63], // free centre
    [4, 19, 33, 49, 64],
    [5, 20, 34, 50, 65],
  ];

  it("free centre is always marked", () => {
    const mask = buildTicketMaskFromGrid(grid, new Set());
    expect((mask >> 12) & 1).toBe(1);
  });

  it("marks are reflected bit-accurately", () => {
    const mask = buildTicketMaskFromGrid(grid, new Set([1, 65]));
    expect(mask & 1).toBe(1); // (row 0, col 0) bit 0
    expect((mask >> 24) & 1).toBe(1); // (row 4, col 4) bit 24
  });

  it("returns 0 for non-5x5 grid", () => {
    expect(buildTicketMaskFromGrid([[1, 2, 3]], new Set())).toBe(0);
  });
});

describe("PatternMasks — remainingForPattern", () => {
  const grid = [
    [1, 16, 31, 46, 61],
    [2, 17, 32, 47, 62],
    [3, 18, 0, 48, 63],
    [4, 19, 33, 49, 64],
    [5, 20, 34, 50, 65],
  ];

  it("fresh ticket needs 5 cells for Row 1 (any column has 5, but row 3 has the free centre so 4)", () => {
    // Row 3 contains the free cell which is always "marked" → 4 remaining.
    // The best mask across Row 1 candidates therefore is 4, not 5.
    expect(remainingForPattern(grid, new Set(), "Row 1")).toBe(4);
  });

  it("marking an entire row drops Row 1 to 0", () => {
    const marks = new Set([1, 16, 31, 46, 61]); // row 0
    expect(remainingForPattern(grid, marks, "Row 1")).toBe(0);
  });

  it("Full House on empty ticket = 24 (25 cells minus free centre)", () => {
    expect(remainingForPattern(grid, new Set(), "Full House")).toBe(24);
  });

  it("returns null for unknown pattern", () => {
    expect(remainingForPattern(grid, new Set(), "Picture")).toBeNull();
  });

  it("picks the best mask across Row 2 candidates", () => {
    // Mark row 0 fully (5 cells) and nothing else.
    // Best Row 2 mask then = rows 0+2 → row 2 has free centre so only 4 more cells.
    // Actually row 2 has 4 non-free cells needed → remaining = 4.
    const marks = new Set([1, 16, 31, 46, 61]);
    expect(remainingForPattern(grid, marks, "Row 2")).toBe(4);
  });
});

describe("PatternMasks — displayNameForPattern", () => {
  it("maps Row N → Rad N", () => {
    expect(displayNameForPattern({ name: "Row 1" })).toBe("Rad 1");
    expect(displayNameForPattern({ name: "Row 4" })).toBe("Rad 4");
  });
  it("maps Full House → Fullt Hus", () => {
    expect(displayNameForPattern({ name: "Full House" })).toBe("Fullt Hus");
  });
  it("falls back to raw name", () => {
    expect(displayNameForPattern({ name: "Mystery" })).toBe("Mystery");
  });
  it("handles null/undefined", () => {
    expect(displayNameForPattern(null)).toBe("");
  });
});

describe("PatternMasks — activePatternFromState", () => {
  const patterns = [
    { id: "p1", name: "Row 1", claimType: "LINE", prizePercent: 10, order: 1, design: 1 } as const,
    { id: "p2", name: "Row 2", claimType: "LINE", prizePercent: 20, order: 2, design: 1 } as const,
    { id: "p3", name: "Full House", claimType: "BINGO", prizePercent: 70, order: 3, design: 2 } as const,
  ];

  it("picks first pattern when nothing won", () => {
    const active = activePatternFromState(patterns, [
      { patternId: "p1", isWon: false },
      { patternId: "p2", isWon: false },
      { patternId: "p3", isWon: false },
    ]);
    expect(active?.id).toBe("p1");
  });

  it("advances to next pattern when first is won", () => {
    const active = activePatternFromState(patterns, [
      { patternId: "p1", isWon: true },
      { patternId: "p2", isWon: false },
      { patternId: "p3", isWon: false },
    ]);
    expect(active?.id).toBe("p2");
  });

  it("returns null when all patterns won", () => {
    const active = activePatternFromState(patterns, [
      { patternId: "p1", isWon: true },
      { patternId: "p2", isWon: true },
      { patternId: "p3", isWon: true },
    ]);
    expect(active).toBeNull();
  });
});
