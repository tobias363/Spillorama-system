/**
 * BIN-587 B3-security: admin sikkerhets-endepunkter.
 *
 *   Withdraw-email-allowlist (CC for uttak-notifikasjoner):
 *     GET    /api/admin/security/withdraw-emails
 *     POST   /api/admin/security/withdraw-emails
 *     PUT    /api/admin/security/withdraw-emails/:id  (GAP #21)
 *     DELETE /api/admin/security/withdraw-emails/:id
 *
 *   Risk-countries (ISO-3166 alpha-2):
 *     GET    /api/admin/security/risk-countries
 *     POST   /api/admin/security/risk-countries
 *     DELETE /api/admin/security/risk-countries/:code
 *
 *   Country-list-for-dropdown (GAP #25):
 *     GET    /api/admin/security/countries
 *     Static ISO-3166-1 alpha-2 lista med norske navn — brukt av
 *     risk-country-dropdown i admin-UI. Read-only, ingen audit.
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
import { DomainError } from "../errors/DomainError.js";
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
import { getCountryList } from "../util/iso3166.js";
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

  // Withdrawal QA P1 (2026-05-01): withdraw-email-allowlist bruker dedikert
  // WITHDRAW_EMAIL_{READ,WRITE} så HALL_OPERATOR + AGENT (bingovert) kan
  // forvalte regnskaps-mottakere for daglig XML-batch. Resten av sikkerhets-
  // konfig (risk-countries, blocked-IPs, audit-log-search) forblir på
  // SECURITY_READ/SECURITY_WRITE (ADMIN + SUPPORT only).
  router.get("/api/admin/security/withdraw-emails", async (req, res) => {
    try {
      await requirePermission(req, "WITHDRAW_EMAIL_READ");
      const emails = await securityService.listWithdrawEmails();
      apiSuccess(res, { emails, count: emails.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/security/withdraw-emails", async (req, res) => {
    try {
      const actor = await requirePermission(req, "WITHDRAW_EMAIL_WRITE");
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

  // GAP #21: Edit eksisterende withdraw-email. Begge `email` og `label` er
  // valgfrie, men minst én må angis. Audit logger kun domene + om label
  // ble endret (personvern: full e-post lever i DB, ikke i audit-stream).
  router.put("/api/admin/security/withdraw-emails/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "WITHDRAW_EMAIL_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const { email, label } = req.body as { email?: unknown; label?: unknown };
      if (email === undefined && label === undefined) {
        throw new DomainError("INVALID_INPUT", "Minst én av email eller label må angis.");
      }
      const updates: { email?: string; label?: string | null } = {};
      if (email !== undefined) {
        if (typeof email !== "string") {
          throw new DomainError("INVALID_INPUT", "email må være en streng.");
        }
        updates.email = email;
      }
      if (label !== undefined) {
        if (label !== null && typeof label !== "string") {
          throw new DomainError("INVALID_INPUT", "label må være en streng eller null.");
        }
        updates.label = label === null ? null : (label as string);
      }
      const updated = await securityService.updateWithdrawEmail(id, updates);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "security.withdraw_email.update",
        resource: "withdraw_email",
        resourceId: id,
        details: {
          // Kun domenet i audit for personvern — full e-post er i DB.
          emailDomain: updated.email.includes("@") ? updated.email.split("@")[1] : null,
          emailChanged: updates.email !== undefined,
          labelChanged: updates.label !== undefined,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/security/withdraw-emails/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "WITHDRAW_EMAIL_WRITE");
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

  // ── Country-list-for-dropdown (GAP #25) ──────────────────────────────
  // Statisk ISO-3166-1 alpha-2 lista med norske navn. Read-only, ingen
  // audit (ingen state-endring). Krever SECURITY_READ — samme som
  // risk-countries-listen, og dropdown brukes i samme UI-flyt.
  router.get("/api/admin/security/countries", async (req, res) => {
    try {
      await requirePermission(req, "SECURITY_READ");
      const countries = getCountryList();
      apiSuccess(res, { countries, count: countries.length });
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
