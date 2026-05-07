/**
 * BIN-676 + BIN-680: admin-router for CMS content + FAQ + versjons-flyt.
 *
 * Endepunkter:
 *   GET    /api/admin/cms/faq                       — liste (før :slug for å
 *                                                     unngå Express-param-kollisjon)
 *   POST   /api/admin/cms/faq                       — opprett
 *   PATCH  /api/admin/cms/faq/:id                   — oppdater
 *   DELETE /api/admin/cms/faq/:id                   — slett
 *   GET    /api/admin/cms/:slug                     — hent tekst-side (live for
 *                                                     regulatoriske slugs)
 *   PUT    /api/admin/cms/:slug                     — oppdater tekst-side (oppretter
 *                                                     draft for regulatoriske slugs)
 *
 *   BIN-680 Lag 1 — versjons-endepunkter:
 *   GET    /api/admin/cms/:slug/history             — liste alle versjoner
 *   GET    /api/admin/cms/:slug/versions/:id        — én versjon
 *   POST   /api/admin/cms/:slug/versions            — opprett draft
 *   POST   /api/admin/cms/:slug/versions/:id/submit   — draft → review
 *   POST   /api/admin/cms/:slug/versions/:id/approve  — review → approved (4-øyne)
 *   POST   /api/admin/cms/:slug/versions/:id/publish  — approved → live
 *
 * Rolle-krav: CMS_READ for GETs, CMS_WRITE (ADMIN-only) for skriv + alle
 * versjons-transitions. Approve håndhever i tillegg 4-øyne (approvedBy !==
 * createdBy) — både service- og DB-CHECK-lag.
 *
 * Audit-hendelser (regulatorisk — CMS-endringer må kunne rekonstrueres):
 *   admin.cms.update                      — PUT /api/admin/cms/:slug (ikke-versjonert)
 *   admin.cms.faq.create/update/delete    — FAQ CRUD
 *   admin.spillvett.text.draft_created    — ny draft for regulatorisk slug
 *   admin.spillvett.text.submitted_for_review
 *   admin.spillvett.text.approved         — inkluderer { approvedBy, createdBy }
 *                                           for 4-øyne-sporbarhet
 *   admin.spillvett.text.published        — inkluderer { previousLiveVersionId }
 *
 * BIN-680-gate fjernet: PUT for `responsible-gaming` oppretter nå ny
 * draft i stedet for å returnere FEATURE_DISABLED. Publisering via
 * versjons-endepunktene er et separat admin-steg.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  CmsService,
  type CreateFaqInput,
  type UpdateFaqInput,
  type CmsContentVersion,
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
    assertAdminPermission(user, permission);
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
  // BIN-680 Lag 1: for regulatoriske slugs (CMS_VERSION_HISTORY_REQUIRED —
  // responsible-gaming) oppretter CmsService.updateContent() en ny draft-
  // versjon i stedet for å upserte. Fasaden beholdes for bakoverkompat,
  // men audit-event blir `admin.spillvett.text.draft_created` i stedet for
  // `admin.cms.update` slik at compliance kan skille versjonert-flyt fra
  // vanlig upsert.
  router.put("/api/admin/cms/:slug", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const rawSlug = req.params.slug ?? "";
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const content = (req.body as { content?: unknown }).content;
      const updated = await cmsService.updateContent(rawSlug, content, actor.id);
      // Etter updateContent() vet vi at slug er validert — gjenbruk den
      // kanoniske verdien fra resultatet for audit.
      const isVersioned = CmsService.requiresVersionHistory(updated.slug);
      if (isVersioned) {
        // Slå opp den nyeste versjonen for å kunne audit-logge versjons-id.
        // getVersionHistory() returnerer sortert DESC så første rad er ny draft.
        const history = await cmsService.getVersionHistory(updated.slug);
        const draft = history[0];
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.spillvett.text.draft_created",
          resource: "cms_content_version",
          resourceId: draft?.id ?? updated.slug,
          details: {
            slug: updated.slug,
            versionNumber: draft?.versionNumber ?? null,
            createdBy: actor.id,
            contentLength: updated.content.length,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      } else {
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
      }
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-680 Lag 1: versjons-endepunkter ──────────────────────────────

  /**
   * Serialiser CmsContentVersion for JSON-respons. Identisk med intern
   * interface, men eksplisitt holdepunkt gjør kontrakt-endringer synlige.
   */
  function serializeVersion(v: CmsContentVersion): Record<string, unknown> {
    return {
      id: v.id,
      slug: v.slug,
      versionNumber: v.versionNumber,
      content: v.content,
      status: v.status,
      createdByUserId: v.createdByUserId,
      createdAt: v.createdAt,
      approvedByUserId: v.approvedByUserId,
      approvedAt: v.approvedAt,
      publishedByUserId: v.publishedByUserId,
      publishedAt: v.publishedAt,
      retiredAt: v.retiredAt,
    };
  }

  // GET history — krever bare READ-tilgang (admin kan se historikk).
  router.get("/api/admin/cms/:slug/history", async (req, res) => {
    try {
      await requirePermission(req, "CMS_READ");
      const slug = req.params.slug ?? "";
      const history = await cmsService.getVersionHistory(slug);
      apiSuccess(res, {
        slug,
        versions: history.map(serializeVersion),
        count: history.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET enkelt-versjon.
  router.get("/api/admin/cms/:slug/versions/:id", async (req, res) => {
    try {
      await requirePermission(req, "CMS_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const version = await cmsService.getVersionById(id);
      // Sanity: slug i URL må matche versjonens slug.
      if (version.slug !== req.params.slug) {
        throw new DomainError(
          "CMS_VERSION_SLUG_MISMATCH",
          `Versjon ${id} tilhører ikke slug '${req.params.slug}'.`
        );
      }
      apiSuccess(res, serializeVersion(version));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST opprett draft. PUT-endepunktet oppretter også draft (ekvivalent);
  // dette endepunktet er ment for klienter som eksplisitt vil bruke det
  // versjonerte API-et uten å gå via den gamle upsert-semantikken.
  router.post("/api/admin/cms/:slug/versions", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const slug = req.params.slug ?? "";
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const content = (req.body as { content?: unknown }).content;
      const draft = await cmsService.createVersion({
        slug,
        content,
        createdByUserId: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.spillvett.text.draft_created",
        resource: "cms_content_version",
        resourceId: draft.id,
        details: {
          slug: draft.slug,
          versionNumber: draft.versionNumber,
          createdBy: actor.id,
          contentLength: draft.content.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, serializeVersion(draft));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST submit — draft → review.
  router.post("/api/admin/cms/:slug/versions/:id/submit", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const updated = await cmsService.submitForReview({
        versionId: id,
        userId: actor.id,
      });
      if (updated.slug !== req.params.slug) {
        throw new DomainError(
          "CMS_VERSION_SLUG_MISMATCH",
          `Versjon ${id} tilhører ikke slug '${req.params.slug}'.`
        );
      }
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.spillvett.text.submitted_for_review",
        resource: "cms_content_version",
        resourceId: updated.id,
        details: {
          versionId: updated.id,
          slug: updated.slug,
          versionNumber: updated.versionNumber,
          userId: actor.id,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, serializeVersion(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST approve — review → approved, håndhever 4-øyne.
  router.post("/api/admin/cms/:slug/versions/:id/approve", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const updated = await cmsService.approveVersion({
        versionId: id,
        approvedByUserId: actor.id,
      });
      if (updated.slug !== req.params.slug) {
        throw new DomainError(
          "CMS_VERSION_SLUG_MISMATCH",
          `Versjon ${id} tilhører ikke slug '${req.params.slug}'.`
        );
      }
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.spillvett.text.approved",
        resource: "cms_content_version",
        resourceId: updated.id,
        details: {
          versionId: updated.id,
          slug: updated.slug,
          versionNumber: updated.versionNumber,
          approvedBy: actor.id,
          createdBy: updated.createdByUserId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, serializeVersion(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // POST publish — approved → live, retirer forrige live.
  router.post("/api/admin/cms/:slug/versions/:id/publish", async (req, res) => {
    try {
      const actor = await requirePermission(req, "CMS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const result = await cmsService.publishVersion({
        versionId: id,
        publishedByUserId: actor.id,
      });
      if (result.live.slug !== req.params.slug) {
        throw new DomainError(
          "CMS_VERSION_SLUG_MISMATCH",
          `Versjon ${id} tilhører ikke slug '${req.params.slug}'.`
        );
      }
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.spillvett.text.published",
        resource: "cms_content_version",
        resourceId: result.live.id,
        details: {
          versionId: result.live.id,
          slug: result.live.slug,
          versionNumber: result.live.versionNumber,
          publishedBy: actor.id,
          previousLiveVersionId: result.previousLiveVersionId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        ...serializeVersion(result.live),
        previousLiveVersionId: result.previousLiveVersionId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
