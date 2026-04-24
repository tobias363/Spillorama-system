/**
 * BIN-17.32: "Past Game Winning History" — agent-endepunkt.
 *
 *   GET /api/agent/reports/past-winning-history
 *     ?hallId=&from=&to=&ticketId=&offset=&limit=
 *
 * Legacy reference:
 *   - `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` §17.32
 *
 * RBAC:
 *   - AGENT   → hall-scope = shift.hallId (aktiv shift påkrevd).
 *   - HALL_OPERATOR → hall-scope = user.hallId.
 *   - ADMIN   → globalt scope (kan filtrere på hvilken som helst hallId).
 *
 * Read-only — ingen AuditLog siden wireframe-kolonner er aggregerte og ikke
 * bryter personvern (ticketSerial, ikke person-info). Samme mønster som
 * `adminReportsGame1Management.ts`.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, UserRole } from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { StaticTicketService } from "../compliance/StaticTicketService.js";
import { deriveColorFamily } from "../compliance/StaticTicketService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import {
  buildPastWinningHistory,
  type PastWinningSourceTicket,
} from "../agent/reports/PastWinningHistoryReport.js";

export interface AgentReportsPastWinningRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  staticTicketService: StaticTicketService;
}

interface ResolvedActor {
  user: PublicAppUser;
  /** null = ADMIN (globalt). Ellers påkrevd hall. */
  hallId: string | null;
  role: UserRole;
}

function parseIsoOrDefault(value: unknown, fieldName: string, fallback: Date): string {
  if (value === undefined || value === null || value === "") {
    return fallback.toISOString();
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const trimmed = value.trim();
  // Accept YYYY-MM-DD by widening to full-day bounds.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dayStart = new Date(`${trimmed}T00:00:00.000Z`);
    const dayEnd = new Date(`${trimmed}T23:59:59.999Z`);
    if (fieldName === "from") return dayStart.toISOString();
    if (fieldName === "to") return dayEnd.toISOString();
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  return new Date(ms).toISOString();
}

function parseOptionalPositiveInt(value: unknown, field: string, max = 500): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et positivt heltall.`);
  }
  return Math.min(n, max);
}

function optionalNonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createAgentReportsPastWinningRouter(
  deps: AgentReportsPastWinningRouterDeps,
): express.Router {
  const { platformService, agentService, agentShiftService, staticTicketService } = deps;
  const router = express.Router();

  /**
   * Autoriser og etabler hall-scope. Samme mønster som agentBingo.ts.
   */
  async function resolveActor(req: express.Request): Promise<ResolvedActor> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
      const shift = await agentShiftService.getCurrentShift(user.id);
      if (!shift) {
        throw new DomainError(
          "SHIFT_NOT_ACTIVE",
          "Du må starte en shift før du kan hente vinner-historikk.",
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
      "Kun AGENT, HALL_OPERATOR og ADMIN har tilgang til agent-rapporten.",
    );
  }

  router.get("/api/agent/reports/past-winning-history", async (req, res) => {
    try {
      const actor = await resolveActor(req);

      // Dato-vindu: default 7 dager bak.
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      // Hall-scope: AGENT/HALL_OPERATOR → tvinges til egen hall. ADMIN kan
      // filtrere på `hallId` eller se alle haller hvis ikke satt.
      const explicitHallId = optionalNonEmpty(req.query.hallId);
      let hallId: string | undefined;
      if (actor.hallId !== null) {
        // Ikke-admin: ignorer eksplisitt hallId hvis den ikke matcher.
        if (explicitHallId && explicitHallId !== actor.hallId) {
          throw new DomainError(
            "FORBIDDEN",
            "Du har ikke tilgang til denne hallen.",
          );
        }
        hallId = actor.hallId;
      } else {
        hallId = explicitHallId;
      }

      const ticketIdFilter = optionalNonEmpty(req.query.ticketId);
      const offset = parseOptionalPositiveInt(req.query.offset, "offset", 100_000) ?? 0;
      const limit = parseOptionalPositiveInt(req.query.limit, "limit", 500) ?? 100;

      // DB-oppslag: hent alle utbetalte tickets innenfor vinduet (hall-scoped).
      const tickets = await staticTicketService.listPaidOutInRange({
        hallId,
        from,
        to,
        ticketIdPrefix: ticketIdFilter,
      });

      const sources: PastWinningSourceTicket[] = tickets
        .filter((t) => t.paidOutAt !== null)
        .map((t) => ({
          ticketId: t.ticketSerial,
          ticketType: t.ticketType,
          ticketColor: t.ticketColor,
          priceCents: t.paidOutAmountCents,
          // paidOutAt er non-null fordi filter kjørte over.
          paidOutAt: t.paidOutAt as string,
          // Static-ticket har ikke patternWon i skjemaet; vi bruker
          // deriveColorFamily-heuristikk (large/small/traffic-light) som
          // "type-klasse" og setter winningPattern til null inntil PT-backend
          // eksponerer det. Legacy wireframe tillater "—" for mønster når
          // ukjent.
          winningPattern: null,
          hallId: t.hallId,
        }));

      const result = buildPastWinningHistory({
        tickets: sources,
        from,
        to,
        ticketId: ticketIdFilter,
        offset,
        limit,
      });

      apiSuccess(res, {
        ...result,
        hallId: hallId ?? null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}

// Re-export så callsite/tester kan validere color-mapping mot det som legacy
// produserer i CSV-import.
export { deriveColorFamily };
