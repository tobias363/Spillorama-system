/**
 * GAP #23: admin-router for screen-saver-bilder.
 *
 * Endepunkter:
 *   GET    /api/admin/settings/screen-saver               — liste alle bilder
 *   POST   /api/admin/settings/screen-saver               — legg til nytt bilde
 *   GET    /api/admin/settings/screen-saver/:id           — hent ett bilde
 *   PUT    /api/admin/settings/screen-saver/:id           — oppdater bilde
 *   DELETE /api/admin/settings/screen-saver/:id           — soft-delete bilde
 *   PUT    /api/admin/settings/screen-saver/:id/order     — bytt display_order for ett bilde
 *   PUT    /api/admin/settings/screen-saver/order         — batch reorder
 *
 * Rolle-krav: SETTINGS_READ for GET, SETTINGS_WRITE (ADMIN-only) for skriving.
 *
 * Audit-hendelser:
 *   admin.screen_saver.create     — POST
 *   admin.screen_saver.update     — PUT (single)
 *   admin.screen_saver.delete     — DELETE
 *   admin.screen_saver.reorder    — PUT order (single eller batch)
 *
 * Image-upload-flow:
 *   Admin-UI laster opp bildet til CDN/Cloudinary client-side og sender
 *   ferdig URL hit. Server-side upload-flyt er TODO (BIN-XXX) når
 *   CLOUDINARY_*-env er klare.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  ScreenSaverService,
  CreateScreenSaverImageInput,
  UpdateScreenSaverImageInput,
  ReorderEntry,
} from "../admin/ScreenSaverService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-screen-saver" });

export interface AdminScreenSaverRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  screenSaverService: ScreenSaverService;
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

function parseOptionalIntField(
  body: Record<string, unknown>,
  field: string
): number | undefined {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et heltall.`);
  }
  return v;
}

function parseOptionalBooleanField(
  body: Record<string, unknown>,
  field: string
): boolean | undefined {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") {
    throw new DomainError("INVALID_INPUT", `${field} må være boolean.`);
  }
  return v;
}

function parseOptionalNullableHallId(
  body: Record<string, unknown>
): string | null | undefined {
  if (!("hallId" in body)) return undefined;
  const v = body.hallId;
  if (v === null) return null;
  if (typeof v !== "string") {
    throw new DomainError("INVALID_INPUT", "hallId må være streng eller null.");
  }
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function parseReorderEntries(body: unknown): ReorderEntry[] {
  if (!isRecordObject(body)) {
    throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
  }
  const raw = (body as Record<string, unknown>).entries;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainError("INVALID_INPUT", "entries[] er påkrevd og kan ikke være tom.");
  }
  return raw.map((entry, i) => {
    if (!isRecordObject(entry)) {
      throw new DomainError("INVALID_INPUT", `entries[${i}] må være et objekt.`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id.trim()) {
      throw new DomainError("INVALID_INPUT", `entries[${i}].id er påkrevd.`);
    }
    if (typeof e.displayOrder !== "number" || !Number.isInteger(e.displayOrder)) {
      throw new DomainError(
        "INVALID_INPUT",
        `entries[${i}].displayOrder må være et heltall.`
      );
    }
    return { id: e.id.trim(), displayOrder: e.displayOrder };
  });
}

export function createAdminScreenSaverRouter(
  deps: AdminScreenSaverRouterDeps
): express.Router {
  const { platformService, auditLogService, screenSaverService } = deps;
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
        "[GAP #23] audit append failed"
      );
    });
  }

  // ── List ──────────────────────────────────────────────────────────────

  router.get("/api/admin/settings/screen-saver", async (req, res) => {
    try {
      await requirePermission(req, "SETTINGS_READ");
      // Filter:
      //   - ?hallId=<id>   — kun bilder for én hall
      //   - ?hallId=null   — kun globale (eksplisitt)
      //   - (ingen)        — alle (globale + per-hall)
      const hallIdQuery = req.query.hallId;
      let hallIdFilter: string | null | undefined;
      if (typeof hallIdQuery === "string") {
        hallIdFilter = hallIdQuery === "null" ? null : hallIdQuery;
      }
      const activeOnly = req.query.activeOnly === "true";
      const includeDeleted = req.query.includeDeleted === "true";
      const images = await screenSaverService.list({
        hallId: hallIdFilter,
        activeOnly,
        includeDeleted,
      });
      apiSuccess(res, { images, count: images.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Get one ───────────────────────────────────────────────────────────

  router.get("/api/admin/settings/screen-saver/:id", async (req, res) => {
    try {
      await requirePermission(req, "SETTINGS_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const image = await screenSaverService.get(id);
      apiSuccess(res, image);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Create ────────────────────────────────────────────────────────────

  router.post("/api/admin/settings/screen-saver", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SETTINGS_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body as Record<string, unknown>;
      const imageUrl = mustBeNonEmptyString(body.imageUrl, "imageUrl");
      const input: CreateScreenSaverImageInput = {
        imageUrl,
        hallId: parseOptionalNullableHallId(body),
        displaySeconds: parseOptionalIntField(body, "displaySeconds"),
        displayOrder: parseOptionalIntField(body, "displayOrder"),
        isActive: parseOptionalBooleanField(body, "isActive"),
        createdBy: actor.id,
      };
      const created = await screenSaverService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.screen_saver.create",
        resource: "screen_saver_image",
        resourceId: created.id,
        details: {
          hallId: created.hallId,
          displayOrder: created.displayOrder,
          displaySeconds: created.displaySeconds,
          isActive: created.isActive,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, created);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Reorder: batch (PUT /order) ───────────────────────────────────────
  // NB: må stå FØR `/screen-saver/:id` slik at "order" ikke parses som :id.

  router.put("/api/admin/settings/screen-saver/order", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SETTINGS_WRITE");
      const entries = parseReorderEntries(req.body);
      const updated = await screenSaverService.reorder(entries);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.screen_saver.reorder",
        resource: "screen_saver_image",
        resourceId: null,
        details: {
          batch: true,
          count: entries.length,
          ids: entries.map((e) => e.id),
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { images: updated, count: updated.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Update ────────────────────────────────────────────────────────────

  router.put("/api/admin/settings/screen-saver/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SETTINGS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body as Record<string, unknown>;
      const update: UpdateScreenSaverImageInput = {};
      if ("imageUrl" in body) {
        update.imageUrl = mustBeNonEmptyString(body.imageUrl, "imageUrl");
      }
      if ("displayOrder" in body) {
        update.displayOrder = parseOptionalIntField(body, "displayOrder");
      }
      if ("displaySeconds" in body) {
        update.displaySeconds = parseOptionalIntField(body, "displaySeconds");
      }
      if ("isActive" in body) {
        update.isActive = parseOptionalBooleanField(body, "isActive");
      }
      const updated = await screenSaverService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.screen_saver.update",
        resource: "screen_saver_image",
        resourceId: updated.id,
        details: {
          changedFields: Object.keys(update),
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Delete (soft) ─────────────────────────────────────────────────────

  router.delete("/api/admin/settings/screen-saver/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SETTINGS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await screenSaverService.remove(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.screen_saver.delete",
        resource: "screen_saver_image",
        resourceId: id,
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true, id });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Reorder: single (PUT /:id/order) ──────────────────────────────────

  router.put("/api/admin/settings/screen-saver/:id/order", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SETTINGS_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const displayOrder = parseOptionalIntField(
        req.body as Record<string, unknown>,
        "displayOrder"
      );
      if (displayOrder === undefined) {
        throw new DomainError("INVALID_INPUT", "displayOrder er påkrevd.");
      }
      const updated = await screenSaverService.reorder([{ id, displayOrder }]);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.screen_saver.reorder",
        resource: "screen_saver_image",
        resourceId: id,
        details: { displayOrder, batch: false },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { images: updated, count: updated.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
