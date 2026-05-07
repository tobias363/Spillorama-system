/**
 * Fase 1 (2026-05-07): type-definisjoner for game-plan + run.
 *
 * Disse typene speiler `app_game_plan`, `app_game_plan_item` og
 * `app_game_plan_run` i
 * `migrations/20261210000000_app_game_catalog_and_plan.sql`.
 */

import type {
  BonusGameSlug,
  GameCatalogEntry,
  TicketColor,
} from "./gameCatalog.types.js";

// ── Weekday whitelist (matcher Game1ScheduleTickService.ts:299-305) ─────

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

// ── Plan ─────────────────────────────────────────────────────────────────

export interface GamePlan {
  id: string;
  name: string;
  description: string | null;
  hallId: string | null;
  groupOfHallsId: string | null;
  weekdays: Weekday[];
  /** "HH:MM" (24t). */
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
   * Per-item bonus-spill-override (Tolkning A, 2026-05-07).
   *
   * NULL = ingen override — engine-bridge bruker `catalog.bonusGameSlug`
   * som fallback. Ikke-NULL overstyrer catalog. Whitelist matcher
   * `BONUS_GAME_SLUG_VALUES` i `gameCatalog.types.ts`.
   */
  bonusGameOverride: BonusGameSlug | null;
  notes: string | null;
  createdAt: string;
}

export interface GamePlanWithItems extends GamePlan {
  items: (GamePlanItem & { catalogEntry: GameCatalogEntry })[];
}

export interface CreateGamePlanInput {
  name: string;
  description?: string | null;
  /** XOR mot groupOfHallsId — service-laget validerer. */
  hallId?: string | null;
  groupOfHallsId?: string | null;
  weekdays: Weekday[];
  startTime: string;
  endTime: string;
  isActive?: boolean;
  createdByUserId: string;
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

export interface ListGamePlanFilter {
  hallId?: string;
  groupOfHallsId?: string;
  isActive?: boolean;
  limit?: number;
}

export interface SetGamePlanItemsInput {
  gameCatalogId: string;
  /**
   * Tolkning A (2026-05-07): per-item bonus-spill-override.
   *
   * - undefined eller null → ingen override (fallback til catalog).
   * - string → må være i `BONUS_GAME_SLUG_VALUES`-whitelist; service-laget
   *   validerer.
   */
  bonusGameOverride?: BonusGameSlug | null;
  notes?: string | null;
}

// ── Plan run ─────────────────────────────────────────────────────────────

export type GamePlanRunStatus = "idle" | "running" | "paused" | "finished";

export const GAME_PLAN_RUN_STATUS_VALUES: GamePlanRunStatus[] = [
  "idle",
  "running",
  "paused",
  "finished",
];

export interface JackpotOverride {
  draw: number;
  prizesCents: Partial<Record<TicketColor, number>>;
}

export interface GamePlanRun {
  id: string;
  planId: string;
  hallId: string;
  /** ISO date YYYY-MM-DD (Oslo-tz). */
  businessDate: string;
  currentPosition: number;
  status: GamePlanRunStatus;
  jackpotOverrides: Record<string, JackpotOverride>;
  startedAt: string | null;
  finishedAt: string | null;
  masterUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdvanceToNextResult {
  run: GamePlanRun;
  nextGame: GameCatalogEntry | null;
  jackpotSetupRequired: boolean;
}
