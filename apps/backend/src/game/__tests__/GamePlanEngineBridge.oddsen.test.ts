/**
 * Oddsen end-to-end (2026-05-08): bridge-tester for `gameVariant=oddsen`.
 *
 * Dekker `buildTicketConfigFromCatalog` med Oddsen-rules:
 *   - `spill1.oddsen` skrives med targetDraw + bingoLowPrizes + bingoHighPrizes
 *   - Auto-multiplikator anvendes på bingoBaseLow/bingoBaseHigh per bongfarge
 *   - Standard-katalog (uten oddsen) får IKKE `spill1.oddsen` (regresjons-vakt)
 *   - Manglende/invalide rules-felt produserer ingen oddsen-section (fail-safe)
 *   - Jackpot-override + Oddsen-rules sameksisterer i `spill1` uten å overskrive hverandre
 *
 * Spec-referanse: docs/operations/PM_HANDOFF_2026-05-07.md §"Oddsen (3 varianter)"
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTicketConfigFromCatalog,
  buildEngineTicketConfig,
} from "../GamePlanEngineBridge.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";

function makeOddsenCatalog(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-oddsen-55",
    slug: "oddsen-55",
    displayName: "Oddsen 55",
    description: null,
    rules: {
      gameVariant: "oddsen",
      targetDraw: 55,
      bingoBaseLow: 50000, // 500 kr (5 kr-bong base)
      bingoBaseHigh: 150000, // 1500 kr (5 kr-bong base)
    },
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 50000, // bingo-low brukes som "default" auto bingoBase
      bingo: {},
    },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    ...overrides,
  };
}

// ── Oddsen happy-path ───────────────────────────────────────────────────

test("Oddsen: spill1.oddsen skrives med targetDraw + bingoLow/HighPrizes per bongfarge", () => {
  const cat = makeOddsenCatalog();
  const cfg = buildTicketConfigFromCatalog(cat);

  const spill1 = cfg.spill1 as Record<string, unknown> | undefined;
  assert.ok(spill1, "spill1 må være satt for oddsen-variant");
  const oddsen = spill1!.oddsen as
    | {
        targetDraw: number;
        bingoLowPrizes: Record<string, number>;
        bingoHighPrizes: Record<string, number>;
      }
    | undefined;
  assert.ok(oddsen, "spill1.oddsen må være satt");
  assert.equal(oddsen!.targetDraw, 55);

  // Auto-multiplikator: hvit 5kr × 1, gul 10kr × 2, lilla 15kr × 3
  // bingoBaseLow=50000 → white=50000, yellow=100000, purple=150000
  assert.equal(oddsen!.bingoLowPrizes.white, 50000, "white low = base × 1");
  assert.equal(oddsen!.bingoLowPrizes.yellow, 100000, "yellow low = base × 2");
  assert.equal(oddsen!.bingoLowPrizes.purple, 150000, "purple low = base × 3");
  // bingoBaseHigh=150000 → white=150000, yellow=300000, purple=450000
  assert.equal(oddsen!.bingoHighPrizes.white, 150000, "white high = base × 1");
  assert.equal(
    oddsen!.bingoHighPrizes.yellow,
    300000,
    "yellow high = base × 2",
  );
  assert.equal(
    oddsen!.bingoHighPrizes.purple,
    450000,
    "purple high = base × 3",
  );
});

test("Oddsen: targetDraw=56 og 57 propageres uendret (ulike varianter)", () => {
  const cat56 = makeOddsenCatalog({
    slug: "oddsen-56",
    rules: {
      gameVariant: "oddsen",
      targetDraw: 56,
      bingoBaseLow: 50000,
      bingoBaseHigh: 150000,
    },
  });
  const cat57 = makeOddsenCatalog({
    slug: "oddsen-57",
    rules: {
      gameVariant: "oddsen",
      targetDraw: 57,
      bingoBaseLow: 50000,
      bingoBaseHigh: 150000,
    },
  });
  const cfg56 = buildTicketConfigFromCatalog(cat56);
  const cfg57 = buildTicketConfigFromCatalog(cat57);

  const oddsen56 = (cfg56.spill1 as Record<string, unknown>).oddsen as {
    targetDraw: number;
  };
  const oddsen57 = (cfg57.spill1 as Record<string, unknown>).oddsen as {
    targetDraw: number;
  };
  assert.equal(oddsen56.targetDraw, 56);
  assert.equal(oddsen57.targetDraw, 57);
});

test("Oddsen: bingoPrizes (gammel key) settes som LOW-fallback for bakoverkompat", () => {
  // Engine-koder uten Oddsen-pathen kan fortsatt fall back til bingoPrizes
  // (auto-multiplikator-derived fra prizesCents.bingoBase).
  const cat = makeOddsenCatalog();
  const cfg = buildTicketConfigFromCatalog(cat);
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  // bingoBase=50000 (low-equivalent), auto-multiplikator: hvit×1, gul×2, lilla×3
  assert.equal(bingoPrizes.white, 50000);
  assert.equal(bingoPrizes.yellow, 100000);
  assert.equal(bingoPrizes.purple, 150000);
});

// ── Regresjons-vakt: standard-spill skal IKKE få oddsen-section ─────────

test("Standard-spill (ingen rules.gameVariant=oddsen): spill1.oddsen er ikke satt", () => {
  const cat = makeOddsenCatalog({
    slug: "innsatsen",
    rules: { mini_game_rotation: ["wheel", "chest"] },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 100000,
      bingo: {},
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  // spill1 kan finnes (jackpot setter den), men skal ikke ha oddsen
  const spill1 = cfg.spill1 as Record<string, unknown> | undefined;
  if (spill1) {
    assert.equal(
      spill1.oddsen,
      undefined,
      "standard-spill skal ikke få oddsen-section",
    );
  } else {
    // spill1 undefined er også OK
    assert.equal(spill1, undefined);
  }
});

test("Trafikklys (gameVariant=trafikklys): IKKE oddsen-section", () => {
  const cat = makeOddsenCatalog({
    slug: "trafikklys",
    rules: {
      gameVariant: "trafikklys",
      ticketPriceCents: 1500,
    },
    prizeMultiplierMode: "explicit_per_color",
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 150000, hvit: 100000, lilla: 50000 },
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const spill1 = cfg.spill1 as Record<string, unknown> | undefined;
  if (spill1) {
    assert.equal(spill1.oddsen, undefined);
  }
});

// ── Fail-safe: invalide rules-felt produserer ingen oddsen ──────────────

test("Oddsen: targetDraw=0 → ingen oddsen-section (fail-safe)", () => {
  const cat = makeOddsenCatalog({
    rules: {
      gameVariant: "oddsen",
      targetDraw: 0,
      bingoBaseLow: 50000,
      bingoBaseHigh: 150000,
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const spill1 = cfg.spill1 as Record<string, unknown> | undefined;
  if (spill1) {
    assert.equal(spill1.oddsen, undefined);
  }
});

test("Oddsen: manglende bingoBaseLow → ingen oddsen-section (fail-safe)", () => {
  const cat = makeOddsenCatalog({
    rules: {
      gameVariant: "oddsen",
      targetDraw: 55,
      // bingoBaseLow utelatt
      bingoBaseHigh: 150000,
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const spill1 = cfg.spill1 as Record<string, unknown> | undefined;
  if (spill1) {
    assert.equal(spill1.oddsen, undefined);
  }
});

test("Oddsen: bingoBaseHigh=0 → ingen oddsen-section (fail-safe)", () => {
  const cat = makeOddsenCatalog({
    rules: {
      gameVariant: "oddsen",
      targetDraw: 55,
      bingoBaseLow: 50000,
      bingoBaseHigh: 0,
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const spill1 = cfg.spill1 as Record<string, unknown> | undefined;
  if (spill1) {
    assert.equal(spill1.oddsen, undefined);
  }
});

// ── Jackpot-override + Oddsen sameksisterer ─────────────────────────────

test("Oddsen + jackpot-override: spill1 inneholder BÅDE oddsen og jackpot", () => {
  const cat = makeOddsenCatalog({
    requiresJackpotSetup: true,
  });
  const cfg = buildEngineTicketConfig(
    cat,
    {
      draw: 50,
      prizesCents: { gul: 200000, hvit: 100000, lilla: 300000 },
    },
    null,
  );
  const spill1 = cfg.spill1 as Record<string, unknown>;
  assert.ok(spill1.oddsen, "oddsen-section må overleve jackpot-spread");
  assert.ok(spill1.jackpot, "jackpot-section må også være satt");
  const oddsen = spill1.oddsen as { targetDraw: number };
  assert.equal(oddsen.targetDraw, 55);
  const jackpot = spill1.jackpot as { draw: number; prizeByColor: unknown };
  assert.equal(jackpot.draw, 50);
  assert.deepEqual(jackpot.prizeByColor, {
    yellow: 200000,
    white: 100000,
    purple: 300000,
  });
});

test("Oddsen uten jackpot-override: ingen jackpot-section i spill1", () => {
  const cat = makeOddsenCatalog();
  const cfg = buildEngineTicketConfig(cat, null, null);
  const spill1 = cfg.spill1 as Record<string, unknown>;
  assert.ok(spill1.oddsen);
  assert.equal(spill1.jackpot, undefined);
});

// ── Auto-multiplikator: per-farge-presisjon ─────────────────────────────

test("Oddsen: bingoBaseLow=12345 produserer korrekt avrundet auto-multiplikator", () => {
  const cat = makeOddsenCatalog({
    rules: {
      gameVariant: "oddsen",
      targetDraw: 55,
      bingoBaseLow: 12345,
      bingoBaseHigh: 67891,
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const oddsen = (cfg.spill1 as Record<string, unknown>).oddsen as {
    bingoLowPrizes: Record<string, number>;
    bingoHighPrizes: Record<string, number>;
  };
  // 12345 × 1 = 12345, × 2 = 24690, × 3 = 37035
  assert.equal(oddsen.bingoLowPrizes.white, 12345);
  assert.equal(oddsen.bingoLowPrizes.yellow, 24690);
  assert.equal(oddsen.bingoLowPrizes.purple, 37035);
  // 67891 × 1 = 67891, × 2 = 135782, × 3 = 203673
  assert.equal(oddsen.bingoHighPrizes.white, 67891);
  assert.equal(oddsen.bingoHighPrizes.yellow, 135782);
  assert.equal(oddsen.bingoHighPrizes.purple, 203673);
});

test("Oddsen: kun 2 farger (gul+hvit) — purple utelates fra prize-tabellene", () => {
  const cat = makeOddsenCatalog({
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const oddsen = (cfg.spill1 as Record<string, unknown>).oddsen as {
    bingoLowPrizes: Record<string, number>;
    bingoHighPrizes: Record<string, number>;
  };
  assert.equal(oddsen.bingoLowPrizes.white, 50000);
  assert.equal(oddsen.bingoLowPrizes.yellow, 100000);
  assert.equal(oddsen.bingoLowPrizes.purple, undefined);
  assert.equal(oddsen.bingoHighPrizes.white, 150000);
  assert.equal(oddsen.bingoHighPrizes.yellow, 300000);
  assert.equal(oddsen.bingoHighPrizes.purple, undefined);
});
