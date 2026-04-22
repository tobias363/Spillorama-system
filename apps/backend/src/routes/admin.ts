import { randomUUID } from "node:crypto";
import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { GameDefinition, UserRole } from "../platform/PlatformService.js";
import { APP_USER_ROLES } from "../platform/PlatformService.js";
import {
  ADMIN_ACCESS_POLICY,
  assertUserHallScope,
  canAccessAdminPermission,
  getAdminPermissionMap,
  listAdminPermissionsForRole,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import type { PublicAppUser } from "../platform/PlatformService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
  parseBooleanQueryValue,
  parseOptionalNonNegativeNumber,
  parseOptionalInteger,
  parseOptionalPositiveInteger,
  parseOptionalIsoTimestampMs,
  parseOptionalLedgerGameType,
  parseOptionalLedgerChannel,
  parseOptionalTicketsPerPlayerInput,
  isRecordObject,
} from "../util/httpHelpers.js";
import type { AdminSettingsCatalog } from "../admin/settingsCatalog.js";
import { buildBingoSettingsDefinition, buildDefaultGameSettingsDefinition } from "../admin/settingsCatalog.js";
import {
  buildAdminRouterHelpers,
  type AdminRouterDeps,
  type BingoSchedulerSettings,
  type PendingBingoSettingsUpdate,
  type BingoSettingsState,
} from "./adminShared.js";
import { createAdminAuthRouter } from "./adminAuth.js";
import { createAdminGamesSettingsRouter } from "./adminGamesSettings.js";
import { createAdminHallsTerminalsRouter } from "./adminHallsTerminals.js";
import { createAdminRoomsRouter } from "./adminRooms.js";
import { createAdminComplianceRouter } from "./adminCompliance.js";
import { createAdminReportsRouter } from "./adminReports.js";

export type { AdminRouterDeps, BingoSchedulerSettings, PendingBingoSettingsUpdate, BingoSettingsState };

