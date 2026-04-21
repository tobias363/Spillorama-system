/**
 * GAME1_SCHEDULE PR 4c: Server-authoritative 5×5 pattern-evaluator for Spill 1.
 *
 * Bolk 1 i PR 4c. Evaluator som matcher markings-tilstand i en Spill 1-billett
 * mot de 5 fasene i norsk bingo:
 *
 *   Fase 1 "1 Rad"      — Row 1: én horisontal rad (5 celler) ELLER én vertikal
 *                         kolonne (5 celler). Free centre (idx 12) teller som
 *                         markert. Legacy: GameProcess.js:5543-5559 ($or mellom
 *                         rowChecks/columnChecks). Gjelder kun for Row 1.
 *   Fase 2 "2 Rader"    — 2 hele horisontale rader markert. Vertikale kolonner
 *                         teller IKKE etter fase 1. Legacy:5564.
 *   Fase 3 "3 Rader"    — 3 hele horisontale rader.                Legacy:5569.
 *   Fase 4 "4 Rader"    — 4 hele horisontale rader.                Legacy:5574.
 *   Fase 5 "Fullt Hus"  — alle 24 non-centre + centre = 25 markert. Legacy:5579.
 *
 * Design:
 *   - Mask-baserte evalueringer med 25-bit integer (identisk semantikk som
 *     `packages/game-client/src/games/game1/logic/PatternMasks.ts` — men her
 *     portet/kopiert inn i backend for å unngå cross-package-avhengighet
 *     client→backend/core).
 *   - `evaluate(grid, markings, phase)` returnerer `{ isWinner, matchedMask }`.
 *     matchedMask=null hvis ikke vinner.
 *   - Pure funksjoner: ingen DB-access, ingen I/O.
 *
 * Referanse:
 *   - `.claude/legacy-ref/Game1/Controllers/GameProcess.js:5519-5597`
 *     (`checkWinningPattern` — $or av rowChecks + columnChecks for Row 1).
 *   - `packages/game-client/src/games/game1/logic/PatternMasks.ts`
 *     (klient-mirror brukt av BingoTicketHtml til "igjen"-counter).
 *
 * Spill 1 har fem ticket-spesifikke bit-posisjoner:
 *   bit i = row*5 + col, så idx 12 = row 2, col 2 (free centre).
 */

export type PatternMask = number;

/** 25 bits satt — hele kortet markert. */
export const FULL_HOUSE_MASK: PatternMask = 0x1ffffff;

/** Norske 5-fase-navn. Fase 1..5 mapper til phase 1..5 i database. */
export const PHASE_1_ONE_ROW = 1;
export const PHASE_2_TWO_ROWS = 2;
export const PHASE_3_THREE_ROWS = 3;
export const PHASE_4_FOUR_ROWS = 4;
export const PHASE_5_FULL_HOUSE = 5;

/** Total antall faser i Spill 1. */
export const TOTAL_PHASES = 5;

// ── Mask-helpers ────────────────────────────────────────────────────────────

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

/** De 5 horisontale radene (r=0..4). */
const HORIZONTAL_ROW_MASKS: readonly PatternMask[] = Object.freeze([
  horizontalRowMask(0),
  horizontalRowMask(1),
  horizontalRowMask(2),
  horizontalRowMask(3),
  horizontalRowMask(4),
]);

/** De 5 vertikale kolonnene (c=0..4). Kun brukt for fase 1. */
const VERTICAL_COLUMN_MASKS: readonly PatternMask[] = Object.freeze([
  verticalColumnMask(0),
  verticalColumnMask(1),
  verticalColumnMask(2),
  verticalColumnMask(3),
  verticalColumnMask(4),
]);

/**
 * Fase 1 "1 Rad" = én hel horisontal rad ELLER én hel vertikal kolonne.
 * 10 mulige masks (5 rader + 5 kolonner). Legacy GameProcess.js:5543-5559
 * $or mellom rowChecks/columnChecks — gjelder KUN for "Row 1".
 */
const PHASE_1_MASKS: readonly PatternMask[] = Object.freeze([
  ...HORIZONTAL_ROW_MASKS,
  ...VERTICAL_COLUMN_MASKS,
]);

/** Alle 10 kombinasjoner av 2 horisontale rader (C(5,2) = 10). */
const PHASE_2_MASKS: readonly PatternMask[] = Object.freeze(
  buildRowCombinations(2)
);

