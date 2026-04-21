// GameType state — fetches from backend `/api/admin/games` and adapts the
// platform response to the legacy-shaped GameType row used by admin-UI.
//
//   GET  /gameType                      → list-page (DataTable ajax: /gameType/getGameType)
//   GET  /addGameType                   → add-form GET
//   POST /addGameType                   → add-form POST        ← PLACEHOLDER (BIN-620)
//   GET  /editGameType/:id              → edit-form GET
//   POST /editGameType/:id              → edit-form POST       ← PLACEHOLDER (BIN-620)
//   POST /gameType/deleteGameType       → delete               ← PLACEHOLDER (BIN-620)
//   GET  /viewGameType/:id              → view-page
//
// Write-ops are deferred to BIN-620 backend CRUD; this module intentionally
// does NOT call fetch() for POST/PUT/DELETE in this PR.

import { apiRequest } from "../../../api/client.js";
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

/** Fetch the full list of GameTypes (admin catalog, including disabled). */
export async function fetchGameTypeList(): Promise<GameType[]> {
  const rows = await apiRequest<PlatformGameRow[]>("/api/admin/games", { auth: true });
  if (!Array.isArray(rows)) return [];
  return rows.map(mapPlatformRowToGameType);
}

/** Fetch a single GameType by slug (acts as `_id` in the legacy URL-scheme). */
export async function fetchGameType(slug: string): Promise<GameType | null> {
  const list = await fetchGameTypeList();
  return list.find((gt) => gt._id === slug) ?? null;
}

/** Form-payload shape (mirrors legacy addGame.html form fields). */
export interface GameTypeFormPayload {
  name: string;
  row: number;
  columns: number;
  pattern: boolean;
  /** base64-encoded file content — legacy used multipart/form-data, new shell will use JSON+base64 when BIN-620 lands. */
  photo?: string | null;
}

/**
 * PLACEHOLDER — returns rejected promise signalling that the backend
 * endpoint is not yet implemented. UI surfaces this as a disabled-save-toast
 * per PR-A3 placeholder mönster (see PR-A3-PLAN.md §3.2). Tracked in BIN-620.
 */
export async function saveGameType(
  _payload: GameTypeFormPayload,
  _existingId?: string
): Promise<{ ok: false; reason: "BACKEND_MISSING"; issue: "BIN-620" }> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-620" };
}

/**
 * PLACEHOLDER — delete not yet backed. Tracked in BIN-620.
 */
export async function deleteGameType(_id: string): Promise<{ ok: false; reason: "BACKEND_MISSING"; issue: "BIN-620" }> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-620" };
}
