/**
 * BIN-623 + BIN-700: admin-router for CloseDay — regulatorisk dagslukking
 * per spill med 3-mode-støtte (Single / Consecutive / Random) og per-dato
 * update/delete.
 *
 * Endepunkter:
 *   GET    /api/admin/games/:id/close-day-summary?closeDate=YYYY-MM-DD
 *   GET    /api/admin/games/:id/close-day                   — list alle lukkinger
 *   POST   /api/admin/games/:id/close-day                   — Single | Consecutive | Random
 *   PUT    /api/admin/games/:id/close-day/:closeDate        — per-dato oppdatering
 *   DELETE /api/admin/games/:id/close-day/:closeDate        — per-dato sletting
 *
 * Rolle-krav:
 *   - GAME_MGMT_READ  for GET (summary + list)
 *   - GAME_MGMT_WRITE for POST/PUT/DELETE
 *
 * Regulatorisk: alle skrive-operasjoner skriver til `app_close_day_log` (for
 * idempotency) og `app_audit_log` (action = "admin.game.close-day" /
 * "admin.game.close-day.update" / "admin.game.close-day.delete"). Dobbel-
 * lukking av samme dag i Single-mode returnerer HTTP 409 med feilkode
 * `CLOSE_DAY_ALREADY_CLOSED`. Multi-mode (closeMany) hopper over eksisterende
 * datoer og returnerer 200 med `createdDates`/`skippedDates`.
 *
 * Backwards-compat: gammel POST-shape `{ closeDate }` (uten `mode`) støttes
 * uendret for å unngå å bryte eksisterende admin-UI-kall.
 */

import express from "express";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  CloseDayService,
  CloseDayEntry,
  CloseDaySummary,
  CloseManyInput,
} from "../admin/CloseDayService.js";
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
import { DomainError, toPublicError } from "../game/BingoEngine.js";
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
 * manglende spill / manglende close-day-rad.
 */
