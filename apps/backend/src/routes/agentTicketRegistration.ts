/**
 * BIN-GAP#4 — Register Sold Tickets scanner (agent-portal).
 *
 * Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
 *       docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf skjerm 17.15
 *
 * Endpoints:
 *   GET  /api/agent/ticket-registration/:gameId/initial-ids
 *        Returnerer initial_id + round_number for alle 6 ticket-typer
 *        (carry-forward-oppslag) + eksisterende rad hvis agenten har
 *        begynt å registrere.
 *
 *   POST /api/agent/ticket-registration/:gameId/final-ids
 *        Body: { perTypeFinalIds: { small_yellow: 42, large_yellow: 15, ... } }
 *        Registrerer final_id per ticket-type, beregner sold_count, og
 *        markerer hallen som klar via Game1HallReadyService hvis alle
 *        ticket-typer er satt.
 *
 *   GET  /api/agent/ticket-registration/:gameId/summary
 *        Admin-view: alle ranges for dette spillet (alle haller + typer).
 *
 * RBAC:
 *   - AGENT (aktiv shift) — kan registrere for shift.hallId
 *   - HALL_OPERATOR — kan registrere for user.hallId
 *   - ADMIN — kan registrere for alle haller
 *
 * Integrasjon med hall-status-flyt (#451):
 *   Etter vellykket recordFinalIds kaller vi Game1HallReadyService.markReady
 *   som snapshoter physical_tickets_sold-telleren og flipper hallen til grønn.
 *   Hvis markReady feiler (f.eks. game ikke i purchase_open) logges advarsel —
 *   recordFinalIds har allerede succeeded, så vi returnerer 200 med en
 *   "hallReadyStatus"-indikator i payload.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, UserRole } from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { Game1HallReadyService } from "../game/Game1HallReadyService.js";
import {
  TicketRegistrationService,
  TICKET_TYPES,
  isTicketType,
  type TicketType,
} from "../agent/TicketRegistrationService.js";
import {
  apiSuccess,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-ticket-registration-router" });

export interface AgentTicketRegistrationRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  auditLogService: AuditLogService;
  ticketRegistrationService: TicketRegistrationService;
  /** Optional — hvis satt, markeres hallen klar etter recordFinalIds. */
  game1HallReadyService?: Game1HallReadyService;
}

interface Actor {
  user: PublicAppUser;
  /** Effektiv hall-scope. AGENT → shift.hallId. HALL_OPERATOR → user.hallId.
   *  ADMIN → null (ikke hall-scoped). */
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

/**
 * HTTP-status mapper:
 *   - UNAUTHORIZED/FORBIDDEN          → 403
 *   - GAME_NOT_FOUND
 *   - RANGE_NOT_FOUND                 → 404
 *   - GAME_NOT_EDITABLE
 *   - FINAL_LESS_THAN_INITIAL
 *   - RANGE_OVERLAP
 *   - RANGE_GAME_MISMATCH
 *   - RANGE_HALL_MISMATCH
 *   - INVALID_TICKET_TYPE             → 409
 *   - alt annet (inkl. INVALID_INPUT) → 400
 */
function statusForDomainCode(code: string): number {
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "SHIFT_NOT_ACTIVE") return 403;
  if (code === "GAME_NOT_FOUND" || code === "RANGE_NOT_FOUND") return 404;
  if (
    code === "GAME_NOT_EDITABLE"
    || code === "FINAL_LESS_THAN_INITIAL"
    || code === "RANGE_OVERLAP"
    || code === "RANGE_GAME_MISMATCH"
    || code === "RANGE_HALL_MISMATCH"
    || code === "INVALID_TICKET_TYPE"
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
  logger.error({ err: error }, "[ticket-registration] unexpected error");
  res.status(500).json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Intern feil." },
  });
}

function parsePerTypeFinalIds(raw: unknown): Partial<Record<TicketType, number>> {
  if (!isRecordObject(raw)) {
    throw new DomainError(
      "INVALID_INPUT",
      "perTypeFinalIds må være et objekt (ticket_type → finalId).",
    );
  }
  const out: Partial<Record<TicketType, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isTicketType(key)) {
      throw new DomainError(
        "INVALID_TICKET_TYPE",
        `Ugyldig ticket-type '${key}'. Gyldig: ${TICKET_TYPES.join(", ")}.`,
      );
    }
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new DomainError(
        "INVALID_INPUT",
        `finalId for '${key}' må være et heltall >= 0. Fikk ${String(value)}.`,
      );
    }
    out[key] = n;
  }
  return out;
}

