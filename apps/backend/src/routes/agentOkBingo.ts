/**
 * BIN-583 B3.5: OK Bingo agent + admin-endepunkter.
 *
 *   POST /api/agent/okbingo/register-ticket   create-ticket via SQL Server
 *   POST /api/agent/okbingo/topup              topup
 *   POST /api/agent/okbingo/payout             close + credit player
 *   POST /api/agent/okbingo/void               counter-tx innen 5 min
 *   POST /api/agent/okbingo/open-day           OK-Bingo-spesifikk dagstart
 *   GET  /api/agent/okbingo/ticket/:ticketNumber  hent enkelt ticket
 *   GET  /api/agent/okbingo/daily-sales        aggregat for current shift
 *
 *   GET  /api/admin/okbingo/hall-summary/:hallId  per-hall aggregat
 *   GET  /api/admin/okbingo/daily-report          global aggregat
 *
 * RBAC: gjenbruker MACHINE_TICKET_WRITE + MACHINE_REPORT_READ fra B3.4.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { OkBingoTicketService } from "../agent/OkBingoTicketService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-okbingo-router" });

export interface AgentOkBingoRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  okBingoTicketService: OkBingoTicketService;
  auditLogService: AuditLogService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function mustBeNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new DomainError("INVALID_INPUT", `${field} må være et tall.`);
}

function mapRoleToActorType(role: UserRole): AuditActorType {
  switch (role) {
    case "ADMIN": return "ADMIN";
    case "HALL_OPERATOR": return "HALL_OPERATOR";
    case "SUPPORT": return "SUPPORT";
    case "PLAYER": return "PLAYER";
    case "AGENT": return "AGENT";
  }
}

export function createAgentOkBingoRouter(deps: AgentOkBingoRouterDeps): express.Router {
  const { platformService, agentService, okBingoTicketService, auditLogService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ userId: string; role: UserRole }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
    }
    return { userId: user.id, role: user.role };
  }

  // ── POST /register-ticket ───────────────────────────────────────────────
  router.post("/api/agent/okbingo/register-ticket", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan opprette OK Bingo-ticket.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const playerUserId = mustBeNonEmptyString(body.playerUserId, "playerUserId");
      const amountNok = mustBeNumber(body.amountNok, "amountNok");
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const roomId = typeof body.roomId === "number" ? body.roomId : undefined;
      const ticket = await okBingoTicketService.createTicket({
        agentUserId: actor.userId, playerUserId, amountNok, roomId, clientRequestId,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      void auditLogService.record({
        actorId: actor.userId, actorType: "AGENT",
        action: "agent.okbingo.create",
        resource: "machine_ticket", resourceId: ticket.id,
        details: { ticketNumber: ticket.ticketNumber, amountNok, playerUserId, hallId: ticket.hallId, roomId: ticket.roomId },
        ipAddress: clientIp(req), userAgent: userAgent(req),
      });
      apiSuccess(res, ticket);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /topup ─────────────────────────────────────────────────────────
  router.post("/api/agent/okbingo/topup", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan utføre topup.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const ticketNumber = mustBeNonEmptyString(body.ticketNumber, "ticketNumber");
      const amountNok = mustBeNumber(body.amountNok, "amountNok");
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const updated = await okBingoTicketService.topupTicket({
        agentUserId: actor.userId, ticketNumber, amountNok, clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId, actorType: "AGENT",
        action: "agent.okbingo.topup",
        resource: "machine_ticket", resourceId: updated.id,
        details: { ticketNumber, amountNok, newBalanceCents: updated.currentBalanceCents },
        ipAddress: clientIp(req), userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /payout ────────────────────────────────────────────────────────
  router.post("/api/agent/okbingo/payout", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan utbetale.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const ticketNumber = mustBeNonEmptyString(body.ticketNumber, "ticketNumber");
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const closed = await okBingoTicketService.closeTicket({
        agentUserId: actor.userId, ticketNumber, clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId, actorType: "AGENT",
        action: "agent.okbingo.close",
        resource: "machine_ticket", resourceId: closed.id,
        details: { ticketNumber, payoutCents: closed.payoutCents, hallId: closed.hallId },
        ipAddress: clientIp(req), userAgent: userAgent(req),
      });
      apiSuccess(res, closed);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /void ──────────────────────────────────────────────────────────
  router.post("/api/agent/okbingo/void", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      const body = isRecordObject(req.body) ? req.body : {};
      const ticketNumber = mustBeNonEmptyString(body.ticketNumber, "ticketNumber");
      const reason = mustBeNonEmptyString(body.reason, "reason");
      const voided = await okBingoTicketService.voidTicket({
        agentUserId: actor.userId, agentRole: actor.role,
        ticketNumber, reason,
      });
      void auditLogService.record({
        actorId: actor.userId, actorType: mapRoleToActorType(actor.role),
        action: "agent.okbingo.void",
        resource: "machine_ticket", resourceId: voided.id,
        details: { ticketNumber, reason, forceAdmin: actor.role === "ADMIN" },
        ipAddress: clientIp(req), userAgent: userAgent(req),
      });
      apiSuccess(res, voided);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /open-day (OK-Bingo-spesifikk) ─────────────────────────────────
  router.post("/api/agent/okbingo/open-day", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan åpne dag.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const roomId = typeof body.roomId === "number" ? body.roomId : undefined;
      const result = await okBingoTicketService.openDay({
        agentUserId: actor.userId, roomId,
      });
      void auditLogService.record({
        actorId: actor.userId, actorType: "AGENT",
        action: "agent.okbingo.open-day",
        resource: "hall", resourceId: null,
        details: { roomId: result.roomId },
        ipAddress: clientIp(req), userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /ticket/:ticketNumber ───────────────────────────────────────────
  router.get("/api/agent/okbingo/ticket/:ticketNumber", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      const ticketNumber = mustBeNonEmptyString(req.params.ticketNumber, "ticketNumber");
      const ticket = await okBingoTicketService.getTicketByNumber(ticketNumber);
      if (actor.role === "AGENT" && ticket.agentUserId !== actor.userId) {
        throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne ticket-en.");
      }
      apiSuccess(res, ticket);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /daily-sales ────────────────────────────────────────────────────
  router.get("/api/agent/okbingo/daily-sales", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Daily-sales er for AGENT.");
      }
      const aggregate = await okBingoTicketService.getDailySalesForCurrentShift(actor.userId);
      apiSuccess(res, aggregate);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /admin/hall-summary/:hallId ─────────────────────────────────────
  router.get("/api/admin/okbingo/hall-summary/:hallId", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /agent-endepunktene.");
      }
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const fromDate = typeof req.query?.fromDate === "string" ? req.query.fromDate : undefined;
      const toDate = typeof req.query?.toDate === "string" ? req.query.toDate : undefined;
      const summary = await okBingoTicketService.getHallSummary(hallId, { fromDate, toDate });
      apiSuccess(res, summary);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /admin/daily-report ─────────────────────────────────────────────
  router.get("/api/admin/okbingo/daily-report", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /agent-endepunktene.");
      }
      const fromDate = typeof req.query?.fromDate === "string" ? req.query.fromDate : undefined;
      const toDate = typeof req.query?.toDate === "string" ? req.query.toDate : undefined;
      const report = await okBingoTicketService.getDailyReport({ fromDate, toDate });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-okbingo-router initialised (9 endpoints)");
  return router;
}
