/**
 * End-to-end engine-test for Trafikklys-runtime (Spill 1 spesialvariant).
 *
 * **STATUS PER 2026-05-08:** Trafikklys-runtime er IKKE implementert i
 * `Game1DrawEngineService` eller `Game1DrawEngineHelpers`. Denne test-
 * suiten dokumenterer derfor BÅDE:
 *
 *   - Kategori A — eksisterende oppførsel som faktisk er pilot-klar
 *     (katalog-data + bridge-output). Disse passerer.
 *   - Kategori B — kontrakt-tester for runtime-pathen som skal
 *     implementeres. Disse er markert med `test.todo` slik at de blir
 *     synlige i CI uten å feile annen utvikling.
 *
 * Når Trafikklys-runtime implementeres: fjern `todo`-markeringen og
 * tester skal passe uten å endre asserts. Hvis de feiler, ER det runtime-
 * pathen som er feil-implementert — ikke testen.
 *
 * Komplett gap-analyse:
 *   `docs/architecture/TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md`
 *
 * Kanonisk regel-kilde:
 *   `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §5 + §9.4
 *
 * Trafikklys-mekanikk (sammendrag):
 *   - Bongpris: flat 15 kr alle bonger
 *   - Premier styres av RAD-FARGE (rød/grønn/gul) — IKKE bongfarge
 *   - Master eller systemet trekker rad-farge ved spill-start
 *   - Premie-tabell:
 *     | Rad-farge | Rad-premie | Fullt Hus |
 *     |-----------|------------|-----------|
 *     | Rød       | 50 kr      | 500 kr    |
 *     | Grønn     | 100 kr     | 1000 kr   |
 *     | Gul       | 150 kr     | 1500 kr   |
 *   - Multi-vinner: alle vinnere på samme rad får samme prize delt likt
 *     (ikke vektet — alle bonger har samme pris)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTicketConfigFromCatalog,
} from "../GamePlanEngineBridge.js";
import {
  buildVariantConfigFromGameConfigJson,
  resolveOddsenVariantConfig,
} from "../Game1DrawEngineHelpers.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";

// ── Trafikklys-katalog-fixture (matcher SPILL_REGLER §5.3) ─────────────────

/**
 * Kanonisk Trafikklys-katalog-rad. Per docs §5.3:
 *   - rules.gameVariant: "trafikklys"
 *   - rules.ticketPriceCents: 1500 (flat 15 kr)
 *   - rules.rowColors: ["grønn", "gul", "rød"]
 *   - rules.prizesPerRowColor: { grønn: 10000, gul: 15000, rød: 5000 } (øre)
 *   - rules.bingoPerRowColor: { grønn: 100000, gul: 150000, rød: 50000 } (øre)
 */
