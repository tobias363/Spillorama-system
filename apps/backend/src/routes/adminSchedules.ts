/**
 * BIN-625: admin-router for Schedule CRUD (gjenbrukbare spill-maler).
 *
 * Endepunkter (matches PR-A3 admin-UI /schedules-sidene):
 *   GET    /api/admin/schedules            (list + filter)
 *   POST   /api/admin/schedules            (opprett mal)
 *   PATCH  /api/admin/schedules/:id        (oppdatér mal)
 *   DELETE /api/admin/schedules/:id        (soft-delete default; ?hard=true på inaktiv)
 *
 * Bonus GET /:id er inkludert fordi admin-UI trenger detail-hydration for
 * edit-siden. Ikke telt i 4-endepunkts-scoppet men minimerer round-trips.
 *
 * Rolle-krav: SCHEDULE_READ for GETs, SCHEDULE_WRITE for resten
 * (se apps/backend/src/platform/AdminAccessPolicy.ts). Schedule-maler er
 * ikke hall-scope-bundet — de er globale oppskrifter. Agent-rolle kan
 * opprette egne maler (legacy-flyt); list-endepunktet filtrerer per
 * createdBy hvis caller er AGENT og ingen explicit createdBy er gitt.
 *
 * AuditLog: admin.schedule.create / admin.schedule.update /
 * admin.schedule.delete — samme mønster som BIN-626 DailySchedule.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  ScheduleService,
  Schedule,
  ScheduleStatus,
  ScheduleType,
  ScheduleSubgame,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListScheduleFilter,
} from "../admin/ScheduleService.js";
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

const logger = rootLogger.child({ module: "admin-schedules" });

export interface AdminSchedulesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  scheduleService: ScheduleService;
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

function parseOptionalType(value: unknown): ScheduleType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "scheduleType må være en streng.");
  }
  const v = value.trim() as ScheduleType;
  if (v !== "Auto" && v !== "Manual") {
    throw new DomainError(
      "INVALID_INPUT",
      "scheduleType må være én av Auto, Manual."
    );
  }
  return v;
}

function parseOptionalStatus(value: unknown): ScheduleStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as ScheduleStatus;
  if (v !== "active" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, inactive."
    );
  }
  return v;
}

function parseOptionalSubgames(value: unknown): ScheduleSubgame[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "subGames må være en array.");
  }
  return value as ScheduleSubgame[];
}

/** Trim ned internt Schedule-objekt til wire-shape (ingen deletedAt). */
function toWireShape(row: Schedule): Omit<Schedule, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = row;
  return rest;
}

