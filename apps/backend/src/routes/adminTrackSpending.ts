/**
 * BIN-628: admin track-spending endpoints (regulatorisk P2).
 *
 * Norwegian pengespillforskriften §11 forebyggende tiltak. Agent A's
 * PR-B2 har en track-spending-stub som selv-kansellerer når disse
 * endepunktene returnerer 200 + data på forventede skjemaer.
 *
 * Endepunkter:
 *   GET /api/admin/track-spending?hallId=&from=&to=&cursor=
 *     Per-hall × periode aggregat. Inkluderer hallens Spillvett-limits
 *     (dailyLimit + monthlyLimit) så admin kan vurdere om spiller er
 *     nær grensa. Fail-closed: 503 ved stale data.
 *
 *   GET /api/admin/track-spending/transactions?hallId=&playerId=&from=&to=&cursor=
 *     Detalj-liste av stake/prize-transactions. Samme fail-closed +
 *     audit-log-mønster som aggregat-endepunktet.
 *
 * Regulatorisk sjekkliste:
 *   - Fail-closed: TrackSpendingStaleDataError → HTTP 503 med klar
 *     feilmelding. DB-feil (katastrofalt) → HTTP 503 med DB_ERROR-kode.
 *   - AuditLog: `admin.track_spending.viewed` / `admin.track_spending.transactions_viewed`
 *     logges hver visning (admin-id, hallId, from/to, resultCount).
 *   - Per-hall limits: Embedded i aggregat-responsen.
 *   - Ingen mandatorisk pause (Norway-memo).
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { LossLimits } from "../game/ComplianceManager.js";
import {
  assertAdminPermission,
  assertUserHallScope,
} from "../platform/AdminAccessPolicy.js";
import {
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";
import {
  buildTrackSpendingAggregate,
  buildTrackSpendingTransactions,
  TrackSpendingStaleDataError,
  type HallSpillvettOverrides,
} from "../spillevett/adminTrackSpending.js";

const logger = rootLogger.child({ module: "admin-track-spending" });

export interface AdminTrackSpendingRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  engine: BingoEngine;
  /**
   * Regulatoriske default-limits. Hentes fra samme env-vars som brukes ved
   * BingoEngine-konstruksjon (bingoDailyLossLimit / bingoMonthlyLossLimit).
   */
  regulatoryLimits: LossLimits;
  /**
   * Per-hall overrides. I første versjon: ingen overrides — alle haller
   * rapporteres med `source: "regulatory"`. Fremtidig: les fra
   * hall-config-tabell når BIN-661 lander.
   */
  hallOverrides?: HallSpillvettOverrides[];
  /**
   * Hvor gammelt data er (ms). I prod: komputert fra cache-lag. I dev/test:
   * 0. Settes som funksjon så route-laget kan hente ferskt tall per request
   * uten å gå via restart. Default = () => 0.
   */
  getDataAgeMs?: () => number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(role: PublicAppUser["role"]): "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  if (role === "SUPPORT") return "SUPPORT";
  return "USER";
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

function sendFailClosed503(
  res: express.Response,
  code: "TRACK_SPENDING_STALE_DATA" | "TRACK_SPENDING_DB_ERROR" | "TRACK_SPENDING_LIMITS_UNAVAILABLE",
  message: string,
  extra?: { staleMs?: number; maxAllowedStaleMs?: number },
): void {
  res.status(503).json({
    ok: false,
    error: {
      code,
      message,
      ...(extra?.staleMs !== undefined ? { staleMs: extra.staleMs } : {}),
      ...(extra?.maxAllowedStaleMs !== undefined ? { maxAllowedStaleMs: extra.maxAllowedStaleMs } : {}),
    },
  });
}

// ── Router ──────────────────────────────────────────────────────────────────

