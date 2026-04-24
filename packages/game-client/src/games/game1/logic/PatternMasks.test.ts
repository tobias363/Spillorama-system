import { describe, it, expect } from "vitest";
import {
  FULL_HOUSE_MASK,
  ROW_MASKS,
  COLUMN_MASKS,
  PHASE_1_MASKS,
  PHASE_2_MASKS,
  PHASE_3_MASKS,
  PHASE_4_MASKS,
  getBuiltInPatternMasks,
  buildTicketMaskFromGrid,
  remainingForPattern,
  activePatternFromState,
} from "./PatternMasks.js";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";

// ── Grid-utilities ──────────────────────────────────────────────────────────

/** Standard Norsk 75-bingo test-grid. Free center = 0. */
const GRID_A: number[][] = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

function setOf(...ns: number[]): Set<number> {
  return new Set(ns);
}

// ── Maske-antall / form ─────────────────────────────────────────────────────

describe("PatternMasks — maske-antall", () => {
  it("5 rader", () => {
    expect(ROW_MASKS.length).toBe(5);
  });
  it("5 kolonner", () => {
    expect(COLUMN_MASKS.length).toBe(5);
  });
  it("PHASE_1: 5 rader + 5 kolonner = 10 kandidater", () => {
    expect(PHASE_1_MASKS.length).toBe(10);
  });
  it("PHASE_2: C(5,2) = 10 kombinasjoner av kolonner", () => {
    expect(PHASE_2_MASKS.length).toBe(10);
  });
  it("PHASE_3: C(5,3) = 10 kombinasjoner av kolonner", () => {
    expect(PHASE_3_MASKS.length).toBe(10);
  });
  it("PHASE_4: C(5,4) = 5 kombinasjoner av kolonner", () => {
    expect(PHASE_4_MASKS.length).toBe(5);
  });
  it("FULL_HOUSE_MASK dekker alle 25 bits", () => {
    expect(FULL_HOUSE_MASK).toBe(0x1ffffff);
  });
});

describe("PatternMasks — maskene har riktig bit-count", () => {
  const popCount = (v: number) => {
    let c = 0;
    for (let i = 0; i < 25; i++) if (v & (1 << i)) c++;
    return c;
  };
  it("hver rad har 5 bits", () => {
    for (const m of ROW_MASKS) expect(popCount(m)).toBe(5);
  });
  it("hver kolonne har 5 bits", () => {
    for (const m of COLUMN_MASKS) expect(popCount(m)).toBe(5);
  });
  it("fase 2 (2 kolonner) har 10 bits per kandidat", () => {
    for (const m of PHASE_2_MASKS) expect(popCount(m)).toBe(10);
  });
  it("fase 3 (3 kolonner) har 15 bits per kandidat", () => {
    for (const m of PHASE_3_MASKS) expect(popCount(m)).toBe(15);
  });
  it("fase 4 (4 kolonner) har 20 bits per kandidat", () => {
    for (const m of PHASE_4_MASKS) expect(popCount(m)).toBe(20);
  });
});

// ── Name-matching (speil av backend meetsPhaseRequirement) ──────────────────

describe("getBuiltInPatternMasks — norske navn", () => {
  it('"1 Rad" → PHASE_1_MASKS', () => {
    expect(getBuiltInPatternMasks("1 Rad")).toBe(PHASE_1_MASKS);
  });
  it('"2 Rader" → PHASE_2_MASKS', () => {
    expect(getBuiltInPatternMasks("2 Rader")).toBe(PHASE_2_MASKS);
  });
  it('"3 Rader" → PHASE_3_MASKS', () => {
    expect(getBuiltInPatternMasks("3 Rader")).toBe(PHASE_3_MASKS);
  });
  it('"4 Rader" → PHASE_4_MASKS', () => {
    expect(getBuiltInPatternMasks("4 Rader")).toBe(PHASE_4_MASKS);
  });
  it('"Fullt Hus" → [FULL_HOUSE_MASK]', () => {
    const m = getBuiltInPatternMasks("Fullt Hus");
    expect(m).toEqual([FULL_HOUSE_MASK]);
  });
  it("case-insensitive", () => {
    expect(getBuiltInPatternMasks("1 RAD")).toBe(PHASE_1_MASKS);
    expect(getBuiltInPatternMasks("fullt hus")).toEqual([FULL_HOUSE_MASK]);
  });
});

