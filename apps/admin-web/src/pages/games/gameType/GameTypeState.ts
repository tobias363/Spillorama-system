// GameType state — wires UI to new BIN-620 backend (`/api/admin/game-types/*`)
// plus the legacy-compat platform `/api/admin/games` mapping for the GameType
// overview catalog.
//
// Historikk: før BIN-620 ble GameType-listen trukket ut av platform-tabellen
// `/api/admin/games` (minimal shape — slug/title/settings). Nå har vi en
// dedikert GameType-tabell med full CRUD; listPage fortrinner den.
// Vi beholder `mapPlatformRowToGameType` som fallback / kompatibilitetslag
// fordi eksisterende tester (gameTypeState.test.ts) bruker den.
//
// BIN-620 endpoints:
//   GET    /api/admin/game-types              → list
//   GET    /api/admin/game-types/:id          → detail
//   POST   /api/admin/game-types              → create
//   PATCH  /api/admin/game-types/:id          → update
//   DELETE /api/admin/game-types/:id          → delete

import { apiRequest, ApiError } from "../../../api/client.js";
import {
  listGameTypes,
  getGameType as apiGetGameType,
  createGameType as apiCreateGameType,
  updateGameType as apiUpdateGameType,
  deleteGameType as apiDeleteGameType,
  type AdminGameType,
} from "../../../api/admin-game-types.js";
import type { GameType, PlatformGameRow } from "../common/types.js";

/**
 * Map a backend /api/admin/games row to the legacy-shaped GameType the UI
 * expects. Field semantics:
 *   - `slug` → `_id` (stable identifier the UI uses in URLs)
 *   - `slug` also → `slug` field for backend-calls
 *   - `title` → `name` for display
 *   - `sortOrder` → implicit list order
 *   - ticket-grid `row`/`columns` pulled from settings_json (legacy inlined them)
 *   - `type` (legacy game_N discriminator) pulled from settings_json
 *   - `pattern` flag pulled from settings_json
 *   - `photo` pulled from settings_json if present; otherwise falls back to slug
 */
export function mapPlatformRowToGameType(row: PlatformGameRow): GameType {
  const s = row.settings ?? {};
  const getNum = (key: string, fallback: number): number => {
    const v = s[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
    return fallback;
  };
  const getStr = (key: string, fallback = ""): string => {
    const v = s[key];
    return typeof v === "string" ? v : fallback;
  };
  const getBool = (key: string, fallback = false): boolean => {
    const v = s[key];
    return typeof v === "boolean" ? v : fallback;
  };

  // Legacy "type" defaults: bingo→game_1, rocket→game_2, monsterbingo→game_3,
  // spillorama→game_5. Unknown slugs pass through as-is.
  const slugToType: Record<string, GameType["type"]> = {
    bingo: "game_1",
    rocket: "game_2",
    monsterbingo: "game_3",
    spillorama: "game_5",
  };
  const type = getStr("type") || slugToType[row.slug] || row.slug;

  // Default grid (bingo 75 is 5x5; rocket is 3x3; databingo60 is 3x5).
  const slugToGrid: Record<string, { row: number; columns: number }> = {
    bingo: { row: 5, columns: 5 },
    rocket: { row: 3, columns: 3 },
    monsterbingo: { row: 5, columns: 5 },
    spillorama: { row: 3, columns: 5 },
  };
  const grid = slugToGrid[row.slug] ?? { row: 5, columns: 5 };

  return {
    _id: row.slug,
    slug: row.slug,
    name: row.title,
    type,
    row: getNum("row", grid.row),
    columns: getNum("columns", grid.columns),
    photo: getStr("photo", `${row.slug}.png`),
    pattern: getBool("pattern", type === "game_1" || type === "game_3"),
    isActive: row.isEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map a BIN-620 GameType (new shape with UUID + typeSlug) to the legacy
 * GameType shape used by UI.
 */
export function mapAdminGameTypeToGameType(gt: AdminGameType): GameType {
  // Map typeSlug to legacy "type" discriminator when possible.
  const slugToType: Record<string, GameType["type"]> = {
    bingo: "game_1",
    rocket: "game_2",
    monsterbingo: "game_3",
    spillorama: "game_5",
  };
  const type = slugToType[gt.typeSlug] ?? gt.typeSlug;
  return {
    _id: gt.id,
    slug: gt.typeSlug,
    name: gt.name,
    type,
    row: gt.gridRows,
    columns: gt.gridColumns,
    photo: gt.photo || `${gt.typeSlug}.png`,
    pattern: gt.pattern,
    isActive: gt.status === "active",
    createdAt: gt.createdAt,
    updatedAt: gt.updatedAt,
  };
}

/**
 * Fetch the full list of GameTypes. Prefer the BIN-620 dedicated endpoint;
 * fall back to the legacy `/api/admin/games` platform catalog if BIN-620 is
 * disabled (avoids regression on dev envs where migrations haven't run yet).
 */
export async function fetchGameTypeList(): Promise<GameType[]> {
  try {
    const result = await listGameTypes({});
    if (result?.gameTypes && result.gameTypes.length > 0) {
      return result.gameTypes.map(mapAdminGameTypeToGameType);
    }
    // Empty result from BIN-620 — fall through to legacy for backfill
  } catch (err) {
    // 404/501 suggests endpoint missing — fall through to legacy.
    // Other errors: re-throw so list shows error-message.
    if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 501)) {
      // Fall through to legacy anyway — platform `/api/admin/games` was the
      // source-of-truth before BIN-620. If BIN-620 returns 403 admin will
      // already be blocked from both endpoints so legacy-GET will throw too.
    }
  }
  // Legacy fallback
  const rows = await apiRequest<PlatformGameRow[]>("/api/admin/games", { auth: true });
  if (!Array.isArray(rows)) return [];
  return rows.map(mapPlatformRowToGameType);
}

/** Fetch a single GameType by id or slug (acts as `_id` in the UI URL-scheme). */
export async function fetchGameType(idOrSlug: string): Promise<GameType | null> {
  // Try BIN-620 detail endpoint first — supports UUID and typeSlug per
  // gameTypeService.get(id) which falls back to slug-lookup.
  try {
    const gt = await apiGetGameType(idOrSlug);
    return mapAdminGameTypeToGameType(gt);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      // Fall through to legacy list
    } else if (err instanceof ApiError && err.status === 400) {
      // Backend may not have this id — try legacy
    } else {
      throw err;
    }
  }
  // Legacy fallback: scan the list
  const list = await fetchGameTypeList();
  return list.find((gt) => gt._id === idOrSlug || gt.slug === idOrSlug) ?? null;
}

