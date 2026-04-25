/**
 * GAP #28 — Per-spilltype-spesifikke admin-rapport-endpoints.
 *
 *   GET /api/admin/reports/games/:gameSlug/details?from=&to=&hallId=&format=
 *
 * Slug-mapping (per `docs/architecture/SPILLKATALOG.md` 2026-04-25):
 *   - `bingo`        → Spill 1 (Hovedspill)
 *   - `rocket`       → Spill 2 (Hovedspill)
 *   - `monsterbingo` → Spill 3 (Hovedspill)
 *   - `spillorama`   → SpinnGo / Spill 4 (Databingo)
 *
 * Game 4 (legacy `themebingo`) avvikt per BIN-496; avvises med
 * INVALID_INPUT.
 *
 * `format=csv` → text/csv attachment med per-hall rader, totals,
 * channel-breakdown, og spilltype-spesifikke metrikker (én CSV per
 * rapport — ikke separate filer per seksjon).
 *
 * RBAC: DAILY_REPORT_READ (ADMIN + SUPPORT + HALL_OPERATOR).
 * HALL_OPERATOR auto-scopes til egen hall via resolveHallScopeFilter.
 *
 * Read-only. Ingen audit-log (aggregat, ikke regulatorisk pii).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
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
  buildGameSpecificReport,
  exportGameSpecificReportCsv,
  SUPPORTED_GAME_SPECIFIC_SLUGS,
  DEPRECATED_GAME_SLUGS,
  type GameSpecificSlug,
} from "../admin/reports/GameSpecificReport.js";

export interface AdminReportsGameSpecificRouterDeps {
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

/**
 * Validate slug. Avviser deprecated `themebingo`/`game4` med en spesifikk
 * BIN-496-melding så UI kan vise riktig "deprecated"-banner.
 */
function parseGameSlug(raw: unknown): GameSpecificSlug {
  if (typeof raw !== "string") {
    throw new DomainError("INVALID_INPUT", "gameSlug mangler.");
  }
  const trimmed = raw.trim().toLowerCase();
  if ((DEPRECATED_GAME_SLUGS as ReadonlyArray<string>).includes(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      "Game 4 (themebingo) ble permanent avviklet per BIN-496 (2026-04-17). Bruk i stedet `spillorama` for SpinnGo/Spill 4.",
    );
  }
  if (!(SUPPORTED_GAME_SPECIFIC_SLUGS as ReadonlyArray<string>).includes(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `Ukjent game-slug. Gyldige: ${SUPPORTED_GAME_SPECIFIC_SLUGS.join(", ")}.`,
    );
  }
  return trimmed as GameSpecificSlug;
}

export function createAdminReportsGameSpecificRouter(
  deps: AdminReportsGameSpecificRouterDeps,
): express.Router {
  const { platformService, engine } = deps;
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, "DAILY_REPORT_READ");
    return user;
  }

  router.get("/api/admin/reports/games/:gameSlug/details", async (req, res) => {
    try {
      const user = await requireUser(req);
      const slug = parseGameSlug(req.params.gameSlug);

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      const hallIdInput = optionalNonEmpty(req.query.hallId);
      // BIN-591: HALL_OPERATOR tvinges til egen hall.
      const hallId = resolveHallScopeFilter(user, hallIdInput);

      const formatRaw = optionalNonEmpty(req.query.format)?.toLowerCase();
      const wantCsv = formatRaw === "csv";

      const halls = await platformService.listHalls({ includeInactive: true });

      // Ledger read window — engine cap'er internt på 10k entries/dag.
      const entries = engine.listComplianceLedgerEntries({
        dateFrom: from,
        dateTo: to,
        hallId,
        limit: 10_000,
      });

      const result = buildGameSpecificReport({
        slug,
        entries,
        halls,
        from,
        to,
        hallId,
      });

      if (wantCsv) {
        const csv = exportGameSpecificReportCsv(result);
        const datePart = from.slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="report-${slug}-${datePart}.csv"`,
        );
        res.status(200).send(csv);
        return;
      }

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
