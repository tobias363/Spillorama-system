/**
 * Unit tests for PatternMatcher — bitmask pattern matching for Game 3.
 * Covers: parsePatternType, buildTicketMask, matchesPattern, matchesAny,
 * isFullHouse, ROW_1..4_MASKS, FULL_HOUSE_MASK, getBuiltInPatternMasks.
 *
 * Legacy parity: ROW_N_MASKS are verified against the combination structure
 * in Helper/bingo.js:1197-1356 — Row 1 = 10 single lines (5 horizontal + 5
 * vertical), Row 2 = 10 horizontal-row pairs, Row 3 = 9 horizontal-row triples
 * (legacy omits the 235 triple), Row 4 = 5 horizontal-row quadruples.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  FULL_HOUSE_MASK,
  parsePatternType,
  buildTicketMask,
  matchesPattern,
  matchesAny,
  isFullHouse,
  ROW_1_MASKS,
  ROW_2_MASKS,
  ROW_3_MASKS,
  ROW_4_MASKS,
  getBuiltInPatternMasks,
} from "./PatternMatcher.js";
import type { Ticket } from "./types.js";

/** Helper: build a 5×5 ticket with sequential numbers 1..25 for deterministic tests. */
function seqTicket(): Ticket {
  const grid: number[][] = [];
  for (let r = 0; r < 5; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < 5; c += 1) row.push(r * 5 + c + 1);
    grid.push(row);
  }
  return { grid };
}

/** Helper: count bits set in a 25-bit mask. */
function popcount(m: number): number {
  let c = 0;
  for (let i = 0; i < 25; i += 1) if ((m >> i) & 1) c += 1;
  return c;
}

// ── parsePatternType ────────────────────────────────────────────────────────

describe("parsePatternType", () => {
  test("decodes full-house (25 ones) to FULL_HOUSE_MASK", () => {
    const s = Array(25).fill("1").join(",");
    assert.equal(parsePatternType(s), FULL_HOUSE_MASK);
  });

  test("decodes all zeros to 0", () => {
    const s = Array(25).fill("0").join(",");
    assert.equal(parsePatternType(s), 0);
  });

  test("accepts legacy mixed '.' + ',' separators (row-dot / cell-comma)", () => {
    // 5 rows, each "1,0,0,0,0" → only first column set (bits 0,5,10,15,20)
    const s = "1,0,0,0,0.1,0,0,0,0.1,0,0,0,0.1,0,0,0,0.1,0,0,0,0";
    const mask = parsePatternType(s);
    assert.equal(mask, (1 << 0) | (1 << 5) | (1 << 10) | (1 << 15) | (1 << 20));
  });

  test("bit ordering is row-major (bit 0 = top-left, bit 24 = bottom-right)", () => {
    const bits = Array(25).fill("0");
    bits[0] = "1";   // top-left
    bits[24] = "1";  // bottom-right
    const mask = parsePatternType(bits.join(","));
    assert.equal(mask, (1 << 0) | (1 << 24));
  });

  test("throws on wrong length", () => {
    assert.throws(() => parsePatternType("1,1,1"), /25 bits/);
  });

  test("throws on non-0/1 character", () => {
    const bits = Array(25).fill("0");
    bits[3] = "2";
    assert.throws(() => parsePatternType(bits.join(",")), /expected '0' or '1'/);
  });
});

// ── buildTicketMask ─────────────────────────────────────────────────────────

