/**
 * Fase 2 (2026-05-07): GamePlan UI state-helpers.
 *
 * Tynt lag rundt apps/admin-web/src/api/admin-game-plans.ts. Plan-meta
 * er enkel CRUD; sekvens-edit (drag-and-drop) bruker `setGamePlanItems`
 * for atomisk replace.
 */

import { ApiError } from "../../../api/client.js";
import {
  createGamePlan,
  deactivateGamePlan,
  getGamePlan,
  listGamePlans,
  setGamePlanItems,
  updateGamePlan,
  type CreateGamePlanInput,
  type GamePlan,
  type GamePlanWithItems,
  type ListGamePlansParams,
  type SetGamePlanItemInput,
  type UpdateGamePlanInput,
  type Weekday,
} from "../../../api/admin-game-plans.js";

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "PERMISSION_DENIED" | "VALIDATION" | "BACKEND_ERROR"; message: string };

function apiErrorToResult<T>(err: unknown): WriteResult<T> {
  if (err instanceof ApiError) {
    if (err.status === 403 || err.code === "FORBIDDEN") {
      return {
        ok: false,
        reason: "PERMISSION_DENIED",
        message: err.message,
      };
    }
    if (err.code === "INVALID_INPUT" || err.status === 400) {
      return { ok: false, reason: "VALIDATION", message: err.message };
    }
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

// ── Reads ───────────────────────────────────────────────────────────────

export async function fetchPlanList(
  params: ListGamePlansParams = {},
): Promise<GamePlan[]> {
  const result = await listGamePlans(params);
  return result.plans;
}

export async function fetchPlan(id: string): Promise<GamePlanWithItems | null> {
  try {
    return await getGamePlan(id);
  } catch (err) {
    if (err instanceof ApiError && err.code === "GAME_PLAN_NOT_FOUND") {
      return null;
    }
    throw err;
  }
}

// ── Writes ──────────────────────────────────────────────────────────────

export async function savePlanMeta(
  input: CreateGamePlanInput | UpdateGamePlanInput,
  existingId?: string,
): Promise<WriteResult<GamePlanWithItems>> {
  try {
    const plan = existingId
      ? await updateGamePlan(existingId, input as UpdateGamePlanInput)
      : await createGamePlan(input as CreateGamePlanInput);
    return { ok: true, value: plan };
  } catch (err) {
    return apiErrorToResult(err);
  }
}

export async function saveItems(
  planId: string,
  items: SetGamePlanItemInput[],
): Promise<WriteResult<GamePlanWithItems>> {
  try {
    const plan = await setGamePlanItems(planId, items);
    return { ok: true, value: plan };
  } catch (err) {
    return apiErrorToResult(err);
  }
}

export async function deactivatePlan(
  id: string,
): Promise<WriteResult<{ deactivated: boolean }>> {
  try {
    const result = await deactivateGamePlan(id);
    return { ok: true, value: result };
  } catch (err) {
    return apiErrorToResult(err);
  }
}

// ── Form-payload (UI) ───────────────────────────────────────────────────

export interface PlanMetaPayload {
  name: string;
  description: string | null;
  /** "hall" eller "group" — XOR. */
  bindingKind: "hall" | "group";
  hallId: string | null;
  groupOfHallsId: string | null;
  weekdays: Weekday[];
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export function defaultPlanPayload(): PlanMetaPayload {
  return {
    name: "",
    description: null,
    bindingKind: "hall",
    hallId: null,
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
  };
}

export function planToPayload(plan: GamePlanWithItems): PlanMetaPayload {
  return {
    name: plan.name,
    description: plan.description,
    bindingKind: plan.groupOfHallsId ? "group" : "hall",
    hallId: plan.hallId,
    groupOfHallsId: plan.groupOfHallsId,
    weekdays: plan.weekdays,
    startTime: plan.startTime,
    endTime: plan.endTime,
    isActive: plan.isActive,
  };
}

export function payloadToCreateInput(p: PlanMetaPayload): CreateGamePlanInput {
  return {
    name: p.name,
    description: p.description,
    hallId: p.bindingKind === "hall" ? p.hallId : null,
    groupOfHallsId: p.bindingKind === "group" ? p.groupOfHallsId : null,
    weekdays: p.weekdays,
    startTime: p.startTime,
    endTime: p.endTime,
    isActive: p.isActive,
  };
}

export function payloadToUpdateInput(p: PlanMetaPayload): UpdateGamePlanInput {
  return {
    name: p.name,
    description: p.description,
    hallId: p.bindingKind === "hall" ? p.hallId : null,
    groupOfHallsId: p.bindingKind === "group" ? p.groupOfHallsId : null,
    weekdays: p.weekdays,
    startTime: p.startTime,
    endTime: p.endTime,
    isActive: p.isActive,
  };
}
