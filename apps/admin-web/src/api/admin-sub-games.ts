// BIN-621: admin-sub-games API-wrappers.
//
// Dekker SubGame CRUD. Backend-endpoints ligger i
// apps/backend/src/routes/adminSubGames.ts:
//   GET    /api/admin/sub-games?gameType=slug       (SUB_GAME_READ)
//   GET    /api/admin/sub-games/:id                 (SUB_GAME_READ)
//   POST   /api/admin/sub-games                     (SUB_GAME_WRITE)
//   PATCH  /api/admin/sub-games/:id                 (SUB_GAME_WRITE)
//   DELETE /api/admin/sub-games/:id                 (SUB_GAME_WRITE)
//
// Svar-formatet matcher `SubGame` i apps/backend/src/admin/SubGameService.ts.
// List-endepunktet pakker respons som `{subGames, count}`; detail som rå SubGame.

import { apiRequest } from "./client.js";

export type SubGameStatus = "active" | "inactive";

export interface SubGamePatternRef {
  patternId: string;
  name: string;
}

export interface AdminSubGame {
  id: string;
  gameTypeId: string;
  gameName: string;
  name: string;
  subGameNumber: string;
  patternRows: SubGamePatternRef[];
  ticketColors: string[];
  status: SubGameStatus;
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Liste ────────────────────────────────────────────────────────────────────

export interface ListSubGamesParams {
  gameTypeId?: string;
  status?: SubGameStatus;
  limit?: number;
}

export interface ListSubGamesResult {
  subGames: AdminSubGame[];
  count: number;
}

export async function listSubGames(
  params: ListSubGamesParams = {}
): Promise<ListSubGamesResult> {
  const qs = new URLSearchParams();
  if (params.gameTypeId) qs.set("gameType", params.gameTypeId);
  if (params.status) qs.set("status", params.status);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListSubGamesResult>(`/api/admin/sub-games${suffix}`, {
    auth: true,
  });
}

// ── Detail ───────────────────────────────────────────────────────────────────

export async function getSubGame(id: string): Promise<AdminSubGame> {
  return apiRequest<AdminSubGame>(
    `/api/admin/sub-games/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateSubGameInput {
  gameTypeId: string;
  gameName?: string;
  name: string;
  subGameNumber?: string;
  patternRows?: SubGamePatternRef[];
  ticketColors?: string[];
  status?: SubGameStatus;
  extra?: Record<string, unknown>;
}

export function createSubGame(input: CreateSubGameInput): Promise<AdminSubGame> {
  return apiRequest<AdminSubGame>("/api/admin/sub-games", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export interface UpdateSubGameInput {
  gameName?: string;
  name?: string;
  subGameNumber?: string;
  patternRows?: SubGamePatternRef[];
  ticketColors?: string[];
  status?: SubGameStatus;
  extra?: Record<string, unknown>;
}

export function updateSubGame(
  id: string,
  patch: UpdateSubGameInput
): Promise<AdminSubGame> {
  return apiRequest<AdminSubGame>(
    `/api/admin/sub-games/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: patch,
      auth: true,
    }
  );
}

export interface DeleteSubGameResult {
  softDeleted: boolean;
}

export function deleteSubGame(
  id: string,
  hard = false
): Promise<DeleteSubGameResult> {
  const qs = hard ? "?hard=true" : "";
  return apiRequest<DeleteSubGameResult>(
    `/api/admin/sub-games/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}
