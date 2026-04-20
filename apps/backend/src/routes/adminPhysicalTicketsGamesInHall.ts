/**
 * BIN-638: admin physical-tickets games-in-hall aggregate.
 *
 *   GET /api/admin/physical-tickets/games/in-hall?hallId=&from=&to=
 *
 * Aggregat per `assigned_game_id` scoped til én hall, med
 * sold / pendingCashoutCount (alias ticketsInPlay) / cashedOut-tellere og
 * `name` + `status` fra `hall_game_schedules`. Read-only. Ingen mutasjoner,
 * ingen audit-skriv. Permission: `DAILY_REPORT_READ` (samme mønster som
 * BIN-648 — det er ingen eksplisitt `PHYSICAL_TICKET_READ`-permission i
 * AdminAccessPolicy, og `DAILY_REPORT_READ` gir ADMIN + HALL_OPERATOR +
 * SUPPORT som er den ønskede scope-en for en rapport-lignende aggregat).
 *
 * Parallell-hensyn:
 *   - Lever i egen route-fil (som BIN-648 adminReportsPhysicalTickets) for å
 *     unngå merge-konflikt på adminPhysicalTickets.ts / admin.ts med
 *     parallelle BIN-639/640/641.
 *
 * Hall-scope:
 *   - `hallId` er påkrevd query-param.
 *   - ADMIN + SUPPORT får operere på hvilken som helst hall.
 *   - HALL_OPERATOR tvinges til egen hall via assertUserHallScope; fremmed
 *     hallId → FORBIDDEN.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { PhysicalTicketsGamesInHallService } from "../admin/PhysicalTicketsGamesInHall.js";
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
  parseLimit,
} from "../util/httpHelpers.js";

export interface AdminPhysicalTicketsGamesInHallRouterDeps {
  platformService: PlatformService;
  physicalTicketsGamesInHallService: PhysicalTicketsGamesInHallService;
}

function parseOptionalIso(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  return new Date(ms).toISOString();
}

export function createAdminPhysicalTicketsGamesInHallRouter(
  deps: AdminPhysicalTicketsGamesInHallRouterDeps,
): express.Router {
  const { platformService, physicalTicketsGamesInHallService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    return user;
  }

  router.get("/api/admin/physical-tickets/games/in-hall", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      // hallId er påkrevd for BIN-638 (per-hall aggregat).
      const hallId = mustBeNonEmptyString(req.query.hallId, "hallId");
      // HALL_OPERATOR tvinges til egen hall. assertUserHallScope kaster
      // FORBIDDEN dersom cross-hall hallId forsøkes.
      assertUserHallScope(actor, hallId);

      const from = parseOptionalIso(req.query.from, "from");
      const to = parseOptionalIso(req.query.to, "to");
      if (from && to && Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }
      const limit = parseLimit(req.query.limit, 500);

      const result = await physicalTicketsGamesInHallService.gamesInHall({
        hallId,
        from,
        to,
        limit,
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
