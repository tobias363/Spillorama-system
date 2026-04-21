/**
 * BIN-700: admin-router for Loyalty CRUD + player-state + points-award.
 *
 * Endepunkter:
 *   GET    /api/admin/loyalty/tiers                     → list
 *   GET    /api/admin/loyalty/tiers/:id                 → detail
 *   POST   /api/admin/loyalty/tiers                     → create
 *   PATCH  /api/admin/loyalty/tiers/:id                 → update
 *   DELETE /api/admin/loyalty/tiers/:id[?hard=true]     → soft/hard delete
 *   GET    /api/admin/loyalty/players                   → list player-states
 *   GET    /api/admin/loyalty/players/:userId           → player-state + events
 *   POST   /api/admin/loyalty/players/:userId/award     → points-award
 *   PATCH  /api/admin/loyalty/players/:userId/tier      → manual tier override
 *
 * Rolle-krav: LOYALTY_READ for GETs, LOYALTY_WRITE (ADMIN-only) for POST/
 * PATCH/DELETE (se AdminAccessPolicy.ts).
 *
 * Audit: create/update/delete tier + award + tier-override skriver til
 * AuditLogService (fire-and-forget, samme mønster som BIN-668).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  LoyaltyService,
  LoyaltyTier,
  CreateLoyaltyTierInput,
  UpdateLoyaltyTierInput,
} from "../compliance/LoyaltyService.js";
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

const logger = rootLogger.child({ module: "admin-loyalty" });

export interface AdminLoyaltyRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  loyaltyService: LoyaltyService;
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

function parseOptionalIntOrNull(
  value: unknown,
  field: string
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et heltall eller null.`
    );
  }
  return n;
}

function parseOptionalObject(value: unknown, field: string):
  | Record<string, unknown>
  | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  return value as Record<string, unknown>;
}

/** Wire-shape for tier (dropper deletedAt). */
function toTierWireShape(t: LoyaltyTier): Omit<LoyaltyTier, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = t;
  return rest;
}

