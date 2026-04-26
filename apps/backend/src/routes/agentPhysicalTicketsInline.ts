/**
 * REQ-101 (PDF 17 §17.24 / BIR-299-300): inline Add Physical Ticket popup.
 *
 * Spec: docs/architecture/WIREFRAME_BACKEND_REQUIREMENTS_2026-04-25.md REQ-101
 *
 * Endpoint:
 *   POST /api/agent/physical-tickets/inline-register
 *   Body: { subGameId, initialId, finalId, color, hallId? }
 *   Response: { range, created, idempotent, soldCount }
 *
 * Auth + scope:
 *   - AGENT (aktiv shift) — kan registrere for shift.hallId
 *   - HALL_OPERATOR — kan registrere for user.hallId
 *   - ADMIN — kan registrere for alle haller (krever eksplisitt hallId)
 *
 *   Hall-scope validering matcher TicketRegistrationRouter mønsteret:
 *   AGENT/HALL_OPERATOR kan ikke overstyre sin egen hall-binding.
 *
 * Audit:
 *   Skriver `physical_ticket.inline_register` til AuditLogService etter
 *   vellykket registrering.
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
import type { AgentPhysicalTicketInlineService } from "../agent/AgentPhysicalTicketInlineService.js";
import {
  apiSuccess,
  getAccessTokenFromRequest,
  isRecordObject,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-physical-tickets-inline-router" });

export interface AgentPhysicalTicketsInlineRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  auditLogService: AuditLogService;
  agentPhysicalTicketInlineService: AgentPhysicalTicketInlineService;
}

interface Actor {
  user: PublicAppUser;
  /** Effektiv hall-binding (null for ADMIN — krever eksplisitt hallId i body). */
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
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "SHIFT_NOT_ACTIVE") {
    return 403;
  }
  if (code === "GAME_NOT_FOUND" || code === "PLAYER_NOT_FOUND") {
    return 404;
  }
  if (
    code === "GAME_NOT_EDITABLE"
    || code === "FINAL_LESS_THAN_INITIAL"
    || code === "RANGE_OVERLAP"
    || code === "INVALID_TICKET_COLOR"
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
  logger.error({ err: error }, "[REQ-101] unexpected error");
  res.status(500).json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Intern feil." },
  });
}

export function createAgentPhysicalTicketsInlineRouter(
  deps: AgentPhysicalTicketsInlineRouterDeps,
): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    auditLogService,
    agentPhysicalTicketInlineService,
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
          "Du må starte en shift før du kan legge til physical tickets.",
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
        "[REQ-101] audit append failed — fortsetter",
      );
    });
  }

  // ── POST /api/agent/physical-tickets/inline-register ────────────────────
  router.post(
    "/api/agent/physical-tickets/inline-register",
    async (req, res) => {
      try {
        const actor = await resolveActor(req);
        if (!isRecordObject(req.body)) {
          throw new DomainError(
            "INVALID_INPUT",
            "Payload må være et objekt.",
          );
        }
        const subGameId = mustBeNonEmptyString(req.body.subGameId, "subGameId");
        const color = mustBeNonEmptyString(req.body.color, "color");
        const initialIdRaw = req.body.initialId;
        const finalIdRaw = req.body.finalId;
        const initialId =
          typeof initialIdRaw === "number" ? initialIdRaw : Number(initialIdRaw);
        const finalId =
          typeof finalIdRaw === "number" ? finalIdRaw : Number(finalIdRaw);
        if (!Number.isFinite(initialId) || !Number.isFinite(finalId)) {
          throw new DomainError(
            "INVALID_INPUT",
            "initialId/finalId må være tall.",
          );
        }
        const overrideHallId =
          typeof req.body.hallId === "string" && req.body.hallId.trim()
            ? req.body.hallId.trim()
            : null;
        const hallId = resolveEffectiveHallId(actor, overrideHallId);

        const result = await agentPhysicalTicketInlineService.inlineRegister({
          subGameId,
          hallId,
          initialId,
          finalId,
          color,
          userId: actor.user.id,
        });

        fireAudit({
          actorId: actor.user.id,
          actorType: actorTypeFromRole(actor.role),
          action: "physical_ticket.inline_register",
          resource: "ticket_range_per_game",
          resourceId: result.range.id,
          details: {
            subGameId,
            hallId,
            color,
            initialId,
            finalId,
            soldCount: result.soldCount,
            created: result.created,
            idempotent: result.idempotent,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, {
          range: result.range,
          created: result.created,
          idempotent: result.idempotent,
          soldCount: result.soldCount,
        });
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  return router;
}
