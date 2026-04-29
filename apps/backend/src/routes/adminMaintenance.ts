/**
 * BIN-677: admin-router for maintenance-vinduer.
 *
 * Endepunkter:
 *   GET  /api/admin/maintenance        — liste (+ currently-active short-ref)
 *   GET  /api/admin/maintenance/:id    — detalj
 *   POST /api/admin/maintenance        — opprett nytt vindu
 *   PUT  /api/admin/maintenance/:id    — aktiver/deaktiver + full update
 *
 * Rolle-krav: MAINTENANCE_READ for GETs, MAINTENANCE_WRITE (ADMIN-only)
 * for POST/PUT.
 *
 * Audit-hendelser:
 *   admin.maintenance.create
 *   admin.maintenance.activate    (status endret til 'active')
 *   admin.maintenance.deactivate  (status endret til 'inactive')
 *   admin.maintenance.update      (andre felter endret uten status-skift)
 *
 * PUT-body kan være:
 *   { "status": "active" }      (convenience toggle)
 *   { "status": "active", "message": "Kort pause 15:00-16:00" }
 *   { "maintenanceStart": "...", "maintenanceEnd": "..." }
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  MaintenanceService,
  MaintenanceWindow,
  CreateMaintenanceInput,
  UpdateMaintenanceInput,
  MaintenanceStatus,
} from "../admin/MaintenanceService.js";
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

const logger = rootLogger.child({ module: "admin-maintenance" });

export interface AdminMaintenanceRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  maintenanceService: MaintenanceService;
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

function parseOptionalStatus(value: unknown): MaintenanceStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "active" || value === "inactive") return value;
  throw new DomainError(
    "INVALID_INPUT",
    "status må være 'active' eller 'inactive'."
  );
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  return value;
}

function parseOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et heltall.`);
  }
  return n;
}

export function createAdminMaintenanceRouter(
  deps: AdminMaintenanceRouterDeps
): express.Router {
  const { platformService, auditLogService, maintenanceService } = deps;
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
        "[BIN-677] audit append failed"
      );
    });
  }

  function toWireShape(w: MaintenanceWindow): MaintenanceWindow {
    return w;
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/maintenance", async (req, res) => {
    try {
      await requirePermission(req, "MAINTENANCE_READ");
      const status = parseOptionalStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 100);
      const filter: { status?: MaintenanceStatus; limit?: number } = { limit };
      if (status !== undefined) filter.status = status;
      const [windows, active] = await Promise.all([
        maintenanceService.list(filter),
        maintenanceService.getActive(),
      ]);
      apiSuccess(res, {
        windows: windows.map(toWireShape),
        count: windows.length,
        active: active ? toWireShape(active) : null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/maintenance/:id", async (req, res) => {
    try {
      await requirePermission(req, "MAINTENANCE_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const window = await maintenanceService.get(id);
      apiSuccess(res, toWireShape(window));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/maintenance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MAINTENANCE_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      if (typeof body.maintenanceStart !== "string" || !body.maintenanceStart.trim()) {
        throw new DomainError("INVALID_INPUT", "maintenanceStart er påkrevd.");
      }
      if (typeof body.maintenanceEnd !== "string" || !body.maintenanceEnd.trim()) {
        throw new DomainError("INVALID_INPUT", "maintenanceEnd er påkrevd.");
      }
      const input: CreateMaintenanceInput = {
        maintenanceStart: body.maintenanceStart,
        maintenanceEnd: body.maintenanceEnd,
        createdByUserId: actor.id,
      };
      const message = parseOptionalString(body.message, "message");
      if (message !== undefined) input.message = message;
      const showBefore = parseOptionalInt(
        body.showBeforeMinutes,
        "showBeforeMinutes"
      );
      if (showBefore !== undefined) input.showBeforeMinutes = showBefore;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) input.status = status;

      const window = await maintenanceService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.maintenance.create",
        resource: "maintenance_window",
        resourceId: window.id,
        details: {
          maintenanceStart: window.maintenanceStart,
          maintenanceEnd: window.maintenanceEnd,
          status: window.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      if (window.status === "active") {
        // Create som starter i active-modus teller også som activate-hendelse
        // (synlighet i audit-konsoll).
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.maintenance.activate",
          resource: "maintenance_window",
          resourceId: window.id,
          details: { viaCreate: true },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiSuccess(res, toWireShape(window));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: put (aktiver/deaktiver + full update) ────────────────────

  router.put("/api/admin/maintenance/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MAINTENANCE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const existing = await maintenanceService.get(id);

      const update: UpdateMaintenanceInput = {};
      if (typeof body.maintenanceStart === "string" && body.maintenanceStart.trim()) {
        update.maintenanceStart = body.maintenanceStart;
      }
      if (typeof body.maintenanceEnd === "string" && body.maintenanceEnd.trim()) {
        update.maintenanceEnd = body.maintenanceEnd;
      }
      const message = parseOptionalString(body.message, "message");
      if (message !== undefined) update.message = message;
      const showBefore = parseOptionalInt(
        body.showBeforeMinutes,
        "showBeforeMinutes"
      );
      if (showBefore !== undefined) update.showBeforeMinutes = showBefore;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) update.status = status;

      const window = await maintenanceService.update(id, update);

      const statusChanged = status !== undefined && status !== existing.status;
      if (statusChanged && window.status === "active") {
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.maintenance.activate",
          resource: "maintenance_window",
          resourceId: window.id,
          details: {
            maintenanceStart: window.maintenanceStart,
            maintenanceEnd: window.maintenanceEnd,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      } else if (statusChanged && window.status === "inactive") {
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.maintenance.deactivate",
          resource: "maintenance_window",
          resourceId: window.id,
          details: {},
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      } else {
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.maintenance.update",
          resource: "maintenance_window",
          resourceId: window.id,
          details: { changed: Object.keys(update) },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiSuccess(res, toWireShape(window));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
