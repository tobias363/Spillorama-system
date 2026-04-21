// BIN-700 — admin Loyalty CRUD API wrappers (wired til backend).
//
// Backend-matrisen (se apps/backend/src/routes/adminLoyalty.ts):
//   GET    /api/admin/loyalty/tiers                       → liste
//   GET    /api/admin/loyalty/tiers/:id                   → detalj
//   POST   /api/admin/loyalty/tiers                       → opprett
//   PATCH  /api/admin/loyalty/tiers/:id                   → oppdater
//   DELETE /api/admin/loyalty/tiers/:id[?hard=true]       → soft/hard delete
//   GET    /api/admin/loyalty/players                     → list player-states
//   GET    /api/admin/loyalty/players/:userId             → state + events
//   POST   /api/admin/loyalty/players/:userId/award       → points-award
//   PATCH  /api/admin/loyalty/players/:userId/tier        → manual tier override
//
// Permissions: LOYALTY_READ for GETs, LOYALTY_WRITE (ADMIN-only) for writes.
// Backend audit-logger admin.loyalty.{tier.create,tier.update,tier.delete,
// points.award,tier.override}.

import { apiRequest } from "./client.js";

export interface LoyaltyTier {
  id: string;
  name: string;
  rank: number;
  minPoints: number;
  maxPoints: number | null;
  benefits: Record<string, unknown>;
  active: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListLoyaltyTiersResponse {
  tiers: LoyaltyTier[];
  count: number;
}

export interface CreateLoyaltyTierBody {
  name: string;
  rank: number;
  minPoints?: number;
  maxPoints?: number | null;
  benefits?: Record<string, unknown>;
  active?: boolean;
}

export interface UpdateLoyaltyTierBody {
  name?: string;
  rank?: number;
  minPoints?: number;
  maxPoints?: number | null;
  benefits?: Record<string, unknown>;
  active?: boolean;
}

export interface LoyaltyPlayerState {
  userId: string;
  currentTier: LoyaltyTier | null;
  lifetimePoints: number;
  monthPoints: number;
  monthKey: string | null;
  tierLocked: boolean;
  lastUpdatedAt: string;
  createdAt: string;
}

export interface LoyaltyEvent {
  id: string;
  userId: string;
  eventType: string;
  pointsDelta: number;
  metadata: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
}

export interface PlayerStateResponse {
  state: LoyaltyPlayerState;
  events: LoyaltyEvent[];
}

export interface ListPlayerStatesResponse {
  players: LoyaltyPlayerState[];
  total: number;
}

export interface AwardBody {
  pointsDelta: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface AwardResponse {
  state: LoyaltyPlayerState;
  event: LoyaltyEvent;
  tierChanged: boolean;
}

export interface OverrideTierBody {
  tierId: string | null;
  reason: string;
}

// ── Tier CRUD ──────────────────────────────────────────────────────────────

export async function listLoyaltyTiers(query: {
  active?: boolean;
  limit?: number;
} = {}): Promise<ListLoyaltyTiersResponse> {
  const qs = new URLSearchParams();
  if (query.active !== undefined) qs.set("active", String(query.active));
  if (query.limit) qs.set("limit", String(query.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListLoyaltyTiersResponse>(
    `/api/admin/loyalty/tiers${suffix}`,
    { auth: true }
  );
}

export async function getLoyaltyTier(id: string): Promise<LoyaltyTier> {
  return apiRequest<LoyaltyTier>(
    `/api/admin/loyalty/tiers/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function createLoyaltyTier(
  body: CreateLoyaltyTierBody
): Promise<LoyaltyTier> {
  return apiRequest<LoyaltyTier>("/api/admin/loyalty/tiers", {
    method: "POST",
    body,
    auth: true,
  });
}

export async function updateLoyaltyTier(
  id: string,
  body: UpdateLoyaltyTierBody
): Promise<LoyaltyTier> {
  return apiRequest<LoyaltyTier>(
    `/api/admin/loyalty/tiers/${encodeURIComponent(id)}`,
    { method: "PATCH", body, auth: true }
  );
}

export async function deleteLoyaltyTier(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<{ softDeleted: boolean }> {
  const qs = opts.hard ? "?hard=true" : "";
  return apiRequest<{ softDeleted: boolean }>(
    `/api/admin/loyalty/tiers/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}

// ── Player state ───────────────────────────────────────────────────────────

export async function listLoyaltyPlayers(query: {
  tierId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ListPlayerStatesResponse> {
  const qs = new URLSearchParams();
  if (query.tierId) qs.set("tierId", query.tierId);
  if (query.limit) qs.set("limit", String(query.limit));
  if (query.offset) qs.set("offset", String(query.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListPlayerStatesResponse>(
    `/api/admin/loyalty/players${suffix}`,
    { auth: true }
  );
}

export async function getLoyaltyPlayer(
  userId: string
): Promise<PlayerStateResponse> {
  return apiRequest<PlayerStateResponse>(
    `/api/admin/loyalty/players/${encodeURIComponent(userId)}`,
    { auth: true }
  );
}

export async function awardLoyaltyPoints(
  userId: string,
  body: AwardBody
): Promise<AwardResponse> {
  return apiRequest<AwardResponse>(
    `/api/admin/loyalty/players/${encodeURIComponent(userId)}/award`,
    { method: "POST", body, auth: true }
  );
}

export async function overrideLoyaltyTier(
  userId: string,
  body: OverrideTierBody
): Promise<LoyaltyPlayerState> {
  return apiRequest<LoyaltyPlayerState>(
    `/api/admin/loyalty/players/${encodeURIComponent(userId)}/tier`,
    { method: "PATCH", body, auth: true }
  );
}
