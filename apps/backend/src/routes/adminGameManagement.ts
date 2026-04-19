/**
 * BIN-622: admin-router for Game Management CRUD + repeat.
 *
 * Endepunkter (matches apps/admin-web/.../GameManagementState.ts-kontraktet):
 *   GET    /api/admin/game-management?gameTypeId=X
 *   GET    /api/admin/game-management/:typeId/:id
 *   POST   /api/admin/game-management
 *   PATCH  /api/admin/game-management/:id
 *   POST   /api/admin/game-management/:id/repeat
 *   DELETE /api/admin/game-management/:id
 *
 * Rolle-krav: GAME_MGMT_READ for GETs, GAME_MGMT_WRITE for resten
 * (se apps/backend/src/platform/AdminAccessPolicy.ts).
 *
 * Svar-formatet matcher `GameManagementRow` i admin-web — typer er
 * kanonisert i packages/shared-types/src/schemas.ts
 * (GameManagementRowSchema).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  GameManagementService,
  GameManagement,
  GameManagementStatus,
  GameManagementTicketType,
  CreateGameManagementInput,
  UpdateGameManagementInput,
} from "../admin/GameManagementService.js";
import {
  assertAdminPermission,
  type AdminPermission,
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

const logger = rootLogger.child({ module: "admin-game-management" });

export interface AdminGameManagementRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  gameManagementService: GameManagementService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(
  role: PublicAppUser["role"]
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

function parseOptionalStatus(value: unknown): GameManagementStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as GameManagementStatus;
  if (v !== "active" && v !== "running" && v !== "closed" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, running, closed, inactive."
    );
  }
  return v;
}

/**
 * Trim ned internt `GameManagement`-objekt til wire-shape som matcher
 * `GameManagementRow` i admin-web (camelCase, no deletedAt exposed).
 */
function toWireShape(gm: GameManagement): Omit<GameManagement, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = gm;
  return rest;
}

