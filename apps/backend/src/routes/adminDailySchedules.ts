/**
 * BIN-626: admin-router for DailySchedule CRUD + special + subgame-details.
 *
 * Endepunkter (matches apps/admin-web/.../DailyScheduleState.ts-kontraktet):
 *   GET    /api/admin/daily-schedules
 *   GET    /api/admin/daily-schedules/:id
 *   GET    /api/admin/daily-schedules/:id/details   ← for viewSubgame.html
 *   POST   /api/admin/daily-schedules
 *   POST   /api/admin/daily-schedules/special
 *   PATCH  /api/admin/daily-schedules/:id
 *   DELETE /api/admin/daily-schedules/:id
 *
 * Rolle-krav: SCHEDULE_READ for GETs, SCHEDULE_WRITE for resten
 * (se apps/backend/src/platform/AdminAccessPolicy.ts).
 *
 * Hall-scope: HALL_OPERATOR ser og skriver kun i egen hall. Håndheves via
 * resolveHallScopeFilter på list + assertUserHallScope på detail/write.
 * Multi-hall-plan (hallIds_json) sjekkes slik at operator må være i
 * master-hall eller hallIds-listen.
 *
 * Svar-formatet matcher `DailyScheduleRow` i admin-web — typer er kanonisert
 * i packages/shared-types/src/schemas.ts (DailyScheduleRowSchema).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { GameManagementService } from "../admin/GameManagementService.js";
import type {
  DailyScheduleService,
  DailySchedule,
  DailyScheduleStatus,
  DailyScheduleDay,
  DailyScheduleHallIds,
  DailyScheduleSubgameSlot,
  CreateDailyScheduleInput,
  UpdateDailyScheduleInput,
  ListDailyScheduleFilter,
} from "../admin/DailyScheduleService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  resolveHallScopeFilter,
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

const logger = rootLogger.child({ module: "admin-daily-schedules" });

export interface AdminDailySchedulesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  dailyScheduleService: DailyScheduleService;
  /** Valgfri: brukes av /:id/details for å embedde GameManagement-referansen. */
  gameManagementService?: GameManagementService;
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

function parseOptionalStatus(value: unknown): DailyScheduleStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as DailyScheduleStatus;
  if (v !== "active" && v !== "running" && v !== "finish" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, running, finish, inactive."
    );
  }
  return v;
}

function parseOptionalWeekDays(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 127) {
    throw new DomainError(
      "INVALID_INPUT",
      "weekDays må være heltall 0-127 (bitmask)."
    );
  }
  return n;
}

function parseOptionalSpecialGame(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  throw new DomainError("INVALID_INPUT", "specialGame må være boolean.");
}

/**
 * Hall-scope-sjekk for en enkelt DailySchedule-rad. En HALL_OPERATOR får
 * tilgang hvis:
 *   - `hall_id` matcher operatorens hall, ELLER
 *   - operatorens hall er i `hallIds.hallIds` eller `hallIds.groupHallIds`,
 *     ELLER er `hallIds.masterHallId`.
 */
function assertRowHallScope(user: PublicAppUser, row: DailySchedule): void {
  if (user.role === "ADMIN" || user.role === "SUPPORT") return;
  if (user.role !== "HALL_OPERATOR") {
    throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne planen.");
  }
  if (!user.hallId) {
    throw new DomainError(
      "FORBIDDEN",
      "Din bruker er ikke tildelt en hall — kontakt admin."
    );
  }
  if (row.hallId && row.hallId === user.hallId) return;
  const ids = row.hallIds;
  if (ids.masterHallId && ids.masterHallId === user.hallId) return;
  if (ids.hallIds?.includes(user.hallId)) return;
  if (ids.groupHallIds?.includes(user.hallId)) return;
  throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne planen.");
}

/** Trim ned internt `DailySchedule`-objekt til wire-shape (ingen deletedAt). */
function toWireShape(row: DailySchedule): Omit<DailySchedule, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = row;
  return rest;
}

function parseOptionalHallIds(value: unknown): DailyScheduleHallIds | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "hallIds må være et objekt.");
  }
  return value as DailyScheduleHallIds;
}

function parseOptionalSubgames(value: unknown): DailyScheduleSubgameSlot[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "subgames må være en array.");
  }
  return value as DailyScheduleSubgameSlot[];
}

