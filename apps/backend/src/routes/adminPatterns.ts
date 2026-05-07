/**
 * BIN-627: admin-router for Pattern CRUD + dynamic-menu.
 *
 * Endepunkter (matches apps/admin-web/.../PatternState.ts-kontraktet):
 *   GET    /api/admin/patterns?gameTypeId=X
 *   GET    /api/admin/patterns/dynamic-menu?gameTypeId=X
 *   GET    /api/admin/patterns/:id
 *   POST   /api/admin/patterns
 *   PATCH  /api/admin/patterns/:id
 *   DELETE /api/admin/patterns/:id
 *
 * Rolle-krav: PATTERN_READ for GETs, PATTERN_WRITE for resten
 * (se apps/backend/src/platform/AdminAccessPolicy.ts).
 *
 * Svar-formatet matcher `PatternRow` i admin-web — typer er kanonisert i
 * packages/shared-types/src/schemas.ts (PatternRowSchema).
 *
 * Audit: create/update/delete skriver til AuditLogService (fire-and-forget
 * samme mønster som BIN-622 adminGameManagement.ts).
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  PatternService,
  Pattern,
  PatternStatus,
  PatternClaimType,
  CreatePatternInput,
  UpdatePatternInput,
} from "../admin/PatternService.js";
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

const logger = rootLogger.child({ module: "admin-patterns" });

export interface AdminPatternsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  patternService: PatternService;
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

function parseOptionalStatus(value: unknown): PatternStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as PatternStatus;
  if (v !== "active" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, inactive."
    );
  }
  return v;
}

function parseOptionalClaimType(value: unknown): PatternClaimType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "claimType må være en streng.");
  }
  const v = value.trim() as PatternClaimType;
  if (v !== "LINE" && v !== "BINGO") {
    throw new DomainError(
      "INVALID_INPUT",
      "claimType må være én av LINE, BINGO."
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

function parseOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et tall.`);
  }
  return n;
}

function parseOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et heltall.`);
  }
  return n;
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
 * Trim ned internt `Pattern`-objekt til wire-shape som matcher
 * `PatternRow` i admin-web (camelCase, ingen deletedAt eksponert).
 */
function toWireShape(p: Pattern): Omit<Pattern, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = p;
  return rest;
}

