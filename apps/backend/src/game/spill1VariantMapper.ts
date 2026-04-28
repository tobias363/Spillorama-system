/**
 * Spill 1 admin-UI-config → GameVariantConfig mapper.
 *
 * Oversetter `GameManagement.config.spill1` (produsert av admin-web
 * `Spill1Config.ts`) til den struktur BingoEngine forventer. Kjernen i
 * variantConfig-admin-koblingen:
 *
 *   admin-UI → GameManagement.config_json.spill1 → [denne mapperen] → GameVariantConfig
 *   → bindVariantConfigForRoom → BingoEngine.evaluateActivePhase
 *
 * PM-vedtak 2026-04-21 (Option X):
 *   - Hver farge har egen premie-matrise (`patternsByColor[color]`).
 *   - Multi-winner-split skjer innen én farges vinnere.
 *   - `__default__`-nøkkel er safety-net for legacy-games og konfig-feil;
 *     matcher DEFAULT_NORSK_BINGO_CONFIG.patterns (100/200/200/200/1000 kr).
 *
 * Bakoverkompat:
 *   - Manglende `prizePerPattern`-entries → fase-default brukes.
 *   - Plain number (legacy, pre-PR-A) tolkes som `{mode: "percent", amount: n}`.
 *   - `config.spill1` undefined → hele fallback returneres.
 *
 * Design-dok: docs/architecture/spill1-variantconfig-admin-coupling.md
 */

import type {
  CustomPatternDefinition,
  GameVariantConfig,
  PatternConfig,
  TicketTypeConfig,
} from "./variantConfig.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  DEFAULT_QUICKBINGO_CONFIG,
  PATTERNS_BY_COLOR_DEFAULT_KEY,
} from "./variantConfig.js";
import {
  buildSubVariantPresetPatterns,
  isSpill1SubVariantType,
  type PresetCustomPattern,
  type PresetPatternConfig,
  type Spill1SubVariantType,
} from "@spillorama/shared-types";

// ── Public input-type (defensive shape) ─────────────────────────────────────

/**
 * Shape-speil av admin-web `Spill1Config.ts`. Alle felt er optional fordi
 * denne JSON-en kommer fra DB og kan være delvis utfylt eller følge
 * legacy-format. Feltene vi ikke trenger her (timing, elvis, etc.) er
 * utelatt — de konsumeres av andre systemer.
 */
export interface Spill1ConfigInput {
  /**
   * BIN-689 + Bølge K4: Sub-variant-valg fra admin-UI.
   *
   * Historiske verdier (bakoverkompat):
   *   - "norsk-bingo" (default/undefined) = standard 5-fase
   *   - "kvikkis" = hurtig-bingo (kun Fullt Hus, 1000 kr fast)
   *
   * Nye verdier (K4, papir-plan):
   *   - "tv-extra"         = 3 concurrent patterns (Bilde/Ramme/Fullt Hus)
   *   - "ball-x-10"        = Fullt Hus = 1250 + ball×10
   *   - "super-nils"       = Fullt Hus per BINGO-kolonne (B/I/N/G/O)
   *   - "spillernes-spill" = Rad N = Rad 1 × N (multiplier-chain)
   *   - "standard"         = alias for "norsk-bingo" (klargjørende)
   *
   * For de 5 preset-variantene ignorerer mapperen admin-UI-en sitt manuelle
   * `prizePerPattern`-input og bruker hardkodet papir-regel-preset. Dette
   * gjør presetene forutsigbare og konsistente med papir-spesifikasjonen —
   * admin slipper å taste inn beløp per farge per fase for hver variant.
   *
   * "standard"/"norsk-bingo" respekterer admin-UI sitt `prizePerPattern`-
   * input uendret (samme som før K4).
   */
  subVariant?:
    | "norsk-bingo"
    | "standard"
    | "kvikkis"
    | "tv-extra"
    | "ball-x-10"
    | "super-nils"
    | "spillernes-spill";
  ticketColors?: ReadonlyArray<Spill1TicketColorInput>;
  jackpot?: {
    prizeByColor?: Record<string, number>;
    draw?: number;
  };
  luckyNumberPrizeNok?: number;
  elvis?: { replaceTicketPriceNok?: number };
  // Andre felter tillates men ignoreres.
  [key: string]: unknown;
}

