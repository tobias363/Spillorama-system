/**
 * Klient-adapter for Spill 1 fase-regler. Kanonisk kilde ligger i
 * `@spillorama/shared-types/spill1-patterns` og deles med backend
 * `BingoEngine.meetsPhaseRequirement` — ingen drift-risiko mellom
 * server- og klient-klassifisering.
 *
 * Denne filen beholder tidligere klient-API (eksport-navn) som thin
 * wrapper over shared-types. Ny kode kan importere direkte fra
 * shared-types.
 */

import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { PATTERN_MASK_FULL, PATTERN_MASK_CENTER_BIT } from "@spillorama/shared-types/game";
import {
  ROW_MASKS,
  COLUMN_MASKS,
  PHASE_1_MASKS,
  PHASE_2_MASKS,
  PHASE_3_MASKS,
  PHASE_4_MASKS,
  PHASE_MASKS,
  classifyPhaseFromPatternName,
  remainingBitsForPhase,
} from "@spillorama/shared-types/spill1-patterns";

export { ROW_MASKS, COLUMN_MASKS, PHASE_1_MASKS, PHASE_2_MASKS, PHASE_3_MASKS, PHASE_4_MASKS };

/** 25-bit heldekke-maske (alle celler). Re-eksport for klient-kompat. */
export const FULL_HOUSE_MASK = PATTERN_MASK_FULL;

/** Bit-indeks for free center (rad 2, kol 2). Re-eksport for klient-kompat. */
export const FREE_CENTER_BIT = PATTERN_MASK_CENTER_BIT;

/**
 * Velg maske-sett basert på pattern-navn. Delegeres til
 * `classifyPhaseFromPatternName` i shared-types — samme klassifisering
 * som backend-matchen i `BingoEngine.meetsPhaseRequirement`.
 * Returnerer `null` for ukjent navn.
 */
export function getBuiltInPatternMasks(name: string): readonly number[] | null {
  const phase = classifyPhaseFromPatternName(name);
  return phase === null ? null : PHASE_MASKS[phase];
}

/**
 * Bygg en 25-bit ticket-state-maske fra klientens grid-representasjon.
 * Bits settes for free center (cell === 0) og alle markerte tall.
 * Grid antas 5×5; celler utenfor ignoreres (guard mot exotic variants).
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
        mask |= bit;
      } else if (marks.has(n)) {
        mask |= bit;
      }
    }
  }
  return mask;
}

/**
 * Hvor mange celler mangler for å fullføre pattern `patternName`?
 * Returnerer minimum over alle kandidat-masker for fasen.
 * Returnerer `null` for ukjent pattern-navn.
 */
export function remainingForPattern(
  grid: ReadonlyArray<ReadonlyArray<number>>,
  marks: ReadonlySet<number>,
  patternName: string,
): number | null {
  const phase = classifyPhaseFromPatternName(patternName);
  if (phase === null) return null;
  const ticketMask = buildTicketMaskFromGrid(grid, marks);
  return remainingBitsForPhase(phase, ticketMask);
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