export function createAgentTicketRegistrationRouter(
  deps: AgentTicketRegistrationRouterDeps,
): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    auditLogService,
    ticketRegistrationService,
    game1HallReadyService,
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
          "Du må starte en shift før du kan registrere solgte billetter.",
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
      "Kun AGENT, HALL_OPERATOR og ADMIN har tilgang til agent-portalen.",
    );
  }

  /** Returner effektiv hallId for aktøren — ADMIN kan overstyre via query/body. */
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
    // ADMIN — krever eksplisitt hallId i query/body.
    if (!overrideHallId) {
      throw new DomainError(
        "INVALID_INPUT",
        "ADMIN må spesifisere hallId eksplisitt.",
      );
    }
    return overrideHallId;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[ticket-registration] audit append failed");
    });
  }

  // GET /api/agent/ticket-registration/:gameId/initial-ids
  router.get(
    "/api/agent/ticket-registration/:gameId/initial-ids",
    async (req, res) => {
      try {
        const actor = await resolveActor(req);
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
        const queryHallId = typeof req.query.hallId === "string" && req.query.hallId.trim()
          ? req.query.hallId.trim()
          : null;
        const hallId = resolveEffectiveHallId(actor, queryHallId);

        const result = await ticketRegistrationService.getInitialIds({
          gameId,
          hallId,
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // POST /api/agent/ticket-registration/:gameId/final-ids
  router.post(
    "/api/agent/ticket-registration/:gameId/final-ids",
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
        const bodyHallId = typeof req.body.hallId === "string" && req.body.hallId.trim()
          ? req.body.hallId.trim()
          : null;
        const hallId = resolveEffectiveHallId(actor, bodyHallId);
        const perTypeFinalIds = parsePerTypeFinalIds(req.body.perTypeFinalIds);

        const result = await ticketRegistrationService.recordFinalIds({
          gameId,
          hallId,
          perTypeFinalIds,
          userId: actor.user.id,
        });

        fireAudit({
          actorId: actor.user.id,
          actorType: actorTypeFromRole(actor.role),
          action: "ticket_registration.recorded",
          resource: "ticket_range_per_game",
          resourceId: gameId,
          details: {
            gameId,
            hallId,
            totalSoldCount: result.totalSoldCount,
            perType: result.ranges.map((r) => ({
              ticketType: r.ticketType,
              initialId: r.initialId,
              finalId: r.finalId,
              soldCount: r.soldCount,
              roundNumber: r.roundNumber,
            })),
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        // Integrer med hall-status-flyt (#451): markér hallen klar slik at
        // master-dashboard viser 🟢. Best-effort — feil i markReady skal ikke
        // velte den vellykte recordFinalIds-returen.
        let hallReadyStatus: { isReady: boolean; error?: string } | null = null;
        if (game1HallReadyService) {
          try {
            const ready = await game1HallReadyService.markReady({
              gameId,
              hallId,
              userId: actor.user.id,
            });
            hallReadyStatus = { isReady: ready.isReady };
          } catch (err) {
            const code = err instanceof DomainError ? err.code : "INTERNAL_ERROR";
            logger.warn(
              { err, gameId, hallId, code },
              "[ticket-registration] markReady failed after recordFinalIds",
            );
            hallReadyStatus = {
              isReady: false,
              error: code,
            };
          }
        }

        apiSuccess(res, { ...result, hallReadyStatus });
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // PUT /api/agent/ticket-ranges/:rangeId
  //
  // REQ-091 — Edit en eksisterende ticket-range mellom runder. Body må
  // inneholde { gameId, initialId, finalId } (hallId resolves fra actor-scope).
  // ADMIN kan overstyre hallId via body.hallId.
  router.put(
    "/api/agent/ticket-ranges/:rangeId",
    async (req, res) => {
      try {
        const actor = await resolveActor(req);
        const rangeId = mustBeNonEmptyString(req.params.rangeId, "rangeId");
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
        const initialIdRaw = req.body.initialId;
        const finalIdRaw = req.body.finalId;
        if (typeof initialIdRaw !== "number" && typeof initialIdRaw !== "string") {
          throw new DomainError("INVALID_INPUT", "initialId må være et tall.");
        }
        if (typeof finalIdRaw !== "number" && typeof finalIdRaw !== "string") {
          throw new DomainError("INVALID_INPUT", "finalId må være et tall.");
        }
        const initialId = Number(initialIdRaw);
        const finalId = Number(finalIdRaw);
        if (!Number.isFinite(initialId) || !Number.isInteger(initialId) || initialId < 0) {
          throw new DomainError(
            "INVALID_INPUT",
            "initialId må være et heltall >= 0.",
          );
        }
        if (!Number.isFinite(finalId) || !Number.isInteger(finalId) || finalId < 0) {
          throw new DomainError(
            "INVALID_INPUT",
            "finalId må være et heltall >= 0.",
          );
        }
        const bodyHallId = typeof req.body.hallId === "string" && req.body.hallId.trim()
          ? req.body.hallId.trim()
          : null;
        const hallId = resolveEffectiveHallId(actor, bodyHallId);

        const { before, after } = await ticketRegistrationService.editRange({
          rangeId,
          gameId,
          hallId,
          initialId,
          finalId,
          userId: actor.user.id,
        });

        fireAudit({
          actorId: actor.user.id,
          actorType: actorTypeFromRole(actor.role),
          action: "agent.ticket-range.edit",
          resource: "ticket_range_per_game",
          resourceId: rangeId,
          details: {
            gameId,
            hallId,
            ticketType: after.ticketType,
            before: {
              initialId: before.initialId,
              finalId: before.finalId,
              soldCount: before.soldCount,
            },
            after: {
              initialId: after.initialId,
              finalId: after.finalId,
              soldCount: after.soldCount,
            },
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, { range: after, before });
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // GET /api/agent/ticket-registration/:gameId/summary
  router.get(
    "/api/agent/ticket-registration/:gameId/summary",
    async (req, res) => {
      try {
        // Summary er bredere — tillatt for alle aktør-roller som har tilgang
        // til agent-portalen. ADMIN ser alle haller; AGENT/HALL_OPERATOR ser
        // bare egen hall (via filtrering).
        const actor = await resolveActor(req);
        const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");

        const result = await ticketRegistrationService.getSummary({ gameId });

        const filtered = actor.hallId === null
          ? result
          : {
              ...result,
              ranges: result.ranges.filter((r) => r.hallId === actor.hallId),
              totalSoldCount: result.ranges
                .filter((r) => r.hallId === actor.hallId)
                .reduce((s, r) => s + r.soldCount, 0),
            };

        apiSuccess(res, filtered);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  return router;
}