describe("buildTicketMask", () => {
  test("empty marks → mask 0", () => {
    assert.equal(buildTicketMask(seqTicket(), new Set()), 0);
  });

  test("all-marked → FULL_HOUSE_MASK", () => {
    const all = new Set(Array.from({ length: 25 }, (_, i) => i + 1));
    assert.equal(buildTicketMask(seqTicket(), all), FULL_HOUSE_MASK);
  });

  test("single mark sets correct bit (row-major)", () => {
    // Cell (row 2, col 3) = value 14 (= 2*5 + 3 + 1). Bit index = 2*5 + 3 = 13.
    const mask = buildTicketMask(seqTicket(), new Set([14]));
    assert.equal(mask, 1 << 13);
  });

  test("free-centre (cell = 0) counts as marked even if 0 not in marks", () => {
    const grid: number[][] = [];
    for (let r = 0; r < 5; r += 1) {
      const row: number[] = [];
      for (let c = 0; c < 5; c += 1) {
        row.push(r === 2 && c === 2 ? 0 : r * 5 + c + 1);
      }
      grid.push(row);
    }
    const mask = buildTicketMask({ grid }, new Set());
    // Only bit 12 (row 2, col 2) should be set.
    assert.equal(mask, 1 << 12);
  });

  test("returns 0 for mis-sized grid (fail-closed)", () => {
    const ticket: Ticket = { grid: [[1, 2, 3]] };
    assert.equal(buildTicketMask(ticket, new Set([1, 2, 3])), 0);
  });
});

// ── matchesPattern / matchesAny / isFullHouse ───────────────────────────────

describe("matchesPattern", () => {
  test("exact match → true", () => {
    const m = (1 << 0) | (1 << 1);
    assert.equal(matchesPattern(m, m), true);
  });

  test("ticket covers more than pattern → true", () => {
    const ticket = 0b11111;
    const pattern = 0b00011;
    assert.equal(matchesPattern(ticket, pattern), true);
  });

  test("ticket missing one pattern bit → false", () => {
    const ticket = 0b10101;
    const pattern = 0b11101;
    assert.equal(matchesPattern(ticket, pattern), false);
  });

  test("pattern 0 always matches (vacuous truth)", () => {
    assert.equal(matchesPattern(0, 0), true);
    assert.equal(matchesPattern(0xFF, 0), true);
  });
});

describe("matchesAny", () => {
  test("returns true if any mask matches", () => {
    const ticket = ROW_1_MASKS[0]; // first horizontal row covered
    assert.equal(matchesAny(ticket, ROW_1_MASKS), true);
  });

  test("returns false if no mask matches", () => {
    assert.equal(matchesAny(0, ROW_1_MASKS), false);
  });

  test("empty mask array → false", () => {
    assert.equal(matchesAny(FULL_HOUSE_MASK, []), false);
  });
});

describe("isFullHouse", () => {
  test("FULL_HOUSE_MASK → true", () => {
    assert.equal(isFullHouse(FULL_HOUSE_MASK), true);
  });

  test("25 bits value 0x1FFFFFF", () => {
    assert.equal(FULL_HOUSE_MASK, 0x1FFFFFF);
    assert.equal(popcount(FULL_HOUSE_MASK), 25);
  });

  test("any other mask → false", () => {
    assert.equal(isFullHouse(0), false);
    assert.equal(isFullHouse(FULL_HOUSE_MASK - 1), false);
  });
});

// ── ROW_N_MASKS legacy-parity ───────────────────────────────────────────────

describe("ROW_1_MASKS", () => {
  test("has exactly 10 masks (5 horizontal + 5 vertical)", () => {
    assert.equal(ROW_1_MASKS.length, 10);
  });

  test("each mask covers exactly 5 cells", () => {
    for (const m of ROW_1_MASKS) assert.equal(popcount(m), 5);
  });

  test("first 5 are horizontal rows", () => {
    // Row 0 horizontal = bits 0..4 = 0b11111 = 31.
    assert.equal(ROW_1_MASKS[0], 0b11111);
    // Row 1 horizontal = bits 5..9.
    assert.equal(ROW_1_MASKS[1], 0b11111 << 5);
    // Row 4 horizontal = bits 20..24.
    assert.equal(ROW_1_MASKS[4], 0b11111 << 20);
  });

  test("last 5 are vertical columns", () => {
    // Col 0 = bits 0, 5, 10, 15, 20.
    const col0 = (1 << 0) | (1 << 5) | (1 << 10) | (1 << 15) | (1 << 20);
    assert.equal(ROW_1_MASKS[5], col0);
    // Col 4 = bits 4, 9, 14, 19, 24.
    const col4 = (1 << 4) | (1 << 9) | (1 << 14) | (1 << 19) | (1 << 24);
    assert.equal(ROW_1_MASKS[9], col4);
  });

  test("union of all Row 1 masks covers all 25 cells", () => {
    let u = 0;
    for (const m of ROW_1_MASKS) u |= m;
    assert.equal(u, FULL_HOUSE_MASK);
  });
});

