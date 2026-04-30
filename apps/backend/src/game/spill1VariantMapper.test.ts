/**
 * Unit-tester for spill1VariantMapper.
 *
 * Bruker node:test for å matche resten av backend. Dekker:
 *   - Fallback-atferd (null/undefined/tom input)
 *   - PR A-format (mode+amount) for fixed og percent
 *   - Legacy-number backward-compat
 *   - Manglende entries faller tilbake per-fase
 *   - Slug → TicketTypeConfig mapping
 *   - Defensive skip av ukjente slugs + deduplikering
 *   - Jackpot-mapping (maks-pris)
 *   - resolvePatternsForColor med default-fallback + warning-hook
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVariantConfigFromSpill1Config,
  resolvePatternsForColor,
  type Spill1ConfigInput,
} from "./spill1VariantMapper.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  DEFAULT_QUICKBINGO_CONFIG,
  PATTERNS_BY_COLOR_DEFAULT_KEY,
  type GameVariantConfig,
} from "./variantConfig.js";

// ── Fallback ────────────────────────────────────────────────────────────────

test("buildVariantConfigFromSpill1Config: undefined input → fallback med __default__", () => {
  const vc = buildVariantConfigFromSpill1Config(undefined);
  assert.deepEqual(vc.ticketTypes, DEFAULT_NORSK_BINGO_CONFIG.ticketTypes);
  assert.ok(vc.patternsByColor?.[PATTERNS_BY_COLOR_DEFAULT_KEY]);
  assert.deepEqual(
    vc.patternsByColor?.[PATTERNS_BY_COLOR_DEFAULT_KEY],
    DEFAULT_NORSK_BINGO_CONFIG.patterns,
  );
});

test("buildVariantConfigFromSpill1Config: null og tom config → fallback", () => {
  for (const input of [null, {} as Spill1ConfigInput]) {
    const vc = buildVariantConfigFromSpill1Config(input);
    assert.ok(vc.patternsByColor?.[PATTERNS_BY_COLOR_DEFAULT_KEY]);
    assert.ok(vc.ticketTypes.length > 0);
  }
});

// ── PR A-format ─────────────────────────────────────────────────────────────

test("PR A fixed-mode → winningType='fixed' + prize1", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_white",
        priceNok: 20,
        prizePerPattern: {
          row_1: { mode: "fixed", amount: 100 },
          row_2: { mode: "fixed", amount: 200 },
          full_house: { mode: "fixed", amount: 1000 },
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const smallWhite = vc.patternsByColor?.["Small White"];
  assert.ok(smallWhite, "Small White matrise må finnes");
  assert.equal(smallWhite[0].name, "1 Rad");
  assert.equal(smallWhite[0].claimType, "LINE");
  assert.equal(smallWhite[0].winningType, "fixed");
  assert.equal(smallWhite[0].prize1, 100);
  assert.equal(smallWhite[0].prizePercent, 0);
  assert.equal(smallWhite[4].name, "Fullt Hus");
  assert.equal(smallWhite[4].claimType, "BINGO");
  assert.equal(smallWhite[4].winningType, "fixed");
  assert.equal(smallWhite[4].prize1, 1000);
});

test("PR A percent-mode → prizePercent (ingen winningType)", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 15,
        prizePerPattern: {
          row_1: { mode: "percent", amount: 15 },
          full_house: { mode: "percent", amount: 40 },
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const yellow = vc.patternsByColor?.["Small Yellow"];
  assert.ok(yellow);
  assert.equal(yellow[0].name, "1 Rad");
  assert.equal(yellow[0].prizePercent, 15);
  assert.equal(yellow[0].winningType, undefined);
  assert.equal(yellow[4].prizePercent, 40);
});

test("per-farge matrise når flere farger konfigureres", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 15,
        prizePerPattern: { row_1: { mode: "fixed", amount: 50 } },
      },
      {
        color: "small_white",
        priceNok: 20,
        prizePerPattern: { row_1: { mode: "fixed", amount: 100 } },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.equal(vc.patternsByColor?.["Small Yellow"]?.[0].prize1, 50);
  assert.equal(vc.patternsByColor?.["Small White"]?.[0].prize1, 100);
  assert.deepEqual(
    vc.patternsByColor?.[PATTERNS_BY_COLOR_DEFAULT_KEY],
    DEFAULT_NORSK_BINGO_CONFIG.patterns,
  );
});

// ── Legacy-number backward-compat ───────────────────────────────────────────

test("legacy plain number → percent-mode", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_white",
        priceNok: 20,
        prizePerPattern: {
          row_1: 10 as unknown as number,
          full_house: 50 as unknown as number,
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const white = vc.patternsByColor?.["Small White"];
  assert.ok(white);
  assert.equal(white[0].prizePercent, 10);
  assert.equal(white[0].winningType, undefined);
  assert.equal(white[4].prizePercent, 50);
});

test("legacy NaN/negative number → fallback-fase", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_white",
        priceNok: 20,
        prizePerPattern: {
          row_1: Number.NaN as unknown as number,
          row_2: -5 as unknown as number,
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const white = vc.patternsByColor?.["Small White"];
  assert.ok(white);
  // DEFAULT_NORSK_BINGO_CONFIG 1 Rad = fixed 100.
  assert.equal(white[0].prize1, 100);
  assert.equal(white[0].winningType, "fixed");
});

// ── Manglende entries ───────────────────────────────────────────────────────

test("manglende fase-entry bruker fallback for den fasen", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_white",
        priceNok: 20,
        prizePerPattern: { row_1: { mode: "fixed", amount: 50 } },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const white = vc.patternsByColor?.["Small White"];
  assert.ok(white);
  assert.equal(white[0].prize1, 50);
  // row_2 fallback fra DEFAULT = fixed 200 kr.
  assert.equal(white[1].prize1, 200);
  assert.equal(white[1].winningType, "fixed");
  assert.equal(white[1].name, "2 Rader");
  assert.equal(white[4].prize1, 1000);
});

test("farge uten prizePerPattern bruker hele fallback-matrisen", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [{ color: "small_purple", priceNok: 10 }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const purple = vc.patternsByColor?.["Small Purple"];
  assert.ok(purple);
  assert.equal(purple[0].name, "1 Rad");
  assert.equal(purple[0].prize1, 100);
  assert.equal(purple[0].winningType, "fixed");
  assert.equal(purple[4].name, "Fullt Hus");
  assert.equal(purple[4].prize1, 1000);
});

// ── Ticket-types ────────────────────────────────────────────────────────────

test("mapper small/large/elvis slug til riktig TicketTypeConfig", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      { color: "small_yellow", priceNok: 15 },
      { color: "large_white", priceNok: 45 },
      { color: "elvis1", priceNok: 30 },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.deepEqual(
    vc.ticketTypes.map((t) => t.name),
    ["Small Yellow", "Large White", "Elvis 1"],
  );
  const small = vc.ticketTypes.find((t) => t.name === "Small Yellow");
  const large = vc.ticketTypes.find((t) => t.name === "Large White");
  const elvis = vc.ticketTypes.find((t) => t.name === "Elvis 1");
  assert.equal(small?.type, "small");
  assert.equal(small?.priceMultiplier, 1);
  assert.equal(large?.type, "large");
  assert.equal(large?.priceMultiplier, 3);
  assert.equal(elvis?.type, "elvis");
  assert.equal(elvis?.priceMultiplier, 2);
});

test("hopper over ukjent farge-slug", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      { color: "small_yellow", priceNok: 15 },
      { color: "mystery_color", priceNok: 99 },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.deepEqual(vc.ticketTypes.map((t) => t.name), ["Small Yellow"]);
  assert.equal(vc.patternsByColor?.["mystery_color"], undefined);
});

test("dedupliserer duplikat-farger", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [
      { color: "small_yellow", priceNok: 15 },
      { color: "small_yellow", priceNok: 25 },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.equal(vc.ticketTypes.length, 1);
});

test("fallback-ticketTypes når ingen farger er valgt", () => {
  const vc = buildVariantConfigFromSpill1Config({ ticketColors: [] });
  assert.deepEqual(vc.ticketTypes, DEFAULT_NORSK_BINGO_CONFIG.ticketTypes);
});

// ── Jackpot ─────────────────────────────────────────────────────────────────

test("jackpot: per-farge-map → engine single-prize (maks)", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [{ color: "small_white", priceNok: 20 }],
    jackpot: {
      draw: 55,
      prizeByColor: { small_white: 10000, small_yellow: 25000 },
    },
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.deepEqual(vc.jackpot, { drawThreshold: 55, prize: 25000, isDisplay: true });
});

test("jackpot: alle 0-priser → null (fallback)", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [{ color: "small_white", priceNok: 20 }],
    jackpot: { draw: 55, prizeByColor: { small_white: 0 } },
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.equal(vc.jackpot, undefined);
});

// ── resolvePatternsForColor ────────────────────────────────────────────────

test("resolvePatternsForColor: returnerer farge-spesifikk matrise", () => {
  const vc = buildVariantConfigFromSpill1Config({
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 15,
        prizePerPattern: { row_1: { mode: "fixed", amount: 50 } },
      },
    ],
  });
  const patterns = resolvePatternsForColor(vc, "Small Yellow");
  assert.equal(patterns[0].prize1, 50);
});

test("resolvePatternsForColor: ukjent farge → __default__ uten warning", () => {
  const vc = buildVariantConfigFromSpill1Config({
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 15,
        prizePerPattern: { row_1: { mode: "fixed", amount: 50 } },
      },
    ],
  });
  let warnCalled = false;
  const patterns = resolvePatternsForColor(vc, "Small Purple", () => {
    warnCalled = true;
  });
  // __default__ = 100 kr 1 Rad.
  assert.equal(patterns[0].prize1, 100);
  // Fargen er IKKE i ticketTypes → ingen warning.
  assert.equal(warnCalled, false);
});

test("resolvePatternsForColor: warner når default brukes for farge i ticketTypes", () => {
  const vc = buildVariantConfigFromSpill1Config({
    ticketColors: [
      { color: "small_yellow", priceNok: 15 },
      { color: "small_white", priceNok: 20 },
    ],
  });
  // Slett en oppføring for å simulere konfig-gap.
  delete vc.patternsByColor?.["Small White"];
  let warnedColor: string | null = null;
  resolvePatternsForColor(vc, "Small White", (c) => {
    warnedColor = c;
  });
  assert.equal(warnedColor, "Small White");
});

test("resolvePatternsForColor: returnerer flat patterns[] når patternsByColor er undefined", () => {
  const vc: GameVariantConfig = {
    ticketTypes: DEFAULT_NORSK_BINGO_CONFIG.ticketTypes,
    patterns: DEFAULT_NORSK_BINGO_CONFIG.patterns,
  };
  const patterns = resolvePatternsForColor(vc, "Small White");
  assert.equal(patterns, vc.patterns);
});

// ── BIN-689: Kvikkis-routing ────────────────────────────────────────────────

test("BIN-689: subVariant='kvikkis' → DEFAULT_QUICKBINGO_CONFIG brukes som default-fallback", () => {
  const input: Spill1ConfigInput = {
    subVariant: "kvikkis",
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: {
          full_house: { mode: "fixed", amount: 1000 },
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  // Fallback-patterns er Kvikkis-styled (1-entry), ikke 5-fase.
  assert.equal(vc.patterns.length, 1, "Kvikkis skal ha kun én pattern");
  assert.equal(vc.patterns[0].name, "Fullt Hus");
  // Per-farge-matrise for Small Yellow har også kun Fullt Hus.
  const smallYellowPatterns = vc.patternsByColor?.["Small Yellow"];
  assert.ok(smallYellowPatterns);
  assert.equal(smallYellowPatterns!.length, 1);
  assert.equal(smallYellowPatterns![0].name, "Fullt Hus");
  assert.equal(smallYellowPatterns![0].winningType, "fixed");
  assert.equal(smallYellowPatterns![0].prize1, 1000);
});

test("BIN-689: subVariant='norsk-bingo' → DEFAULT_NORSK_BINGO_CONFIG brukes (default-path)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "norsk-bingo",
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: {
          row_1: { mode: "fixed", amount: 100 },
          full_house: { mode: "fixed", amount: 1000 },
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  // Norsk 5-fase.
  assert.equal(vc.patterns.length, 5);
  const smallYellowPatterns = vc.patternsByColor?.["Small Yellow"];
  assert.ok(smallYellowPatterns);
  assert.equal(smallYellowPatterns!.length, 5);
});

test("BIN-689: subVariant undefined → norsk-bingo-default (bakoverkompat med legacy-config)", () => {
  const input: Spill1ConfigInput = {
    ticketColors: [{ color: "small_yellow", priceNok: 20, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.equal(vc.patterns.length, 5, "ingen subVariant → default til 5-fase");
});

test("BIN-689: Kvikkis — eksplisitt fallback respekteres (backward-compat for tester)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "kvikkis",
    ticketColors: [],
  };
  // Når caller eksplisitt gir fallback, ignoreres subVariant-routing.
  const vc = buildVariantConfigFromSpill1Config(input, DEFAULT_NORSK_BINGO_CONFIG);
  assert.equal(vc.patterns.length, 5, "eksplisitt fallback overstyrer subVariant");
});

test("BIN-689: Kvikkis — jackpot-feltet overføres som før", () => {
  const input: Spill1ConfigInput = {
    subVariant: "kvikkis",
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: { full_house: { mode: "fixed", amount: 1000 } },
      },
    ],
    jackpot: {
      prizeByColor: { small_yellow: 10000 },
      draw: 55,
    },
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  assert.ok(vc.jackpot);
  assert.equal(vc.jackpot!.drawThreshold, 55);
  assert.equal(vc.jackpot!.prize, 10000);
});

// Sanity: DEFAULT_QUICKBINGO_CONFIG is imported for test usage.
test("BIN-689: DEFAULT_QUICKBINGO_CONFIG-import er bundet (smoke)", () => {
  assert.equal(DEFAULT_QUICKBINGO_CONFIG.patterns.length, 1);
});

// ── Bølge K4: Preset-variant-mapper (5 nye sub-varianter) ──────────────────
//
// Disse testene dekker integrasjonen mellom admin-UI subVariant-valg og
// backend PatternConfig. For hver av de 5 preset-variantene verifiseres:
//   - Riktig antall patterns genereres
//   - winningType er korrekt satt per fase
//   - Papir-regel-beløp er speilet eksakt
//   - patternsByColor får preset-verdier for alle valgte farger
//   - TV Extra: customPatterns brukes i stedet for patternsByColor

test("K4: subVariant='kvikkis' → 1 fixed-pattern med 1000 kr (ingen admin-override)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "kvikkis",
    ticketColors: [{ color: "small_yellow", priceNok: 20, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  // Preset: 1 pattern (Fullt Hus) per farge.
  const perColor = vc.patternsByColor?.["Small Yellow"];
  assert.ok(perColor, "Small Yellow skal ha preset-patterns");
  assert.equal(perColor!.length, 1);
  assert.equal(perColor![0]!.name, "Fullt Hus");
  assert.equal(perColor![0]!.winningType, "fixed");
  assert.equal(perColor![0]!.prize1, 1000);
});

test("K4: subVariant='kvikkis' ignorerer admin prizePerPattern-override (preset er autoritativ)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "kvikkis",
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        // Admin prøver å overstyre — preset skal vinne.
        prizePerPattern: { full_house: { mode: "fixed", amount: 99999 } },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"];
  assert.equal(perColor![0]!.prize1, 1000, "preset 1000 kr, ikke admin 99999 kr");
});

test("K4: subVariant='ball-x-10' → Fullt Hus = ball-value-multiplier (1250 + ball×10)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "ball-x-10",
    ticketColors: [{ color: "small_yellow", priceNok: 30, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5, "Ball × 10 beholder 5 sekvensielle faser");
  const fullHouse = perColor[4]!;
  assert.equal(fullHouse.winningType, "ball-value-multiplier");
  assert.equal(fullHouse.baseFullHousePrizeNok, 1250);
  assert.equal(fullHouse.ballValueMultiplier, 10);
});

test("K4: subVariant='super-nils' → Fullt Hus = column-specific (B=500 I=700 N=1000 G=700 O=500)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "super-nils",
    ticketColors: [{ color: "small_yellow", priceNok: 30, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5);
  const fullHouse = perColor[4]!;
  assert.equal(fullHouse.winningType, "column-specific");
  assert.deepEqual(fullHouse.columnPrizesNok, {
    B: 500,
    I: 700,
    N: 1000,
    G: 700,
    O: 500,
  });
});

test("K4: subVariant='spillernes-spill' → 5 multiplier-chain-patterns m/ riktig multipliers", () => {
  const input: Spill1ConfigInput = {
    subVariant: "spillernes-spill",
    ticketColors: [{ color: "small_yellow", priceNok: 50, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5);
  for (const p of perColor) {
    assert.equal(p.winningType, "multiplier-chain");
  }
  assert.equal(perColor[0]!.prizePercent, 3, "fase 1 = 3% av pool");
  assert.equal(perColor[0]!.phase1Multiplier, undefined, "fase 1 er cascade-base");
  assert.equal(perColor[1]!.phase1Multiplier, 2);
  assert.equal(perColor[2]!.phase1Multiplier, 3);
  assert.equal(perColor[3]!.phase1Multiplier, 4);
  assert.equal(perColor[4]!.phase1Multiplier, 10);
  // Min-gulv: 50/50/100/100/500.
  assert.equal(perColor[0]!.minPrize, 50);
  assert.equal(perColor[4]!.minPrize, 500);
});

test("K4: subVariant='tv-extra' → customPatterns settes, patternsByColor DROPPES", () => {
  const input: Spill1ConfigInput = {
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  // TV Extra bruker customPatterns, ikke sekvensielle patterns.
  assert.ok(vc.customPatterns, "customPatterns skal settes");
  assert.equal(vc.customPatterns!.length, 3);
  // patternsByColor må være droppet (mutually exclusive i engine).
  assert.equal(
    vc.patternsByColor,
    undefined,
    "patternsByColor skal være fraværende for TV Extra",
  );
  // Flat patterns-array skal være tom (customPatterns er autoritativ).
  assert.equal(vc.patterns.length, 0);
});

test("K4: TV Extra customPatterns har Bilde/Ramme/Fullt Hus med 500/1000/3000 kr", () => {
  const input: Spill1ConfigInput = {
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const custom = vc.customPatterns!;
  const byId = new Map(custom.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")?.prize1, 500);
  assert.equal(byId.get("ramme")?.prize1, 1000);
  assert.equal(byId.get("full_house")?.prize1, 3000);
  // Alle skal ha winningType: "fixed" og concurrent: true.
  for (const cp of custom) {
    assert.equal(cp.winningType, "fixed");
    assert.equal(cp.concurrent, true);
    assert.ok(cp.mask > 0);
  }
});

test("K4: subVariant='standard' → 5 fixed-patterns m/ 100/200/200/200/1000 kr", () => {
  const input: Spill1ConfigInput = {
    subVariant: "standard",
    ticketColors: [{ color: "small_yellow", priceNok: 20, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5);
  const amounts = perColor.map((p) => p.prize1);
  assert.deepEqual(amounts, [100, 200, 200, 200, 1000]);
});

test("K4: preset-variant — flere farger får samme preset-patterns", () => {
  const input: Spill1ConfigInput = {
    subVariant: "super-nils",
    ticketColors: [
      { color: "small_yellow", priceNok: 30, prizePerPattern: {} },
      { color: "small_white", priceNok: 30, prizePerPattern: {} },
      { color: "small_purple", priceNok: 30, prizePerPattern: {} },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const yellow = vc.patternsByColor?.["Small Yellow"]!;
  const white = vc.patternsByColor?.["Small White"]!;
  const purple = vc.patternsByColor?.["Small Purple"]!;
  for (const palette of [yellow, white, purple]) {
    assert.equal(palette[4]!.winningType, "column-specific");
    assert.deepEqual(palette[4]!.columnPrizesNok, {
      B: 500, I: 700, N: 1000, G: 700, O: 500,
    });
  }
});

test("K4: subVariant='norsk-bingo' beholder legacy-semantikk (admin prizePerPattern respekteres)", () => {
  // norsk-bingo er IKKE en preset — admin kan overstyre beløp per farge.
  const input: Spill1ConfigInput = {
    subVariant: "norsk-bingo",
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: {
          row_1: { mode: "fixed", amount: 150 }, // override
          full_house: { mode: "fixed", amount: 1500 }, // override
        },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor[0]!.prize1, 150, "admin override respekteres for norsk-bingo");
  assert.equal(perColor[4]!.prize1, 1500);
});

test("K4: ukjent subVariant-verdi → fallback til norsk-bingo-legacy-path", () => {
  const input = {
    subVariant: "not-a-real-variant",
    ticketColors: [{ color: "small_yellow", priceNok: 20, prizePerPattern: {} }],
  } as unknown as Spill1ConfigInput;
  const vc = buildVariantConfigFromSpill1Config(input);
  // Ingen preset → faller tilbake til default 5 patterns.
  assert.equal(vc.patternsByColor?.["Small Yellow"]?.length, 5);
});

test("K4: eksplisitt fallback overrider preset-routing (test-API bakoverkompat)", () => {
  // Når caller angir eksplisitt fallback, skal preset-pathen IKKE aktiveres.
  // Bevarer den eksisterende Kvikkis-test-oppførselen for BIN-689.
  const input: Spill1ConfigInput = {
    subVariant: "ball-x-10",
    ticketColors: [{ color: "small_yellow", priceNok: 30, prizePerPattern: {} }],
  };
  const vc = buildVariantConfigFromSpill1Config(input, DEFAULT_NORSK_BINGO_CONFIG);
  // Fallback brukes → 5 default-patterns, ingen ball-value-multiplier.
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5);
  const fullHouse = perColor[4]!;
  assert.notEqual(fullHouse.winningType, "ball-value-multiplier");
});

test("K4: preset-pattern-navn matcher engine-regex (Fullt Hus, N Rad/Rader, Bilde, Ramme)", () => {
  for (const sv of ["kvikkis", "ball-x-10", "super-nils", "spillernes-spill", "standard"] as const) {
    const vc = buildVariantConfigFromSpill1Config({
      subVariant: sv,
      ticketColors: [{ color: "small_yellow", priceNok: 20, prizePerPattern: {} }],
    });
    const pats = vc.patternsByColor?.["Small Yellow"] ?? [];
    for (const p of pats) {
      const ok =
        p.name === "1 Rad" ||
        p.name === "2 Rader" ||
        p.name === "3 Rader" ||
        p.name === "4 Rader" ||
        p.name === "Fullt Hus";
      assert.ok(ok, `ukjent pattern-navn for ${sv}: ${p.name}`);
    }
  }
  // TV Extra-sjekk separat siden den bruker customPatterns.
  const tv = buildVariantConfigFromSpill1Config({
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30, prizePerPattern: {} }],
  });
  for (const cp of tv.customPatterns ?? []) {
    const ok =
      cp.name === "Bilde" ||
      cp.name === "Ramme" ||
      cp.name === "Fullt Hus";
    assert.ok(ok, `ukjent TV Extra pattern-navn: ${cp.name}`);
  }
});

test("K4: preset-variant renderer design-felt korrekt (0=full_house, 1-4=row)", () => {
  const vc = buildVariantConfigFromSpill1Config({
    subVariant: "spillernes-spill",
    ticketColors: [{ color: "small_yellow", priceNok: 50, prizePerPattern: {} }],
  });
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor[0]!.design, 1, "1 Rad");
  assert.equal(perColor[1]!.design, 2, "2 Rader");
  assert.equal(perColor[2]!.design, 3, "3 Rader");
  assert.equal(perColor[3]!.design, 4, "4 Rader");
  assert.equal(perColor[4]!.design, 0, "Fullt Hus");
});

test("K4 regresjon: admin-UI som ikke bruker subVariant (tom/undefined) får legacy-oppførsel", () => {
  // Ingen subVariant satt — mapperen skal bruke default 5-fase og
  // respektere admin prizePerPattern hvis gitt.
  const input: Spill1ConfigInput = {
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: { row_1: { mode: "percent", amount: 10 } },
      },
    ],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5);
  assert.equal(perColor[0]!.prizePercent, 10, "percent-mode fra admin respektert");
});

// ── Audit 2026-04-30 (PR #748): Spill1Overrides override-først-fallback ───
// Verifiserer at backend-mapperen leser `spill1Overrides` fra schedule og
// passes til `buildSubVariantPresetPatterns`. Dekker TV1/TV2 og SP1.
// Oddsen 56 (O1/O2) går IKKE gjennom denne mapperen — den leses direkte av
// MiniGameOddsenEngine fra OddsenConfig.

test("audit TV1/TV2: tv-extra mapper passer overrides til preset-builder", () => {
  const input: Spill1ConfigInput = {
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30 }],
    spill1Overrides: {
      tvExtra: {
        pictureYellow: 750,
        frameYellow: 1500,
      },
    },
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  // TV Extra bruker customPatterns, ikke patternsByColor[]
  assert.ok(vc.customPatterns);
  const byId = new Map(vc.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")!.prize1, 750, "Picture override flow gjennom mapper");
  assert.equal(byId.get("ramme")!.prize1, 1500, "Frame override flow gjennom mapper");
  // Full House mangler i overrides → default fra SPILL1_SUB_VARIANT_DEFAULTS
  assert.equal(byId.get("full_house")!.prize1, 3000);
});

test("audit TV1/TV2: tv-extra UTEN spill1Overrides bruker uendret default (regresjon)", () => {
  const without: Spill1ConfigInput = {
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30 }],
  };
  const vc = buildVariantConfigFromSpill1Config(without);
  const byId = new Map(vc.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")!.prize1, 500);
  assert.equal(byId.get("ramme")!.prize1, 1000);
  assert.equal(byId.get("full_house")!.prize1, 3000);
});

test("audit SP1: spillernes-spill mapper passer minimumPrize-override", () => {
  const input: Spill1ConfigInput = {
    subVariant: "spillernes-spill",
    ticketColors: [{ color: "small_yellow", priceNok: 50 }],
    spill1Overrides: {
      spillerness2: { minimumPrize: 100 },
    },
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor.length, 5);
  // Phase 1 minPrize skal være override-verdien (100), ikke default (50)
  assert.equal(perColor[0]!.minPrize, 100, "phase-1 minPrize override flow gjennom mapper");
  // Cascade-faser arver default-mins
  assert.equal(perColor[1]!.minPrize, 50);
  assert.equal(perColor[2]!.minPrize, 100);
  assert.equal(perColor[3]!.minPrize, 100);
  assert.equal(perColor[4]!.minPrize, 500);
});

test("audit SP1: spillernes-spill UTEN override bruker default-minPrize=50 (regresjon)", () => {
  const input: Spill1ConfigInput = {
    subVariant: "spillernes-spill",
    ticketColors: [{ color: "small_yellow", priceNok: 50 }],
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  assert.equal(perColor[0]!.minPrize, 50, "default phase-1 minPrize uendret");
});

test("audit: kombinert TV Extra + Spillernes overrides (begge i samme schedule)", () => {
  // Edge-case: én subgame kan ikke være BÅDE TV Extra og Spillernes —
  // men vi tester at overrides for begge er strukturelt valid og at kun
  // den relevante varianten konsumerer sine egne felt.
  const tvInput: Spill1ConfigInput = {
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30 }],
    spill1Overrides: {
      tvExtra: { pictureYellow: 600 },
      spillerness2: { minimumPrize: 200 }, // ignoreres for TV Extra
    },
  };
  const vc = buildVariantConfigFromSpill1Config(tvInput);
  const byId = new Map(vc.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")!.prize1, 600, "TV Extra konsumerer kun tvExtra-override");
});

test("audit regresjon: andre presets (kvikkis, ball-x-10, super-nils) ignorerer overrides", () => {
  const overrides = {
    spill1Overrides: {
      tvExtra: { pictureYellow: 9999 },
      spillerness2: { minimumPrize: 9999 },
    },
  };
  for (const variant of ["kvikkis", "ball-x-10", "super-nils"] as const) {
    const without: Spill1ConfigInput = {
      subVariant: variant,
      ticketColors: [{ color: "small_yellow", priceNok: 30 }],
    };
    const withOverrides: Spill1ConfigInput = { ...without, ...overrides };
    const vcWithout = buildVariantConfigFromSpill1Config(without);
    const vcWith = buildVariantConfigFromSpill1Config(withOverrides);
    assert.deepEqual(
      vcWithout.patternsByColor,
      vcWith.patternsByColor,
      `${variant} skal ignorere TV/SP overrides`,
    );
  }
});

test("audit: spill1Overrides ignoreres når caller har eksplisitt fallback (test-API bakoverkompat)", () => {
  // Eksplisitt fallback overrider preset-routing (per K4-design) — derfor
  // skal også overrides ignoreres når caller bypasser preset-pathen.
  const input: Spill1ConfigInput = {
    subVariant: "tv-extra",
    ticketColors: [{ color: "small_yellow", priceNok: 30 }],
    spill1Overrides: {
      tvExtra: { pictureYellow: 9999, frameYellow: 9999 },
    },
  };
  const vc = buildVariantConfigFromSpill1Config(input, DEFAULT_NORSK_BINGO_CONFIG);
  // Ingen customPatterns siden fallback-pathen aktiveres
  assert.equal(vc.customPatterns, undefined);
});

test("audit: spill1Overrides på 'standard' eller 'norsk-bingo' ignoreres (legacy-path)", () => {
  // Standard-varianter bruker admin-UI prizePerPattern, ikke preset-builder.
  // Override-feltene har ingen effekt fordi preset-pathen ikke aktiveres.
  const input: Spill1ConfigInput = {
    subVariant: "standard",
    ticketColors: [
      {
        color: "small_yellow",
        priceNok: 20,
        prizePerPattern: { row_1: { mode: "fixed", amount: 100 } },
      },
    ],
    spill1Overrides: {
      tvExtra: { pictureYellow: 9999 },
      spillerness2: { minimumPrize: 9999 },
    },
  };
  const vc = buildVariantConfigFromSpill1Config(input);
  const perColor = vc.patternsByColor?.["Small Yellow"]!;
  // Standard-preset bruker hardkodede beløp (100/200/200/200/1000)
  assert.equal(perColor[0]!.prize1, 100);
  assert.equal(perColor[4]!.prize1, 1000);
});
