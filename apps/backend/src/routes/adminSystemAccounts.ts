/**
 * PR-B (2026-05-07): Admin-router for system-account API-keys.
 *
 * Endepunkter:
 *   POST   /api/admin/system-accounts          — opprett ny key (returnerer apiKey ÉN gang)
 *   GET    /api/admin/system-accounts          — list (uten api_key_hash)
 *   DELETE /api/admin/system-accounts/:id      — revoke (krever reason)
 *
 * RBAC: alle tre er USER_ROLE_WRITE (kun ADMIN). Dette matcher mønsteret
 * for andre destruktive admin-CRUD-operasjoner (USER_ROLE_WRITE = "ADMIN" only).
 *
 * Audit:
 *   - `system_account.create` med permissions, hallScope, createdBy
 *   - `system_account.revoke` med reason, revokedBy
 *   - `system_account.list` logges IKKE (read-only støy)
 *
 * Sikkerhet:
 *   - Klartekst api_key vises ÉN gang i POST-svaret. Aldri i GET/list.
 *   - api_key_prefixes (sa_xxxxxxxx) logges ved opprettelse for ops-
 *     korrelasjon, men aldri full key.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, UserRole, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  assertAdminPermission,
  ADMIN_ACCESS_POLICY,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import { SystemAccountService, apiKeyPrefix } from "../auth/SystemAccountService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-system-accounts-router" });

export interface AdminSystemAccountsRouterDeps {
  platformService: PlatformService;
  systemAccountService: SystemAccountService;
  auditLogService: AuditLogService;
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

function mapRoleToActorType(role: UserRole): AuditActorType {
  switch (role) {
    case "ADMIN": return "ADMIN";
    case "HALL_OPERATOR": return "HALL_OPERATOR";
    case "SUPPORT": return "SUPPORT";
    case "PLAYER": return "PLAYER";
    case "AGENT": return "AGENT";
  }
}

/**
 * Valider at en string er en gyldig AdminPermission-key. Vi sjekker mot
 * ADMIN_ACCESS_POLICY-katalogen i stedet for en stor switch — det forhindrer
 * typos i admin-UI fra å persistere ugyldige permissions.
 */
function isValidAdminPermission(value: unknown): value is AdminPermission {
  if (typeof value !== "string") return false;
  return Object.prototype.hasOwnProperty.call(ADMIN_ACCESS_POLICY, value);
}

function parsePermissionsInput(raw: unknown): AdminPermission[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "permissions må være en ikke-tom array av AdminPermission-strings."
    );
  }
  const result: AdminPermission[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isValidAdminPermission(item)) {
      throw new DomainError(
        "INVALID_INPUT",
        `Ugyldig permission: ${typeof item === "string" ? item : "(non-string)"}.`
      );
    }
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  if (result.length === 0) {
    throw new DomainError("INVALID_INPUT", "permissions må inneholde minst én gyldig permission.");
  }
  return result;
}

function parseHallScopeInput(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) {
    throw new DomainError("INVALID_INPUT", "hallScope må være en array av hall-IDer eller null.");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      throw new DomainError("INVALID_INPUT", "hallScope må kun inneholde non-empty strings.");
    }
    const trimmed = item.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  // Tom array tolkes som "ingen haller" — sannsynligvis ikke det kalleren
  // mener. Vi fail-closed-er for å unngå å lage en "death-switch"-key.
  if (result.length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "hallScope må enten være null (alle haller) eller en ikke-tom array."
    );
  }
  return result;
}

export function createAdminSystemAccountsRouter(
  deps: AdminSystemAccountsRouterDeps
): express.Router {
  const { platformService, systemAccountService, auditLogService } = deps;
  const router = express.Router();

  /**
   * Rute-internal helper: autentiser caller + sjekk permission. Bruker
   * object-form av `assertAdminPermission` slik at SystemAccount-keys
   * også får sin whitelist håndhevet (selv om denne ruten typisk skal
   * brukes av menneskelige ADMIN-er for å opprette OG revoke andre keys).
   */
  async function requireAdminUser(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user, permission);
    return user;
  }

  // ── POST /api/admin/system-accounts ────────────────────────────────────────
  router.post("/api/admin/system-accounts", async (req, res) => {
    try {
      const admin = await requireAdminUser(req, "USER_ROLE_WRITE");
      const body = isRecordObject(req.body) ? req.body : {};
      const name = mustBeNonEmptyString(body.name, "name");
      const description = typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : undefined;
      const permissions = parsePermissionsInput(body.permissions);
      const hallScope = body.hallScope === undefined ? null : parseHallScopeInput(body.hallScope);

      const { account, apiKey } = await systemAccountService.create({
        name,
        description,
        permissions,
        hallScope,
        createdByUserId: admin.id,
      });

      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "system_account.create",
        resource: "system_account",
        resourceId: account.id,
        details: {
          name: account.name,
          permissions: account.permissions,
          hallScope: account.hallScope,
          apiKeyPrefix: apiKeyPrefix(apiKey),
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      logger.info(
        { accountId: account.id, name: account.name, apiKeyPrefix: apiKeyPrefix(apiKey) },
        "[PR-B] system-account opprettet"
      );

      apiSuccess(res, {
        id: account.id,
        name: account.name,
        description: account.description,
        permissions: account.permissions,
        hallScope: account.hallScope,
        isActive: account.isActive,
        createdAt: account.createdAt,
        // Klartekst-keyen vises ÉN gang. Klient skal lagre den umiddelbart
        // og ikke be om den igjen.
        apiKey,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/system-accounts ─────────────────────────────────────────
  router.get("/api/admin/system-accounts", async (req, res) => {
    try {
      await requireAdminUser(req, "USER_ROLE_WRITE");
      const includeRevoked = req.query?.includeRevoked === "true" || req.query?.includeRevoked === "1";
      const accounts = await systemAccountService.list({ includeRevoked });
      // Strip api_key_hash er allerede gjort av service-laget
      // (mapRow eksponerer ikke feltet). Returner direkte.
      apiSuccess(res, { accounts });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── DELETE /api/admin/system-accounts/:id ──────────────────────────────────
  router.delete("/api/admin/system-accounts/:id", async (req, res) => {
    try {
      const admin = await requireAdminUser(req, "USER_ROLE_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const reason = mustBeNonEmptyString(body.reason, "reason");

      await systemAccountService.revoke(id, admin.id, reason);

      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "system_account.revoke",
        resource: "system_account",
        resourceId: id,
        details: { reason },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      logger.info(
        { accountId: id, revokedBy: admin.id },
        "[PR-B] system-account revoked"
      );

      apiSuccess(res, { revoked: true, id });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