interface Spill1TicketColorInput {
  color?: string;
  priceNok?: number;
  /**
   * Per-fase premie. Verdien er enten `PatternPrizeInput` (PR A-format)
   * eller et tall (legacy pre-PR-A, tolkes som percent).
   */
  prizePerPattern?: Record<string, PatternPrizeInput | number | undefined>;
  minimumPrizeNok?: number;
}

interface PatternPrizeInput {
  mode?: "percent" | "fixed";
  amount?: number;
}

// ── Slug → name mappings ────────────────────────────────────────────────────

/**
 * Admin-UI farge-slug → engine-side `TicketTypeConfig.name`.
 *
 * Må holdes i synk med `apps/admin-web/src/pages/games/gameManagement/
 * Spill1Config.ts:SPILL1_TICKET_COLORS`. Testet via symmetri-unit-test i
 * `spill1VariantMapper.test.ts`.
 */
const COLOR_SLUG_TO_NAME: Readonly<Record<string, string>> = {
  small_yellow: "Small Yellow",
  large_yellow: "Large Yellow",
  small_white: "Small White",
  large_white: "Large White",
  small_purple: "Small Purple",
  large_purple: "Large Purple",
  small_red: "Small Red",
  small_green: "Small Green",
  small_orange: "Small Orange",
  elvis1: "Elvis 1",
  elvis2: "Elvis 2",
  elvis3: "Elvis 3",
  elvis4: "Elvis 4",
  elvis5: "Elvis 5",
};

/**
 * Admin-UI pattern-slug → engine-side `PatternConfig.name`.
 *
 * Pattern-navnene må matche `DEFAULT_NORSK_BINGO_CONFIG.patterns[].name`
 * + regex i `classifyPhaseFromPatternName` (shared-types) så engine
 * kjenner igjen fasen.
 */
const PATTERN_SLUG_TO_NAME: Readonly<Record<string, string>> = {
  row_1: "1 Rad",
  row_2: "2 Rader",
  row_3: "3 Rader",
  row_4: "4 Rader",
  full_house: "Fullt Hus",
};

/** Fase-rekkefølge for norsk 5-fase = index i default-patterns-arrayen. */
const PATTERN_ORDER: readonly string[] = ["row_1", "row_2", "row_3", "row_4", "full_house"];

/** BIN-689: Fase-rekkefølge for Kvikkis = kun Fullt Hus. */
const PATTERN_ORDER_KVIKKIS: readonly string[] = ["full_house"];

/**
 * Bølge K4: Oversett admin-UI subVariant-string til den kanoniske
 * `Spill1SubVariantType` fra shared-types. Returnerer null for
 * "norsk-bingo"/undefined/ukjente verdier så mapperen bruker legacy-
 * pathen (admin-UI prizePerPattern respekteres).
 *
 * Merknad: "standard" er også preset-variant — den har samme patterns
 * som legacy-pathen ville gitt med default-input, men går via preset-
 * grenen for konsistens (samme `winningType: "fixed"` for alle faser).
 */
function resolvePresetVariant(
  subVariant: Spill1ConfigInput["subVariant"],
): Spill1SubVariantType | null {
  if (!subVariant) return null;
  // Legacy-alias: "norsk-bingo" er ikke en preset — bruk legacy-pathen
  // (admin-UI prizePerPattern overrider default-beløp).
  if (subVariant === "norsk-bingo") return null;
  if (isSpill1SubVariantType(subVariant)) return subVariant;
  return null;
}

// ── Preset → PatternConfig-konvertering ─────────────────────────────────────

/**
 * Konverter `PresetPatternConfig` fra shared-types til engine-side
 * `PatternConfig`. Setter `design` basert på fase-rekkefølge (matcher
 * legacy rendering-kontrakt: 0 = custom/full_house, 1-4 = row 1-4).
 */
