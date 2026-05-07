/**
 * Fase 2 (2026-05-07): admin-game-plans API-wrappers.
 *
 * Backend-endpoints (apps/backend/src/routes/adminGamePlans.ts):
 *   GET    /api/admin/game-plans                 (GAME_CATALOG_READ)
 *   GET    /api/admin/game-plans/:id             (GAME_CATALOG_READ)
 *   POST   /api/admin/game-plans                 (GAME_CATALOG_WRITE)
 *   PUT    /api/admin/game-plans/:id             (GAME_CATALOG_WRITE)
 *   DELETE /api/admin/game-plans/:id             (GAME_CATALOG_WRITE)
 *   PUT    /api/admin/game-plans/:id/items       (GAME_CATALOG_WRITE)
 */

import { apiRequest } from "./client.js";
import type { GameCatalogEntry } from "./admin-game-catalog.js";

// ── Whitelists ──────────────────────────────────────────────────────────

export const WEEKDAY_VALUES = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type Weekday = (typeof WEEKDAY_VALUES)[number];

/**
 * Tolkning A (2026-05-07): bonus-spill-whitelist matcher backend
 * `BONUS_GAME_SLUG_VALUES` i `apps/backend/src/game/gameCatalog.types.ts`.
 *
 * Display-mapping (norsk):
 *   wheel_of_fortune → "Lykkehjul"
 *   color_draft      → "Fargekladd"
 *   treasure_chest   → "Skattekiste"
 *   mystery          → "Mystery Joker"
 */
export const BONUS_GAME_SLUG_VALUES = [
  "mystery",
  "wheel_of_fortune",
  "treasure_chest",
  "color_draft",
] as const;
export type BonusGameSlug = (typeof BONUS_GAME_SLUG_VALUES)[number];

export const BONUS_GAME_DISPLAY_NAMES: Record<BonusGameSlug, string> = {
  mystery: "Mystery Joker",
  wheel_of_fortune: "Lykkehjul",
  treasure_chest: "Skattekiste",
  color_draft: "Fargekladd",
};

// ── Typer ───────────────────────────────────────────────────────────────

export interface GamePlan {
  id: string;
  name: string;
  description: string | null;
  hallId: string | null;
  groupOfHallsId: string | null;
  weekdays: Weekday[];
  /** "HH:MM" 24-timer. */
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface GamePlanItem {
  id: string;
  planId: string;
  position: number;
  gameCatalogId: string;
  /**
   * Tolkning A (2026-05-07): per-item bonus-spill-override.
   * NULL = bruk catalog.bonusGameSlug. Ikke-NULL = overstyrer.
   */
  bonusGameOverride: BonusGameSlug | null;
  notes: string | null;
  createdAt: string;
  catalogEntry: GameCatalogEntry;
}

export interface GamePlanWithItems extends GamePlan {
  items: GamePlanItem[];
}

export interface CreateGamePlanInput {
  name: string;
  description?: string | null;
  hallId?: string | null;
  groupOfHallsId?: string | null;
  weekdays: Weekday[];
  startTime: string;
  endTime: string;
  isActive?: boolean;
}

export interface UpdateGamePlanInput {
  name?: string;
  description?: string | null;
  hallId?: string | null;
  groupOfHallsId?: string | null;
  weekdays?: Weekday[];
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
}

export interface SetGamePlanItemInput {
  gameCatalogId: string;
  /**
   * Tolkning A (2026-05-07): per-item bonus-spill-override.
   * Whitelisted slug eller null. undefined = ikke send.
   */
  bonusGameOverride?: BonusGameSlug | null;
  notes?: string | null;
}

// ── List ────────────────────────────────────────────────────────────────

export interface ListGamePlansParams {
  hallId?: string;
  groupOfHallsId?: string;
  isActive?: boolean;
  limit?: number;
}

export interface ListGamePlansResult {
  plans: GamePlan[];
  count: number;
}

export async function listGamePlans(
  params: ListGamePlansParams = {},
): Promise<ListGamePlansResult> {
  const qs = new URLSearchParams();
  if (params.hallId) qs.set("hallId", params.hallId);
  if (params.groupOfHallsId) qs.set("groupOfHallsId", params.groupOfHallsId);
  if (params.isActive !== undefined) qs.set("isActive", String(params.isActive));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListGamePlansResult>(`/api/admin/game-plans${suffix}`, {
    auth: true,
  });
}

// ── Detail ──────────────────────────────────────────────────────────────

export async function getGamePlan(id: string): Promise<GamePlanWithItems> {
  return apiRequest<GamePlanWithItems>(
    `/api/admin/game-plans/${encodeURIComponent(id)}`,
    { auth: true },
  );
}

// ── Create / Update / Deactivate / SetItems ─────────────────────────────

export async function createGamePlan(
  input: CreateGamePlanInput,
): Promise<GamePlanWithItems> {
  return apiRequest<GamePlanWithItems>("/api/admin/game-plans", {
    method: "POST",
    auth: true,
    body: input,
  });
}

export async function updateGamePlan(
  id: string,
  patch: UpdateGamePlanInput,
): Promise<GamePlanWithItems> {
  return apiRequest<GamePlanWithItems>(
    `/api/admin/game-plans/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      auth: true,
      body: patch,
    },
  );
}

export async function deactivateGamePlan(
  id: string,
): Promise<{ deactivated: boolean }> {
  return apiRequest<{ deactivated: boolean }>(
    `/api/admin/game-plans/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      auth: true,
    },
  );
}

export async function setGamePlanItems(
  id: string,
  items: SetGamePlanItemInput[],
): Promise<GamePlanWithItems> {
  return apiRequest<GamePlanWithItems>(
    `/api/admin/game-plans/${encodeURIComponent(id)}/items`,
    {
      method: "PUT",
      auth: true,
      body: { items },
    },
  );
}
