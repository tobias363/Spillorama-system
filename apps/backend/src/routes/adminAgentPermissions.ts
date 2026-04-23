/**
 * Role Management — admin-router for per-agent permission-matrix.
 *
 * Endepunkter (matches apps/admin-web AgentRolePermissionsPage):
 *   GET /api/admin/agents/:agentId/permissions
 *   PUT /api/admin/agents/:agentId/permissions
 *
 * RBAC:
 *   - AGENT_PERMISSION_READ  : ADMIN + SUPPORT (kundestøtte-innsyn)
 *   - AGENT_PERMISSION_WRITE : ADMIN-only
 *
 * Body for PUT: `{ permissions: [{ module, canCreate, canEdit, canView,
 * canDelete, canBlockUnblock }, ...] }`. Full replace-semantikk —
 * service-laget overskriver hele matrix atomisk.
 *
 * Audit-logging: `agent.permissions.update` skrives med `{diff}` (moduler
 * som endret seg, før/etter-snapshot). `agent.permissions.read` logges
 * ikke — støy-reduksjon, GET-readonly.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole, PublicAppUser } from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  AgentPermissionService,
  type ModulePermission,
  type SetModulePermissionInput,
  type AgentPermissionModule,
} from "../platform/AgentPermissionService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-agent-permissions-router" });

export interface AdminAgentPermissionsRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentPermissionService: AgentPermissionService;
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
 * Sammenlign før/etter og returner endrings-diff per modul (kun moduler
 * som faktisk endret seg inngår). Brukes i audit-detail.
 */
function diffPermissions(
  before: ModulePermission[],
  after: ModulePermission[]
): Array<{ module: AgentPermissionModule; changed: Record<string, { from: boolean; to: boolean }> }> {
  const result: Array<{
    module: AgentPermissionModule;
    changed: Record<string, { from: boolean; to: boolean }>;
  }> = [];
  const beforeByModule = new Map(before.map((p) => [p.module, p]));
  for (const next of after) {
    const prev = beforeByModule.get(next.module);
    if (!prev) continue; // getPermissions returnerer alltid alle 15 moduler
    const changed: Record<string, { from: boolean; to: boolean }> = {};
    if (prev.canCreate !== next.canCreate) {
      changed.canCreate = { from: prev.canCreate, to: next.canCreate };
    }
    if (prev.canEdit !== next.canEdit) {
      changed.canEdit = { from: prev.canEdit, to: next.canEdit };
    }
    if (prev.canView !== next.canView) {
      changed.canView = { from: prev.canView, to: next.canView };
    }
    if (prev.canDelete !== next.canDelete) {
      changed.canDelete = { from: prev.canDelete, to: next.canDelete };
    }
    if (prev.canBlockUnblock !== next.canBlockUnblock) {
      changed.canBlockUnblock = {
        from: prev.canBlockUnblock,
        to: next.canBlockUnblock,
      };
    }
    if (Object.keys(changed).length > 0) {
      result.push({ module: next.module, changed });
    }
  }
  return result;
}

export function createAdminAgentPermissionsRouter(
  deps: AdminAgentPermissionsRouterDeps
): express.Router {
  const {
    platformService,
    agentService,
    agentPermissionService,
    auditLogService,
  } = deps;
  const router = express.Router();

  async function requireAdminPermissionUser(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    return user;
  }

  // ── GET /api/admin/agents/:agentId/permissions ───────────────────────────
  router.get("/api/admin/agents/:agentId/permissions", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "AGENT_PERMISSION_READ");
      const agentId = mustBeNonEmptyString(req.params.agentId, "agentId");
      // Verifiser at agenten finnes (gir 404 via DomainError istedenfor
      // tomme rader fra permission-service).
      await agentService.getById(agentId);
      const permissions = await agentPermissionService.getPermissions(agentId);
      apiSuccess(res, { agentId, permissions });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PUT /api/admin/agents/:agentId/permissions ───────────────────────────
  router.put("/api/admin/agents/:agentId/permissions", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_PERMISSION_WRITE");
      const agentId = mustBeNonEmptyString(req.params.agentId, "agentId");
      await agentService.getById(agentId);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const permsRaw = req.body.permissions;
      if (!Array.isArray(permsRaw)) {
        throw new DomainError(
          "INVALID_INPUT",
          "permissions må være en array."
        );
      }
      const inputs: SetModulePermissionInput[] = permsRaw.map((entry, idx) => {
        if (!isRecordObject(entry)) {
          throw new DomainError(
            "INVALID_INPUT",
            `permissions[${idx}] må være et objekt.`
          );
        }
        return {
          module: entry.module as AgentPermissionModule,
          canCreate: typeof entry.canCreate === "boolean" ? entry.canCreate : false,
          canEdit: typeof entry.canEdit === "boolean" ? entry.canEdit : false,
          canView: typeof entry.canView === "boolean" ? entry.canView : false,
          canDelete: typeof entry.canDelete === "boolean" ? entry.canDelete : false,
          canBlockUnblock:
            typeof entry.canBlockUnblock === "boolean"
              ? entry.canBlockUnblock
              : false,
        };
      });

      const before = await agentPermissionService.getPermissions(agentId);
      const after = await agentPermissionService.setPermissions(
        agentId,
        inputs,
        admin.id
      );
      const diff = diffPermissions(before, after);

      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "agent.permissions.update",
        resource: "agent",
        resourceId: agentId,
        details: { diff, modulesChanged: diff.length },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, { agentId, permissions: after });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("admin-agent-permissions-router initialised (2 endpoints)");
  return router;
}
