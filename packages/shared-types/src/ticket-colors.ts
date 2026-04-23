// ── Schedule ticket-color catalog + Mystery-game wire types ──────────────────
//
// feat/schedule-8-colors-mystery (2026-04-23): Legacy Admin V1.0 "Add Schedule"-
// dialog lot admin velge billett-farger per sub-game og angi pris + rad-premier
// per farge. Wireframene (Admin V1.0.pdf s. 4) + Mystery-oppdatering 2023-10-05
// krever 9 distinkte farge-varianter pluss en "Mystery"-sub-game med per-player
// prize-options. Tidligere `LEGACY_TICKET_COLOR_OPTIONS` i admin-web hadde
// kun 8 generiske farge-strenger uten size/variant-skille.
//
// Designvalg:
//   1. Farge-koder er STRING-enum ("SMALL_YELLOW", "LARGE_YELLOW", ...) slik
//      at de kan deles mellom backend-validering, admin-UI og game-client
//      uten å bryte DB-skjema (SubGame.ticket_colors_json er JSONB string[]).
//   2. Mystery-sub-gamen er en egen variant med multiple mulige premier —
//      ikke en ticket-color. Den stables sammen med øvrige sub-games i
//      Schedule men har sin egen konfig-shape.
//   3. Per-farge rad-premier serialiseres som `rowPrizesByColor`-record på
//      `ScheduleSubgame.extra.rowPrizesByColor`. Det holder oss bakoverkom-
//      patible med eksisterende `ticketTypesData`-field og gjør at vi kan
//      normalisere ut senere uten ytterligere wire-brudd.

/**
 * 9 kanoniske ticket-farger for Schedule-editoren. Matcher Admin V1.0-
 * wireframene (s. 4) + det Tobias godkjente 2026-04-23.
 *
 * Verdiene er stabile string-identifikatorer som lagres i database og
 * sendes over wire. Display-navn (nb/en) lever i admin-web/i18n.
 */
export const TICKET_COLORS = [
  "SMALL_YELLOW",
  "LARGE_YELLOW",
  "SMALL_WHITE",
  "LARGE_WHITE",
  "SMALL_PURPLE",
  "LARGE_PURPLE",
  "RED",
  "GREEN",
  "BLUE",
] as const;

export type TicketColor = (typeof TICKET_COLORS)[number];

/**
 * Type-guard for ticket-color strings. Brukes av admin-web og backend-
 * validering for å skille 9-kanoniske farger fra legacy-fri-form-strenger
 * ("Yellow", "Blue", ...). Service-laget må fortsatt akseptere legacy-
 * strenger inntil all konfig er migrert (fail-open på ukjente strenger).
 */
export function isTicketColor(value: unknown): value is TicketColor {
  return typeof value === "string" && (TICKET_COLORS as readonly string[]).includes(value);
}

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
 * Key er `TicketColor`; value er `TicketColorRowPrizes`. Mangel på en
 * key betyr at fargen ikke har pris-oppføring enda (admin fyller ut
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
