/**
 * PT2+PT3 — Admin-router for agent (bingovert) range-registrering og batch-salg.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 2: Vakt-start + range-registrering", linje 48-69)
 *       (§ "Fase 4: Batch-oppdatering (returnering til stativ)", linje 76-104)
 *
 * Endpoints:
 *   POST   /api/admin/physical-tickets/ranges/register            (PT2)
 *          body: { agentId, hallId, ticketColor, firstScannedSerial, count }
 *   POST   /api/admin/physical-tickets/ranges/:id/close           (PT2)
 *          body: {} — agentId utledes fra authed user
 *   GET    /api/admin/physical-tickets/ranges?agentId=&hallId=    (PT2)
 *   POST   /api/admin/physical-tickets/ranges/:id/record-batch-sale (PT3)
 *          body: { newTopSerial: string, scheduledGameId?: string }
 *
 * Permission: `PHYSICAL_TICKET_WRITE` (ADMIN + HALL_OPERATOR) — matcher PT1.
 * HALL_OPERATOR må selv-validere at hallId matcher eget hall-scope.
 *
 * Merk om agentId:
 *   - Bingovert registrerer egen range: `agentId` må = innlogget bruker.
 *   - ADMIN kan registrere på vegne av en bingovert (helpdesk/drift) —
 *     da tillates mismatch. Dette matcher "ADMIN har alle"-invarianten.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { AgentTicketRangeService } from "../compliance/AgentTicketRangeService.js";
import type { StaticTicketColor } from "../compliance/StaticTicketService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-agent-ticket-ranges" });

const VALID_COLORS: readonly StaticTicketColor[] = [
  "small",
  "large",
  "traffic-light",
] as const;

export interface AdminAgentTicketRangesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  agentTicketRangeService: AgentTicketRangeService;
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

function actorTypeFromRole(
  role: PublicAppUser["role"],
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "AGENT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  if (role === "AGENT") return "AGENT";
  return "USER";
}

/**
 * Mapper DomainError-koder til HTTP-status. Admin-konvensjonen er at feil
 * returneres som 200 med `{ ok: false }`; men for PT2+PT3 eksponerer vi
 * semantiske statuser (200/403/409) for scan-feil siden klienten er en
 * bingovert-app som bruker native HTTP-semantikk for varsel-typer.
 *
 * - TICKET_* / RANGE_* / INSUFFICIENT_INVENTORY → 409 CONFLICT
 * - PT3: NO_TICKETS_SOLD / NO_UPCOMING_GAME_FOR_HALL /
 *        INVALID_NEW_TOP / SERIAL_NOT_IN_RANGE / SCHEDULED_GAME_* → 409
 * - FORBIDDEN / UNAUTHORIZED                     → 403
 * - alt annet (inkl. INVALID_INPUT)             → 400
 */
function statusForDomainCode(code: string): number {
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return 403;
  if (
    code === "TICKET_WRONG_HALL"
    || code === "TICKET_WRONG_COLOR"
    || code === "TICKET_ALREADY_SOLD"
    || code === "TICKET_ALREADY_RESERVED"
    || code === "TICKET_NOT_FOUND"
    || code === "RANGE_NOT_FOUND"
    || code === "RANGE_ALREADY_CLOSED"
    || code === "INSUFFICIENT_INVENTORY"
    || code === "NO_TICKETS_SOLD"
    || code === "NO_UPCOMING_GAME_FOR_HALL"
    || code === "INVALID_NEW_TOP"
    || code === "SERIAL_NOT_IN_RANGE"
    || code === "SCHEDULED_GAME_NOT_FOUND"
    || code === "SCHEDULED_GAME_HALL_MISMATCH"
    || code === "SCHEDULED_GAME_NOT_JOINABLE"
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
  // Fallback til admin-default (apiFailure — 400 + INTERNAL_ERROR).
  apiFailure(res, error);
}

function parseTicketColor(value: unknown): StaticTicketColor {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "ticketColor må være en streng.");
  }
  const v = value.trim() as StaticTicketColor;
  if (!VALID_COLORS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `ticketColor må være en av ${VALID_COLORS.join(", ")}.`,
    );
  }
  return v;
}

function parsePositiveInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et positivt heltall.`,
    );
  }
  return n;
}

export function createAdminAgentTicketRangesRouter(
  deps: AdminAgentTicketRangesRouterDeps,
): express.Router {
  const { platformService, auditLogService, agentTicketRangeService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[PT2] audit append failed");
    });
  }

  // POST /api/admin/physical-tickets/ranges/register
  router.post(
    "/api/admin/physical-tickets/ranges/register",
    async (req, res) => {
      try {
        const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const agentId = mustBeNonEmptyString(req.body.agentId, "agentId");
        const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
        const firstScannedSerial = mustBeNonEmptyString(
          req.body.firstScannedSerial,
          "firstScannedSerial",
        );
        const ticketColor = parseTicketColor(req.body.ticketColor);
        const count = parsePositiveInt(req.body.count, "count");

        // Authz: HALL_OPERATOR kan kun registrere i egen hall.
        assertUserHallScope(user, hallId);

        // Authz: HALL_OPERATOR/AGENT registrerer kun for seg selv;
        // ADMIN kan registrere på vegne av en annen bingovert.
        if (user.role !== "ADMIN" && user.id !== agentId) {
          throw new DomainError(
            "FORBIDDEN",
            "Du kan kun registrere range for din egen bruker.",
          );
        }

        const result = await agentTicketRangeService.registerRange({
          agentId,
          hallId,
          ticketColor,
          firstScannedSerial,
          count,
        });

        fireAudit({
          actorId: user.id,
          actorType: actorTypeFromRole(user.role),
          action: "physical_ticket.range_registered",
          resource: "agent_ticket_range",
          resourceId: result.rangeId,
          details: {
            agentId,
            hallId,
            ticketColor,
            firstScannedSerial,
            count,
            initialTopSerial: result.initialTopSerial,
            finalSerial: result.finalSerial,
            reservedCount: result.reservedCount,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // POST /api/admin/physical-tickets/ranges/:id/close
  router.post(
    "/api/admin/physical-tickets/ranges/:id/close",
    async (req, res) => {
      try {
        const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
        const rangeId = mustBeNonEmptyString(req.params.id, "id");

        // Først: hent rangen slik at vi kan hall-scope-validere før closeRange.
        const existing = await agentTicketRangeService.getRangeById(rangeId);
        if (!existing) {
          throw new DomainError(
            "RANGE_NOT_FOUND",
            `Range '${rangeId}' finnes ikke.`,
          );
        }
        assertUserHallScope(user, existing.hallId);

        // ADMIN kan lukke på vegne av bingovert; ellers må caller eie rangen.
        const effectiveUserId = user.role === "ADMIN" ? existing.agentId : user.id;

        const result = await agentTicketRangeService.closeRange(
          rangeId,
          effectiveUserId,
        );

        fireAudit({
          actorId: user.id,
          actorType: actorTypeFromRole(user.role),
          action: "physical_ticket.range_closed",
          resource: "agent_ticket_range",
          resourceId: rangeId,
          details: {
            agentId: existing.agentId,
            hallId: existing.hallId,
            closedAt: result.closedAt,
            onBehalf: user.id !== existing.agentId,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  // GET /api/admin/physical-tickets/ranges?agentId=&hallId=
  router.get("/api/admin/physical-tickets/ranges", async (req, res) => {
    try {
      const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const agentId = typeof req.query.agentId === "string" && req.query.agentId.trim()
        ? req.query.agentId.trim()
        : null;
      const hallId = typeof req.query.hallId === "string" && req.query.hallId.trim()
        ? req.query.hallId.trim()
        : null;

      if (hallId) {
        assertUserHallScope(user, hallId);
      }

      // HALL_OPERATOR uten hallId-filter: begrens til egen hall automatisk.
      let effectiveHallId = hallId;
      if (!effectiveHallId && user.role === "HALL_OPERATOR") {
        if (!user.hallId) {
          throw new DomainError(
            "FORBIDDEN",
            "Din bruker er ikke tildelt en hall — kontakt admin.",
          );
        }
        effectiveHallId = user.hallId;
      }

      if (!agentId && !effectiveHallId) {
        throw new DomainError(
          "INVALID_INPUT",
          "Minst én av agentId eller hallId må spesifiseres.",
        );
      }

      let ranges;
      if (agentId && effectiveHallId) {
        // Intersect via filter i minnet (forventet lite volum).
        const byAgent = await agentTicketRangeService.listActiveRangesByAgent(agentId);
        ranges = byAgent.filter((r) => r.hallId === effectiveHallId);
      } else if (agentId) {
        // ADMIN/SUPPORT med kun agentId — alle haller.
        ranges = await agentTicketRangeService.listActiveRangesByAgent(agentId);
      } else {
        ranges = await agentTicketRangeService.listActiveRangesByHall(
          effectiveHallId!,
        );
      }

      apiSuccess(res, { ranges });
    } catch (error) {
      replyFailure(res, error);
    }
  });

  // PT3 — POST /api/admin/physical-tickets/ranges/:id/record-batch-sale
  // Body: { newTopSerial: string, scheduledGameId?: string }
  // Response: { ok: true, data: { soldCount, scheduledGameId, gameStartTime,
  //            newTopSerial, previousTopSerial, soldSerials, rangeId } }
  //        eller { ok: false, error: { code, message } } med 400/403/409.
  router.post(
    "/api/admin/physical-tickets/ranges/:id/record-batch-sale",
    async (req, res) => {
      try {
        const user = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
        const rangeId = mustBeNonEmptyString(req.params.id, "id");

        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const newTopSerial = mustBeNonEmptyString(
          req.body.newTopSerial,
          "newTopSerial",
        );
        const scheduledGameId = typeof req.body.scheduledGameId === "string"
          && req.body.scheduledGameId.trim()
          ? req.body.scheduledGameId.trim()
          : undefined;

        // Hent rangen for hall-scope-validering før vi kaller service.
        // Dette lar HALL_OPERATOR-valideringen skje uten at servicen trenger
        // å kjenne til hallens ID på forhånd.
        const existing = await agentTicketRangeService.getRangeById(rangeId);
        if (!existing) {
          throw new DomainError(
            "RANGE_NOT_FOUND",
            `Range '${rangeId}' finnes ikke.`,
          );
        }
        assertUserHallScope(user, existing.hallId);

        // ADMIN kan kjøre batch-salg på vegne av bingovert. Ellers må caller
        // være rangens eier.
        const adminOverride = user.role === "ADMIN";
        const effectiveUserId = adminOverride ? existing.agentId : user.id;

        const result = await agentTicketRangeService.recordBatchSale({
          rangeId,
          newTopSerial,
          userId: effectiveUserId,
          adminOverride,
          scheduledGameId,
        });

        fireAudit({
          actorId: user.id,
          actorType: actorTypeFromRole(user.role),
          action: "physical_ticket.batch_sold",
          resource: "agent_ticket_range",
          resourceId: rangeId,
          details: {
            agentId: existing.agentId,
            hallId: existing.hallId,
            ticketColor: existing.ticketColor,
            rangeId,
            scheduledGameId: result.scheduledGameId,
            gameStartTime: result.gameStartTime,
            soldCount: result.soldCount,
            fromSerial: result.soldSerials[0] ?? null,
            toSerial: result.soldSerials[result.soldSerials.length - 1] ?? null,
            previousTopSerial: result.previousTopSerial,
            newTopSerial: result.newTopSerial,
            onBehalf: adminOverride && user.id !== existing.agentId,
          },
          ipAddress: clientIp(req),
          userAgent: userAgentHeader(req),
        });

        apiSuccess(res, result);
      } catch (error) {
        replyFailure(res, error);
      }
    },
  );

  return router;
}
