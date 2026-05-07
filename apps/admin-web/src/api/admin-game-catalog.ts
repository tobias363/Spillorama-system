/**
 * Fase 2 (2026-05-07): admin-game-catalog API-wrappers.
 *
 * Backend-endpoints (apps/backend/src/routes/adminGameCatalog.ts):
 *   GET    /api/admin/game-catalog              (GAME_CATALOG_READ)
 *   GET    /api/admin/game-catalog/:id          (GAME_CATALOG_READ)
 *   POST   /api/admin/game-catalog              (GAME_CATALOG_WRITE)
 *   PUT    /api/admin/game-catalog/:id          (GAME_CATALOG_WRITE)
 *   DELETE /api/admin/game-catalog/:id          (GAME_CATALOG_WRITE)
 *
 * Wire-format matcher backend `GameCatalogEntry`. Beløp er i ØRE.
 */

import { apiRequest } from "./client.js";

// ── Whitelists (samme som backend gameCatalog.types.ts) ─────────────────

export const TICKET_COLOR_VALUES = ["gul", "hvit", "lilla"] as const;
export type TicketColor = (typeof TICKET_COLOR_VALUES)[number];

export const BONUS_GAME_SLUG_VALUES = [
  "mystery",
  "wheel_of_fortune",
  "treasure_chest",
  "color_draft",
] as const;
export type BonusGameSlug = (typeof BONUS_GAME_SLUG_VALUES)[number];

// ── Typer ───────────────────────────────────────────────────────────────

export interface PrizesCents {
  rad1: number;
  rad2: number;
  rad3: number;
  rad4: number;
  bingo: Partial<Record<TicketColor, number>>;
}

export interface GameCatalogEntry {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  rules: Record<string, unknown>;
  ticketColors: TicketColor[];
  ticketPricesCents: Partial<Record<TicketColor, number>>;
  prizesCents: PrizesCents;
  bonusGameSlug: BonusGameSlug | null;
  bonusGameEnabled: boolean;
  requiresJackpotSetup: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface CreateGameCatalogInput {
  slug: string;
  displayName: string;
  description?: string | null;
  rules?: Record<string, unknown>;
  ticketColors: TicketColor[];
  ticketPricesCents: Partial<Record<TicketColor, number>>;
  prizesCents: PrizesCents;
  bonusGameSlug?: BonusGameSlug | null;
  bonusGameEnabled?: boolean;
  requiresJackpotSetup?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateGameCatalogInput
  extends Partial<Omit<CreateGameCatalogInput, "slug">> {
  slug?: string;
}

// ── List ────────────────────────────────────────────────────────────────

export interface ListGameCatalogParams {
  isActive?: boolean;
  limit?: number;
}

export interface ListGameCatalogResult {
  entries: GameCatalogEntry[];
  count: number;
}

export async function listGameCatalog(
  params: ListGameCatalogParams = {},
): Promise<ListGameCatalogResult> {
  const qs = new URLSearchParams();
  if (params.isActive !== undefined) qs.set("isActive", String(params.isActive));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListGameCatalogResult>(`/api/admin/game-catalog${suffix}`, {
    auth: true,
  });
}

// ── Detail ──────────────────────────────────────────────────────────────

export async function getGameCatalogEntry(
  id: string,
): Promise<GameCatalogEntry> {
  return apiRequest<GameCatalogEntry>(
    `/api/admin/game-catalog/${encodeURIComponent(id)}`,
    { auth: true },
  );
}

// ── Create / Update / Deactivate ────────────────────────────────────────

export async function createGameCatalogEntry(
  input: CreateGameCatalogInput,
): Promise<GameCatalogEntry> {
  return apiRequest<GameCatalogEntry>("/api/admin/game-catalog", {
    method: "POST",
    auth: true,
    body: input,
  });
}

export async function updateGameCatalogEntry(
  id: string,
  patch: UpdateGameCatalogInput,
): Promise<GameCatalogEntry> {
  return apiRequest<GameCatalogEntry>(
    `/api/admin/game-catalog/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      auth: true,
      body: patch,
    },
  );
}

export async function deactivateGameCatalogEntry(
  id: string,
): Promise<{ deactivated: boolean }> {
  return apiRequest<{ deactivated: boolean }>(
    `/api/admin/game-catalog/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      auth: true,
    },
  );
}
