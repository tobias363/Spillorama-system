/**
 * BIN-587 B4b: unique-id management + payout drill-down.
 *
 * Unique-IDs er de printede numrene på papirbilletter — identisk med
 * `app_physical_tickets.unique_id` fra B4a. Endepunktene her gir admin
 * en slank view som ikke krever batch-kontekst.
 *
 * Payout drill-down er per-spiller / per-game aggregering fra ledger-
 * data (BingoEngine.generateTopPlayers / generateGameSessions finnes
 * allerede fra B3-report — vi snevrer til én spiller / ett game).
 *
 * BIN-649: range-rapport for unique-tickets — numerisk range på unique_id
 * med valgfri hallId/status/opprettet-dato-filter. Read-only, ingen
 * AuditLog (samme pattern som BIN-587 B3 daily/monthly-reports).
 *
 * Endepunkter:
 *   GET /api/admin/unique-ids?hallId&status
 *   POST /api/admin/unique-ids/check
 *   GET /api/admin/unique-ids/:uniqueId
 *   GET /api/admin/unique-ids/:uniqueId/transactions
 *   GET /api/admin/payouts/by-player/:userId
 *   GET /api/admin/payouts/by-game/:gameId/tickets
 *   GET /api/admin/reports/unique-tickets/range    ← BIN-649
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { PhysicalTicketService, PhysicalTicketStatus } from "../compliance/PhysicalTicketService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  resolveHallScopeFilter,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  parseOptionalInteger,
  isRecordObject,
} from "../util/httpHelpers.js";

export interface AdminUniqueIdsAndPayoutsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  physicalTicketService: PhysicalTicketService;
  engine: BingoEngine;
}

function parseStatus(raw: unknown): PhysicalTicketStatus | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const upper = raw.trim().toUpperCase() as PhysicalTicketStatus;
  if (upper !== "UNSOLD" && upper !== "SOLD" && upper !== "VOIDED") {
    throw new DomainError("INVALID_INPUT", "status må være UNSOLD, SOLD eller VOIDED.");
  }
  return upper;
}

/** BIN-649: parse numerisk unique-id (BIGINT, må være ≥ 0). */
function parseNumericId(raw: unknown, field: string): number | undefined {
  const n = parseOptionalInteger(raw, field);
  if (n === undefined) return undefined;
  if (n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være ≥ 0.`);
  }
  return n;
}

/** BIN-649: ikke-negativt heltall (f.eks. offset) med fallback. */
function parsePositiveInt(raw: unknown, field: string, fallback: number): number {
  const n = parseOptionalInteger(raw, field);
  if (n === undefined) return fallback;
  if (n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være ≥ 0.`);
  }
  return n;
}

/**
 * BIN-649: parse valgfri ISO-dato/tidspunkt. Akseptererer både rene datoer
 * (YYYY-MM-DD) og full ISO-timestamp — vi sender tekst direkte til Postgres
 * som gjør TIMESTAMPTZ-konvertering og trygt kaster på ugyldig format.
 */
function parseIsoDateParam(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng.`);
  }
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være ISO-dato (YYYY-MM-DD eller YYYY-MM-DDTHH:mm:ssZ).`
    );
  }
  return trimmed;
}

