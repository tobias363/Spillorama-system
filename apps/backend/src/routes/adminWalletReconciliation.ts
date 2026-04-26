/**
 * BIN-763: Admin-endpoints for wallet reconciliation alerts.
 *
 * Endpoints:
 *   GET  /api/admin/wallet/reconciliation-alerts              — list åpne (RBAC: WALLET_AUDIT_READ)
 *   POST /api/admin/wallet/reconciliation-alerts/:id/resolve  — marker resolved (RBAC: WALLET_AUDIT_WRITE)
 *   POST /api/admin/wallet/reconcile-now                      — trigger tick manuelt (RBAC: WALLET_AUDIT_WRITE)
 *
 * Vi monterer som standalone router (matcher `createAdminWalletRouter`-mønster)
 * fordi:
 *   1. Trenger eget service-dep (WalletReconciliationService) som ikke er
 *      en del av AdminSubRouterDeps.
 *   2. Domene-isolasjon: reconciliation-audit er sin egen ting, ikke en
 *      undergruppe av WALLET_COMPLIANCE.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
} from "../util/httpHelpers.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { WalletReconciliationService } from "../jobs/walletReconciliation.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "admin-wallet-reconciliation" });

export interface AdminWalletReconciliationRouterDeps {
  platformService: PlatformService;
  reconciliationService: WalletReconciliationService;
  auditLogService: AuditLogService;
}

export function createAdminWalletReconciliationRouter(
  deps: AdminWalletReconciliationRouterDeps,
): express.Router {
  const { platformService, reconciliationService, auditLogService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  // GET — list åpne alerts
  router.get("/api/admin/wallet/reconciliation-alerts", async (req, res) => {
    try {
      await requirePermission(req, "WALLET_AUDIT_READ");
      const limit = parseLimit(req.query.limit, 100);
      const alerts = await reconciliationService.listOpenAlerts(limit);
      apiSuccess(res, { alerts, count: alerts.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST :id/resolve — marker en alert som håndtert
  router.post(
    "/api/admin/wallet/reconciliation-alerts/:id/resolve",
    async (req, res) => {
      try {
        const adminUser = await requirePermission(req, "WALLET_AUDIT_WRITE");
        const id = mustBeNonEmptyString(req.params.id, "id");
        const resolutionNote = mustBeNonEmptyString(
          req.body?.resolutionNote,
          "resolutionNote",
        );
        if (resolutionNote.length > 2000) {
          throw new DomainError(
            "INVALID_INPUT",
            "resolutionNote er for lang (maks 2000 tegn).",
          );
        }
        const ok = await reconciliationService.resolveAlert(
          id,
          adminUser.id,
          resolutionNote,
        );
        if (!ok) {
          throw new DomainError(
            "ALERT_NOT_FOUND",
            "Reconciliation-alert finnes ikke eller er allerede resolved.",
          );
        }

        // Audit-log fire-and-forget — feil i audit-pipen blokkerer ikke
        // resolution-handlingen (matcher mønster i adminCompliance).
        void auditLogService
          .record({
            actorId: adminUser.id,
            actorType: "ADMIN",
            action: "wallet.reconciliation.resolve",
            resource: "wallet_reconciliation_alert",
            resourceId: id,
            details: { resolutionNote },
            ipAddress: req.ip ?? null,
            userAgent: req.get("user-agent") ?? null,
          })
          .catch((err) => {
            log.warn({ err, id }, "audit-log write failed (non-blocking)");
          });

        apiSuccess(res, { resolved: true, id });
      } catch (error) {
        apiFailure(res, error);
      }
    },
  );

  // POST reconcile-now — manuelt trigger reconciliation (testing + ad-hoc).
  router.post("/api/admin/wallet/reconcile-now", async (req, res) => {
    try {
      const adminUser = await requirePermission(req, "WALLET_AUDIT_WRITE");
      const startedAt = new Date().toISOString();
      const result = await reconciliationService.reconcileAll();

      void auditLogService
        .record({
          actorId: adminUser.id,
          actorType: "ADMIN",
          action: "wallet.reconciliation.run_now",
          resource: "wallet_reconciliation",
          resourceId: null,
          details: {
            startedAt,
            accountsScanned: result.accountsScanned,
            divergencesFound: result.divergencesFound,
            alertsCreated: result.alertsCreated,
            durationMs: Math.round(result.durationMs),
          },
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })
        .catch((err) => {
          log.warn({ err }, "audit-log write failed (non-blocking)");
        });

      apiSuccess(res, {
        accountsScanned: result.accountsScanned,
        divergencesFound: result.divergencesFound,
        alertsCreated: result.alertsCreated,
        durationMs: Math.round(result.durationMs),
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
