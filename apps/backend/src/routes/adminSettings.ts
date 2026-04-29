/**
 * BIN-677: admin-router for system settings.
 *
 * Endepunkter:
 *   GET   /api/admin/settings       — liste av alle system-wide settings
 *   PATCH /api/admin/settings       — oppdater én eller flere nøkler
 *
 * Rolle-krav: SETTINGS_READ for GET, SETTINGS_WRITE (ADMIN-only) for PATCH.
 *
 * Audit-hendelser:
 *   admin.settings.update — når PATCH endrer én eller flere nøkler.
 *
 * PATCH-body:
 *   { "patches": [{ "key": "system.timezone", "value": "Europe/Oslo" }, ...] }
 * eller (convenience) et objekt:
 *   { "system.timezone": "Europe/Oslo", "compliance.daily_spending_default": 5000 }
 * Begge former støttes og normaliseres før validering.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  SettingsService,
  UpdateSystemSettingPatch,
} from "../admin/SettingsService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-settings" });

export interface AdminSettingsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  settingsService: SettingsService;
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

/**
 * Normaliser body til en liste av patches. Støtter to former:
 *   1. { patches: [{key, value}, ...] }   (eksplisitt)
 *   2. { "key1": value1, "key2": value2 } (flat objekt)
 */
function extractPatches(body: unknown): UpdateSystemSettingPatch[] {
  if (!isRecordObject(body)) {
    throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
  }
  if (Array.isArray((body as Record<string, unknown>).patches)) {
    const raw = (body as { patches: unknown[] }).patches;
    return raw.map((entry, i) => {
      if (!isRecordObject(entry)) {
        throw new DomainError(
          "INVALID_INPUT",
          `patches[${i}] må være et objekt.`
        );
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.key !== "string" || !e.key.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          `patches[${i}].key er påkrevd.`
        );
      }
      if (!("value" in e)) {
        throw new DomainError(
          "INVALID_INPUT",
          `patches[${i}].value er påkrevd.`
        );
      }
      return { key: e.key.trim(), value: e.value };
    });
  }
  // Flat objekt-form — en nøkkel per felt.
  const flat = body as Record<string, unknown>;
  const keys = Object.keys(flat);
  if (keys.length === 0) {
    throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
  }
  return keys.map((k) => ({ key: k, value: flat[k] }));
}

export function createAdminSettingsRouter(
  deps: AdminSettingsRouterDeps
): express.Router {
  const { platformService, auditLogService, settingsService } = deps;
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
        "[BIN-677] audit append failed"
      );
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/settings", async (req, res) => {
    try {
      await requirePermission(req, "SETTINGS_READ");
      const settings = await settingsService.list();
      apiSuccess(res, {
        settings,
        count: settings.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/settings", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SETTINGS_WRITE");
      const patches = extractPatches(req.body);
      const settings = await settingsService.patch(patches, actor.id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.settings.update",
        resource: "system_settings",
        resourceId: null,
        details: {
          changedKeys: patches.map((p) => p.key),
          count: patches.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        settings,
        count: settings.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