function makeTrafikklysCatalog(): GameCatalogEntry {
  return {
    id: "gc-trafikklys",
    slug: "trafikklys",
    displayName: "Trafikklys",
    description: null,
    rules: {
      gameVariant: "trafikklys",
      ticketPriceCents: 1500,
      rowColors: ["grønn", "gul", "rød"],
      prizesPerRowColor: {
        grønn: 10000,
        gul: 15000,
        rød: 5000,
      },
      bingoPerRowColor: {
        grønn: 100000,
        gul: 150000,
        rød: 50000,
      },
    },
    ticketColors: ["gul", "hvit", "lilla"],
    // Trafikklys: alle 15 kr (flat — ingen skalering)
    ticketPricesCents: { hvit: 1500, gul: 1500, lilla: 1500 },
    prizesCents: {
      // Placeholder-verdier — engine skal IKKE bruke disse for Trafikklys-
      // runtime, men shape krever felter for explicit_per_color-modus.
      // Bridge skriver disse uendret; engine forventes å overstyre i
      // run-time basert på trukket rad-farge.
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 100000, hvit: 100000, lilla: 100000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-08T00:00:00Z",
    updatedAt: "2026-05-08T00:00:00Z",
    createdByUserId: "u-test",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// KATEGORI A — Eksisterende oppførsel (PASSER i dag)
// ───────────────────────────────────────────────────────────────────────────

// ── A1: Katalog-shape ──────────────────────────────────────────────────────

test("[A1] katalog: prizeMultiplierMode === 'explicit_per_color'", () => {
  const catalog = makeTrafikklysCatalog();
  assert.equal(catalog.prizeMultiplierMode, "explicit_per_color");
});

test("[A1] katalog: rules.gameVariant === 'trafikklys'", () => {
  const catalog = makeTrafikklysCatalog();
  assert.equal(
    (catalog.rules as Record<string, unknown>).gameVariant,
    "trafikklys",
  );
});

test("[A1] katalog: ticketPriceCents flat 1500 (alle 15 kr)", () => {
  const catalog = makeTrafikklysCatalog();
  assert.equal(
    (catalog.rules as Record<string, unknown>).ticketPriceCents,
    1500,
  );
  assert.equal(catalog.ticketPricesCents.hvit, 1500);
  assert.equal(catalog.ticketPricesCents.gul, 1500);
  assert.equal(catalog.ticketPricesCents.lilla, 1500);
});

test("[A1] katalog: rules.rowColors whitelist (grønn/gul/rød)", () => {
  const catalog = makeTrafikklysCatalog();
  const rowColors = (catalog.rules as Record<string, unknown>).rowColors as
    | string[]
    | undefined;
  assert.ok(rowColors);
  assert.deepEqual([...rowColors].sort(), ["grønn", "gul", "rød"]);
});

test("[A1] katalog: rules.prizesPerRowColor matcher §5.2 (rød 50/grønn 100/gul 150)", () => {
  const catalog = makeTrafikklysCatalog();
  const prizes = (catalog.rules as Record<string, unknown>)
    .prizesPerRowColor as Record<string, number>;
  assert.equal(prizes["rød"], 5000); // 50 kr
  assert.equal(prizes["grønn"], 10000); // 100 kr
  assert.equal(prizes["gul"], 15000); // 150 kr
});

test("[A1] katalog: rules.bingoPerRowColor matcher §5.2 (rød 500/grønn 1000/gul 1500)", () => {
  const catalog = makeTrafikklysCatalog();
  const bingo = (catalog.rules as Record<string, unknown>)
    .bingoPerRowColor as Record<string, number>;
  assert.equal(bingo["rød"], 50000); // 500 kr
  assert.equal(bingo["grønn"], 100000); // 1000 kr
  assert.equal(bingo["gul"], 150000); // 1500 kr
});

// ── A2: Bridge-output ──────────────────────────────────────────────────────

test("[A2] bridge: spill1.ticketColors[] genereres for Trafikklys", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors?: Array<Record<string, unknown>> };
  assert.ok(spill1, "spill1-blokk må eksistere");
  assert.ok(Array.isArray(spill1.ticketColors));
  // 3 farger × 2 størrelser = 6 entries
  assert.equal(spill1.ticketColors!.length, 6);
});

test("[A2] bridge: rules-objektet videreformidles uendret til config-output", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const rules = cfg.rules as Record<string, unknown>;
  assert.equal(rules.gameVariant, "trafikklys");
  assert.deepEqual(rules.rowColors, ["grønn", "gul", "rød"]);
  // Engine MÅ kunne lese disse for å implementere runtime.
  assert.ok(rules.prizesPerRowColor, "rules.prizesPerRowColor må være med");
  assert.ok(rules.bingoPerRowColor, "rules.bingoPerRowColor må være med");
});

