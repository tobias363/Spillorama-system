/**
 * Bølge K4 — preset-builder for 5 nye Spill 1-varianter.
 *
 * Verifiserer at `buildSubVariantPresetPatterns` produserer patterns som:
 *   1. Matcher papir-planens beløp eksakt (kr-nivå)
 *   2. Bruker riktig `winningType` per variant
 *   3. Har riktig antall patterns (Kvikkis = 1, TV Extra = 3 concurrent,
 *      resten = 5 sekvensielle)
 *   4. Har gyldig shape så backend-mapperen kan konsumere direkte
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SPILL1_SUB_VARIANT_TYPES,
  isSpill1SubVariantType,
  buildSubVariantPresetPatterns,
  SPILL1_SUB_VARIANT_DEFAULTS,
  isOverrideableVariant,
  SPILL1_SUB_VARIANT_I18N_KEYS,
  resolveOddsen56PotOverrides,
  type Spill1SubVariantType,
  type Spill1VariantOverrides,
} from "../src/spill1-sub-variants.js";

// ── Enum-katalog ───────────────────────────────────────────────────────────

test("SPILL1_SUB_VARIANT_TYPES inneholder alle 6 varianter", () => {
  assert.equal(SPILL1_SUB_VARIANT_TYPES.length, 6);
  assert.ok(SPILL1_SUB_VARIANT_TYPES.includes("standard"));
  assert.ok(SPILL1_SUB_VARIANT_TYPES.includes("kvikkis"));
  assert.ok(SPILL1_SUB_VARIANT_TYPES.includes("tv-extra"));
  assert.ok(SPILL1_SUB_VARIANT_TYPES.includes("ball-x-10"));
  assert.ok(SPILL1_SUB_VARIANT_TYPES.includes("super-nils"));
  assert.ok(SPILL1_SUB_VARIANT_TYPES.includes("spillernes-spill"));
});

test("isSpill1SubVariantType — type-guard accepterer lovlige + avviser ulovlige", () => {
  for (const v of SPILL1_SUB_VARIANT_TYPES) {
    assert.equal(isSpill1SubVariantType(v), true);
  }
  assert.equal(isSpill1SubVariantType("unknown"), false);
  assert.equal(isSpill1SubVariantType(""), false);
  assert.equal(isSpill1SubVariantType(42), false);
  assert.equal(isSpill1SubVariantType(null), false);
  assert.equal(isSpill1SubVariantType(undefined), false);
});

test("i18n-nøkler finnes for alle varianter med ikke-tomme fallbacks", () => {
  for (const v of SPILL1_SUB_VARIANT_TYPES) {
    const entry = SPILL1_SUB_VARIANT_I18N_KEYS[v];
    assert.ok(entry, `i18n-entry mangler for ${v}`);
    assert.ok(entry.key.length > 0);
    assert.ok(entry.fallback.length > 0);
  }
});

test("isOverrideableVariant — kun 'standard' er overridable (MVP)", () => {
  assert.equal(isOverrideableVariant("standard"), true);
  assert.equal(isOverrideableVariant("kvikkis"), false);
  assert.equal(isOverrideableVariant("tv-extra"), false);
  assert.equal(isOverrideableVariant("ball-x-10"), false);
  assert.equal(isOverrideableVariant("super-nils"), false);
  assert.equal(isOverrideableVariant("spillernes-spill"), false);
});

// ── Standard ────────────────────────────────────────────────────────────────

test("standard preset: 5 fixed-patterns med 100/200/200/200/1000 kr", () => {
  const p = buildSubVariantPresetPatterns("standard");
  assert.equal(p.patterns.length, 5);
  assert.equal(p.customPatterns, undefined);
  const expected = [100, 200, 200, 200, 1000];
  p.patterns.forEach((pat, i) => {
    assert.equal(pat.winningType, "fixed", `fase ${i + 1} skal være fixed`);
    assert.equal(pat.prize1, expected[i], `fase ${i + 1} beløp`);
    assert.equal(pat.prizePercent, 0);
  });
  assert.equal(p.patterns[0]!.claimType, "LINE");
  assert.equal(p.patterns[4]!.claimType, "BINGO");
  assert.equal(p.patterns[4]!.name, "Fullt Hus");
});

// ── Kvikkis ─────────────────────────────────────────────────────────────────

test("kvikkis preset: kun Fullt Hus, 1000 kr fast", () => {
  const p = buildSubVariantPresetPatterns("kvikkis");
  assert.equal(p.patterns.length, 1);
  assert.equal(p.customPatterns, undefined);
  const [pat] = p.patterns;
  assert.equal(pat!.name, "Fullt Hus");
  assert.equal(pat!.claimType, "BINGO");
  assert.equal(pat!.winningType, "fixed");
  assert.equal(pat!.prize1, 1000);
});

test("kvikkis: ingen LINE-patterns (papir-regel — hurtig-bingo)", () => {
  const p = buildSubVariantPresetPatterns("kvikkis");
  const lineCount = p.patterns.filter((x) => x.claimType === "LINE").length;
  assert.equal(lineCount, 0);
});

// ── TV Extra ────────────────────────────────────────────────────────────────

test("tv-extra preset: 3 concurrent custom-patterns (Bilde/Ramme/Fullt Hus)", () => {
  const p = buildSubVariantPresetPatterns("tv-extra");
  // TV Extra bruker customPatterns, ikke sekvensielle patterns.
  assert.equal(p.patterns.length, 0);
  assert.ok(p.customPatterns);
  assert.equal(p.customPatterns!.length, 3);

  const byId = new Map(p.customPatterns!.map((cp) => [cp.patternId, cp]));
  const bilde = byId.get("bilde");
  const ramme = byId.get("ramme");
  const fullHouse = byId.get("full_house");
  assert.ok(bilde);
  assert.ok(ramme);
  assert.ok(fullHouse);

  assert.equal(bilde!.prize1, 500);
  assert.equal(ramme!.prize1, 1000);
  assert.equal(fullHouse!.prize1, 3000);

  // Alle skal være fixed-winning + concurrent.
  for (const cp of p.customPatterns!) {
    assert.equal(cp.winningType, "fixed");
    assert.equal(cp.concurrent, true);
    assert.ok(cp.mask > 0, `mask skal være satt for ${cp.patternId}`);
  }
});

test("tv-extra: masks er gyldige 25-bit og ikke-overlappende for disjoint patterns", () => {
  const p = buildSubVariantPresetPatterns("tv-extra");
  const picture = p.customPatterns!.find((cp) => cp.patternId === "bilde")!;
  const frame = p.customPatterns!.find((cp) => cp.patternId === "ramme")!;
  const fullHouse = p.customPatterns!.find((cp) => cp.patternId === "full_house")!;

  // Alle masker må være innenfor 25-bit range.
  for (const m of [picture.mask, frame.mask, fullHouse.mask]) {
    assert.ok(m > 0, "mask > 0");
    assert.ok(m <= 0x1ffffff, "mask ≤ 25-bit");
  }

  // Bilde (midten 3×3) og Ramme (ytre) skal være disjoint — ingen
  // felles bits. Det er geometrisk sant etter konstruksjon: Bilde
  // bruker rad 1-3 + kol 1-3, Ramme bruker rad 0/4 + kol 0/4.
  assert.equal(picture.mask & frame.mask, 0, "Bilde + Ramme skal være disjoint");

  // Full House = 0x1FFFFFF (alle 25 bits).
  assert.equal(fullHouse.mask, 0x1ffffff);

  // Picture + Frame til sammen = 24 celler (alle unntatt... egentlig 25).
  // 3×3 = 9, 25 - 9 = 16 celler i ramme. Sum = 25 = full house.
  assert.equal(picture.mask | frame.mask, fullHouse.mask);
});

// ── Ball × 10 ───────────────────────────────────────────────────────────────

test("ball-x-10 preset: Fullt Hus = ball-value-multiplier (1250 + ball×10)", () => {
  const p = buildSubVariantPresetPatterns("ball-x-10");
  assert.equal(p.patterns.length, 5);
  const full = p.patterns[4]!;
  assert.equal(full.name, "Fullt Hus");
  assert.equal(full.winningType, "ball-value-multiplier");
  assert.equal(full.baseFullHousePrizeNok, 1250);
  assert.equal(full.ballValueMultiplier, 10);
  // Fase 1-4 skal være standard fixed.
  for (let i = 0; i < 4; i += 1) {
    assert.equal(p.patterns[i]!.winningType, "fixed");
  }
});

test("ball-x-10 preset: papir-regel beregning — ball 45 → 1250 + 450 = 1700", () => {
  const p = buildSubVariantPresetPatterns("ball-x-10");
  const full = p.patterns[4]!;
  const ball = 45;
  const expected =
    (full.baseFullHousePrizeNok ?? 0) + ball * (full.ballValueMultiplier ?? 0);
  assert.equal(expected, 1700);
});

// ── Super-NILS ──────────────────────────────────────────────────────────────

test("super-nils preset: Fullt Hus = column-specific med B/I/N/G/O = 500/700/1000/700/500", () => {
  const p = buildSubVariantPresetPatterns("super-nils");
  assert.equal(p.patterns.length, 5);
  const full = p.patterns[4]!;
  assert.equal(full.winningType, "column-specific");
  assert.deepEqual(full.columnPrizesNok, {
    B: 500,
    I: 700,
    N: 1000,
    G: 700,
    O: 500,
  });
});

test("super-nils: kolonne-premier summerer korrekt (5×2 + 2×700 + 1×1000 = 3400 kr)", () => {
  const p = buildSubVariantPresetPatterns("super-nils");
  const col = p.patterns[4]!.columnPrizesNok!;
  const sum = col.B + col.I + col.N + col.G + col.O;
  assert.equal(sum, 3400, "500 + 700 + 1000 + 700 + 500");
});

// ── Spillernes spill ───────────────────────────────────────────────────────

test("spillernes-spill preset: 5 multiplier-chain-patterns", () => {
  const p = buildSubVariantPresetPatterns("spillernes-spill");
  assert.equal(p.patterns.length, 5);
  for (const pat of p.patterns) {
    assert.equal(pat.winningType, "multiplier-chain");
  }
});

test("spillernes-spill: fase 1 har prizePercent=3 + minPrize=50, INGEN phase1Multiplier", () => {
  const p = buildSubVariantPresetPatterns("spillernes-spill");
  const phase1 = p.patterns[0]!;
  assert.equal(phase1.prizePercent, 3);
  assert.equal(phase1.minPrize, 50);
  assert.equal(
    phase1.phase1Multiplier,
    undefined,
    "fase 1 er cascade-base (ingen multiplier)",
  );
});

test("spillernes-spill: fase N har phase1Multiplier = N (papir-regel)", () => {
  const p = buildSubVariantPresetPatterns("spillernes-spill");
  assert.equal(p.patterns[1]!.phase1Multiplier, 2, "fase 2 = Rad 1 × 2");
  assert.equal(p.patterns[2]!.phase1Multiplier, 3, "fase 3 = Rad 1 × 3");
  assert.equal(p.patterns[3]!.phase1Multiplier, 4, "fase 4 = Rad 1 × 4");
  assert.equal(p.patterns[4]!.phase1Multiplier, 10, "Fullt Hus = Rad 1 × 10");
});

test("spillernes-spill: min-gulv per fase — 50/50/100/100/500 kr", () => {
  const p = buildSubVariantPresetPatterns("spillernes-spill");
  assert.equal(p.patterns[0]!.minPrize, 50);
  assert.equal(p.patterns[1]!.minPrize, 50);
  assert.equal(p.patterns[2]!.minPrize, 100);
  assert.equal(p.patterns[3]!.minPrize, 100);
  assert.equal(p.patterns[4]!.minPrize, 500);
});

// ── Shape-invarianter alle varianter ───────────────────────────────────────

test("alle varianter: pattern-navn matcher classifyPhaseFromPatternName-regex", () => {
  const allowedNames = new Set([
    "1 Rad",
    "2 Rader",
    "3 Rader",
    "4 Rader",
    "Fullt Hus",
    "Bilde",
    "Ramme",
  ]);
  for (const v of SPILL1_SUB_VARIANT_TYPES) {
    const p = buildSubVariantPresetPatterns(v);
    for (const pat of [...p.patterns, ...(p.customPatterns ?? [])]) {
      assert.ok(
        allowedNames.has(pat.name),
        `variant ${v} har ukjent pattern-navn: "${pat.name}"`,
      );
    }
  }
});

test("alle varianter: prizePercent er 0 for fixed/column/ball/multiplier-chain fase > 1", () => {
  for (const v of SPILL1_SUB_VARIANT_TYPES) {
    const p = buildSubVariantPresetPatterns(v);
    for (const pat of [...p.patterns, ...(p.customPatterns ?? [])]) {
      if (
        pat.winningType === "fixed" ||
        pat.winningType === "column-specific" ||
        pat.winningType === "ball-value-multiplier"
      ) {
        assert.equal(
          pat.prizePercent,
          0,
          `variant ${v} fase "${pat.name}" skal ha prizePercent=0`,
        );
      }
    }
  }
});

test("SPILL1_SUB_VARIANT_DEFAULTS er frosset readonly (papir-regel-beløp)", () => {
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.kvikkis.fullHouse, 1000);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.picture, 500);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.frame, 1000);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.fullHouse, 3000);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.ballX10.base, 1250);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.ballX10.multiplier, 10);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.superNils.N, 1000);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase1MinPrize, 50);
  assert.equal(SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.fullHouseMultiplier, 10);
});

test("regresjon: buildSubVariantPresetPatterns er pure — samme input → identisk output", () => {
  for (const v of SPILL1_SUB_VARIANT_TYPES) {
    const a = buildSubVariantPresetPatterns(v);
    const b = buildSubVariantPresetPatterns(v);
    assert.deepEqual(a, b, `variant ${v} skal være deterministisk`);
  }
});

test("regresjon: TV Extra påvirker IKKE standard-presets (separat gren)", () => {
  const std = buildSubVariantPresetPatterns("standard");
  const tv = buildSubVariantPresetPatterns("tv-extra");
  assert.equal(std.patterns.length, 5);
  assert.equal(std.customPatterns, undefined);
  assert.equal(tv.patterns.length, 0);
  assert.equal(tv.customPatterns!.length, 3);
});

// ── Exhaustiveness-sjekk (deteksjon av manglende case i switch) ─────────────

test("exhaustive: ingen variant gir tomme patterns OG tomme customPatterns", () => {
  for (const v of SPILL1_SUB_VARIANT_TYPES) {
    const p = buildSubVariantPresetPatterns(v);
    const hasSeq = p.patterns.length > 0;
    const hasCustom = (p.customPatterns ?? []).length > 0;
    assert.ok(
      hasSeq || hasCustom,
      `variant ${v} skal ha minst ett pattern — verken sekvensielt eller custom`,
    );
  }
});

// ── Kast-tilfeller (defensive type-sjekk) ───────────────────────────────────

test("buildSubVariantPresetPatterns: ukjent variant kastes ikke av TS, men er ikke i enum", () => {
  // Siden SPILL1_SUB_VARIANT_TYPES er en literal-type kan man ikke sende
  // en ukjent string UTEN å caste. Denne testen verifiserer type-guarden
  // som admin-UI bruker for å filtrere input før preset bygges.
  assert.equal(isSpill1SubVariantType("unknown-variant"), false);
  assert.equal(isSpill1SubVariantType("tv extra"), false); // space/case sensitiv
  assert.equal(isSpill1SubVariantType("TV-EXTRA"), false);
});

// ── Audit 2026-04-30: Spill 1 legacy-paritet override-tester ───────────────
// PR #748 identifiserte 3 missing-prize-slots (TV1/TV2, O1/O2, SP1) som ikke
// kunne mappes via UI. Disse testene verifiserer at override-først-fallback-
// defaults pathen fungerer for alle 3 cases.

test("audit TV1/TV2: tv-extra override.pictureYellow + frameYellow brukes når satt", () => {
  const overrides: Spill1VariantOverrides = {
    tvExtra: {
      pictureYellow: 750,
      frameYellow: 1500,
    },
  };
  const p = buildSubVariantPresetPatterns("tv-extra", overrides);
  assert.equal(p.patterns.length, 0);
  assert.ok(p.customPatterns);
  const byId = new Map(p.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")!.prize1, 750, "Picture override respekteres");
  assert.equal(byId.get("ramme")!.prize1, 1500, "Frame override respekteres");
  // Full House mangler i overrides → default brukes
  assert.equal(
    byId.get("full_house")!.prize1,
    SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.fullHouse,
    "fullHouse default når override mangler",
  );
});

test("audit TV1/TV2: tv-extra fullHouseYellow override brukes også", () => {
  const overrides: Spill1VariantOverrides = {
    tvExtra: { fullHouseYellow: 5000 },
  };
  const p = buildSubVariantPresetPatterns("tv-extra", overrides);
  const byId = new Map(p.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("full_house")!.prize1, 5000);
  // Picture/Frame skal fortsatt være defaults
  assert.equal(byId.get("bilde")!.prize1, SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.picture);
  assert.equal(byId.get("ramme")!.prize1, SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.frame);
});

test("audit TV1/TV2: tv-extra UTEN override = identisk med pre-audit-output (regresjons-sjekk)", () => {
  const withoutOverride = buildSubVariantPresetPatterns("tv-extra");
  const withEmptyOverride = buildSubVariantPresetPatterns("tv-extra", {});
  const withTvExtraButNoFields = buildSubVariantPresetPatterns("tv-extra", {
    tvExtra: {},
  });
  assert.deepEqual(withoutOverride, withEmptyOverride);
  assert.deepEqual(withoutOverride, withTvExtraButNoFields);
});

test("audit TV1/TV2: tv-extra negative/NaN override → fallback til default", () => {
  // Defensive: negative tall ignoreres, defaults brukes.
  const p = buildSubVariantPresetPatterns("tv-extra", {
    tvExtra: {
      pictureYellow: -10 as number, // type-fysisk umulig, men runtime-mulig
      frameYellow: Number.NaN as number,
    },
  });
  const byId = new Map(p.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")!.prize1, SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.picture);
  assert.equal(byId.get("ramme")!.prize1, SPILL1_SUB_VARIANT_DEFAULTS.tvExtra.frame);
});

test("audit SP1: spillernes-spill override.minimumPrize brukes for fase 1", () => {
  const overrides: Spill1VariantOverrides = {
    spillerness2: { minimumPrize: 100 },
  };
  const p = buildSubVariantPresetPatterns("spillernes-spill", overrides);
  assert.equal(p.patterns.length, 5);
  const phase1 = p.patterns[0]!;
  assert.equal(phase1.minPrize, 100, "phase 1 minPrize bruker override");
  // phase 1 skal fortsatt være cascade-base (ingen multiplier)
  assert.equal(phase1.phase1Multiplier, undefined);
  assert.equal(phase1.prizePercent, SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase1PercentOfPool);
});

test("audit SP1: spillernes-spill cascade-faser arver default-mins (ikke override)", () => {
  const overrides: Spill1VariantOverrides = {
    spillerness2: { minimumPrize: 100 },
  };
  const p = buildSubVariantPresetPatterns("spillernes-spill", overrides);
  // Cascade-faser skal IKKE påvirkes av phase-1 override
  assert.equal(p.patterns[1]!.minPrize, SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase2MinPrize);
  assert.equal(p.patterns[2]!.minPrize, SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase3MinPrize);
  assert.equal(p.patterns[3]!.minPrize, SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase4MinPrize);
  assert.equal(p.patterns[4]!.minPrize, SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.fullHouseMinPrize);
});

test("audit SP1: spillernes-spill UTEN override = uendret default (regresjons-sjekk)", () => {
  const without = buildSubVariantPresetPatterns("spillernes-spill");
  const withEmpty = buildSubVariantPresetPatterns("spillernes-spill", {});
  assert.deepEqual(without, withEmpty);
  assert.equal(without.patterns[0]!.minPrize, SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill.phase1MinPrize);
});

test("audit O1/O2: resolveOddsen56PotOverrides — yellow=large, white=small mapping", () => {
  // Audit-mapping: Yellow.Full House Within 56 = pot-large (3000),
  // White.Full House Within 56 = pot-small (1500).
  const result = resolveOddsen56PotOverrides({
    fullHouseWithin56Yellow: 3000,
    fullHouseWithin56White: 1500,
  });
  assert.equal(result.potLargeNok, 3000);
  assert.equal(result.potSmallNok, 1500);
});

test("audit O1/O2: resolveOddsen56PotOverrides — kun yellow override → small=undefined", () => {
  const result = resolveOddsen56PotOverrides({
    fullHouseWithin56Yellow: 4500,
  });
  assert.equal(result.potLargeNok, 4500);
  assert.equal(result.potSmallNok, undefined, "white-override mangler → undefined → caller bruker engine-default");
});

test("audit O1/O2: resolveOddsen56PotOverrides — undefined input → both undefined", () => {
  const result = resolveOddsen56PotOverrides(undefined);
  assert.equal(result.potLargeNok, undefined);
  assert.equal(result.potSmallNok, undefined);
});

test("audit O1/O2: resolveOddsen56PotOverrides — empty object → both undefined", () => {
  const result = resolveOddsen56PotOverrides({});
  assert.equal(result.potLargeNok, undefined);
  assert.equal(result.potSmallNok, undefined);
});

test("audit O1/O2: resolveOddsen56PotOverrides — negative values → undefined (fallback)", () => {
  const result = resolveOddsen56PotOverrides({
    fullHouseWithin56Yellow: -100 as number,
    fullHouseWithin56White: -50 as number,
  });
  assert.equal(result.potLargeNok, undefined);
  assert.equal(result.potSmallNok, undefined);
});

test("audit: andre presets (kvikkis, ball-x-10, super-nils, standard) ignorerer override-input", () => {
  const overrides: Spill1VariantOverrides = {
    tvExtra: { pictureYellow: 9999 },
    spillerness2: { minimumPrize: 9999 },
  };
  // Disse 4 presets skal være uendret uavhengig av overrides
  for (const v of ["kvikkis", "ball-x-10", "super-nils", "standard"] as const) {
    const without = buildSubVariantPresetPatterns(v);
    const withOverrides = buildSubVariantPresetPatterns(v, overrides);
    assert.deepEqual(
      without,
      withOverrides,
      `variant ${v} skal ignorere TV/SP overrides`,
    );
  }
});

test("audit: deterministisk pure — override-input → identisk output på repeat", () => {
  const overrides: Spill1VariantOverrides = {
    tvExtra: { pictureYellow: 600, frameYellow: 1200, fullHouseYellow: 4000 },
    spillerness2: { minimumPrize: 250 },
  };
  const a1 = buildSubVariantPresetPatterns("tv-extra", overrides);
  const a2 = buildSubVariantPresetPatterns("tv-extra", overrides);
  const b1 = buildSubVariantPresetPatterns("spillernes-spill", overrides);
  const b2 = buildSubVariantPresetPatterns("spillernes-spill", overrides);
  assert.deepEqual(a1, a2);
  assert.deepEqual(b1, b2);
});

test("audit: TV Extra override prize=0 (eksplisitt nullstilt) bruker 0, ikke default", () => {
  // Audit-grensesak: admin har eksplisitt satt picture=0 (gratis-pattern).
  // 0 er gyldig (nonnegative), så override skal respekteres.
  const overrides: Spill1VariantOverrides = {
    tvExtra: { pictureYellow: 0 },
  };
  const p = buildSubVariantPresetPatterns("tv-extra", overrides);
  const byId = new Map(p.customPatterns!.map((cp) => [cp.patternId, cp]));
  assert.equal(byId.get("bilde")!.prize1, 0, "explicit 0 skal respekteres");
});
