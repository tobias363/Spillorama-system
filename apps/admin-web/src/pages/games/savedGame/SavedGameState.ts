// SavedGameState — wires admin-UI to BIN-624 backend endpoints
// (`/api/admin/saved-games/*` via admin-saved-games.ts).
//
// A SavedGame is a template snapshot of game-configuration (prize tiers,
// patterns, hall-groups, etc.) that can be loaded into a new GameManagement
// row via the load-to-game endpoint.

import {
  listSavedGames,
  getSavedGame as apiGetSavedGame,
  createSavedGame as apiCreateSavedGame,
  updateSavedGame as apiUpdateSavedGame,
  deleteSavedGame as apiDeleteSavedGame,
  loadSavedGameToGame as apiLoadSavedGameToGame,
  type AdminSavedGame,
  type LoadSavedGamePayload,
} from "../../../api/admin-saved-games.js";
import { ApiError } from "../../../api/client.js";

/** Row shape for the /savedGameList table. */
export interface SavedGameRow {
  _id: string;
  gameTypeId: string;
  name: string;
  status: "active" | "inactive";
  createdAt: string;
  isAdminSave: boolean;
}

/** Form payload (mirrors legacy savedGame/gameAdd.html; ~50 fields collapsed to opaque config). */
export interface SavedGameFormPayload {
  gameTypeId: string;
  name: string;
  isAdminSave?: boolean;
  /** Opaque config — passed through to backend config_json column. */
  config?: Record<string, unknown>;
  status?: "active" | "inactive";
}

/** Unified write-result contract — live after BIN-624 wire-up. */
export type WriteResult =
  | { ok: true; row: SavedGameRow }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "VALIDATION"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string };

function toRow(sg: AdminSavedGame): SavedGameRow {
  return {
    _id: sg.id,
    gameTypeId: sg.gameTypeId,
    name: sg.name,
    status: sg.status,
    createdAt: sg.createdAt,
    isAdminSave: sg.isAdminSave,
  };
}

function apiErrorToWriteResult(err: unknown): WriteResult {
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

/** Fetch SavedGame list. Returns [] on 404. */
export async function fetchSavedGameList(gameTypeId?: string): Promise<SavedGameRow[]> {
  try {
    const params = gameTypeId ? { gameTypeId } : {};
    const result = await listSavedGames(params);
    return (result.savedGames ?? []).map(toRow);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return [];
    }
    throw err;
  }
}

/** Fetch a single SavedGame by id. Returns null on 404. */
export async function fetchSavedGame(id: string): Promise<SavedGameRow | null> {
  try {
    const sg = await apiGetSavedGame(id);
    return toRow(sg);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Create or update a SavedGame. */
export async function saveSavedGame(
  payload: SavedGameFormPayload,
  existingId?: string
): Promise<WriteResult> {
  try {
    const sg = existingId
      ? await apiUpdateSavedGame(existingId, {
          name: payload.name,
          ...(payload.isAdminSave !== undefined ? { isAdminSave: payload.isAdminSave } : {}),
          ...(payload.config !== undefined ? { config: payload.config } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
        })
      : await apiCreateSavedGame({
          gameTypeId: payload.gameTypeId,
          name: payload.name,
          ...(payload.isAdminSave !== undefined ? { isAdminSave: payload.isAdminSave } : {}),
          ...(payload.config !== undefined ? { config: payload.config } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
        });
    return { ok: true, row: toRow(sg) };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** Soft-delete a SavedGame. */
export async function deleteSavedGame(
  id: string
): Promise<WriteResult | { ok: true; softDeleted: boolean }> {
  try {
    const result = await apiDeleteSavedGame(id);
    return { ok: true, softDeleted: result.softDeleted };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/**
 * Load a SavedGame template into a new GameManagement row. Backend returns
 * the template payload — caller then POSTs to /api/admin/game-management
 * to actually create the game.
 */
export async function loadSavedGameToGame(id: string): Promise<LoadSavedGamePayload | null> {
  try {
    return await apiLoadSavedGameToGame(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
