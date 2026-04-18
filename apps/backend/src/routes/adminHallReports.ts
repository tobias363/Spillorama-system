/**
 * BIN-583 B3.8: admin per-hall revenue + account-balance + shift-cashouts.
 *
 *   GET  /api/admin/shifts/:shiftId/physical-cashouts         — admin shift-cashouts
 *   GET  /api/admin/shifts/:shiftId/physical-cashouts/summary
 *   GET  /api/admin/reports/halls/:hallId/daily               — per-dag revenue
 *   GET  /api/admin/reports/halls/:hallId/monthly
 *   GET  /api/admin/reports/halls/:hallId/account-balance
 *   POST /api/admin/reports/halls/:hallId/account/manual-entry
 *   GET  /api/admin/reports/halls/:hallId/manual-entries
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { HallAccountReportService, ManualAdjustmentCategory } from "../compliance/HallAccountReportService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
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

const logger = rootLogger.child({ module: "admin-hall-reports-router" });

export interface AdminHallReportsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  reportService: HallAccountReportService;
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

function parseOffset(value: unknown): number {
  if (typeof value !== "string") return 0;
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function parseIntParam(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new DomainError("INVALID_INPUT", `${field} må være heltall ${min}-${max}.`);
  }
  return n;
}

export function createAdminHallReportsRouter(deps: AdminHallReportsRouterDeps): express.Router {
  const { platformService, auditLogService, reportService } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-583 B3.8] audit append failed");
    });
  }

  // ── Admin shift-cashouts ────────────────────────────────────────────────

  router.get("/api/admin/shifts/:shiftId/physical-cashouts", async (req, res) => {
    try {
      await requirePermission(req, "AGENT_SHIFT_READ");
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const limit = parseLimit(req.query.limit, 100);
      const offset = parseOffset(req.query.offset);
      const result = await reportService.listPhysicalCashoutsForShift({ shiftId, limit, offset });
      apiSuccess(res, { shiftId, ...result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/shifts/:shiftId/physical-cashouts/summary", async (req, res) => {
    try {
      await requirePermission(req, "AGENT_SHIFT_READ");
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const summary = await reportService.getPhysicalCashoutSummaryForShift(shiftId);
      apiSuccess(res, summary);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Hall daily/monthly revenue ──────────────────────────────────────────

  router.get("/api/admin/reports/halls/:hallId/daily", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      const dateFrom = mustBeNonEmptyString(req.query.dateFrom, "dateFrom");
      const dateTo = mustBeNonEmptyString(req.query.dateTo, "dateTo");
      const gameType = typeof req.query.gameType === "string" ? req.query.gameType.trim() || undefined : undefined;
      const rows = await reportService.getDailyReport({ hallId, dateFrom, dateTo, gameType });
      apiSuccess(res, { hallId, dateFrom, dateTo, gameType: gameType ?? null, rows, count: rows.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/halls/:hallId/monthly", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      const year = parseIntParam(req.query.year, "year", 2020, 2100);
      const month = parseIntParam(req.query.month, "month", 1, 12);
      const report = await reportService.getMonthlyReport({ hallId, year, month });
      apiSuccess(res, { hallId, ...report });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/halls/:hallId/account-balance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() || undefined : undefined;
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() || undefined : undefined;
      const balance = await reportService.getAccountBalance({ hallId, dateFrom, dateTo });
      apiSuccess(res, balance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/reports/halls/:hallId/account/manual-entry", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_RUN");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const amountCents = Number(req.body.amountCents);
      if (!Number.isInteger(amountCents) || amountCents === 0) {
        throw new DomainError("INVALID_INPUT", "amountCents må være et ikke-null heltall.");
      }
      const category = req.body.category as ManualAdjustmentCategory;
      const businessDate = mustBeNonEmptyString(req.body.businessDate, "businessDate");
      const note = mustBeNonEmptyString(req.body.note, "note");
      const entry = await reportService.addManualAdjustment({
        hallId, amountCents, category, businessDate, note, createdBy: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.hall.manual_entry.create",
        resource: "hall",
        resourceId: hallId,
        details: {
          entryId: entry.id,
          amountCents: entry.amountCents,
          category: entry.category,
          businessDate: entry.businessDate,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, entry);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/halls/:hallId/manual-entries", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() || undefined : undefined;
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() || undefined : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const rows = await reportService.listManualAdjustments({ hallId, dateFrom, dateTo, limit });
      apiSuccess(res, { hallId, rows, count: rows.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
