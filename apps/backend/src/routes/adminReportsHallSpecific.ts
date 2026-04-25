/**
 * BIN-17.36: "Hall Specific Report" admin-endpoint.
 *
 *   GET /api/admin/reports/hall-specific?from=&to=&hallIds=a,b,c
 *
 * Legacy reference:
 *   - `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` §17.36
 *   - Appendix B (PM-låst): Elvis Replacement Amount-kolonne beholdes.
 *
 * RBAC: DAILY_REPORT_READ (ADMIN + HALL_OPERATOR + SUPPORT).
 * HALL_OPERATOR auto-scopet via resolveHallScopeFilter; kall med hallIds=
 * som inneholder andre haller fail-closed.
 *
 * Read-only. Ingen audit-log (aggregert uten PII).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { HallGroupService } from "../admin/HallGroupService.js";
import type { AgentService } from "../agent/AgentService.js";
import {
  assertAdminPermission,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { buildHallSpecificReport } from "../admin/reports/HallSpecificReport.js";

export interface AdminReportsHallSpecificRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
  hallGroupService: HallGroupService;
  agentService: AgentService;
}

function parseIsoOrDefault(value: unknown, fieldName: string, fallback: Date): string {
  if (value === undefined || value === null || value === "") {
    return fallback.toISOString();
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const trimmed = value.trim();
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

function parseHallIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : undefined;
}

export function createAdminReportsHallSpecificRouter(
  deps: AdminReportsHallSpecificRouterDeps,
): express.Router {
  const { platformService, engine, hallGroupService, agentService } = deps;
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, "DAILY_REPORT_READ");
    return user;
  }

  router.get("/api/admin/reports/hall-specific", async (req, res) => {
    try {
      const user = await requireUser(req);
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      // hall-scope håndtering. HALL_OPERATOR auto-scopet til egen hall;
      // ADMIN/SUPPORT kan spesifisere hallIds=a,b,c eller se alle.
      let requestedHallIds = parseHallIds(req.query.hallIds);
      if (user.role === "HALL_OPERATOR") {
        const scoped = resolveHallScopeFilter(user, undefined);
        if (!scoped) {
          throw new DomainError("FORBIDDEN", "Du har ikke tildelt hall.");
        }
        if (requestedHallIds && requestedHallIds.some((h) => h !== scoped)) {
          throw new DomainError("FORBIDDEN", "Du kan kun se din egen hall.");
        }
        requestedHallIds = [scoped];
      }

      const [halls, hallGroups, agents, scheduleSlots, scheduleLogs] = await Promise.all([
        platformService.listHalls({ includeInactive: true }),
        hallGroupService.list({ limit: 500, includeDeleted: false }),
        agentService.list({ limit: 500 }),
        platformService.listAllScheduleSlots({ hallIds: requestedHallIds }),
        platformService.listScheduleLogInRange({ from, to }),
      ]);

      // Ledger-oppslag for vinduet. Intern cap 10k/dag; vi henter hele
      // rangen. For lange perioder bør en paginert variant brukes.
      const entries = engine.listComplianceLedgerEntries({
        dateFrom: from,
        dateTo: to,
        limit: 10_000,
      });

      const result = buildHallSpecificReport({
        halls,
        hallGroups,
        agents,
        scheduleSlots: scheduleSlots ?? [],
        scheduleLogs,
        entries,
        from,
        to,
        hallIds: requestedHallIds,
      });

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
