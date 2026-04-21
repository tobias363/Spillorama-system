/**
 * Generisk 25-bit bitmask-matcher for 5×5 bingo-patterns.
 *
 * Brukes av:
 *   - `Game3Engine` + `PatternCycler.test.ts` — Game 3 (Mønsterbingo)
 *   - `adminPhysicalTicketCheckBingo.ts` — admin-rute for å sjekke fysiske
 *     bonger manuelt mot rad-kombinasjoner (IKKE Spill 1-spesifikk)
 *
 * IKKE brukt av Spill 1 (Norsk 75-ball). Spill 1 har egne fase-regler via
 * `BingoEngine.meetsPhaseRequirement` (som bruker `countCompleteRows` /
 * `countCompleteColumns` i `ticket.ts`), og klient-speiling i
 * `packages/game-client/src/games/game1/logic/PatternMasks.ts` (kolonne-
 * orientert fra fase 2). IKKE gjenbruk ROW_*_MASKS her for Spill 1 — de
 * horisontale kombinasjonene matcher ikke Spill 1 sin backend-regel.
 *
 * Hot-path primitive: `matchesPattern` er en enkel `&` + `===` — billigere
 * enn `arr.every(n => drawn.has(n))` for høylast-trekning.
 *
 * Row-maske-definisjoner:
 *   - Row 1 = én hel linje (5 horisontale rader + 5 vertikale kolonner) = 10 masker.
 *   - Row 2 = 2 horisontale rader (C(5,2) = 10 kombinasjoner).
 *   - Row 3 = 3 horisontale rader (C(5,3) = 10 kombinasjoner).
 *   - Row 4 = 4 horisontale rader (C(5,4) =  5 kombinasjoner).
 *   - Coverall = alle 25 bits = 0x1FFFFFF.
 */
import type { PatternMask, Ticket } from "@spillorama/shared-types";

/** Mask with all 25 bits set — Coverall / Full House. */
export const FULL_HOUSE_MASK: PatternMask = 0x1FFFFFF;

// ── Pattern decoding ────────────────────────────────────────────────────────

/**
 * Parse a legacy `patternType` string (e.g. "1,1,1,1,1.0,0,0,0,0.0,0,0,0,0...")
 * into a 25-bit mask. Separator is either `.` (row) or `,` (cell) — legacy
 * inconsistency, so we split on both.
 *
 * Legacy ref: gamehelper/game3.js:172-174 (`get2DArrayFromString`, which splits
 * on `/[.,]/`). We collapse the resulting 0/1 array into a bitmask.
 *
 * Throws if the parsed array does not contain exactly 25 values or any value
 * is not 0 or 1.
 */
