/**
 * BIN-651: admin red-flag players-report-endpoint.
 *
 *   GET /api/admin/reports/red-flag/players?category=&from=&to=&cursor=&limit=
 *
 * Returnerer paginerte red-flaggede spillere med flag-årsak + siste aktivitet.
 *
 * ⚠️ REGULATORISK (pengespillforskriften §11):
 *   Ved vellykket lesing skriver ruten en audit-log-hendelse
 *   (action = `admin.report.red_flag_players.viewed`) MED resultCount.
 *   Dette er ett av få tilfeller der vi logger en READ, fordi red-flag-listen
 *   inneholder AML-sensitiv informasjon. Feil-cases (400 INVALID_INPUT,
 *   401 UNAUTHORIZED, 403 FORBIDDEN) logges IKKE — samme policy som
 *   BIN-623 close-day der 409-konflikt ikke audit-logges.
 *
 * Permission: `PLAYER_AML_READ` (ADMIN + SUPPORT). HALL_OPERATOR får 403 —
 * red-flag-detaljer er ikke operatør-scopet data.
 *
 * Datakilde:
 *   - AmlService.listRedFlags() — kilde til flagg-instanser (keyed by ruleSlug).
 *   - PlatformService.getUserById() — navn/epost-oppslag per flagget user.
 *   - BingoEngine.listComplianceLedgerEntries() — totalStakes + lastActivity
 *     per user i requested vindu.
 *
 * Aggregat-bygging + cursor-pagin delegeres til
 * `admin/reports/RedFlagPlayersReport.ts` (pure function, dekket av unit-tester).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { AmlService, AmlRedFlag } from "../compliance/AmlService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  parseLimit,
} from "../util/httpHelpers.js";
import {
  buildRedFlagPlayersReport,
  isValidRedFlagCategoryId,
  type RedFlagPlayerUserInfo,
} from "../admin/reports/RedFlagPlayersReport.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-reports-red-flag-players" });

export interface AdminReportsRedFlagPlayersRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  amlService: AmlService;
  engine: BingoEngine;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(
  role: PublicAppUser["role"]
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
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

function parseOptionalCategory(value: unknown): string | undefined {
  const raw = optionalNonEmpty(value);
  if (!raw) return undefined;
  if (!isValidRedFlagCategoryId(raw)) {
    throw new DomainError(
      "INVALID_INPUT",
      `category må være en av de ni kanoniske slugs (se BIN-650/BIN-651).`
    );
  }
  return raw;
}

export function createAdminReportsRedFlagPlayersRouter(
  deps: AdminReportsRedFlagPlayersRouterDeps
): express.Router {
  const { platformService, auditLogService, amlService, engine } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-651] audit append failed");
    });
  }

  router.get("/api/admin/reports/red-flag/players", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PLAYER_AML_READ");

      const category = parseOptionalCategory(req.query.category);
      const from = parseOptionalIso(req.query.from, "from");
      const to = parseOptionalIso(req.query.to, "to");
      if (from && to && Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }
      const cursor = optionalNonEmpty(req.query.cursor);
      const pageSize = parseLimit(req.query.limit, 50);

      // Hent ÅPNE red-flags (review=null). listRedFlags støtter ikke vindu
      // direkte — vi filtrerer på createdAt i report-builder.
      const flags: AmlRedFlag[] = await amlService.listRedFlags({
        status: "OPEN",
        limit: 500,
      });

      // Slå opp user-info for alle unike userIds.
      const uniqueUserIds = Array.from(new Set(flags.map((f) => f.userId)));
      const users = new Map<string, RedFlagPlayerUserInfo>();
      await Promise.all(
        uniqueUserIds.map(async (uid) => {
          try {
            const u = await platformService.getUserById(uid);
            users.set(uid, {
              userId: u.id,
              displayName: u.displayName,
              email: u.email,
            });
          } catch (err) {
            // Manglende/slettet bruker → hoppes over i report-builder.
            logger.debug({ userId: uid, err }, "[BIN-651] user lookup failed — skipping flag");
          }
        })
      );

      // Ledger for stake-sum + siste-aktivitet. Scope til vinduet som ble
      // forespurt (default: siste 30 dager hvis ikke oppgitt, for å holde
      // query billig — matcher legacy som defaulter til siste 6 mnd men har
      // en dyrere Mongo-aggregat).
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ledgerFrom = from ?? defaultFrom.toISOString();
      const ledgerTo = to ?? now.toISOString();
      const ledgerEntries = engine.listComplianceLedgerEntries({
        dateFrom: ledgerFrom,
        dateTo: ledgerTo,
        limit: 10_000,
      });

      const result = buildRedFlagPlayersReport({
        flags,
        users,
        ledgerEntries,
        category,
        from: from ?? undefined,
        to: to ?? undefined,
        cursor,
        pageSize,
      });

      // ⚠️ REGULATORISK: audit-log på vellykket view. Fire-and-forget
      // (samme mønster som BIN-623 close-day) — audit-append skal aldri
      // blokkere responsen til admin-UI. Feil-cases (se catch) logges ikke.
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.report.red_flag_players.viewed",
        resource: "red_flag_players_report",
        resourceId: category ?? null,
        details: {
          category: category ?? null,
          from: from ?? null,
          to: to ?? null,
          resultCount: result.items.length,
          totalCount: result.totalCount,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
