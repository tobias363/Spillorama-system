// BIN-684: admin-game-management API-wrappers (bolk 1 — BIN-622 wired).
//
// Speiler backend-router `apps/backend/src/routes/adminGameManagement.ts`:
//   GET    /api/admin/game-management?gameTypeId=X          (GAME_MGMT_READ)
//   GET    /api/admin/game-management/:typeId/:id           (GAME_MGMT_READ)
//   POST   /api/admin/game-management                        (GAME_MGMT_WRITE)
//   PATCH  /api/admin/game-management/:id                    (GAME_MGMT_WRITE)
//   DELETE /api/admin/game-management/:id?hard=true|false    (GAME_MGMT_WRITE)
//   POST   /api/admin/game-management/:id/repeat             (GAME_MGMT_WRITE)
//
// CloseDay (BIN-623) + GameTickets (BIN-622 tickets-per-game) har ingen
// backend-endpoints ennå — de wrappers som eksisterer returnerer 501-lignende
// placeholders. Se GameManagementState.ts for hvilke.

import { apiRequest } from "./client.js";

export type GameManagementStatus = "active" | "running" | "closed" | "inactive";
export type GameManagementTicketType = "Large" | "Small";

/** Wire-shape — matches `toWireShape(...)` i adminGameManagement.ts backend. */
export interface AdminGameManagement {
  id: string;
  gameTypeId: string;
  parentId: string | null;
  name: string;
  ticketType: GameManagementTicketType | null;
  ticketPrice: number;
  startDate: string;
  endDate: string | null;
  status: GameManagementStatus;
  totalSold: number;
  totalEarning: number;
  config: Record<string, unknown>;
  repeatedFromId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListGameManagementParams {
  gameTypeId?: string;
  status?: GameManagementStatus;
  limit?: number;
}

export interface ListGameManagementResult {
  games: AdminGameManagement[];
  count: number;
}

export async function listGameManagement(
  params: ListGameManagementParams = {}
): Promise<ListGameManagementResult> {
  const qs = new URLSearchParams();
  if (params.gameTypeId) qs.set("gameTypeId", params.gameTypeId);
  if (params.status) qs.set("status", params.status);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListGameManagementResult>(
    `/api/admin/game-management${suffix}`,
    { auth: true }
  );
}

export async function getGameManagement(
  typeId: string,
  id: string
): Promise<AdminGameManagement> {
  return apiRequest<AdminGameManagement>(
    `/api/admin/game-management/${encodeURIComponent(typeId)}/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export interface CreateGameManagementBody {
  gameTypeId: string;
  name: string;
  startDate: string;
  parentId?: string | null;
  ticketType?: GameManagementTicketType | null;
  ticketPrice?: number;
  endDate?: string | null;
  status?: GameManagementStatus;
  config?: Record<string, unknown>;
}

export async function createGameManagement(
  body: CreateGameManagementBody
): Promise<AdminGameManagement> {
  return apiRequest<AdminGameManagement>("/api/admin/game-management", {
    method: "POST",
    body,
    auth: true,
  });
}

export interface UpdateGameManagementBody {
  name?: string;
  ticketType?: GameManagementTicketType | null;
  ticketPrice?: number;
  startDate?: string;
  endDate?: string | null;
  status?: GameManagementStatus;
  parentId?: string | null;
  config?: Record<string, unknown>;
  totalSold?: number;
  totalEarning?: number;
}

export async function updateGameManagement(
  id: string,
  body: UpdateGameManagementBody
): Promise<AdminGameManagement> {
  return apiRequest<AdminGameManagement>(
    `/api/admin/game-management/${encodeURIComponent(id)}`,
    { method: "PATCH", body, auth: true }
  );
}

export interface DeleteGameManagementResult {
  softDeleted: boolean;
}

export async function deleteGameManagement(
  id: string,
  hard = false
): Promise<DeleteGameManagementResult> {
  const qs = hard ? "?hard=true" : "";
  return apiRequest<DeleteGameManagementResult>(
    `/api/admin/game-management/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}

export interface RepeatGameManagementBody {
  startDate: string;
  endDate?: string | null;
  name?: string | null;
  /** Idempotency token — same token returns the same new row. */
  repeatToken?: string | null;
}

export async function repeatGameManagement(
  sourceId: string,
  body: RepeatGameManagementBody
): Promise<AdminGameManagement> {
  return apiRequest<AdminGameManagement>(
    `/api/admin/game-management/${encodeURIComponent(sourceId)}/repeat`,
    { method: "POST", body, auth: true }
  );
}