function presetPatternToConfig(
  preset: PresetPatternConfig,
  orderIndex: number,
): PatternConfig {
  // design-konvensjon matcher patternConfigForPhase:
  //   full_house → 0, row_N → N.
  const isFull = preset.name === "Fullt Hus" && preset.claimType === "BINGO";
  const design = isFull ? 0 : orderIndex + 1;
  const out: PatternConfig = {
    name: preset.name,
    claimType: preset.claimType,
    prizePercent: preset.prizePercent,
    design,
  };
  if (preset.winningType) out.winningType = preset.winningType;
  if (typeof preset.prize1 === "number") out.prize1 = preset.prize1;
  if (typeof preset.phase1Multiplier === "number")
    out.phase1Multiplier = preset.phase1Multiplier;
  if (typeof preset.minPrize === "number") out.minPrize = preset.minPrize;
  if (preset.columnPrizesNok) out.columnPrizesNok = { ...preset.columnPrizesNok };
  if (typeof preset.baseFullHousePrizeNok === "number")
    out.baseFullHousePrizeNok = preset.baseFullHousePrizeNok;
  if (typeof preset.ballValueMultiplier === "number")
    out.ballValueMultiplier = preset.ballValueMultiplier;
  return out;
}

/**
 * Konverter `PresetCustomPattern` fra shared-types til engine-side
 * `CustomPatternDefinition`. Brukes av TV Extra og andre concurrent-
 * patterns-varianter.
 */
function presetCustomToConfig(
  preset: PresetCustomPattern,
): CustomPatternDefinition {
  const base = presetPatternToConfig(preset, 0);
  return {
    ...base,
    patternId: preset.patternId,
    mask: preset.mask,
    concurrent: true,
  };
}

// ── Helper: slug → TicketTypeConfig ─────────────────────────────────────────

/** Bygg én `TicketTypeConfig` fra admin-UI farge-slug. */
function ticketTypeFromSlug(slug: string): TicketTypeConfig | null {
  const name = COLOR_SLUG_TO_NAME[slug];
  if (!name) return null;

  if (slug.startsWith("large_")) {
    return { name, type: "large", priceMultiplier: 3, ticketCount: 3 };
  }
  if (slug.startsWith("elvis")) {
    return { name, type: "elvis", priceMultiplier: 2, ticketCount: 2 };
  }
  // Default: small_*
  return { name, type: "small", priceMultiplier: 1, ticketCount: 1 };
}

// ── Helper: fase-slug × prize → PatternConfig ───────────────────────────────

/**
 * Bygg en PatternConfig for én fase fra admin-UI prize-entry.
 *
 * @param patternSlug   f.eks. "row_1", "full_house"
 * @param order         0-indeksert fase-rekkefølge (for `design`)
 * @param rawPrize      PR A `{mode,amount}` eller legacy number (percent)
 * @param fallback      default-pattern hvis rawPrize mangler/invalid
 */
function patternConfigForPhase(
  patternSlug: string,
  order: number,
  rawPrize: PatternPrizeInput | number | undefined,
  fallback: PatternConfig,
): PatternConfig {
  const name = PATTERN_SLUG_TO_NAME[patternSlug] ?? fallback.name;
  const claimType = patternSlug === "full_house" ? "BINGO" : "LINE";
  const design = patternSlug === "full_house" ? 0 : order + 1;

  // Legacy number → percent-mode.
  if (typeof rawPrize === "number") {
    if (!Number.isFinite(rawPrize) || rawPrize < 0) {
      return { ...fallback, name, claimType, design };
    }
    return {
      name,
      claimType,
      design,
      prizePercent: rawPrize,
    };
  }

  // PR A-format `{mode, amount}`.
  if (rawPrize && typeof rawPrize === "object") {
    const amount = typeof rawPrize.amount === "number" ? rawPrize.amount : NaN;
    if (!Number.isFinite(amount) || amount < 0) {
      return { ...fallback, name, claimType, design };
    }
    if (rawPrize.mode === "fixed") {
      return {
        name,
        claimType,
        design,
        prizePercent: 0,
        winningType: "fixed",
        prize1: amount,
      };
    }
    // PILOT-EMERGENCY 2026-04-28 (testbruker-diagnose): mode:percent +
    // amount=0 produserte prizePercent:0 som ga totalPhasePrize=0 ved
    // payout-tid (pool * 0 / 100 = 0) → ingen gevinster + runde-state
    // korrupt. Fall tilbake til fallback-pattern (DEFAULT_NORSK_BINGO_CONFIG
    // har winningType:"fixed" med 100/200/200/200/1000 kr) i stedet for å
    // produsere en garantert-null-payout pattern. Admin kan eksplisitt
    // sette mode:fixed med amount:0 om de virkelig vil ha 0 kr-pattern;
    // mode:percent med amount=0 tolkes som "ikke konfigurert".
    //
    // Refs: docs/operations/TESTBRUKER_DIAGNOSE_2026-04-28.md §2.3, §6 Fix 2.
    if (amount === 0) {
      return { ...fallback, name, claimType, design };
    }
    // Default mode = percent (explicit or undefined) med ikke-null amount.
    return {
      name,
      claimType,
      design,
      prizePercent: amount,
    };
  }

  // Ingen konfig for denne fasen → fallback med justerte navn/claim/design.
  return { ...fallback, name, claimType, design };
}

