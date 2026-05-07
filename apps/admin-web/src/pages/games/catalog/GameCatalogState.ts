/**
 * Fase 2 (2026-05-07): GameCatalog UI state-helpers.
 *
 * Tynt lag rundt apps/admin-web/src/api/admin-game-catalog.ts som dekker
 * UI-spesifikke transformasjoner (kr ↔ øre konvertering, write-result-
 * mapping). UI-en sender beløp i KRONER inn i forms — vi konverterer til
 * ØRE før vi sender til backend, og tilbake til kr ved render.
 */

import { ApiError } from "../../../api/client.js";
import {
  createGameCatalogEntry,
  deactivateGameCatalogEntry,
  getGameCatalogEntry,
  listGameCatalog,
  updateGameCatalogEntry,
  type CreateGameCatalogInput,
  type GameCatalogEntry,
  type ListGameCatalogParams,
  type PrizeMultiplierMode,
  type PrizesCents,
  type TicketColor,
  type UpdateGameCatalogInput,
} from "../../../api/admin-game-catalog.js";

// ── Form-payload (UI bruker kroner, backend bruker øre) ─────────────────

/**
 * Spilltype-variant — styrer hvilke editor-seksjoner som vises.
 *
 * - `standard`: vanlig spill med pris-pr-bongfarge + premier-pr-rad +
 *   bingo-pr-bongfarge (eller auto-multiplikator).
 * - `trafikklys`: én flat pris alle bonger; premier per RAD-FARGE
 *   (rød/grønn/gul) — ikke per bongfarge.
 * - `oddsen`: standard bongpriser; bingo-premie HØY hvis fullt hus
 *   treffer på `targetDraw`, LAV ellers.
 *
 * Tobias 2026-05-07: variant lagres i `rules.gameVariant`-blob på
 * backend; standard-felter (ticketPricesCents/prizesCents) sendes
 * fortsatt for å passere validering, men engine bruker `rules` for
 * spesial-spill.
 */
export const GAME_VARIANT_VALUES = ["standard", "trafikklys", "oddsen"] as const;
export type GameVariant = (typeof GAME_VARIANT_VALUES)[number];

/** Trafikklys rad-farger (regulatorisk hardkodet). */
export const TRAFIKKLYS_ROW_COLORS = ["grønn", "gul", "rød"] as const;
export type TrafikklysRowColor = (typeof TRAFIKKLYS_ROW_COLORS)[number];

/**
 * Trafikklys-spesifikke felter. Lagres i `rules.gameVariant === "trafikklys"`.
 *
 * Tobias 2026-05-07: 3 rad-farger (grønn/gul/rød), prismatrise per
 * rad-farge — ikke per bongfarge. Én flat pris alle bonger (15 kr default).
 */
export interface TrafikklysRules {
  /** Flat pris alle bonger (kr). */
  ticketPriceKr: number;
  /** Aktive rad-farger (default alle 3). */
  rowColors: TrafikklysRowColor[];
  /** Premie per rad-farge (kr). */
  prizesPerRowColorKr: Partial<Record<TrafikklysRowColor, number>>;
  /** Bingo (fullt hus) per rad-farge (kr). */
  bingoPerRowColorKr: Partial<Record<TrafikklysRowColor, number>>;
}

/**
 * Oddsen-spesifikke felter. Lagres i `rules.gameVariant === "oddsen"`.
 *
 * Tobias 2026-05-07: standard bongpriser (5/10/15 kr); fullt hus PÅ
 * `targetDraw` gir HØY premie, ellers LAV. Editor lagrer base for
 * billigste bong (5 kr) og preview viser per-farge low/high via
 * multiplikator (low × pris/5, high × pris/5).
 */
export interface OddsenRules {
  /** Trekk-nummer (1-90) som gir HØY bingo-premie. */
  targetDraw: number;
  /** Lav-base (kr) — fullt hus IKKE på target-trekk. */
  bingoBaseLowKr: number;
  /** Høy-base (kr) — fullt hus PÅ target-trekk. */
  bingoBaseHighKr: number;
  /** Per-farge low (kr) — preview-utledet, lagres rå i rules. */
  bingoLowPerColorKr: Partial<Record<TicketColor, number>>;
  bingoHighPerColorKr: Partial<Record<TicketColor, number>>;
}