function parseOptionalOtherData(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "otherData må være et objekt.");
  }
  return value as Record<string, unknown>;
}

export function createAdminDailySchedulesRouter(
  deps: AdminDailySchedulesRouterDeps
): express.Router {
  const {
    platformService,
    auditLogService,
    dailyScheduleService,
    gameManagementService,
  } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-626] audit append failed");
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/daily-schedules", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_READ");
      const requestedHallId =
        typeof req.query.hallId === "string" && req.query.hallId.trim()
          ? req.query.hallId.trim()
          : undefined;
      // Håndhever at HALL_OPERATOR med explicit hallId-filter må peke på egen
      // hall. For ADMIN/SUPPORT returnerer denne `requestedHallId` uendret.
      const explicitHallId = resolveHallScopeFilter(actor, requestedHallId);

      const gameManagementId =
        typeof req.query.gameManagementId === "string" && req.query.gameManagementId.trim()
          ? req.query.gameManagementId.trim()
          : undefined;
      const status = parseOptionalStatus(req.query.status);
      const weekDaysMask = parseOptionalWeekDays(req.query.weekDays);
      const specialGame = parseOptionalSpecialGame(req.query.specialGame);
      const fromDate =
        typeof req.query.fromDate === "string" && req.query.fromDate.trim()
          ? req.query.fromDate.trim()
          : undefined;
      const toDate =
        typeof req.query.toDate === "string" && req.query.toDate.trim()
          ? req.query.toDate.trim()
          : undefined;
      const limit = parseLimit(req.query.limit, 100);

      // For HALL_OPERATOR uten explicit hallId-filter DROPPER vi hall_id
      // SQL-filteret og filtrerer per-rad i stedet. Dette er nødvendig fordi
      // multi-hall-planer ligger som hall_id IS NULL + hall_ids_json — en
      // SQL-filter ville ekskludert disse fra listen.
      const sqlHallId =
        actor.role === "HALL_OPERATOR" && !requestedHallId
          ? undefined
          : explicitHallId;

      const filter: ListDailyScheduleFilter = {
        gameManagementId,
        hallId: sqlHallId,
        weekDaysMask,
        status,
        specialGame,
        fromDate,
        toDate,
        limit,
      };
      const rows = await dailyScheduleService.list(filter);
      const visible =
        actor.role === "HALL_OPERATOR" && actor.hallId
          ? rows.filter((row) => {
              if (row.hallId && row.hallId === actor.hallId) return true;
              const ids = row.hallIds;
              if (ids.masterHallId === actor.hallId) return true;
              if (ids.hallIds?.includes(actor.hallId!)) return true;
              if (ids.groupHallIds?.includes(actor.hallId!)) return true;
              return false;
            })
          : rows;
      apiSuccess(res, {
        schedules: visible.map(toWireShape),
        count: visible.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/daily-schedules/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const row = await dailyScheduleService.get(id);
      assertRowHallScope(actor, row);
      apiSuccess(res, toWireShape(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: details (schedule + subgames + embedded GameManagement) ───

  router.get("/api/admin/daily-schedules/:id/details", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const row = await dailyScheduleService.get(id);
      assertRowHallScope(actor, row);

      let gameManagement:
        | {
            id: string;
            name: string;
            status: "active" | "running" | "closed" | "inactive";
            ticketType: "Large" | "Small" | null;
            ticketPrice: number;
          }
        | null = null;
      if (row.gameManagementId && gameManagementService) {
        try {
          const gm = await gameManagementService.get(row.gameManagementId);
          gameManagement = {
            id: gm.id,
            name: gm.name,
            status: gm.status,
            ticketType: gm.ticketType,
            ticketPrice: gm.ticketPrice,
          };
        } catch (err) {
          // GameManagement er valgfritt embedded felt — soft-fail hvis
          // FK peker på en slettet rad.
          logger.warn(
            { err, gameManagementId: row.gameManagementId, scheduleId: id },
            "[BIN-626] details: kunne ikke hente embedded GameManagement"
          );
        }
      }

      apiSuccess(res, {
        schedule: toWireShape(row),
        subgames: row.subgames,
        gameManagement,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  async function createRow(
    req: express.Request,
    actor: PublicAppUser,
    forceSpecial: boolean
  ): Promise<DailySchedule> {
    if (!isRecordObject(req.body)) {
      throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
    }
    const input: CreateDailyScheduleInput = {
      name: mustBeNonEmptyString(req.body.name, "name"),
      startDate: mustBeNonEmptyString(req.body.startDate, "startDate"),
      createdBy: actor.id,
    };
    if (req.body.gameManagementId !== undefined) {
      input.gameManagementId =
        typeof req.body.gameManagementId === "string" ? req.body.gameManagementId : null;
    }
    if (req.body.hallId !== undefined) {
      input.hallId = typeof req.body.hallId === "string" ? req.body.hallId : null;
    }
    if (req.body.hallIds !== undefined) {
      input.hallIds = parseOptionalHallIds(req.body.hallIds);
    }
    if (req.body.weekDays !== undefined) {
      input.weekDays = Number(req.body.weekDays);
    }
    if (req.body.day !== undefined) {
      input.day = (req.body.day ?? null) as DailyScheduleDay | null;
    }
    if (req.body.endDate !== undefined) {
      input.endDate = typeof req.body.endDate === "string" ? req.body.endDate : null;
    }
    if (req.body.startTime !== undefined) {
      input.startTime = typeof req.body.startTime === "string" ? req.body.startTime : "";
    }
    if (req.body.endTime !== undefined) {
      input.endTime = typeof req.body.endTime === "string" ? req.body.endTime : "";
    }
    if (req.body.status !== undefined) {
      input.status = req.body.status as DailyScheduleStatus;
    }
    if (req.body.stopGame !== undefined) {
      input.stopGame = Boolean(req.body.stopGame);
    }
    if (req.body.specialGame !== undefined) {
      input.specialGame = Boolean(req.body.specialGame);
    }
    if (forceSpecial) {
      input.specialGame = true;
    }
    if (req.body.isSavedGame !== undefined) {
      input.isSavedGame = Boolean(req.body.isSavedGame);
    }
    if (req.body.isAdminSavedGame !== undefined) {
      input.isAdminSavedGame = Boolean(req.body.isAdminSavedGame);
    }
    if (req.body.subgames !== undefined) {
      input.subgames = parseOptionalSubgames(req.body.subgames);
    }
    if (req.body.otherData !== undefined) {
      input.otherData = parseOptionalOtherData(req.body.otherData);
    }

    // Hall-scope for HALL_OPERATOR: hall_id MÅ være egen hall hvis oppgitt.
    // For multi-hall-plan (hallIds) krever vi at operatorens hall er i
    // master/hallIds/groupHallIds. ADMIN + SUPPORT er uberørt.
    if (actor.role === "HALL_OPERATOR") {
      if (!actor.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Din bruker er ikke tildelt en hall — kontakt admin."
        );
      }
      if (input.hallId) {
        assertUserHallScope(
          { role: actor.role, hallId: actor.hallId },
          input.hallId
        );
      }
      if (input.hallIds) {
        const ids = input.hallIds;
        const inMaster = ids.masterHallId === actor.hallId;
        const inHalls = ids.hallIds?.includes(actor.hallId) ?? false;
        const inGroups = ids.groupHallIds?.includes(actor.hallId) ?? false;
        if (!inMaster && !inHalls && !inGroups && !input.hallId) {
          throw new DomainError(
            "FORBIDDEN",
            "hallIds må inkludere din hall."
          );
        }
      }
      if (!input.hallId && !input.hallIds) {
        // Tvungen hall-binding for operator
        input.hallId = actor.hallId;
      }
    }

    return dailyScheduleService.create(input);
  }

  router.post("/api/admin/daily-schedules", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      const row = await createRow(req, actor, false);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.daily_schedule.created",
        resource: "daily_schedule",
        resourceId: row.id,
        details: {
          name: row.name,
          gameManagementId: row.gameManagementId,
          hallId: row.hallId,
          weekDays: row.weekDays,
          startDate: row.startDate,
          endDate: row.endDate,
          status: row.status,
          specialGame: row.specialGame,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: special-schedule ─────────────────────────────────────────

  router.post("/api/admin/daily-schedules/special", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      const row = await createRow(req, actor, true);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.daily_schedule.special_created",
        resource: "daily_schedule",
        resourceId: row.id,
        details: {
          name: row.name,
          hallId: row.hallId,
          startDate: row.startDate,
          endDate: row.endDate,
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

  router.patch("/api/admin/daily-schedules/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const existing = await dailyScheduleService.get(id);
      assertRowHallScope(actor, existing);

      const update: UpdateDailyScheduleInput = {};
      if (req.body.name !== undefined) update.name = req.body.name as string;
      if (req.body.gameManagementId !== undefined) {
        update.gameManagementId =
          typeof req.body.gameManagementId === "string" ? req.body.gameManagementId : null;
      }
      if (req.body.hallId !== undefined) {
        update.hallId = typeof req.body.hallId === "string" ? req.body.hallId : null;
      }
      if (req.body.hallIds !== undefined) {
        update.hallIds = parseOptionalHallIds(req.body.hallIds);
      }
      if (req.body.weekDays !== undefined) update.weekDays = Number(req.body.weekDays);
      if (req.body.day !== undefined) {
        update.day = (req.body.day ?? null) as DailyScheduleDay | null;
      }
      if (req.body.startDate !== undefined) {
        update.startDate = req.body.startDate as string;
      }
      if (req.body.endDate !== undefined) {
        update.endDate = typeof req.body.endDate === "string" ? req.body.endDate : null;
      }
      if (req.body.startTime !== undefined) {
        update.startTime = typeof req.body.startTime === "string" ? req.body.startTime : "";
      }
      if (req.body.endTime !== undefined) {
        update.endTime = typeof req.body.endTime === "string" ? req.body.endTime : "";
      }
      if (req.body.status !== undefined) {
        update.status = req.body.status as DailyScheduleStatus;
      }
      if (req.body.stopGame !== undefined) update.stopGame = Boolean(req.body.stopGame);
      if (req.body.specialGame !== undefined) {
        update.specialGame = Boolean(req.body.specialGame);
      }
      if (req.body.isSavedGame !== undefined) {
        update.isSavedGame = Boolean(req.body.isSavedGame);
      }
      if (req.body.isAdminSavedGame !== undefined) {
        update.isAdminSavedGame = Boolean(req.body.isAdminSavedGame);
      }
      if (req.body.innsatsenSales !== undefined) {
        update.innsatsenSales = Number(req.body.innsatsenSales);
      }
      if (req.body.subgames !== undefined) {
        update.subgames = parseOptionalSubgames(req.body.subgames);
      }
      if (req.body.otherData !== undefined) {
        update.otherData = parseOptionalOtherData(req.body.otherData);
      }

      // Hall-scope for HALL_OPERATOR på mutasjon: hvis hall-felter endres,
      // må ny verdi fortsatt inkludere operatorens hall.
      if (actor.role === "HALL_OPERATOR" && actor.hallId) {
        if (update.hallId !== undefined && update.hallId !== null) {
          assertUserHallScope(
            { role: actor.role, hallId: actor.hallId },
            update.hallId
          );
        }
        if (update.hallIds !== undefined) {
          const ids = update.hallIds;
          const inMaster = ids.masterHallId === actor.hallId;
          const inHalls = ids.hallIds?.includes(actor.hallId) ?? false;
          const inGroups = ids.groupHallIds?.includes(actor.hallId) ?? false;
          const fallbackHallId =
            update.hallId ?? existing.hallId;
          const inFallback = fallbackHallId === actor.hallId;
          if (!inMaster && !inHalls && !inGroups && !inFallback) {
            throw new DomainError(
              "FORBIDDEN",
              "hallIds må inkludere din hall."
            );
          }
        }
      }

      const row = await dailyScheduleService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.daily_schedule.updated",
        resource: "daily_schedule",
        resourceId: row.id,
        details: {
          name: row.name,
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

  router.delete("/api/admin/daily-schedules/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SCHEDULE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await dailyScheduleService.get(id);
      assertRowHallScope(actor, existing);
      const result = await dailyScheduleService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.daily_schedule.soft_deleted"
          : "admin.daily_schedule.deleted",
        resource: "daily_schedule",
        resourceId: id,
        details: {
          name: existing.name,
          softDeleted: result.softDeleted,
          innsatsenSales: existing.innsatsenSales,
          specialGame: existing.specialGame,
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