describe("ROW_2_MASKS", () => {
  test("has exactly 10 masks (C(5,2) = 10 horizontal-row pairs)", () => {
    assert.equal(ROW_2_MASKS.length, 10);
  });

  test("each mask covers exactly 10 cells", () => {
    for (const m of ROW_2_MASKS) assert.equal(popcount(m), 10);
  });

  test("all 10 masks are distinct", () => {
    assert.equal(new Set(ROW_2_MASKS).size, 10);
  });

  test("first entry = rows 0+1 (matches legacy bingo.js:1222)", () => {
    const expected = 0b1111111111; // bits 0..9
    assert.equal(ROW_2_MASKS[0], expected);
  });
});

describe("ROW_3_MASKS", () => {
  test("has exactly 9 masks (legacy bingo.js lists 9, omitting 235)", () => {
    assert.equal(ROW_3_MASKS.length, 9);
  });

  test("each mask covers exactly 15 cells", () => {
    for (const m of ROW_3_MASKS) assert.equal(popcount(m), 15);
  });

  test("first entry = rows 0+1+2 (legacy //123)", () => {
    const expected = 0b111111111111111; // bits 0..14
    assert.equal(ROW_3_MASKS[0], expected);
  });

  test("last entry = rows 2+3+4 (legacy //345)", () => {
    // bits 10..24
    let expected = 0;
    for (let i = 10; i < 25; i += 1) expected |= 1 << i;
    assert.equal(ROW_3_MASKS[8], expected);
  });
});

describe("ROW_4_MASKS", () => {
  test("has exactly 5 masks (C(5,4) = 5 horizontal-row quadruples)", () => {
    assert.equal(ROW_4_MASKS.length, 5);
  });

  test("each mask covers exactly 20 cells", () => {
    for (const m of ROW_4_MASKS) assert.equal(popcount(m), 20);
  });

  test("first entry = rows 0+1+2+3 (legacy //1234)", () => {
    const expected = 0xFFFFF; // bits 0..19
    assert.equal(ROW_4_MASKS[0], expected);
  });

  test("last entry = rows 1+2+3+4 (legacy //2345)", () => {
    let expected = 0;
    for (let i = 5; i < 25; i += 1) expected |= 1 << i;
    assert.equal(ROW_4_MASKS[4], expected);
  });
});

// ── End-to-end: ticket mask × pattern ───────────────────────────────────────