test("[A2] bridge: alle 6 (color, size) får samme rad-pot fordi flat 15 kr-bong", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  for (const tc of spill1.ticketColors) {
    const ppp = tc.prizePerPattern as Record<
      string,
      { mode: string; amount: number }
    >;
    // Placeholder rad1 = 10000 øre = 100 kr (skal IKKE skaleres for explicit_per_color)
    assert.equal(
      ppp.row_1.amount,
      100,
      `${tc.color} rad1 skal være 100 kr (flat — engine skal overstyre med rad-farge)`,
    );
  }
});

test("[A2] bridge: ingen oddsen-blokk skrives for Trafikklys", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { oddsen?: unknown };
  assert.equal(
    spill1.oddsen,
    undefined,
    "spill1.oddsen skal IKKE være satt for Trafikklys (gameVariant !== oddsen)",
  );
});

// ── A3: Variant-config-resolution ──────────────────────────────────────────

test("[A3] variant-config: buildVariantConfigFromGameConfigJson aksepterer Trafikklys-shape", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const variantCfg = buildVariantConfigFromGameConfigJson(cfg);
  assert.ok(variantCfg, "variant-config skal kunne bygges fra Trafikklys-config");
});

test("[A3] variant-config: resolveOddsenVariantConfig returnerer null for Trafikklys", () => {
  // Defensiv test: Trafikklys må IKKE plukkes opp som Oddsen-spill.
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const oddsenCfg = resolveOddsenVariantConfig(cfg);
  assert.equal(
    oddsenCfg,
    null,
    "Trafikklys skal IKKE matche Oddsen-resolveren",
  );
});

// ── A4: §9.4 multi-vinner-deling (matematisk regel — uavhengig av runtime) ──

/**
 * Per §9.4: Trafikklys multi-vinner-pot deles LIKT (ikke vektet) fordi alle
 * bonger har samme pris (15 kr). Dette er en ren floor-split-test som er
 * uavhengig av om runtime er implementert eller ikke — den verifiserer den
 * kanoniske regelen.
 */
function splitPot(potCents: number, winnerCount: number): {
  perWinnerCents: number;
  houseRetainedCents: number;
} {
  if (winnerCount <= 0) return { perWinnerCents: 0, houseRetainedCents: 0 };
  const perWinner = Math.floor(potCents / winnerCount);
  const total = perWinner * winnerCount;
  return {
    perWinnerCents: perWinner,
    houseRetainedCents: potCents - total,
  };
}

