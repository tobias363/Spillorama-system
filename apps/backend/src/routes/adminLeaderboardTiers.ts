/**
 * BIN-668: admin-router for LeaderboardTier CRUD.
 *
 * Endepunkter:
 *   GET    /api/admin/leaderboard/tiers
 *   GET    /api/admin/leaderboard/tiers/:id
 *   POST   /api/admin/leaderboard/tiers
 *   PATCH  /api/admin/leaderboard/tiers/:id
 *   DELETE /api/admin/leaderboard/tiers/:id
 *
 * Rolle-krav: LEADERBOARD_TIER_READ for GETs, LEADERBOARD_TIER_WRITE
 * (ADMIN-only) for POST/PATCH/DELETE (se AdminAccessPolicy.ts).
 *
 * Svar-formatet matcher `LeaderboardTierRow` i shared-types/schemas.ts.
 *
 * Audit: create/update/delete skriver til AuditLogService (fire-and-forget,
 * samme mønster som BIN-620/622/626/627/665).
 *
 * Avgrensning: dette er KONFIGURASJON. Runtime /api/leaderboard
 * (apps/backend/src/routes/game.ts) aggregerer prize-points fra faktiske
 * wins og er uavhengig.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  LeaderboardTierService,
  LeaderboardTier,
  CreateLeaderboardTierInput,
  UpdateLeaderboardTierInput,
} from "../admin/LeaderboardTierService.js";
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

const logger = rootLogger.child({ module: "admin-leaderboard-tiers" });

export interface AdminLeaderboardTiersRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  leaderboardTierService: LeaderboardTierService;
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

function parseOptionalNumberOrNull(
  value: unknown,
  field: string
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et tall eller null.`
    );
  }
  return n;
}

function parseOptionalString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  return value;
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
 * Trim ned internt `LeaderboardTier`-objekt til wire-shape som matcher
 * `LeaderboardTierRow` i shared-types (ingen deletedAt eksponert).
 */
function toWireShape(t: LeaderboardTier): Omit<LeaderboardTier, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = t;
  return rest;
}

export function createAdminLeaderboardTiersRouter(
  deps: AdminLeaderboardTiersRouterDeps
): express.Router {
  const { platformService, auditLogService, leaderboardTierService } = deps;
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
      logger.warn(
        { err, action: event.action },
        "[BIN-668] audit append failed"
      );
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/leaderboard/tiers", async (req, res) => {
    try {
      await requirePermission(req, "LEADERBOARD_TIER_READ");
      const tierNameRaw = req.query.tierName;
      const tierName =
        typeof tierNameRaw === "string" && tierNameRaw.trim()
          ? tierNameRaw.trim()
          : undefined;
      const active = parseOptionalBool(req.query.active, "active");
      const limit = parseLimit(req.query.limit, 200);
      const tiers = await leaderboardTierService.list({
        tierName,
        active,
        limit,
      });
      apiSuccess(res, {
        tiers: tiers.map(toWireShape),
        count: tiers.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/leaderboard/tiers/:id", async (req, res) => {
    try {
      await requirePermission(req, "LEADERBOARD_TIER_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const tier = await leaderboardTierService.get(id);
      apiSuccess(res, toWireShape(tier));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/leaderboard/tiers", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LEADERBOARD_TIER_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const placeRaw = parseOptionalInt(body.place, "place");
      if (placeRaw === undefined) {
        throw new DomainError("INVALID_INPUT", "place er påkrevd.");
      }
      const input: CreateLeaderboardTierInput = {
        place: placeRaw,
        createdByUserId: actor.id,
      };
      if (body.tierName !== undefined) {
        input.tierName = mustBeNonEmptyString(body.tierName, "tierName");
      }
      const points = parseOptionalInt(body.points, "points");
      if (points !== undefined) input.points = points;
      const prizeAmount = parseOptionalNumberOrNull(
        body.prizeAmount,
        "prizeAmount"
      );
      if (prizeAmount !== undefined) input.prizeAmount = prizeAmount;
      const prizeDescription = parseOptionalString(
        body.prizeDescription,
        "prizeDescription"
      );
      if (prizeDescription !== undefined) {
        input.prizeDescription = prizeDescription;
      }
      const active = parseOptionalBool(body.active, "active");
      if (active !== undefined) input.active = active;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) input.extra = extra;

      const tier = await leaderboardTierService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.leaderboard.tier.create",
        resource: "leaderboard_tier",
        resourceId: tier.id,
        details: {
          tierName: tier.tierName,
          place: tier.place,
          points: tier.points,
          prizeAmount: tier.prizeAmount,
          active: tier.active,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(tier));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/leaderboard/tiers/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LEADERBOARD_TIER_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateLeaderboardTierInput = {};

      if (body.tierName !== undefined) {
        update.tierName = mustBeNonEmptyString(body.tierName, "tierName");
      }
      const place = parseOptionalInt(body.place, "place");
      if (place !== undefined) update.place = place;
      const points = parseOptionalInt(body.points, "points");
      if (points !== undefined) update.points = points;
      const prizeAmount = parseOptionalNumberOrNull(
        body.prizeAmount,
        "prizeAmount"
      );
      if (prizeAmount !== undefined) update.prizeAmount = prizeAmount;
      const prizeDescription = parseOptionalString(
        body.prizeDescription,
        "prizeDescription"
      );
      if (prizeDescription !== undefined) {
        update.prizeDescription = prizeDescription;
      }
      const active = parseOptionalBool(body.active, "active");
      if (active !== undefined) update.active = active;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) update.extra = extra;

      const tier = await leaderboardTierService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.leaderboard.tier.update",
        resource: "leaderboard_tier",
        resourceId: tier.id,
        details: {
          tierName: tier.tierName,
          place: tier.place,
          changed: Object.keys(update),
          active: tier.active,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(tier));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/leaderboard/tiers/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LEADERBOARD_TIER_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" &&
        hardRaw.trim().toLowerCase() === "true";
      const existing = await leaderboardTierService.get(id);
      const result = await leaderboardTierService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.leaderboard.tier.delete",
        resource: "leaderboard_tier",
        resourceId: id,
        details: {
          tierName: existing.tierName,
          place: existing.place,
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
