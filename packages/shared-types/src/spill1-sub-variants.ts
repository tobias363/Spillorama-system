/**
 * Bølge K4 (2026-04-23) — Spill 1 sub-game-varianter fra legacy papir-plan.
 *
 * Teknobingo-papir-planen "VÅRE SPILL" definerer 13 varianter (se
 * docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md). 8 var
 * portert før K4; K4 lukker de 5 siste gapene i admin-UX-laget ved å la
 * admin velge variant-type i stedet for manuelt å konfigurere
 * `winningType`/`columnPrizesNok`/`phase1Multiplier`/… per pattern.
 *
 * **Viktig:** Payout-motoren i `BingoEngine.ts` + `BingoEnginePatternEval.ts`
 * er allerede komplett — alle 5 `winningType`-moduser er støttet og
 * enhetstestet (se BingoEngine.{columnSpecific,ballValue,multiplierChain,
 * kvikkis,concurrentPatterns}.test.ts). K4 legger kun admin-UX + preset-
 * mapping oppå eksisterende motor; ingen endringer i payout-semantikk.
 *
 * ## Variant-tabell
 *
 * | Variant          | Legacy-navn         | Pattern-regel                           | winningType             |
 * |------------------|---------------------|-----------------------------------------|-------------------------|
 * | standard         | (norsk 5-fase)      | 100/200/200/200/1000 kr fast            | fixed                   |
 * | kvikkis          | "Kvikkis"           | Kun Fullt Hus, 1000 kr                  | fixed                   |
 * | tv-extra         | "Tv Extra"          | 3 concurrent: Bilde 500, Ramme 1000,    | fixed + customPatterns  |
 * |                  |                     | Full House 3000                         |                         |
 * | ball-x-10        | "Ball X 10"         | Full House = 1250 + lastBall×10         | ball-value-multiplier   |
 * | super-nils       | "Super Nils"        | Full House per BINGO-kolonne:           | column-specific         |
 * |                  |                     | B=500, I=700, N=1000, G=700, O=500      |                         |
 * | spillernes-spill | "Spillerness Spill" | Rad N = Rad 1 × N (cascade) + min-gulv  | multiplier-chain        |
 *
 * ## Legacy-referanse
 *
 * `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` (via
 * `git show 5fda0f78:...`) inneholder originale regler:
 *   - Ball × 10: `winningAmount = winningAmount + 10 * lastBall` når
 *     `room.gameName == "Ball X 10"` ved Full House.
 *   - Super-NILS: `room.gameName == "Super Nils"` → premie-array per
 *     kolonne-index (0-4 → B/I/N/G/O).
 *   - Spillernes: `gameName === "Spillerness Spill" || ... " 2"` →
 *     `minAmount = minimumWinningValue` + Rad N = Rad 1 × N.
 *   - TV Extra: `room.gameName === "Tv Extra"` → separate Frame +
 *     Full House-conditions.
 *
 * Alle beløp i presetene er i **kroner** (ikke øre). Mapperen håndterer
 * konvertering når backend kaller wallet.credit (kroner-basert).
 */

// ── Variant-type enum ───────────────────────────────────────────────────────

/**
 * Kanonisk variant-liste brukt av admin-UI (dropdown-verdier) og backend
 * (mapper-lookup). Holdes i synk med `buildSubVariantPresetPatterns`.
 *
 * Verdiene er stabile string-identifikatorer som lagres i DB på
 * `config.spill1.subVariant` og sendes over wire.
 */
export const SPILL1_SUB_VARIANT_TYPES = [
  "standard",
  "kvikkis",
  "tv-extra",
  "ball-x-10",
  "super-nils",
  "spillernes-spill",
] as const;

export type Spill1SubVariantType = (typeof SPILL1_SUB_VARIANT_TYPES)[number];

/** Type-guard for runtime-validering av string → Spill1SubVariantType. */
export function isSpill1SubVariantType(v: unknown): v is Spill1SubVariantType {
  return (
    typeof v === "string" &&
    (SPILL1_SUB_VARIANT_TYPES as readonly string[]).includes(v)
  );
}

// ── Preset-patterns per variant ─────────────────────────────────────────────

