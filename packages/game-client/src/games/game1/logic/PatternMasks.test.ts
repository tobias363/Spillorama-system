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
  it('"2 Rader": 2 fulle kolonner minus free center = 4+4-1 (free) = 8 bits nødvendig på tomt kort, 8 igjen', () => {
    // Tomt kort → kol 2 har 4 igjen (free teller). Kol 0 har 5 igjen. Kol 2+kol 0 = 4+5 = 9.
    // Beste kombo: kol 2 + kol 1 eller kol 2 + kol 3 = 4+5 = 9. Eller 2 nabo-kolonner uten center = 5+5 = 10.
    // Minimum skal være kol inkludert center + en annen kol: 4+5 = 9.
    expect(remainingForPattern(GRID_A, new Set<number>(), "2 Rader")).toBe(9);
  });
  it('"2 Rader": 2 fulle kolonner merket → 0 igjen', () => {
    // Kol 0: 1, 2, 3, 4, 5. Kol 1: 16, 17, 18, 19, 20.
    const marks = setOf(1, 2, 3, 4, 5, 16, 17, 18, 19, 20);
    expect(remainingForPattern(GRID_A, marks, "2 Rader")).toBe(0);
  });
  it('"2 Rader": 2 fulle RADER merker IKKE (backend krever kolonner i fase 2)', () => {
    // Rad 0: 1, 16, 31, 46, 61. Rad 1: 2, 17, 32, 47, 62. Begge fulle rader.
    // I kolonne-optikk: bit 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 markert.
    // Beste kolonne-union: kol 2 (bits 2, 7, 12, 17, 22) → bit 12 (free) + bit 2, 7 markert = mangler 17, 22.
    // Kol 2 + kol 0 = bit 12 + 0, 2, 5, 7 markert, mangler 10, 15, 20, 17, 22 = 5.
    // Beste: 2 kolonner hvor flest rader krysser → hvilke 2 kolonner?
    //   Kol a + kol b: markerte bits = {0,1,...,9} ∩ (kol a-maske | kol b-maske) + free.
    //   Kol a har bits r*5+a for r=0..4. Fra bits 0-9 (rad 0+1) treffes bits a og 5+a = 2 bits per kol.
    //   Per kolonne: 2 bits + free (hvis kol 2) = 2 eller 3 bits markert av 5. Mangler 3 eller 2.
    //   Beste: kol 2 + en annen kol = 3 + 2 = 5 markerte av 10. Mangler 5.
    expect(remainingForPattern(GRID_A, setOf(1, 16, 31, 46, 61, 2, 17, 32, 47, 62), "2 Rader")).toBe(5);
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