export function createAdminPatternsRouter(
  deps: AdminPatternsRouterDeps
): express.Router {
  const { platformService, auditLogService, patternService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-627] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/patterns", async (req, res) => {
    try {
      await requirePermission(req, "PATTERN_READ");
      const gameTypeId =
        typeof req.query.gameTypeId === "string" && req.query.gameTypeId.trim()
          ? req.query.gameTypeId.trim()
          : undefined;
      const status = parseOptionalStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 200);
      const patterns = await patternService.list({ gameTypeId, status, limit });
      apiSuccess(res, {
        patterns: patterns.map(toWireShape),
        count: patterns.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: dynamic-menu (ordnet per gameType) ────────────────────────

  router.get("/api/admin/patterns/dynamic-menu", async (req, res) => {
    try {
      await requirePermission(req, "PATTERN_READ");
      const gameTypeId =
        typeof req.query.gameTypeId === "string" && req.query.gameTypeId.trim()
          ? req.query.gameTypeId.trim()
          : undefined;
      const menu = await patternService.dynamicMenu(gameTypeId);
      apiSuccess(res, menu);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/patterns/:id", async (req, res) => {
    try {
      await requirePermission(req, "PATTERN_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const pattern = await patternService.get(id);
      apiSuccess(res, toWireShape(pattern));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/patterns", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PATTERN_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      if (body.mask === undefined || body.mask === null) {
        throw new DomainError("INVALID_INPUT", "mask er påkrevd.");
      }
      const maskNum = Number(body.mask);
      if (!Number.isFinite(maskNum) || !Number.isInteger(maskNum)) {
        throw new DomainError("INVALID_INPUT", "mask må være et heltall.");
      }
      const input: CreatePatternInput = {
        gameTypeId: mustBeNonEmptyString(body.gameTypeId, "gameTypeId"),
        name: mustBeNonEmptyString(body.name, "name"),
        mask: maskNum,
        createdBy: actor.id,
      };
      if (typeof body.gameName === "string" && body.gameName.trim()) {
        input.gameName = body.gameName.trim();
      }
      if (typeof body.patternNumber === "string" && body.patternNumber.trim()) {
        input.patternNumber = body.patternNumber.trim();
      }
      const claimType = parseOptionalClaimType(body.claimType);
      if (claimType !== undefined) input.claimType = claimType;
      const prizePercent = parseOptionalNumber(body.prizePercent, "prizePercent");
      if (prizePercent !== undefined) input.prizePercent = prizePercent;
      const orderIndex = parseOptionalInt(body.orderIndex, "orderIndex");
      if (orderIndex !== undefined) input.orderIndex = orderIndex;
      const design = parseOptionalInt(body.design, "design");
      if (design !== undefined) input.design = design;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) input.status = status;
      const rowPercentage = parseOptionalNumber(body.rowPercentage, "rowPercentage");
      if (rowPercentage !== undefined) input.rowPercentage = rowPercentage;

      const isWoF = parseOptionalBool(body.isWoF, "isWoF");
      if (isWoF !== undefined) input.isWoF = isWoF;
      const isTchest = parseOptionalBool(body.isTchest, "isTchest");
      if (isTchest !== undefined) input.isTchest = isTchest;
      const isMys = parseOptionalBool(body.isMys, "isMys");
      if (isMys !== undefined) input.isMys = isMys;
      const isRowPr = parseOptionalBool(body.isRowPr, "isRowPr");
      if (isRowPr !== undefined) input.isRowPr = isRowPr;
      const isJackpot = parseOptionalBool(body.isJackpot, "isJackpot");
      if (isJackpot !== undefined) input.isJackpot = isJackpot;
      const isGameTypeExtra = parseOptionalBool(body.isGameTypeExtra, "isGameTypeExtra");
      if (isGameTypeExtra !== undefined) input.isGameTypeExtra = isGameTypeExtra;
      const isLuckyBonus = parseOptionalBool(body.isLuckyBonus, "isLuckyBonus");
      if (isLuckyBonus !== undefined) input.isLuckyBonus = isLuckyBonus;

      if (body.patternPlace !== undefined) {
        input.patternPlace =
          typeof body.patternPlace === "string" ? body.patternPlace : null;
      }
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) input.extra = extra;

      const pattern = await patternService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.pattern.created",
        resource: "pattern",
        resourceId: pattern.id,
        details: {
          gameTypeId: pattern.gameTypeId,
          name: pattern.name,
          mask: pattern.mask,
          claimType: pattern.claimType,
          orderIndex: pattern.orderIndex,
          status: pattern.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(pattern));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/patterns/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PATTERN_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdatePatternInput = {};

      if (body.gameName !== undefined) {
        if (typeof body.gameName !== "string") {
          throw new DomainError("INVALID_INPUT", "gameName må være en streng.");
        }
        update.gameName = body.gameName;
      }
      if (body.patternNumber !== undefined) {
        if (typeof body.patternNumber !== "string") {
          throw new DomainError("INVALID_INPUT", "patternNumber må være en streng.");
        }
        update.patternNumber = body.patternNumber;
      }
      if (body.name !== undefined) {
        if (typeof body.name !== "string") {
          throw new DomainError("INVALID_INPUT", "name må være en streng.");
        }
        update.name = body.name;
      }
      if (body.mask !== undefined) {
        const maskNum = Number(body.mask);
        if (!Number.isFinite(maskNum) || !Number.isInteger(maskNum)) {
          throw new DomainError("INVALID_INPUT", "mask må være et heltall.");
        }
        update.mask = maskNum;
      }
      const claimType = parseOptionalClaimType(body.claimType);
      if (claimType !== undefined) update.claimType = claimType;
      const prizePercent = parseOptionalNumber(body.prizePercent, "prizePercent");
      if (prizePercent !== undefined) update.prizePercent = prizePercent;
      const orderIndex = parseOptionalInt(body.orderIndex, "orderIndex");
      if (orderIndex !== undefined) update.orderIndex = orderIndex;
      const design = parseOptionalInt(body.design, "design");
      if (design !== undefined) update.design = design;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) update.status = status;
      const rowPercentage = parseOptionalNumber(body.rowPercentage, "rowPercentage");
      if (rowPercentage !== undefined) update.rowPercentage = rowPercentage;

      const isWoF = parseOptionalBool(body.isWoF, "isWoF");
      if (isWoF !== undefined) update.isWoF = isWoF;
      const isTchest = parseOptionalBool(body.isTchest, "isTchest");
      if (isTchest !== undefined) update.isTchest = isTchest;
      const isMys = parseOptionalBool(body.isMys, "isMys");
      if (isMys !== undefined) update.isMys = isMys;
      const isRowPr = parseOptionalBool(body.isRowPr, "isRowPr");
      if (isRowPr !== undefined) update.isRowPr = isRowPr;
      const isJackpot = parseOptionalBool(body.isJackpot, "isJackpot");
      if (isJackpot !== undefined) update.isJackpot = isJackpot;
      const isGameTypeExtra = parseOptionalBool(body.isGameTypeExtra, "isGameTypeExtra");
      if (isGameTypeExtra !== undefined) update.isGameTypeExtra = isGameTypeExtra;
      const isLuckyBonus = parseOptionalBool(body.isLuckyBonus, "isLuckyBonus");
      if (isLuckyBonus !== undefined) update.isLuckyBonus = isLuckyBonus;

      if (body.patternPlace !== undefined) {
        update.patternPlace =
          typeof body.patternPlace === "string" ? body.patternPlace : null;
      }
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) update.extra = extra;

      const pattern = await patternService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.pattern.updated",
        resource: "pattern",
        resourceId: pattern.id,
        details: {
          gameTypeId: pattern.gameTypeId,
          changed: Object.keys(update),
          mask: pattern.mask,
          status: pattern.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(pattern));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/patterns/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PATTERN_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await patternService.get(id);
      const result = await patternService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.pattern.soft_deleted"
          : "admin.pattern.deleted",
        resource: "pattern",
        resourceId: id,
        details: {
          gameTypeId: existing.gameTypeId,
          name: existing.name,
          softDeleted: result.softDeleted,
          mask: existing.mask,
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