describe("getBuiltInPatternMasks — engelske fallback", () => {
  it('"Row 1" → PHASE_1_MASKS', () => {
    expect(getBuiltInPatternMasks("Row 1")).toBe(PHASE_1_MASKS);
  });
  it('"Full House" → [FULL_HOUSE_MASK]', () => {
    expect(getBuiltInPatternMasks("Full House")).toEqual([FULL_HOUSE_MASK]);
  });
  it('"Coverall" → [FULL_HOUSE_MASK]', () => {
    expect(getBuiltInPatternMasks("Coverall")).toEqual([FULL_HOUSE_MASK]);
  });
  it("ukjent navn → null", () => {
    expect(getBuiltInPatternMasks("Stjerne")).toBeNull();
    expect(getBuiltInPatternMasks("")).toBeNull();
  });
});

// ── buildTicketMaskFromGrid ──────────────────────────────────────────────────

describe("buildTicketMaskFromGrid", () => {
  it("tomt mark-sett → kun free center (bit 12)", () => {
    const mask = buildTicketMaskFromGrid(GRID_A, new Set<number>());
    expect(mask).toBe(1 << 12);
  });
  it("full rad 0 markert → bits 0-4 + bit 12", () => {
    const mask = buildTicketMaskFromGrid(GRID_A, setOf(1, 16, 31, 46, 61));
    expect(mask).toBe(0x1f | (1 << 12));
  });
  it("full kolonne 0 markert → bits 0, 5, 10, 15, 20 + bit 12", () => {
    // kol 0-verdier i GRID_A: 1, 2, 3, 4, 5
    const mask = buildTicketMaskFromGrid(GRID_A, setOf(1, 2, 3, 4, 5));
    expect(mask).toBe(COLUMN_MASKS[0] | (1 << 12));
  });
  it("full bingo → FULL_HOUSE_MASK", () => {
    const allNumbers = new Set<number>();
    for (const row of GRID_A) for (const n of row) if (n !== 0) allNumbers.add(n);
    expect(buildTicketMaskFromGrid(GRID_A, allNumbers)).toBe(FULL_HOUSE_MASK);
  });
});

// ── remainingForPattern ─────────────────────────────────────────────────────

describe("remainingForPattern", () => {
  it('ingen merker → "1 Rad": 4 igjen (rad/kolonne gjennom free center = 4 ubesatte celler)', () => {
    // Rad 2 (inneholder free center) har 4 ubesatte celler (31, 32, 48, 63 — men 0 er free).
    // Kol 2 (inneholder free center) har 4 ubesatte celler (31, 32, 33, 34 — men 0 er free).
    // Begge = 4 igjen.
    expect(remainingForPattern(GRID_A, new Set<number>(), "1 Rad")).toBe(4);
  });
  it('alle i kolonne 2 minus free center → "1 Rad": 0 igjen', () => {
    // Kol 2-verdier: 31, 32, 0 (free), 33, 34 → merker 4 tall, free center + 4 markerte = 5.
    const marks = setOf(31, 32, 33, 34);
    expect(remainingForPattern(GRID_A, marks, "1 Rad")).toBe(0);
  });
  it('"1 Rad": én rad nesten ferdig er bedre enn én kolonne nesten ferdig', () => {
    // Merk 4 av 5 tall i rad 0 (1, 16, 31, 46) → rad 0 mangler 1 (bit 4 = tall 61).
    // Ingen kolonne like nær. Svar = 1.
    const marks = setOf(1, 16, 31, 46);
    expect(remainingForPattern(GRID_A, marks, "1 Rad")).toBe(1);
  });
  it('"2 Rader": tomt kort → 9 igjen (rad 2 har free center, annen rad 5 ubits)', () => {
    // Regel-endring 2026-04-24: fase 2 = 2 horisontale rader.
    // Beste par: rad 2 (4 unmarked, bit 12 er free) + en annen rad (5 unmarked) = 9.
    expect(remainingForPattern(GRID_A, new Set<number>(), "2 Rader")).toBe(9);
  });
  it('"2 Rader": 2 fulle rader merket → 0 igjen', () => {
    // Rad 0 på GRID_A: 1, 16, 31, 46, 61. Rad 1: 2, 17, 32, 47, 62.
    const marks = setOf(1, 16, 31, 46, 61, 2, 17, 32, 47, 62);
    expect(remainingForPattern(GRID_A, marks, "2 Rader")).toBe(0);
  });
  it('"2 Rader": 2 fulle KOLONNER merker IKKE (fase 2 krever rader)', () => {
    // Regel-endring 2026-04-24: fase 2/3/4 = horisontale rader, ikke kolonner.
    // Kol 0: 1, 2, 3, 4, 5. Kol 1: 16, 17, 18, 19, 20. Begge fulle kolonner.
    // Beste rad-par: rad 2 har bit 12 (free) + bit 10 (3) + bit 11 (18) = 3 markert,
    //   mangler bit 13, 14. Andre rader har 2 markert av 5 = mangler 3.
    //   Beste: rad 2 + en annen rad = 2+3 = 5 markerte. Mangler 5.
    expect(remainingForPattern(GRID_A, setOf(1, 2, 3, 4, 5, 16, 17, 18, 19, 20), "2 Rader")).toBe(5);
  });
  it('"Fullt Hus": tomt kort → 24 igjen (alle minus free center)', () => {
    expect(remainingForPattern(GRID_A, new Set<number>(), "Fullt Hus")).toBe(24);
  });
  it("ukjent pattern → null", () => {
    expect(remainingForPattern(GRID_A, new Set<number>(), "Stjerne")).toBeNull();
  });
});