export interface CatalogFormPayload {
  slug: string;
  displayName: string;
  description: string | null;
  ticketColors: TicketColor[];
  /** Pris pr. valgte farge i KR. */
  ticketPricesKr: Partial<Record<TicketColor, number>>;
  /**
   * Premie-modus.
   *
   * - "auto" (default): én base-premie pr rad/bingo, multipliseres opp
   *   for dyrere bonger ut fra `ticketPrice / 5 kr`.
   * - "explicit_per_color": flat pris per bong + eksplisitt per-bong-
   *   farge bingo (Trafikklys-stil).
   */
  prizeMultiplierMode: PrizeMultiplierMode;
  /** Premier i KR. */
  prizesKr: {
    rad1: number;
    rad2: number;
    rad3: number;
    rad4: number;
    /** Auto-modus base — gjelder billigste bong (5 kr). */
    bingoBase: number;
    /** Per-farge bingo for explicit-modus. */
    bingo: Partial<Record<TicketColor, number>>;
  };
  bonusGameEnabled: boolean;
  bonusGameSlug: CreateGameCatalogInput["bonusGameSlug"];
  requiresJackpotSetup: boolean;
  isActive: boolean;
  sortOrder: number;
  /**
   * Spilltype-variant. Default `standard`. Trafikklys og Oddsen
   * aktiverer spesial-editor-seksjoner og sender utvidet rules-blob.
   */
  gameVariant: GameVariant;
  /** Trafikklys-spesifikke felter (kun aktive når gameVariant=trafikklys). */
  trafikklys: TrafikklysRules;
  /** Oddsen-spesifikke felter (kun aktive når gameVariant=oddsen). */
  oddsen: OddsenRules;
}

export type WriteResult =
  | { ok: true; entry: GameCatalogEntry }
  | { ok: false; reason: "PERMISSION_DENIED" | "VALIDATION" | "BACKEND_ERROR"; message: string };

// ── kr ↔ øre helpers ────────────────────────────────────────────────────

export function krToCents(kr: number): number {
  if (!Number.isFinite(kr)) return 0;
  // Tobias 2026-05-07: UI bruker hele kroner; ingen desimaler-i-input.
  return Math.round(kr * 100);
}