export function createAdminLoyaltyRouter(
  deps: AdminLoyaltyRouterDeps
): express.Router {
  const { platformService, auditLogService, loyaltyService } = deps;
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
        "[BIN-700] audit append failed"
      );
    });
  }

  // ── Tier CRUD ─────────────────────────────────────────────────────────────

  router.get("/api/admin/loyalty/tiers", async (req, res) => {
    try {
      await requirePermission(req, "LOYALTY_READ");
      const active = parseOptionalBool(req.query.active, "active");
      const limit = parseLimit(req.query.limit, 200);
      const tiers = await loyaltyService.listTiers({ active, limit });
      apiSuccess(res, {
        tiers: tiers.map(toTierWireShape),
        count: tiers.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/loyalty/tiers/:id", async (req, res) => {
    try {
      await requirePermission(req, "LOYALTY_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const tier = await loyaltyService.getTier(id);
      apiSuccess(res, toTierWireShape(tier));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/loyalty/tiers", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LOYALTY_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const name = mustBeNonEmptyString(body.name, "name");
      const rank = parseOptionalInt(body.rank, "rank");
      if (rank === undefined) {
        throw new DomainError("INVALID_INPUT", "rank er påkrevd.");
      }
      const input: CreateLoyaltyTierInput = {
        name,
        rank,
        createdByUserId: actor.id,
      };
      const minPoints = parseOptionalInt(body.minPoints, "minPoints");
      if (minPoints !== undefined) input.minPoints = minPoints;
      const maxPoints = parseOptionalIntOrNull(body.maxPoints, "maxPoints");
      if (maxPoints !== undefined) input.maxPoints = maxPoints;
      const benefits = parseOptionalObject(body.benefits, "benefits");
      if (benefits !== undefined) input.benefits = benefits;
      const active = parseOptionalBool(body.active, "active");
      if (active !== undefined) input.active = active;

      const tier = await loyaltyService.createTier(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.loyalty.tier.create",
        resource: "loyalty_tier",
        resourceId: tier.id,
        details: {
          name: tier.name,
          rank: tier.rank,
          minPoints: tier.minPoints,
          maxPoints: tier.maxPoints,
          active: tier.active,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toTierWireShape(tier));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.patch("/api/admin/loyalty/tiers/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LOYALTY_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateLoyaltyTierInput = {};

      if (body.name !== undefined) {
        update.name = mustBeNonEmptyString(body.name, "name");
      }
      const rank = parseOptionalInt(body.rank, "rank");
      if (rank !== undefined) update.rank = rank;
      const minPoints = parseOptionalInt(body.minPoints, "minPoints");
      if (minPoints !== undefined) update.minPoints = minPoints;
      const maxPoints = parseOptionalIntOrNull(body.maxPoints, "maxPoints");
      if (maxPoints !== undefined) update.maxPoints = maxPoints;
      const benefits = parseOptionalObject(body.benefits, "benefits");
      if (benefits !== undefined) update.benefits = benefits;
      const active = parseOptionalBool(body.active, "active");
      if (active !== undefined) update.active = active;

      const tier = await loyaltyService.updateTier(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.loyalty.tier.update",
        resource: "loyalty_tier",
        resourceId: tier.id,
        details: {
          name: tier.name,
          rank: tier.rank,
          changed: Object.keys(update),
          active: tier.active,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toTierWireShape(tier));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/loyalty/tiers/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LOYALTY_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await loyaltyService.getTier(id);
      const result = await loyaltyService.removeTier(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.loyalty.tier.delete",
        resource: "loyalty_tier",
        resourceId: id,
        details: {
          name: existing.name,
          rank: existing.rank,
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

  // ── Player-state ──────────────────────────────────────────────────────────

  router.get("/api/admin/loyalty/players", async (req, res) => {
    try {
      await requirePermission(req, "LOYALTY_READ");
      const tierIdRaw = req.query.tierId;
      const tierId =
        typeof tierIdRaw === "string" && tierIdRaw.trim()
          ? tierIdRaw.trim()
          : undefined;
      const limit = parseLimit(req.query.limit, 50);
      const offsetRaw = parseOptionalInt(req.query.offset, "offset");
      const offset = offsetRaw !== undefined && offsetRaw >= 0 ? offsetRaw : 0;
      const result = await loyaltyService.listPlayerStates({
        tierId,
        limit,
        offset,
      });
      apiSuccess(res, {
        players: result.players,
        total: result.total,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/loyalty/players/:userId", async (req, res) => {
    try {
      await requirePermission(req, "LOYALTY_READ");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      const state = await loyaltyService.getPlayerState(userId);
      const events = await loyaltyService.listPlayerEvents(userId, 50);
      apiSuccess(res, { state, events });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/loyalty/players/:userId/award", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LOYALTY_WRITE");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const pointsDelta = parseOptionalInt(body.pointsDelta, "pointsDelta");
      if (pointsDelta === undefined) {
        throw new DomainError("INVALID_INPUT", "pointsDelta er påkrevd.");
      }
      const reason = mustBeNonEmptyString(body.reason, "reason");
      const metadata = parseOptionalObject(body.metadata, "metadata");

      const result = await loyaltyService.awardPoints({
        userId,
        pointsDelta,
        reason,
        metadata,
        createdByUserId: actor.id,
      });

      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.loyalty.points.award",
        resource: "loyalty_player_state",
        resourceId: userId,
        details: {
          pointsDelta,
          reason,
          lifetimePoints: result.state.lifetimePoints,
          monthPoints: result.state.monthPoints,
          tierChanged: result.tierChanged,
          currentTierId: result.state.currentTier?.id ?? null,
          eventId: result.event.id,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, {
        state: result.state,
        event: result.event,
        tierChanged: result.tierChanged,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.patch("/api/admin/loyalty/players/:userId/tier", async (req, res) => {
    try {
      const actor = await requirePermission(req, "LOYALTY_WRITE");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const tierIdRaw = body.tierId;
      let tierId: string | null;
      if (tierIdRaw === null) {
        tierId = null;
      } else {
        tierId = mustBeNonEmptyString(tierIdRaw, "tierId");
      }
      const reason = mustBeNonEmptyString(body.reason, "reason");

      const state = await loyaltyService.overrideTier({
        userId,
        tierId,
        reason,
        createdByUserId: actor.id,
      });

      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.loyalty.tier.override",
        resource: "loyalty_player_state",
        resourceId: userId,
        details: {
          tierId,
          reason,
          currentTierId: state.currentTier?.id ?? null,
          tierLocked: state.tierLocked,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, state);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