// ── activePatternFromState ───────────────────────────────────────────────────

const PATTERN_1_RAD: PatternDefinition = {
  id: "p-1", name: "1 Rad", claimType: "LINE" as const, prizePercent: 0, order: 1, design: 1,
};
const PATTERN_2_RADER: PatternDefinition = {
  id: "p-2", name: "2 Rader", claimType: "LINE" as const, prizePercent: 0, order: 2, design: 2,
};
const PATTERN_FULLT_HUS: PatternDefinition = {
  id: "p-5", name: "Fullt Hus", claimType: "BINGO" as const, prizePercent: 0, order: 5, design: 0,
};
const ALL_PATTERNS = [PATTERN_1_RAD, PATTERN_2_RADER, PATTERN_FULLT_HUS];

describe("activePatternFromState", () => {
  it("tom patterns → null", () => {
    expect(activePatternFromState([], [])).toBeNull();
    expect(activePatternFromState(undefined, undefined)).toBeNull();
  });
  it("ingen vunnet → første pattern etter order", () => {
    expect(activePatternFromState(ALL_PATTERNS, [])).toEqual(PATTERN_1_RAD);
  });
  it("fase 1 vunnet → fase 2 aktiv", () => {
    const results: PatternResult[] = [
      { patternId: "p-1", patternName: "1 Rad", claimType: "LINE" as const, isWon: true },
    ];
    expect(activePatternFromState(ALL_PATTERNS, results)).toEqual(PATTERN_2_RADER);
  });
  it("fase 1+2 vunnet, fase 5 gjenstår → Fullt Hus aktiv", () => {
    const results: PatternResult[] = [
      { patternId: "p-1", patternName: "1 Rad", claimType: "LINE" as const, isWon: true },
      { patternId: "p-2", patternName: "2 Rader", claimType: "LINE" as const, isWon: true },
    ];
    expect(activePatternFromState(ALL_PATTERNS, results)).toEqual(PATTERN_FULLT_HUS);
  });
  it("alle vunnet → null", () => {
    const results: PatternResult[] = ALL_PATTERNS.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: true,
    }));
    expect(activePatternFromState(ALL_PATTERNS, results)).toBeNull();
  });
  it("uordnet input sorteres etter order", () => {
    const shuffled = [PATTERN_FULLT_HUS, PATTERN_1_RAD, PATTERN_2_RADER];
    expect(activePatternFromState(shuffled, [])).toEqual(PATTERN_1_RAD);
  });
  it("isWon: false i results teller som ikke-vunnet", () => {
    const results: PatternResult[] = [
      { patternId: "p-1", patternName: "1 Rad", claimType: "LINE" as const, isWon: false },
    ];
    expect(activePatternFromState(ALL_PATTERNS, results)).toEqual(PATTERN_1_RAD);
  });
});
