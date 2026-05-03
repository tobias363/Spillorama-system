import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { UserRole } from "../platform/PlatformService.js";
import { APP_USER_ROLES } from "../platform/PlatformService.js";
import {
  ADMIN_ACCESS_POLICY,
  canAccessAdminPermission,
  getAdminPermissionMap,
  listAdminPermissionsForRole,
} from "../platform/AdminAccessPolicy.js";
import type { PublicAppUser } from "../platform/PlatformService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import type { AdminSubRouterDeps } from "./adminShared.js";

export function createAdminAuthRouter(deps: AdminSubRouterDeps): express.Router {
  const { platformService, emailService, supportEmail, helpers } = deps;
  const { auditAdmin, requireAdminPermissionUser, requireAdminPanelUser } = helpers;
  const router = express.Router();

  function buildAdminPermissionResponse(user: PublicAppUser): Record<string, unknown> {
    return {
      role: user.role,
      permissions: listAdminPermissionsForRole(user.role),
      permissionMap: getAdminPermissionMap(user.role),
      policy: ADMIN_ACCESS_POLICY
    };
  }

  function parseUserRoleInput(value: unknown): UserRole {
    const role = mustBeNonEmptyString(value, "role").toUpperCase();
    if (!APP_USER_ROLES.includes(role as UserRole)) {
      throw new DomainError(
        "INVALID_INPUT",
        `role må være en av: ${APP_USER_ROLES.join(", ")}.`
      );
    }
    return role as UserRole;
  }

  // ── Admin auth ────────────────────────────────────────────────────────────

  router.post("/api/admin/auth/login", async (req, res) => {
    try {
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const session = await platformService.login({
        email,
        password
      });
      if (!canAccessAdminPermission(session.user.role, "ADMIN_PANEL_ACCESS")) {
        await platformService.logout(session.accessToken);
        throw new DomainError(
          "FORBIDDEN",
          `Rollen ${session.user.role} har ikke tilgang til admin-panelet.`
        );
      }
      apiSuccess(res, session);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/auth/logout", async (req, res) => {
    try {
      await requireAdminPanelUser(req);
      const accessToken = getAccessTokenFromRequest(req);
      await platformService.logout(accessToken);
      apiSuccess(res, { loggedOut: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/auth/me", async (req, res) => {
    try {
      const user = await requireAdminPanelUser(req);
      apiSuccess(res, user);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/permissions", async (req, res) => {
    try {
      const user = await requireAdminPanelUser(req);
      apiSuccess(res, buildAdminPermissionResponse(user));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-134: One-time bootstrap endpoint to promote a user to ADMIN when no admin exists.
  // Requires ADMIN_BOOTSTRAP_SECRET env var. Remove after first admin is created.
  router.post("/api/admin/bootstrap", async (req, res) => {
    try {
      const secret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim();
      if (!secret) {
        throw new DomainError("DISABLED", "Bootstrap er deaktivert (ADMIN_BOOTSTRAP_SECRET ikke satt).");
      }
      if (req.body?.secret !== secret) {
        throw new DomainError("UNAUTHORIZED", "Ugyldig bootstrap-hemmelighet.");
      }
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      // Login to get the user, then promote to ADMIN
      const session = await platformService.login({ email, password });
      const updated = await platformService.updateUserRole(session.user.id, "ADMIN");
      apiSuccess(res, { message: `${updated.email} er nå ADMIN.`, role: updated.role });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/users/:userId/role", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "USER_ROLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      const role = parseUserRoleInput(req.body?.role);
      const previous = await platformService.getUserById(userId).catch(() => null);
      const previousRole = previous?.role ?? null;
      const updated = await platformService.updateUserRole(userId, role);
      auditAdmin(req, adminUser, "user.role.change", "user", userId, {
        previousRole,
        newRole: role,
      });
      // Notify the affected user. Fire-and-forget — an SMTP glitch must
      // not block the role change itself.
      if (previous?.email && previousRole !== role) {
        const changedAt = new Date().toISOString();
        void emailService
          .sendTemplate({
            to: previous.email,
            template: "role-changed",
            context: {
              username: previous.displayName || previous.email,
              previousRole: previousRole ?? "Ukjent",
              newRole: role,
              changedAt,
              supportEmail: supportEmail ?? "",
            },
          })
          .catch((err) => {
            void err;
          });
      }
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /**
   * BIN-591: tildel/fjern hall for HALL_OPERATOR. ADMIN-only.
   *
   * P0-1 (pilot 2026-05-02): for PLAYER-rollebrukere holder
   * `updateUserHallAssignment` også `app_hall_registrations` i lock-step
   * med `app_users.hall_id` så agent-portalens cash-in/out ikke feiler
   * med PLAYER_NOT_AT_HALL. Actor-id videreføres for audit-spor på
   * `activated_by_user_id`.
   *
   * Body: { hallId: string | null }
   */
  router.put("/api/admin/users/:userId/hall", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "USER_ROLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      const rawHallId = req.body?.hallId;
      const hallId =
        rawHallId === null || rawHallId === undefined || rawHallId === ""
          ? null
          : typeof rawHallId === "string"
            ? rawHallId.trim() || null
            : (() => {
                throw new DomainError("INVALID_INPUT", "hallId må være en streng eller null.");
              })();
      const updated = await platformService.updateUserHallAssignment(
        userId,
        hallId,
        adminUser.id,
      );
      auditAdmin(req, adminUser, "user.hall.assign", "user", userId, { hallId });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
