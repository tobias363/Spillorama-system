/**
 * BIN-650: admin red-flag categories report.
 *
 *   GET /api/admin/reports/red-flag/categories?from=&to=
 *
 * Legacy: legacy/unity-backend/App/Controllers/redFlagCategoryController.js
 * (`redFlagCategory`) + view `report/redFlagCategories.html`.
 *
 * Aggregerer AML red-flag-rader per `rule_slug` (= kategori) i et valgfritt
 * ISO-vindu. Returnerer label/severity/description fra `app_aml_rules` +
 * count/openCount fra `app_aml_red_flags`.
 *
 * Read-only. Ingen mutasjoner, ingen audit-skriv (per issue-scope —
 * BIN-651 players-viewer har eget audit-krav; categories er ren aggregat).
 * Permission: `PLAYER_AML_READ` (ADMIN + SUPPORT). HALL_OPERATOR er
 * eksplisitt utelatt fra AML per AdminAccessPolicy-policyen — AML er
 * sentralisert compliance, ikke delegert per hall.
 *
 * Parallell-hensyn (BIN-645 PR-A4 rapport-bolk):
 *   - BIN-651 red-flag players lander parallelt og deler shared-types
 *     + index.ts router-mount. Holdes i egen fil (som BIN-647/BIN-648)
 *     for å minimere konfliktflate.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AmlService } from "../compliance/AmlService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { buildRedFlagCategories } from "../admin/reports/RedFlagCategoriesReport.js";

export interface AdminReportsRedFlagCategoriesRouterDeps {
  platformService: PlatformService;
  amlService: AmlService;
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

export function createAdminReportsRedFlagCategoriesRouter(
  deps: AdminReportsRedFlagCategoriesRouterDeps,
): express.Router {
  const { platformService, amlService } = deps;
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

  router.get("/api/admin/reports/red-flag/categories", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_AML_READ");

      const now = new Date();
      // Default-vindu: siste 30 dager. AML-kategorier er sjeldent brukt for
      // real-time — admin ser typisk en måneds aktivitet for å vurdere
      // tiltak. Større default enn subgame-drill-down (7d) som er
      // operasjonelt siktet.
      const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      const rows = await amlService.aggregateCategoryCounts({ from, to });
      const result = buildRedFlagCategories({ rows, from, to });

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
