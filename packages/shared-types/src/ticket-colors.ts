// ── Ticket-color catalog (single source of truth) ───────────────────────────
//
// SG-G3 (2026-04-27): Konsolidert ticket-color-enum til shared-types. Tidligere
// var den splittet over 3 filer:
//   1. `TICKET_COLORS` (admin-UI, 9 farger UPPERCASE) — Schedule-editor
//   2. `SPILL1_TICKET_COLORS` (admin-UI, 14 farger lowercase) — Spill 1 Add-form
//   3. `COLOR_SLUG_TO_NAME` + `SCHEDULER_COLOR_SLUG_TO_NAME` (backend, 14 farger)
//
// Risiko før konsolidering: silent fail når admin opprettet sub-game med farge X
// i ett UI som backend-engine ikke kjente.
//
// Etter konsolidering eier denne filen ÉN sannhets-kilde. Andre filer
// re-exporterer eller deriverer fra denne.
//
// ── Taksonomi ────────────────────────────────────────────────────────────────
// Vi har to tier:
//   Tier 1 — LEGACY (11 farger): Kjernen fra legacy AIS-systemet, dokumentert
//            i docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md §3.5.
//            Disse 11 fargene er obligatoriske og MÅ støttes av alle UI-er
//            og engines.
//
//   Tier 2 — SPILL 1 EXTENSION (6 farger): Spill 1-spesifikke utvidelser
//            som ikke finnes i legacy. Inkluderer Small Orange og Elvis 1-5.
//            Brukes av Spill 1 Add-form og variant-mapper, men ikke av den
//            generiske Schedule-editoren.
//
// ── Identifier-konvensjon ────────────────────────────────────────────────────
// To former lever side-om-side fordi de tjener ulike lag:
//   - SLUG-form (lowercase): "small_yellow", "large_purple", "elvis1"
//     Brukes i: backend-API-er, DB-JSON, Spill 1 admin-UI
//   - DISPLAY-form (Title Case): "Small Yellow", "Large Purple", "Elvis 1"
//     Brukes i: backend-engine `TicketTypeConfig.name`, UI-render
//   - UPPERCASE-form: "SMALL_YELLOW", "LARGE_PURPLE"
//     Legacy-form fra Schedule-editoren (SubGamesListEditor). Tilsvarer
//     slug-form med uppercase + underscore — samme semantikk, beholdt for
//     bakoverkompat.
//
// Mappings:
//   slug ↔ display: `LEGACY_COLOR_DISPLAY_NAMES` + `SPILL1_EXTENSION_COLOR_DISPLAY_NAMES`
//   slug ↔ uppercase: trivielt (toUpperCase / toLowerCase)
//
// ── Mystery Game (sub-game variant) ──────────────────────────────────────────
// Mystery er en egen sub-game-type (ikke en ticket-color). Lever i denne filen
// fordi den er nært knyttet til schedule-editor sub-game-config og deler
// validation-mønster med rowPrizesByColor.

// ── Tier 1: LEGACY (11 farger) ──────────────────────────────────────────────

/**
 * 11 legacy ticket-color-slugger fra AIS-systemet, ref.
 * `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` §3.5 +
 * `docs/architecture/SUBGAME_LEGACY_PARITY_AUDIT_2026-04-27.md` §5.3.
 *
 * Disse 11 fargene MÅ være tilgjengelige i alle UI-er og backend-engines.
 * Slug-form er kanonisk lagring — display-navn lever i mapper-tabellene under.
 *
 * Stabil rekkefølge: Small-varianter (Yellow, White, Purple, Green, Red),
 * Large-varianter (Yellow, White, Purple), så standalone-farger (Red, Green,
 * Blue). Rekkefølgen påvirker ikke funksjonalitet, men den bevares for
 * konsistens i UI-rendering.
 */
export const LEGACY_TICKET_COLOR_SLUGS = [
  "small_yellow",
  "small_white",
  "small_purple",
  "small_green",
  "small_red",
  "large_yellow",
  "large_white",
  "large_purple",
  "red",
  "green",
  "blue",
] as const;