/**
 * Minimalt pattern-speil som både backend-mapperen og admin-UI kan konsumere.
 * Matcher `PatternConfig` i backend `variantConfig.ts`, men uten `design`-
 * feltet (det settes av mapperen basert på fase-rekkefølge).
 *
 * Feltnavn følger backend-navngiving (kr, ikke øre, for konsistens med
 * `prize1` på `PatternConfig`).
 */
export interface PresetPatternConfig {
  /** Matcher `DEFAULT_NORSK_BINGO_CONFIG.patterns[].name` + regex i
   *  classifyPhaseFromPatternName ("1 Rad", "Fullt Hus", …). */
  name: string;
  claimType: "LINE" | "BINGO";
  /** 0 når fixed/column-specific/ball-value/multiplier-chain phase N > 1. */
  prizePercent: number;
  /**
   * Payout-regel. Default "percent" hvis absent (samme som standard-flyt).
   * Alle 5 varianter kartlegger til en av disse 5 verdiene.
   */
  winningType?:
    | "percent"
    | "fixed"
    | "multiplier-chain"
    | "column-specific"
    | "ball-value-multiplier";
  /** Fixed-mode: kr-beløp. */
  prize1?: number;
  /** Multiplier-chain (fase > 1): N×base. */
  phase1Multiplier?: number;
  /** Multiplier-chain/fixed gulv i kr. */
  minPrize?: number;
  /** Super-NILS: per-kolonne kr. */
  columnPrizesNok?: {
    B: number;
    I: number;
    N: number;
    G: number;
    O: number;
  };
  /** Ball × 10: base kr. */
  baseFullHousePrizeNok?: number;
  /** Ball × 10: kr per ball-verdi (typisk 10). */
  ballValueMultiplier?: number;
}

/**
 * Concurrent custom pattern brukt av TV Extra. Matcher
 * `CustomPatternDefinition` i backend `variantConfig.ts`.
 */
export interface PresetCustomPattern extends PresetPatternConfig {
  patternId: string;
  /** 25-bit bitmask for 5×5 grid. Min 1 celle satt. */
  mask: number;
  concurrent: true;
}

// ── Masks fra spill1-patterns.ts (duplisert som konstant for preset-bruk) ──

// NB: Vi duplisere ikke hele spill1-patterns.ts fordi den importerer
// runtime-klasser fra game.ts. TV Extra trenger kun noen ferdig-beregnede
// masker som er enkle å hardkode her.

/** 25-bit mask for "Bilde" (TV Extra): sentrum 3×3 (8 celler + center). */
const TV_EXTRA_PICTURE_MASK =
  // rad 1-3, kol 1-3 (indekser 6,7,8,11,12,13,16,17,18)
  (1 << 6) | (1 << 7) | (1 << 8) |
  (1 << 11) | (1 << 12) | (1 << 13) |
  (1 << 16) | (1 << 17) | (1 << 18);

/** 25-bit mask for "Ramme" (TV Extra): ytre rammen (16 celler, rad 0/4 + kol 0/4). */
const TV_EXTRA_FRAME_MASK =
  // rad 0 (5 celler)
  (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) |
  // rad 4 (5 celler)
  (1 << 20) | (1 << 21) | (1 << 22) | (1 << 23) | (1 << 24) |
  // venstre + høyre kol (unntatt hjørner som er dekt av rad 0/4)
  (1 << 5) | (1 << 9) | (1 << 10) | (1 << 14) | (1 << 15) | (1 << 19);

/** 25-bit mask for "Full House" (hele brettet). Matcher PATTERN_MASK_FULL. */
const TV_EXTRA_FULL_HOUSE_MASK = 0x1ffffff;

// ── Variant-presets ─────────────────────────────────────────────────────────

/**
 * Papir-regel-beløp per variant. Alle i kr.
 *
 * Kilde: docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md +
 * legacy `GameProcess.js` regler.
 */
