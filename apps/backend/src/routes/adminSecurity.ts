/**
 * BIN-587 B3-security: admin sikkerhets-endepunkter.
 *
 *   Withdraw-email-allowlist (CC for uttak-notifikasjoner):
 *     GET    /api/admin/security/withdraw-emails
 *     POST   /api/admin/security/withdraw-emails
 *     DELETE /api/admin/security/withdraw-emails/:id
 *
 *   Risk-countries (ISO-3166 alpha-2):
 *     GET    /api/admin/security/risk-countries
 *     POST   /api/admin/security/risk-countries
 *     DELETE /api/admin/security/risk-countries/:code
 *
 *   Blocked-IPs:
 *     GET    /api/admin/security/blocked-ips
 *     POST   /api/admin/security/blocked-ips
 *     DELETE /api/admin/security/blocked-ips/:id
 *
 *   Audit-log-search:
 *     GET    /api/admin/audit/events?actor&action&resource&resourceId&since&limit
 *
 * Alle mutasjoner logges via AuditLogService.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { SecurityService } from "../compliance/SecurityService.js";
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
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-security" });

export interface AdminSecurityRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  securityService: SecurityService;
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

export function createAdminSecurityRouter(deps: AdminSecurityRouterDeps): express.Router {
  const { platformService, auditLogService, securityService } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-587 B3-security] audit append failed");
    });
  }

  // ── Withdraw email allowlist ─────────────────────────────────────────

  router.get("/api/admin/security/withdraw-emails", async (req, res) => {
    try {
      await requirePermission(req, "SECURITY_READ");
      const emails = await securityService.listWithdrawEmails();
      apiSuccess(res, { emails, count: emails.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/security/withdraw-emails", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SECURITY_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const email = mustBeNonEmptyString(req.body.email, "email");
      const label =
        typeof req.body.label === "string" && req.body.label.trim()
          ? req.body.label.trim()
          : null;
      const created = await securityService.addWithdrawEmail({
        email,
        label,
        addedBy: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.withdraw_email.add",
        resource: "withdraw_email",
        resourceId: created.id,
        details: {
          // Kun domenet i audit for personvern — full e-post er i DB.
          emailDomain: created.email.includes("@") ? created.email.split("@")[1] : null,
          label,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, created);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/security/withdraw-emails/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SECURITY_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await securityService.deleteWithdrawEmail(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.withdraw_email.remove",
        resource: "withdraw_email",
        resourceId: id,
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Risk countries ───────────────────────────────────────────────────

  router.get("/api/admin/security/risk-countries", async (req, res) => {
    try {
      await requirePermission(req, "SECURITY_READ");
      const countries = await securityService.listRiskCountries();
      apiSuccess(res, { countries, count: countries.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/security/risk-countries", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SECURITY_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const countryCode = mustBeNonEmptyString(req.body.countryCode, "countryCode");
      const label = mustBeNonEmptyString(req.body.label, "label");
      const reason =
        typeof req.body.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim()
          : null;
      const created = await securityService.addRiskCountry({
        countryCode,
        label,
        reason,
        addedBy: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.risk_country.add",
        resource: "risk_country",
        resourceId: created.countryCode,
        details: { label: created.label, reason },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, created);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/security/risk-countries/:code", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SECURITY_WRITE");
      const code = mustBeNonEmptyString(req.params.code, "code");
      await securityService.removeRiskCountry(code);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.risk_country.remove",
        resource: "risk_country",
        resourceId: code.toUpperCase(),
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { removed: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Blocked IPs ──────────────────────────────────────────────────────

  router.get("/api/admin/security/blocked-ips", async (req, res) => {
    try {
      await requirePermission(req, "SECURITY_READ");
      const ips = await securityService.listBlockedIps();
      apiSuccess(res, { ips, count: ips.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/security/blocked-ips", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SECURITY_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const ipAddress = mustBeNonEmptyString(req.body.ipAddress, "ipAddress");
      const reason =
        typeof req.body.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim()
          : null;
      const expiresAt =
        typeof req.body.expiresAt === "string" && req.body.expiresAt.trim()
          ? req.body.expiresAt.trim()
          : null;
      const created = await securityService.addBlockedIp({
        ipAddress,
        reason,
        expiresAt,
        blockedBy: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.blocked_ip.add",
        resource: "blocked_ip",
        resourceId: created.id,
        details: {
          ipAddress: created.ipAddress,
          reason,
          expiresAt: created.expiresAt,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, created);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/security/blocked-ips/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SECURITY_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await securityService.removeBlockedIp(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.blocked_ip.remove",
        resource: "blocked_ip",
        resourceId: id,
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { removed: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Audit-log-search ─────────────────────────────────────────────────

  router.get("/api/admin/audit/events", async (req, res) => {
    try {
      await requirePermission(req, "AUDIT_LOG_READ");
      const actorId =
        typeof req.query.actor === "string" && req.query.actor.trim()
          ? req.query.actor.trim()
          : undefined;
      const action =
        typeof req.query.action === "string" && req.query.action.trim()
          ? req.query.action.trim()
          : undefined;
      const resource =
        typeof req.query.resource === "string" && req.query.resource.trim()
          ? req.query.resource.trim()
          : undefined;
      const resourceId =
        typeof req.query.resourceId === "string" && req.query.resourceId.trim()
          ? req.query.resourceId.trim()
          : undefined;
      const since =
        typeof req.query.since === "string" && req.query.since.trim()
          ? req.query.since.trim()
          : undefined;
      if (since && isNaN(Date.parse(since))) {
        throw new DomainError("INVALID_INPUT", "since må være en ISO-timestamp.");
      }
      const limit = parseLimit(req.query.limit, 100);
      const events = await auditLogService.list({
        actorId,
        action,
        resource,
        resourceId,
        since,
        limit,
      });
      apiSuccess(res, { events, count: events.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