/** Build en hel fase-matrise for én farge fra admin-UI `prizePerPattern`. */
function buildPatternsForColor(
  prizePerPattern: Spill1TicketColorInput["prizePerPattern"] | undefined,
  fallbackPatterns: ReadonlyArray<PatternConfig>,
  patternOrder: readonly string[],
): PatternConfig[] {
  return patternOrder.map((slug, i) =>
    patternConfigForPhase(slug, i, prizePerPattern?.[slug], fallbackPatterns[i] ?? fallbackPatterns[fallbackPatterns.length - 1]),
  );
}

// ── Public mapper ───────────────────────────────────────────────────────────

/**
 * Hovedinngang: bygg `GameVariantConfig` fra admin-UI spill1-config.
 *
 * Returnerer alltid en komplett konfig — manglende eller ugyldige
 * input-felt faller tilbake til `fallback` (default: norsk-bingo-
 * defaulten).
 *
 * `patternsByColor` er alltid populated etter denne kall:
 *   - Én oppføring per aktiv farge i `spill1.ticketColors`
 *   - `__default__`-oppføring (kopi av `fallback.patterns`)
 *
 * @param spill1    Admin-UI-config (fra `GameManagement.config_json.spill1`).
 *                  Undefined/null → ren fallback.
 * @param fallback  Base-konfig brukt når felt mangler. Defaultes til
 *                  DEFAULT_NORSK_BINGO_CONFIG (100/200/200/200/1000 kr).
 */
