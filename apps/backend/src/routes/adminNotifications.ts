/**
 * BIN-FCM: admin broadcast-endpoints.
 *
 * Lar ADMIN sende push-varsler til spillere (marketing, viktige
 * driftsmeldinger, hall-annonser). Tre scope-moduser:
 *   - `userIds`: spesifikk liste med user-IDer
 *   - `hallId`: alle aktive spillere i én hall
 *   - `all`: alle aktive spillere (kun ADMIN, confirm-flag påkrevd)
 *
 * Alt går via FcmPushService.sendBulk() — rate-limit + per-rad-audit
 * håndteres der. Route-laget bare bygger user-listen.
 */

import express from "express";
import type { Pool } from "pg";
import type { PlatformService, PublicAppUser, UserRole } from "../platform/PlatformService.js";
import type { FcmPushService } from "../notifications/FcmPushService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "../notifications/types.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { DomainError } from "../game/BingoEngine.js";

export interface AdminNotificationsRouterDeps {
  platformService: PlatformService;
  fcmPushService: FcmPushService;
  auditLogService: AuditLogService;
  pool: Pool;
  schema: string;
  /** Permission to use for admin-broadcast (reuses ADMIN_PANEL_ACCESS by default). */
  broadcastPermission?: AdminPermission;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error("Ugyldig schema-navn.");
  }
  return schema;
}

function mapRoleToActorType(role: UserRole): AuditActorType {
  switch (role) {
    case "ADMIN": return "ADMIN";
    case "HALL_OPERATOR": return "HALL_OPERATOR";
    case "SUPPORT": return "SUPPORT";
    case "PLAYER": return "PLAYER";
    default: return "USER";
  }
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

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export function createAdminNotificationsRouter(
  deps: AdminNotificationsRouterDeps,
): express.Router {
  const schema = assertSchemaName(deps.schema);
  const permission: AdminPermission = deps.broadcastPermission ?? "ADMIN_PANEL_ACCESS";
  const router = express.Router();

  async function requireAdmin(req: express.Request): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await deps.platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission, "Ikke tilgang til å sende varsler.");
    return user;
  }

  async function resolveTargetUsers(input: {
    userIds?: string[];
    hallId?: string | null;
    all?: boolean;
    allConfirm?: boolean;
  }): Promise<string[]> {
    if (input.userIds && input.userIds.length > 0) {
      return input.userIds.map((u) => String(u)).filter((u) => u.trim().length > 0);
    }
    if (input.hallId) {
      // Filtrer ut soft-deleted (BIN-587 B2.3) og spillere som er blokkert
      // i hall via app_player_hall_status.
      const result = await deps.pool.query<{ id: string }>(
        `SELECT u.id FROM "${schema}"."app_users" u
          LEFT JOIN "${schema}"."app_player_hall_status" s
            ON s.user_id = u.id AND s.hall_id = $1
          WHERE u.hall_id = $1
            AND u.role = 'PLAYER'
            AND u.deleted_at IS NULL
            AND COALESCE(s.is_active, true) = true`,
        [input.hallId],
      );
      return result.rows.map((r) => r.id);
    }
    if (input.all === true) {
      if (input.allConfirm !== true) {
        throw new DomainError(
          "CONFIRMATION_REQUIRED",
          "Send til alle krever eksplisitt confirm=true i body.",
        );
      }
      const result = await deps.pool.query<{ id: string }>(
        `SELECT id FROM "${schema}"."app_users"
          WHERE role = 'PLAYER'
            AND deleted_at IS NULL`,
      );
      return result.rows.map((r) => r.id);
    }
    throw new DomainError(
      "INVALID_INPUT",
      "Ett av feltene userIds (array), hallId eller all=true + confirm=true må være satt.",
    );
  }

  // POST /api/admin/notifications/broadcast — send push til spillere.
  router.post("/api/admin/notifications/broadcast", async (req, res) => {
    try {
      const actor = await requireAdmin(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const rawType = body.type;
      if (!isNotificationType(rawType)) {
        throw new DomainError(
          "INVALID_INPUT",
          `type må være en av: ${NOTIFICATION_TYPES.join(", ")}.`,
        );
      }
      const title = mustBeNonEmptyString(body.title, "title");
      const bodyText = mustBeNonEmptyString(body.body, "body");
      const data =
        typeof body.data === "object" && body.data !== null && !Array.isArray(body.data)
          ? (body.data as Record<string, unknown>)
          : {};

      const userIds = Array.isArray(body.userIds) ? (body.userIds as string[]) : undefined;
      const hallId = typeof body.hallId === "string" ? body.hallId : null;
      const all = body.all === true;
      const allConfirm = body.confirm === true;

      const targets = await resolveTargetUsers({ userIds, hallId, all, allConfirm });
      if (targets.length === 0) {
        throw new DomainError("NO_RECIPIENTS", "Ingen spillere matchet scopet.");
      }

      const result = await deps.fcmPushService.sendBulk(targets, {
        type: rawType,
        title,
        body: bodyText,
        data,
      });

      void deps.auditLogService
        .record({
          actorId: actor.id,
          actorType: mapRoleToActorType(actor.role),
          action: "notification.broadcast",
          resource: "notification",
          resourceId: null,
          details: {
            type: rawType,
            title,
            scope: userIds && userIds.length > 0
              ? { kind: "userIds", count: userIds.length }
              : hallId
                ? { kind: "hallId", hallId }
                : { kind: "all" },
            targets: targets.length,
            sent: result.sent,
            failed: result.failed,
            skipped: result.skipped,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch(() => { /* fire-and-forget */ });

      apiSuccess(res, {
        targets: targets.length,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
