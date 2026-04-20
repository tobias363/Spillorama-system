/**
 * BIN-621: admin-router for SubGame CRUD.
 *
 * Endepunkter (matches apps/admin-web-kontraktet):
 *   GET    /api/admin/sub-games
 *   GET    /api/admin/sub-games/:id
 *   POST   /api/admin/sub-games
 *   PATCH  /api/admin/sub-games/:id
 *   DELETE /api/admin/sub-games/:id
 *
 * Rolle-krav: SUB_GAME_READ for GETs, SUB_GAME_WRITE for POST/PATCH/DELETE
 * (se apps/backend/src/platform/AdminAccessPolicy.ts). WRITE inkluderer
 * HALL_OPERATOR — samme mønster som PATTERN_WRITE / SCHEDULE_WRITE, siden
 * SubGame-maler ikke er like sentrale som GameType-katalogen.
 *
 * Svar-formatet matcher `SubGameRow` i shared-types/schemas.ts
 * (SubGameRowSchema). Listen støtter filter per gameType (?gameType=slug).
 *
 * Audit: create/update/delete skriver til AuditLogService (fire-and-forget
 * samme mønster som BIN-620 / BIN-622 / BIN-626 / BIN-627 / BIN-665).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  SubGameService,
  SubGame,
  SubGameStatus,
  SubGamePatternRef,
  CreateSubGameInput,
  UpdateSubGameInput,
} from "../admin/SubGameService.js";
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

const logger = rootLogger.child({ module: "admin-sub-games" });

export interface AdminSubGamesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  subGameService: SubGameService;
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

function parseOptionalStatus(value: unknown): SubGameStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as SubGameStatus;
  if (v !== "active" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, inactive."
    );
  }
  return v;
}

function parseOptionalPatternRows(
  value: unknown,
  field: string
): SubGamePatternRef[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en liste.`);
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field} må være liste av objekter.`
      );
    }
    const obj = raw as Record<string, unknown>;
    const patternId = obj.patternId;
    const name = obj.name;
    if (typeof patternId !== "string" || !patternId.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field}[].patternId er påkrevd.`
      );
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new DomainError("INVALID_INPUT", `${field}[].name er påkrevd.`);
    }
    return { patternId: patternId.trim(), name: name.trim() };
  });
}

function parseOptionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en liste.`);
  }
  return value.map((raw) => {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field} må være liste av ikke-tomme strenger.`
      );
    }
    return raw.trim();
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
 * Trim ned internt `SubGame`-objekt til wire-shape som matcher
 * `SubGameRow` i shared-types (ingen deletedAt eksponert).
 */
function toWireShape(g: SubGame): Omit<SubGame, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = g;
  return rest;
}

export function createAdminSubGamesRouter(
  deps: AdminSubGamesRouterDeps
): express.Router {
  const { platformService, auditLogService, subGameService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-621] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/sub-games", async (req, res) => {
    try {
      await requirePermission(req, "SUB_GAME_READ");
      const status = parseOptionalStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 200);
      const gameTypeRaw = req.query.gameType ?? req.query.gameTypeId;
      const gameTypeId =
        gameTypeRaw !== undefined && gameTypeRaw !== null && gameTypeRaw !== ""
          ? mustBeNonEmptyString(gameTypeRaw, "gameType")
          : undefined;
      const subGames = await subGameService.list({
        status,
        limit,
        gameTypeId,
      });
      apiSuccess(res, {
        subGames: subGames.map(toWireShape),
        count: subGames.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/sub-games/:id", async (req, res) => {
    try {
      await requirePermission(req, "SUB_GAME_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const subGame = await subGameService.get(id);
      apiSuccess(res, toWireShape(subGame));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/sub-games", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SUB_GAME_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const input: CreateSubGameInput = {
        gameTypeId: mustBeNonEmptyString(body.gameTypeId, "gameTypeId"),
        name: mustBeNonEmptyString(body.name, "name"),
        createdBy: actor.id,
      };
      if (body.gameName !== undefined) {
        input.gameName = mustBeNonEmptyString(body.gameName, "gameName");
      }
      if (body.subGameNumber !== undefined) {
        input.subGameNumber = mustBeNonEmptyString(
          body.subGameNumber,
          "subGameNumber"
        );
      }
      const patternRows = parseOptionalPatternRows(body.patternRows, "patternRows");
      if (patternRows !== undefined) input.patternRows = patternRows;
      const ticketColors = parseOptionalStringArray(
        body.ticketColors,
        "ticketColors"
      );
      if (ticketColors !== undefined) input.ticketColors = ticketColors;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) input.status = status;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) input.extra = extra;

      const subGame = await subGameService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.sub_game.created",
        resource: "sub_game",
        resourceId: subGame.id,
        details: {
          gameTypeId: subGame.gameTypeId,
          name: subGame.name,
          subGameNumber: subGame.subGameNumber,
          status: subGame.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(subGame));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/sub-games/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SUB_GAME_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateSubGameInput = {};

      if (body.gameName !== undefined) {
        update.gameName = mustBeNonEmptyString(body.gameName, "gameName");
      }
      if (body.name !== undefined) {
        update.name = mustBeNonEmptyString(body.name, "name");
      }
      if (body.subGameNumber !== undefined) {
        update.subGameNumber = mustBeNonEmptyString(
          body.subGameNumber,
          "subGameNumber"
        );
      }
      const patternRows = parseOptionalPatternRows(body.patternRows, "patternRows");
      if (patternRows !== undefined) update.patternRows = patternRows;
      const ticketColors = parseOptionalStringArray(
        body.ticketColors,
        "ticketColors"
      );
      if (ticketColors !== undefined) update.ticketColors = ticketColors;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) update.status = status;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) update.extra = extra;

      const subGame = await subGameService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.sub_game.updated",
        resource: "sub_game",
        resourceId: subGame.id,
        details: {
          gameTypeId: subGame.gameTypeId,
          name: subGame.name,
          changed: Object.keys(update),
          status: subGame.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(subGame));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/sub-games/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SUB_GAME_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await subGameService.get(id);
      const result = await subGameService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.sub_game.soft_deleted"
          : "admin.sub_game.deleted",
        resource: "sub_game",
        resourceId: id,
        details: {
          gameTypeId: existing.gameTypeId,
          name: existing.name,
          subGameNumber: existing.subGameNumber,
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