/** Form-payload shape (mirrors legacy addGame.html form fields). */
export interface GameTypeFormPayload {
  name: string;
  /** typeSlug required for new GameType (e.g. "bingo", "rocket"). */
  typeSlug?: string;
  row: number;
  columns: number;
  pattern: boolean;
  /** Photo filename (under /profile/bingo/). */
  photo?: string;
  status?: "active" | "inactive";
}

/** Unified write-result contract. */
export type GameTypeWriteResult =
  | { ok: true; row: GameType }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "VALIDATION"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string };

function apiErrorToWriteResult(err: unknown): GameTypeWriteResult {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return { ok: false, reason: "PERMISSION_DENIED", message: err.message };
    }
    if (err.status === 404) {
      return { ok: false, reason: "NOT_FOUND", message: err.message };
    }
    if (err.status === 400) {
      return { ok: false, reason: "VALIDATION", message: err.message };
    }
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

/** Create or update a GameType via BIN-620 endpoints. */
export async function saveGameType(
  payload: GameTypeFormPayload,
  existingId?: string
): Promise<GameTypeWriteResult> {
  try {
    const gt = existingId
      ? await apiUpdateGameType(existingId, {
          name: payload.name,
          gridRows: payload.row,
          gridColumns: payload.columns,
          pattern: payload.pattern,
          ...(payload.photo !== undefined ? { photo: payload.photo } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
        })
      : await apiCreateGameType({
          typeSlug: (payload.typeSlug ?? slugify(payload.name)).trim(),
          name: payload.name,
          gridRows: payload.row,
          gridColumns: payload.columns,
          pattern: payload.pattern,
          ...(payload.photo !== undefined ? { photo: payload.photo } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
        });
    return { ok: true, row: mapAdminGameTypeToGameType(gt) };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** Soft-delete a GameType via BIN-620 endpoint. */
export async function deleteGameType(
  id: string
): Promise<GameTypeWriteResult | { ok: true; softDeleted: boolean }> {
  try {
    const result = await apiDeleteGameType(id);
    return { ok: true, softDeleted: result.softDeleted };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/**
 * Derive a URL-safe slug from a display name. Matches the legacy `slug`
 * column format: lowercase, a-z0-9 + hyphens only.
 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
