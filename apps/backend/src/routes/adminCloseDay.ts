/**
 * BIN-623: admin-router for CloseDay — regulatorisk dagslukking per spill.
 *
 * Endepunkter:
 *   GET  /api/admin/games/:id/close-day-summary?closeDate=YYYY-MM-DD
 *   POST /api/admin/games/:id/close-day
 *
 * Rolle-krav:
 *   - GAME_MGMT_READ  for GET (summary)
 *   - GAME_MGMT_WRITE for POST (close)
 *
 * Regulatorisk: POST skriver til `app_close_day_log` (for idempotency) og
 * `app_audit_log` (action = "admin.game.close-day"). Dobbel-lukking av samme
 * dag returnerer HTTP 409 med feilkode `CLOSE_DAY_ALREADY_CLOSED`.
 *
 * Legacy-kontekst (for den historisk interesserte): legacy `closeDay` var en
 * scheduling-liste av (closeDate, startTime, endTime) embedded i
 * `dailySchedule.otherData.closeDay` — aldri en audit-dagslukking.
 * BIN-623 er et nytt regulatorisk endepunkt som ikke har direkte legacy-
 * motpart; URL-formen `/api/admin/games/:id/close-day` matcher task-spesen.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { CloseDayService, CloseDaySummary } from "../admin/CloseDayService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { toPublicError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-close-day" });

export interface AdminCloseDayRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  closeDayService: CloseDayService;
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

/**
 * Hent dagens dato i UTC som "YYYY-MM-DD". Holdes rent i router-laget fordi
 * hall-tidssone pt. ikke er konfigurerbar per hall; default er UTC (= norsk
 * vintertid — off by 1h i sommertid). Dette dokumenteres i PR-body som
 * kjent avvik; en senere kommit kan ta inn hall-tidssone fra platform.
 */
function todayIsoDate(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Map DomainError til passende HTTP-status. Gjør dette lokalt fordi
 * `apiFailure` globalt bruker 400 for alt — vi trenger 409 for
 * `CLOSE_DAY_ALREADY_CLOSED` (regulatorisk idempotency) og 404 for
 * manglende spill.
 */
function respondWithError(res: express.Response, err: unknown): void {
  const publicError = toPublicError(err);
  let status = 400;
  switch (publicError.code) {
    case "CLOSE_DAY_ALREADY_CLOSED":
      status = 409;
      break;
    case "GAME_MANAGEMENT_NOT_FOUND":
      status = 404;
      break;
    case "FORBIDDEN":
      status = 403;
      break;
    case "UNAUTHORIZED":
      status = 401;
      break;
    default:
      status = 400;
  }
  res.status(status).json({ ok: false, error: publicError });
}

export function createAdminCloseDayRouter(
  deps: AdminCloseDayRouterDeps
): express.Router {
  const { platformService, auditLogService, closeDayService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-623] audit append failed");
    });
  }

  // ── Read: summary ───────────────────────────────────────────────────
  //
  // Read-only aggregat av dagens tilstand. Brukes av admin-UI for å vise
  // "du er i ferd med å lukke dagen — sjekk tallene"-bekreftelse før POST.

  router.get("/api/admin/games/:id/close-day-summary", async (req, res) => {
    try {
      await requirePermission(req, "GAME_MGMT_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const closeDate =
        typeof req.query.closeDate === "string" && req.query.closeDate.trim()
          ? req.query.closeDate.trim()
          : todayIsoDate();
      const summary = await closeDayService.summary(id, closeDate);
      apiSuccess(res, summary);
    } catch (error) {
      respondWithError(res, error);
    }
  });

  // ── Write: close-day ────────────────────────────────────────────────
  //
  // Idempotent: dobbel-lukking av samme dag → 409 + feilkode
  // `CLOSE_DAY_ALREADY_CLOSED`. AuditLog-skriving er fire-and-forget
  // (samme mønster som BIN-622 GameManagement) men summary-snapshotet
  // er allerede persistert i `app_close_day_log` før audit-record kalles,
  // så regulatorisk historikk er bevart selv om pino-audit skulle feile.

  router.post("/api/admin/games/:id/close-day", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_MGMT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const closeDate =
        typeof body.closeDate === "string" && body.closeDate.trim()
          ? body.closeDate.trim()
          : todayIsoDate();
      const entry = await closeDayService.close({
        gameManagementId: id,
        closeDate,
        closedBy: actor.id,
      });
      const summaryForAudit: Partial<CloseDaySummary> = {
        gameManagementId: entry.gameManagementId,
        closeDate: entry.closeDate,
        totalSold: entry.summary.totalSold,
        totalEarning: entry.summary.totalEarning,
        ticketsSold: entry.summary.ticketsSold,
        winnersCount: entry.summary.winnersCount,
        payoutsTotal: entry.summary.payoutsTotal,
        jackpotsTotal: entry.summary.jackpotsTotal,
        capturedAt: entry.summary.capturedAt,
      };
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game.close-day",
        resource: "game_management",
        resourceId: entry.gameManagementId,
        details: {
          closeDayLogId: entry.id,
          closeDate: entry.closeDate,
          summary: summaryForAudit,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, entry);
    } catch (error) {
      respondWithError(res, error);
    }
  });

  return router;
}
