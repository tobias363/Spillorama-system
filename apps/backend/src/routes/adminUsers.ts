/**
 * BIN-587 B6: admin user-CRUD + schedule bulk-upsert.
 *
 * Konsoliderer legacy AdminController (admin) + UserController (staff)
 * til én ressurs `/api/admin/users` — i ny backend er begge samme
 * app_users-tabell differentiert på role-enum (ADMIN|SUPPORT|
 * HALL_OPERATOR). Player-CRUD går via /api/admin/players/*.
 *
 * Endepunkter:
 *   GET    /api/admin/users?role=...              (USER_ROLE_WRITE)
 *   POST   /api/admin/users                       (USER_ROLE_WRITE)
 *   GET    /api/admin/users/:id                   (USER_ROLE_WRITE)
 *   PUT    /api/admin/users/:id                   (USER_ROLE_WRITE)
 *   DELETE /api/admin/users/:id                   (USER_ROLE_WRITE)
 *   POST   /api/admin/users/:id/reset-password    (USER_ROLE_WRITE)
 *   POST   /api/admin/halls/:hallId/schedule/bulk (HALL_WRITE)
 *   DELETE /api/admin/halls/:hallId/schedule/bulk (HALL_WRITE)
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, UserRole, AppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { AuthTokenService } from "../auth/AuthTokenService.js";
import type { EmailService } from "../integration/EmailService.js";
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
import { randomBytes } from "node:crypto";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-users" });

const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPPORT", "HALL_OPERATOR"];

export interface AdminUsersRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  authTokenService: AuthTokenService;
  emailService: EmailService;
  webBaseUrl: string;
  supportEmail: string;
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

function actorTypeFromRole(role: PublicAppUser["role"]): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

function parseOptionalAdminRole(value: unknown): UserRole | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new DomainError("INVALID_INPUT", "role må være en streng.");
  const upper = value.trim().toUpperCase() as UserRole;
  if (!ADMIN_ROLES.includes(upper)) {
    throw new DomainError("INVALID_INPUT", `role må være én av ${ADMIN_ROLES.join(", ")}.`);
  }
  return upper;
}

function publicAdminUser(user: AppUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    surname: user.surname ?? null,
    phone: user.phone ?? null,
    role: user.role,
    hallId: user.hallId,
    kycStatus: user.kycStatus,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function createAdminUsersRouter(deps: AdminUsersRouterDeps): express.Router {
  const {
    platformService,
    auditLogService,
    authTokenService,
    emailService,
    webBaseUrl,
    supportEmail,
  } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-587 B6] audit append failed");
    });
  }

  // ── Admin user list/create ──────────────────────────────────────────

  router.get("/api/admin/users", async (req, res) => {
    try {
      await requirePermission(req, "USER_ROLE_WRITE");
      const role = parseOptionalAdminRole(req.query.role);
      const includeDeleted =
        typeof req.query.includeDeleted === "string" &&
        ["1", "true", "yes"].includes(req.query.includeDeleted.toLowerCase());
      const limit = parseLimit(req.query.limit, 100);
      const users = await platformService.listAdminUsers({ role, includeDeleted, limit });
      apiSuccess(res, {
        users: users.map((u) => publicAdminUser(u)),
        count: users.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/users", async (req, res) => {
    try {
      const actor = await requirePermission(req, "USER_ROLE_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const email = mustBeNonEmptyString(req.body.email, "email");
      const password = mustBeNonEmptyString(req.body.password, "password");
      const displayName = mustBeNonEmptyString(req.body.displayName, "displayName");
      const surname = mustBeNonEmptyString(req.body.surname, "surname");
      const role = parseOptionalAdminRole(req.body.role);
      if (!role) throw new DomainError("INVALID_INPUT", "role er påkrevd.");
      const phone =
        typeof req.body.phone === "string" && req.body.phone.trim() ? req.body.phone.trim() : undefined;
      const hallId =
        typeof req.body.hallId === "string" && req.body.hallId.trim() ? req.body.hallId.trim() : null;
      const created = await platformService.createAdminUser({
        email, password, displayName, surname, role, phone, hallId,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.user.create",
        resource: "user",
        resourceId: created.id,
        details: {
          role: created.role,
          hallId: created.hallId,
          emailDomain: created.email.includes("@") ? created.email.split("@")[1] : null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, publicAdminUser(created));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/users/:id", async (req, res) => {
    try {
      await requirePermission(req, "USER_ROLE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const user = await platformService.getUserById(id);
      if (user.role === "PLAYER") {
        throw new DomainError("INVALID_INPUT", "Bruk /api/admin/players/:id for spillere.");
      }
      apiSuccess(res, publicAdminUser(user));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/users/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "USER_ROLE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await platformService.getUserById(id);
      if (existing.role === "PLAYER") {
        throw new DomainError("INVALID_INPUT", "Bruk /api/admin/players/:id for spillere.");
      }
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const input: { displayName?: string; email?: string; phone?: string } = {};
      if (typeof req.body.displayName === "string") input.displayName = req.body.displayName;
      if (typeof req.body.email === "string") input.email = req.body.email;
      if (typeof req.body.phone === "string") input.phone = req.body.phone;
      const updated = await platformService.updateProfile(id, input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.user.update",
        resource: "user",
        resourceId: id,
        details: { changed: Object.keys(input), role: updated.role },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, publicAdminUser(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/users/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "USER_ROLE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const existing = await platformService.getUserById(id);
      if (existing.role === "PLAYER") {
        throw new DomainError("INVALID_INPUT", "Bruk /api/admin/players/:id/soft-delete for spillere.");
      }
      await platformService.softDeleteAdminUser(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.user.soft_delete",
        resource: "user",
        resourceId: id,
        details: { role: existing.role, hallId: existing.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/users/:id/reset-password", async (req, res) => {
    try {
      const actor = await requirePermission(req, "USER_ROLE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const target = await platformService.getUserById(id);
      if (target.role === "PLAYER") {
        throw new DomainError(
          "INVALID_INPUT",
          "Bruk /api/auth/forgot-password for spillere."
        );
      }
      const { token } = await authTokenService.createToken("password-reset", target.id);
      const base = webBaseUrl.replace(/\/+$/, "");
      const resetLink = `${base}/reset-password/${encodeURIComponent(token)}`;
      try {
        const result = await emailService.sendTemplate({
          to: target.email,
          template: "reset-password",
          context: {
            username: target.displayName,
            resetLink,
            expiresInHours: 1,
            supportEmail,
          },
        });
        if (result.skipped) {
          logger.warn(
            { userId: target.id, resetLink },
            "[BIN-587 B6] SMTP disabled — reset-link not sent; logged for dev only"
          );
        }
      } catch (err) {
        logger.error({ err, userId: target.id }, "[BIN-587 B6] admin reset-password e-post failed");
      }
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.user.reset_password_initiated",
        resource: "user",
        resourceId: target.id,
        details: {
          targetRole: target.role,
          emailDomain: target.email.includes("@") ? target.email.split("@")[1] : null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { initiated: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Schedule bulk-upsert ────────────────────────────────────────────

  router.post("/api/admin/halls/:hallId/schedule/bulk", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const slots = req.body.slots;
      if (!Array.isArray(slots)) {
        throw new DomainError("INVALID_INPUT", "slots må være en array.");
      }
      if (slots.length > 200) {
        throw new DomainError("INVALID_INPUT", "Maks 200 slots per bulk-upsert.");
      }
      const replaceDayOfWeek =
        typeof req.body.replaceDayOfWeek === "number" || typeof req.body.replaceDayOfWeek === "string"
          ? Math.min(6, Math.max(0, Math.floor(Number(req.body.replaceDayOfWeek))))
          : null;
      // Hvis replaceDayOfWeek er satt — slett eksisterende slots for den
      // dagen først, så upsert nye. Ellers append uten å rydde.
      if (replaceDayOfWeek !== null) {
        const existing = await platformService.listScheduleSlots(hallId, { activeOnly: false });
        for (const slot of existing) {
          if (slot.dayOfWeek === replaceDayOfWeek) {
            await platformService.deleteScheduleSlot(slot.id);
          }
        }
      }
      const created = [];
      const errors: Array<{ index: number; error: string }> = [];
      for (let i = 0; i < slots.length; i += 1) {
        const raw = slots[i];
        if (!isRecordObject(raw)) {
          errors.push({ index: i, error: "slot må være et objekt" });
          continue;
        }
        try {
          const slot = await platformService.createScheduleSlot(hallId, {
            gameType: mustBeNonEmptyString(raw.gameType, "slot.gameType"),
            displayName: mustBeNonEmptyString(raw.displayName, "slot.displayName"),
            startTime: mustBeNonEmptyString(raw.startTime, "slot.startTime"),
            dayOfWeek: raw.dayOfWeek !== undefined ? (raw.dayOfWeek as number | null) : null,
            prizeDescription: typeof raw.prizeDescription === "string" ? raw.prizeDescription : "",
            maxTickets: typeof raw.maxTickets === "number" ? raw.maxTickets : undefined,
            isActive: typeof raw.isActive === "boolean" ? raw.isActive : undefined,
            sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : undefined,
          });
          created.push(slot);
        } catch (err) {
          errors.push({
            index: i,
            error: err instanceof DomainError ? err.message : String((err as Error)?.message ?? err),
          });
        }
      }
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.schedule.bulk_upsert",
        resource: "schedule",
        resourceId: hallId,
        details: {
          hallId,
          slotsRequested: slots.length,
          created: created.length,
          errorCount: errors.length,
          replaceDayOfWeek,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        created: created.length,
        slots: created,
        errors,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/halls/:hallId/schedule/bulk", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const dayOfWeekRaw = req.query.dayOfWeek;
      if (dayOfWeekRaw === undefined || dayOfWeekRaw === null || dayOfWeekRaw === "") {
        throw new DomainError("INVALID_INPUT", "dayOfWeek query-param er påkrevd (0-6).");
      }
      const dayOfWeek = Number(dayOfWeekRaw);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new DomainError("INVALID_INPUT", "dayOfWeek må være 0-6.");
      }
      const existing = await platformService.listScheduleSlots(hallId, { activeOnly: false });
      let deleted = 0;
      for (const slot of existing) {
        if (slot.dayOfWeek === dayOfWeek) {
          await platformService.deleteScheduleSlot(slot.id);
          deleted += 1;
        }
      }
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.schedule.bulk_clear_day",
        resource: "schedule",
        resourceId: hallId,
        details: { hallId, dayOfWeek, deleted },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}

// Satisfy unused imports
void randomBytes;