export function createAdminRouter(deps: AdminRouterDeps): express.Router {
  const {
    platformService,
    engine,
    io,
    drawScheduler,
    bingoSettingsState,
    responsibleGamingStore,
    localBingoAdapter,
    usePostgresBingoAdapter,
    enforceSingleRoomPerHall,
    bingoMinRoundIntervalMs,
    bingoMinPlayersToStart,
    bingoMaxDrawsPerRound,
    fixedAutoDrawIntervalMs,
    forceAutoStart,
    forceAutoDraw,
    isProductionRuntime,
    autoplayAllowed,
    allowAutoplayInProduction,
    schedulerTickMs,
    emitRoomUpdate,
    emitManyRoomUpdates,
    emitWalletRoomUpdates,
    buildRoomUpdatePayload,
    persistBingoSettingsToCatalog,
    normalizeBingoSchedulerSettings,
    parseBingoSettingsPatch,
    getRoomConfiguredEntryFee,
    getArmedPlayerIds,
    disarmAllPlayers,
    clearDisplayTicketCache,
    roomConfiguredEntryFeeByRoom,
    getPrimaryRoomForHall,
    resolveBingoHallGameConfigForRoom,
    emailService,
    supportEmail,
  } = deps;

  const router = express.Router();

  // Shared helpers (audit + auth-guards). Single-use helpers bor i sitt eget
  // domenefil (adminAuth.ts, adminGamesSettings.ts, adminRooms.ts).
  const {
    auditAdmin,
    getAuthenticatedUser,
    requireAdminPermissionUser,
    requireAdminPanelUser,
  } = buildAdminRouterHelpers(deps);

  // ── Admin auth ────────────────────────────────────────────────────────────
  // Flyttet til adminAuth.ts — montert via sub-router under.

  // ── Games ─────────────────────────────────────────────────────────────────
  // Flyttet til adminGamesSettings.ts — montert via sub-router under.

  // ── Halls / Terminals / Hall-game-config / Spilleplan ────────────────────
  // Flyttet til adminHallsTerminals.ts — montert via sub-router under.

  // ── Rooms / room-ready / pause-resume ────────────────────────────────────
  // Flyttet til adminRooms.ts — montert via sub-router under.

  // ── Wallet compliance / Compliance / Prize policy / Payout audit ──────────
  // Flyttet til adminCompliance.ts — montert via sub-router under.

  // ── Ledger / Daily reports / Dashboard / Reports v2 ───────────────────────
  // Flyttet til adminReports.ts — montert via sub-router under.

  // ── Overskudd ─────────────────────────────────────────────────────────────

  router.post("/api/admin/overskudd/distributions", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_WRITE");
      const date = mustBeNonEmptyString(req.body?.date, "date");
      if (!Array.isArray(req.body?.allocations) || req.body.allocations.length === 0) {
        throw new DomainError("INVALID_INPUT", "allocations må inneholde minst én rad.");
      }
      const allocations = req.body.allocations.map((allocation: unknown) => {
        const typed = allocation as Record<string, unknown>;
        return {
          organizationId: mustBeNonEmptyString(typed?.organizationId, "organizationId"),
          organizationAccountId: mustBeNonEmptyString(typed?.organizationAccountId, "organizationAccountId"),
          sharePercent: Number(typed?.sharePercent)
        };
      });
      const batch = await engine.createOverskuddDistributionBatch({
        date,
        allocations,
        hallId: typeof req.body?.hallId === "string" ? req.body.hallId : undefined,
        gameType: parseOptionalLedgerGameType(req.body?.gameType),
        channel: parseOptionalLedgerChannel(req.body?.channel)
      });
      apiSuccess(res, batch);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/overskudd/distributions/:batchId", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_READ");
      const batchId = mustBeNonEmptyString(req.params.batchId, "batchId");
      const batch = engine.getOverskuddDistributionBatch(batchId);
      apiSuccess(res, batch);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/overskudd/distributions", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_READ");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : undefined;
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : undefined;
      const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
      const batches = engine.listOverskuddDistributionBatches({
        hallId,
        gameType,
        channel,
        dateFrom,
        dateTo,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined
      });
      apiSuccess(res, batches);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/overskudd/preview", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_READ");
      const date = mustBeNonEmptyString(req.query.date, "date");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const gameType = parseOptionalLedgerGameType(req.query.gameType);
      const channel = parseOptionalLedgerChannel(req.query.channel);

      const resolveAllocations = async (): Promise<{ organizationId: string; organizationAccountId: string; sharePercent: number }[]> => {
        if (Array.isArray(req.body?.allocations) && req.body.allocations.length > 0) {
          return req.body.allocations.map((allocation: unknown) => {
            const typed = allocation as Record<string, unknown>;
            return {
              organizationId: mustBeNonEmptyString(typed?.organizationId, "organizationId"),
              organizationAccountId: mustBeNonEmptyString(typed?.organizationAccountId, "organizationAccountId"),
              sharePercent: Number(typed?.sharePercent)
            };
          });
        }
        if (responsibleGamingStore) {
          const stored = await responsibleGamingStore.listHallOrganizationAllocations(hallId);
          const active = stored.filter((alloc) => alloc.isActive);
          if (active.length === 0) {
            throw new DomainError("NO_ALLOCATIONS", "Ingen aktive org-allokeringer funnet. Send allocations i body eller konfigurer dem via POST /api/admin/overskudd/organizations.");
          }
          return active.map((alloc) => ({
            organizationId: alloc.organizationId,
            organizationAccountId: alloc.organizationAccountId,
            sharePercent: alloc.sharePercent
          }));
        }
        throw new DomainError("NO_ALLOCATIONS", "allocations mangler i body og ingen persistence er konfigurert.");
      };

      const allocations = await resolveAllocations();

      const batch = engine.previewOverskuddDistribution({
        date,
        allocations,
        hallId,
        gameType,
        channel
      });
      apiSuccess(res, batch);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/overskudd/organizations", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_READ");
      if (!responsibleGamingStore) {
        apiSuccess(res, []);
        return;
      }
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const allocs = await responsibleGamingStore.listHallOrganizationAllocations(hallId);
      apiSuccess(res, allocs);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/overskudd/organizations", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_WRITE");
      if (!responsibleGamingStore) {
        throw new DomainError("NOT_CONFIGURED", "Persistence er ikke konfigurert.");
      }
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const organizationId = mustBeNonEmptyString(req.body?.organizationId, "organizationId");
      const organizationName = mustBeNonEmptyString(req.body?.organizationName, "organizationName");
      const organizationAccountId = mustBeNonEmptyString(req.body?.organizationAccountId, "organizationAccountId");
      const sharePercent = Number(req.body?.sharePercent);
      if (!Number.isFinite(sharePercent) || sharePercent <= 0) {
        throw new DomainError("INVALID_INPUT", "sharePercent må være større enn 0.");
      }
      const gameTypeRaw = typeof req.body?.gameType === "string" ? req.body.gameType.trim().toUpperCase() : null;
      const channelRaw = typeof req.body?.channel === "string" ? req.body.channel.trim().toUpperCase() : null;
      if (gameTypeRaw !== null && gameTypeRaw !== "MAIN_GAME" && gameTypeRaw !== "DATABINGO") {
        throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME, DATABINGO eller null.");
      }
      if (channelRaw !== null && channelRaw !== "HALL" && channelRaw !== "INTERNET") {
        throw new DomainError("INVALID_INPUT", "channel må være HALL, INTERNET eller null.");
      }
      const now = new Date().toISOString();
      const alloc = {
        id: randomUUID(),
        hallId,
        organizationId,
        organizationName,
        organizationAccountId,
        sharePercent,
        gameType: (gameTypeRaw as "MAIN_GAME" | "DATABINGO" | null),
        channel: (channelRaw as "HALL" | "INTERNET" | null),
        isActive: true,
        createdAt: now,
        updatedAt: now
      };
      await responsibleGamingStore.upsertHallOrganizationAllocation(alloc);
      apiSuccess(res, alloc);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/overskudd/organizations/:id", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "OVERSKUDD_WRITE");
      if (!responsibleGamingStore) {
        throw new DomainError("NOT_CONFIGURED", "Persistence er ikke konfigurert.");
      }
      const id = mustBeNonEmptyString(req.params.id, "id");
      await responsibleGamingStore.deleteHallOrganizationAllocation(id);
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Sub-routere ───────────────────────────────────────────────────────────
  // Domenefilene bygges med samme deps + de delte helpers.
  const subRouterDeps = {
    ...deps,
    helpers: {
      auditAdmin,
      getAuthenticatedUser,
      requireAdminPermissionUser,
      requireAdminPanelUser,
    },
  };
  router.use(createAdminAuthRouter(subRouterDeps));
  router.use(createAdminGamesSettingsRouter(subRouterDeps));
  router.use(createAdminHallsTerminalsRouter(subRouterDeps));
  router.use(createAdminRoomsRouter(subRouterDeps));
  router.use(createAdminComplianceRouter(subRouterDeps));
  router.use(createAdminReportsRouter(subRouterDeps));

  return router;
}
