/**
 * BIN-583 B3.4: Metronia agent + admin-endepunkter.
 *
 *   POST /api/agent/metronia/register-ticket    create-ticket via API
 *   POST /api/agent/metronia/topup              topup via API
 *   POST /api/agent/metronia/payout             close + credit player
 *   POST /api/agent/metronia/void               counter-tx innen 5 min
 *   GET  /api/agent/metronia/ticket/:ticketNumber  hent enkelt ticket
 *   GET  /api/agent/metronia/daily-sales        aggregat for current shift
 *
 *   GET  /api/admin/metronia/hall-summary/:hallId  per-hall aggregat
 *   GET  /api/admin/metronia/daily-report          global aggregat
 *
 * RBAC:
 *   - MACHINE_TICKET_WRITE for create/topup/payout/void
 *   - MACHINE_REPORT_READ  for ticket-detail + rapporter
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { MetroniaTicketService } from "../agent/MetroniaTicketService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-metronia-router" });

export interface AgentMetroniaRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  metroniaTicketService: MetroniaTicketService;
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

export function createAgentMetroniaRouter(deps: AgentMetroniaRouterDeps): express.Router {
  const { platformService, agentService, metroniaTicketService, auditLogService } = deps;
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

  // ── POST /api/agent/metronia/register-ticket ────────────────────────────
  router.post("/api/agent/metronia/register-ticket", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan opprette Metronia-ticket.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const playerUserId = mustBeNonEmptyString(body.playerUserId, "playerUserId");
      const amountNok = mustBeNumber(body.amountNok, "amountNok");
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const ticket = await metroniaTicketService.createTicket({
        agentUserId: actor.userId,
        playerUserId,
        amountNok,
        clientRequestId,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.metronia.create",
        resource: "machine_ticket",
        resourceId: ticket.id,
        details: { ticketNumber: ticket.ticketNumber, amountNok, playerUserId, hallId: ticket.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, ticket);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/metronia/topup ──────────────────────────────────────
  router.post("/api/agent/metronia/topup", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan utføre topup.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const ticketNumber = mustBeNonEmptyString(body.ticketNumber, "ticketNumber");
      const amountNok = mustBeNumber(body.amountNok, "amountNok");
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const updated = await metroniaTicketService.topupTicket({
        agentUserId: actor.userId, ticketNumber, amountNok, clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.metronia.topup",
        resource: "machine_ticket",
        resourceId: updated.id,
        details: { ticketNumber, amountNok, newBalanceCents: updated.currentBalanceCents },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/metronia/payout ─────────────────────────────────────
  router.post("/api/agent/metronia/payout", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan utbetale.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const ticketNumber = mustBeNonEmptyString(body.ticketNumber, "ticketNumber");
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const closed = await metroniaTicketService.closeTicket({
        agentUserId: actor.userId, ticketNumber, clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.metronia.close",
        resource: "machine_ticket",
        resourceId: closed.id,
        details: { ticketNumber, payoutCents: closed.payoutCents, hallId: closed.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, closed);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/metronia/void ───────────────────────────────────────
  router.post("/api/agent/metronia/void", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_TICKET_WRITE");
      const body = isRecordObject(req.body) ? req.body : {};
      const ticketNumber = mustBeNonEmptyString(body.ticketNumber, "ticketNumber");
      const reason = mustBeNonEmptyString(body.reason, "reason");
      const voided = await metroniaTicketService.voidTicket({
        agentUserId: actor.userId,
        agentRole: actor.role,
        ticketNumber,
        reason,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: mapRoleToActorType(actor.role),
        action: "agent.metronia.void",
        resource: "machine_ticket",
        resourceId: voided.id,
        details: { ticketNumber, reason, forceAdmin: actor.role === "ADMIN" },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, voided);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/metronia/ticket/:ticketNumber ────────────────────────
  router.get("/api/agent/metronia/ticket/:ticketNumber", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      const ticketNumber = mustBeNonEmptyString(req.params.ticketNumber, "ticketNumber");
      const ticket = await metroniaTicketService.getTicketByNumber(ticketNumber);
      // AGENT begrenses til egne tickets.
      if (actor.role === "AGENT" && ticket.agentUserId !== actor.userId) {
        throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne ticket-en.");
      }
      apiSuccess(res, ticket);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/metronia/daily-sales ─────────────────────────────────
  router.get("/api/agent/metronia/daily-sales", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Daily-sales er for AGENT — admin bruker /admin-endepunktene.");
      }
      const aggregate = await metroniaTicketService.getDailySalesForCurrentShift(actor.userId);
      apiSuccess(res, aggregate);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/metronia/hall-summary/:hallId ────────────────────────
  router.get("/api/admin/metronia/hall-summary/:hallId", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /agent-endepunktene.");
      }
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const fromDate = typeof req.query?.fromDate === "string" ? req.query.fromDate : undefined;
      const toDate = typeof req.query?.toDate === "string" ? req.query.toDate : undefined;
      const summary = await metroniaTicketService.getHallSummary(hallId, { fromDate, toDate });
      apiSuccess(res, summary);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/metronia/daily-report ────────────────────────────────
  router.get("/api/admin/metronia/daily-report", async (req, res) => {
    try {
      const actor = await requirePermission(req, "MACHINE_REPORT_READ");
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /agent-endepunktene.");
      }
      const fromDate = typeof req.query?.fromDate === "string" ? req.query.fromDate : undefined;
      const toDate = typeof req.query?.toDate === "string" ? req.query.toDate : undefined;
      const report = await metroniaTicketService.getDailyReport({ fromDate, toDate });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-metronia-router initialised (8 endpoints)");
  return router;
}
