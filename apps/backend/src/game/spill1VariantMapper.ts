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
  type Spill1VariantOverrides,
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
  /**
   * Audit 2026-04-30 (PR #748): legacy-paritet override-felter for Tv Extra,
   * Oddsen 56 og Spillerness Spill 2. Når satt, leses verdiene FØR fallback
   * til `SPILL1_SUB_VARIANT_DEFAULTS`. Manglende felt → defaults.
   *
   * Shape speiler `Spill1OverridesSchema` (Zod) i
   * `packages/shared-types/src/schemas/admin.ts`. Engine-mapper-koblingen
   * er deklarert via `Spill1VariantOverrides` fra `@spillorama/shared-types`.
   *
   * Origin:
   * - `app_schedules.sub_games_json[].spill1Overrides` (schedule-import)
   * - `app_game1_scheduled_games.game_config_json.spill1Overrides` (snapshot)
   *
   * Ingen Oddsen-overrides flyter gjennom denne mapperen — `OddsenConfig.{potSmallNok,
   * potLargeNok}` leses av `MiniGameOddsenEngine` direkte fra
   * `app_mini_games_config.config_json` og eventuelt schedule-snapshot.
   * Tv Extra og Spillerness behandles av `buildSubVariantPresetPatterns`.
   */
  spill1Overrides?: Spill1VariantOverrides;
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

/** Konstant: Stor-bong = 3 brett. Matcher `lobbyTicketTypes.LARGE_TICKET_MULTIPLIER`. */
const LARGE_TICKET_MULTIPLIER = 3;

/**
 * Bygg én `TicketTypeConfig` fra admin-UI farge-slug.
 *
 * **Per-farge multipliers (PR #1411 / sub-bug PR #1408 fix):**
 *
 * Når `priceNok` + `minPriceNok` er angitt, bruker vi auto-multiplier-
 * baseline (samme matematikk som `packages/game-client/src/games/game1/
 * logic/lobbyTicketTypes.ts`):
 *   - small: `priceMultiplier = priceNok / minPriceNok` (eks. hvit=5 →
 *     mult=1, gul=10 → mult=2, lilla=15 → mult=3 med min=5)
 *   - large: small-multiplier × `LARGE_TICKET_MULTIPLIER` (3) (eks. hvit
 *     large=mult 3, gul large=mult 6, lilla large=mult 9)
 *   - elvis: respekterer `priceNok / minPriceNok` hvis angitt — ellers
 *     legacy-default `2` for bakoverkompat
 *
 * Hvis `priceNok` eller `minPriceNok` mangler / er ugyldige (0, null, NaN,
 * Infinity), fall tilbake til hardkodede legacy-multipliers (1/3/2) for
 * full backward-compat med eksisterende caller-sites og tester.
 *
 * **Hvorfor denne fixen:** Pre-fix-versjon hardkodet `priceMultiplier: 1`
 * for ALLE small-farger uavhengig av faktisk pris. Når
 * `roomState.variantByRoom`-bindingen lekket via `room:update`-snapshot
 * til frontend, fikk klient `gameVariant.ticketTypes` med flat mult=1/3,
 * og buy-popup-kalkulasjonen ble (eks.) `10 kr × 2 = 20 kr` istedenfor
 * 10 kr — selv om lobby-API'et `/api/games/spill1/lobby` allerede ga
 * korrekte priser.
 *
 * Frontend leser fra to kilder:
 *   1. `lobby.nextGame.ticketPricesCents` → korrekt via
 *      `lobbyTicketTypes.buildBuyPopupTicketConfigFromLobby`
 *   2. `state.ticketTypes` (room:update snapshot) → MÅTTE også være korrekt
 *      etter denne fixen
 */
