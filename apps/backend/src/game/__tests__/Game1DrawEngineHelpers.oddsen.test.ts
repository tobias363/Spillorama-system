/**
 * Oddsen end-to-end (2026-05-08): tester for Oddsen-engine-helpers.
 *
 * Dekker rene helper-funksjoner som brukes av `Game1DrawEngineService`
 * når `ticket_config_json.spill1.oddsen` er satt:
 *
 *   - `resolveOddsenConfig(rawTicketConfig)` — parsing fra bridge-output
 *   - `selectOddsenBucket(oddsenCfg, drawSequenceAtWin)` — HIGH/LOW-routing
 *
 * Engine-regel ved Fullt Hus:
 *   - drawSequenceAtWin <= targetDraw → bruk HIGH-tabellen for bongfargen
 *   - drawSequenceAtWin >  targetDraw → bruk LOW-tabellen for bongfargen
 *
 * Spec-referanse: docs/operations/PM_HANDOFF_2026-05-07.md §"Oddsen"
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveOddsenConfig,
  selectOddsenBucket,
  planOddsenFullHousePayout,
} from "../Game1DrawEngineHelpers.js";
import { resolveColorFamily } from "../Game1JackpotService.js";

// ── resolveOddsenConfig: parsing-tester ─────────────────────────────────

test("resolveOddsenConfig: bridge-output med spill1.oddsen parses korrekt", () => {
  const ticketConfig = {
    catalogId: "gc-oddsen-55",
    catalogSlug: "oddsen-55",
    spill1: {
      oddsen: {
        targetDraw: 55,
        bingoLowPrizes: { yellow: 100000, white: 50000, purple: 150000 },
        bingoHighPrizes: { yellow: 300000, white: 150000, purple: 450000 },
      },
    },
  };
  const cfg = resolveOddsenConfig(ticketConfig);
  assert.ok(cfg, "config skal parses");
  assert.equal(cfg!.targetDraw, 55);
  assert.equal(cfg!.bingoLowPrizes.yellow, 100000);
  assert.equal(cfg!.bingoLowPrizes.white, 50000);
  assert.equal(cfg!.bingoLowPrizes.purple, 150000);
  assert.equal(cfg!.bingoHighPrizes.yellow, 300000);
  assert.equal(cfg!.bingoHighPrizes.white, 150000);
  assert.equal(cfg!.bingoHighPrizes.purple, 450000);
});

test("resolveOddsenConfig: ticket-config uten spill1.oddsen → null", () => {
  const ticketConfig = {
    catalogId: "gc-innsatsen",
    bingoPrizes: { yellow: 100000, white: 50000 },
  };
  const cfg = resolveOddsenConfig(ticketConfig);
  assert.equal(cfg, null);
});

test("resolveOddsenConfig: ticket-config med spill1.jackpot men uten oddsen → null", () => {
  const ticketConfig = {
    spill1: {
      jackpot: {
        prizeByColor: { yellow: 200000 },
        draw: 50,
      },
    },
  };
  const cfg = resolveOddsenConfig(ticketConfig);
  assert.equal(cfg, null);
});

test("resolveOddsenConfig: targetDraw mangler → null", () => {
  const ticketConfig = {
    spill1: {
      oddsen: {
        bingoLowPrizes: { yellow: 100000 },
        bingoHighPrizes: { yellow: 300000 },
      },
    },
  };
  const cfg = resolveOddsenConfig(ticketConfig);
  assert.equal(cfg, null);
});

test("resolveOddsenConfig: targetDraw=0 eller negativ → null", () => {
  const cfg0 = resolveOddsenConfig({
    spill1: {
      oddsen: {
        targetDraw: 0,
        bingoLowPrizes: { yellow: 100000 },
        bingoHighPrizes: { yellow: 300000 },
      },
    },
  });
  assert.equal(cfg0, null);
  const cfgNeg = resolveOddsenConfig({
    spill1: {
      oddsen: {
        targetDraw: -1,
        bingoLowPrizes: { yellow: 100000 },
        bingoHighPrizes: { yellow: 300000 },
      },
    },
  });
  assert.equal(cfgNeg, null);
});

test("resolveOddsenConfig: bingoLowPrizes mangler → null", () => {
  const cfg = resolveOddsenConfig({
    spill1: {
      oddsen: {
        targetDraw: 55,
        bingoHighPrizes: { yellow: 300000 },
      },
    },
  });
  assert.equal(cfg, null);
});

test("resolveOddsenConfig: tomt bingoLowPrizes-objekt → null", () => {
  const cfg = resolveOddsenConfig({
    spill1: {
      oddsen: {
        targetDraw: 55,
        bingoLowPrizes: {},
        bingoHighPrizes: { yellow: 300000 },
      },
    },
  });
  assert.equal(cfg, null);
});

test("resolveOddsenConfig: streng-input parses som JSON", () => {
  const ticketConfig = JSON.stringify({
    spill1: {
      oddsen: {
        targetDraw: 56,
        bingoLowPrizes: { yellow: 100000 },
        bingoHighPrizes: { yellow: 300000 },
      },
    },
  });
  const cfg = resolveOddsenConfig(ticketConfig);
  assert.ok(cfg);
  assert.equal(cfg!.targetDraw, 56);
});

test("resolveOddsenConfig: ugyldig JSON-streng → null", () => {
  const cfg = resolveOddsenConfig("{ ikke gyldig json");
  assert.equal(cfg, null);
});

test("resolveOddsenConfig: lowercase-normalisering på color-keys", () => {
  // Oddsen prizes-tabeller forventes å bruke engelske farge-keys i lowercase.
  // Hvis bridge en gang i framtiden skriver "Yellow"/"YELLOW" må vi tolke
  // dem som samme key.
  const cfg = resolveOddsenConfig({
    spill1: {
      oddsen: {
        targetDraw: 55,
        bingoLowPrizes: { Yellow: 100000, WHITE: 50000 },
        bingoHighPrizes: { yellow: 300000, white: 150000 },
      },
    },
  });
  assert.ok(cfg);
  assert.equal(cfg!.bingoLowPrizes.yellow, 100000);
  assert.equal(cfg!.bingoLowPrizes.white, 50000);
});

// ── selectOddsenBucket: HIGH/LOW-routing ────────────────────────────────

test("selectOddsenBucket: drawSequenceAtWin < targetDraw → high", () => {
  const cfg = {
    targetDraw: 55,
    bingoLowPrizes: { yellow: 100000 },
    bingoHighPrizes: { yellow: 300000 },
  };
  const r = selectOddsenBucket(cfg, 50);
  assert.equal(r.bucket, "high");
  assert.equal(r.prizesTable.yellow, 300000);
});

test("selectOddsenBucket: drawSequenceAtWin === targetDraw → high (inclusive)", () => {
  // Spec-tolkning (Tobias): "Fullt Hus oppnådd innen target" inkluderer
  // selve target-trekket. drawSequenceAtWin = 55 og targetDraw = 55 → high.
  const cfg = {
    targetDraw: 55,
    bingoLowPrizes: { yellow: 100000 },
    bingoHighPrizes: { yellow: 300000 },
  };
  const r = selectOddsenBucket(cfg, 55);
  assert.equal(r.bucket, "high");
  assert.equal(r.prizesTable.yellow, 300000);
});

test("selectOddsenBucket: drawSequenceAtWin > targetDraw → low", () => {
  const cfg = {
    targetDraw: 55,
    bingoLowPrizes: { yellow: 100000 },
    bingoHighPrizes: { yellow: 300000 },
  };
  const r = selectOddsenBucket(cfg, 56);
  assert.equal(r.bucket, "low");
  assert.equal(r.prizesTable.yellow, 100000);
});

test("selectOddsenBucket: spec-eksempel — Oddsen 55 ved trekk 55, 54, 56", () => {
  // Per spec-spec for Oddsen 55:
  //   - Fullt Hus på trekk 54 med target 55 → high payout
  //   - Fullt Hus på trekk 55 med target 55 → high payout
  //   - Fullt Hus på trekk 56 med target 55 → low payout
  const cfg = {
    targetDraw: 55,
    bingoLowPrizes: { yellow: 100000, white: 50000, purple: 150000 },
    bingoHighPrizes: { yellow: 300000, white: 150000, purple: 450000 },
  };
  assert.equal(selectOddsenBucket(cfg, 54).bucket, "high");
  assert.equal(selectOddsenBucket(cfg, 55).bucket, "high");
  assert.equal(selectOddsenBucket(cfg, 56).bucket, "low");

  // Verifiser at HIGH-bucket gir høyere prize for samme bongfarge.
  assert.equal(selectOddsenBucket(cfg, 55).prizesTable.purple, 450000);
  assert.equal(selectOddsenBucket(cfg, 56).prizesTable.purple, 150000);
});

test("selectOddsenBucket: Oddsen 56 og 57 har samme HIGH/LOW-semantikk med ulik target", () => {
  const cfg56 = {
    targetDraw: 56,
    bingoLowPrizes: { yellow: 100000 },
    bingoHighPrizes: { yellow: 300000 },
  };
  const cfg57 = {
    targetDraw: 57,
    bingoLowPrizes: { yellow: 100000 },
    bingoHighPrizes: { yellow: 300000 },
  };
  // Trekk 56:
  assert.equal(selectOddsenBucket(cfg56, 56).bucket, "high");
  assert.equal(selectOddsenBucket(cfg57, 56).bucket, "high");
  // Trekk 57:
  assert.equal(selectOddsenBucket(cfg56, 57).bucket, "low");
  assert.equal(selectOddsenBucket(cfg57, 57).bucket, "high");
});

// ── End-to-end: bridge → resolve roundtrip ──────────────────────────────

test("Roundtrip: bridge.buildTicketConfigFromCatalog → resolveOddsenConfig", async () => {
  // Importer bridge inline her så testfila er selvstendig.
  const { buildTicketConfigFromCatalog } = await import(
    "../GamePlanEngineBridge.js"
  );
  const catalog = {
    id: "gc-oddsen-55",
    slug: "oddsen-55",
    displayName: "Oddsen 55",
    description: null,
    rules: {
      gameVariant: "oddsen",
      targetDraw: 55,
      bingoBaseLow: 50000,
      bingoBaseHigh: 150000,
    },
    ticketColors: ["gul", "hvit", "lilla"] as ("gul" | "hvit" | "lilla")[],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 50000,
      bingo: {},
    },
    prizeMultiplierMode: "auto" as const,
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
  };
  const ticketConfig = buildTicketConfigFromCatalog(catalog);
  const resolved = resolveOddsenConfig(ticketConfig);
  assert.ok(resolved, "bridge-output må kunne parses tilbake av engine");
  assert.equal(resolved!.targetDraw, 55);
  assert.equal(resolved!.bingoLowPrizes.yellow, 100000);
  assert.equal(resolved!.bingoLowPrizes.white, 50000);
  assert.equal(resolved!.bingoLowPrizes.purple, 150000);
  assert.equal(resolved!.bingoHighPrizes.yellow, 300000);
  assert.equal(resolved!.bingoHighPrizes.white, 150000);
  assert.equal(resolved!.bingoHighPrizes.purple, 450000);
});

// ── planOddsenFullHousePayout: per-color-family-grupper ─────────────────

const ODDSEN_55_CFG = {
  targetDraw: 55,
  bingoLowPrizes: { yellow: 100000, white: 50000, purple: 150000 },
  bingoHighPrizes: { yellow: 300000, white: 150000, purple: 450000 },
};

test("planOddsenFullHousePayout: spec — Fullt Hus på trekk 55, target 55 → high payout", () => {
  // Spec-eksempel #1
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 55,
    winners: [{ ticketColor: "small_yellow" }],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "high");
  assert.equal(plan.targetDraw, 55);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].colorFamily, "yellow");
  assert.equal(plan.groups[0].winnerCount, 1);
  assert.equal(plan.groups[0].perWinnerPrizeCents, 300000);
  assert.equal(plan.groups[0].totalPhasePrizeCents, 300000);
  assert.equal(plan.skippedColorFamilies.length, 0);
});

test("planOddsenFullHousePayout: spec — Fullt Hus på trekk 54, target 55 → high payout", () => {
  // Spec-eksempel #2
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 54,
    winners: [{ ticketColor: "small_yellow" }],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "high");
  assert.equal(plan.groups[0].perWinnerPrizeCents, 300000);
});

test("planOddsenFullHousePayout: spec — Fullt Hus på trekk 56, target 55 → low payout", () => {
  // Spec-eksempel #3
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 56,
    winners: [{ ticketColor: "small_yellow" }],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "low");
  assert.equal(plan.groups[0].perWinnerPrizeCents, 100000);
});

test("planOddsenFullHousePayout: multi-vinner samme farge — totalPhasePrize × winnerCount", () => {
  // 3 vinnere alle yellow → group {colorFamily:'yellow', winnerCount:3, perWinnerPrize:300000, total:900000}
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 50,
    winners: [
      { ticketColor: "small_yellow" },
      { ticketColor: "large_yellow" },
      { ticketColor: "small_yellow" },
    ],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "high");
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].colorFamily, "yellow");
  assert.equal(plan.groups[0].winnerCount, 3);
  assert.equal(plan.groups[0].perWinnerPrizeCents, 300000);
  assert.equal(plan.groups[0].totalPhasePrizeCents, 900000);
});

test("planOddsenFullHousePayout: multi-color → én gruppe per farge", () => {
  // 2 yellow + 1 white + 1 purple, alle innen target → high tabel
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 40,
    winners: [
      { ticketColor: "small_yellow" },
      { ticketColor: "large_yellow" },
      { ticketColor: "small_white" },
      { ticketColor: "small_purple" },
    ],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "high");
  assert.equal(plan.groups.length, 3);
  const byFamily = new Map(plan.groups.map((g) => [g.colorFamily, g]));
  assert.equal(byFamily.get("yellow")!.winnerCount, 2);
  assert.equal(byFamily.get("yellow")!.perWinnerPrizeCents, 300000);
  assert.equal(byFamily.get("yellow")!.totalPhasePrizeCents, 600000);
  assert.equal(byFamily.get("white")!.winnerCount, 1);
  assert.equal(byFamily.get("white")!.perWinnerPrizeCents, 150000);
  assert.equal(byFamily.get("white")!.totalPhasePrizeCents, 150000);
  assert.equal(byFamily.get("purple")!.winnerCount, 1);
  assert.equal(byFamily.get("purple")!.perWinnerPrizeCents, 450000);
});

test("planOddsenFullHousePayout: low-bucket — multi-color riktige low-priser", () => {
  // Trekk > target: low-tabellen brukes
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 60,
    winners: [
      { ticketColor: "small_yellow" },
      { ticketColor: "small_white" },
      { ticketColor: "small_purple" },
    ],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "low");
  const byFamily = new Map(plan.groups.map((g) => [g.colorFamily, g]));
  assert.equal(byFamily.get("yellow")!.perWinnerPrizeCents, 100000);
  assert.equal(byFamily.get("white")!.perWinnerPrizeCents, 50000);
  assert.equal(byFamily.get("purple")!.perWinnerPrizeCents, 150000);
});

test("planOddsenFullHousePayout: ukjent color-family → skip + raporter", () => {
  // Vinner har ticket-color "elvis1" som ikke finnes i Oddsen-tabellen.
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 50,
    winners: [
      { ticketColor: "small_yellow" },
      { ticketColor: "elvis1" },
    ],
    resolveColorFamily,
  });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].colorFamily, "yellow");
  assert.equal(plan.skippedColorFamilies.length, 1);
  assert.equal(plan.skippedColorFamilies[0].colorFamily, "elvis");
  assert.equal(plan.skippedColorFamilies[0].winnerCount, 1);
});

test("planOddsenFullHousePayout: tom vinner-liste → tom plan", () => {
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 50,
    winners: [],
    resolveColorFamily,
  });
  assert.equal(plan.bucket, "high");
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.skippedColorFamilies.length, 0);
});

test("planOddsenFullHousePayout: spec-tabel for alle 9 kombinasjoner", () => {
  // Spec-eksempel: Spill 1 Oddsen 55 med 3 farger, low/high-bucket
  const cfg = ODDSEN_55_CFG;

  // HIGH-bucket (drawSequenceAtWin=55, target=55):
  const high = planOddsenFullHousePayout({
    oddsenCfg: cfg,
    drawSequenceAtWin: 55,
    winners: [
      { ticketColor: "small_white" },
      { ticketColor: "small_yellow" },
      { ticketColor: "small_purple" },
    ],
    resolveColorFamily,
  });
  const highByFamily = new Map(high.groups.map((g) => [g.colorFamily, g]));
  // Hvit 5 kr → high 1500 = 150000 øre
  assert.equal(highByFamily.get("white")!.perWinnerPrizeCents, 150000);
  // Gul 10 kr → high 1500 × 2 = 300000 øre
  assert.equal(highByFamily.get("yellow")!.perWinnerPrizeCents, 300000);
  // Lilla 15 kr → high 1500 × 3 = 450000 øre
  assert.equal(highByFamily.get("purple")!.perWinnerPrizeCents, 450000);

  // LOW-bucket (drawSequenceAtWin=56, target=55):
  const low = planOddsenFullHousePayout({
    oddsenCfg: cfg,
    drawSequenceAtWin: 56,
    winners: [
      { ticketColor: "small_white" },
      { ticketColor: "small_yellow" },
      { ticketColor: "small_purple" },
    ],
    resolveColorFamily,
  });
  const lowByFamily = new Map(low.groups.map((g) => [g.colorFamily, g]));
  // Hvit 5 kr → low 500 = 50000 øre
  assert.equal(lowByFamily.get("white")!.perWinnerPrizeCents, 50000);
  // Gul 10 kr → low 500 × 2 = 100000 øre
  assert.equal(lowByFamily.get("yellow")!.perWinnerPrizeCents, 100000);
  // Lilla 15 kr → low 500 × 3 = 150000 øre
  assert.equal(lowByFamily.get("purple")!.perWinnerPrizeCents, 150000);
});
