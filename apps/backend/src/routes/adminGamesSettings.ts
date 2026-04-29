import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { GameDefinition } from "../platform/PlatformService.js";
import {
  apiSuccess,
  apiFailure,
  mustBeNonEmptyString,
  parseLimit,
  parseOptionalIsoTimestampMs,
  isRecordObject,
} from "../util/httpHelpers.js";
import type { AdminSettingsCatalog } from "../admin/settingsCatalog.js";
import { buildBingoSettingsDefinition, buildDefaultGameSettingsDefinition } from "../admin/settingsCatalog.js";
import type { AdminSubRouterDeps } from "./adminShared.js";

export function createAdminGamesSettingsRouter(deps: AdminSubRouterDeps): express.Router {
  const {
    platformService,
    engine,
    bingoSettingsState,
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
    helpers,
  } = deps;
  const { auditAdmin, requireAdminPermissionUser } = helpers;
  const router = express.Router();

  function normalizeGameSettingsForUpdate(
    gameSlug: string,
    settings: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    void gameSlug;
    if (!settings) {
      return undefined;
    }
    return settings;
  }

  function getBingoAdminSettingsResponse(): Record<string, unknown> {
    const lockActive = engine.listRoomSummaries().some((s) => s.gameStatus === "RUNNING");
    return {
      ...bingoSettingsState.runtimeBingoSettings,
      effectiveFrom: new Date(bingoSettingsState.effectiveFromMs).toISOString(),
      pendingUpdate: bingoSettingsState.pendingUpdate ? { effectiveFrom: new Date(bingoSettingsState.pendingUpdate.effectiveFromMs).toISOString(), settings: { ...bingoSettingsState.pendingUpdate.settings } } : null,
      schedulerTickMs,
      constraints: {
        runtime: isProductionRuntime ? "production" : "non-production",
        autoplayAllowed, allowAutoplayInProduction, forceAutoStart, forceAutoDraw,
        minRoundIntervalMs: bingoMinRoundIntervalMs, minPlayersToStart: bingoMinPlayersToStart,
        maxDrawsPerRound: bingoMaxDrawsPerRound, maxTicketsPerPlayer: 5,
        minPayoutPercent: 0, maxPayoutPercent: 100, fixedAutoDrawIntervalMs,
        runningRoundLockActive: lockActive
      },
      locks: { runningRoundLockActive: lockActive }
    };
  }

  function buildAdminSettingsCatalogResponse(games: GameDefinition[]): AdminSettingsCatalog {
    const lockActive = engine.listRoomSummaries().some((s) => s.gameStatus === "RUNNING");
    return {
      generatedAt: new Date().toISOString(),
      games: games.map((game) => {
        if (game.slug === "bingo") {
          return buildBingoSettingsDefinition({ minRoundIntervalMs: bingoMinRoundIntervalMs, minPlayersToStart: bingoMinPlayersToStart, maxTicketsPerPlayer: 5, fixedAutoDrawIntervalMs, forceAutoStart, forceAutoDraw, runningRoundLockActive: lockActive });
        }
        return buildDefaultGameSettingsDefinition(game);
      })
    };
  }

  function buildAdminGameSettingsResponse(game: GameDefinition): Record<string, unknown> {
    return {
      slug: game.slug,
      title: game.title,
      description: game.description,
      updatedAt: game.updatedAt,
      settings: { ...(game.settings ?? {}) },
      locks: {
        runningRoundLockActive: false
      }
    };
  }

  function extractAdminGameSettingsPayload(
    body: unknown
  ): { settings: Record<string, unknown>; effectiveFromMs?: number } {
    if (!isRecordObject(body)) {
      throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
    }
    const effectiveFromMs = parseOptionalIsoTimestampMs(body.effectiveFrom, "effectiveFrom");

    if (body.settings !== undefined) {
      if (!isRecordObject(body.settings)) {
        throw new DomainError("INVALID_INPUT", "settings må være et objekt.");
      }
      return {
        settings: body.settings,
        effectiveFromMs
      };
    }

    const { effectiveFrom: _ignoredEffectiveFrom, ...directSettings } = body;
    return {
      settings: directSettings,
      effectiveFromMs
    };
  }

  // Re-eksport for å unngå dead-code-advarsler. `getBingoAdminSettingsResponse`
  // er ikke brukt i admin-endepunktene i dag, men holdes byte-identisk fra
  // admin.ts; fjernes i separat PR hvis det bekreftes død.
  void getBingoAdminSettingsResponse;

  // ── Games ─────────────────────────────────────────────────────────────────

  router.get("/api/admin/games", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "GAME_CATALOG_READ");
      const games = await platformService.listGames({ includeDisabled: true });
      apiSuccess(res, games);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/settings/catalog", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "GAME_CATALOG_READ");
      const games = await platformService.listGames({ includeDisabled: true });
      apiSuccess(res, buildAdminSettingsCatalogResponse(games));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/settings/games/:slug", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "GAME_CATALOG_READ");
      const slug = mustBeNonEmptyString(req.params.slug, "slug");
      const game = await platformService.getGame(slug);
      apiSuccess(res, buildAdminGameSettingsResponse(game));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/settings/games/:slug", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "GAME_CATALOG_WRITE");
      const slug = mustBeNonEmptyString(req.params.slug, "slug");
      const { settings, effectiveFromMs } = extractAdminGameSettingsPayload(req.body);
      const updated = await platformService.updateGame(slug, {
        settings: normalizeGameSettingsForUpdate(slug, settings)
      }, {
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_TYPED_GAME_SETTINGS_WRITE",
        effectiveFrom:
          effectiveFromMs !== undefined
            ? new Date(effectiveFromMs).toISOString()
            : new Date().toISOString()
      });
      auditAdmin(req, adminUser, "game.settings.update", "game", slug, {
        effectiveFromMs: effectiveFromMs ?? null,
        changedKeys: Object.keys(settings ?? {}),
      });
      apiSuccess(res, buildAdminGameSettingsResponse(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/game-settings/change-log", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "GAME_SETTINGS_CHANGELOG_READ");
      const gameSlug = typeof req.query.gameSlug === "string" ? req.query.gameSlug.trim() : undefined;
      const limit = parseLimit(req.query.limit, 50);
      const log = await platformService.listGameSettingsChangeLog({
        gameSlug: gameSlug || undefined,
        limit
      });
      apiSuccess(res, log);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/games/:slug", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "GAME_CATALOG_WRITE");
      const slug = mustBeNonEmptyString(req.params.slug, "slug");
      const rawSettings =
        req.body?.settings && typeof req.body.settings === "object" && !Array.isArray(req.body.settings)
          ? (req.body.settings as Record<string, unknown>)
          : undefined;
      const updated = await platformService.updateGame(slug, {
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        description: typeof req.body?.description === "string" ? req.body.description : undefined,
        route: typeof req.body?.route === "string" ? req.body.route : undefined,
        isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : undefined,
        sortOrder: Number.isFinite(req.body?.sortOrder) ? Number(req.body.sortOrder) : undefined,
        settings: normalizeGameSettingsForUpdate(slug, rawSettings)
      }, {
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_GAME_CATALOG_WRITE",
        effectiveFrom: new Date().toISOString()
      });
      auditAdmin(req, adminUser, "game.update", "game", slug, {
        fields: Object.keys(req.body ?? {}),
        settingsChanged: rawSettings !== undefined,
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