describe("end-to-end matching", () => {
  test("ticket with top row drawn matches Row 1 horizontal mask", () => {
    const ticket = seqTicket();
    const marks = new Set([1, 2, 3, 4, 5]); // top row values
    const tMask = buildTicketMask(ticket, marks);
    assert.equal(matchesAny(tMask, ROW_1_MASKS), true);
  });

  test("ticket with left column drawn matches Row 1 vertical mask", () => {
    const ticket = seqTicket();
    // Col 0 values = 1, 6, 11, 16, 21.
    const marks = new Set([1, 6, 11, 16, 21]);
    const tMask = buildTicketMask(ticket, marks);
    assert.equal(matchesAny(tMask, ROW_1_MASKS), true);
  });

  test("ticket with top+bottom rows matches Row 2 (0,4) pair", () => {
    const ticket = seqTicket();
    const marks = new Set([1, 2, 3, 4, 5, 21, 22, 23, 24, 25]);
    const tMask = buildTicketMask(ticket, marks);
    assert.equal(matchesAny(tMask, ROW_2_MASKS), true);
  });

  test("ticket with corners only does NOT match any Row 1..4", () => {
    const ticket = seqTicket();
    // Corners = 1, 5, 21, 25.
    const marks = new Set([1, 5, 21, 25]);
    const tMask = buildTicketMask(ticket, marks);
    assert.equal(matchesAny(tMask, ROW_1_MASKS), false);
    assert.equal(matchesAny(tMask, ROW_2_MASKS), false);
    assert.equal(matchesAny(tMask, ROW_3_MASKS), false);
    assert.equal(matchesAny(tMask, ROW_4_MASKS), false);
  });

  test("full-house ticket matches FULL_HOUSE_MASK", () => {
    const ticket = seqTicket();
    const marks = new Set(Array.from({ length: 25 }, (_, i) => i + 1));
    const tMask = buildTicketMask(ticket, marks);
    assert.equal(matchesPattern(tMask, FULL_HOUSE_MASK), true);
    assert.equal(isFullHouse(tMask), true);
  });

  test("custom X-pattern via parsePatternType matches diagonals", () => {
    // X-pattern = both diagonals.
    const bits = Array(25).fill("0");
    // Main diagonal: (0,0), (1,1), (2,2), (3,3), (4,4) → indices 0,6,12,18,24.
    for (const i of [0, 6, 12, 18, 24]) bits[i] = "1";
    // Anti-diagonal: (0,4), (1,3), (2,2), (3,1), (4,0) → indices 4, 8, 12, 16, 20.
    for (const i of [4, 8, 16, 20]) bits[i] = "1"; // 12 already set
    const xMask = parsePatternType(bits.join(","));

    const ticket = seqTicket();
    // Diagonal values at those positions:
    //   main: 1 (0,0), 7 (1,1), 13 (2,2), 19 (3,3), 25 (4,4)
    //   anti: 5 (0,4), 9 (1,3), 13, 17 (3,1), 21 (4,0)
    const marks = new Set([1, 7, 13, 19, 25, 5, 9, 17, 21]);
    const tMask = buildTicketMask(ticket, marks);
    assert.equal(matchesPattern(tMask, xMask), true);

    // Dropping one corner → no longer matches.
    const marks2 = new Set([1, 7, 13, 19, 25, 5, 9, 17 /* missing 21 */]);
    assert.equal(matchesPattern(buildTicketMask(ticket, marks2), xMask), false);
  });
});

// ── getBuiltInPatternMasks ──────────────────────────────────────────────────

describe("getBuiltInPatternMasks", () => {
  test("resolves 'Row 1' → ROW_1_MASKS", () => {
    assert.strictEqual(getBuiltInPatternMasks("Row 1"), ROW_1_MASKS);
  });

  test("resolves 'Row 2' → ROW_2_MASKS", () => {
    assert.strictEqual(getBuiltInPatternMasks("Row 2"), ROW_2_MASKS);
  });

  test("resolves 'Row 3' → ROW_3_MASKS", () => {
    assert.strictEqual(getBuiltInPatternMasks("Row 3"), ROW_3_MASKS);
  });

  test("resolves 'Row 4' → ROW_4_MASKS", () => {
    assert.strictEqual(getBuiltInPatternMasks("Row 4"), ROW_4_MASKS);
  });

  test("resolves 'Coverall' → [FULL_HOUSE_MASK]", () => {
    const m = getBuiltInPatternMasks("Coverall");
    assert.deepEqual(m, [FULL_HOUSE_MASK]);
  });

  test("resolves 'Full House' → [FULL_HOUSE_MASK] (alias)", () => {
    const m = getBuiltInPatternMasks("Full House");
    assert.deepEqual(m, [FULL_HOUSE_MASK]);
  });

  test("unknown name → null (caller falls back to custom pattern)", () => {
    assert.equal(getBuiltInPatternMasks("Custom X"), null);
  });
});
