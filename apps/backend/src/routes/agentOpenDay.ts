/**
 * BIN-583 B3.8: agent open-day + cashout-rapport-endepunkter.
 *
 *   POST /api/agent/shift/open-day               — start dagen med kontanter fra hall
 *   GET  /api/agent/shift/daily-balance          — nåværende balance + hall-cash
 *   GET  /api/agent/shift/physical-cashouts      — paginert cashout-liste (egen shift)
 *   GET  /api/agent/shift/physical-cashouts/summary — aggregert
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AgentOpenDayService } from "../agent/AgentOpenDayService.js";
import type { HallAccountReportService } from "../compliance/HallAccountReportService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBePositiveAmount,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-open-day-router" });

export interface AgentOpenDayRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  openDayService: AgentOpenDayService;
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

function parseOffset(value: unknown): number {
  if (typeof value !== "string") return 0;
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

export function createAgentOpenDayRouter(deps: AgentOpenDayRouterDeps): express.Router {
  const {
    platformService, auditLogService, agentService, agentShiftService,
    openDayService, reportService,
  } = deps;
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

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-583 B3.8] audit append failed");
    });
  }

  // ── Open-day ────────────────────────────────────────────────────────────

  router.post("/api/agent/shift/open-day", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SHIFT_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan åpne dagen.");
      }
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const amount = mustBePositiveAmount(req.body.amount, "amount");
      const notes = typeof req.body.notes === "string" ? req.body.notes : undefined;
      const result = await openDayService.openDay({
        agentUserId: actor.userId,
        amount,
        notes,
      });
      fireAudit({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.shift.open_day",
        resource: "agent_shift",
        resourceId: result.shiftId,
        details: {
          hallId: result.hallId,
          amount,
          dailyBalance: result.dailyBalance,
          hallCashBalanceAfter: result.hallCashBalanceAfter,
          transferTxId: result.transferTxId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Daily-balance read ──────────────────────────────────────────────────

  router.get("/api/agent/shift/daily-balance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SHIFT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Daily-balance er kun for AGENT.");
      }
      const snapshot = await openDayService.getDailyBalance(actor.userId);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Physical cashouts for own shift ─────────────────────────────────────

  router.get("/api/agent/shift/physical-cashouts", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SHIFT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Cashout-liste er kun for AGENT.");
      }
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      if (!shift) {
        apiSuccess(res, { shiftId: null, rows: [], total: 0, totalAmountCents: 0 });
        return;
      }
      const limit = parseLimit(req.query.limit, 100);
      const offset = parseOffset(req.query.offset);
      const result = await reportService.listPhysicalCashoutsForShift({
        shiftId: shift.id, limit, offset,
      });
      apiSuccess(res, { shiftId: shift.id, ...result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/agent/shift/physical-cashouts/summary", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SHIFT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Cashout-summary er kun for AGENT.");
      }
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      if (!shift) {
        apiSuccess(res, { shiftId: null, winCount: 0, totalAmountCents: 0, byPaymentMethod: {} });
        return;
      }
      const summary = await reportService.getPhysicalCashoutSummaryForShift(shift.id);
      apiSuccess(res, summary);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
