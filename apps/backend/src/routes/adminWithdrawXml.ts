/**
 * Admin-routes for Withdraw XML-eksport (wireframe 16.20).
 *
 * Endpoints:
 *   GET  /api/admin/withdraw/xml-batches              — list batches (audit/oversikt)
 *   GET  /api/admin/withdraw/xml-batches/:id          — batch-detalj + rows
 *   POST /api/admin/withdraw/xml-batches/export       — manuell trigger
 *        body: { agentUserId?: string | null }  (null = alle uassignede)
 *   POST /api/admin/withdraw/xml-batches/:id/resend   — re-send e-post for
 *                                                       eksisterende batch
 *
 * Permissions:
 *   - list/read: PAYMENT_REQUEST_READ (ADMIN, HALL_OPERATOR, SUPPORT)
 *   - export/resend: PAYMENT_REQUEST_WRITE (ADMIN, HALL_OPERATOR)
 *
 * Accept/reject av withdraw-requests skjer via eksisterende
 * `/api/admin/payments/requests/:id/{accept,reject}` (paymentRequests.ts).
 * Dette router-laget håndterer KUN XML-eksport-fasen.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { WithdrawXmlExportService } from "../admin/WithdrawXmlExportService.js";
import type { AccountingEmailService } from "../admin/AccountingEmailService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
  parseLimit,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "admin-withdraw-xml" });

export interface AdminWithdrawXmlRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  xmlExportService: WithdrawXmlExportService;
  accountingEmailService: AccountingEmailService;
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

function actorTypeFromRole(role: PublicAppUser["role"]): "ADMIN" | "SUPPORT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  return "USER";
}

export function createAdminWithdrawXmlRouter(
  deps: AdminWithdrawXmlRouterDeps
): express.Router {
  const { platformService, auditLogService, xmlExportService, accountingEmailService } = deps;
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
      log.warn({ err, action: event.action }, "audit append failed");
    });
  }

  // ── GET /api/admin/withdraw/xml-batches ────────────────────────────────
  router.get("/api/admin/withdraw/xml-batches", async (req, res) => {
    try {
      await requirePermission(req, "PAYMENT_REQUEST_READ");
      const agentParam =
        typeof req.query.agentUserId === "string" && req.query.agentUserId.trim()
          ? req.query.agentUserId.trim()
          : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const batches = await xmlExportService.listBatches({
        agentUserId: agentParam,
        limit,
      });
      apiSuccess(res, { batches, count: batches.length });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── GET /api/admin/withdraw/xml-batches/:id ────────────────────────────
  router.get("/api/admin/withdraw/xml-batches/:id", async (req, res) => {
    try {
      await requirePermission(req, "PAYMENT_REQUEST_READ");
      const batchId = mustBeNonEmptyString(req.params.id, "id");
      const { batch, rows } = await xmlExportService.getBatch(batchId);
      apiSuccess(res, { batch, rows });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/admin/withdraw/xml-batches/export ────────────────────────
  router.post("/api/admin/withdraw/xml-batches/export", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PAYMENT_REQUEST_WRITE");
      let agentUserId: string | null = null;
      if (isRecordObject(req.body) && req.body.agentUserId !== undefined) {
        if (req.body.agentUserId === null) {
          agentUserId = null;
        } else if (typeof req.body.agentUserId === "string" && req.body.agentUserId.trim()) {
          agentUserId = req.body.agentUserId.trim();
        } else {
          throw new DomainError(
            "INVALID_INPUT",
            "agentUserId må være string eller null."
          );
        }
      }

      const result = await xmlExportService.generateDailyXmlForAgent(agentUserId);

      let emailResult: Awaited<ReturnType<typeof accountingEmailService.sendXmlBatch>> | null = null;
      if (result.rows.length > 0) {
        try {
          emailResult = await accountingEmailService.sendXmlBatch(
            result.batch.id,
            result.xmlContent
          );
        } catch (err) {
          log.warn(
            { err, batchId: result.batch.id },
            "manual-export: email send failed"
          );
          // Batchen er persistert — la kaller vite via emailResult=null.
        }
      }

      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "withdraw.xml_batch.export",
        resource: "xml_batch",
        resourceId: result.batch.id || null,
        details: {
          agentUserId,
          withdrawRequestCount: result.batch.withdrawRequestCount,
          emailSent: emailResult?.sent ?? false,
          emailDeliveredCount: emailResult?.deliveredTo.length ?? 0,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, {
        batch: result.batch,
        rowCount: result.rows.length,
        email: emailResult
          ? {
              sent: emailResult.sent,
              skipped: emailResult.skipped,
              deliveredTo: emailResult.deliveredTo,
              failedFor: emailResult.failedFor,
            }
          : { sent: false, skipped: true, deliveredTo: [], failedFor: [] },
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── POST /api/admin/withdraw/xml-batches/:id/resend ────────────────────
  router.post("/api/admin/withdraw/xml-batches/:id/resend", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PAYMENT_REQUEST_WRITE");
      const batchId = mustBeNonEmptyString(req.params.id, "id");
      const { batch, rows } = await xmlExportService.getBatch(batchId);
      // Re-render XML fra DB-rader (uten å kreve at filen finnes på disk).
      const xml = await rebuildXmlFromRows(batch, rows);
      const emailResult = await accountingEmailService.sendXmlBatch(batchId, xml);

      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "withdraw.xml_batch.resend",
        resource: "xml_batch",
        resourceId: batchId,
        details: {
          emailSent: emailResult.sent,
          emailDeliveredCount: emailResult.deliveredTo.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, {
        batch: emailResult.batch,
        email: {
          sent: emailResult.sent,
          skipped: emailResult.skipped,
          deliveredTo: emailResult.deliveredTo,
          failedFor: emailResult.failedFor,
        },
      });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}

/**
 * Re-build XML-strengen fra DB-rader (for resend-endpoint). Holder oss
 * uavhengig av filsystemet — re-send trenger ikke å åpne den lagrede
 * filen, det er kun DB som er source of truth.
 */
async function rebuildXmlFromRows(
  batch: Awaited<ReturnType<WithdrawXmlExportService["getBatch"]>>["batch"],
  rows: Awaited<ReturnType<WithdrawXmlExportService["getBatch"]>>["rows"]
): Promise<string> {
  const { buildXml } = await import("../admin/WithdrawXmlExportService.js");
  return buildXml(batch.id, batch.agentUserId, batch.generatedAt, rows);
}
