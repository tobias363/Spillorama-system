// BIN-668 — admin Leaderboard tier CRUD API wrappers (wired til backend).
//
// Backend-matrisen (se apps/backend/src/routes/adminLeaderboardTiers.ts):
//   GET    /api/admin/leaderboard/tiers            → liste
//   GET    /api/admin/leaderboard/tiers/:id        → detalj
//   POST   /api/admin/leaderboard/tiers            → opprett
//   PATCH  /api/admin/leaderboard/tiers/:id        → oppdater
//   DELETE /api/admin/leaderboard/tiers/:id[?hard=true] → soft/hard delete
//
// Permissions: LEADERBOARD_TIER_READ for GETs, LEADERBOARD_TIER_WRITE
// (ADMIN-only) for POST/PATCH/DELETE (se AdminAccessPolicy.ts). Backend
// audit-logger admin.leaderboard.tier.{create,update,delete}.
//
// Schema-mirror: shared-types/schemas.ts → `LeaderboardTierRowSchema`.

import { apiRequest } from "./client.js";

export interface LeaderboardTier {
  id: string;
  tierName: string;
  place: number;
  points: number;
  prizeAmount: number | null;
  prizeDescription: string;
  active: boolean;
  extra: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListLeaderboardTiersResponse {
  tiers: LeaderboardTier[];
  count: number;
}

export interface ListLeaderboardTiersQuery {
  tierName?: string;
  active?: boolean;
  limit?: number;
}

export interface CreateLeaderboardTierBody {
  place: number;
  tierName?: string;
  points?: number;
  prizeAmount?: number | null;
  prizeDescription?: string;
  active?: boolean;
  extra?: Record<string, unknown>;
}

export interface UpdateLeaderboardTierBody {
  tierName?: string;
  place?: number;
  points?: number;
  prizeAmount?: number | null;
  prizeDescription?: string;
  active?: boolean;
  extra?: Record<string, unknown>;
}

export async function listLeaderboardTiers(
  query: ListLeaderboardTiersQuery = {}
): Promise<ListLeaderboardTiersResponse> {
  const qs = new URLSearchParams();
  if (query.tierName) qs.set("tierName", query.tierName);
  if (query.active !== undefined) qs.set("active", String(query.active));
  if (query.limit) qs.set("limit", String(query.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListLeaderboardTiersResponse>(
    `/api/admin/leaderboard/tiers${suffix}`,
    { auth: true }
  );
}

export async function getLeaderboardTier(id: string): Promise<LeaderboardTier> {
  return apiRequest<LeaderboardTier>(
    `/api/admin/leaderboard/tiers/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function createLeaderboardTier(
  body: CreateLeaderboardTierBody
): Promise<LeaderboardTier> {
  return apiRequest<LeaderboardTier>("/api/admin/leaderboard/tiers", {
    method: "POST",
    body,
    auth: true,
  });
}

export async function updateLeaderboardTier(
  id: string,
  body: UpdateLeaderboardTierBody
): Promise<LeaderboardTier> {
  return apiRequest<LeaderboardTier>(
    `/api/admin/leaderboard/tiers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body,
      auth: true,
    }
  );
}

export async function deleteLeaderboardTier(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<{ softDeleted: boolean }> {
  const qs = opts.hard ? "?hard=true" : "";
  return apiRequest<{ softDeleted: boolean }>(
    `/api/admin/leaderboard/tiers/${encodeURIComponent(id)}${qs}`,
    {
      method: "DELETE",
      auth: true,
    }
  );
}