export const SPILL1_SUB_VARIANT_DEFAULTS = {
  standard: {
    row1: 100,
    row2: 200,
    row3: 200,
    row4: 200,
    fullHouse: 1000,
  },
  kvikkis: {
    fullHouse: 1000,
  },
  tvExtra: {
    picture: 500,
    frame: 1000,
    fullHouse: 3000,
  },
  ballX10: {
    base: 1250,
    multiplier: 10,
  },
  superNils: {
    B: 500,
    I: 700,
    N: 1000,
    G: 700,
    O: 500,
  },
  spillernesSpill: {
    // Rad 1 = 3% av pool, gulv 50 kr. Rad N = Rad 1 × N.
    phase1PercentOfPool: 3,
    phase1MinPrize: 50,
    phase2Multiplier: 2,
    phase2MinPrize: 50,
    phase3Multiplier: 3,
    phase3MinPrize: 100,
    phase4Multiplier: 4,
    phase4MinPrize: 100,
    fullHouseMultiplier: 10,
    fullHouseMinPrize: 500,
  },
} as const;

/**
 * Bygg preset-patterns for en gitt variant.
 *
 * Returnerer en liste av `PresetPatternConfig` + (for TV Extra) en liste
 * av `PresetCustomPattern`. Mapperen konsumerer denne output-en og lager
 * den endelige `GameVariantConfig` som BingoEngine bruker.
 *
 * **Scope:** Denne funksjonen er ren + deterministisk — ingen I/O eller
 * side-effekter. Returverdien cashbar for admin-UI live-preview.
 */
export interface Spill1SubVariantPreset {
  /** Sekvensielle patterns (fase 1..5 eller kun Fullt Hus for Kvikkis). */
  patterns: PresetPatternConfig[];
  /**
   * Concurrent custom patterns (kun TV Extra). Når denne er satt må
   * mapperen bruke `customPatterns` i stedet for `patterns[]` i engine-
   * konfig-en, per semantikken i backend `variantConfig.ts`.
   */
  customPatterns?: PresetCustomPattern[];
}

/**
 * Build preset for én variant.
 *
 * @param variant Variant-type valgt av admin.
 * @returns Preset med patterns + evt. customPatterns.
 */
