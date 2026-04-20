/**
 * BIN-676: admin-router for CMS content + FAQ.
 *
 * Endepunkter (matches legacy cmsController.js):
 *   GET  /api/admin/cms/faq           → liste (før :slug for å unngå
 *                                        Express-parameter-kollisjon)
 *   POST /api/admin/cms/faq           → opprett
 *   PATCH  /api/admin/cms/faq/:id     → oppdater
 *   DELETE /api/admin/cms/faq/:id     → slett
 *   GET  /api/admin/cms/:slug         → hent tekst-side
 *   PUT  /api/admin/cms/:slug         → oppdater tekst-side
 *
 * Rolle-krav: CMS_READ for GETs, CMS_WRITE (ADMIN-only) for skriv.
 *
 * Audit-hendelser (regulatorisk — CMS-endringer må kunne rekonstrueres):
 *   admin.cms.update             — PUT /api/admin/cms/:slug
 *   admin.cms.faq.create         — POST /api/admin/cms/faq
 *   admin.cms.faq.update         — PATCH /api/admin/cms/faq/:id
 *   admin.cms.faq.delete         — DELETE /api/admin/cms/faq/:id
 *
 * FEATURE_DISABLED-gate:
 *   PUT /api/admin/cms/responsible-gaming returnerer HTTP 400 +
 *   error.code='FEATURE_DISABLED'. Service-laget eier gaten (se CmsService.
 *   CMS_VERSION_HISTORY_REQUIRED). Blokkert av BIN-680 — gaten fjernes når
 *   versjons-historikk-tabellen + diff-logging er på plass.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  CmsService,
  CreateFaqInput,
  UpdateFaqInput,
} from "../admin/CmsService.js";
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
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-cms" });

export interface AdminCmsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  cmsService: CmsService;
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

function actorTypeFromRole(
  role: PublicAppUser["role"]
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

function parseOptionalSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError("INVALID_INPUT", "sortOrder må være et tall.");
  }
  return value;
}

export function createAdminCmsRouter(
  deps: AdminCmsRouterDeps
): express.Router {
  const { platformService, auditLogService, cmsService } = deps;
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
      logger.warn(
        { err, action: event.action },
        "[BIN-676] audit append failed"
      );
    });
  }

  // ── FAQ: list ────────────────────────────────────────────────────────
  // FAQ-rutene registreres FØR /:slug for å unngå at Express matcher
  // "faq" som en slug-parameter. (Regex-ordren matters i Express 4.x).

  router.get("/api/admin/cms/faq", async (req, res) => {
    try {
      await requirePermission(req, "CMS_READ");
      const faqs = await cmsService.listFaq();
      apiSuccess(res, {
        faqs,
        count: faqs.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── FAQ: create ──────────────────────────────────────────────────────

  router.post("/api/admin/cms/faq", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const input: CreateFaqInput = {
        question: mustBeNonEmptyString(body.question, "question"),
        answer: mustBeNonEmptyString(body.answer, "answer"),
        createdBy: actor.id,
      };
      const sortOrder = parseOptionalSortOrder(body.sortOrder);
      if (sortOrder !== undefined) input.sortOrder = sortOrder;

      const faq = await cmsService.createFaq(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.cms.faq.create",
        resource: "cms_faq",
        resourceId: faq.id,
        details: {
          question: faq.question,
          sortOrder: faq.sortOrder,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, faq);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── FAQ: update ──────────────────────────────────────────────────────

  router.patch("/api/admin/cms/faq/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateFaqInput = {};

      if (body.question !== undefined) {
        update.question = mustBeNonEmptyString(body.question, "question");
      }
      if (body.answer !== undefined) {
        update.answer = mustBeNonEmptyString(body.answer, "answer");
      }
      const sortOrder = parseOptionalSortOrder(body.sortOrder);
      if (sortOrder !== undefined) update.sortOrder = sortOrder;

      const faq = await cmsService.updateFaq(id, update, actor.id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.cms.faq.update",
        resource: "cms_faq",
        resourceId: faq.id,
        details: {
          changed: Object.keys(update),
          sortOrder: faq.sortOrder,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, faq);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── FAQ: delete ──────────────────────────────────────────────────────

  router.delete("/api/admin/cms/faq/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      // Hent først for å kunne audit-logge hva som ble slettet.
      const existing = await cmsService.getFaq(id);
      await cmsService.deleteFaq(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.cms.faq.delete",
        resource: "cms_faq",
        resourceId: existing.id,
        details: {
          question: existing.question,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true, id: existing.id });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Content: get ─────────────────────────────────────────────────────

  router.get("/api/admin/cms/:slug", async (req, res) => {
    try {
      await requirePermission(req, "CMS_READ");
      const content = await cmsService.getContent(req.params.slug ?? "");
      apiSuccess(res, content);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Content: update ──────────────────────────────────────────────────
  //
  // NB: responsible-gaming returnerer HTTP 400 + FEATURE_DISABLED via
  // CmsService.updateContent — versjons-historikk-krav (pengespill-
  // forskriften §11) ikke implementert før BIN-680.
  router.put("/api/admin/cms/:slug", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const slug = req.params.slug ?? "";
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const content = (req.body as { content?: unknown }).content;
      const updated = await cmsService.updateContent(slug, content, actor.id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.cms.update",
        resource: "cms_content",
        resourceId: updated.slug,
        details: {
          slug: updated.slug,
          contentLength: updated.content.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