test("[A4] §9.4: solo-vinner Rad rød (50 kr-pot) → 50 kr", () => {
  const split = splitPot(5000, 1);
  assert.equal(split.perWinnerCents, 5000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: solo-vinner Rad grønn (100 kr-pot) → 100 kr", () => {
  const split = splitPot(10000, 1);
  assert.equal(split.perWinnerCents, 10000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: solo-vinner Rad gul (150 kr-pot) → 150 kr", () => {
  const split = splitPot(15000, 1);
  assert.equal(split.perWinnerCents, 15000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: 2 vinnere på Rad 1 grønn (100 kr-pot) → 50 kr hver", () => {
  const split = splitPot(10000, 2);
  assert.equal(split.perWinnerCents, 5000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: 3 vinnere på Rad 1 gul (150 kr-pot) → 50 kr hver", () => {
  const split = splitPot(15000, 3);
  assert.equal(split.perWinnerCents, 5000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: 3 vinnere på Rad 1 rød (50 kr-pot) → 16 kr hver, rest 2 til hus", () => {
  // 5000 / 3 = 1666 (floor), rest = 5000 - 1666*3 = 2
  const split = splitPot(5000, 3);
  assert.equal(split.perWinnerCents, 1666);
  assert.equal(split.houseRetainedCents, 2);
});

test("[A4] §9.4: solo Fullt Hus rød (500 kr-pot) → 500 kr", () => {
  const split = splitPot(50000, 1);
  assert.equal(split.perWinnerCents, 50000);
});

test("[A4] §9.4: solo Fullt Hus gul (1500 kr-pot) → 1500 kr", () => {
  const split = splitPot(150000, 1);
  assert.equal(split.perWinnerCents, 150000);
});

test("[A4] §9.4: 2 vinnere Fullt Hus grønn (1000 kr-pot) → 500 kr hver", () => {
  const split = splitPot(100000, 2);
  assert.equal(split.perWinnerCents, 50000);
  assert.equal(split.houseRetainedCents, 0);
});

// ───────────────────────────────────────────────────────────────────────────
// KATEGORI B — Kontrakt-tester for IKKE-IMPLEMENTERT runtime
//
// Disse er markert med test.todo. Når Trafikklys-runtime implementeres
// skal de kunne enables ved å fjerne `.todo`-suffix og bruke det
// dokumenterte forventede API-et. Se TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md
// for komplett spec.
// ───────────────────────────────────────────────────────────────────────────

// ── B1: Rad-farge-trekking ved spill-start ─────────────────────────────────

test.todo(
  "[B1] runtime: startGame trekker en rad-farge fra rules.rowColors og persisterer på scheduled-game-rad. " +
    "Forventet: ny kolonne `app_game1_scheduled_games.trafikklys_row_color` (eller felt i game_config_json.spill1.trafikklys.rowColor) settes til en av {grønn, gul, rød}.",
);

test.todo(
  "[B1] runtime: rad-farge-trekking er deterministisk per scheduled-game (samme RNG-seed gir samme rad-farge). " +
    "Forventet: sann tilfeldighet ved live-spill, men reproduserbar i tester via fixed seed.",
);

// ── B2: Rad-farge eksponert i game-state / room-snapshot ───────────────────

test.todo(
  "[B2] runtime: rad-farge eksponeres i game-state for klient-rendering (TV-skjerm-banner). " +
    "Forventet: room-snapshot inneholder { trafikklys: { rowColor: 'grønn' } } slik at klient kan vise 'Denne runden er GRØNN'.",
);

// ── B3: Rad-pot bruker rules.prizesPerRowColor[radFarge] (uavhengig av bongfarge) ──

test.todo(
  "[B3] runtime: Rad 1 vinner med rad-farge=rød → 50 kr (uavhengig av bongfarge). " +
    "Forventet asserts: " +
    "potForBongSizeCents === 5000 for ALLE bongfarger; " +
    "wallet.credits[0].amount === 5000 for solo-vinner.",
);

test.todo(
  "[B3] runtime: Rad 1 vinner med rad-farge=grønn → 100 kr. " +
    "Forventet: potForBongSizeCents === 10000.",
);

test.todo(
  "[B3] runtime: Rad 1 vinner med rad-farge=gul → 150 kr. " +
    "Forventet: potForBongSizeCents === 15000.",
);

test.todo(
  "[B3] runtime: hvit-bong (5 kr-multiplier=1) får IKKE vektet pot for Trafikklys. " +
    "Forventet: pot === prizesPerRowColor[rowColor] uendret (ingen × 1 / × 2 / × 3-skalering).",
);

test.todo(
  "[B3] runtime: lilla-bong (15 kr-multiplier=3) får IKKE vektet pot for Trafikklys. " +
    "Forventet: pot === prizesPerRowColor[rowColor] uendret.",
);

// ── B4: Fullt Hus-pot bruker rules.bingoPerRowColor[radFarge] ──────────────

test.todo(
  "[B4] runtime: Fullt Hus med rad-farge=rød → 500 kr. " +
    "Forventet: potForBongSizeCents === 50000 for Fullt Hus-fasen.",
);

test.todo(
  "[B4] runtime: Fullt Hus med rad-farge=grønn → 1000 kr. " +
    "Forventet: potForBongSizeCents === 100000.",
);

test.todo(
  "[B4] runtime: Fullt Hus med rad-farge=gul → 1500 kr. " +
    "Forventet: potForBongSizeCents === 150000.",
);

// ── B5: Multi-vinner-aritmetikk via runtime ────────────────────────────────

test.todo(
  "[B5] runtime: 2 vinnere på Rad 1 grønn → hver får 50 kr (100 kr-pot delt likt). " +
    "Forventet: 2 wallet.credits, hver med amount === 5000.",
);

test.todo(
  "[B5] runtime: 3 vinnere på Fullt Hus rød (500 kr-pot) → hver får 166 kr, rest 2 til hus. " +
    "Forventet: floor-split + house-retain matcher splitPot(50000, 3).",
);

// ── B6: Multi-bong-per-spiller-håndtering ──────────────────────────────────

test.todo(
  "[B6] runtime: spiller med 3 bonger som alle vinner Rad 1 grønn → spilleren får én pot-andel × 3 (eller én aggregert credit). " +
    "Forventet: payout-aritmetikk matcher §9.4 multi-bong-regelen — ingen dobbeltelling.",
);

// ── B7: Compliance-ledger metadata ─────────────────────────────────────────

test.todo(
  "[B7] runtime: payoutPerColorGroups skriver gameVariant: 'trafikklys' i potMetadata. " +
    "Forventet: PRIZE-ledger-entries har metadata.gameVariant === 'trafikklys'.",
);

test.todo(
  "[B7] runtime: payoutPerColorGroups skriver trafikklysRowColor i potMetadata. " +
    "Forventet: PRIZE-ledger-entries har metadata.trafikklysRowColor === <trukket rad-farge>.",
);

test.todo(
  "[B7] runtime: bongMultiplier IKKE skrives for Trafikklys (flat-prising). " +
    "Forventet: metadata.bongMultiplier === undefined eller 1 (ingen vekting per bongfarge).",
);

// ── B8: Multi-rad-progresjon med stabil rad-farge ──────────────────────────

test.todo(
  "[B8] runtime: spillet kjører gjennom Rad 1 → Rad 2 → Rad 3 → Rad 4 → Fullt Hus med SAMME rad-farge. " +
    "Forventet: rad-farge persisteres ved start og brukes uendret gjennom hele runden.",
);

test.todo(
  "[B8] runtime: ny scheduled-game trekker NY rad-farge (ikke gjenbruk fra forrige runde). " +
    "Forventet: hver scheduled-game har eget tilfeldig rad-farge-trekk.",
);

// ── B9: Defensivt — gameVariant-eksklusivitet ──────────────────────────────

test.todo(
  "[B9] runtime: Trafikklys + Oddsen er gjensidig ekskluderende. " +
    "Forventet: hvis BÅDE rules.gameVariant === 'trafikklys' OG spill1.oddsen er satt, kaster engine eller logger advarsel. " +
    "(Avgjørelse fra Tobias trengs: skal Trafikklys vinne eller skal det kaste?)",
);

test.todo(
  "[B9] runtime: ukjent rad-farge i rowColors → fallback til standard pattern eller eksplisitt feil. " +
    "Forventet: hvis rules.rowColors inneholder en farge som IKKE finnes i prizesPerRowColor, " +
    "skal engine logge warning og bruke trygg fallback (f.eks. lavest-farge eller feile spill-start).",
);

// ───────────────────────────────────────────────────────────────────────────
// META — sanity-check at gap-dokumentet eksisterer
// ───────────────────────────────────────────────────────────────────────────

test("[META] gap-dokument eksisterer på forventet sti", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  // Test-fil er i apps/backend/src/game/__tests__/
  // Doc-fil er i docs/architecture/
  // Repo-root er 4 nivåer opp fra __tests__/.
  const docPath = path.resolve(
    new URL(import.meta.url).pathname,
    "../../../../../../docs/architecture/TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md",
  );
  const stat = await fs.stat(docPath);
  assert.ok(stat.isFile(), `Gap-dokument må eksistere på ${docPath}`);
});
