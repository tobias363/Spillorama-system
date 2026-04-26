/**
 * REQ-143: aggregert hall-account-rapport per hall-gruppe (group-of-hall).
 *
 * Wireframe: PDF 16/17 §17.36 — multi-hall-operator skal kunne se
 * aggregerte rapporter for alle haller i sin Group-of-Hall, ikke kun per
 * hall. Eksisterende `GET /api/admin/reports/halls/:hallId/daily` dekker
 * single-hall; her tilbys group-aggregat:
 *
 *   GET /api/admin/reports/groups               — list grupper m/scope-filter
 *   GET /api/admin/reports/groups/:groupId/daily
 *   GET /api/admin/reports/groups/:groupId/monthly
 *   GET /api/admin/reports/groups/:groupId/account-balance
 *
 * RBAC: DAILY_REPORT_READ (ADMIN/HALL_OPERATOR/SUPPORT). HALL_OPERATOR er
 * begrenset til grupper hvor egen hall er medlem (fail-closed). Single-hall
 * fallback: en gruppe med kun én medlemshall returnerer fortsatt
 * group-aggregat (uten å kreve membership-flertall).
 *
 * Aggregerings-mønster: vi kaller `HallAccountReportService.getDailyReport`
 * per medlemshall og slår sammen per (date, gameType). `getMonthlyReport` og
 * `getAccountBalance` aggregeres tilsvarende. Manuelle justeringer summeres
 * over alle medlemshaller og rapporteres som ett `manualAdjustmentCents`-tall.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type {
  HallAccountReportService,
  DailyHallReportRow,
  MonthlyHallReportRow,
  HallAccountBalance,
} from "../compliance/HallAccountReportService.js";
import type { HallGroup, HallGroupService } from "../admin/HallGroupService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-group-hall-reports-router" });

export interface AdminGroupHallReportsRouterDeps {
  platformService: PlatformService;
  hallGroupService: HallGroupService;
  reportService: HallAccountReportService;
}

// ── Aggregat-rader (group-of-hall) ─────────────────────────────────────────

export interface DailyGroupReportRow {
  date: string;
  gameType: string | null;
  ticketsSoldCents: number;
  winningsPaidCents: number;
  netRevenueCents: number;
  cashInCents: number;
  cashOutCents: number;
  cardInCents: number;
  cardOutCents: number;
  /** Antall haller i gruppen som bidro til denne raden. */
  contributingHallCount: number;
}

export interface MonthlyGroupReportRow extends MonthlyHallReportRow {
  /** Antall haller hvis aggregat er summert. */
  contributingHallCount: number;
}

export interface GroupAccountBalance {
  groupId: string;
  groupName: string;
  hallIds: string[];
  /** Sum av cash_balance over alle medlemshaller. */
  hallCashBalance: number;
  dropsafeBalance: number;
  periodTotalCashInCents: number;
  periodTotalCashOutCents: number;
  periodTotalCardInCents: number;
  periodTotalCardOutCents: number;
  periodSellingByCustomerNumberCents: number;
  periodManualAdjustmentCents: number;
  periodNetCashFlowCents: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseIntParam(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new DomainError("INVALID_INPUT", `${field} må være heltall ${min}-${max}.`);
  }
  return n;
}

/**
 * Sjekker at brukeren har lese-tilgang til en gitt hall-gruppe.
 * - ADMIN/SUPPORT: alltid OK.
 * - HALL_OPERATOR: må ha en `hallId` som er medlem i gruppen. Operator uten
 *   tildelt hall, eller gruppe som ikke inkluderer operatoren, gir FORBIDDEN.
 * - Andre roller: FORBIDDEN (fail-closed).
 */
function assertGroupAccess(user: PublicAppUser, group: HallGroup): void {
  if (user.role === "ADMIN" || user.role === "SUPPORT") return;
  if (user.role !== "HALL_OPERATOR") {
    throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne hall-gruppen.");
  }
  if (!user.hallId) {
    throw new DomainError(
      "FORBIDDEN",
      "Din bruker er ikke tildelt en hall — kontakt admin.",
    );
  }
  const memberHallIds = group.members.map((m) => m.hallId);
  if (!memberHallIds.includes(user.hallId)) {
    throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne hall-gruppen.");
  }
}

/**
 * Aggregér daily-rader fra flere haller per (date, gameType).
 * Mønsteret følger HallAccountReportService.getDailyReport som returnerer
 * en rad per (date, gameType="ALL" | "<game>") — vi summerer beløpene og
 * teller antall haller som bidrar.
 */