export function buildVariantConfigFromSpill1Config(
  spill1: Spill1ConfigInput | null | undefined,
  fallback?: GameVariantConfig,
): GameVariantConfig {
  // Bølge K4: Preset-variant-detection. Når admin velger en preset-variant
  // (kvikkis/tv-extra/ball-x-10/super-nils/spillernes-spill/standard)
  // bruker mapperen hardkodet papir-regel-preset i stedet for å lese
  // prizePerPattern fra admin-UI. Dette gjør presetene forutsigbare og
  // forenkler admin-UX (én dropdown → komplett spill-konfig).
  //
  // "norsk-bingo"/undefined følger legacy-pathen der admin-UI kan
  // overstyre default-beløp per farge + fase.
  //
  // **Eksplisitt fallback overrider preset-routing** — når caller sender
  // en `fallback`-parameter (typisk gjort i eksisterende tester og i
  // spesial-tilfeller) respekteres dens `patterns[]` som autoritativ.
  // Preset-pathen er ren admin-UI-drevet og aktiveres bare når caller
  // IKKE har angitt en eksplisitt fallback. Dette bevarer bakoverkompat
  // for eksisterende tester (BIN-689 Kvikkis-test m.fl.).
  const presetVariant =
    fallback === undefined ? resolvePresetVariant(spill1?.subVariant) : null;
  const preset = presetVariant ? buildSubVariantPresetPatterns(presetVariant) : null;

  // BIN-689: Kvikkis-routing. Hvis `subVariant === "kvikkis"` og ingen
  // eksplisitt fallback er angitt, bruk DEFAULT_QUICKBINGO_CONFIG så
  // patterns-listen blir 1-entry (Fullt Hus) i stedet for 5-fase.
  // Eksplisitt fallback (brukt i tester) respekteres alltid.
  const resolvedFallback: GameVariantConfig =
    fallback ??
    (spill1?.subVariant === "kvikkis" ? DEFAULT_QUICKBINGO_CONFIG : DEFAULT_NORSK_BINGO_CONFIG);

  // K4 preset-patterns: hvis admin har valgt en preset-variant, konverter
  // presets til engine-side PatternConfig-array. Brukes som `fallbackPatterns`
  // slik at per-farge-matrisen i patternsByColor bygges fra preset-beløpene.
  const presetPatterns: PatternConfig[] | null = preset
    ? preset.patterns.map((p, i) => presetPatternToConfig(p, i))
    : null;
  const presetCustomPatterns: CustomPatternDefinition[] | null =
    preset?.customPatterns && preset.customPatterns.length > 0
      ? preset.customPatterns.map((cp) => presetCustomToConfig(cp))
      : null;

  const fallbackPatterns = presetPatterns ?? resolvedFallback.patterns;
  const patternOrder =
    spill1?.subVariant === "kvikkis" ? PATTERN_ORDER_KVIKKIS : PATTERN_ORDER;

  // Ingen admin-config → ren fallback, men med eksplisitt __default__
  // slik at engine alltid har en path for ukjente farger.
  if (!spill1 || typeof spill1 !== "object") {
    return {
      ...resolvedFallback,
      patternsByColor: { [PATTERNS_BY_COLOR_DEFAULT_KEY]: [...fallbackPatterns] },
    };
  }

  const inputColors = Array.isArray(spill1.ticketColors) ? spill1.ticketColors : [];

  // Bygg ticketTypes + patternsByColor parallelt.
  const ticketTypes: TicketTypeConfig[] = [];
  const patternsByColor: Record<string, PatternConfig[]> = {
    [PATTERNS_BY_COLOR_DEFAULT_KEY]: [...fallbackPatterns],
  };

  for (const tc of inputColors) {
    if (!tc || typeof tc.color !== "string") continue;
    const ticketType = ticketTypeFromSlug(tc.color);
    if (!ticketType) continue; // Ukjent slug → hopp over (defensive).
    // Unngå duplikater hvis admin-UI har sendt samme farge to ganger.
    if (ticketTypes.some((t) => t.name === ticketType.name)) continue;
    ticketTypes.push(ticketType);

    // K4: For preset-varianter er premiene papir-regel-låst og identiske
    // på tvers av farger — vi kopierer preset-patternene inn per farge
    // (slik at `patternsByColor[color]` alltid har en entry for admin-
    // valgte farger). Admin kan ikke overstyre preset-beløp per farge.
    if (presetPatterns) {
      patternsByColor[ticketType.name] = presetPatterns.map((p) => ({ ...p }));
    } else {
      patternsByColor[ticketType.name] = buildPatternsForColor(
        tc.prizePerPattern,
        fallbackPatterns,
        patternOrder,
      );
    }
  }

  // Hvis admin ikke har valgt noen farger → fall tilbake til fallback.ticketTypes.
  const finalTicketTypes = ticketTypes.length > 0 ? ticketTypes : resolvedFallback.ticketTypes;

  // Jackpot-felt: mapper til legacy single-prize-shape på GameVariantConfig.
  // Admin-UI støtter per-farge jackpot (Record<color, kr>). Engine har kun
  // én jackpot-pris. Enkleste løsning for PR B: bruk maks av per-farge —
  // per-farge jackpot-routing er egen scope (ikke i PR B).
  const jackpot = buildJackpotFromInput(spill1.jackpot);

  const luckyNumberPrize =
    typeof spill1.luckyNumberPrizeNok === "number" && spill1.luckyNumberPrizeNok > 0
      ? spill1.luckyNumberPrizeNok
      : resolvedFallback.luckyNumberPrize;

  const replaceAmount =
    typeof spill1.elvis?.replaceTicketPriceNok === "number" && spill1.elvis.replaceTicketPriceNok > 0
      ? spill1.elvis.replaceTicketPriceNok
      : resolvedFallback.replaceAmount;

  // K4: TV Extra-variant bruker `customPatterns` (concurrent) i stedet for
  // sekvensielle patterns. Når customPatterns er satt, må engine bruke dem
  // direkte — patternsByColor ignoreres (se BingoEngine.ts-semantikk).
  // Mutually exclusive med patternsByColor per backend-validator.
  //
  // For TV Extra sletter vi patternsByColor (unntatt __default__ som
  // engine trenger for ukjente farger) siden engine bruker customPatterns
  // som autoritativ pattern-kilde.
  const shouldUseCustomPatterns =
    presetCustomPatterns !== null && presetCustomPatterns.length > 0;

  const baseReturn: GameVariantConfig = {
    ...resolvedFallback,
    ticketTypes: finalTicketTypes,
    patterns: shouldUseCustomPatterns
      ? [] // TV Extra: tom flat-array, engine bruker customPatterns
      : fallbackPatterns.map((p) => ({ ...p })),
    ...(shouldUseCustomPatterns
      ? {
          customPatterns: presetCustomPatterns!.map((cp) => ({ ...cp })),
          // customPatterns + patternsByColor er mutually exclusive i engine.
          // Dropp patternsByColor for TV Extra.
        }
      : { patternsByColor }),
    ...(jackpot
      ? { jackpot }
      : resolvedFallback.jackpot
        ? { jackpot: resolvedFallback.jackpot }
        : {}),
    ...(typeof luckyNumberPrize === "number" ? { luckyNumberPrize } : {}),
    ...(typeof replaceAmount === "number" ? { replaceAmount } : {}),
  };
  return baseReturn;
}

