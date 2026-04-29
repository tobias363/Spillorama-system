/**
 * BIN-583 B3.1: admin-side agent-CRUD.
 *
 *   GET    /api/admin/agents                        — liste (paginert, filter)
 *   POST   /api/admin/agents                        — opprett agent
 *   GET    /api/admin/agents/:id                    — hent enkelt agent
 *   PUT    /api/admin/agents/:id                    — oppdater agent
 *   DELETE /api/admin/agents/:id                    — soft-delete agent
 *   POST   /api/admin/agents/:agentId/shift/force-close
 *                                                    — PR #522 hotfix:
 *                                                      ADMIN force-close
 *                                                      stuck shift
 *
 * RBAC:
 *   - AGENT_READ: ADMIN, HALL_OPERATOR, SUPPORT
 *   - AGENT_WRITE: ADMIN, HALL_OPERATOR (hall-scope gjelder ved list/edit
 *     for HALL_OPERATOR — håndheves via resolveHallScopeFilter)
 *   - AGENT_DELETE: ADMIN only
 *   - AGENT_SHIFT_FORCE: ADMIN only — destruktiv, kun for stuck-shift
 *     opprydding når agent ikke kan/vil logge ut selv.
 *
 * Audit: alle mutasjoner logges med actor_type avledet fra caller role.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  resolveHallScopeFilter,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-agents-router" });

export interface AdminAgentsRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  auditLogService: AuditLogService;
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

function mapRoleToActorType(role: UserRole): AuditActorType {
  switch (role) {
    case "ADMIN": return "ADMIN";
    case "HALL_OPERATOR": return "HALL_OPERATOR";
    case "SUPPORT": return "SUPPORT";
    case "PLAYER": return "PLAYER";
    case "AGENT": return "AGENT";
  }
}

export function createAdminAgentsRouter(deps: AdminAgentsRouterDeps): express.Router {
  const { platformService, agentService, agentShiftService, auditLogService } = deps;
  const router = express.Router();

  async function requireAdminPermissionUser(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ id: string; role: UserRole; hallId: string | null }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    return { id: user.id, role: user.role, hallId: user.hallId };
  }

  // ── GET /api/admin/agents ───────────────────────────────────────────────
  router.get("/api/admin/agents", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_READ");
      const requestedHallId = typeof req.query?.hallId === "string" ? req.query.hallId : undefined;
      // HALL_OPERATOR forced-scoped til egen hall.
      const hallFilter = resolveHallScopeFilter(admin, requestedHallId);
      const limit = parseLimit(req.query?.limit, 100);
      const offsetRaw = req.query?.offset;
      const offset = typeof offsetRaw === "string" ? Math.max(0, Number.parseInt(offsetRaw, 10) || 0) : 0;
      const status = req.query?.status === "inactive" ? "inactive" :
                     req.query?.status === "active" ? "active" : undefined;
      const agents = await agentService.list({
        hallId: hallFilter,
        status,
        limit,
        offset,
      });
      apiSuccess(res, { agents, limit, offset });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/admin/agents ──────────────────────────────────────────────
  router.post("/api/admin/agents", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_WRITE");
      const body = isRecordObject(req.body) ? req.body : {};
      const email = mustBeNonEmptyString(body.email, "email");
      const password = mustBeNonEmptyString(body.password, "password");
      const displayName = mustBeNonEmptyString(body.displayName, "displayName");
      const surname = mustBeNonEmptyString(body.surname, "surname");
      const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : undefined;
      const language = typeof body.language === "string" && body.language.trim() ? body.language.trim() : undefined;
      const parentUserId = typeof body.parentUserId === "string" && body.parentUserId.trim()
        ? body.parentUserId.trim() : null;
      const hallIdsRaw = body.hallIds;
      const hallIds = Array.isArray(hallIdsRaw)
        ? hallIdsRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const primaryHallId = typeof body.primaryHallId === "string" && body.primaryHallId.trim()
        ? body.primaryHallId.trim() : undefined;

      // HALL_OPERATOR: kan kun opprette agenter i egen hall.
      if (admin.role === "HALL_OPERATOR") {
        if (!admin.hallId) {
          throw new DomainError("FORBIDDEN", "Din bruker er ikke tildelt en hall.");
        }
        for (const id of hallIds) {
          if (id !== admin.hallId) {
            throw new DomainError("FORBIDDEN", "HALL_OPERATOR kan kun tildele egen hall.");
          }
        }
      }

      const agent = await agentService.createAgent({
        email,
        password,
        displayName,
        surname,
        phone,
        language,
        parentUserId,
        hallIds,
        primaryHallId,
      });
      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "admin.agent.create",
        resource: "user",
        resourceId: agent.userId,
        details: { hallIds, primaryHallId, language: agent.language },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, agent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/agents/:id ───────────────────────────────────────────
  router.get("/api/admin/agents/:id", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const agent = await agentService.getById(userId);
      // Hall-scope: HALL_OPERATOR kan kun se agenter i egen hall.
      if (admin.role === "HALL_OPERATOR") {
        if (!admin.hallId) {
          throw new DomainError("FORBIDDEN", "Din bruker er ikke tildelt en hall.");
        }
        const hasAccess = agent.halls.some((h) => h.hallId === admin.hallId);
        if (!hasAccess) {
          throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne agenten.");
        }
      }
      apiSuccess(res, agent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PUT /api/admin/agents/:id ───────────────────────────────────────────
  router.put("/api/admin/agents/:id", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_WRITE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const existing = await agentService.getById(userId);
      const body = isRecordObject(req.body) ? req.body : {};

      // HALL_OPERATOR hall-scope guard.
      if (admin.role === "HALL_OPERATOR") {
        if (!admin.hallId) {
          throw new DomainError("FORBIDDEN", "Din bruker er ikke tildelt en hall.");
        }
        const canSee = existing.halls.some((h) => h.hallId === admin.hallId);
        if (!canSee) {
          throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne agenten.");
        }
        // HALL_OPERATOR kan ikke flytte agent ut av sin hall.
        if (Array.isArray(body.hallIds)) {
          const nextHalls = body.hallIds.filter((v): v is string => typeof v === "string");
          if (!nextHalls.includes(admin.hallId)) {
            throw new DomainError("FORBIDDEN", "HALL_OPERATOR må beholde egen hall i agentens tildeling.");
          }
        }
      }

      const patch: Parameters<AgentService["updateAgent"]>[1] = {};
      if (body.displayName !== undefined) patch.displayName = String(body.displayName);
      if (body.email !== undefined) patch.email = String(body.email);
      if (body.phone !== undefined) patch.phone = body.phone === null ? null : String(body.phone);
      if (body.language !== undefined) patch.language = String(body.language);
      if (body.avatarFilename !== undefined) {
        patch.avatarFilename = body.avatarFilename === null ? null : String(body.avatarFilename);
      }
      if (body.agentStatus !== undefined) patch.agentStatus = String(body.agentStatus) as "active" | "inactive";
      if (body.parentUserId !== undefined) {
        patch.parentUserId = body.parentUserId === null ? null : String(body.parentUserId);
      }
      if (Array.isArray(body.hallIds)) {
        patch.hallIds = body.hallIds.filter((v): v is string => typeof v === "string");
      }
      if (body.primaryHallId !== undefined) patch.primaryHallId = String(body.primaryHallId);

      const updated = await agentService.updateAgent(userId, patch, {
        role: admin.role,
        userId: admin.id,
      });
      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "admin.agent.update",
        resource: "user",
        resourceId: userId,
        details: { fields: Object.keys(patch) },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── DELETE /api/admin/agents/:id ────────────────────────────────────────
  router.delete("/api/admin/agents/:id", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_DELETE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      // Eksplisitt sjekk: agenten må ikke ha aktiv shift.
      const active = await agentShiftService.getCurrentShift(userId);
      if (active) {
        throw new DomainError(
          "AGENT_HAS_ACTIVE_SHIFT",
          "Agenten har aktiv shift. Avslutt shiften før agenten slettes."
        );
      }
      await agentService.softDeleteAgent(userId);
      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "admin.agent.delete",
        resource: "user",
        resourceId: userId,
        details: { mode: "soft-delete" },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/admin/agents/:agentId/shift/force-close ───────────────────
  // PR #522 hotfix (Issue #3): ops force-close stuck shift uten DB-access.
  //
  // Body: { reason: string }
  //
  // Bruker eksisterende AgentShiftService.endShift med admin-actor; service-
  // laget krever begrunnelse når ADMIN force-closer en annen agent's shift
  // (lagres i shift.logoutNotes som "[ADMIN_FORCE_CLOSE by <id>] <reason>")
  // og audit-event logges som `admin.agent.shift.force_close` med actor,
  // target, og begrunnelse.
  router.post("/api/admin/agents/:agentId/shift/force-close", async (req, res) => {
    try {
      const admin = await requireAdminPermissionUser(req, "AGENT_SHIFT_FORCE");
      const targetAgentId = mustBeNonEmptyString(req.params.agentId, "agentId");
      const body = isRecordObject(req.body) ? req.body : {};
      const reason = mustBeNonEmptyString(body.reason, "reason");

      const active = await agentShiftService.getCurrentShift(targetAgentId);
      if (!active) {
        throw new DomainError(
          "NO_ACTIVE_SHIFT",
          "Agenten har ingen aktiv shift å lukke."
        );
      }

      const ended = await agentShiftService.endShift({
        shiftId: active.id,
        actor: { userId: admin.id, role: admin.role },
        reason,
      });

      void auditLogService.record({
        actorId: admin.id,
        actorType: mapRoleToActorType(admin.role),
        action: "admin.agent.shift.force_close",
        resource: "shift",
        resourceId: ended.id,
        details: {
          targetAgentId,
          hallId: ended.hallId,
          reason,
          shiftStartedAt: ended.startedAt,
          shiftEndedAt: ended.endedAt,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, {
        shift: ended,
        forceClosed: true,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("admin-agents-router initialised (6 endpoints)");
  return router;
}