function aggregateDaily(perHall: DailyHallReportRow[][]): DailyGroupReportRow[] {
  const map = new Map<string, DailyGroupReportRow>();
  for (const hallRows of perHall) {
    const seenKeys = new Set<string>();
    for (const r of hallRows) {
      const key = `${r.date}::${r.gameType ?? ""}`;
      const existing = map.get(key);
      const isFirstSeen = !seenKeys.has(key);
      seenKeys.add(key);
      if (existing) {
        existing.ticketsSoldCents += r.ticketsSoldCents;
        existing.winningsPaidCents += r.winningsPaidCents;
        existing.netRevenueCents += r.netRevenueCents;
        existing.cashInCents += r.cashInCents;
        existing.cashOutCents += r.cashOutCents;
        existing.cardInCents += r.cardInCents;
        existing.cardOutCents += r.cardOutCents;
        if (isFirstSeen) existing.contributingHallCount += 1;
      } else {
        map.set(key, {
          date: r.date,
          gameType: r.gameType,
          ticketsSoldCents: r.ticketsSoldCents,
          winningsPaidCents: r.winningsPaidCents,
          netRevenueCents: r.netRevenueCents,
          cashInCents: r.cashInCents,
          cashOutCents: r.cashOutCents,
          cardInCents: r.cardInCents,
          cardOutCents: r.cardOutCents,
          contributingHallCount: 1,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    return (a.gameType ?? "").localeCompare(b.gameType ?? "");
  });
}

function aggregateMonthly(
  month: string,
  perHall: MonthlyHallReportRow[],
): MonthlyGroupReportRow {
  const totals = perHall.reduce(
    (acc, r) => {
      acc.tickets += r.ticketsSoldCents;
      acc.winnings += r.winningsPaidCents;
      acc.cashIn += r.cashInCents;
      acc.cashOut += r.cashOutCents;
      acc.cardIn += r.cardInCents;
      acc.cardOut += r.cardOutCents;
      acc.adj += r.manualAdjustmentCents;
      return acc;
    },
    { tickets: 0, winnings: 0, cashIn: 0, cashOut: 0, cardIn: 0, cardOut: 0, adj: 0 },
  );
  return {
    month,
    ticketsSoldCents: totals.tickets,
    winningsPaidCents: totals.winnings,
    netRevenueCents: totals.tickets - totals.winnings,
    cashInCents: totals.cashIn,
    cashOutCents: totals.cashOut,
    cardInCents: totals.cardIn,
    cardOutCents: totals.cardOut,
    manualAdjustmentCents: totals.adj,
    contributingHallCount: perHall.length,
  };
}

function aggregateBalance(
  group: HallGroup,
  perHall: HallAccountBalance[],
): GroupAccountBalance {
  const totals = perHall.reduce(
    (acc, b) => {
      acc.hallCash += b.hallCashBalance;
      acc.dropsafe += b.dropsafeBalance;
      acc.cashIn += b.periodTotalCashInCents;
      acc.cashOut += b.periodTotalCashOutCents;
      acc.cardIn += b.periodTotalCardInCents;
      acc.cardOut += b.periodTotalCardOutCents;
      acc.customer += b.periodSellingByCustomerNumberCents;
      acc.adj += b.periodManualAdjustmentCents;
      acc.net += b.periodNetCashFlowCents;
      return acc;
    },
    {
      hallCash: 0, dropsafe: 0, cashIn: 0, cashOut: 0, cardIn: 0, cardOut: 0,
      customer: 0, adj: 0, net: 0,
    },
  );
  return {
    groupId: group.id,
    groupName: group.name,
    hallIds: group.members.map((m) => m.hallId),
    hallCashBalance: totals.hallCash,
    dropsafeBalance: totals.dropsafe,
    periodTotalCashInCents: totals.cashIn,
    periodTotalCashOutCents: totals.cashOut,
    periodTotalCardInCents: totals.cardIn,
    periodTotalCardOutCents: totals.cardOut,
    periodSellingByCustomerNumberCents: totals.customer,
    periodManualAdjustmentCents: totals.adj,
    periodNetCashFlowCents: totals.net,
  };
}

// ── Router ──────────────────────────────────────────────────────────────────

export function createAdminGroupHallReportsRouter(
  deps: AdminGroupHallReportsRouterDeps,
): express.Router {
  const { platformService, hallGroupService, reportService } = deps;
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

  /**
   * Liste grupper. ADMIN/SUPPORT ser alle; HALL_OPERATOR ser kun grupper
   * hvor egen hall er medlem. Brukes av admin-web "Group of Hall"-dropdown.
   */
  router.get("/api/admin/reports/groups", async (req, res) => {
    try {
      const user = await requirePermission(req, "DAILY_REPORT_READ");
      let filterHallId: string | undefined;
      if (user.role === "HALL_OPERATOR") {
        if (!user.hallId) {
          throw new DomainError(
            "FORBIDDEN",
            "Din bruker er ikke tildelt en hall — kontakt admin.",
          );
        }
        filterHallId = user.hallId;
      }
      const groups = await hallGroupService.list({
        limit: 500,
        includeDeleted: false,
        ...(filterHallId ? { hallId: filterHallId } : {}),
      });
      const summary = groups.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        memberCount: g.members.length,
        hallIds: g.members.map((m) => m.hallId),
      }));
      apiSuccess(res, { groups: summary, count: summary.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /**
   * Daglig aggregat for én gruppe over fra/til-rangen.
   * Single-hall-fallback: en gruppe med kun ett medlem returneres som
   * normal-aggregat (`contributingHallCount=1`).
   * Tom gruppe (ingen medlemshaller) → tomt resultat — IKKE feil.
   */
  router.get("/api/admin/reports/groups/:groupId/daily", async (req, res) => {
    try {
      const user = await requirePermission(req, "DAILY_REPORT_READ");
      const groupId = mustBeNonEmptyString(req.params.groupId, "groupId");
      const group = await hallGroupService.get(groupId);
      assertGroupAccess(user, group);
      const dateFrom = mustBeNonEmptyString(req.query.dateFrom, "dateFrom");
      const dateTo = mustBeNonEmptyString(req.query.dateTo, "dateTo");
      const gameType = typeof req.query.gameType === "string"
        ? req.query.gameType.trim() || undefined
        : undefined;

      const hallIds = group.members.map((m) => m.hallId);
      const perHall = await Promise.all(
        hallIds.map((hallId) =>
          reportService
            .getDailyReport({ hallId, dateFrom, dateTo, gameType })
            .catch((err: unknown) => {
              logger.warn(
                { err, hallId, groupId },
                "[REQ-143] hall-rapport feilet — utelatt fra aggregat",
              );
              return [] as DailyHallReportRow[];
            }),
        ),
      );
      const rows = aggregateDaily(perHall);
      apiSuccess(res, {
        groupId: group.id,
        groupName: group.name,
        hallIds,
        dateFrom,
        dateTo,
        gameType: gameType ?? null,
        rows,
        count: rows.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /** Månedlig aggregat for én gruppe (year+month). */
  router.get("/api/admin/reports/groups/:groupId/monthly", async (req, res) => {
    try {
      const user = await requirePermission(req, "DAILY_REPORT_READ");
      const groupId = mustBeNonEmptyString(req.params.groupId, "groupId");
      const group = await hallGroupService.get(groupId);
      assertGroupAccess(user, group);
      const year = parseIntParam(req.query.year, "year", 2020, 2100);
      const month = parseIntParam(req.query.month, "month", 1, 12);

      const hallIds = group.members.map((m) => m.hallId);
      const perHall = await Promise.all(
        hallIds.map((hallId) =>
          reportService
            .getMonthlyReport({ hallId, year, month })
            .catch((err: unknown) => {
              logger.warn(
                { err, hallId, groupId },
                "[REQ-143] hall-månedsrapport feilet — utelatt fra aggregat",
              );
              return null;
            }),
        ),
      );
      const valid = perHall.filter((r): r is MonthlyHallReportRow => r !== null);
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      const aggregate = aggregateMonthly(monthStr, valid);
      apiSuccess(res, {
        groupId: group.id,
        groupName: group.name,
        hallIds,
        ...aggregate,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /** Konto-balanse-aggregat (cash + dropsafe + period-cash-flow). */
  router.get("/api/admin/reports/groups/:groupId/account-balance", async (req, res) => {
    try {
      const user = await requirePermission(req, "DAILY_REPORT_READ");
      const groupId = mustBeNonEmptyString(req.params.groupId, "groupId");
      const group = await hallGroupService.get(groupId);
      assertGroupAccess(user, group);
      const dateFrom = typeof req.query.dateFrom === "string"
        ? req.query.dateFrom.trim() || undefined
        : undefined;
      const dateTo = typeof req.query.dateTo === "string"
        ? req.query.dateTo.trim() || undefined
        : undefined;

      const hallIds = group.members.map((m) => m.hallId);
      const perHall = await Promise.all(
        hallIds.map((hallId) =>
          reportService
            .getAccountBalance({ hallId, dateFrom, dateTo })
            .catch((err: unknown) => {
              logger.warn(
                { err, hallId, groupId },
                "[REQ-143] hall-balance feilet — utelatt fra aggregat",
              );
              return null;
            }),
        ),
      );
      const valid = perHall.filter((b): b is HallAccountBalance => b !== null);
      const aggregate = aggregateBalance(group, valid);
      apiSuccess(res, aggregate);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
