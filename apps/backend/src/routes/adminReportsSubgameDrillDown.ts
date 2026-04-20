/**
 * BIN-647: subgame drill-down admin-endpoint.
 *
 *   GET /api/admin/reports/subgame-drill-down?parentId=&from=&to=&cursor=&limit=
 *
 * Legacy: legacy/unity-backend/App/Controllers/ReportsController.js:770-822
 * (`getGame1Subgames`) + view `report/subgame1reports.html`.
 *
 * Returns one row per sub-game (child of `parentId`) aggregated over the
 * requested ISO window. Reuses the cursor/offset pattern from BIN-628
 * (adminTrackSpending). Read-only — no audit-log (not regulatory-scoped;
 * hall-scope is enforced so HALL_OPERATOR only sees their own halls).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import {
  assertAdminPermission,
  assertUserHallScope,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
} from "../util/httpHelpers.js";
import { buildSubgameDrillDown } from "../admin/reports/SubgameDrillDownReport.js";

export interface AdminReportsSubgameDrillDownRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
}

function parseIsoOrDefault(value: unknown, fieldName: string, fallback: Date): string {
  if (value === undefined || value === null || value === "") {
    return fallback.toISOString();
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const ms = Date.parse(value.trim());
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

export function createAdminReportsSubgameDrillDownRouter(
  deps: AdminReportsSubgameDrillDownRouterDeps,
): express.Router {
  const { platformService, engine } = deps;
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, "DAILY_REPORT_READ");
    return user;
  }

  router.get("/api/admin/reports/subgame-drill-down", async (req, res) => {
    try {
      const user = await requireUser(req);
      const parentId = mustBeNonEmptyString(req.query.parentId, "parentId");

      // Resolve parent to enforce hall-scope + reject unknown ids.
      const parent = await platformService.getScheduleSlotById(parentId);
      if (!parent) {
        throw new DomainError(
          "SCHEDULE_SLOT_NOT_FOUND",
          `Finner ingen schedule-slot med id '${parentId}'.`,
        );
      }
      // Caller must be allowed to see this hall's data.
      assertUserHallScope(user, parent.hallId);

      const now = new Date();
      // Default vindu: siste 7 dager (samme som BIN-628).
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      const cursor = optionalNonEmpty(req.query.cursor);
      const pageSize = parseLimit(req.query.limit, 50);

      const children = await platformService.listSubGameChildren(parent.id);
      const scheduleSlotIds = children.map((c) => c.id);

      const [scheduleLogs, halls] = await Promise.all([
        platformService.listScheduleLogForSlots({
          scheduleSlotIds,
          from,
          to,
        }),
        platformService.listHalls({ includeInactive: true }),
      ]);

      // Scope ledger read to the parent's hall — drill-down is per-parent so
      // cross-hall noise would be wrong anyway, and this keeps the query
      // cheap for busy halls.
      const entries = engine.listComplianceLedgerEntries({
        dateFrom: from,
        dateTo: to,
        hallId: parent.hallId,
        limit: 10_000,
      });

      const result = buildSubgameDrillDown({
        parentId: parent.id,
        children,
        scheduleLogs,
        entries,
        halls,
        from,
        to,
        cursor,
        pageSize,
      });

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
