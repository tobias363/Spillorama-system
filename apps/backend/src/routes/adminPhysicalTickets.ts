/**
 * BIN-587 B4a: admin physical-ticket-router.
 *
 * Admin-side CRUD + audit-view for papirbilletter. Agent-POS-salget
 * (BIN-583) oppdaterer `app_physical_tickets` via agent-endepunkt —
 * denne routeren eier skjemaet.
 *
 * Endepunkter:
 *   GET    /api/admin/physical-tickets/batches
 *   POST   /api/admin/physical-tickets/batches
 *   GET    /api/admin/physical-tickets/batches/:id
 *   PUT    /api/admin/physical-tickets/batches/:id
 *   DELETE /api/admin/physical-tickets/batches/:id
 *   POST   /api/admin/physical-tickets/batches/:id/generate
 *   POST   /api/admin/physical-tickets/batches/:id/assign-game
 *   GET    /api/admin/physical-tickets/games/:gameId/sold
 *   DELETE /api/admin/physical-tickets/games/:gameId/sold
 *   GET    /api/admin/physical-tickets/last-registered-id?hallId=...
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  PhysicalTicketService,
  PhysicalBatchStatus,
} from "../compliance/PhysicalTicketService.js";
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

const logger = rootLogger.child({ module: "admin-physical-tickets" });

export interface AdminPhysicalTicketsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  physicalTicketService: PhysicalTicketService;
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

function parseOptionalBatchStatus(value: unknown): PhysicalBatchStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const upper = value.trim().toUpperCase() as PhysicalBatchStatus;
  if (upper !== "DRAFT" && upper !== "ACTIVE" && upper !== "CLOSED") {
    throw new DomainError("INVALID_INPUT", "status må være DRAFT, ACTIVE eller CLOSED.");
  }
  return upper;
}

export function createAdminPhysicalTicketsRouter(
  deps: AdminPhysicalTicketsRouterDeps
): express.Router {
  const { platformService, auditLogService, physicalTicketService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-587 B4a] audit append failed");
    });
  }

  // ── Static-path endpoints MÅ komme før :id-rutene ───────────────────

  router.get("/api/admin/physical-tickets/last-registered-id", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const hallIdInput = mustBeNonEmptyString(req.query.hallId, "hallId");
      assertUserHallScope(adminUser, hallIdInput);
      const result = await physicalTicketService.getLastRegisteredUniqueId(hallIdInput);
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Batch list + create ─────────────────────────────────────────────

  router.get("/api/admin/physical-tickets/batches", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      // BIN-591: HALL_OPERATOR tvinges til sin egen hall
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const status = parseOptionalBatchStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 100);
      const batches = await physicalTicketService.listBatches({ hallId, status, limit });
      apiSuccess(res, { batches, count: batches.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/physical-tickets/batches", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
      assertUserHallScope(adminUser, hallId);
      const batchName = mustBeNonEmptyString(req.body.batchName, "batchName");
      if (typeof req.body.rangeStart !== "number" && typeof req.body.rangeStart !== "string") {
        throw new DomainError("INVALID_INPUT", "rangeStart er påkrevd.");
      }
      if (typeof req.body.rangeEnd !== "number" && typeof req.body.rangeEnd !== "string") {
        throw new DomainError("INVALID_INPUT", "rangeEnd er påkrevd.");
      }
      if (typeof req.body.defaultPriceCents !== "number" && typeof req.body.defaultPriceCents !== "string") {
        throw new DomainError("INVALID_INPUT", "defaultPriceCents er påkrevd.");
      }
      const gameSlug =
        typeof req.body.gameSlug === "string" && req.body.gameSlug.trim()
          ? req.body.gameSlug.trim()
          : null;
      const assignedGameId =
        typeof req.body.assignedGameId === "string" && req.body.assignedGameId.trim()
          ? req.body.assignedGameId.trim()
          : null;
      const batch = await physicalTicketService.createBatch({
        hallId,
        batchName,
        rangeStart: Number(req.body.rangeStart),
        rangeEnd: Number(req.body.rangeEnd),
        defaultPriceCents: Number(req.body.defaultPriceCents),
        gameSlug,
        assignedGameId,
        createdBy: adminUser.id,
      });
      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.batch.create",
        resource: "physical_ticket_batch",
        resourceId: batch.id,
        details: {
          hallId: batch.hallId,
          batchName: batch.batchName,
          rangeStart: batch.rangeStart,
          rangeEnd: batch.rangeEnd,
          rangeSize: batch.rangeEnd - batch.rangeStart + 1,
          defaultPriceCents: batch.defaultPriceCents,
          assignedGameId: batch.assignedGameId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, batch);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Batch detail + update + delete ──────────────────────────────────

  router.get("/api/admin/physical-tickets/batches/:id", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const batch = await physicalTicketService.getBatch(id);
      assertUserHallScope(adminUser, batch.hallId);
      apiSuccess(res, batch);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/physical-tickets/batches/:id", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await physicalTicketService.getBatch(id);
      assertUserHallScope(adminUser, existing.hallId);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const update: Parameters<PhysicalTicketService["updateBatch"]>[1] = {};
      if (typeof req.body.batchName === "string") update.batchName = req.body.batchName;
      if (typeof req.body.defaultPriceCents === "number" || typeof req.body.defaultPriceCents === "string") {
        update.defaultPriceCents = Number(req.body.defaultPriceCents);
      }
      if (req.body.gameSlug !== undefined) {
        update.gameSlug = typeof req.body.gameSlug === "string" ? req.body.gameSlug : null;
      }
      if (req.body.assignedGameId !== undefined) {
        update.assignedGameId = typeof req.body.assignedGameId === "string" ? req.body.assignedGameId : null;
      }
      if (typeof req.body.status === "string") {
        update.status = parseOptionalBatchStatus(req.body.status);
      }
      const updated = await physicalTicketService.updateBatch(id, update);
      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.batch.update",
        resource: "physical_ticket_batch",
        resourceId: updated.id,
        details: {
          changed: Object.keys(update),
          newStatus: updated.status,
          assignedGameId: updated.assignedGameId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/physical-tickets/batches/:id", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await physicalTicketService.getBatch(id);
      assertUserHallScope(adminUser, existing.hallId);
      await physicalTicketService.deleteBatch(id);
      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.batch.delete",
        resource: "physical_ticket_batch",
        resourceId: id,
        details: {
          hallId: existing.hallId,
          batchName: existing.batchName,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Ticket generering + assign-game ─────────────────────────────────

  router.post("/api/admin/physical-tickets/batches/:id/generate", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await physicalTicketService.getBatch(id);
      assertUserHallScope(adminUser, existing.hallId);
      const result = await physicalTicketService.generateTickets(id);
      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.batch.generate",
        resource: "physical_ticket_batch",
        resourceId: id,
        details: {
          generated: result.generated,
          firstUniqueId: result.firstUniqueId,
          lastUniqueId: result.lastUniqueId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/physical-tickets/batches/:id/assign-game", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await physicalTicketService.getBatch(id);
      assertUserHallScope(adminUser, existing.hallId);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const updated = await physicalTicketService.assignBatchToGame(id, gameId);
      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.batch.assign_game",
        resource: "physical_ticket_batch",
        resourceId: id,
        details: { gameId, hallId: updated.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Per-game sold-liste + cleanup ───────────────────────────────────

  router.get("/api/admin/physical-tickets/games/:gameId/sold", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const limit = parseLimit(req.query.limit, 200);
      const tickets = await physicalTicketService.listSoldTicketsForGame(gameId, { hallId, limit });
      apiSuccess(res, { tickets, count: tickets.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/physical-tickets/games/:gameId/sold", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const reason = mustBeNonEmptyString(req.body?.reason, "reason");
      const result = await physicalTicketService.voidAllSoldTicketsForGame({
        gameId,
        actorId: adminUser.id,
        reason,
      });
      fireAudit({
        actorId: adminUser.id,
        actorType: actorTypeFromRole(adminUser.role),
        action: "physical_ticket.game.void_all",
        resource: "game",
        resourceId: gameId,
        details: {
          voided: result.voided,
          reason,
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
