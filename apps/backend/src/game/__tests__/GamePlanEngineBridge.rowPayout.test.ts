/**
 * Pilot-fix (2026-05-08): tester for Rad 1-4 + Fullt Hus auto-mult.
 *
 * Verifiserer at `buildTicketConfigFromCatalog` skriver en kanonisk
 * `spill1.ticketColors[]`-blokk som engine sin variant-mapper
 * (`Game1DrawEngineHelpers.buildVariantConfigFromGameConfigJson`) kan
 * konsumere, og at `Game1DrawEngineService.payoutPerColorGroups` får
 * riktig totalPhasePrize for første-vinners-farge per Q3=X-regulatorisk
 * pot-semantikk.
 *
 * Bakgrunn — bug-en denne fix-en lukker:
 *   - Før denne fix-en skrev bridgen `rowPrizes: { row1, ... }` på
 *     toppnivå, men engine sin flat-path leste
 *     `ticketColors[0].prizePerPattern[row_X]` AS PERCENT.
 *   - Resultat: 0-payout for Rad 1-4 fordi prosent ikke fantes →
 *     `totalPhasePrize = pot * 0 / 100 = 0`. Vinneren fikk INGENTING.
 *   - Fix: bridge skriver `spill1.ticketColors[]` med
 *     `prizePerPattern: { row_X: { mode: "fixed", amount: <kr> } }` per
 *     SLUG-keyed (small_yellow/large_yellow/...) farge. Auto-mult
 *     anvendt: hvit 5kr → base × 1, gul 10kr → base × 2, lilla 15kr →
 *     base × 3.
 *
 * Out-of-scope:
 *   - Trafikklys' rad-farge-spesifikke beløp (rød/grønn/gul) — håndteres
 *     i en separat path i engine via `rules.prizesPerRowColor`.
 *   - Cap-håndhevelse — `PrizePolicyPort.applySinglePrizeCap` kalles ikke
 *     fra `Game1PayoutService.payoutPhase` i dag for hovedspill (ingen
 *     cap på MAIN_GAME). Vi rører ikke dette.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngineTicketConfig,
  buildTicketConfigFromCatalog,
} from "../GamePlanEngineBridge.js";
import {
  buildVariantConfigFromGameConfigJson,
  patternPrizeToCents,
  resolveJackpotConfig,
  resolvePhaseConfig,
} from "../Game1DrawEngineHelpers.js";
import { resolvePatternsForColor } from "../spill1VariantMapper.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";

// ── Helper ───────────────────────────────────────────────────────────────

function makeAutoCatalog(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-auto",
    slug: "innsatsen",
    displayName: "Innsatsen",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit", "lilla"],
    // hvit 5 kr (500 øre), gul 10 kr (1000 øre), lilla 15 kr (1500 øre)
    ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
    prizesCents: {
      // Base = billigste bong (5 kr / hvit). Auto-mult skalerer for
      // dyrere bonger via `calculateActualPrize`.
      rad1: 10000, // 100 kr base
      rad2: 20000, // 200 kr base
      rad3: 30000, // 300 kr base
      rad4: 40000, // 400 kr base
      bingoBase: 100000, // 1000 kr base
      bingo: {},
    },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-08T12:00:00Z",
    updatedAt: "2026-05-08T12:00:00Z",
    createdByUserId: "u-1",
    ...overrides,
  };
}

function makeExplicitCatalog(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-explicit",
    slug: "trafikklys",
    displayName: "Trafikklys",
    description: null,
    rules: { gameVariant: "trafikklys" },
    // Trafikklys: alle bonger 15 kr (flat — ingen skalering)
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { hvit: 1500, gul: 1500, lilla: 1500 },
    prizesCents: {
      rad1: 5000, // 50 kr (eksplisitt, ikke skalert)
      rad2: 10000, // 100 kr
      rad3: 15000, // 150 kr
      rad4: 20000, // 200 kr
      // Per-farge bingo eksplisitt — IKKE skalert.
      bingo: { gul: 70000, hvit: 30000, lilla: 100000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-08T12:00:00Z",
    updatedAt: "2026-05-08T12:00:00Z",
    createdByUserId: "u-1",
    ...overrides,
  };
}

// ── A) Auto-multiplikator: spill1.ticketColors-blokk korrekt ────────────

test("auto-mode: spill1.ticketColors[] har slug-keys for alle (color, size)-kombinasjoner", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);

  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  assert.ok(spill1, "spill1-blokk må eksistere");
  assert.ok(Array.isArray(spill1.ticketColors), "spill1.ticketColors må være array");

  // 3 farger × 2 størrelser = 6 entries
  assert.equal(spill1.ticketColors.length, 6);

  const slugs = spill1.ticketColors.map((tc) => tc.color as string).sort();
  assert.deepEqual(slugs, [
    "large_purple",
    "large_white",
    "large_yellow",
    "small_purple",
    "small_white",
    "small_yellow",
  ]);
});

test("auto-mode: priseNok per (color, size) korrekt skalert med LARGE×3", () => {
  // Pilot-fix 2026-05-13: LARGE_TICKET_PRICE_MULTIPLIER 2 → 3. Stor bong
  // har 3 brett (Tobias-direktiv), så bundle-pris = smallPrice × 3.
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  const find = (slug: string) =>
    spill1.ticketColors.find((tc) => tc.color === slug);

  // hvit: 5/15 kr (small/large) — large = small × 3 brett
  assert.equal((find("small_white")!.priceNok), 5);
  assert.equal((find("large_white")!.priceNok), 15);
  // gul: 10/30 kr
  assert.equal((find("small_yellow")!.priceNok), 10);
  assert.equal((find("large_yellow")!.priceNok), 30);
  // lilla: 15/45 kr
  assert.equal((find("small_purple")!.priceNok), 15);
  assert.equal((find("large_purple")!.priceNok), 45);
});

test("auto-mode: prizePerPattern.row_1 auto-skalert (LARGE × 3 → multipliers 3/6/9)", () => {
  // Pilot-fix 2026-05-13: LARGE × 3 (var × 2). base rad1 = 100 kr.
  // hvit small (5 kr): 100 × 1 = 100 kr
  // gul small (10 kr): 100 × 2 = 200 kr
  // lilla small (15 kr): 100 × 3 = 300 kr
  // hvit large (15 kr bundle): 100 × 3 = 300 kr (samme som lilla small)
  // gul large (30 kr): 100 × 6 = 600 kr
  // lilla large (45 kr): 100 × 9 = 900 kr
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  const find = (slug: string) =>
    spill1.ticketColors.find((tc) => tc.color === slug);

  const ppp = (slug: string) =>
    find(slug)!.prizePerPattern as Record<
      string,
      { mode: string; amount: number }
    >;

  assert.equal(ppp("small_white").row_1!.amount, 100);
  assert.equal(ppp("large_white").row_1!.amount, 300); // 100 × 3 (var 200)
  assert.equal(ppp("small_yellow").row_1!.amount, 200);
  assert.equal(ppp("large_yellow").row_1!.amount, 600); // 100 × 6 (var 400)
  assert.equal(ppp("small_purple").row_1!.amount, 300);
  assert.equal(ppp("large_purple").row_1!.amount, 900); // 100 × 9 (var 600)

  // mode: "fixed" — engine skal lese prize1 (kr) og konvertere til øre
  assert.equal(ppp("small_white").row_1!.mode, "fixed");
});

test("auto-mode: prizePerPattern.full_house bruker bingoBase × multiplier (LARGE × 3)", () => {
  // Pilot-fix 2026-05-13: LARGE × 3. bingoBase = 1000 kr.
  // hvit small: 1000 × 1 = 1000 kr
  // gul small: 1000 × 2 = 2000 kr
  // lilla small: 1000 × 3 = 3000 kr
  // hvit large: 1000 × 3 = 3000 kr (var 2000)
  // gul large: 1000 × 6 = 6000 kr (var 4000)
  // lilla large: 1000 × 9 = 9000 kr (var 6000)
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  const find = (slug: string) =>
    spill1.ticketColors.find((tc) => tc.color === slug);
  const fh = (slug: string) =>
    (find(slug)!.prizePerPattern as Record<
      string,
      { mode: string; amount: number }
    >).full_house!;

  assert.equal(fh("small_white").amount, 1000);
  assert.equal(fh("small_yellow").amount, 2000);
  assert.equal(fh("small_purple").amount, 3000);
  assert.equal(fh("large_white").amount, 3000); // var 2000
  assert.equal(fh("large_yellow").amount, 6000); // var 4000
  assert.equal(fh("large_purple").amount, 9000); // var 6000
});

test("auto-mode: alle 5 faser populated for hver bongfarge", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };

  for (const tc of spill1.ticketColors) {
    const ppp = tc.prizePerPattern as Record<string, unknown>;
    for (const key of ["row_1", "row_2", "row_3", "row_4", "full_house"]) {
      assert.ok(
        ppp[key],
        `${tc.color} mangler ${key} (auto-mode skal populere alle 5 faser)`,
      );
    }
  }
});

// ── B) Eksplisitt per-farge spill (Trafikklys-stil) ─────────────────────

test("explicit-mode: full_house leses fra prizesCents.bingo per (norsk) farge", () => {
  const catalog = makeExplicitCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  const find = (slug: string) =>
    spill1.ticketColors.find((tc) => tc.color === slug);
  const fh = (slug: string) =>
    (find(slug)!.prizePerPattern as Record<
      string,
      { mode: string; amount: number }
    >).full_house;

  // Trafikklys: bingo per norsk farge → engine slug small_X / large_X arver
  // samme beløp (vi map'er kun farge-familien, ikke størrelsen).
  assert.equal(fh("small_white")!.amount, 300); // hvit 30000 øre = 300 kr
  assert.equal(fh("small_yellow")!.amount, 700); // gul 70000 øre = 700 kr
  assert.equal(fh("small_purple")!.amount, 1000); // lilla 100000 øre = 1000 kr
  // Large arver samme bingo-amount fra norsk farge (ikke skalert med pris).
  assert.equal(fh("large_white")!.amount, 300);
  assert.equal(fh("large_yellow")!.amount, 700);
  assert.equal(fh("large_purple")!.amount, 1000);
});

test("explicit-mode: rad-premier IKKE skalert (flat 15 kr-bong)", () => {
  // catalog.prizesCents.rad1 = 5000 øre = 50 kr.
  // Trafikklys-bonger er alle 15 kr → calculateActualPrize returnerer
  // base uendret (mode = explicit_per_color → ingen skalering).
  // Alle 6 (color, size)-entries skal ha samme rad1-beløp.
  const catalog = makeExplicitCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };

  for (const tc of spill1.ticketColors) {
    const ppp = tc.prizePerPattern as Record<
      string,
      { mode: string; amount: number }
    >;
    assert.equal(ppp.row_1.amount, 50, `${tc.color} skal ha rad1=50 (flat)`);
    assert.equal(ppp.row_2.amount, 100, `${tc.color} skal ha rad2=100`);
    assert.equal(ppp.row_3.amount, 150, `${tc.color} skal ha rad3=150`);
    assert.equal(ppp.row_4.amount, 200, `${tc.color} skal ha rad4=200`);
  }
});

test("explicit-mode: bingoBase eksponeres IKKE (ikke i bruk for explicit)", () => {
  const catalog = makeExplicitCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  assert.equal(cfg.bingoBase, undefined);
  assert.equal(cfg.prizeMultiplierMode, "explicit_per_color");
});

// ── C) Engine kompatibilitet: variant-mapper kan konsumere bridge-output ─

test("engine: buildVariantConfigFromGameConfigJson(bridge-output) gir patternsByColor", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  // Bridgen skriver samme config til både ticket_config_json og
  // game_config_json. Test mot game_config_json-pathen.
  const variantConfig = buildVariantConfigFromGameConfigJson(cfg);
  assert.ok(variantConfig, "variant-mapper skal returnere ikke-null");
  assert.ok(
    variantConfig!.patternsByColor,
    "variantConfig skal ha patternsByColor",
  );
  // Skal ha entries for alle 6 (color, size)-kombinasjoner pluss __default__.
  const keys = Object.keys(variantConfig!.patternsByColor!).sort();
  assert.ok(keys.includes("Small Yellow"), "Small Yellow skal være key");
  assert.ok(keys.includes("Large Yellow"), "Large Yellow skal være key");
  assert.ok(keys.includes("Small White"), "Small White skal være key");
  assert.ok(keys.includes("Large White"), "Large White skal være key");
  assert.ok(keys.includes("Small Purple"), "Small Purple skal være key");
  assert.ok(keys.includes("Large Purple"), "Large Purple skal være key");
  assert.ok(keys.includes("__default__"));
});

test("engine: resolvePatternsForColor + patternPrizeToCents gir korrekte øre-beløp", () => {
  // Verifiser at engine-pipeline (slug → engine-name → pattern → cents)
  // produserer riktig beløp i øre for solo-vinnere.
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  // Lilla small bong vinner Rad 1: 100 × 3 = 300 kr = 30000 øre
  const lillaPatterns = resolvePatternsForColor(vc, "Small Purple");
  assert.ok(lillaPatterns.length >= 5, "skal ha 5 faser");
  const lillaRad1 = lillaPatterns[0];
  assert.equal(lillaRad1.winningType, "fixed");
  assert.equal(lillaRad1.prize1, 300);
  // patternPrizeToCents(prize, potCents) for fixed-mode returnerer prize × 100.
  const lillaRad1Cents = patternPrizeToCents(lillaRad1, 999999);
  assert.equal(lillaRad1Cents, 30000, "lilla small Rad 1 = 30000 øre");

  // Gul small bong vinner Rad 1: 100 × 2 = 200 kr = 20000 øre
  const gulPatterns = resolvePatternsForColor(vc, "Small Yellow");
  const gulRad1Cents = patternPrizeToCents(gulPatterns[0], 999999);
  assert.equal(gulRad1Cents, 20000, "gul small Rad 1 = 20000 øre");

  // Hvit small bong vinner Rad 1: 100 × 1 = 100 kr = 10000 øre
  const hvitPatterns = resolvePatternsForColor(vc, "Small White");
  const hvitRad1Cents = patternPrizeToCents(hvitPatterns[0], 999999);
  assert.equal(hvitRad1Cents, 10000, "hvit small Rad 1 = 10000 øre");
});

test("engine: Fullt Hus per farge gir riktig øre-beløp", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  // bingoBase = 1000 kr (100000 øre)
  // lilla small (15 kr): 1000 × 3 = 3000 kr = 300000 øre
  const lillaPatterns = resolvePatternsForColor(vc, "Small Purple");
  const lillaFullHouse = lillaPatterns[4];
  assert.equal(lillaFullHouse.winningType, "fixed");
  assert.equal(lillaFullHouse.prize1, 3000);
  assert.equal(patternPrizeToCents(lillaFullHouse, 999999), 300000);

  // gul small (10 kr): 1000 × 2 = 2000 kr = 200000 øre
  const gulFullHouseCents = patternPrizeToCents(
    resolvePatternsForColor(vc, "Small Yellow")[4],
    999999,
  );
  assert.equal(gulFullHouseCents, 200000);
});

test("engine: explicit-mode produserer riktig per-farge-beløp", () => {
  const catalog = makeExplicitCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  // Trafikklys lilla full_house = 1000 kr (eksplisitt, fra bingo[lilla])
  const lillaFullHouseCents = patternPrizeToCents(
    resolvePatternsForColor(vc, "Small Purple")[4],
    999999,
  );
  assert.equal(lillaFullHouseCents, 100000);

  // Rad 1 = 50 kr flat for alle farger (ikke skalert)
  const lillaRad1Cents = patternPrizeToCents(
    resolvePatternsForColor(vc, "Small Purple")[0],
    999999,
  );
  assert.equal(lillaRad1Cents, 5000);

  const hvitRad1Cents = patternPrizeToCents(
    resolvePatternsForColor(vc, "Small White")[0],
    999999,
  );
  assert.equal(hvitRad1Cents, 5000);
});

// ── D) End-to-end: catalog → bridge → engine-payout-aritmetikk ──────────

test("e2e: lilla solo-vinner Rad 1 → engine total-prize 30000 øre", () => {
  // Simulerer Game1DrawEngineService.payoutPerColorGroups-aritmetikk:
  //   firstColor = winners[0].ticketColor (= "Small Purple" via slug→engine)
  //   firstColorPatterns = resolvePatternsForColor(vc, "Small Purple")
  //   phasePattern = firstColorPatterns[currentPhase - 1]
  //   totalPhasePrizeCents = patternPrizeToCents(phasePattern, potCents)
  //
  // For ÉN vinner: payoutPhase split 30000 / 1 = 30000 → wallet.credit
  // får 30000 øre = 300 kr.
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  const phase = 1;
  const lillaPatterns = resolvePatternsForColor(vc, "Small Purple");
  const phasePattern = lillaPatterns[phase - 1];
  const totalPhasePrizeCents = patternPrizeToCents(phasePattern, 999999);
  // 1 vinner → split likt = totalPhasePrize.
  const winnerCount = 1;
  const prizePerWinnerCents = Math.floor(totalPhasePrizeCents / winnerCount);
  assert.equal(prizePerWinnerCents, 30000);
});

test("e2e: gul solo-vinner Rad 1 → engine total-prize 20000 øre", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  const lillaPatterns = resolvePatternsForColor(vc, "Small Yellow");
  const totalPhasePrizeCents = patternPrizeToCents(lillaPatterns[0], 999999);
  assert.equal(totalPhasePrizeCents, 20000);
});

test("e2e: hvit solo-vinner Rad 1 → engine total-prize 10000 øre", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  const hvitPatterns = resolvePatternsForColor(vc, "Small White");
  const totalPhasePrizeCents = patternPrizeToCents(hvitPatterns[0], 999999);
  assert.equal(totalPhasePrizeCents, 10000);
});

test("e2e: lilla solo-vinner Fullt Hus → engine total-prize 300000 øre (auto-mult)", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const vc = buildVariantConfigFromGameConfigJson(cfg)!;

  const phase = 5;
  const lillaPatterns = resolvePatternsForColor(vc, "Small Purple");
  const totalPhasePrizeCents = patternPrizeToCents(
    lillaPatterns[phase - 1],
    999999,
  );
  assert.equal(totalPhasePrizeCents, 300000); // 3000 kr
});

// ── E) Regresjon: jackpot bevares ───────────────────────────────────────

test("regresjon: buildEngineTicketConfig MED jackpot bevarer spill1.ticketColors[]", () => {
  const catalog = makeAutoCatalog();
  const override = {
    draw: 56,
    prizesCents: { gul: 600000, hvit: 300000, lilla: 900000 },
  };
  const cfg = buildEngineTicketConfig(catalog, override);

  // Både ticketColors[] og jackpot skal være under spill1 — de er ikke
  // mutually exclusive.
  const spill1 = cfg.spill1 as Record<string, unknown>;
  assert.ok(spill1, "spill1-blokk må eksistere");
  assert.ok(
    Array.isArray(spill1.ticketColors),
    "spill1.ticketColors skal være bevart selv med jackpot",
  );
  assert.ok(spill1.jackpot, "spill1.jackpot skal være satt");

  // Engine kan fortsatt lese jackpot via resolveJackpotConfig
  const jc = resolveJackpotConfig(cfg);
  assert.ok(jc);
  assert.equal(jc!.draw, 56);
  assert.equal(jc!.prizeByColor.yellow, 600000);
  assert.equal(jc!.prizeByColor.purple, 900000);

  // Engine kan fortsatt bygge variantConfig
  const vc = buildVariantConfigFromGameConfigJson(cfg);
  assert.ok(vc);
  assert.ok(vc!.patternsByColor!["Small Purple"]);
});

test("regresjon: buildEngineTicketConfig UTEN jackpot bevarer spill1.ticketColors[]", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildEngineTicketConfig(catalog, null);

  const spill1 = cfg.spill1 as Record<string, unknown>;
  assert.ok(spill1, "spill1-blokk må eksistere uten jackpot");
  assert.ok(Array.isArray(spill1.ticketColors));
  assert.equal(spill1.jackpot, undefined);
});

// ── F) Top-level felter bevares (audit/debug) ───────────────────────────

test("top-level rowPrizes bevares som base-verdier (i øre, ikke skalert)", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const rowPrizes = cfg.rowPrizes as Record<string, number>;
  assert.equal(rowPrizes.row1, 10000);
  assert.equal(rowPrizes.row2, 20000);
  assert.equal(rowPrizes.row3, 30000);
  assert.equal(rowPrizes.row4, 40000);
});

test("top-level bingoPrizes bevares (family-keyed, for legacy-tooling)", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  // Auto-mult for bingoBase = 1000 kr per family, for billigste pris-pris.
  // hvit (5 kr): 100000 × 1 = 100000 øre = 1000 kr
  // gul (10 kr): 100000 × 2 = 200000 øre
  // lilla (15 kr): 100000 × 3 = 300000 øre
  assert.equal(bingoPrizes.white, 100000);
  assert.equal(bingoPrizes.yellow, 200000);
  assert.equal(bingoPrizes.purple, 300000);
});

test("top-level ticketTypesData bevares family-form (for purchase-flow)", () => {
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const ttd = cfg.ticketTypesData as Array<Record<string, unknown>>;
  // 3 farger × 2 størrelser = 6 entries (samme som før C2-fix).
  assert.equal(ttd.length, 6);
  assert.ok(ttd.find((e) => e.color === "yellow" && e.size === "small"));
  assert.ok(ttd.find((e) => e.color === "white" && e.size === "large"));
  assert.ok(ttd.find((e) => e.color === "purple" && e.size === "small"));
});

// ── G) Edge cases ────────────────────────────────────────────────────────

test("edge: bingoBase = 0 → full_house mangler i prizePerPattern", () => {
  const catalog = makeAutoCatalog({
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 0,
      bingo: {},
    },
  });
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  for (const tc of spill1.ticketColors) {
    const ppp = tc.prizePerPattern as Record<string, unknown>;
    assert.equal(
      ppp.full_house,
      undefined,
      `${tc.color} full_house skal mangle når bingoBase=0`,
    );
  }
});

test("edge: rad1 = 0 → row_1 mangler i prizePerPattern", () => {
  const catalog = makeAutoCatalog({
    prizesCents: {
      rad1: 0,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 100000,
      bingo: {},
    },
  });
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  for (const tc of spill1.ticketColors) {
    const ppp = tc.prizePerPattern as Record<string, unknown>;
    assert.equal(ppp.row_1, undefined, `${tc.color} row_1 skal mangle`);
    assert.ok(ppp.row_2, `${tc.color} row_2 skal eksistere`);
  }
});

test("edge: catalog uten priser for en farge → den fargen skippes", () => {
  const catalog = makeAutoCatalog({
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500 }, // lilla mangler
  });
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  // Bare gul + hvit, ikke lilla. 2 farger × 2 størrelser = 4 entries.
  assert.equal(spill1.ticketColors.length, 4);
  assert.ok(!spill1.ticketColors.find((tc) => tc.color === "small_purple"));
  assert.ok(!spill1.ticketColors.find((tc) => tc.color === "large_purple"));
});

// ── H) Backward-compat: flat-path resolvePhaseConfig fortsatt 0 ─────────

test("flat-path: resolvePhaseConfig på bridge-output returnerer percent=0 (forventet)", () => {
  // Bridgen skriver `prizePerPattern: { row_X: { mode: "fixed", amount } }`,
  // som flat-path ikke forstår (returnerer percent=0). Det er FORVENTET —
  // engine MÅ bruke per-color-pathen via game_config_json. Denne testen
  // sikrer at vi ikke ved et uhell triggrer flat-path med ikke-null
  // percent-verdier som ville gitt en feilaktig 0%-payout.
  const catalog = makeAutoCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);

  for (const phase of [1, 2, 3, 4, 5]) {
    const resolved = resolvePhaseConfig(cfg, phase);
    assert.equal(
      resolved.kind,
      "percent",
      `phase ${phase} skal være percent-shape`,
    );
    assert.equal(
      (resolved as { percent: number }).percent,
      0,
      `phase ${phase} skal være 0% (fixed-mode ignoreres av flat-path)`,
    );
  }
});