/**
 * Map admin-UI `jackpot.prizeByColor` til engine `jackpot`-feltet.
 * Tar maks-prisen (alle farger; 0 ignoreres) for å matche dagens
 * single-prize-shape. Per-farge jackpot-dispatch er egen scope.
 */
function buildJackpotFromInput(
  input: Spill1ConfigInput["jackpot"] | undefined,
): GameVariantConfig["jackpot"] | null {
  if (!input || typeof input !== "object") return null;
  const draw = typeof input.draw === "number" && input.draw > 0 ? input.draw : null;
  const pbc = input.prizeByColor;
  if (!pbc || typeof pbc !== "object" || !draw) return null;
  let max = 0;
  for (const v of Object.values(pbc)) {
    if (typeof v === "number" && Number.isFinite(v) && v > max) max = v;
  }
  if (max <= 0) return null;
  return { drawThreshold: draw, prize: max, isDisplay: true };
}

/**
 * Slå opp pattern-matrisen for en gitt ticket-color. Returnerer
 * `__default__`-matrisen hvis fargen ikke finnes i
 * `patternsByColor`. Logger warning når default brukes for en farge som
 * finnes i `ticketTypes[]` — det indikerer konfig-gap mellom admin-UI
 * og mapper-output.
 *
 * Brukes av `BingoEngine.evaluateActivePhase` for per-ticket-oppslag.
 */
export function resolvePatternsForColor(
  variantConfig: GameVariantConfig,
  color: string | undefined,
  onDefaultFallback?: (color: string) => void,
): ReadonlyArray<PatternConfig> {
  const map = variantConfig.patternsByColor;
  if (!map) return variantConfig.patterns;
  if (color && map[color]) return map[color];
  const defaultMatrix = map[PATTERNS_BY_COLOR_DEFAULT_KEY] ?? variantConfig.patterns;
  // Varsle bare hvis fargen eksisterer i ticketTypes (ellers er den
  // ukjent uansett og default er forventet).
  if (color && onDefaultFallback) {
    const configured = variantConfig.ticketTypes.some((t) => t.name === color);
    if (configured) onDefaultFallback(color);
  }
  return defaultMatrix;
}
