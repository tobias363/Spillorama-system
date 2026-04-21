import type { PatternDefinition } from "@spillorama/shared-types/game";

/**
 * Client-side mirror of `apps/backend/src/game/PatternMatcher.ts` — the shapes
 * of Row 1..4 and Full House, expressed as 25-bit masks over a 5x5 grid
 * (row-major, bit `i = row*5 + col`).
 *
 * Why a duplicate:
 *   - shared-types can't pull in backend source
 *   - the helper is pure data + a handful of tiny functions
 *   - mirrored test `PatternMasks.test.ts` keeps both sides wire-compatible
 *
 * Used by BingoTicketHtml to compute the phase-specific "igjen" counter
 * (X cells left to complete the CURRENT active pattern, not the whole card).
 */

export type PatternMask = number;

export const FULL_HOUSE_MASK: PatternMask = 0x1ffffff;

function horizontalRowMask(row: number): PatternMask {
  let mask = 0;
  for (let col = 0; col < 5; col += 1) mask |= 1 << (row * 5 + col);
  return mask;
}

function verticalColumnMask(col: number): PatternMask {
  let mask = 0;
  for (let row = 0; row < 5; row += 1) mask |= 1 << (row * 5 + col);
  return mask;
}

const HORIZONTAL_ROW_MASKS: readonly PatternMask[] = [0, 1, 2, 3, 4].map(horizontalRowMask);
const VERTICAL_COLUMN_MASKS: readonly PatternMask[] = [0, 1, 2, 3, 4].map(verticalColumnMask);

/** Row 1 = single line, any of 5 horizontal + 5 vertical = 10 masks. */
export const ROW_1_MASKS: readonly PatternMask[] = Object.freeze([
  ...HORIZONTAL_ROW_MASKS,
  ...VERTICAL_COLUMN_MASKS,
]);

/** Row 2 = any 2 horizontal rows — 10 combinations (legacy-ordered). */
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

/** Row 3 = any 3 horizontal rows — 9 combinations (legacy omits 235). */
export const ROW_3_MASKS: readonly PatternMask[] = Object.freeze([
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
]);

/** Row 4 = any 4 horizontal rows — 5 combinations. */
export const ROW_4_MASKS: readonly PatternMask[] = Object.freeze([
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[0] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
  HORIZONTAL_ROW_MASKS[1] | HORIZONTAL_ROW_MASKS[2] | HORIZONTAL_ROW_MASKS[3] | HORIZONTAL_ROW_MASKS[4],
]);

/**
 * Return all masks that can satisfy the built-in pattern name, or null for
 * unknown / custom patterns (Game 3 picture/frame, etc.).
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

/**
 * Build a 25-bit ticket mask. Bit `i` is set if the cell at `row*5+col` is
 * marked (in `marks`) OR is the free centre (value 0). Non-5x5 grids return 0.
 */
export function buildTicketMaskFromGrid(grid: readonly (readonly number[])[], marks: ReadonlySet<number>): PatternMask {
  if (grid.length !== 5) return 0;
  let mask = 0;
  for (let row = 0; row < 5; row += 1) {
    const cells = grid[row];
    if (!cells || cells.length !== 5) return 0;
    for (let col = 0; col < 5; col += 1) {
      const cell = cells[col];
      if (cell === undefined) continue;
      if (cell === 0 || marks.has(cell)) mask |= 1 << (row * 5 + col);
    }
  }
  return mask;
}

/** Count set bits in a 32-bit integer (Hamming weight). */
function popcount(n: number): number {
  let x = n >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

/**
 * How many cells the ticket still needs to satisfy the given pattern, choosing
 * the BEST candidate mask (minimum remaining).
 *
 * For Row 1..4 the pattern is "any of N masks", so remaining = min over masks
 * of popcount(mask & ~ticketMask).
 *
 * Returns `null` for an unknown pattern name — caller falls back to the
 * "whole card" count.
 */
export function remainingForPattern(
  grid: readonly (readonly number[])[],
  marks: ReadonlySet<number>,
  patternName: string,
): number | null {
  const candidates = getBuiltInPatternMasks(patternName);
  if (!candidates) return null;
  const ticketMask = buildTicketMaskFromGrid(grid, marks);
  let best = Infinity;
  for (const m of candidates) {
    const need = popcount(m & ~ticketMask);
    if (need < best) best = need;
    if (best === 0) return 0;
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Map a backend pattern name to the Norwegian display label used in the ticket
 * footer. Falls back to the original name for unknown patterns.
 */
export function displayNameForPattern(pattern: Pick<PatternDefinition, "name"> | null | undefined): string {
  if (!pattern) return "";
  const name = pattern.name;
  if (name === "Full House" || name === "Coverall") return "Fullt Hus";
  if (name === "Picture" || name === "picture") return "Bilde";
  if (name === "Frame" || name === "frame") return "Ramme";
  if (/^Row \d/.test(name)) return name.replace("Row", "Rad");
  return name;
}

/**
 * Pick the currently-active pattern from a patterns+results pair. Returns the
 * first pattern (in order) whose result has `isWon !== true`. Returns null
 * when all patterns are won (game complete).
 */
export function activePatternFromState(
  patterns: readonly PatternDefinition[],
  results: readonly { patternId: string; isWon: boolean }[],
): PatternDefinition | null {
  const ordered = [...patterns].sort((a, b) => a.order - b.order);
  for (const p of ordered) {
    const r = results.find((x) => x.patternId === p.id);
    if (!r || !r.isWon) return p;
  }
  return null;
}
