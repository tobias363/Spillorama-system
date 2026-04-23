// BIN-620: admin-game-types API-wrappers.
//
// Dekker GameType CRUD. Backend-endpoints ligger i
// apps/backend/src/routes/adminGameTypes.ts:
//   GET    /api/admin/game-types              (GAME_TYPE_READ)
//   GET    /api/admin/game-types/:id          (GAME_TYPE_READ)
//   POST   /api/admin/game-types              (GAME_TYPE_WRITE)
//   PATCH  /api/admin/game-types/:id          (GAME_TYPE_WRITE)
//   DELETE /api/admin/game-types/:id          (GAME_TYPE_WRITE)
//
// Svar-formatet matcher `GameType` i apps/backend/src/admin/GameTypeService.ts.
// List-endepunktet pakker respons som `{gameTypes, count}`; detail som rå GameType.

import { apiRequest } from "./client.js";

// ── Kjerne-typer (speiler backend GameType) ─────────────────────────────────

export type GameTypeStatus = "active" | "inactive";

export interface AdminGameType {
  id: string;
  typeSlug: string;
  name: string;
  photo: string;
  pattern: boolean;
  gridRows: number;
  gridColumns: number;
  rangeMin: number | null;
  rangeMax: number | null;
  totalNoTickets: number | null;
  userMaxTickets: number | null;
  luckyNumbers: number[];
  status: GameTypeStatus;
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Liste ────────────────────────────────────────────────────────────────────

export interface ListGameTypesParams {
  status?: GameTypeStatus;
  limit?: number;
}

export interface ListGameTypesResult {
  gameTypes: AdminGameType[];
  count: number;
}

export async function listGameTypes(
  params: ListGameTypesParams = {}
): Promise<ListGameTypesResult> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListGameTypesResult>(`/api/admin/game-types${suffix}`, {
    auth: true,
  });
}

// ── Detail ───────────────────────────────────────────────────────────────────

export async function getGameType(id: string): Promise<AdminGameType> {
  return apiRequest<AdminGameType>(
    `/api/admin/game-types/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateGameTypeInput {
  typeSlug: string;
  name: string;
  photo?: string;
  pattern?: boolean;
  gridRows?: number;
  gridColumns?: number;
  rangeMin?: number | null;
  rangeMax?: number | null;
  totalNoTickets?: number | null;
  userMaxTickets?: number | null;
  luckyNumbers?: number[];
  status?: GameTypeStatus;
  extra?: Record<string, unknown>;
}

export function createGameType(input: CreateGameTypeInput): Promise<AdminGameType> {
  return apiRequest<AdminGameType>("/api/admin/game-types", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export interface UpdateGameTypeInput {
  typeSlug?: string;
  name?: string;
  photo?: string;
  pattern?: boolean;
  gridRows?: number;
  gridColumns?: number;
  rangeMin?: number | null;
  rangeMax?: number | null;
  totalNoTickets?: number | null;
  userMaxTickets?: number | null;
  luckyNumbers?: number[];
  status?: GameTypeStatus;
  extra?: Record<string, unknown>;
}

export function updateGameType(
  id: string,
  patch: UpdateGameTypeInput
): Promise<AdminGameType> {
  return apiRequest<AdminGameType>(
    `/api/admin/game-types/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: patch,
      auth: true,
    }
  );
}

export interface DeleteGameTypeResult {
  softDeleted: boolean;
}

export function deleteGameType(
  id: string,
  hard = false
): Promise<DeleteGameTypeResult> {
  const qs = hard ? "?hard=true" : "";
  return apiRequest<DeleteGameTypeResult>(
    `/api/admin/game-types/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}