export type LegacyTicketColorSlug = (typeof LEGACY_TICKET_COLOR_SLUGS)[number];

/** Slug → engine/UI display-navn for legacy farger. */
export const LEGACY_COLOR_DISPLAY_NAMES: Readonly<Record<LegacyTicketColorSlug, string>> = {
  small_yellow: "Small Yellow",
  small_white: "Small White",
  small_purple: "Small Purple",
  small_green: "Small Green",
  small_red: "Small Red",
  large_yellow: "Large Yellow",
  large_white: "Large White",
  large_purple: "Large Purple",
  red: "Red",
  green: "Green",
  blue: "Blue",
};

// ── Tier 2: SPILL 1 EXTENSION (6 farger) ────────────────────────────────────

/**
 * Spill 1-spesifikke farger som ikke er en del av legacy-katalogen.
 * Brukes av Spill 1 Add-form (`Spill1Config.SPILL1_TICKET_COLORS`) og
 * `spill1VariantMapper`. Schedule-editoren (multi-game) bruker IKKE disse.
 *
 *   - `small_orange` — historisk Spill 1 small-variant uten legacy-paritet
 *   - `elvis1`–`elvis5` — Elvis-billett-typene; har egen replace-pris-mekanikk
 *     i `Spill1Config.ElvisConfig`
 */
export const SPILL1_EXTENSION_COLOR_SLUGS = [
  "small_orange",
  "elvis1",
  "elvis2",
  "elvis3",
  "elvis4",
  "elvis5",
] as const;

export type Spill1ExtensionColorSlug = (typeof SPILL1_EXTENSION_COLOR_SLUGS)[number];

/** Slug → engine/UI display-navn for Spill 1-extension farger. */
export const SPILL1_EXTENSION_COLOR_DISPLAY_NAMES: Readonly<Record<Spill1ExtensionColorSlug, string>> = {
  small_orange: "Small Orange",
  elvis1: "Elvis 1",
  elvis2: "Elvis 2",
  elvis3: "Elvis 3",
  elvis4: "Elvis 4",
  elvis5: "Elvis 5",
};

// ── Union: ALL (17 = 11 legacy + 6 extension) ───────────────────────────────

/**
 * Hele katalogen — legacy + Spill 1 extension. Brukes av backend-mapper
 * som må støtte begge tier.
 */
export const ALL_TICKET_COLOR_SLUGS = [
  ...LEGACY_TICKET_COLOR_SLUGS,
  ...SPILL1_EXTENSION_COLOR_SLUGS,
] as const;

export type AnyTicketColorSlug = LegacyTicketColorSlug | Spill1ExtensionColorSlug;

// ── Spill 1-spesifikt subset (14) ───────────────────────────────────────────

/**
 * Tillatte billett-farger for Spill 1 (Bingo 75-ball). Subset av
 * `ALL_TICKET_COLOR_SLUGS` — utelater standalone `red`/`green`/`blue`
 * (de tre legacy ticket-typene har ikke Small/Large-variant og brukes
 * kun i Schedule-editor for andre spill).
 *
 * Spill 1 admin-UI (`gameManagement/Spill1Config.SPILL1_TICKET_COLORS`)
 * re-eksporterer denne listen.
 *
 * Stabil rekkefølge speiler legacy `SPILL1_TICKET_COLORS`:
 *   small/large × yellow/white/purple, small_red, small_green, small_orange,
 *   elvis1..elvis5.
 */
export const SPILL1_TICKET_COLOR_SLUGS = [
  "small_yellow",
  "large_yellow",
  "small_white",
  "large_white",
  "small_purple",
  "large_purple",
  "small_red",
  "small_green",
  "small_orange",
  "elvis1",
  "elvis2",
  "elvis3",
  "elvis4",
  "elvis5",
] as const;

export type Spill1TicketColorSlug = (typeof SPILL1_TICKET_COLOR_SLUGS)[number];