/** Alle 10 kombinasjoner av 3 horisontale rader (C(5,3) = 10). */
const PHASE_3_MASKS: readonly PatternMask[] = Object.freeze(
  buildRowCombinations(3)
);

/** Alle 5 kombinasjoner av 4 horisontale rader (C(5,4) = 5). */
const PHASE_4_MASKS: readonly PatternMask[] = Object.freeze(
  buildRowCombinations(4)
);

/** Fullt Hus — alle 25 bits. */
const PHASE_5_MASKS: readonly PatternMask[] = Object.freeze([FULL_HOUSE_MASK]);

/**
 * Returnér alle candidate-masks for fase N.
 * Eksport'et for testing + debug.
 */
export function masksForPhase(phase: number): readonly PatternMask[] {
  switch (phase) {
    case PHASE_1_ONE_ROW:
      return PHASE_1_MASKS;
    case PHASE_2_TWO_ROWS:
      return PHASE_2_MASKS;
    case PHASE_3_THREE_ROWS:
      return PHASE_3_MASKS;
    case PHASE_4_FOUR_ROWS:
      return PHASE_4_MASKS;
    case PHASE_5_FULL_HOUSE:
      return PHASE_5_MASKS;
    default:
      return [];
  }
}

/**
 * Bygg en 25-bit maske fra 5×5 grid + markings.
 *
 * Regler:
 *   - Grid er 25 celler flat row-major. Celle=0 er free centre (idx 12) og
 *     teller alltid som markert (selv om markings.marked[12] skulle være
 *     false — defensiv semantikk).
 *   - markings.length må være 25. Kortere → vi bruker det som finnes;
 *     manglende celler tolkes som umarkerte.
 *   - Returnerer 0 hvis grid ikke er gyldig 25-celle-array.
 */
export function buildTicketMask(
  grid: ReadonlyArray<number | null>,
  markings: ReadonlyArray<boolean>
): PatternMask {
  if (grid.length !== 25) return 0;
  let mask = 0;
  for (let i = 0; i < 25; i++) {
    const cell = grid[i];
    if (cell === 0) {
      // Free centre — teller alltid som markert.
      mask |= 1 << i;
      continue;
    }
    if (markings[i] === true) {
      mask |= 1 << i;
    }
  }
  return mask;
}

/**
 * Evaluér billett mot fase N. Returnerer { isWinner, matchedMask }.
 * matchedMask er den FØRSTE masken som oppfyller fasen (for audit).
 */
export function evaluatePhase(
  grid: ReadonlyArray<number | null>,
  markings: ReadonlyArray<boolean>,
  phase: number
): { isWinner: boolean; matchedMask: PatternMask | null } {
  const candidates = masksForPhase(phase);
  if (candidates.length === 0) {
    return { isWinner: false, matchedMask: null };
  }
  const ticketMask = buildTicketMask(grid, markings);
  for (const m of candidates) {
    if ((ticketMask & m) === m) {
      return { isWinner: true, matchedMask: m };
    }
  }
  return { isWinner: false, matchedMask: null };
}

/**
 * Hjelper: hvor mange celler gjenstår før billetten vinner fasen?
 * Velger den BESTE kandidat-masken (minimum gjenværende). Brukt av
 * klient-UI for "igjen"-teller; server kan også bruke denne for diagnostikk.
 */
export function remainingForPhase(
  grid: ReadonlyArray<number | null>,
  markings: ReadonlyArray<boolean>,
  phase: number
): number {
  const candidates = masksForPhase(phase);
  if (candidates.length === 0) return Infinity;
  const ticketMask = buildTicketMask(grid, markings);
  let best = Infinity;
  for (const m of candidates) {
    const need = popcount(m & ~ticketMask);
    if (need < best) best = need;
    if (best === 0) return 0;
  }
  return best;
}

// ── Pure internals ──────────────────────────────────────────────────────────

/** Bygg alle C(5,k) kombinasjoner av horisontale rader OR'et sammen. */
function buildRowCombinations(k: number): PatternMask[] {
  const out: PatternMask[] = [];
  const n = 5;
  const indices = new Array(k).fill(0);
  for (let i = 0; i < k; i++) indices[i] = i;
  while (true) {
    let m = 0;
    for (const r of indices) m |= HORIZONTAL_ROW_MASKS[r]!;
    out.push(m);
    // Neste kombinasjon (lexicographic).
    let i = k - 1;
    while (i >= 0 && indices[i] === i + (n - k)) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
  return out;
}

/** Hamming-weight: antall set-bits i 32-bit integer. */
function popcount(n: number): number {
  let x = n >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}