export function createAdminUniqueIdsAndPayoutsRouter(
  deps: AdminUniqueIdsAndPayoutsRouterDeps
): express.Router {
  const { platformService, physicalTicketService, engine } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  // ── Static-path endpoints MÅ komme før :uniqueId-rutene ─────────────

  router.post("/api/admin/unique-ids/check", async (req, res) => {
    try {
      await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const uniqueId = mustBeNonEmptyString(req.body.uniqueId, "uniqueId");
      const ticket = await physicalTicketService.findByUniqueId(uniqueId);
      if (!ticket) {
        apiSuccess(res, { exists: false, sellable: false, ticket: null });
        return;
      }
      apiSuccess(res, {
        exists: true,
        sellable: ticket.status === "UNSOLD",
        ticket,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/unique-ids", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(actor, hallIdInput);
      const status = parseStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 100);
      const tickets = await physicalTicketService.listUniqueIds({ hallId, status, limit });
      apiSuccess(res, { tickets, count: tickets.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/unique-ids/:uniqueId", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const uniqueId = mustBeNonEmptyString(req.params.uniqueId, "uniqueId");
      const ticket = await physicalTicketService.findByUniqueId(uniqueId);
      if (!ticket) {
        throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Billetten finnes ikke.");
      }
      // Hall-scope — HALL_OPERATOR kan bare se egen halls billetter
      assertUserHallScope(actor, ticket.hallId);
      apiSuccess(res, ticket);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/unique-ids/:uniqueId/transactions", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      const uniqueId = mustBeNonEmptyString(req.params.uniqueId, "uniqueId");
      const ticket = await physicalTicketService.findByUniqueId(uniqueId);
      if (!ticket) {
        throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Billetten finnes ikke.");
      }
      assertUserHallScope(actor, ticket.hallId);
      // Bygg en audit-trail fra ticketens egne state-overganger (lightweight
      // — full wallet-tx-historikk kommer via /api/admin/payouts/by-player
      // når en spiller er knyttet til billetten).
      const events: Array<{ at: string; event: string; actor: string | null; details: Record<string, unknown> }> = [];
      events.push({
        at: ticket.createdAt,
        event: "CREATED",
        actor: null,
        details: { batchId: ticket.batchId, hallId: ticket.hallId },
      });
      if (ticket.soldAt) {
        events.push({
          at: ticket.soldAt,
          event: "SOLD",
          actor: ticket.soldBy,
          details: {
            buyerUserId: ticket.buyerUserId,
            priceCents: ticket.priceCents,
            assignedGameId: ticket.assignedGameId,
          },
        });
      }
      if (ticket.voidedAt) {
        events.push({
          at: ticket.voidedAt,
          event: "VOIDED",
          actor: ticket.voidedBy,
          details: { reason: ticket.voidedReason },
        });
      }
      events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      apiSuccess(res, { uniqueId: ticket.uniqueId, currentStatus: ticket.status, events });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Payout drill-down ────────────────────────────────────────────────

  router.get("/api/admin/payouts/by-player/:userId", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PAYOUT_AUDIT_READ");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      // Verifiser at spilleren finnes før vi gir ut data.
      await platformService.getUserById(userId);
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(actor, hallIdInput);
      // generateTopPlayers med spesifikk player-filter er ikke i engine-API.
      // Bruker en bredere top-N-query og filtrerer — grei løsning for
      // pilot-volum (en spiller kan ikke være på topp hvis de ikke
      // har spilt mer enn limit-antall spillere).
      const topReport = engine.generateTopPlayers({
        startDate,
        endDate,
        hallId,
        limit: 200,
      });
      const playerRow = topReport.rows.find((r) => r.playerId === userId) ?? {
        playerId: userId,
        totalStakes: 0,
        totalPrizes: 0,
        net: 0,
        gameCount: 0,
      };
      apiSuccess(res, {
        playerId: userId,
        startDate: topReport.startDate,
        endDate: topReport.endDate,
        summary: playerRow,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-649: unique-tickets range report ────────────────────────────

  router.get("/api/admin/reports/unique-tickets/range", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(actor, hallIdInput);
      const status = parseStatus(req.query.status);
      const uniqueIdStart = parseNumericId(req.query.uniqueIdStart, "uniqueIdStart");
      const uniqueIdEnd = parseNumericId(req.query.uniqueIdEnd, "uniqueIdEnd");
      const createdFrom = parseIsoDateParam(req.query.from, "from");
      const createdTo = parseIsoDateParam(req.query.to, "to");
      if (
        uniqueIdStart !== undefined &&
        uniqueIdEnd !== undefined &&
        uniqueIdEnd < uniqueIdStart
      ) {
        throw new DomainError("INVALID_INPUT", "uniqueIdEnd må være ≥ uniqueIdStart.");
      }
      if (createdFrom && createdTo && createdTo < createdFrom) {
        throw new DomainError("INVALID_INPUT", "to må være ≥ from.");
      }
      const limit = parseLimit(req.query.limit, 200);
      const offset = parsePositiveInt(req.query.offset, "offset", 0);
      const tickets = await physicalTicketService.listUniqueIdsInRange({
        hallId,
        status,
        uniqueIdStart,
        uniqueIdEnd,
        createdFrom,
        createdTo,
        limit,
        offset,
      });
      apiSuccess(res, {
        hallId: hallId ?? null,
        status: status ?? null,
        uniqueIdStart: uniqueIdStart ?? null,
        uniqueIdEnd: uniqueIdEnd ?? null,
        from: createdFrom ?? null,
        to: createdTo ?? null,
        limit,
        offset,
        rows: tickets,
        count: tickets.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/payouts/by-game/:gameId/tickets", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PAYOUT_AUDIT_READ");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(actor, hallIdInput);
      const limit = parseLimit(req.query.limit, 200);
      // Two-sided payout-drilldown:
      //  - physical-tickets solgt for dette spillet (fra PhysicalTicketService)
      //  - game-session-aggregat fra ledger (fra ComplianceLedger)
      const [physicalTickets, gameSessions] = await Promise.all([
        physicalTicketService.listSoldTicketsForGame(gameId, { hallId, limit }),
        // startDate/endDate er valgfri men krevd av engine-API — bruk brett range
        // (hele 2026) som default. Callere kan filtrere videre i UI.
        Promise.resolve(
          engine.generateGameSessions({
            startDate: typeof req.query.startDate === "string" ? req.query.startDate : "2026-01-01",
            endDate: typeof req.query.endDate === "string" ? req.query.endDate : "2026-12-31",
            hallId,
            limit: 1,
          })
        ),
      ]);
      const sessionSummary = gameSessions.rows.find((r) => r.gameId === gameId) ?? null;
      apiSuccess(res, {
        gameId,
        physicalTickets,
        physicalTicketCount: physicalTickets.length,
        sessionSummary,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
