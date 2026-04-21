/**
 * Klient-speil av backend fase-regler for Spill 1 (Norsk 75-ball).
 *
 * Backend (BingoEngine.meetsPhaseRequirement) godtar følgende per fase:
 *   - "1 Rad": én hel rad ELLER én hel kolonne (horisontal ELLER vertikal).
 *   - "2 Rader": to hele VERTIKALE kolonner (rader teller ikke fra fase 2).
 *   - "3 Rader": tre hele vertikale kolonner.
 *   - "4 Rader": fire hele vertikale kolonner.
 *   - "Fullt Hus": alle 25 celler (free center teller alltid markert).
 *
 * Merk: Pattern-navnene er norske i `DEFAULT_NORSK_BINGO_CONFIG`. Regex-
 * matchen i `getBuiltInPatternMasks` speiler backend-matchen i
 * `meetsPhaseRequirement` (1164-1170) så klient og server ser samme masker.
 *
 * Bit-layout (25 bits, row-major):
 *    0  1  2  3  4
 *    5  6  7  8  9
 *   10 11 12 13 14   (bit 12 = free center, alltid satt)
 *   15 16 17 18 19
 *   20 21 22 23 24
 */

import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";

/** 25-bit heldekke-maske (alle celler). */
export const FULL_HOUSE_MASK = 0x1ffffff;

/** Bit-indeks for free center (rad 2, kol 2). */
export const FREE_CENTER_BIT = 12;

/** De 5 horisontale rad-maskene (rad 0..4). */
export const ROW_MASKS: readonly number[] = [
  0x00001f, // rad 0: bits 0-4
  0x0003e0, // rad 1: bits 5-9
  0x007c00, // rad 2: bits 10-14
  0x0f8000, // rad 3: bits 15-19
  0x1f00000, // rad 4: bits 20-24
];

/** De 5 vertikale kolonne-maskene (kol 0..4). */
export const COLUMN_MASKS: readonly number[] = [
  0x108421, // kol 0: bits 0, 5, 10, 15, 20
  0x210842, // kol 1: bits 1, 6, 11, 16, 21
  0x421084, // kol 2: bits 2, 7, 12, 17, 22
  0x842108, // kol 3: bits 3, 8, 13, 18, 23
  0x1084210, // kol 4: bits 4, 9, 14, 19, 24
];

/**
 * Fase 1: én hel rad ELLER én hel kolonne. Kandidat-unionene er alle 5
 * rader + alle 5 kolonner (10 kandidater). `remainingForPattern` tar
 * minimum remaining bits over disse.
 */
export const PHASE_1_MASKS: readonly number[] = [...ROW_MASKS, ...COLUMN_MASKS];

/** Generer alle `k`-kombinasjoner av kolonne-masker som unioner. */
function columnCombinations(k: number): number[] {
  const results: number[] = [];
  const recurse = (start: number, picked: number[]): void => {
    if (picked.length === k) {
      let union = 0;
      for (const idx of picked) union |= COLUMN_MASKS[idx];
      results.push(union);
      return;
    }
    for (let i = start; i < COLUMN_MASKS.length; i++) {
      picked.push(i);
      recurse(i + 1, picked);
      picked.pop();
    }
  };
  recurse(0, []);
  return results;
}

/** Fase 2: 2 hele vertikale kolonner. C(5,2) = 10 kandidater. */
export const PHASE_2_MASKS: readonly number[] = columnCombinations(2);

/** Fase 3: 3 hele vertikale kolonner. C(5,3) = 10 kandidater. */
export const PHASE_3_MASKS: readonly number[] = columnCombinations(3);

/** Fase 4: 4 hele vertikale kolonner. C(5,4) = 5 kandidater. */
export const PHASE_4_MASKS: readonly number[] = columnCombinations(4);

/**
 * Velg maske-sett basert på pattern-navn. Speiler regex-matchen i
 * `BingoEngine.meetsPhaseRequirement` — norske navn er autoritative, men
 * engelske legacy-navn ("Row 1", "Full House") godtas som fallback.
 * Returnerer `null` for ukjent navn — kallende kode bruker da whole-card-
 * telling.
 */
export function getBuiltInPatternMasks(name: string): readonly number[] | null {
  const lc = name.toLowerCase().trim();
  if (/^1\s*rad\b/.test(lc) || /^row\s*1\b/.test(lc)) return PHASE_1_MASKS;
  if (/^2\s*rad/.test(lc) || /^row\s*2\b/.test(lc)) return PHASE_2_MASKS;
  if (/^3\s*rad/.test(lc) || /^row\s*3\b/.test(lc)) return PHASE_3_MASKS;
  if (/^4\s*rad/.test(lc) || /^row\s*4\b/.test(lc)) return PHASE_4_MASKS;
  if (/fullt\s*hus/.test(lc) || /full\s*house/.test(lc) || /coverall/.test(lc)) {
    return [FULL_HOUSE_MASK];
  }
  return null;
}

/**
 * Bygg en 25-bit maske som representerer ticket-state: bits for free center
 * og alle markerte tall er satt. Grid antas 5×5. Celler utenfor 5×5
 * ignoreres (guard mot exotic variants).
 */
export function buildTicketMaskFromGrid(
  grid: ReadonlyArray<ReadonlyArray<number>>,
  marks: ReadonlySet<number>,
): number {
  let mask = 0;
  const rows = Math.min(grid.length, 5);
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    const cols = Math.min(row.length, 5);
    for (let c = 0; c < cols; c++) {
      const n = row[c];
      const bit = 1 << (r * 5 + c);
      if (n === 0) {
        mask |= bit; // free center
      } else if (marks.has(n)) {
        mask |= bit;
      }
    }
  }
  return mask;
}

/** Popcount for 25-bit mask. Enkel bit-loop — 25 iter holder lenge. */
function popCount25(v: number): number {
  let c = 0;
  for (let i = 0; i < 25; i++) if (v & (1 << i)) c++;
  return c;
}

/**
 * Hvor mange celler mangler for å fullføre pattern `patternName` på denne
 * bongen? Returnerer minimum over alle kandidat-masker (f.eks. for "1 Rad"
 * 10 rader+kolonner → velg den nærmest fullført).
 *
 * Returnerer `null` for ukjent pattern — kallende kode faller tilbake til
 * whole-card-telling.
 */
export function remainingForPattern(
  grid: ReadonlyArray<ReadonlyArray<number>>,
  marks: ReadonlySet<number>,
  patternName: string,
): number | null {
  const candidates = getBuiltInPatternMasks(patternName);
  if (!candidates || candidates.length === 0) return null;
  const ticketMask = buildTicketMaskFromGrid(grid, marks);
  let min = Infinity;
  for (const candidate of candidates) {
    const missing = popCount25(candidate & ~ticketMask);
    if (missing < min) min = missing;
    if (min === 0) return 0; // fullført — kan stoppe tidlig
  }
  return min === Infinity ? null : min;
}

/**
 * Finn første fase som ikke er vunnet (sortert etter `order`). Returnerer
 * null når alle faser er vunnet eller lista er tom.
 */
export function activePatternFromState(
  patterns: readonly PatternDefinition[] | undefined,
  patternResults: readonly PatternResult[] | undefined,
): PatternDefinition | null {
  if (!patterns || patterns.length === 0) return null;
  const results = patternResults ?? [];
  const wonIds = new Set(results.filter((r) => r.isWon).map((r) => r.patternId));
  const sorted = [...patterns].sort((a, b) => a.order - b.order);
  for (const p of sorted) {
    if (!wonIds.has(p.id)) return p;
  }
  return null;
}
