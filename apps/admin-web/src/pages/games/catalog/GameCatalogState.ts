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
    const ticketPricesCents = mapPricesToCents(payload.ticketPricesKr);
    const prizesCents = mapPrizesToCents(
      payload.prizesKr,
      payload.prizeMultiplierMode,
    );

    if (existingId) {
      const patch: UpdateGameCatalogInput = {
        slug: payload.slug,
        displayName: payload.displayName,
        description: payload.description,
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
  };
}
