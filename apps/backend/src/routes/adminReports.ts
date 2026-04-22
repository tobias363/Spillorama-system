import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import {
  assertUserHallScope,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
  parseOptionalLedgerGameType,
  parseOptionalLedgerChannel,
} from "../util/httpHelpers.js";
import type { AdminSubRouterDeps } from "./adminShared.js";

export function createAdminReportsRouter(deps: AdminSubRouterDeps): express.Router {
  const {
    platformService,
    engine,
    helpers,
  } = deps;
  const { requireAdminPermissionUser } = helpers;
  const router = express.Router();

  // ── Ledger ────────────────────────────────────────────────────────────────

  router.get("/api/admin/ledger/entries", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "LEDGER_READ");
      const limit = parseLimit(req.query.limit, 200);
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : undefined;
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : undefined;
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      // BIN-591: HALL_OPERATOR tvinges til sin egen hall
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const entries = engine.listComplianceLedgerEntries({
        limit,
        dateFrom,
        dateTo,
        hallId,
        gameType,
        channel
      });
      apiSuccess(res, entries);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/ledger/entries", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "LEDGER_WRITE");
      const eventTypeRaw = mustBeNonEmptyString(req.body?.eventType, "eventType").toUpperCase();
      if (eventTypeRaw !== "STAKE" && eventTypeRaw !== "PRIZE" && eventTypeRaw !== "EXTRA_PRIZE") {
        throw new DomainError("INVALID_INPUT", "eventType må være STAKE, PRIZE eller EXTRA_PRIZE.");
      }
      const entry = await engine.recordAccountingEvent({
        hallId: mustBeNonEmptyString(req.body?.hallId, "hallId"),
        gameType: parseOptionalLedgerGameType(req.body?.gameType) ?? "DATABINGO",
        channel: parseOptionalLedgerChannel(req.body?.channel) ?? "INTERNET",
        eventType: eventTypeRaw,
        amount: mustBePositiveAmount(req.body?.amount),
        metadata:
          req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
            ? req.body.metadata
            : undefined
      });
      apiSuccess(res, entry);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Daily reports ─────────────────────────────────────────────────────────

  router.post("/api/admin/reports/daily/run", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_RUN");
      const date = typeof req.body?.date === "string" ? req.body.date.trim() : undefined;
      const hallIdInput = typeof req.body?.hallId === "string" ? req.body.hallId.trim() : undefined;
      // BIN-591: HALL_OPERATOR kan kun kjøre rapport for sin egen hall.
      // For ADMIN/SUPPORT sendes hallId igjennom uendret (inkl. undefined → alle haller).
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const gameType = parseOptionalLedgerGameType(req.body?.gameType);
      const channel = parseOptionalLedgerChannel(req.body?.channel);
      const report = await engine.runDailyReportJob({
        date,
        hallId,
        gameType,
        channel
      });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/daily", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const date = mustBeNonEmptyString(req.query.date, "date");
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput); // BIN-591
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const format = typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "json";
      if (format === "csv") {
        const csv = engine.exportDailyReportCsv({
          date,
          hallId,
          gameType,
          channel
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="daily-report-${date}.csv"`);
        res.status(200).send(csv);
        return;
      }
      const report = engine.generateDailyReport({
        date,
        hallId,
        gameType,
        channel
      });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/daily/archive/:date", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const date = mustBeNonEmptyString(req.params.date, "date");
      const report = engine.getArchivedDailyReport(date);
      if (!report) {
        throw new DomainError("REPORT_NOT_FOUND", "Fant ikke arkivert dagsrapport for valgt dato.");
      }
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-517: Admin dashboard + range/game reports ─────────────────────────
  //
  // Live dashboard: grouped active-room summary per hall + aggregated
  // player counts. Driven by the in-memory engine.listRoomSummaries; the
  // response is cheap to compute and safe to poll from the admin UI
  // every few seconds.

  router.get("/api/admin/dashboard/live", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
      const rooms = engine.listRoomSummaries();
      const halls = await platformService.listHalls({ includeInactive: true });
      const hallById = new Map(halls.map((h) => [h.id, h]));

      // Group the room summaries by hall so the dashboard can render
      // one card per hall. Unknown hallIds (stale room) surface under
      // "orphan" so they can be investigated instead of silently hidden.
      interface HallBucket {
        hallId: string;
        hallName: string;
        hallSlug: string;
        isActive: boolean;
        clientVariant: string;
        rooms: Array<{
          code: string;
          gameSlug: string | undefined;
          gameStatus: string;
          playerCount: number;
          hostPlayerId: string;
          createdAt: string;
        }>;
        activeRoomCount: number;
        totalPlayers: number;
      }
      const bucketByHall = new Map<string, HallBucket>();

      const ensureBucket = (hallId: string): HallBucket => {
        const existing = bucketByHall.get(hallId);
        if (existing) return existing;
        const hall = hallById.get(hallId);
        const bucket: HallBucket = {
          hallId,
          hallName: hall?.name ?? "(ukjent hall)",
          hallSlug: hall?.slug ?? hallId,
          isActive: hall?.isActive ?? false,
          clientVariant: hall?.clientVariant ?? "web",
          rooms: [],
          activeRoomCount: 0,
          totalPlayers: 0,
        };
        bucketByHall.set(hallId, bucket);
        return bucket;
      };

      // Seed all active halls even if they have no rooms — empty cards
      // still carry signal ("is the TV up? yes, but no game scheduled").
      for (const hall of halls) {
        if (hall.isActive) ensureBucket(hall.id);
      }

      for (const room of rooms) {
        const bucket = ensureBucket(room.hallId);
        bucket.rooms.push({
          code: room.code,
          gameSlug: room.gameSlug,
          gameStatus: room.gameStatus,
          playerCount: room.playerCount,
          hostPlayerId: room.hostPlayerId,
          createdAt: room.createdAt,
        });
        if (room.gameStatus === "RUNNING" || room.gameStatus === "WAITING") {
          bucket.activeRoomCount += 1;
        }
        bucket.totalPlayers += room.playerCount;
      }

      const halls_payload = [...bucketByHall.values()].sort((a, b) =>
        a.hallName.localeCompare(b.hallName)
      );
      const totals = halls_payload.reduce(
        (acc, h) => {
          acc.roomCount += h.rooms.length;
          acc.activeRoomCount += h.activeRoomCount;
          acc.totalPlayers += h.totalPlayers;
          return acc;
        },
        { roomCount: 0, activeRoomCount: 0, totalPlayers: 0 },
      );
      apiSuccess(res, {
        halls: halls_payload,
        totals: { ...totals, hallCount: halls_payload.length },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/range", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const report = engine.generateRangeReport({ startDate, endDate, hallId, gameType, channel });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/reports/games", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const report = engine.generateGameStatistics({ startDate, endDate, hallId });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-587 B3.1: reports v2 + dashboard historical ─────────────────────

  // GET /api/admin/reports/revenue?startDate&endDate&hallId&gameType&channel
  // Kompakt totals-summary — erstatter legacy /totalRevenueReport/getData.
  router.get("/api/admin/reports/revenue", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      // BIN-591: HALL_OPERATOR tvinges til sin egen hall
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const summary = engine.generateRevenueSummary({ startDate, endDate, hallId, gameType, channel });
      apiSuccess(res, summary);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/reports/halls/:hallId/summary?startDate&endDate
  // Hall-spesifikk aggregat. HALL_OPERATOR får tilgang kun til egen hall.
  router.get("/api/admin/reports/halls/:hallId/summary", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(adminUser, hallId); // BIN-591
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const report = engine.generateRangeReport({ startDate, endDate, hallId, gameType, channel });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/reports/games/:gameSlug/drill-down?startDate&endDate&hallId
  // Per-game drill-down (erstatter 5× legacy /reportGameN/getReportGameN).
  // gameSlug maps to LedgerGameType via parseOptionalLedgerGameType.
  router.get("/api/admin/reports/games/:gameSlug/drill-down", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const gameSlugRaw = mustBeNonEmptyString(req.params.gameSlug, "gameSlug");
      const gameType = parseOptionalLedgerGameType(gameSlugRaw);
      if (!gameType) {
        throw new DomainError("INVALID_INPUT", "Ukjent game-slug.");
      }
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const stats = engine.generateGameStatistics({ startDate, endDate, hallId });
      // Filter per game-type — generateGameStatistics returnerer rows for alle
      // gameTypes i range; vi snevrer inn her.
      const filtered = {
        ...stats,
        rows: stats.rows.filter((r) => r.gameType === gameType),
      };
      apiSuccess(res, filtered);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/reports/games/:gameSlug/sessions?startDate&endDate&hallId&limit
  router.get("/api/admin/reports/games/:gameSlug/sessions", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const gameSlugRaw = mustBeNonEmptyString(req.params.gameSlug, "gameSlug");
      const gameType = parseOptionalLedgerGameType(gameSlugRaw);
      if (!gameType) {
        throw new DomainError("INVALID_INPUT", "Ukjent game-slug.");
      }
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const limit = parseLimit(req.query.limit, 200);
      const report = engine.generateGameSessions({ startDate, endDate, hallId, gameType, limit });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/dashboard/time-series?startDate&endDate&granularity=day|month
  router.get("/api/admin/dashboard/time-series", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const granularityRaw = typeof req.query.granularity === "string" ? req.query.granularity.trim() : "day";
      if (granularityRaw !== "day" && granularityRaw !== "month") {
        throw new DomainError("INVALID_INPUT", "granularity må være 'day' eller 'month'.");
      }
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const report = engine.generateTimeSeries({
        startDate, endDate, granularity: granularityRaw as "day" | "month", hallId, gameType, channel,
      });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/dashboard/top-players?startDate&endDate&hallId&limit
  router.get("/api/admin/dashboard/top-players", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const limit = parseLimit(req.query.limit, 20);
      const report = engine.generateTopPlayers({ startDate, endDate, hallId, gameType, limit });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/dashboard/game-history?startDate&endDate&gameType&hallId&limit
  // Tilsvarer legacy /dashboard/gameHistory — list av fullførte spilleøkter.
  router.get("/api/admin/dashboard/game-history", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
      const startDate = mustBeNonEmptyString(req.query.startDate, "startDate");
      const endDate = mustBeNonEmptyString(req.query.endDate, "endDate");
      const hallIdInput = typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const limit = parseLimit(req.query.limit, 200);
      const report = engine.generateGameSessions({ startDate, endDate, hallId, gameType, limit });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