/**
 * Slug → display-navn for HELE katalogen (legacy + extension).
 * Eneste sannhets-kilde for backend `COLOR_SLUG_TO_NAME` og
 * `SCHEDULER_COLOR_SLUG_TO_NAME` — disse er nå derivasjoner.
 */
export const ALL_COLOR_DISPLAY_NAMES: Readonly<Record<AnyTicketColorSlug, string>> = {
  ...LEGACY_COLOR_DISPLAY_NAMES,
  ...SPILL1_EXTENSION_COLOR_DISPLAY_NAMES,
};

// ── Schedule-editor UPPERCASE-alias ─────────────────────────────────────────
//
// Schedule-editoren (SubGamesListEditor.ts) bruker UPPERCASE-form
// ("SMALL_YELLOW") som identifier i lagret JSON. Dette er en legacy-konvensjon
// vi beholder for bakoverkompat med eksisterende ScheduleSubgame-records.
//
// Schedule-editoren støtter KUN Tier 1 (legacy 11 farger), ikke Spill 1
// extension-farger — disse er kun aktuelle for Spill 1 selv.

/**
 * 11 legacy farger i UPPERCASE-form for Schedule-editor. Direkte derivat av
 * `LEGACY_TICKET_COLOR_SLUGS` (slug.toUpperCase()).
 *
 * BREAKING CHANGE 2026-04-27: utvidet fra 9 → 11 farger ved å inkludere
 * `SMALL_RED` og `SMALL_GREEN` (som finnes i legacy AIS men manglet her).
 * Eksisterende ScheduleSubgame-records er ikke påvirket — de inneholder
 * subset av disse 11 + evt. legacy fri-form-strenger.
 */
export const TICKET_COLORS = [
  "SMALL_YELLOW",
  "SMALL_WHITE",
  "SMALL_PURPLE",
  "SMALL_GREEN",
  "SMALL_RED",
  "LARGE_YELLOW",
  "LARGE_WHITE",
  "LARGE_PURPLE",
  "RED",
  "GREEN",
  "BLUE",
] as const;

export type TicketColor = (typeof TICKET_COLORS)[number];

/**
 * Type-guard for ticket-color UPPERCASE-strings (Schedule-editor-format).
 * Brukes av admin-web og backend-validering for å skille kanoniske
 * 11-farger fra legacy fri-form-strenger ("Yellow", "Blue", ...). Service-
 * laget må fortsatt akseptere legacy-strenger inntil all konfig er migrert
 * (fail-open på ukjente strenger).
 */
export function isTicketColor(value: unknown): value is TicketColor {
  return typeof value === "string" && (TICKET_COLORS as readonly string[]).includes(value);
}

// ── Helpers: konverter mellom representasjoner ──────────────────────────────

/** Slug ("small_yellow") → UPPERCASE ("SMALL_YELLOW"). */
export function colorSlugToUppercase(slug: string): string {
  return slug.toUpperCase();
}

/** UPPERCASE ("SMALL_YELLOW") → slug ("small_yellow"). */
export function colorUppercaseToSlug(uppercase: string): string {
  return uppercase.toLowerCase();
}

/**
 * Slug → display-navn ("Small Yellow"), eller null for ukjent slug.
 * Backend-engine bruker dette for å mappe admin-UI-input til
 * `TicketTypeConfig.name`.
 */
export function colorDisplayName(slug: string): string | null {
  const lower = slug.toLowerCase();
  if (lower in ALL_COLOR_DISPLAY_NAMES) {
    return ALL_COLOR_DISPLAY_NAMES[lower as AnyTicketColorSlug];
  }
  return null;
}

// ── RowPrizesByColor (Schedule-editor sub-game prize-matrix) ────────────────

