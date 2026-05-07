/**
 * Fase 2 (2026-05-07): admin-router for spilleplan-templates.
 *
 * Endepunkter:
 *   GET    /api/admin/game-plans                 — list (filter ?hallId | ?groupOfHallsId | ?isActive)
 *   POST   /api/admin/game-plans                 — opprett (uten items)
 *   GET    /api/admin/game-plans/:id             — detalj inkl items + catalog-entry inline
 *   PUT    /api/admin/game-plans/:id             — oppdater plan-meta
 *   DELETE /api/admin/game-plans/:id             — soft-deactivate
 *   PUT    /api/admin/game-plans/:id/items       — REPLACE hele sekvensen atomisk (drag-and-drop save)
 *
 * Rolle-krav (gjenbruker GAME_CATALOG_*-permissions for nå — hall-scope
 * håndheves via resolveHallScopeFilter for HALL_OPERATOR i list-filter):
 *   - GAME_CATALOG_READ:  ADMIN, HALL_OPERATOR, SUPPORT, AGENT
 *   - GAME_CATALOG_WRITE: ADMIN
 *
 * Wire-format speiler `GamePlan` + `GamePlanWithItems` 1:1.
 *
 * Audit: create/update/deactivate/setItems skriver til AuditLogService via
 * GamePlanService.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { GamePlanService } from "../game/GamePlanService.js";
import type {
  CreateGamePlanInput,
  ListGamePlanFilter,
  SetGamePlanItemsInput,
  UpdateGamePlanInput,
} from "../game/gamePlan.types.js";
import {
  assertAdminPermission,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game-plans" });

export interface AdminGamePlansRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  planService: GamePlanService;
}

function actorTypeFromRole(
  role: PublicAppUser["role"],
): "ADMIN" | "USER" {
  return role === "ADMIN" ? "ADMIN" : "USER";
}

function parseOptionalBool(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  throw new DomainError("INVALID_INPUT", `${field} må være true/false.`);
}

function parseStringField(
  value: unknown,
  field: string,
  allowNull = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    if (allowNull) return null;
    throw new DomainError("INVALID_INPUT", `${field} kan ikke være null.`);
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  return value;
}

export function createAdminGamePlansRouter(
  deps: AdminGamePlansRouterDeps,
): express.Router {
  const { platformService, planService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: "GAME_CATALOG_READ" | "GAME_CATALOG_WRITE",
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  // ── List ──────────────────────────────────────────────────────────────

  router.get("/api/admin/game-plans", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME_CATALOG_READ");
      const explicitHallId =
        typeof req.query.hallId === "string" && req.query.hallId.trim()
          ? req.query.hallId.trim()
          : undefined;
      // HALL_OPERATOR/AGENT scopes til egen hall.
      const scopedHallId = resolveHallScopeFilter(
        { role: user.role, hallId: user.hallId },
        explicitHallId,
      );
      const groupOfHallsId =
        typeof req.query.groupOfHallsId === "string" &&
        req.query.groupOfHallsId.trim()
          ? req.query.groupOfHallsId.trim()
          : undefined;
      const isActive = parseOptionalBool(req.query.isActive, "isActive");
      const limit = parseLimit(req.query.limit, 200);
      const filter: ListGamePlanFilter = { limit };
      if (scopedHallId !== undefined) filter.hallId = scopedHallId;
      if (groupOfHallsId !== undefined) filter.groupOfHallsId = groupOfHallsId;
      if (isActive !== undefined) filter.isActive = isActive;
      const plans = await planService.list(filter);
      apiSuccess(res, { plans, count: plans.length });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Detail ────────────────────────────────────────────────────────────

  router.get("/api/admin/game-plans/:id", async (req, res) => {
    try {
      await requirePermission(req, "GAME_CATALOG_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const plan = await planService.getById(id);
      if (!plan) {
        throw new DomainError("GAME_PLAN_NOT_FOUND", "Plan finnes ikke.");
      }
      apiSuccess(res, plan);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Create ────────────────────────────────────────────────────────────

  router.post("/api/admin/game-plans", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const name = mustBeNonEmptyString(body.name, "name");
      if (!Array.isArray(body.weekdays)) {
        throw new DomainError(
          "INVALID_INPUT",
          "weekdays må være en liste.",
        );
      }
      const startTime = mustBeNonEmptyString(body.startTime, "startTime");
      const endTime = mustBeNonEmptyString(body.endTime, "endTime");

      const input: CreateGamePlanInput = {
        name,
        weekdays: body.weekdays as CreateGamePlanInput["weekdays"],
        startTime,
        endTime,
        createdByUserId: actor.id,
      };

      const desc = parseStringField(body.description, "description", true);
      if (desc !== undefined) input.description = desc;
      const hallId = parseStringField(body.hallId, "hallId", true);
      if (hallId !== undefined) input.hallId = hallId;
      const groupOfHallsId = parseStringField(
        body.groupOfHallsId,
        "groupOfHallsId",
        true,
      );
      if (groupOfHallsId !== undefined) input.groupOfHallsId = groupOfHallsId;
      if (body.isActive !== undefined) {
        const flag = parseOptionalBool(body.isActive, "isActive");
        if (flag !== undefined) input.isActive = flag;
      }

      const plan = await planService.create(input, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, plan);
    } catch (err) {
      logger.warn({ err }, "create game-plan failed");
      apiFailure(res, err);
    }
  });

  // ── Update plan-meta ──────────────────────────────────────────────────

  router.put("/api/admin/game-plans/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const patch: UpdateGamePlanInput = {};

      if (body.name !== undefined) {
        patch.name = mustBeNonEmptyString(body.name, "name");
      }
      if (body.description !== undefined) {
        const desc = parseStringField(body.description, "description", true);
        if (desc !== undefined) patch.description = desc;
      }
      if (body.hallId !== undefined) {
        const hallId = parseStringField(body.hallId, "hallId", true);
        if (hallId !== undefined) patch.hallId = hallId;
      }
      if (body.groupOfHallsId !== undefined) {
        const g = parseStringField(body.groupOfHallsId, "groupOfHallsId", true);
        if (g !== undefined) patch.groupOfHallsId = g;
      }
      if (body.weekdays !== undefined) {
        if (!Array.isArray(body.weekdays)) {
          throw new DomainError(
            "INVALID_INPUT",
            "weekdays må være en liste.",
          );
        }
        patch.weekdays = body.weekdays as UpdateGamePlanInput["weekdays"];
      }
      if (body.startTime !== undefined) {
        patch.startTime = mustBeNonEmptyString(body.startTime, "startTime");
      }
      if (body.endTime !== undefined) {
        patch.endTime = mustBeNonEmptyString(body.endTime, "endTime");
      }
      if (body.isActive !== undefined) {
        const flag = parseOptionalBool(body.isActive, "isActive");
        if (flag !== undefined) patch.isActive = flag;
      }

      const plan = await planService.update(id, patch, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, plan);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Soft-deactivate ───────────────────────────────────────────────────

  router.delete("/api/admin/game-plans/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await planService.deactivate(id, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, { deactivated: true });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Set items (drag-and-drop atomisk replace) ─────────────────────────

  router.put("/api/admin/game-plans/:id/items", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const rawItems = (req.body as { items?: unknown }).items;
      if (!Array.isArray(rawItems)) {
        throw new DomainError(
          "INVALID_INPUT",
          "items må være en liste.",
        );
      }
      const items: SetGamePlanItemsInput[] = rawItems.map((raw, idx) => {
        if (!isRecordObject(raw)) {
          throw new DomainError(
            "INVALID_INPUT",
            `items[${idx}] må være et objekt.`,
          );
        }
        const gameCatalogId = mustBeNonEmptyString(
          raw.gameCatalogId,
          `items[${idx}].gameCatalogId`,
        );
        const out: SetGamePlanItemsInput = { gameCatalogId };
        if (raw.notes !== undefined) {
          if (raw.notes !== null && typeof raw.notes !== "string") {
            throw new DomainError(
              "INVALID_INPUT",
              `items[${idx}].notes må være streng eller null.`,
            );
          }
          out.notes = raw.notes as string | null;
        }
        return out;
      });

      const plan = await planService.setItems(id, items, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, plan);
    } catch (err) {
      logger.warn({ err }, "setItems game-plan failed");
      apiFailure(res, err);
    }
  });

  return router;
}