export function parsePatternType(patternType: string): PatternMask {
  const bits = patternType.split(/[.,]/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (bits.length !== 25) {
    throw new Error(`patternType must decode to 25 bits, got ${bits.length}`);
  }
  let mask = 0;
  for (let i = 0; i < 25; i += 1) {
    const v = Number(bits[i]);
    if (v !== 0 && v !== 1) {
      throw new Error(`patternType bit ${i} is ${bits[i]!}, expected '0' or '1'`);
    }
    if (v === 1) mask |= 1 << i;
  }
  return mask;
}

// ── Ticket → mask ───────────────────────────────────────────────────────────

/**
 * Build a 25-bit mask for a ticket: bit `i` is set if cell `i` (row-major) has
 * been drawn. Game 3 tickets have no free-centre, but we tolerate cell value 0
 * (treated as NOT matched — matches Game 1 free-centre semantics for tools
 * that share this helper).
 *
 * Only supports 5×5 tickets; returns 0 for mis-sized grids rather than throw,
 * so a degraded ticket simply cannot win (fail-closed).
 */
export function buildTicketMask(ticket: Ticket, marks: Set<number>): PatternMask {
  const grid = ticket.grid;
  if (grid.length !== 5) return 0;
  let mask = 0;
  for (let row = 0; row < 5; row += 1) {
    const cells = grid[row];
    if (!cells || cells.length !== 5) return 0;
    for (let col = 0; col < 5; col += 1) {
      const cell = cells[col];
      if (cell === undefined) continue;
      // Cell 0 = free-centre (Game 1 only); Game 3 never has 0. Free-centre
      // always counts as marked for parity with hasFullBingo.
      if (cell === 0 || marks.has(cell)) {
        mask |= 1 << (row * 5 + col);
      }
    }
  }
  return mask;
}

// ── Core match primitive ────────────────────────────────────────────────────

/**
 * Hot-path primitive: pattern matches ticket iff every pattern-bit is also set
 * on the ticket. Single AND + equality — O(1), no allocation.
 */
export function matchesPattern(ticketMask: PatternMask, patternMask: PatternMask): boolean {
  return (ticketMask & patternMask) === patternMask;
}

/** True if any mask in the array matches the ticket. */
export function matchesAny(ticketMask: PatternMask, patternMasks: readonly PatternMask[]): boolean {
  for (const m of patternMasks) {
    if (matchesPattern(ticketMask, m)) return true;
  }
  return false;
}

/** True if the given mask covers the whole 5×5 grid. */
export function isFullHouse(mask: PatternMask): boolean {
  return mask === FULL_HOUSE_MASK;
}

// ── Built-in Row N masks ────────────────────────────────────────────────────

/**
 * Produce a mask covering a single horizontal row (5 cells in one grid row).
 * `row` is 0..4.
 */
function horizontalRowMask(row: number): PatternMask {
  let mask = 0;
  for (let col = 0; col < 5; col += 1) mask |= 1 << (row * 5 + col);
  return mask;
}

/**
 * Produce a mask covering a single vertical column (5 cells in one grid column).
 * `col` is 0..4.
 */
function verticalColumnMask(col: number): PatternMask {
  let mask = 0;
  for (let row = 0; row < 5; row += 1) mask |= 1 << (row * 5 + col);
  return mask;
}

/** All 5 horizontal row masks, in order row 0..4. */
const HORIZONTAL_ROW_MASKS: readonly PatternMask[] = [0, 1, 2, 3, 4].map(horizontalRowMask);

/** All 5 vertical column masks, in order col 0..4. */
const VERTICAL_COLUMN_MASKS: readonly PatternMask[] = [0, 1, 2, 3, 4].map(verticalColumnMask);

/**
 * Row 1 = any single line — 5 horizontal rows + 5 vertical columns = 10 masks.
 *
 * Legacy ref: bingo.js:1207-1218 (`case "Row 1"`). The legacy array is 10 sub-
 * arrays: the first 5 are horizontal rows (indices 0-4, 5-9, 10-14, 15-19, 20-24),
 * the next 5 are vertical columns (indices 0/5/10/15/20, etc.).
 */
export const ROW_1_MASKS: readonly PatternMask[] = Object.freeze([
  ...HORIZONTAL_ROW_MASKS,
  ...VERTICAL_COLUMN_MASKS,
]);

/**
 * Row 2 = any 2 horizontal rows = C(5,2) = 10 combinations.
 *
 * Legacy ref: bingo.js:1220-1232. Legacy enumerates all 10 pairs. Row 2 does
 * NOT include column pairs — confirmed by bingo.js:1222 (`numArr[0..9]` is
 * rows 0+1, not cols 0+1).
 *
 * Order: (0,1), (1,2), (2,3), (3,4), (0,4), (0,2), (0,3), (1,3), (1,4), (2,4)
 * matches legacy enumeration for 1:1 byte-equivalence with old test fixtures.
 */
export const ROW_2_MASKS: readonly PatternMask[] = Object.freeze([
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1],
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2],
  HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[4],
]);

/**
 * Row 3 = any 3 horizontal rows. **Legacy enumerates only 9 of the C(5,3)=10
 * possible triples** (the 235=rows 2+3+5 triple is omitted in legacy — see
 * bingo.js:1234-1291). We mirror legacy exactly for wire parity; adding the
 * 10th triple would trigger wins legacy never detects.
 *
 * Legacy ref: bingo.js:1234-1291 (comments `//123`, `//124`, `//125`, `//134`,
 * `//135`, `//145`, `//234`, `//245`, `//345` — exactly 9 entries).
 */
export const ROW_3_MASKS: readonly PatternMask[] = Object.freeze([
  // 123
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2],
  // 124
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3],
  // 125
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[4],
  // 134
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  // 135
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[4],
  // 145
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  // 234
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  // 245
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  // 345
  HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
]);

/**
 * Row 4 = any 4 horizontal rows = C(5,4) = 5 combinations.
 *
 * Legacy ref: bingo.js:1293-1331 (comments `//1234`, `//1235`, `//1245`,
 * `//1345`, `//2345`).
 */
export const ROW_4_MASKS: readonly PatternMask[] = Object.freeze([
  // 1234
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  // 1235
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[4],
  // 1245
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  // 1345
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  // 2345
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
]);

/** Alias for tests — row N mask array, also the horizontal-row component. */
export const ROW_N_MASKS = {
  ROW_1_MASKS,
  ROW_2_MASKS,
  ROW_3_MASKS,
  ROW_4_MASKS,
  FULL_HOUSE_MASK,
} as const;

/**
 * Expand a named Row pattern ("Row 1"..."Row 4") or "Coverall" into the set of
 * masks any of which satisfies the pattern. Returns `null` for unknown names
 * so callers can fall back to custom-pattern decoding via `parsePatternType`.
 */
export function getBuiltInPatternMasks(name: string): readonly PatternMask[] | null {
  switch (name) {
    case "Row 1": return ROW_1_MASKS;
    case "Row 2": return ROW_2_MASKS;
    case "Row 3": return ROW_3_MASKS;
    case "Row 4": return ROW_4_MASKS;
    case "Coverall":
    case "Full House":
      return [FULL_HOUSE_MASK];
    default: return null;
  }
}