/**
 * Per-farge rad-premier for en sub-game slot. Matcher legacy
 * "Row 1/2/3/4/Full House" fra Admin V1.0 s. 4:
 * - `ticketPrice`   — innsats per billett i kr
 * - `row1..row4`    — gevinst ved 1-4 rader
 * - `fullHouse`     — gevinst ved Full House / Bingo
 *
 * Alle beløp er kr (ikke øre) for konsistens med eksisterende
 * ScheduleService-felter som bruker kr direkte i config-JSON.
 *
 * Alle felter er valgfrie: admin kan fylle ut delvis (f.eks. kun fullHouse
 * for en yellow-ticket som bare har Bingo-gevinst).
 */
export interface TicketColorRowPrizes {
  ticketPrice?: number;
  row1?: number;
  row2?: number;
  row3?: number;
  row4?: number;
  fullHouse?: number;
}

/**
 * Record-form som lagres på `ScheduleSubgame.extra.rowPrizesByColor`.
 * Key er `TicketColor` (UPPERCASE); value er `TicketColorRowPrizes`. Mangel
 * på en key betyr at fargen ikke har pris-oppføring enda (admin fyller ut
 * progressivt).
 */
export type RowPrizesByColor = Partial<Record<TicketColor, TicketColorRowPrizes>>;

// ── Mystery Game (sub-game variant) ─────────────────────────────────────────

/**
 * Schedule-level sub-game-type-diskriminant. "STANDARD" er eksisterende
 * sub-game-oppførsel (pattern + ticket-colors); "MYSTERY" aktiverer
 * Mystery Game-flyten (s. 5 i Admin V1.0, rev. 2023-10-05).
 */
export const SUB_GAME_TYPES = ["STANDARD", "MYSTERY"] as const;
export type SubGameType = (typeof SUB_GAME_TYPES)[number];

/**
 * Konfig for Mystery Game sub-game. Lagres på
 * `ScheduleSubgame.extra.mysteryConfig`. `priceOptions` er en liste av
 * faste kr-beløp som spiller velger mellom. Min 1 verdi, maks 10
 * (wireframe viser 6 varianter men vi gir litt buffer).
 *
 * `yellowDoubles` speiler legacy "Yellow ticket → prize × 2"-regel: hvis
 * en spiller som har vunnet Full House på en yellow-billett deretter
 * vinner Mystery-spillet, dobles payouten. White og andre farger →
 * uendret.
 */
export interface MysterySubGameConfig {
  priceOptions: number[];
  yellowDoubles?: boolean;
}

/**
 * Validering brukt av både backend og admin-web for Mystery-konfig. Gir
 * en standardfeilmelding (null ved OK); kaller oppdaterer state med
 * feilen hvis truthy.
 */
export function validateMysteryConfig(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "mysteryConfig må være et objekt.";
  }
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.priceOptions)) {
    return "mysteryConfig.priceOptions må være en liste.";
  }
  if (cfg.priceOptions.length < 1 || cfg.priceOptions.length > 10) {
    return "mysteryConfig.priceOptions må ha 1–10 verdier.";
  }
  for (const v of cfg.priceOptions) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      return "mysteryConfig.priceOptions må være ikke-negative heltall (kr).";
    }
  }
  if (cfg.yellowDoubles !== undefined && typeof cfg.yellowDoubles !== "boolean") {
    return "mysteryConfig.yellowDoubles må være boolean.";
  }
  return null;
}

/**
 * Validering av rowPrizesByColor. Ukjente farge-keys tillates (fail-open
 * for bakover-kompat), men selve pris-objektet må være numerisk.
 */
export function validateRowPrizesByColor(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return "rowPrizesByColor må være et objekt.";
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [color, prizes] of entries) {
    if (!prizes || typeof prizes !== "object" || Array.isArray(prizes)) {
      return `rowPrizesByColor['${color}'] må være et objekt.`;
    }
    const p = prizes as Record<string, unknown>;
    const numericFields = [
      "ticketPrice",
      "row1",
      "row2",
      "row3",
      "row4",
      "fullHouse",
    ] as const;
    for (const f of numericFields) {
      if (p[f] === undefined) continue;
      const n = p[f];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        return `rowPrizesByColor['${color}'].${f} må være et ikke-negativt tall.`;
      }
    }
  }
  return null;
}
