/**
 * REQ-146 (PDF 17 §17.23 / BIR-294-298): agent-input for mini-game winnings.
 *
 * Spec: docs/architecture/WIREFRAME_BACKEND_REQUIREMENTS_2026-04-25.md REQ-146
 *
 * Endpoint:
 *   POST /api/agent/games/:gameId/mini-game-winning
 *   Body: { playerId, miniGameType, amountCents, reason, hallId? }
 *   Response: { resultId, created, idempotent, miniGameType, payoutCents,
 *               walletTransactionId }
 *
 * Auth + scope:
 *   - Krever AGENT-rolle (eller HALL_OPERATOR/ADMIN). AGENT må ha aktiv
 *     shift; agent kan kun registrere for sin shift.hallId.
 *   - HALL_OPERATOR scoped til user.hallId.
 *   - ADMIN må spesifisere hallId eksplisitt.
 *
 * Compliance-gate (delegert til service):
 *   1. Mini-gamen må være aktivert i scheduled_game.game_config_json.
 *   2. Spilleren må ha vært i runden (assignment eller physical ticket).
 *   3. Idempotent re-call: samme (gameId, playerId, type, amount) → ack.
 *
 * Audit:
 *   `agent.minigame_winning.recorded` event etter vellykket registrering.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
  UserRole,
} from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { AgentMiniGameWinningService } from "../agent/AgentMiniGameWinningService.js";
import {
  apiSuccess,
  getAccessTokenFromRequest,
  isRecordObject,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-mini-game-winning-router" });

export interface AgentMiniGameWinningRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  auditLogService: AuditLogService;
  agentMiniGameWinningService: AgentMiniGameWinningService;
}

interface Actor {
  user: PublicAppUser;
  hallId: string | null;
  role: UserRole;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgentHeader(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(role: UserRole): "ADMIN" | "HALL_OPERATOR" | "AGENT" | "SUPPORT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  if (role === "AGENT") return "AGENT";
  if (role === "SUPPORT") return "SUPPORT";
  return "USER";
}

function statusForDomainCode(code: string): number {
  if (
    code === "UNAUTHORIZED"
    || code === "FORBIDDEN"
    || code === "SHIFT_NOT_ACTIVE"
  ) {
    return 403;
  }
  if (
    code === "GAME_NOT_FOUND"
    || code === "PLAYER_NOT_FOUND"
  ) {
    return 404;
  }
  if (
    code === "AGENT_MINIGAME_NOT_ACTIVE"
    || code === "AGENT_MINIGAME_NOT_IN_ROUND"
    || code === "AGENT_MINIGAME_ALREADY_PAID"
    || code === "PLAYER_HAS_NO_WALLET"
    || code === "AGENT_MINIGAME_WALLET_CREDIT_FAILED"
    || code === "INVALID_MINIGAME_TYPE"
  ) {
    return 409;
  }
  return 400;
}

function replyFailure(res: express.Response, error: unknown): void {
  if (error instanceof DomainError) {
    res.status(statusForDomainCode(error.code)).json({
      ok: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  logger.error({ err: error }, "[REQ-146] unexpected error");
  res.status(500).json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Intern feil." },
  });
}

export function createAgentMiniGameWinningRouter(
  deps: AgentMiniGameWinningRouterDeps,
): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    auditLogService,
    agentMiniGameWinningService,
  } = deps;
  const router = express.Router();

  async function resolveActor(req: express.Request): Promise<Actor> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
      const shift = await agentShiftService.getCurrentShift(user.id);
      if (!shift) {
        throw new DomainError(
          "SHIFT_NOT_ACTIVE",
          "Du må starte en shift før du kan registrere mini-game-winnings.",
        );
      }
      return { user, hallId: shift.hallId, role: "AGENT" };
    }
    if (user.role === "HALL_OPERATOR") {
      if (!user.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Din bruker er ikke tildelt en hall — kontakt admin.",
        );
      }
      return { user, hallId: user.hallId, role: "HALL_OPERATOR" };
    }
    if (user.role === "ADMIN") {
      return { user, hallId: null, role: "ADMIN" };
    }
    throw new DomainError(
      "FORBIDDEN",
      "Kun AGENT, HALL_OPERATOR og ADMIN har tilgang.",
    );
  }

  function resolveEffectiveHallId(
    actor: Actor,
    overrideHallId: string | null,
  ): string {
    if (actor.hallId !== null) {
      if (overrideHallId !== null && overrideHallId !== actor.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          `Du kan ikke registrere for hall '${overrideHallId}' — din hall-scope er '${actor.hallId}'.`,
        );
      }
      return actor.hallId;
    }
    if (!overrideHallId) {
      throw new DomainError(
        "INVALID_INPUT",
        "ADMIN må spesifisere hallId eksplisitt i body.",
      );
    }
    return overrideHallId;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn(
        { err, action: event.action },
        "[REQ-146] audit append failed — fortsetter",
      );
    });
  }

  // ── POST /api/agent/games/:gameId/mini-game-winning ─────────────────────
  router.post(
    "/api/agent/games/:gameId/mini-game-winning",
    async (req, res) => {
      try {
        const actor = await resolveActor(req);
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");

        if (!isRecordObject(req.body)) {
          throw new DomainError(
            "INVALID_INPUT",
            "Payload må være et objekt.",
          );
        }
        const playerId = mustBeNonEmptyString(req.body.playerId, "playerId");
        const miniGameType = mustBeNonEmptyString(
          req.body.miniGameType,
          "miniGameType",
        );
        const reason = mustBeNonEmptyString(req.body.reason, "reason");
        const amountRaw = req.body.amountCents;
        const amountCents =
          typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
        if (!Number.isFinite(amountCents)) {
          throw new DomainError(
            "INVALID_INPUT",
            "amountCents må være et tall.",
          );
        }
        const overrideHallId =
          typeof req.body.hallId === "string" && req.body.hallId.trim()
            ? req.body.hallId.trim()
            : null;
        const hallId = resolveEffectiveHallId(actor, overrideHallId);

        const result = await agentMiniGameWinningService.recordMiniGameWinning({
          gameId,
          playerId,
          miniGameType,
          amountCents,
          reason,
          agentUserId: actor.user.id,
          hallId,
        });

        fireAudit({
          actorId: actor.user.id,
          actorType: actorTypeFromRole(actor.role),
          action: "agent.minigame_winning.recorded",
          resource: "game1_mini_game_results",
          resourceId: result.resultId,
          details: {
            gameId,
            playerId,
            miniGameType: result.miniGameType,
            payoutCents: result.payoutCents,
            walletTransactionId: result.walletTransactionId,
            reason,
            hallId,
            created: result.created,
            idempotent: result.idempotent,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, {
          resultId: result.resultId,
          created: result.created,
          idempotent: result.idempotent,
          miniGameType: result.miniGameType,
          payoutCents: result.payoutCents,
          walletTransactionId: result.walletTransactionId,
        });
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  return router;
}
