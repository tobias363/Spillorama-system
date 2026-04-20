/**
 * BIN-620: admin-router for GameType CRUD.
 *
 * Endepunkter (matches apps/admin-web/.../GameTypeState.ts-kontraktet):
 *   GET    /api/admin/game-types
 *   GET    /api/admin/game-types/:id
 *   POST   /api/admin/game-types
 *   PATCH  /api/admin/game-types/:id
 *   DELETE /api/admin/game-types/:id
 *
 * Rolle-krav: GAME_TYPE_READ for GETs, GAME_TYPE_WRITE for POST/PATCH/DELETE
 * (se apps/backend/src/platform/AdminAccessPolicy.ts). WRITE er ADMIN-only
 * fordi spill-typer er sentralt definert og endrer hele systemet.
 *
 * Svar-formatet matcher `GameTypeRow` i shared-types/schemas.ts
 * (GameTypeRowSchema). Lookup via id (UUID) eller type_slug støttes.
 *
 * Audit: create/update/delete skriver til AuditLogService (fire-and-forget
 * samme mønster som BIN-622/626/627/665).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  GameTypeService,
  GameType,
  GameTypeStatus,
  CreateGameTypeInput,
  UpdateGameTypeInput,
} from "../admin/GameTypeService.js";
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

const logger = rootLogger.child({ module: "admin-game-types" });

export interface AdminGameTypesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  gameTypeService: GameTypeService;
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

function parseOptionalStatus(value: unknown): GameTypeStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as GameTypeStatus;
  if (v !== "active" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, inactive."
    );
  }
  return v;
}

function parseOptionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  throw new DomainError("INVALID_INPUT", `${field} må være true/false.`);
}

function parseOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et heltall.`);
  }
  return n;
}

function parseOptionalIntOrNull(
  value: unknown,
  field: string
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et heltall eller null.`
    );
  }
  return n;
}

function parseOptionalIntArray(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en liste.`);
  }
  return value.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field} må være en liste av heltall.`
      );
    }
    return n;
  });
}

function parseOptionalExtra(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "extra må være et objekt.");
  }
  return value as Record<string, unknown>;
}

/**
 * Trim ned internt `GameType`-objekt til wire-shape som matcher
 * `GameTypeRow` i shared-types (ingen deletedAt eksponert).
 */
function toWireShape(g: GameType): Omit<GameType, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = g;
  return rest;
}

export function createAdminGameTypesRouter(
  deps: AdminGameTypesRouterDeps
): express.Router {
  const { platformService, auditLogService, gameTypeService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-620] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/game-types", async (req, res) => {
    try {
      await requirePermission(req, "GAME_TYPE_READ");
      const status = parseOptionalStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 200);
      const gameTypes = await gameTypeService.list({ status, limit });
      apiSuccess(res, {
        gameTypes: gameTypes.map(toWireShape),
        count: gameTypes.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/game-types/:id", async (req, res) => {
    try {
      await requirePermission(req, "GAME_TYPE_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const gameType = await gameTypeService.get(id);
      apiSuccess(res, toWireShape(gameType));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/game-types", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_TYPE_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const input: CreateGameTypeInput = {
        typeSlug: mustBeNonEmptyString(body.typeSlug, "typeSlug"),
        name: mustBeNonEmptyString(body.name, "name"),
        createdBy: actor.id,
      };
      if (typeof body.photo === "string") {
        input.photo = body.photo;
      }
      const pattern = parseOptionalBool(body.pattern, "pattern");
      if (pattern !== undefined) input.pattern = pattern;
      const gridRows = parseOptionalInt(body.gridRows, "gridRows");
      if (gridRows !== undefined) input.gridRows = gridRows;
      const gridColumns = parseOptionalInt(body.gridColumns, "gridColumns");
      if (gridColumns !== undefined) input.gridColumns = gridColumns;
      const rangeMin = parseOptionalIntOrNull(body.rangeMin, "rangeMin");
      if (rangeMin !== undefined) input.rangeMin = rangeMin;
      const rangeMax = parseOptionalIntOrNull(body.rangeMax, "rangeMax");
      if (rangeMax !== undefined) input.rangeMax = rangeMax;
      const totalNoTickets = parseOptionalIntOrNull(
        body.totalNoTickets,
        "totalNoTickets"
      );
      if (totalNoTickets !== undefined) input.totalNoTickets = totalNoTickets;
      const userMaxTickets = parseOptionalIntOrNull(
        body.userMaxTickets,
        "userMaxTickets"
      );
      if (userMaxTickets !== undefined) input.userMaxTickets = userMaxTickets;
      const luckyNumbers = parseOptionalIntArray(
        body.luckyNumbers,
        "luckyNumbers"
      );
      if (luckyNumbers !== undefined) input.luckyNumbers = luckyNumbers;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) input.status = status;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) input.extra = extra;

      const gameType = await gameTypeService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game_type.created",
        resource: "game_type",
        resourceId: gameType.id,
        details: {
          typeSlug: gameType.typeSlug,
          name: gameType.name,
          pattern: gameType.pattern,
          status: gameType.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(gameType));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/game-types/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_TYPE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateGameTypeInput = {};

      if (body.typeSlug !== undefined) {
        update.typeSlug = mustBeNonEmptyString(body.typeSlug, "typeSlug");
      }
      if (body.name !== undefined) {
        update.name = mustBeNonEmptyString(body.name, "name");
      }
      if (body.photo !== undefined) {
        if (typeof body.photo !== "string") {
          throw new DomainError("INVALID_INPUT", "photo må være en streng.");
        }
        update.photo = body.photo;
      }
      const pattern = parseOptionalBool(body.pattern, "pattern");
      if (pattern !== undefined) update.pattern = pattern;
      const gridRows = parseOptionalInt(body.gridRows, "gridRows");
      if (gridRows !== undefined) update.gridRows = gridRows;
      const gridColumns = parseOptionalInt(body.gridColumns, "gridColumns");
      if (gridColumns !== undefined) update.gridColumns = gridColumns;
      const rangeMin = parseOptionalIntOrNull(body.rangeMin, "rangeMin");
      if (rangeMin !== undefined) update.rangeMin = rangeMin;
      const rangeMax = parseOptionalIntOrNull(body.rangeMax, "rangeMax");
      if (rangeMax !== undefined) update.rangeMax = rangeMax;
      const totalNoTickets = parseOptionalIntOrNull(
        body.totalNoTickets,
        "totalNoTickets"
      );
      if (totalNoTickets !== undefined) update.totalNoTickets = totalNoTickets;
      const userMaxTickets = parseOptionalIntOrNull(
        body.userMaxTickets,
        "userMaxTickets"
      );
      if (userMaxTickets !== undefined) update.userMaxTickets = userMaxTickets;
      const luckyNumbers = parseOptionalIntArray(
        body.luckyNumbers,
        "luckyNumbers"
      );
      if (luckyNumbers !== undefined) update.luckyNumbers = luckyNumbers;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) update.status = status;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) update.extra = extra;

      const gameType = await gameTypeService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game_type.updated",
        resource: "game_type",
        resourceId: gameType.id,
        details: {
          typeSlug: gameType.typeSlug,
          changed: Object.keys(update),
          status: gameType.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(gameType));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/game-types/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_TYPE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await gameTypeService.get(id);
      const result = await gameTypeService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.game_type.soft_deleted"
          : "admin.game_type.deleted",
        resource: "game_type",
        resourceId: id,
        details: {
          typeSlug: existing.typeSlug,
          name: existing.name,
          softDeleted: result.softDeleted,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