export function centsToKr(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

function mapPricesToCents(
  pricesKr: Partial<Record<TicketColor, number>>,
): Partial<Record<TicketColor, number>> {
  const out: Partial<Record<TicketColor, number>> = {};
  for (const [color, kr] of Object.entries(pricesKr) as [TicketColor, number][]) {
    if (typeof kr === "number" && Number.isFinite(kr) && kr > 0) {
      out[color] = krToCents(kr);
    }
  }
  return out;
}

function mapPrizesToCents(
  prizesKr: CatalogFormPayload["prizesKr"],
  mode: PrizeMultiplierMode,
): PrizesCents {
  const bingoCents: Partial<Record<TicketColor, number>> = {};
  for (const [color, kr] of Object.entries(prizesKr.bingo) as [TicketColor, number][]) {
    if (typeof kr === "number" && Number.isFinite(kr) && kr > 0) {
      bingoCents[color] = krToCents(kr);
    }
  }
  const out: PrizesCents = {
    rad1: krToCents(prizesKr.rad1),
    rad2: krToCents(prizesKr.rad2),
    rad3: krToCents(prizesKr.rad3),
    rad4: krToCents(prizesKr.rad4),
    bingo: bingoCents,
  };
  // Auto-modus: send bingoBase. Explicit-modus: utelat (backend ignorerer).
  if (mode === "auto") {
    out.bingoBase = krToCents(prizesKr.bingoBase);
  }
  return out;
}

/**
 * Bygg `rules`-blob ut fra payload. Standard-variant gir tom rules;
 * Trafikklys og Oddsen gir gameVariant + spesial-felter med beløp i ØRE.
 *
 * Tobias 2026-05-07: vi sender ALLE beløp i øre (cents) i rules-blob
 * for å være konsistent med ticketPricesCents/prizesCents.
 */
function buildRules(payload: CatalogFormPayload): Record<string, unknown> {
  if (payload.gameVariant === "trafikklys") {
    const t = payload.trafikklys;
    const prizesPerRowColor: Partial<Record<TrafikklysRowColor, number>> = {};
    for (const [c, kr] of Object.entries(t.prizesPerRowColorKr) as [
      TrafikklysRowColor,
      number,
    ][]) {
      if (typeof kr === "number" && Number.isFinite(kr) && kr > 0) {
        prizesPerRowColor[c] = krToCents(kr);
      }
    }
    const bingoPerRowColor: Partial<Record<TrafikklysRowColor, number>> = {};
    for (const [c, kr] of Object.entries(t.bingoPerRowColorKr) as [
      TrafikklysRowColor,
      number,
    ][]) {
      if (typeof kr === "number" && Number.isFinite(kr) && kr > 0) {
        bingoPerRowColor[c] = krToCents(kr);
      }
    }
    return {
      gameVariant: "trafikklys",
      ticketPriceCents: krToCents(t.ticketPriceKr),
      rowColors: t.rowColors,
      prizesPerRowColor,
      bingoPerRowColor,
    };
  }
  if (payload.gameVariant === "oddsen") {
    const o = payload.oddsen;
    const bingoLowPerColor: Partial<Record<TicketColor, number>> = {};
    for (const [c, kr] of Object.entries(o.bingoLowPerColorKr) as [
      TicketColor,
      number,
    ][]) {
      if (typeof kr === "number" && Number.isFinite(kr) && kr > 0) {
        bingoLowPerColor[c] = krToCents(kr);
      }
    }
    const bingoHighPerColor: Partial<Record<TicketColor, number>> = {};
    for (const [c, kr] of Object.entries(o.bingoHighPerColorKr) as [
      TicketColor,
      number,
    ][]) {
      if (typeof kr === "number" && Number.isFinite(kr) && kr > 0) {
        bingoHighPerColor[c] = krToCents(kr);
      }
    }
    return {
      gameVariant: "oddsen",
      targetDraw: o.targetDraw,
      bingoBaseLow: krToCents(o.bingoBaseLowKr),
      bingoBaseHigh: krToCents(o.bingoBaseHighKr),
      bingoLowPerColor,
      bingoHighPerColor,
    };
  }
  // Standard-variant: ingen spesial-rules, lar backend håndtere defaults.
  return {};
}

// ── Reads ───────────────────────────────────────────────────────────────

export async function fetchCatalogList(
  params: ListGameCatalogParams = {},
): Promise<GameCatalogEntry[]> {
  const result = await listGameCatalog(params);
  return result.entries;
}

export async function fetchCatalogEntry(
  id: string,
): Promise<GameCatalogEntry | null> {
  try {
    return await getGameCatalogEntry(id);
  } catch (err) {
    if (err instanceof ApiError && err.code === "GAME_CATALOG_NOT_FOUND") {
      return null;
    }
    throw err;
  }
}

// ── Writes ──────────────────────────────────────────────────────────────

function apiErrorToResult(err: unknown): WriteResult {
  if (err instanceof ApiError) {
    if (err.status === 403 || err.code === "FORBIDDEN") {
      return {
        ok: false,
        reason: "PERMISSION_DENIED",
        message: err.message,
      };
    }
    if (err.code === "INVALID_INPUT" || err.status === 400) {
      return { ok: false, reason: "VALIDATION", message: err.message };
    }
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

export async function saveCatalogEntry(
  payload: CatalogFormPayload,
  existingId?: string,
): Promise<WriteResult> {
  try {
    // For Trafikklys: én flat pris alle 3 bongfarger (matcher standard-
    // validering så payload passerer backend uendret).
    let ticketPricesCents = mapPricesToCents(payload.ticketPricesKr);
    if (payload.gameVariant === "trafikklys") {
      const flatCents = krToCents(payload.trafikklys.ticketPriceKr);
      ticketPricesCents = {};
      for (const c of payload.ticketColors) {
        ticketPricesCents[c] = flatCents;
      }
    }
    const prizesCents = mapPrizesToCents(
      payload.prizesKr,
      payload.prizeMultiplierMode,
    );
    const rules = buildRules(payload);

    if (existingId) {
      const patch: UpdateGameCatalogInput = {
        slug: payload.slug,
        displayName: payload.displayName,
        description: payload.description,
        rules,
        ticketColors: payload.ticketColors,
        ticketPricesCents,
        prizesCents,
        prizeMultiplierMode: payload.prizeMultiplierMode,
        bonusGameEnabled: payload.bonusGameEnabled,
        bonusGameSlug: payload.bonusGameEnabled ? payload.bonusGameSlug : null,
        requiresJackpotSetup: payload.requiresJackpotSetup,
        isActive: payload.isActive,
        sortOrder: payload.sortOrder,
      };
      const entry = await updateGameCatalogEntry(existingId, patch);
      return { ok: true, entry };
    }
    const input: CreateGameCatalogInput = {
      slug: payload.slug,
      displayName: payload.displayName,
      description: payload.description,
      rules,
      ticketColors: payload.ticketColors,
      ticketPricesCents,
      prizesCents,
      prizeMultiplierMode: payload.prizeMultiplierMode,
      bonusGameEnabled: payload.bonusGameEnabled,
      bonusGameSlug: payload.bonusGameEnabled ? payload.bonusGameSlug : null,
      requiresJackpotSetup: payload.requiresJackpotSetup,
      isActive: payload.isActive,
      sortOrder: payload.sortOrder,
    };
    const entry = await createGameCatalogEntry(input);
    return { ok: true, entry };
  } catch (err) {
    return apiErrorToResult(err);
  }
}

export async function deactivateCatalogEntry(id: string): Promise<WriteResult> {
  try {
    await deactivateGameCatalogEntry(id);
    return {
      ok: true,
      // Server returnerer kun {deactivated:true}; vi gir ut en tom-stub
      // entry så caller-koden kan ignorere shape-difference.
      entry: { id, slug: "", displayName: "" } as GameCatalogEntry,
    };
  } catch (err) {
    return apiErrorToResult(err);
  }
}

// ── Default-template for ny entry ───────────────────────────────────────

/**
 * Default-felter for trafikklys-spesial-spill.
 * 15 kr flat pris, 3 rad-farger (alle aktive), 100/150/50 kr premier
 * (grønn høyest pga rad 1-4 vinner sjeldnest), 1000/1500/500 kr bingo.
 */
function defaultTrafikklys(): TrafikklysRules {
  return {
    ticketPriceKr: 15,
    rowColors: ["grønn", "gul", "rød"],
    prizesPerRowColorKr: { grønn: 100, gul: 150, rød: 50 },
    bingoPerRowColorKr: { grønn: 1000, gul: 1500, rød: 500 },
  };
}

/**
 * Default-felter for oddsen-spesial-spill.
 * Trekk 55 (mellom-trekk-typisk i 90-ball), 500 kr lav, 1500 kr høy
 * (3x på treff). Per-farge utledes via multiplikator (5/10/15 kr).
 */
function defaultOddsen(): OddsenRules {
  return {
    targetDraw: 55,
    bingoBaseLowKr: 500,
    bingoBaseHighKr: 1500,
    bingoLowPerColorKr: { hvit: 500, gul: 1000, lilla: 1500 },
    bingoHighPerColorKr: { hvit: 1500, gul: 3000, lilla: 4500 },
  };
}

export function defaultCatalogPayload(): CatalogFormPayload {
  // Tobias 2026-05-07: nye katalog-entries får "auto"-modus som default.
  // bingoBase 1000 kr (= billigste bong-premie); per-farge bingo blir
  // tomt siden multiplikator regner det ut backend-side.
  return {
    slug: "",
    displayName: "",
    description: null,
    ticketColors: ["gul", "hvit"],
    ticketPricesKr: { gul: 10, hvit: 5 },
    prizeMultiplierMode: "auto",
    prizesKr: {
      rad1: 100,
      rad2: 100,
      rad3: 100,
      rad4: 100,
      bingoBase: 1000,
      bingo: {},
    },
    bonusGameEnabled: false,
    bonusGameSlug: null,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    gameVariant: "standard",
    trafikklys: defaultTrafikklys(),
    oddsen: defaultOddsen(),
  };
}

/**
 * Trygt parse `rules.gameVariant` fra fri-form rules-blob.
 * Returnerer `standard` hvis ukjent eller mangler.
 */
function parseGameVariant(rules: Record<string, unknown>): GameVariant {
  const v = rules.gameVariant;
  if (typeof v === "string" && (GAME_VARIANT_VALUES as readonly string[]).includes(v)) {
    return v as GameVariant;
  }
  return "standard";
}

/**
 * Trygt parse trafikklys-rules fra blob til form-payload.
 * Faller tilbake til defaultTrafikklys() når felter mangler eller har
 * ugyldig format.
 */
function parseTrafikklysRules(rules: Record<string, unknown>): TrafikklysRules {
  const fallback = defaultTrafikklys();
  if (rules.gameVariant !== "trafikklys") return fallback;
  const ticketPriceCents = Number(rules.ticketPriceCents);
  const rowColorsRaw = rules.rowColors;
  const rowColors: TrafikklysRowColor[] = Array.isArray(rowColorsRaw)
    ? rowColorsRaw.filter((c): c is TrafikklysRowColor =>
        typeof c === "string" &&
        (TRAFIKKLYS_ROW_COLORS as readonly string[]).includes(c),
      )
    : fallback.rowColors;
  const prizesPerRowColorKr: Partial<Record<TrafikklysRowColor, number>> = {};
  if (rules.prizesPerRowColor && typeof rules.prizesPerRowColor === "object") {
    for (const [c, cents] of Object.entries(
      rules.prizesPerRowColor as Record<string, unknown>,
    )) {
      if (
        (TRAFIKKLYS_ROW_COLORS as readonly string[]).includes(c) &&
        typeof cents === "number" &&
        Number.isFinite(cents)
      ) {
        prizesPerRowColorKr[c as TrafikklysRowColor] = centsToKr(cents);
      }
    }
  }
  const bingoPerRowColorKr: Partial<Record<TrafikklysRowColor, number>> = {};
  if (rules.bingoPerRowColor && typeof rules.bingoPerRowColor === "object") {
    for (const [c, cents] of Object.entries(
      rules.bingoPerRowColor as Record<string, unknown>,
    )) {
      if (
        (TRAFIKKLYS_ROW_COLORS as readonly string[]).includes(c) &&
        typeof cents === "number" &&
        Number.isFinite(cents)
      ) {
        bingoPerRowColorKr[c as TrafikklysRowColor] = centsToKr(cents);
      }
    }
  }
  return {
    ticketPriceKr:
      Number.isFinite(ticketPriceCents) && ticketPriceCents > 0
        ? centsToKr(ticketPriceCents)
        : fallback.ticketPriceKr,
    rowColors: rowColors.length > 0 ? rowColors : fallback.rowColors,
    prizesPerRowColorKr:
      Object.keys(prizesPerRowColorKr).length > 0
        ? prizesPerRowColorKr
        : fallback.prizesPerRowColorKr,
    bingoPerRowColorKr:
      Object.keys(bingoPerRowColorKr).length > 0
        ? bingoPerRowColorKr
        : fallback.bingoPerRowColorKr,
  };
}

/**
 * Trygt parse oddsen-rules fra blob til form-payload.
 * Faller tilbake til defaultOddsen() når felter mangler.
 */
function parseOddsenRules(rules: Record<string, unknown>): OddsenRules {
  const fallback = defaultOddsen();
  if (rules.gameVariant !== "oddsen") return fallback;
  const targetDraw = Number(rules.targetDraw);
  const bingoBaseLowCents = Number(rules.bingoBaseLow);
  const bingoBaseHighCents = Number(rules.bingoBaseHigh);
  const bingoLowPerColorKr: Partial<Record<TicketColor, number>> = {};
  if (rules.bingoLowPerColor && typeof rules.bingoLowPerColor === "object") {
    for (const [c, cents] of Object.entries(
      rules.bingoLowPerColor as Record<string, unknown>,
    )) {
      if (typeof cents === "number" && Number.isFinite(cents)) {
        bingoLowPerColorKr[c as TicketColor] = centsToKr(cents);
      }
    }
  }
  const bingoHighPerColorKr: Partial<Record<TicketColor, number>> = {};
  if (rules.bingoHighPerColor && typeof rules.bingoHighPerColor === "object") {
    for (const [c, cents] of Object.entries(
      rules.bingoHighPerColor as Record<string, unknown>,
    )) {
      if (typeof cents === "number" && Number.isFinite(cents)) {
        bingoHighPerColorKr[c as TicketColor] = centsToKr(cents);
      }
    }
  }
  return {
    targetDraw:
      Number.isFinite(targetDraw) && targetDraw >= 1 && targetDraw <= 90
        ? Math.round(targetDraw)
        : fallback.targetDraw,
    bingoBaseLowKr:
      Number.isFinite(bingoBaseLowCents) && bingoBaseLowCents > 0
        ? centsToKr(bingoBaseLowCents)
        : fallback.bingoBaseLowKr,
    bingoBaseHighKr:
      Number.isFinite(bingoBaseHighCents) && bingoBaseHighCents > 0
        ? centsToKr(bingoBaseHighCents)
        : fallback.bingoBaseHighKr,
    bingoLowPerColorKr:
      Object.keys(bingoLowPerColorKr).length > 0
        ? bingoLowPerColorKr
        : fallback.bingoLowPerColorKr,
    bingoHighPerColorKr:
      Object.keys(bingoHighPerColorKr).length > 0
        ? bingoHighPerColorKr
        : fallback.bingoHighPerColorKr,
  };
}

export function entryToFormPayload(entry: GameCatalogEntry): CatalogFormPayload {
  const ticketPricesKr: Partial<Record<TicketColor, number>> = {};
  for (const [color, cents] of Object.entries(entry.ticketPricesCents) as [
    TicketColor,
    number,
  ][]) {
    if (typeof cents === "number") ticketPricesKr[color] = centsToKr(cents);
  }
  const bingoKr: Partial<Record<TicketColor, number>> = {};
  for (const [color, cents] of Object.entries(entry.prizesCents.bingo) as [
    TicketColor,
    number,
  ][]) {
    if (typeof cents === "number") bingoKr[color] = centsToKr(cents);
  }
  const bingoBaseKr =
    typeof entry.prizesCents.bingoBase === "number"
      ? centsToKr(entry.prizesCents.bingoBase)
      : 0;
  const rules = entry.rules ?? {};
  const gameVariant = parseGameVariant(rules);
  const trafikklys = parseTrafikklysRules(rules);
  const oddsen = parseOddsenRules(rules);
  return {
    slug: entry.slug,
    displayName: entry.displayName,
    description: entry.description,
    ticketColors: entry.ticketColors,
    ticketPricesKr,
    prizeMultiplierMode: entry.prizeMultiplierMode,
    prizesKr: {
      rad1: centsToKr(entry.prizesCents.rad1),
      rad2: centsToKr(entry.prizesCents.rad2),
      rad3: centsToKr(entry.prizesCents.rad3),
      rad4: centsToKr(entry.prizesCents.rad4),
      bingoBase: bingoBaseKr,
      bingo: bingoKr,
    },
    bonusGameEnabled: entry.bonusGameEnabled,
    bonusGameSlug: entry.bonusGameSlug,
    requiresJackpotSetup: entry.requiresJackpotSetup,
    isActive: entry.isActive,
    sortOrder: entry.sortOrder,
    gameVariant,
    trafikklys,
    oddsen,
  };
}
