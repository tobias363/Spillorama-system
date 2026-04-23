// BIN-624: admin-saved-games API-wrappers.
//
// Dekker SavedGame CRUD + load-to-game. Backend-endpoints ligger i
// apps/backend/src/routes/adminSavedGames.ts:
//   GET    /api/admin/saved-games                      (SAVED_GAME_READ)
//   GET    /api/admin/saved-games/:id                  (SAVED_GAME_READ)
//   POST   /api/admin/saved-games                      (SAVED_GAME_WRITE)
//   PATCH  /api/admin/saved-games/:id                  (SAVED_GAME_WRITE)
//   DELETE /api/admin/saved-games/:id                  (SAVED_GAME_WRITE)
//   POST   /api/admin/saved-games/:id/load-to-game     (SAVED_GAME_WRITE)
//
// Svar-formatet matcher `SavedGame` i apps/backend/src/admin/SavedGameService.ts.

import { apiRequest } from "./client.js";

export type SavedGameStatus = "active" | "inactive";

export interface AdminSavedGame {
  id: string;
  gameTypeId: string;
  name: string;
  isAdminSave: boolean;
  config: Record<string, unknown>;
  status: SavedGameStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListSavedGamesParams {
  gameTypeId?: string;
  status?: SavedGameStatus;
  createdBy?: string;
  limit?: number;
}

export interface ListSavedGamesResult {
  savedGames: AdminSavedGame[];
  count: number;
}

export async function listSavedGames(
  params: ListSavedGamesParams = {}
): Promise<ListSavedGamesResult> {
  const qs = new URLSearchParams();
  if (params.gameTypeId) qs.set("gameType", params.gameTypeId);
  if (params.status) qs.set("status", params.status);
  if (params.createdBy) qs.set("createdBy", params.createdBy);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListSavedGamesResult>(`/api/admin/saved-games${suffix}`, {
    auth: true,
  });
}

export async function getSavedGame(id: string): Promise<AdminSavedGame> {
  return apiRequest<AdminSavedGame>(
    `/api/admin/saved-games/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export interface CreateSavedGameInput {
  gameTypeId: string;
  name: string;
  isAdminSave?: boolean;
  config?: Record<string, unknown>;
  status?: SavedGameStatus;
}

export function createSavedGame(input: CreateSavedGameInput): Promise<AdminSavedGame> {
  return apiRequest<AdminSavedGame>("/api/admin/saved-games", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export interface UpdateSavedGameInput {
  name?: string;
  isAdminSave?: boolean;
  config?: Record<string, unknown>;
  status?: SavedGameStatus;
}

export function updateSavedGame(
  id: string,
  patch: UpdateSavedGameInput
): Promise<AdminSavedGame> {
  return apiRequest<AdminSavedGame>(
    `/api/admin/saved-games/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: patch,
      auth: true,
    }
  );
}

export interface DeleteSavedGameResult {
  softDeleted: boolean;
}

export function deleteSavedGame(
  id: string,
  hard = false
): Promise<DeleteSavedGameResult> {
  const qs = hard ? "?hard=true" : "";
  return apiRequest<DeleteSavedGameResult>(
    `/api/admin/saved-games/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}

export interface LoadSavedGamePayload {
  savedGameId: string;
  gameTypeId: string;
  name: string;
  config: Record<string, unknown>;
}

/**
 * Load a SavedGame template. Returns the template's gameTypeId + config
 * ready to be posted to /api/admin/game-management (see BIN-622).
 */
export function loadSavedGameToGame(id: string): Promise<LoadSavedGamePayload> {
  return apiRequest<LoadSavedGamePayload>(
    `/api/admin/saved-games/${encodeURIComponent(id)}/load-to-game`,
    { method: "POST", body: {}, auth: true }
  );
}