export function createAdminSchedulesRouter(
  deps: AdminSchedulesRouterDeps
): express.Router {
  const { platformService, auditLogService, scheduleService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-625] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/schedules", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_READ");
      const scheduleType = parseOptionalType(req.query.type ?? req.query.scheduleType);
      const status = parseOptionalStatus(req.query.status);
      const search =
        typeof req.query.search === "string" && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const explicitCreatedBy =
        typeof req.query.createdBy === "string" && req.query.createdBy.trim()
          ? req.query.createdBy.trim()
          : undefined;

      // Legacy-flyt: AGENT-rolle ser egne + admin-opprettede maler.
      // ADMIN/SUPPORT/HALL_OPERATOR ser alle (ingen created_by-filter).
      // Explicit createdBy-filter fra query respekteres når rolle tillater.
      // (AGENT har ikke SCHEDULE_READ i policy-en, men vi behandler rollen
      // defensivt her hvis policy-en utvides senere.)
      let createdBy: string | undefined;
      if (actor.role === "AGENT") {
        createdBy = explicitCreatedBy ?? actor.id;
      } else {
        createdBy = explicitCreatedBy;
      }

      const filter: ListScheduleFilter = {
        scheduleType,
        status,
        search,
        createdBy,
        includeAdminForOwner: createdBy ? true : undefined,
        limit,
      };
      const rows = await scheduleService.list(filter);
      apiSuccess(res, {
        schedules: rows.map(toWireShape),
        count: rows.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/schedules/:id", async (req, res) => {
    try {
      await requirePermission(req, "SCHEDULE_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const row = await scheduleService.get(id);
      apiSuccess(res, toWireShape(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/schedules", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const input: CreateScheduleInput = {
        scheduleName: mustBeNonEmptyString(req.body.scheduleName, "scheduleName"),
        createdBy: actor.id,
        // Legacy-semantikk: agent-opprettede maler er ikke admin-maler.
        isAdminSchedule: actor.role === "ADMIN" || actor.role === "HALL_OPERATOR",
      };
      if (req.body.scheduleType !== undefined) {
        input.scheduleType = parseOptionalType(req.body.scheduleType);
      }
      if (req.body.scheduleNumber !== undefined) {
        input.scheduleNumber =
          typeof req.body.scheduleNumber === "string"
            ? req.body.scheduleNumber
            : undefined;
      }
      if (req.body.luckyNumberPrize !== undefined) {
        input.luckyNumberPrize = Number(req.body.luckyNumberPrize);
      }
      if (req.body.status !== undefined) {
        input.status = parseOptionalStatus(req.body.status);
      }
      if (req.body.manualStartTime !== undefined) {
        input.manualStartTime =
          typeof req.body.manualStartTime === "string"
            ? req.body.manualStartTime
            : "";
      }
      if (req.body.manualEndTime !== undefined) {
        input.manualEndTime =
          typeof req.body.manualEndTime === "string" ? req.body.manualEndTime : "";
      }
      if (req.body.subGames !== undefined) {
        input.subGames = parseOptionalSubgames(req.body.subGames);
      }
      // Tillat eksplisitt isAdminSchedule-override for ADMIN (support-tooling).
      if (req.body.isAdminSchedule !== undefined && actor.role === "ADMIN") {
        input.isAdminSchedule = Boolean(req.body.isAdminSchedule);
      }

      const row = await scheduleService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.schedule.create",
        resource: "schedule",
        resourceId: row.id,
        details: {
          scheduleName: row.scheduleName,
          scheduleNumber: row.scheduleNumber,
          scheduleType: row.scheduleType,
          status: row.status,
          isAdminSchedule: row.isAdminSchedule,
          subGamesCount: row.subGames.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/schedules/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      // Eksisterer + eier-sjekk for AGENT-rolle.
      const existing = await scheduleService.get(id);
      if (actor.role === "AGENT" && existing.createdBy !== actor.id) {
        throw new DomainError(
          "FORBIDDEN",
          "Du kan kun endre dine egne Schedule-maler."
        );
      }

      const update: UpdateScheduleInput = {};
      if (req.body.scheduleName !== undefined) {
        update.scheduleName = req.body.scheduleName as string;
      }
      if (req.body.scheduleType !== undefined) {
        update.scheduleType = parseOptionalType(req.body.scheduleType);
      }
      if (req.body.luckyNumberPrize !== undefined) {
        update.luckyNumberPrize = Number(req.body.luckyNumberPrize);
      }
      if (req.body.status !== undefined) {
        update.status = parseOptionalStatus(req.body.status);
      }
      if (req.body.manualStartTime !== undefined) {
        update.manualStartTime =
          typeof req.body.manualStartTime === "string"
            ? req.body.manualStartTime
            : "";
      }
      if (req.body.manualEndTime !== undefined) {
        update.manualEndTime =
          typeof req.body.manualEndTime === "string" ? req.body.manualEndTime : "";
      }
      if (req.body.subGames !== undefined) {
        update.subGames = parseOptionalSubgames(req.body.subGames);
      }

      const row = await scheduleService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.schedule.update",
        resource: "schedule",
        resourceId: row.id,
        details: {
          scheduleName: row.scheduleName,
          changed: Object.keys(update),
          newStatus: row.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/schedules/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await scheduleService.get(id);
      if (actor.role === "AGENT" && existing.createdBy !== actor.id) {
        throw new DomainError(
          "FORBIDDEN",
          "Du kan kun slette dine egne Schedule-maler."
        );
      }
      const result = await scheduleService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.schedule.delete"
          : "admin.schedule.hard_delete",
        resource: "schedule",
        resourceId: id,
        details: {
          scheduleName: existing.scheduleName,
          scheduleNumber: existing.scheduleNumber,
          softDeleted: result.softDeleted,
          priorStatus: existing.status,
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
