/**
 * BIN-587 B4b: voucher admin-router.
 *
 * Endepunkter:
 *   GET    /api/admin/vouchers
 *   POST   /api/admin/vouchers
 *   GET    /api/admin/vouchers/:id
 *   PUT    /api/admin/vouchers/:id
 *   DELETE /api/admin/vouchers/:id  (soft-delete hvis brukt, hard ellers)
 *
 * Redemption-flow (player-side i G2/G3) er follow-up.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { VoucherService, VoucherType } from "../compliance/VoucherService.js";
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

const logger = rootLogger.child({ module: "admin-vouchers" });

export interface AdminVouchersRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  voucherService: VoucherService;
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

function actorTypeFromRole(role: PublicAppUser["role"]): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

export function createAdminVouchersRouter(deps: AdminVouchersRouterDeps): express.Router {
  const { platformService, auditLogService, voucherService } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-587 B4b] audit append failed");
    });
  }

  router.get("/api/admin/vouchers", async (req, res) => {
    try {
      await requirePermission(req, "VOUCHER_READ");
      const isActiveRaw =
        typeof req.query.isActive === "string" ? req.query.isActive.trim().toLowerCase() : undefined;
      const isActive =
        isActiveRaw === "true" ? true : isActiveRaw === "false" ? false : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const vouchers = await voucherService.list({ isActive, limit });
      apiSuccess(res, { vouchers, count: vouchers.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/vouchers", async (req, res) => {
    try {
      const actor = await requirePermission(req, "VOUCHER_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const code = mustBeNonEmptyString(req.body.code, "code");
      const type = mustBeNonEmptyString(req.body.type, "type");
      if (req.body.value === undefined || req.body.value === null) {
        throw new DomainError("INVALID_INPUT", "value er påkrevd.");
      }
      const voucher = await voucherService.create({
        code,
        type: type as VoucherType,
        value: Number(req.body.value),
        maxUses: req.body.maxUses === undefined ? null : (req.body.maxUses as number | null),
        validFrom: typeof req.body.validFrom === "string" ? req.body.validFrom : null,
        validTo: typeof req.body.validTo === "string" ? req.body.validTo : null,
        isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
        description: typeof req.body.description === "string" ? req.body.description : null,
        createdBy: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "voucher.create",
        resource: "voucher",
        resourceId: voucher.id,
        details: {
          code: voucher.code,
          type: voucher.type,
          value: voucher.value,
          maxUses: voucher.maxUses,
          validFrom: voucher.validFrom,
          validTo: voucher.validTo,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, voucher);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/vouchers/:id", async (req, res) => {
    try {
      await requirePermission(req, "VOUCHER_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const voucher = await voucherService.get(id);
      apiSuccess(res, voucher);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/vouchers/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "VOUCHER_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const update: Parameters<VoucherService["update"]>[1] = {};
      if (req.body.value !== undefined) update.value = Number(req.body.value);
      if (req.body.maxUses !== undefined) update.maxUses = req.body.maxUses as number | null;
      if (req.body.validFrom !== undefined) update.validFrom = req.body.validFrom as string | null;
      if (req.body.validTo !== undefined) update.validTo = req.body.validTo as string | null;
      if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);
      if (req.body.description !== undefined) update.description = req.body.description as string | null;
      const voucher = await voucherService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "voucher.update",
        resource: "voucher",
        resourceId: voucher.id,
        details: { changed: Object.keys(update), code: voucher.code },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, voucher);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/vouchers/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "VOUCHER_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await voucherService.get(id);
      const result = await voucherService.remove(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted ? "voucher.soft_delete" : "voucher.delete",
        resource: "voucher",
        resourceId: id,
        details: {
          code: existing.code,
          softDeleted: result.softDeleted,
          usesCount: existing.usesCount,
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
