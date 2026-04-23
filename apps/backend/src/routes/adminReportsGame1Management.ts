/**
 * BIN-BOT-01: "Report Management Game 1" admin-endpoint.
 *
 *   GET /api/admin/reports/game1?from=&to=&groupOfHallId=&hallId=&type=&q=
 *
 * Legacy reference:
 *   - `WF_B_Spillorama Admin V1.0.pdf` p.29 (Report Management → Game 1)
 *   - `WF_B_SpilloramaBotReport_V1.0_31.01.2024.pdf` p.5-8 (By Player / By Bot)
 *
 * Returns `{ rows, totals, generatedAt, from, to, type }` per the legacy
 * wireframe's Game 1 report table. Each row represents one sub-game
 * (child of some parent schedule) aggregated over the window.
 *
 * Columns: subGameId, childGameId, groupOfHallName, hallName, startedAt,
 * OMS (sum stake), UTD (sum payout), Payout%, RES.
 *
 * Permission: DAILY_REPORT_READ (ADMIN + SUPPORT + HALL_OPERATOR).
 * HALL_OPERATOR is auto-scoped to their own hall via resolveHallScopeFilter.
 *
 * Read-only. No audit-log (non-regulatory-scoped aggregate; hall-scope
 * is enforced).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { HallGroupService } from "../admin/HallGroupService.js";
import {
  assertAdminPermission,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import {
  buildGame1ManagementReport,
  type Game1ReportType,
} from "../admin/reports/Game1ManagementReport.js";

export interface AdminReportsGame1ManagementRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
  hallGroupService: HallGroupService;
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

function optionalNonEmpty(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseReportType(value: unknown): Game1ReportType {
  if (value === undefined || value === null || value === "") return "player";
  if (typeof value !== "string") return "player";
  const normalised = value.trim().toLowerCase();
  if (normalised === "bot") return "bot";
  // Default to "player" for unknown values — the bot-filter is a
  // feature-flag for future bot-support; we never want this to crash
  // the route.
  return "player";
}

export function createAdminReportsGame1ManagementRouter(
  deps: AdminReportsGame1ManagementRouterDeps,
): express.Router {
  const { platformService, engine, hallGroupService } = deps;
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, "DAILY_REPORT_READ");
    return user;
  }

  router.get("/api/admin/reports/game1", async (req, res) => {
    try {
      const user = await requireUser(req);

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      const hallIdInput = optionalNonEmpty(req.query.hallId);
      // HALL_OPERATOR tvinges til egen hall.
      const hallId = resolveHallScopeFilter(user, hallIdInput);
      const groupOfHallId = optionalNonEmpty(req.query.groupOfHallId);
      const q = optionalNonEmpty(req.query.q);
      const type = parseReportType(req.query.type);

      const [children, scheduleLogs, halls, hallGroups] = await Promise.all([
        platformService.listAllSubGameChildren({ hallId }),
        platformService.listScheduleLogInRange({ from, to, hallId }),
        platformService.listHalls({ includeInactive: true }),
        hallGroupService.list({ limit: 500, includeDeleted: false }),
      ]);

      // Ledger read is scoped to the requested window. If a hall is set,
      // we can narrow further. Otherwise load all halls in the window —
      // the cap inside the ledger is already 10k/day.
      const entries = engine.listComplianceLedgerEntries({
        dateFrom: from,
        dateTo: to,
        hallId,
        limit: 10_000,
      });

      const result = buildGame1ManagementReport({
        children,
        scheduleLogs,
        entries,
        halls,
        hallGroups,
        from,
        to,
        groupOfHallId,
        hallId,
        type,
        q,
      });

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
