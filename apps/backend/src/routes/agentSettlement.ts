/**
 * BIN-583 B3.3 + K1: agent + admin settlement-endepunkter.
 *
 *   POST /api/agent/shift/control-daily-balance         pre-close sjekk
 *   POST /api/agent/shift/close-day                      fullfør oppgjør
 *                                                        (K1: +machineBreakdown, +bilagReceipt)
 *   GET  /api/agent/shift/settlement-date                forventet dato + pending check
 *   GET  /api/agent/shift/:shiftId/settlement            agentens egen
 *   GET  /api/agent/shift/:shiftId/settlement.pdf        PDF-eksport
 *   POST /api/agent/settlements/:settlementId/receipt    K1: upload bilag PDF/JPG
 *
 *   GET  /api/admin/shifts/settlements                   paginert liste
 *   GET  /api/admin/shifts/:shiftId/settlement           admin-detail
 *   GET  /api/admin/shifts/:shiftId/settlement.pdf       admin-PDF
 *   PUT  /api/admin/shifts/:shiftId/settlement           admin-edit (K1: også breakdown/bilag)
 *
 * RBAC:
 *   - AGENT_SETTLEMENT_WRITE: control-daily-balance, close-day, POST receipt
 *   - AGENT_SETTLEMENT_READ : alle GET-endepunkter (AGENT begrenset til egne)
 *   - AGENT_SETTLEMENT_FORCE: PUT (admin-edit)
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentSettlementService } from "../agent/AgentSettlementService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import { generateDailyCashSettlementPdf } from "../util/pdfExport.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-settlement-router" });

export interface AgentSettlementRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentSettlementService: AgentSettlementService;
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

function parseOffset(value: unknown): number {
  if (typeof value !== "string") return 0;
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function mustBeFiniteNumber(value: unknown, field: string): number {
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

export function createAgentSettlementRouter(deps: AgentSettlementRouterDeps): express.Router {
  const { platformService, agentService, agentSettlementService, auditLogService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ userId: string; role: UserRole; displayName: string }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
    }
    return { userId: user.id, role: user.role, displayName: user.displayName };
  }

  // ── POST /api/agent/shift/control-daily-balance ─────────────────────────
  router.post("/api/agent/shift/control-daily-balance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT kan kontrollere egen kasse.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const reportedDailyBalance = mustBeFiniteNumber(body.reportedDailyBalance, "reportedDailyBalance");
      const reportedTotalCashBalance = mustBeFiniteNumber(body.reportedTotalCashBalance, "reportedTotalCashBalance");
      const result = await agentSettlementService.controlDailyBalance({
        agentUserId: actor.userId,
        reportedDailyBalance,
        reportedTotalCashBalance,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.settlement.control",
        resource: "shift",
        resourceId: null,
        details: { reportedDailyBalance, reportedTotalCashBalance, diff: result.diff, severity: result.severity },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/shift/close-day ─────────────────────────────────────
  router.post("/api/agent/shift/close-day", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_WRITE");
      const body = isRecordObject(req.body) ? req.body : {};
      const reportedCashCount = mustBeFiniteNumber(body.reportedCashCount, "reportedCashCount");
      const settlement = await agentSettlementService.closeDay({
        agentUserId: actor.userId,
        agentRole: actor.role,
        reportedCashCount,
        settlementToDropSafe: typeof body.settlementToDropSafe === "number" ? body.settlementToDropSafe : undefined,
        withdrawFromTotalBalance: typeof body.withdrawFromTotalBalance === "number" ? body.withdrawFromTotalBalance : undefined,
        totalDropSafe: typeof body.totalDropSafe === "number" ? body.totalDropSafe : undefined,
        settlementNote: typeof body.settlementNote === "string" ? body.settlementNote : undefined,
        isForceRequested: body.isForceRequested === true,
        otherData: isRecordObject(body.otherData) ? body.otherData : undefined,
        machineBreakdown: body.machineBreakdown, // validert i service
        bilagReceipt: body.bilagReceipt,         // validert i service
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: mapRoleToActorType(actor.role),
        action: settlement.isForced ? "agent.settlement.close.forced" : "agent.settlement.close",
        resource: "settlement",
        resourceId: settlement.id,
        details: {
          shiftId: settlement.shiftId,
          hallId: settlement.hallId,
          dailyBalanceDifference: settlement.dailyBalanceDifference,
          isForced: settlement.isForced,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, settlement);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/shift/settlement-date ────────────────────────────────
  router.get("/api/agent/shift/settlement-date", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Kun AGENT.");
      }
      const info = await agentSettlementService.getSettlementDateInfo(actor.userId);
      apiSuccess(res, info);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/shift/:shiftId/settlement ────────────────────────────
  router.get("/api/agent/shift/:shiftId/settlement", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_READ");
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const settlement = await agentSettlementService.getSettlementByShiftId(shiftId);
      if (!settlement) {
        throw new DomainError("SETTLEMENT_NOT_FOUND", "Ingen settlement for denne shiften.");
      }
      if (actor.role === "AGENT" && settlement.agentUserId !== actor.userId) {
        throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne settlementen.");
      }
      apiSuccess(res, settlement);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/shift/:shiftId/settlement.pdf ────────────────────────
  router.get("/api/agent/shift/:shiftId/settlement.pdf", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_READ");
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const settlement = await agentSettlementService.getSettlementByShiftId(shiftId);
      if (!settlement) {
        throw new DomainError("SETTLEMENT_NOT_FOUND", "Ingen settlement for denne shiften.");
      }
      if (actor.role === "AGENT" && settlement.agentUserId !== actor.userId) {
        throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne settlementen.");
      }
      const pdfInput = await agentSettlementService.buildPdfInput(settlement.id, actor.displayName);
      const pdfBytes = await generateDailyCashSettlementPdf(pdfInput);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: mapRoleToActorType(actor.role),
        action: "agent.settlement.pdf-export",
        resource: "settlement",
        resourceId: settlement.id,
        details: { shiftId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="settlement-${settlement.businessDate}-${settlement.id}.pdf"`
      );
      res.status(200).end(pdfBytes);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/settlements/:settlementId/receipt ────────────────────
  // K1: agent laster opp bilag (PDF/JPG) til egen settlement. Admin kan også
  // bruke dette endpointet for å replace. Max 10 MB (service validerer).
  router.post("/api/agent/settlements/:settlementId/receipt", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_WRITE");
      const settlementId = mustBeNonEmptyString(req.params.settlementId, "settlementId");
      const body = isRecordObject(req.body) ? req.body : {};
      const updated = await agentSettlementService.uploadBilagReceipt({
        settlementId,
        uploaderUserId: actor.userId,
        uploaderRole: actor.role,
        receipt: body.receipt ?? body, // aksepter både { receipt: {...} } og rå-objekt
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: mapRoleToActorType(actor.role),
        action: "agent.settlement.bilag-uploaded",
        resource: "settlement",
        resourceId: settlementId,
        details: {
          filename: updated.bilagReceipt?.filename ?? null,
          mime: updated.bilagReceipt?.mime ?? null,
          sizeBytes: updated.bilagReceipt?.sizeBytes ?? null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/shifts/settlements ───────────────────────────────────
  router.get("/api/admin/shifts/settlements", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_READ");
      // AGENT mister access til admin-list-endpoint (agent ser kun egne via /agent-paths)
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /api/agent/shift/-endepunktene.");
      }
      const limit = parseLimit(req.query?.limit, 100);
      const offset = parseOffset(req.query?.offset);
      const filter: Parameters<AgentSettlementService["listSettlements"]>[0] = { limit, offset };
      if (typeof req.query?.hallId === "string") filter.hallId = req.query.hallId;
      if (typeof req.query?.agentUserId === "string") filter.agentUserId = req.query.agentUserId;
      if (typeof req.query?.fromDate === "string") filter.fromDate = req.query.fromDate;
      if (typeof req.query?.toDate === "string") filter.toDate = req.query.toDate;
      const settlements = await agentSettlementService.listSettlements(filter);
      apiSuccess(res, { settlements, limit, offset });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/shifts/:shiftId/settlement ───────────────────────────
  router.get("/api/admin/shifts/:shiftId/settlement", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_READ");
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /api/agent/shift/-endepunktene.");
      }
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const settlement = await agentSettlementService.getSettlementByShiftId(shiftId);
      if (!settlement) {
        throw new DomainError("SETTLEMENT_NOT_FOUND", "Ingen settlement.");
      }
      apiSuccess(res, settlement);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/shifts/:shiftId/settlement.pdf ───────────────────────
  router.get("/api/admin/shifts/:shiftId/settlement.pdf", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_READ");
      if (actor.role === "AGENT") {
        throw new DomainError("FORBIDDEN", "AGENT bruker /api/agent/shift/-endepunktene.");
      }
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const settlement = await agentSettlementService.getSettlementByShiftId(shiftId);
      if (!settlement) {
        throw new DomainError("SETTLEMENT_NOT_FOUND", "Ingen settlement.");
      }
      const pdfInput = await agentSettlementService.buildPdfInput(settlement.id, actor.displayName);
      const pdfBytes = await generateDailyCashSettlementPdf(pdfInput);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: mapRoleToActorType(actor.role),
        action: "agent.settlement.pdf-export",
        resource: "settlement",
        resourceId: settlement.id,
        details: { shiftId, source: "admin" },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="settlement-${settlement.businessDate}-${settlement.id}.pdf"`
      );
      res.status(200).end(pdfBytes);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PUT /api/admin/shifts/:shiftId/settlement ───────────────────────────
  router.put("/api/admin/shifts/:shiftId/settlement", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_SETTLEMENT_FORCE");
      const shiftId = mustBeNonEmptyString(req.params.shiftId, "shiftId");
      const body = isRecordObject(req.body) ? req.body : {};
      const reason = mustBeNonEmptyString(body.reason, "reason");
      const existing = await agentSettlementService.getSettlementByShiftId(shiftId);
      if (!existing) {
        throw new DomainError("SETTLEMENT_NOT_FOUND", "Ingen settlement å redigere.");
      }
      const patch: Parameters<AgentSettlementService["editSettlement"]>[0]["patch"] = {};
      if (typeof body.reportedCashCount === "number") patch.reportedCashCount = body.reportedCashCount;
      if (typeof body.settlementToDropSafe === "number") patch.settlementToDropSafe = body.settlementToDropSafe;
      if (typeof body.withdrawFromTotalBalance === "number") patch.withdrawFromTotalBalance = body.withdrawFromTotalBalance;
      if (typeof body.totalDropSafe === "number") patch.totalDropSafe = body.totalDropSafe;
      if (body.settlementNote !== undefined) {
        patch.settlementNote = body.settlementNote === null ? null : String(body.settlementNote);
      }
      if (isRecordObject(body.otherData)) patch.otherData = body.otherData;
      // K1: breakdown + bilag — service validerer shape. null bilag → nullstill.
      if (body.machineBreakdown !== undefined) {
        // Cast gjennom — service.validateMachineBreakdown kaster hvis ugyldig.
        patch.machineBreakdown = body.machineBreakdown as unknown as Parameters<AgentSettlementService["editSettlement"]>[0]["patch"]["machineBreakdown"];
      }
      if (body.bilagReceipt !== undefined) {
        patch.bilagReceipt = body.bilagReceipt as unknown as Parameters<AgentSettlementService["editSettlement"]>[0]["patch"]["bilagReceipt"];
      }

      const edited = await agentSettlementService.editSettlement({
        settlementId: existing.id,
        editedByUserId: actor.userId,
        editorRole: actor.role,
        reason,
        patch,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: mapRoleToActorType(actor.role),
        action: "agent.settlement.edit",
        resource: "settlement",
        resourceId: edited.id,
        details: { shiftId, reason, fields: Object.keys(patch) },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, edited);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-settlement-router initialised (10 endpoints)");
  return router;
}
