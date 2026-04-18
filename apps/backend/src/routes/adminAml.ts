/**
 * BIN-587 B3-aml: admin AML-endepunkter.
 *
 * Alle mutasjoner logges via AuditLogService. Manuell flagging + on-
 * demand "scan now" — automatisk rule-engine som cron kommer som
 * BIN-582 follow-up.
 *
 * Endepunkter:
 *   GET  /api/admin/aml/red-flag-rules        — list regler
 *   PUT  /api/admin/aml/red-flag-rules        — bulk-upsert (ADMIN only)
 *   GET  /api/admin/aml/red-flags             — list flag-instanser
 *   GET  /api/admin/aml/red-flags/:id         — detalj
 *   POST /api/admin/aml/red-flags             — manuell flagging
 *   POST /api/admin/aml/red-flags/:id/review  — review + outcome
 *   GET  /api/admin/players/:id/aml-flags     — per-spiller flagger
 *   GET  /api/admin/aml/transactions          — tx-review for bruker
 *   POST /api/admin/aml/scan                  — "scan now" (stub)
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  AmlService,
  AmlRuleInput,
  AmlReviewOutcome,
  AmlSeverity,
} from "../compliance/AmlService.js";
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

const logger = rootLogger.child({ module: "admin-aml" });

const VALID_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const VALID_STATUSES = ["OPEN", "REVIEWED", "DISMISSED", "ESCALATED"] as const;
const VALID_OUTCOMES = ["REVIEWED", "DISMISSED", "ESCALATED"] as const;

export interface AdminAmlRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  amlService: AmlService;
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

function parseSeverity(value: unknown): AmlSeverity {
  const raw = mustBeNonEmptyString(value, "severity").toUpperCase();
  if (!VALID_SEVERITIES.includes(raw as AmlSeverity)) {
    throw new DomainError(
      "INVALID_INPUT",
      `severity må være én av ${VALID_SEVERITIES.join(", ")}.`
    );
  }
  return raw as AmlSeverity;
}

function parseOutcome(value: unknown): AmlReviewOutcome {
  const raw = mustBeNonEmptyString(value, "outcome").toUpperCase();
  if (!VALID_OUTCOMES.includes(raw as AmlReviewOutcome)) {
    throw new DomainError(
      "INVALID_INPUT",
      `outcome må være én av ${VALID_OUTCOMES.join(", ")}.`
    );
  }
  return raw as AmlReviewOutcome;
}

function parseOptionalStatus(value: unknown): (typeof VALID_STATUSES)[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const upper = value.trim().toUpperCase() as (typeof VALID_STATUSES)[number];
  if (!VALID_STATUSES.includes(upper)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUSES.join(", ")}.`
    );
  }
  return upper;
}

function parseOptionalSeverity(value: unknown): AmlSeverity | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseSeverity(value);
}

function actorTypeFromRole(role: PublicAppUser["role"]): "ADMIN" | "SUPPORT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  return "USER";
}

export function createAdminAmlRouter(deps: AdminAmlRouterDeps): express.Router {
  const { platformService, auditLogService, amlService } = deps;
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
      logger.warn({ err, action: event.action }, "[BIN-587 B3-aml] audit append failed");
    });
  }

  // ── Rules ─────────────────────────────────────────────────────────────

  router.get("/api/admin/aml/red-flag-rules", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_AML_READ");
      const rules = await amlService.listRules();
      apiSuccess(res, { rules, count: rules.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/aml/red-flag-rules", async (req, res) => {
    try {
      const actor = await requirePermission(req, "USER_ROLE_WRITE"); // ADMIN only
      if (!isRecordObject(req.body) || !Array.isArray(req.body.rules)) {
        throw new DomainError("INVALID_INPUT", "Payload må inneholde { rules: [...] }.");
      }
      const rules = await amlService.upsertRules(req.body.rules as AmlRuleInput[]);
      fireAudit({
        actorId: actor.id,
        actorType: "ADMIN",
        action: "aml.rules.upsert",
        resource: "aml_rule",
        resourceId: null,
        details: {
          ruleCount: rules.length,
          slugs: rules.map((r) => r.slug),
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { rules, count: rules.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Red-flag instances ────────────────────────────────────────────────

  router.get("/api/admin/aml/red-flags", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_AML_READ");
      const status = parseOptionalStatus(req.query.status);
      const severity = parseOptionalSeverity(req.query.severity);
      const userId = typeof req.query.userId === "string" ? req.query.userId.trim() || undefined : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const flags = await amlService.listRedFlags({ status, severity, userId, limit });
      apiSuccess(res, { flags, count: flags.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/aml/red-flags/:id", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_AML_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const flag = await amlService.getRedFlag(id);
      apiSuccess(res, flag);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/aml/red-flags", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PLAYER_AML_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const userId = mustBeNonEmptyString(req.body.userId, "userId");
      const severity = parseSeverity(req.body.severity);
      const reason = mustBeNonEmptyString(req.body.reason, "reason");
      const ruleSlug =
        typeof req.body.ruleSlug === "string" && req.body.ruleSlug.trim()
          ? req.body.ruleSlug.trim()
          : undefined;
      const transactionId =
        typeof req.body.transactionId === "string" && req.body.transactionId.trim()
          ? req.body.transactionId.trim()
          : undefined;
      const details =
        isRecordObject(req.body.details) ? (req.body.details as Record<string, unknown>) : undefined;
      // Verifiser at brukeren eksisterer før vi logger flag-et.
      await platformService.getUserById(userId);
      const flag = await amlService.createRedFlag({
        userId,
        severity,
        reason,
        ruleSlug,
        transactionId,
        details,
        openedBy: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "aml.flag.create",
        resource: "aml_flag",
        resourceId: flag.id,
        details: {
          userId,
          ruleSlug: flag.ruleSlug,
          severity: flag.severity,
          reason,
          transactionId: transactionId ?? null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, flag);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/aml/red-flags/:id/review", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PLAYER_AML_WRITE");
      const flagId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const outcome = parseOutcome(req.body.outcome);
      const note = mustBeNonEmptyString(req.body.note, "note");
      const flag = await amlService.reviewRedFlag({
        flagId,
        reviewerId: actor.id,
        outcome,
        note,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "aml.flag.review",
        resource: "aml_flag",
        resourceId: flagId,
        details: {
          userId: flag.userId,
          outcome,
          ruleSlug: flag.ruleSlug,
          severity: flag.severity,
          note,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, flag);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Per-player view — plassert under /api/admin/players/:id/aml-flags for
  // konsistens med adminPlayers-routerens URL-skjema.
  router.get("/api/admin/players/:id/aml-flags", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_AML_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      await platformService.getUserById(userId); // 404 hvis ukjent
      const limit = parseLimit(req.query.limit, 100);
      const flags = await amlService.listFlagsForUser(userId, limit);
      apiSuccess(res, { flags, count: flags.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Transaction review ────────────────────────────────────────────────

  router.get("/api/admin/aml/transactions", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_AML_READ");
      const userId = mustBeNonEmptyString(req.query.userId, "userId");
      const from = typeof req.query.from === "string" ? req.query.from.trim() || undefined : undefined;
      const to = typeof req.query.to === "string" ? req.query.to.trim() || undefined : undefined;
      const minAmountRaw =
        typeof req.query.minAmountCents === "string" && req.query.minAmountCents.trim()
          ? Number(req.query.minAmountCents)
          : undefined;
      const minAmountCents =
        minAmountRaw !== undefined && Number.isFinite(minAmountRaw) && minAmountRaw >= 0
          ? Math.floor(minAmountRaw)
          : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const transactions = await amlService.listTransactionsForReview({
        userId,
        from,
        to,
        minAmountCents,
        limit,
      });
      apiSuccess(res, { transactions, count: transactions.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Scan (stub) ───────────────────────────────────────────────────────

  router.post("/api/admin/aml/scan", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PLAYER_AML_WRITE");
      const result = await amlService.scanNow(actor.id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "aml.scan.run",
        resource: "aml_scan",
        resourceId: null,
        details: {
          scanned: result.scanned,
          flagsCreated: result.flagsCreated,
          ruleSlugsEvaluated: result.ruleSlugsEvaluated,
          // scan-stub: rule-engine er ennå ikke implementert; dette
          // endepunktet finnes så admin-web kan bygge UI-en nå.
          stubbed: true,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        ...result,
        stubbed: true,
        note: "Rule-engine kommer som BIN-582 follow-up. scanNow() returnerer null-resultater inntil videre.",
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