export function createAdminTrackSpendingRouter(deps: AdminTrackSpendingRouterDeps): express.Router {
  const { platformService, auditLogService, engine, regulatoryLimits } = deps;
  const hallOverrides = deps.hallOverrides ?? [];
  const getDataAgeMs = deps.getDataAgeMs ?? (() => 0);
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, "TRACK_SPENDING_READ");
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-628] audit append failed");
    });
  }

  // ── GET /api/admin/track-spending ──────────────────────────────────────

  router.get("/api/admin/track-spending", async (req, res) => {
    try {
      const user = await requireUser(req);
      const hallId = optionalNonEmpty(req.query.hallId);

      // HALL_OPERATOR: må oppgi hallId og må matche egen hall.
      if (user.role === "HALL_OPERATOR") {
        if (!hallId) {
          throw new DomainError(
            "INVALID_INPUT",
            "HALL_OPERATOR må oppgi hallId for track-spending.",
          );
        }
        assertUserHallScope({ role: user.role, hallId: user.hallId ?? null }, hallId);
      }

      const now = new Date();
      // Default-vindu: siste 7 dager (matcher playerReport "last7"-default).
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      const cursor = optionalNonEmpty(req.query.cursor);
      const pageSize = parseLimit(req.query.limit, 50);

      // Hent ledger-entries og halls — fail-closed hvis DB-lag feiler.
      let entries;
      let halls;
      try {
        entries = engine.listComplianceLedgerEntries({
          dateFrom: from,
          dateTo: to,
          hallId,
          limit: 10_000, // service re-filtrerer, men vi trenger nok data til å dekke vinduet
        });
        halls = await platformService.listHalls({ includeInactive: true });
      } catch (err) {
        logger.error({ err, hallId, from, to }, "[BIN-628] DB-feil ved henting av ledger/halls");
        sendFailClosed503(
          res,
          "TRACK_SPENDING_DB_ERROR",
          "Kunne ikke hente track-spending-data fra databasen. Admin må ikke se tom data — kontakt drift.",
        );
        return;
      }

      let result;
      try {
        result = buildTrackSpendingAggregate({
          entries,
          halls,
          from,
          to,
          hallId,
          regulatoryLimits,
          hallOverrides,
          dataAgeMs: getDataAgeMs(),
          cursor,
          pageSize,
          now,
        });
      } catch (err) {
        if (err instanceof TrackSpendingStaleDataError) {
          sendFailClosed503(res, err.code, err.message, {
            staleMs: err.staleMs,
            maxAllowedStaleMs: err.maxAllowedStaleMs,
          });
          return;
        }
        throw err;
      }

      fireAudit({
        actorId: user.id,
        actorType: actorTypeFromRole(user.role),
        action: "admin.track_spending.viewed",
        resource: "track_spending",
        resourceId: hallId ?? null,
        details: {
          hallId: hallId ?? null,
          from,
          to,
          rowCount: result.rows.length,
          totalUniquePlayers: result.totals.uniquePlayerCount,
          staleMs: result.dataFreshness.staleMs,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      res.json({ ok: true, data: result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/admin/track-spending/transactions ─────────────────────────

  router.get("/api/admin/track-spending/transactions", async (req, res) => {
    try {
      const user = await requireUser(req);
      const hallId = optionalNonEmpty(req.query.hallId);
      const playerId = optionalNonEmpty(req.query.playerId);

      if (user.role === "HALL_OPERATOR") {
        if (!hallId) {
          throw new DomainError(
            "INVALID_INPUT",
            "HALL_OPERATOR må oppgi hallId for track-spending-transactions.",
          );
        }
        assertUserHallScope({ role: user.role, hallId: user.hallId ?? null }, hallId);
      }

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      const cursor = optionalNonEmpty(req.query.cursor);
      const pageSize = parseLimit(req.query.limit, 100);

      let entries;
      let halls;
      try {
        entries = engine.listComplianceLedgerEntries({
          dateFrom: from,
          dateTo: to,
          hallId,
          limit: 10_000,
        });
        halls = await platformService.listHalls({ includeInactive: true });
      } catch (err) {
        logger.error(
          { err, hallId, playerId, from, to },
          "[BIN-628] DB-feil ved henting av transactions",
        );
        sendFailClosed503(
          res,
          "TRACK_SPENDING_DB_ERROR",
          "Kunne ikke hente track-spending-transactions fra databasen.",
        );
        return;
      }

      let result;
      try {
        result = buildTrackSpendingTransactions({
          entries,
          halls,
          from,
          to,
          hallId,
          playerId,
          dataAgeMs: getDataAgeMs(),
          cursor,
          pageSize,
          now,
        });
      } catch (err) {
        if (err instanceof TrackSpendingStaleDataError) {
          sendFailClosed503(res, err.code, err.message, {
            staleMs: err.staleMs,
            maxAllowedStaleMs: err.maxAllowedStaleMs,
          });
          return;
        }
        throw err;
      }

      fireAudit({
        actorId: user.id,
        actorType: actorTypeFromRole(user.role),
        action: "admin.track_spending.transactions_viewed",
        resource: "track_spending",
        resourceId: playerId ?? hallId ?? null,
        details: {
          hallId: hallId ?? null,
          playerId: playerId ?? null,
          from,
          to,
          transactionCount: result.transactions.length,
          staleMs: result.dataFreshness.staleMs,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      res.json({ ok: true, data: result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Avoid unused-variable lint — `mustBeNonEmptyString` er reservert for
  // fremtidige POST-endepunkter hvor body-validering kreves.
  void mustBeNonEmptyString;

  return router;
}
