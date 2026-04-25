/**
 * Spill 1 (Norsk 75-ball, 5×5) — kanonisk fase-regel-kilde delt mellom
 * backend og klient. Erstatter duplisert regex + count-helpers i backend
 * `BingoEngine.meetsPhaseRequirement` og klient `PatternMasks.ts`.
 *
 * Bit-layout (25 bits, row-major):
 *    0  1  2  3  4
 *    5  6  7  8  9
 *   10 11 12 13 14   (bit 12 = free center, alltid satt)
 *   15 16 17 18 19
 *   20 21 22 23 24
 *
 * Klassifiseringen speiler `DEFAULT_NORSK_BINGO_CONFIG` pattern-navn
 * ("1 Rad", "2 Rader", ..., "Fullt Hus") og godtar engelske legacy-navn.
 * Ukjente navn returnerer null → kaller bruker claimType-fallback.
 */

import { PATTERN_MASK_FULL, type PatternMask } from "./game.js";

/** De 5 fasene i Norsk 75-ball. Fase-ID er string-enum for wire-stabilitet. */
export enum Spill1Phase {
  Phase1 = "phase1",
  Phase2 = "phase2",
  Phase3 = "phase3",
  Phase4 = "phase4",
  FullHouse = "fullHouse",
}

/** 5 horisontale rad-masker (rad 0..4). */
export const ROW_MASKS: readonly PatternMask[] = Object.freeze([
  0x00001f, // rad 0: bits 0-4
  0x0003e0, // rad 1: bits 5-9
  0x007c00, // rad 2: bits 10-14
  0x0f8000, // rad 3: bits 15-19
  0x1f00000, // rad 4: bits 20-24
]);

/** 5 vertikale kolonne-masker (kol 0..4). */
export const COLUMN_MASKS: readonly PatternMask[] = Object.freeze([
  0x108421, // kol 0
  0x210842, // kol 1
  0x421084, // kol 2 (inneholder free center bit 12)
  0x842108, // kol 3
  0x1084210, // kol 4
]);

function rowCombinations(k: number): PatternMask[] {
  const results: PatternMask[] = [];
  const pick = (start: number, picked: number[]): void => {
    if (picked.length === k) {
      let union = 0;
      for (const idx of picked) union |= ROW_MASKS[idx];
      results.push(union);
      return;
    }
    for (let i = start; i < ROW_MASKS.length; i++) {
      picked.push(i);
      pick(i + 1, picked);
      picked.pop();
    }
  };
  pick(0, []);
  return results;
}

/** Fase 1: 1 hel rad ELLER 1 hel kolonne. 10 kandidat-masker. */
export const PHASE_1_MASKS: readonly PatternMask[] = Object.freeze([
  ...ROW_MASKS,
  ...COLUMN_MASKS,
]);
/** Fase 2: 2 hele horisontale rader. C(5,2) = 10. */
export const PHASE_2_MASKS: readonly PatternMask[] = Object.freeze(rowCombinations(2));
/** Fase 3: 3 hele horisontale rader. C(5,3) = 10. */
export const PHASE_3_MASKS: readonly PatternMask[] = Object.freeze(rowCombinations(3));
/** Fase 4: 4 hele horisontale rader. C(5,4) = 5. */
export const PHASE_4_MASKS: readonly PatternMask[] = Object.freeze(rowCombinations(4));
/** Fase 5 (Fullt Hus): alle 25 celler. */
export const FULL_HOUSE_MASKS: readonly PatternMask[] = Object.freeze([PATTERN_MASK_FULL]);

/** Lookup-tabell fase → kandidat-masker. */
export const PHASE_MASKS: Readonly<Record<Spill1Phase, readonly PatternMask[]>> = Object.freeze({
  [Spill1Phase.Phase1]: PHASE_1_MASKS,
  [Spill1Phase.Phase2]: PHASE_2_MASKS,
  [Spill1Phase.Phase3]: PHASE_3_MASKS,
  [Spill1Phase.Phase4]: PHASE_4_MASKS,
  [Spill1Phase.FullHouse]: FULL_HOUSE_MASKS,
});

/**
 * Norsk display-navn → Spill1Phase. Engelske legacy-navn ("Row 2",
 * "Full House", "Coverall") godtas. Returnerer null for ukjente navn
 * (jubilee "Stjerne", Spill 3 "Bilde"/"Ramme") — kaller bruker
 * claimType-fallback.
 */
export function classifyPhaseFromPatternName(name: string): Spill1Phase | null {
  const lc = name.toLowerCase().trim();
  if (/^1\s*rad\b/.test(lc) || /^row\s*1\b/.test(lc)) return Spill1Phase.Phase1;
  if (/^2\s*rad/.test(lc) || /^row\s*2\b/.test(lc)) return Spill1Phase.Phase2;
  if (/^3\s*rad/.test(lc) || /^row\s*3\b/.test(lc)) return Spill1Phase.Phase3;
  if (/^4\s*rad/.test(lc) || /^row\s*4\b/.test(lc)) return Spill1Phase.Phase4;
  if (/fullt\s*hus/.test(lc) || /full\s*house/.test(lc) || /coverall/.test(lc)) {
    return Spill1Phase.FullHouse;
  }
  return null;
}

/** Popcount for 25-bit maske. */
export function popCount25(v: number): number {
  let c = 0;
  for (let i = 0; i < 25; i++) if (v & (1 << i)) c++;
  return c;
}

/**
 * Returnerer true hvis `ticketMask` dekker minst én av fase-kandidatene
 * (alle bits i kandidaten er satt i ticketMask).
 */
export function ticketMaskMeetsPhase(ticketMask: number, phase: Spill1Phase): boolean {
  const candidates = PHASE_MASKS[phase];
  for (const candidate of candidates) {
    if ((candidate & ~ticketMask) === 0) return true;
  }
  return false;
}

/**
 * Bygg 25-bit ticket-mask for et 5×5 grid. Bit `r*5+c` settes hvis
 * `cell === 0` (free center) ELLER `marks.has(cell)`.
 *
 * Returnerer `null` for ikke-5×5 grids — kaller bruker alternative
 * strategier. Backend og klient bruker begge denne felles-helperen så
 * en ticket-mask er identisk på begge sider av wiren.
 */
export function buildTicketMaskFromGrid5x5(
  grid: ReadonlyArray<ReadonlyArray<number>>,
  marks: ReadonlySet<number>,
): number | null {
  if (grid.length !== 5) return null;
  let mask = 0;
  for (let r = 0; r < 5; r++) {
    const row = grid[r];
    if (!row || row.length !== 5) return null;
    for (let c = 0; c < 5; c++) {
      const n = row[c];
      if (n === 0 || marks.has(n)) {
        mask |= 1 << (r * 5 + c);
      }
    }
  }
  return mask;
}

/**
 * Minimum antall celler som mangler for å fullføre fasen, over alle
 * kandidat-masker. 0 betyr fasen er nådd.
 */
export function remainingBitsForPhase(phase: Spill1Phase, ticketMask: number): number {
  const candidates = PHASE_MASKS[phase];
  let min = Infinity;
  for (const candidate of candidates) {
    const missing = popCount25(candidate & ~ticketMask);
    if (missing < min) min = missing;
    if (min === 0) return 0;
  }
  return Number.isFinite(min) ? min : 0;
}