export function buildSubVariantPresetPatterns(
  variant: Spill1SubVariantType,
): Spill1SubVariantPreset {
  switch (variant) {
    case "standard": {
      const d = SPILL1_SUB_VARIANT_DEFAULTS.standard;
      return {
        patterns: [
          { name: "1 Rad", claimType: "LINE", prizePercent: 0, winningType: "fixed", prize1: d.row1 },
          { name: "2 Rader", claimType: "LINE", prizePercent: 0, winningType: "fixed", prize1: d.row2 },
          { name: "3 Rader", claimType: "LINE", prizePercent: 0, winningType: "fixed", prize1: d.row3 },
          { name: "4 Rader", claimType: "LINE", prizePercent: 0, winningType: "fixed", prize1: d.row4 },
          { name: "Fullt Hus", claimType: "BINGO", prizePercent: 0, winningType: "fixed", prize1: d.fullHouse },
        ],
      };
    }

    case "kvikkis": {
      const d = SPILL1_SUB_VARIANT_DEFAULTS.kvikkis;
      return {
        patterns: [
          {
            name: "Fullt Hus",
            claimType: "BINGO",
            prizePercent: 0,
            winningType: "fixed",
            prize1: d.fullHouse,
          },
        ],
      };
    }

    case "tv-extra": {
      const d = SPILL1_SUB_VARIANT_DEFAULTS.tvExtra;
      // TV Extra bruker customPatterns (concurrent). Tomt `patterns[]` —
      // mapperen sender customPatterns direkte i engine-config.
      return {
        patterns: [],
        customPatterns: [
          {
            patternId: "bilde",
            name: "Bilde",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: d.picture,
            mask: TV_EXTRA_PICTURE_MASK,
            concurrent: true,
          },
          {
            patternId: "ramme",
            name: "Ramme",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: d.frame,
            mask: TV_EXTRA_FRAME_MASK,
            concurrent: true,
          },
          {
            patternId: "full_house",
            name: "Fullt Hus",
            claimType: "BINGO",
            prizePercent: 0,
            winningType: "fixed",
            prize1: d.fullHouse,
            mask: TV_EXTRA_FULL_HOUSE_MASK,
            concurrent: true,
          },
        ],
      };
    }

    case "ball-x-10": {
      const d = SPILL1_SUB_VARIANT_DEFAULTS.ballX10;
      // Fase 1-4 bruker standard-fixed-beløp; kun Fullt Hus er
      // ball-value-multiplier. Papir-plan sier "Full House = 1250 + ball×10"
      // og sier ikke noe om tidligere faser → bruker standard-beløp.
      return {
        patterns: [
          {
            name: "1 Rad",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row1,
          },
          {
            name: "2 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row2,
          },
          {
            name: "3 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row3,
          },
          {
            name: "4 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row4,
          },
          {
            name: "Fullt Hus",
            claimType: "BINGO",
            prizePercent: 0,
            winningType: "ball-value-multiplier",
            baseFullHousePrizeNok: d.base,
            ballValueMultiplier: d.multiplier,
          },
        ],
      };
    }

    case "super-nils": {
      const d = SPILL1_SUB_VARIANT_DEFAULTS.superNils;
      // Papir-plan: kun Fullt Hus har kolonne-spesifikk premie. Fase 1-4
      // er standard-beløp.
      return {
        patterns: [
          {
            name: "1 Rad",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row1,
          },
          {
            name: "2 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row2,
          },
          {
            name: "3 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row3,
          },
          {
            name: "4 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "fixed",
            prize1: SPILL1_SUB_VARIANT_DEFAULTS.standard.row4,
          },
          {
            name: "Fullt Hus",
            claimType: "BINGO",
            prizePercent: 0,
            winningType: "column-specific",
            columnPrizesNok: { B: d.B, I: d.I, N: d.N, G: d.G, O: d.O },
          },
        ],
      };
    }

    case "spillernes-spill": {
      const d = SPILL1_SUB_VARIANT_DEFAULTS.spillernesSpill;
      return {
        patterns: [
          {
            name: "1 Rad",
            claimType: "LINE",
            prizePercent: d.phase1PercentOfPool,
            winningType: "multiplier-chain",
            minPrize: d.phase1MinPrize,
            // phase1Multiplier absent → denne ER fase 1 (cascade-base).
          },
          {
            name: "2 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "multiplier-chain",
            phase1Multiplier: d.phase2Multiplier,
            minPrize: d.phase2MinPrize,
          },
          {
            name: "3 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "multiplier-chain",
            phase1Multiplier: d.phase3Multiplier,
            minPrize: d.phase3MinPrize,
          },
          {
            name: "4 Rader",
            claimType: "LINE",
            prizePercent: 0,
            winningType: "multiplier-chain",
            phase1Multiplier: d.phase4Multiplier,
            minPrize: d.phase4MinPrize,
          },
          {
            name: "Fullt Hus",
            claimType: "BINGO",
            prizePercent: 0,
            winningType: "multiplier-chain",
            phase1Multiplier: d.fullHouseMultiplier,
            minPrize: d.fullHouseMinPrize,
          },
        ],
      };
    }
  }
}

/**
 * Lovlig-flag per variant: kan admin manuelt override premie-beløpene?
 *
 * Alle 5 nye varianter er presets — admin kan ikke overstyre (simplifisert
 * MVP). "standard" er alltid redigerbar. Fremtidige PR-er kan åpne for
 * override via ekstra `overridesEnabled`-flag i config.
 */
export function isOverrideableVariant(v: Spill1SubVariantType): boolean {
  return v === "standard";
}

/**
 * i18n-nøkkel per variant (admin-UI bruker disse). Faktiske oversettelser
 * lever i `apps/admin-web/src/i18n/{no,en}.json`. Klienten bruker navnet
 * i parantes som fallback når i18n mangler.
 */
export const SPILL1_SUB_VARIANT_I18N_KEYS: Readonly<
  Record<Spill1SubVariantType, { key: string; fallback: string }>
> = {
  "standard": { key: "spill1_sub_variant_standard", fallback: "Standard (norsk 5-fase)" },
  "kvikkis": { key: "spill1_sub_variant_kvikkis", fallback: "Kvikkis" },
  "tv-extra": { key: "spill1_sub_variant_tv_extra", fallback: "TV Extra" },
  "ball-x-10": { key: "spill1_sub_variant_ball_x_10", fallback: "Ball × 10" },
  "super-nils": { key: "spill1_sub_variant_super_nils", fallback: "Super-NILS" },
  "spillernes-spill": { key: "spill1_sub_variant_spillernes_spill", fallback: "Spillernes spill" },
};
