/**
 * BIN-665: admin-router for HallGroup CRUD.
 *
 * Endepunkter:
 *   GET    /api/admin/hall-groups
 *   GET    /api/admin/hall-groups/:id
 *   POST   /api/admin/hall-groups
 *   PATCH  /api/admin/hall-groups/:id
 *   DELETE /api/admin/hall-groups/:id
 *
 * Rolle-krav: HALL_GROUP_READ for GETs, HALL_GROUP_WRITE for resten
 * (se apps/backend/src/platform/AdminAccessPolicy.ts).
 *
 * Svar-formatet matcher `HallGroupRowSchema` i packages/shared-types —
 * admin-web PR-A5 kan bytte til dette uten hack-konverteringer.
 *
 * Audit: create/update/delete skriver til AuditLogService (fire-and-forget,
 * samme mønster som BIN-627 adminPatterns.ts).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  HallGroupService,
  HallGroup,
  HallGroupStatus,
  CreateHallGroupInput,
  UpdateHallGroupInput,
} from "../admin/HallGroupService.js";
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

const logger = rootLogger.child({ module: "admin-hall-groups" });

export interface AdminHallGroupsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  hallGroupService: HallGroupService;
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

function parseOptionalStatus(value: unknown): HallGroupStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as HallGroupStatus;
  if (v !== "active" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, inactive."
    );
  }
  return v;
}

function parseOptionalTvId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "tvId må være et ikke-negativt heltall eller null."
    );
  }
  return n;
}

function parseOptionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en liste.`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field} må være en liste av ikke-tomme strenger.`
      );
    }
    result.push(item.trim());
  }
  return result;
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
 * Trim ned internt `HallGroup`-objekt til wire-shape som matcher
 * `HallGroupRowSchema` i shared-types (ingen deletedAt eksponert).
 */
function toWireShape(g: HallGroup): Omit<HallGroup, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = g;
  return rest;
}

export function createAdminHallGroupsRouter(
  deps: AdminHallGroupsRouterDeps
): express.Router {
  const { platformService, auditLogService, hallGroupService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-665] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/hall-groups", async (req, res) => {
    try {
      await requirePermission(req, "HALL_GROUP_READ");
      const status = parseOptionalStatus(req.query.status);
      const hallId =
        typeof req.query.hallId === "string" && req.query.hallId.trim()
          ? req.query.hallId.trim()
          : undefined;
      const limit = parseLimit(req.query.limit, 200);
      const groups = await hallGroupService.list({ status, hallId, limit });
      apiSuccess(res, {
        groups: groups.map(toWireShape),
        count: groups.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/hall-groups/:id", async (req, res) => {
    try {
      await requirePermission(req, "HALL_GROUP_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const group = await hallGroupService.get(id);
      apiSuccess(res, toWireShape(group));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/hall-groups", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_GROUP_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const input: CreateHallGroupInput = {
        name: mustBeNonEmptyString(body.name, "name"),
        createdBy: actor.id,
      };
      const hallIds = parseOptionalStringArray(body.hallIds, "hallIds");
      if (hallIds !== undefined) input.hallIds = hallIds;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) input.status = status;
      const tvId = parseOptionalTvId(body.tvId);
      if (tvId !== undefined) input.tvId = tvId;
      const productIds = parseOptionalStringArray(body.productIds, "productIds");
      if (productIds !== undefined) input.productIds = productIds;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) input.extra = extra;
      if (body.legacyGroupHallId !== undefined) {
        input.legacyGroupHallId =
          typeof body.legacyGroupHallId === "string"
            ? body.legacyGroupHallId
            : null;
      }

      const group = await hallGroupService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.hall_group.created",
        resource: "hall_group",
        resourceId: group.id,
        details: {
          name: group.name,
          status: group.status,
          memberCount: group.members.length,
          hallIds: group.members.map((m) => m.hallId),
          tvId: group.tvId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(group));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/hall-groups/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_GROUP_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateHallGroupInput = {};

      if (body.name !== undefined) {
        if (typeof body.name !== "string") {
          throw new DomainError("INVALID_INPUT", "name må være en streng.");
        }
        update.name = body.name;
      }
      const hallIds = parseOptionalStringArray(body.hallIds, "hallIds");
      if (hallIds !== undefined) update.hallIds = hallIds;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) update.status = status;
      const tvId = parseOptionalTvId(body.tvId);
      if (tvId !== undefined) update.tvId = tvId;
      const productIds = parseOptionalStringArray(body.productIds, "productIds");
      if (productIds !== undefined) update.productIds = productIds;
      const extra = parseOptionalExtra(body.extra);
      if (extra !== undefined) update.extra = extra;

      const before = await hallGroupService.get(id);
      const group = await hallGroupService.update(id, update);
      const membersChanged = hallIds !== undefined;
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: membersChanged
          ? "admin.hall_group.members_changed"
          : "admin.hall_group.updated",
        resource: "hall_group",
        resourceId: group.id,
        details: {
          name: group.name,
          changed: Object.keys(update),
          memberCount: group.members.length,
          hallIds: group.members.map((m) => m.hallId),
          previousMemberCount: before.members.length,
          previousHallIds: before.members.map((m) => m.hallId),
          status: group.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(group));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/hall-groups/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_GROUP_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await hallGroupService.get(id);
      const result = await hallGroupService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.hall_group.soft_deleted"
          : "admin.hall_group.deleted",
        resource: "hall_group",
        resourceId: id,
        details: {
          name: existing.name,
          softDeleted: result.softDeleted,
          memberCount: existing.members.length,
          hallIds: existing.members.map((m) => m.hallId),
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
