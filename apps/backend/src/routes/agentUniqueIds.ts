/**
 * Wireframe gaps #8/#10/#11 (2026-04-24): Agent Unique ID endpoints.
 *
 * Ports V1.0 wireframes 17.9 (Create), 17.10 (Add Money), 17.11/17.28
 * (Withdraw), 17.26 (Details + Re-Generate).
 *
 * Endpoints:
 *   POST   /api/agent/unique-ids                    — create (hours >= 24)
 *   GET    /api/agent/unique-ids                    — list (filter by status)
 *   GET    /api/agent/unique-ids/:id                — card + balance
 *   GET    /api/agent/unique-ids/:id/details        — card + tx + game-filter
 *   POST   /api/agent/unique-ids/:id/add-money      — AKKUMULERES
 *   POST   /api/agent/unique-ids/:id/withdraw       — cash-only
 *   POST   /api/agent/unique-ids/:id/reprint        — re-print audit
 *   POST   /api/agent/unique-ids/:id/regenerate     — new id + transfer balance
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { UniqueIdService } from "../agent/UniqueIdService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-unique-ids-router" });

export interface AgentUniqueIdsRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  uniqueIdService: UniqueIdService;
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

export function createAgentUniqueIdsRouter(deps: AgentUniqueIdsRouterDeps): express.Router {
  const { platformService, agentService, uniqueIdService, auditLogService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ userId: string; role: UserRole }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
    }
    return { userId: user.id, role: user.role };
  }

  // ── POST /api/agent/unique-ids — Create (17.9) ───────────────────────────
  router.post("/api/agent/unique-ids", async (req, res) => {
    try {
      const actor = await requirePermission(req, "UNIQUE_ID_WRITE");
      if (actor.role !== "AGENT" && actor.role !== "ADMIN") {
        throw new DomainError("FORBIDDEN", "Create Unique ID kan kun utføres av AGENT eller ADMIN.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const hallId = mustBeNonEmptyString(body.hallId, "hallId");
      const amount = mustBePositiveAmount(body.amount, "amount");
      const hoursRaw = body.hoursValidity;
      const hoursValidity = typeof hoursRaw === "number" ? hoursRaw : Number(hoursRaw);
      if (!Number.isInteger(hoursValidity) || hoursValidity < 24) {
        throw new DomainError(
          "INVALID_HOURS_VALIDITY",
          "hoursValidity må være et heltall >= 24."
        );
      }
      const paymentType = mustBeNonEmptyString(body.paymentType, "paymentType");
      const result = await uniqueIdService.create({
        hallId,
        amount,
        hoursValidity,
        paymentType,
        agentUserId: actor.userId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "AGENT",
        action: "agent.unique_id.create",
        resource: "unique_id",
        resourceId: result.card.id,
        details: {
          hallId,
          amount,
          hoursValidity,
          paymentType,
          balanceCents: result.card.balanceCents,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/unique-ids — List ─────────────────────────────────────
  router.get("/api/agent/unique-ids", async (req, res) => {
    try {
      const actor = await requirePermission(req, "UNIQUE_ID_READ");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      // AGENT kun ser kort opprettet av seg selv (kassa-scope); andre roller
      // filtrerer eksplisitt via query.
      const createdByAgentId = actor.role === "AGENT" ? actor.userId : undefined;
      const status =
        typeof req.query.status === "string" && req.query.status.trim()
          ? (req.query.status.trim().toUpperCase() as "ACTIVE" | "WITHDRAWN" | "REGENERATED" | "EXPIRED")
          : undefined;
      const limit = parseLimit(req.query.limit, 100);
      const cards = await uniqueIdService.list({
        hallId: hallIdInput,
        status,
        createdByAgentId,
        limit,
      });
      apiSuccess(res, { cards, count: cards.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/unique-ids/:id ────────────────────────────────────────
  router.get("/api/agent/unique-ids/:id", async (req, res) => {
    try {
      await requirePermission(req, "UNIQUE_ID_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const details = await uniqueIdService.getDetails({ uniqueId: id });
      apiSuccess(res, details.card);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/unique-ids/:id/details — 17.26 view ───────────────────
  router.get("/api/agent/unique-ids/:id/details", async (req, res) => {
    try {
      await requirePermission(req, "UNIQUE_ID_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const gameType =
        typeof req.query.gameType === "string" && req.query.gameType.trim()
          ? req.query.gameType.trim()
          : undefined;
      const details = await uniqueIdService.getDetails({ uniqueId: id, gameType });
      apiSuccess(res, details);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/unique-ids/:id/add-money — 17.10 ─────────────────────
  router.post("/api/agent/unique-ids/:id/add-money", async (req, res) => {
    try {
      const actor = await requirePermission(req, "UNIQUE_ID_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const amount = mustBePositiveAmount(body.amount, "amount");
      const paymentType = mustBeNonEmptyString(body.paymentType, "paymentType");
      const result = await uniqueIdService.addMoney({
        uniqueId: id,
        amount,
        paymentType,
        agentUserId: actor.userId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "AGENT",
        action: "agent.unique_id.add_money",
        resource: "unique_id",
        resourceId: id,
        details: {
          amount,
          paymentType,
          previousBalance: result.transaction.previousBalance,
          newBalance: result.transaction.newBalance,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/unique-ids/:id/withdraw — 17.11/17.28 ────────────────
  router.post("/api/agent/unique-ids/:id/withdraw", async (req, res) => {
    try {
      const actor = await requirePermission(req, "UNIQUE_ID_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const amount = mustBePositiveAmount(body.amount, "amount");
      const paymentType =
        typeof body.paymentType === "string" && body.paymentType.trim()
          ? body.paymentType.trim()
          : undefined;
      const result = await uniqueIdService.withdraw({
        uniqueId: id,
        amount,
        paymentType,
        agentUserId: actor.userId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "AGENT",
        action: "agent.unique_id.withdraw",
        resource: "unique_id",
        resourceId: id,
        details: {
          amount,
          previousBalance: result.transaction.previousBalance,
          newBalance: result.transaction.newBalance,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/unique-ids/:id/reprint — 17.26 ───────────────────────
  router.post("/api/agent/unique-ids/:id/reprint", async (req, res) => {
    try {
      const actor = await requirePermission(req, "UNIQUE_ID_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const result = await uniqueIdService.reprint({
        uniqueId: id,
        agentUserId: actor.userId,
        reason,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "AGENT",
        action: "agent.unique_id.reprint",
        resource: "unique_id",
        resourceId: id,
        details: { reason, reprintedCount: result.card.reprintedCount },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/unique-ids/:id/regenerate — 17.26/17.27 ──────────────
  router.post("/api/agent/unique-ids/:id/regenerate", async (req, res) => {
    try {
      const actor = await requirePermission(req, "UNIQUE_ID_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const result = await uniqueIdService.regenerate({
        uniqueId: id,
        agentUserId: actor.userId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "AGENT",
        action: "agent.unique_id.regenerate",
        resource: "unique_id",
        resourceId: id,
        details: {
          oldCardId: result.previousCard.id,
          newCardId: result.newCard.id,
          transferredBalanceCents: result.transferredBalanceCents,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-unique-ids-router initialised (8 endpoints)");
  return router;
}