function respondWithError(res: express.Response, err: unknown): void {
  const publicError = toPublicError(err);
  let status = 400;
  switch (publicError.code) {
    case "CLOSE_DAY_ALREADY_CLOSED":
      status = 409;
      break;
    case "GAME_MANAGEMENT_NOT_FOUND":
    case "CLOSE_DAY_NOT_FOUND":
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

/** Komprimert summary-utdrag for audit-detail-payload. */
function summaryForAudit(entry: CloseDayEntry): Partial<CloseDaySummary> {
  return {
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
}

/**
 * Parse POST-body til CloseManyInput. Aksepterer både legacy-shape
 * (`{ closeDate }` uten mode) og ny shape (`{ mode, ... }`). Backwards-compat
 * sikrer at eksisterende admin-UI-kall fortsetter å virke.
 */
function parseCloseBody(
  body: Record<string, unknown>,
  gameId: string,
  closedBy: string
): CloseManyInput {
  const mode = body.mode;

  // Legacy-shape: ingen mode-felt → behandle som single med closeDate.
  if (mode === undefined) {
    const closeDate =
      typeof body.closeDate === "string" && body.closeDate.trim()
        ? body.closeDate.trim()
        : todayIsoDate();
    return {
      mode: "single",
      gameManagementId: gameId,
      closedBy,
      closeDate,
      startTime:
        typeof body.startTime === "string" || body.startTime === null
          ? (body.startTime as string | null)
          : undefined,
      endTime:
        typeof body.endTime === "string" || body.endTime === null
          ? (body.endTime as string | null)
          : undefined,
      notes:
        typeof body.notes === "string" || body.notes === null
          ? (body.notes as string | null)
          : undefined,
    };
  }

  switch (mode) {
    case "single": {
      const closeDate =
        typeof body.closeDate === "string" && body.closeDate.trim()
          ? body.closeDate.trim()
          : todayIsoDate();
      return {
        mode: "single",
        gameManagementId: gameId,
        closedBy,
        closeDate,
        startTime:
          typeof body.startTime === "string" || body.startTime === null
            ? (body.startTime as string | null)
            : undefined,
        endTime:
          typeof body.endTime === "string" || body.endTime === null
            ? (body.endTime as string | null)
            : undefined,
        notes:
          typeof body.notes === "string" || body.notes === null
            ? (body.notes as string | null)
            : undefined,
      };
    }
    case "consecutive": {
      if (typeof body.startDate !== "string" || typeof body.endDate !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          "Consecutive-mode krever startDate og endDate (YYYY-MM-DD)."
        );
      }
      if (typeof body.startTime !== "string" || typeof body.endTime !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          "Consecutive-mode krever startTime og endTime (HH:MM)."
        );
      }
      return {
        mode: "consecutive",
        gameManagementId: gameId,
        closedBy,
        startDate: body.startDate,
        endDate: body.endDate,
        startTime: body.startTime,
        endTime: body.endTime,
        notes:
          typeof body.notes === "string" || body.notes === null
            ? (body.notes as string | null)
            : undefined,
      };
    }
    case "random": {
      if (!Array.isArray(body.closeDates)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Random-mode krever en closeDates-liste."
        );
      }
      // Bevar hele input-arrayen som-er; service-laget validerer hver entry.
      return {
        mode: "random",
        gameManagementId: gameId,
        closedBy,
        // Service-laget validerer hver entry per element. Vi sender array
        // gjennom uten å parse — typen samsvarer med Random-mode-input.
        closeDates: body.closeDates as Array<
          | string
          | { closeDate: string; startTime?: string | null; endTime?: string | null }
        >,
        startTime:
          typeof body.startTime === "string" || body.startTime === null
            ? (body.startTime as string | null)
            : undefined,
        endTime:
          typeof body.endTime === "string" || body.endTime === null
            ? (body.endTime as string | null)
            : undefined,
        notes:
          typeof body.notes === "string" || body.notes === null
            ? (body.notes as string | null)
            : undefined,
      };
    }
    default:
      throw new DomainError(
        "INVALID_INPUT",
        `Ugyldig mode "${String(mode)}" — må være "single", "consecutive" eller "random".`
      );
  }
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

  // ── Read: list alle lukkinger for et spill ─────────────────────────
  router.get("/api/admin/games/:id/close-day", async (req, res) => {
    try {
      await requirePermission(req, "GAME_MGMT_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const entries = await closeDayService.listForGame(id);
      apiSuccess(res, { entries });
    } catch (error) {
      respondWithError(res, error);
    }
  });

  // ── Write: close-day (Single | Consecutive | Random) ──────────────
  //
  // Backwards-compat: hvis body mangler `mode` brukes Single med {closeDate}.
  // Multi-mode-result inkluderer createdDates + skippedDates slik at admin-
  // UI kan vise "X lagret, Y var allerede lukket"-toast.
  router.post("/api/admin/games/:id/close-day", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_MGMT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const input = parseCloseBody(body, id, actor.id);

      // Single-mode beholder legacy-API'et med 409 på dobbel-lukking. Multi-
      // mode hopper over eksisterende datoer (idempotent).
      if (input.mode === "single") {
        try {
          const entry = await closeDayService.close({
            gameManagementId: id,
            closeDate: input.closeDate,
            closedBy: actor.id,
            startTime: input.startTime,
            endTime: input.endTime,
            notes: input.notes,
          });
          fireAudit({
            actorId: actor.id,
            actorType: actorTypeFromRole(actor.role),
            action: "admin.game.close-day",
            resource: "game_management",
            resourceId: entry.gameManagementId,
            details: {
              mode: "single",
              closeDayLogId: entry.id,
              closeDate: entry.closeDate,
              startTime: entry.startTime,
              endTime: entry.endTime,
              notes: entry.notes,
              summary: summaryForAudit(entry),
            },
            ipAddress: clientIp(req),
            userAgent: userAgent(req),
          });
          apiSuccess(res, entry);
        } catch (err) {
          // Single-mode 409 på dobbel-lukking håndteres av respondWithError.
          throw err;
        }
        return;
      }

      // Consecutive | Random: idempotent multi-dato.
      const result = await closeDayService.closeMany(input);
      // Audit-log per nylig opprettet rad (ikke skip'ede). Skip'ede er
      // allerede regulatorisk dokumentert i forrige lukking.
      for (const entry of result.entries) {
        if (!result.createdDates.includes(entry.closeDate)) continue;
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.game.close-day",
          resource: "game_management",
          resourceId: entry.gameManagementId,
          details: {
            mode: input.mode,
            closeDayLogId: entry.id,
            closeDate: entry.closeDate,
            startTime: entry.startTime,
            endTime: entry.endTime,
            notes: entry.notes,
            summary: summaryForAudit(entry),
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiSuccess(res, {
        mode: input.mode,
        entries: result.entries,
        createdDates: result.createdDates,
        skippedDates: result.skippedDates,
      });
    } catch (error) {
      respondWithError(res, error);
    }
  });

  // ── Write: per-dato oppdatering ───────────────────────────────────
  router.put(
    "/api/admin/games/:id/close-day/:closeDate",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME_MGMT_WRITE");
        const id = mustBeNonEmptyString(req.params.id, "id");
        const closeDate = mustBeNonEmptyString(req.params.closeDate, "closeDate");
        const body = isRecordObject(req.body) ? req.body : {};
        const updated = await closeDayService.updateDate({
          gameManagementId: id,
          closeDate,
          updatedBy: actor.id,
          startTime:
            "startTime" in body ? (body.startTime as string | null) : undefined,
          endTime: "endTime" in body ? (body.endTime as string | null) : undefined,
          notes: "notes" in body ? (body.notes as string | null) : undefined,
        });
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.game.close-day.update",
          resource: "game_management",
          resourceId: updated.gameManagementId,
          details: {
            closeDayLogId: updated.id,
            closeDate: updated.closeDate,
            startTime: updated.startTime,
            endTime: updated.endTime,
            notes: updated.notes,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        apiSuccess(res, updated);
      } catch (error) {
        respondWithError(res, error);
      }
    }
  );

  // ── Write: per-dato sletting ──────────────────────────────────────
  //
  // Audit-loggen bevarer den slettede raden (id, closeDate, summary) slik
  // at sletting er regulatorisk dokumentert per pengespillforskriften § 64.
  router.delete(
    "/api/admin/games/:id/close-day/:closeDate",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME_MGMT_WRITE");
        const id = mustBeNonEmptyString(req.params.id, "id");
        const closeDate = mustBeNonEmptyString(req.params.closeDate, "closeDate");
        const removed = await closeDayService.deleteDate({
          gameManagementId: id,
          closeDate,
          deletedBy: actor.id,
        });
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.game.close-day.delete",
          resource: "game_management",
          resourceId: removed.gameManagementId,
          details: {
            closeDayLogId: removed.id,
            closeDate: removed.closeDate,
            startTime: removed.startTime,
            endTime: removed.endTime,
            notes: removed.notes,
            summary: summaryForAudit(removed),
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        apiSuccess(res, removed);
      } catch (error) {
        respondWithError(res, error);
      }
    }
  );

  return router;
}