export function createAdminGameManagementRouter(
  deps: AdminGameManagementRouterDeps
): express.Router {
  const { platformService, auditLogService, gameManagementService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-622] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/game-management", async (req, res) => {
    try {
      await requirePermission(req, "GAME_MGMT_READ");
      const gameTypeId =
        typeof req.query.gameTypeId === "string" && req.query.gameTypeId.trim()
          ? req.query.gameTypeId.trim()
          : undefined;
      const status = parseOptionalStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 100);
      const games = await gameManagementService.list({ gameTypeId, status, limit });
      apiSuccess(res, {
        games: games.map(toWireShape),
        count: games.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail (typeId + id, matches legacy-URL-pattern) ──────────

  router.get("/api/admin/game-management/:typeId/:id", async (req, res) => {
    try {
      await requirePermission(req, "GAME_MGMT_READ");
      const typeId = mustBeNonEmptyString(req.params.typeId, "typeId");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const game = await gameManagementService.get(id);
      if (game.gameTypeId !== typeId) {
        throw new DomainError(
          "GAME_MANAGEMENT_NOT_FOUND",
          "Game Management-rad finnes ikke i denne gameType."
        );
      }
      apiSuccess(res, toWireShape(game));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/game-management", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_MGMT_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const input: CreateGameManagementInput = {
        gameTypeId: mustBeNonEmptyString(req.body.gameTypeId, "gameTypeId"),
        name: mustBeNonEmptyString(req.body.name, "name"),
        startDate: mustBeNonEmptyString(req.body.startDate, "startDate"),
        createdBy: actor.id,
      };
      if (req.body.parentId !== undefined) {
        input.parentId =
          typeof req.body.parentId === "string" ? req.body.parentId : null;
      }
      if (req.body.ticketType !== undefined) {
        input.ticketType = req.body.ticketType as GameManagementTicketType | null;
      }
      if (req.body.ticketPrice !== undefined) {
        input.ticketPrice = Number(req.body.ticketPrice);
      }
      if (req.body.endDate !== undefined) {
        input.endDate = typeof req.body.endDate === "string" ? req.body.endDate : null;
      }
      if (req.body.status !== undefined) {
        input.status = req.body.status as GameManagementStatus;
      }
      if (req.body.config !== undefined) {
        if (
          req.body.config !== null &&
          (typeof req.body.config !== "object" || Array.isArray(req.body.config))
        ) {
          throw new DomainError("INVALID_INPUT", "config må være et objekt.");
        }
        input.config = (req.body.config ?? {}) as Record<string, unknown>;
      }
      const game = await gameManagementService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game_management.created",
        resource: "game_management",
        resourceId: game.id,
        details: {
          gameTypeId: game.gameTypeId,
          name: game.name,
          ticketType: game.ticketType,
          ticketPrice: game.ticketPrice,
          startDate: game.startDate,
          endDate: game.endDate,
          status: game.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(game));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/game-management/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_MGMT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const update: UpdateGameManagementInput = {};
      if (req.body.name !== undefined) update.name = req.body.name as string;
      if (req.body.ticketType !== undefined) {
        update.ticketType = req.body.ticketType as GameManagementTicketType | null;
      }
      if (req.body.ticketPrice !== undefined) {
        update.ticketPrice = Number(req.body.ticketPrice);
      }
      if (req.body.startDate !== undefined) update.startDate = req.body.startDate as string;
      if (req.body.endDate !== undefined) {
        update.endDate = typeof req.body.endDate === "string" ? req.body.endDate : null;
      }
      if (req.body.status !== undefined) {
        update.status = req.body.status as GameManagementStatus;
      }
      if (req.body.parentId !== undefined) {
        update.parentId =
          typeof req.body.parentId === "string" ? req.body.parentId : null;
      }
      if (req.body.config !== undefined) {
        if (
          req.body.config !== null &&
          (typeof req.body.config !== "object" || Array.isArray(req.body.config))
        ) {
          throw new DomainError("INVALID_INPUT", "config må være et objekt.");
        }
        update.config = (req.body.config ?? {}) as Record<string, unknown>;
      }
      if (req.body.totalSold !== undefined) {
        update.totalSold = Number(req.body.totalSold);
      }
      if (req.body.totalEarning !== undefined) {
        update.totalEarning = Number(req.body.totalEarning);
      }
      const game = await gameManagementService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game_management.updated",
        resource: "game_management",
        resourceId: game.id,
        details: {
          gameTypeId: game.gameTypeId,
          changed: Object.keys(update),
          newStatus: game.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(game));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/game-management/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_MGMT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await gameManagementService.get(id);
      const result = await gameManagementService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.game_management.soft_deleted"
          : "admin.game_management.deleted",
        resource: "game_management",
        resourceId: id,
        details: {
          gameTypeId: existing.gameTypeId,
          name: existing.name,
          softDeleted: result.softDeleted,
          totalSold: existing.totalSold,
          hadRepeats: existing.repeatedFromId !== null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: repeat (idempotent) ──────────────────────────────────────

  router.post("/api/admin/game-management/:id/repeat", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_MGMT_WRITE");
      const sourceId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const startDate = mustBeNonEmptyString(req.body.startDate, "startDate");
      const endDate =
        typeof req.body.endDate === "string" ? req.body.endDate : null;
      const name =
        typeof req.body.name === "string" && req.body.name.trim()
          ? req.body.name
          : null;
      const repeatToken =
        typeof req.body.repeatToken === "string" && req.body.repeatToken.trim()
          ? req.body.repeatToken.trim()
          : null;
      const game = await gameManagementService.repeat({
        sourceId,
        startDate,
        endDate,
        name,
        createdBy: actor.id,
        repeatToken,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game_management.repeated",
        resource: "game_management",
        resourceId: game.id,
        details: {
          sourceId,
          gameTypeId: game.gameTypeId,
          newName: game.name,
          startDate: game.startDate,
          endDate: game.endDate,
          repeatTokenPresent: repeatToken !== null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(game));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