function ticketTypeFromSlug(
  slug: string,
  priceNok?: number | null,
  minPriceNok?: number | null,
): TicketTypeConfig | null {
  const name = COLOR_SLUG_TO_NAME[slug];
  if (!name) return null;

  // Beregn auto-multiplier-baseline. Hvis EN av priceNok/minPriceNok mangler
  // eller er ugyldig (≤ 0, ikke-finite), faller vi til legacy-hardkodet
  // multiplier for backward-compat. Min må være > 0 for å unngå
  // division-by-zero.
  const hasValidPrices =
    typeof priceNok === "number" &&
    Number.isFinite(priceNok) &&
    priceNok > 0 &&
    typeof minPriceNok === "number" &&
    Number.isFinite(minPriceNok) &&
    minPriceNok > 0;

  if (slug.startsWith("large_")) {
    if (hasValidPrices) {
      // Large multiplier = (priceNok / minPriceNok). Bridgen skriver allerede
      // `priceNok = smallPrice × LARGE_TICKET_MULTIPLIER` for large-entries,
      // så ren division gir korrekt multiplier (eks. large_yellow priceNok=30,
      // min=5 → mult=6, som er small_yellow_mult(2) × LARGE(3)).
      const multiplier = priceNok / minPriceNok;
      return {
        name,
        type: "large",
        priceMultiplier: multiplier,
        ticketCount: LARGE_TICKET_MULTIPLIER,
      };
    }
    return {
      name,
      type: "large",
      priceMultiplier: LARGE_TICKET_MULTIPLIER,
      ticketCount: LARGE_TICKET_MULTIPLIER,
    };
  }
  if (slug.startsWith("elvis")) {
    if (hasValidPrices) {
      // Elvis bruker priceNok/minPriceNok hvis tilgjengelig. ticketCount=2 er
      // konvensjon for Elvis-pakker (2 brett per kjøp).
      return {
        name,
        type: "elvis",
        priceMultiplier: priceNok / minPriceNok,
        ticketCount: 2,
      };
    }
    return { name, type: "elvis", priceMultiplier: 2, ticketCount: 2 };
  }
  // Default: small_*
  if (hasValidPrices) {
    return {
      name,
      type: "small",
      priceMultiplier: priceNok / minPriceNok,
      ticketCount: 1,
    };
  }
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
  // Audit 2026-04-30: pass spill1Overrides slik at preset-patterns
  // (TV Extra Picture/Frame, Spillerness phase-1 minPrize) bruker
  // legacy-importerte verdier i stedet for hardkodede defaults.
  // Manglende felter → defaults via `SPILL1_SUB_VARIANT_DEFAULTS`.
  const preset = presetVariant
    ? buildSubVariantPresetPatterns(presetVariant, spill1?.spill1Overrides)
    : null;

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

  // PR #1411 (sub-bug PR #1408 fix): Beregn minimum `priceNok` på tvers av
  // ALLE konfigurerte farger først. Brukes som baseline for per-farge
  // `priceMultiplier`-beregning i `ticketTypeFromSlug`. Matcher samme
  // matematikk som `packages/game-client/src/games/game1/logic/
  // lobbyTicketTypes.buildBuyPopupTicketConfigFromLobby`.
  //
  // Hvorfor min-baseline:
  //   Spill 1 har 3 bongfarger (hvit/gul/lilla) med priser i 5/10/15-kr-
  //   forholdet, eller flat 15 kr for Trafikklys. Auto-multiplier
  //   normaliserer den BILLIGSTE bongen til mult=1, og dyrere bonger får
  //   forholds-multipliers. Engine + frontend deler dette mønsteret.
  //
  // Ugyldige priser ignoreres (≤ 0, ikke-finite, mangler). Hvis ALLE er
  // ugyldige → `minPriceNok = null` og `ticketTypeFromSlug` faller til
  // legacy-hardkodet multipliers (full backward-compat med eksisterende
  // tester der `priceNok` mangler).
  let minPriceNok: number | null = null;
  for (const tc of inputColors) {
    if (!tc || typeof tc.color !== "string") continue;
    const p = typeof tc.priceNok === "number" ? tc.priceNok : NaN;
    if (!Number.isFinite(p) || p <= 0) continue;
    if (minPriceNok === null || p < minPriceNok) {
      minPriceNok = p;
    }
  }

  // Bygg ticketTypes + patternsByColor parallelt.
  const ticketTypes: TicketTypeConfig[] = [];
  const patternsByColor: Record<string, PatternConfig[]> = {
    [PATTERNS_BY_COLOR_DEFAULT_KEY]: [...fallbackPatterns],
  };

  for (const tc of inputColors) {
    if (!tc || typeof tc.color !== "string") continue;
    const ticketType = ticketTypeFromSlug(tc.color, tc.priceNok, minPriceNok);
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

// ── HV-2: hall-default floor application ──────────────────────────────────

/**
 * HV-2 (Tobias 2026-04-30): per-fase floor-defaults fra hall-konfig.
 *
 * Shape matcher `Spill1PrizeDefaults` fra `Spill1PrizeDefaultsService.ts` men
 * importeres ikke direkte for å holde mapperen DB-fri. Caller (typisk
 * `roomState.bindVariantConfigForRoom`) henter defaults via tjenesten og
 * sender dem inn som rent data.
 *
 * Hver fase (1-5) mappes til pattern-navn via `PHASE_INDEX_TO_PATTERN_NAME`.
 * Verdiene er i kroner.
 */
export interface Spill1HallFloorDefaults {
  phase1: number;
  phase2: number;
  phase3: number;
  phase4: number;
  phase5: number;
}

/**
 * Map fase-index → pattern-navn (matcher `DEFAULT_NORSK_BINGO_CONFIG.patterns`
 * og `PATTERN_SLUG_TO_NAME`). Stabil — ikke endre uten å oppdatere preset-
 * variants og engine-pattern-classification samtidig.
 */
const PHASE_INDEX_TO_PATTERN_NAME: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
  1: "1 Rad",
  2: "2 Rader",
  3: "3 Rader",
  4: "4 Rader",
  5: "Fullt Hus",
};

/**
 * Hent floor-verdi (kr) for en gitt pattern basert på navnet.
 * Returnerer `null` hvis pattern-navnet ikke matcher en av de 5 standardfasene.
 */
function floorForPatternName(
  defaults: Spill1HallFloorDefaults,
  patternName: string,
): number | null {
  switch (patternName) {
    case "1 Rad":
      return defaults.phase1;
    case "2 Rader":
      return defaults.phase2;
    case "3 Rader":
      return defaults.phase3;
    case "4 Rader":
      return defaults.phase4;
    case "Fullt Hus":
      return defaults.phase5;
    default:
      return null;
  }
}

/**
 * Apply hall-default floors til en allerede-bygget GameVariantConfig.
 *
 * Semantikk (HV-2 §2):
 *   * For hver pattern: hvis sub-variant-preset/admin-UI har satt en
 *     `minPrize`, og den er ≥ hall-floor → behold preset-verdi (preset kan
 *     ØKE floor men ikke senke).
 *   * Hvis preset-`minPrize` er `undefined`/`0` eller mindre enn hall-floor,
 *     skriv hall-floor som `minPrize`.
 *   * Også for `winningType: "fixed"`-patterns: hvis `prize1 < hall-floor`,
 *     `minPrize` settes til hall-floor (engine vil bruke `Math.max(prize1,
 *     minPrize)` ved payout). Dette er nødvendig for at "Wheel of Fortune"
 *     med høyere preset-fixed-prize ikke senker floor.
 *   * Custom patterns (TV Extra: Bilde/Ramme/Fullt Hus) får KUN floor-applied
 *     på "Fullt Hus" — Bilde/Ramme er konseptuelt utenfor 5-fase-modellen
 *     og skal ikke arve hall-floor for Rad 1-4.
 *
 * Mutates **kopier** — caller får en ny `GameVariantConfig`-instans, original
 * forblir uendret. Trygg å kalle flere ganger på samme input.
 *
 * **Scope:** kun for Spill 1 (`gameSlug === "bingo"`). Caller må sjekke
 * gameSlug før invocation. Spill 2/3 skal IKKE få denne behandlingen.
 *
 * @param config    GameVariantConfig fra `buildVariantConfigFromSpill1Config`.
 * @param defaults  Hall-default floors hentet fra Spill1PrizeDefaultsService.
 * @returns         Ny GameVariantConfig med floor-applied minPrize.
 */
export function applySpill1HallFloors(
  config: GameVariantConfig,
  defaults: Spill1HallFloorDefaults,
): GameVariantConfig {
  // Helper: apply floor til én pattern (returnerer ny pattern-instans).
  //
  // **Scope-restriksjon (HV-2):** kun `winningType === "fixed"` får
  // hall-floor-overlay. multiplier-chain bruker minPrize som total-phase-
  // floor (ikke per-winner) og PhasePayoutService håndterer ikke det
  // tilfellet — å legge hall-floor på multiplier-chain ville lage
  // multi-winner over-payment-bug i Spillerness Spill 2.
  const applyToPattern = (pattern: PatternConfig): PatternConfig => {
    if (pattern.winningType !== "fixed") {
      return pattern;
    }
    const floor = floorForPatternName(defaults, pattern.name);
    if (floor === null || floor <= 0) return pattern;
    const currentMin = typeof pattern.minPrize === "number" ? pattern.minPrize : 0;
    if (currentMin >= floor) return pattern;
    return { ...pattern, minPrize: floor };
  };

  // Apply til alle pattern-arrays: flat patterns, patternsByColor og customPatterns.
  const newPatterns = config.patterns.map(applyToPattern);
  const newPatternsByColor = config.patternsByColor
    ? Object.fromEntries(
        Object.entries(config.patternsByColor).map(([color, patterns]) => [
          color,
          patterns.map(applyToPattern),
        ]),
      )
    : undefined;
  const newCustomPatterns = config.customPatterns
    ? config.customPatterns.map((cp) => {
        const updated = applyToPattern(cp);
        // Bevar custom-only-felter (mask, patternId, concurrent) — `updated`
        // har samme felter som cp pluss potensielt høyere minPrize, men
        // applyToPattern returnerer PatternConfig (uten custom-felter), så
        // vi merger inn cp først for å bevare patternId/mask/concurrent og
        // overskriver med updated for å få den nye minPrize.
        return {
          ...cp,
          ...updated,
          patternId: cp.patternId,
          mask: cp.mask,
          concurrent: cp.concurrent,
        };
      })
    : undefined;

  return {
    ...config,
    patterns: newPatterns,
    ...(newPatternsByColor ? { patternsByColor: newPatternsByColor } : {}),
    ...(newCustomPatterns ? { customPatterns: newCustomPatterns } : {}),
  };
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
