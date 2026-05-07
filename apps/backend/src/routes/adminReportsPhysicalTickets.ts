/**
 * BIN-648: admin physical-tickets aggregate report.
 *
 *   GET /api/admin/reports/physical-tickets/aggregate?hallId=&from=&to=
 *
 * Aggregat per (gameId, hallId) med `sold / pending / cashed-out`-tellere.
 * Read-only. Ingen mutasjoner, ingen audit-skriv. Permission: `DAILY_REPORT_READ`
 * (samme som øvrige hall-rapporter i adminHallReports).
 *
 * Parallell-hensyn (BIN-645 PR-A4 rapport-bolk):
 *   - BIN-647 (subgame drill-down) og BIN-649 (unique-tickets range) lander
 *     i parallell. For å unngå merge-konflikt på admin.ts / adminHallReports
 *     ligger BIN-648-endepunktet i egen fil. Samme convention som
 *     adminHallReports / adminTrackSpending.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { PhysicalTicketsAggregateService } from "../admin/PhysicalTicketsAggregate.js";
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
  parseLimit,
} from "../util/httpHelpers.js";

export interface AdminReportsPhysicalTicketsRouterDeps {
  platformService: PlatformService;
  physicalTicketsAggregateService: PhysicalTicketsAggregateService;
}

function optionalNonEmpty(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

export function createAdminReportsPhysicalTicketsRouter(
  deps: AdminReportsPhysicalTicketsRouterDeps,
): express.Router {
  const { platformService, physicalTicketsAggregateService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user, permission);
    return user;
  }

  router.get("/api/admin/reports/physical-tickets/aggregate", async (req, res) => {
    try {
      const actor = await requirePermission(req, "DAILY_REPORT_READ");
      const hallIdInput = optionalNonEmpty(req.query.hallId);
      // HALL_OPERATOR tvinges til egen hall (samme mønster som øvrige reports).
      // Hvis de oppgir annen hall → FORBIDDEN via assertUserHallScope.
      if (actor.role === "HALL_OPERATOR" && hallIdInput) {
        assertUserHallScope(actor, hallIdInput);
      }
      const hallId = resolveHallScopeFilter(actor, hallIdInput);
      const from = parseOptionalIso(req.query.from, "from");
      const to = parseOptionalIso(req.query.to, "to");
      if (from && to && Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }
      const limit = parseLimit(req.query.limit, 1000);

      const result = await physicalTicketsAggregateService.aggregate({
        hallId: hallId ?? null,
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
