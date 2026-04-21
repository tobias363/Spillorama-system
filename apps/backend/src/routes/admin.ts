import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "socket.io";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, GameDefinition, UserRole } from "../platform/PlatformService.js";
import { APP_USER_ROLES } from "../platform/PlatformService.js";
import {
  ADMIN_ACCESS_POLICY,
  assertAdminPermission,
  assertUserHallScope,
  canAccessAdminPermission,
  getAdminPermissionMap,
  listAdminPermissionsForRole,
  resolveHallScopeFilter,
  type AdminPermission
} from "../platform/AdminAccessPolicy.js";
import type { PublicAppUser } from "../platform/PlatformService.js";
import type { PostgresResponsibleGamingStore } from "../game/PostgresResponsibleGamingStore.js";
import type { PostgresBingoSystemAdapter } from "../adapters/PostgresBingoSystemAdapter.js";
import type { GameSnapshot, Player } from "../game/types.js";
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
  parseOptionalBooleanInput,
  parseOptionalTicketsPerPlayerInput,
  isRecordObject,
} from "../util/httpHelpers.js";
import type { AdminSettingsCatalog, GameSettingsDefinition } from "../admin/settingsCatalog.js";
import { buildBingoSettingsDefinition, buildDefaultGameSettingsDefinition } from "../admin/settingsCatalog.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { RoomSnapshot } from "../game/types.js";
import type { RoomUpdatePayload } from "../util/roomHelpers.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import type { EmailService } from "../integration/EmailService.js";

// ── BIN-588 wire-up helpers ───────────────────────────────────────────────────

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

function mapRoleToActorType(role: UserRole): AuditActorType {
  switch (role) {
    case "ADMIN":
      return "ADMIN";
    case "HALL_OPERATOR":
      return "HALL_OPERATOR";
    case "SUPPORT":
      return "SUPPORT";
    case "PLAYER":
      return "PLAYER";
    default:
      return "USER";
  }
}

// ── Types copied from index.ts ────────────────────────────────────────────────

export interface BingoSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}

export interface PendingBingoSettingsUpdate {
  effectiveFromMs: number;
  settings: BingoSchedulerSettings;
}

export interface BingoSettingsState {
  runtimeBingoSettings: BingoSchedulerSettings;
  effectiveFromMs: number;
  pendingUpdate: PendingBingoSettingsUpdate | null;
}

interface PersistBingoSettingsOptions {
  changedBy?: {
    userId: string;
    displayName: string;
    role: UserRole;
  };
  source?: string;
  effectiveFromMs?: number;
}

export interface AdminRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
  io: Server;
  drawScheduler: DrawScheduler;
  bingoSettingsState: BingoSettingsState;
  responsibleGamingStore: PostgresResponsibleGamingStore | undefined;
  localBingoAdapter: { getGameSession?: (id: string) => Promise<unknown>; getGameTimeline?: (id: string) => Promise<unknown> } | null;
  usePostgresBingoAdapter: boolean;
  enforceSingleRoomPerHall: boolean;
  bingoMinRoundIntervalMs: number;
  bingoMinPlayersToStart: number;
  bingoMaxDrawsPerRound: number;
  fixedAutoDrawIntervalMs: number;
  forceAutoStart: boolean;
  forceAutoDraw: boolean;
  isProductionRuntime: boolean;
  autoplayAllowed: boolean;
  allowAutoplayInProduction: boolean;
  schedulerTickMs: number;
  emitRoomUpdate: (roomCode: string) => Promise<RoomSnapshot>;
  emitManyRoomUpdates: (roomCodes: Iterable<string>) => Promise<void>;
  emitWalletRoomUpdates: (walletIds: string[]) => Promise<void>;
  buildRoomUpdatePayload: (snapshot: RoomSnapshot) => RoomUpdatePayload;
  persistBingoSettingsToCatalog: (options?: PersistBingoSettingsOptions) => Promise<void>;
  normalizeBingoSchedulerSettings: (current: BingoSchedulerSettings, patch: Partial<BingoSchedulerSettings>) => BingoSchedulerSettings;
  parseBingoSettingsPatch: (value: unknown) => Partial<BingoSchedulerSettings>;
  getRoomConfiguredEntryFee: (roomCode: string) => number;
  getArmedPlayerIds: (roomCode: string) => string[];
  disarmAllPlayers: (roomCode: string) => void;
  clearDisplayTicketCache: (roomCode: string) => void;
  roomConfiguredEntryFeeByRoom: Map<string, number>;
  getPrimaryRoomForHall: (hallId: string) => { code: string; hallId: string; gameStatus: string; playerCount: number } | null;
  resolveBingoHallGameConfigForRoom: (roomCode: string) => Promise<{ hallId: string; maxTicketsPerPlayer: number }>;
  /**
   * BIN-694: Bind the default variant config for a freshly created room
   * so `BingoEngine.meetsPhaseRequirement` gets the 5-phase Norsk-bingo
   * pattern names (1 Rad / 2 Rader / … / Fullt Hus) instead of falling
   * back to the legacy 1-line rule that triggered every phase at once.
   * Idempotent — no-op when a variant is already set for the room.
   */
  bindDefaultVariantConfig?: (roomCode: string, gameSlug: string) => void;
  // BIN-588 wire-up: compliance audit + transactional mail. Both are
  // injected so tests can pass fakes and prod can pass the real store.
  auditLogService: AuditLogService;
  emailService: EmailService;
  supportEmail?: string;
}

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
    auditLogService,
    emailService,
    supportEmail,
  } = deps;

  const router = express.Router();

  // BIN-588 wire-up: compact fire-and-forget audit helper used by every
  // admin endpoint that mutates state. Errors never propagate — the
  // store already logs via pino — so a DB outage in the audit pipeline
  // cannot block an admin operation.
  function auditAdmin(
    req: express.Request,
    actor: { id: string; role: UserRole },
    action: string,
    resource: string,
    resourceId: string | null,
    details?: Record<string, unknown>,
  ): void {
    void auditLogService
      .record({
        actorId: actor.id,
        actorType: mapRoleToActorType(actor.role),
        action,
        resource,
        resourceId,
        details: details ?? {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      })
      .catch((err) => {
        void err;
      });
  }

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  async function requireAdminPermissionUser(
    req: express.Request,
    permission: AdminPermission,
    message?: string
  ): Promise<PublicAppUser> {
    const user = await getAuthenticatedUser(req);
    assertAdminPermission(user.role, permission, message);
    return user;
  }

  async function requireAdminPanelUser(req: express.Request, message?: string): Promise<PublicAppUser> {
    const user = await getAuthenticatedUser(req);
    assertAdminPermission(user.role, "ADMIN_PANEL_ACCESS", message);
    return user;
  }

  function buildAdminPermissionResponse(user: PublicAppUser): Record<string, unknown> {
    return {
      role: user.role,
      permissions: listAdminPermissionsForRole(user.role),
      permissionMap: getAdminPermissionMap(user.role),
      policy: ADMIN_ACCESS_POLICY
    };
  }

  function parseUserRoleInput(value: unknown): UserRole {
    const role = mustBeNonEmptyString(value, "role").toUpperCase();
    if (!APP_USER_ROLES.includes(role as UserRole)) {
      throw new DomainError(
        "INVALID_INPUT",
        `role må være en av: ${APP_USER_ROLES.join(", ")}.`
      );
    }
    return role as UserRole;
  }

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

  async function requireActiveHallIdFromInput(input: unknown): Promise<string> {
    const hallReference = mustBeNonEmptyString(input, "hallId");
    const hall = await platformService.requireActiveHall(hallReference);
    return hall.id;
  }

  // ── Admin auth ────────────────────────────────────────────────────────────

  router.post("/api/admin/auth/login", async (req, res) => {
    try {
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const session = await platformService.login({
        email,
        password
      });
      if (!canAccessAdminPermission(session.user.role, "ADMIN_PANEL_ACCESS")) {
        await platformService.logout(session.accessToken);
        throw new DomainError(
          "FORBIDDEN",
          `Rollen ${session.user.role} har ikke tilgang til admin-panelet.`
        );
      }
      apiSuccess(res, session);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/auth/logout", async (req, res) => {
    try {
      await requireAdminPanelUser(req);
      const accessToken = getAccessTokenFromRequest(req);
      await platformService.logout(accessToken);
      apiSuccess(res, { loggedOut: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/auth/me", async (req, res) => {
    try {
      const user = await requireAdminPanelUser(req);
      apiSuccess(res, user);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/permissions", async (req, res) => {
    try {
      const user = await requireAdminPanelUser(req);
      apiSuccess(res, buildAdminPermissionResponse(user));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-134: One-time bootstrap endpoint to promote a user to ADMIN when no admin exists.
  // Requires ADMIN_BOOTSTRAP_SECRET env var. Remove after first admin is created.
  router.post("/api/admin/bootstrap", async (req, res) => {
    try {
      const secret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim();
      if (!secret) {
        throw new DomainError("DISABLED", "Bootstrap er deaktivert (ADMIN_BOOTSTRAP_SECRET ikke satt).");
      }
      if (req.body?.secret !== secret) {
        throw new DomainError("UNAUTHORIZED", "Ugyldig bootstrap-hemmelighet.");
      }
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      // Login to get the user, then promote to ADMIN
      const session = await platformService.login({ email, password });
      const updated = await platformService.updateUserRole(session.user.id, "ADMIN");
      apiSuccess(res, { message: `${updated.email} er nå ADMIN.`, role: updated.role });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/users/:userId/role", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "USER_ROLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      const role = parseUserRoleInput(req.body?.role);
      const previous = await platformService.getUserById(userId).catch(() => null);
      const previousRole = previous?.role ?? null;
      const updated = await platformService.updateUserRole(userId, role);
      auditAdmin(req, adminUser, "user.role.change", "user", userId, {
        previousRole,
        newRole: role,
      });
      // Notify the affected user. Fire-and-forget — an SMTP glitch must
      // not block the role change itself.
      if (previous?.email && previousRole !== role) {
        const changedAt = new Date().toISOString();
        void emailService
          .sendTemplate({
            to: previous.email,
            template: "role-changed",
            context: {
              username: previous.displayName || previous.email,
              previousRole: previousRole ?? "Ukjent",
              newRole: role,
              changedAt,
              supportEmail: supportEmail ?? "",
            },
          })
          .catch((err) => {
            void err;
          });
      }
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /**
   * BIN-591: tildel/fjern hall for HALL_OPERATOR. ADMIN-only.
   * Body: { hallId: string | null }
   */
  router.put("/api/admin/users/:userId/hall", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "USER_ROLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.userId, "userId");
      const rawHallId = req.body?.hallId;
      const hallId =
        rawHallId === null || rawHallId === undefined || rawHallId === ""
          ? null
          : typeof rawHallId === "string"
            ? rawHallId.trim() || null
            : (() => {
                throw new DomainError("INVALID_INPUT", "hallId må være en streng eller null.");
              })();
      const updated = await platformService.updateUserHallAssignment(userId, hallId);
      auditAdmin(req, adminUser, "user.hall.assign", "user", userId, { hallId });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

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

  // ── Halls ─────────────────────────────────────────────────────────────────

  router.get("/api/admin/halls", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_READ");
      const includeInactive = parseBooleanQueryValue(req.query.includeInactive, true);
      const halls = await platformService.listHalls({ includeInactive });
      apiSuccess(res, halls);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/halls", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "HALL_WRITE");
      const hall = await platformService.createHall({
        slug: mustBeNonEmptyString(req.body?.slug, "slug"),
        name: mustBeNonEmptyString(req.body?.name, "name"),
        region: typeof req.body?.region === "string" ? req.body.region : undefined,
        address: typeof req.body?.address === "string" ? req.body.address : undefined,
        isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined
      });
      auditAdmin(req, adminUser, "hall.create", "hall", hall.id, {
        slug: hall.slug,
        name: hall.name,
      });
      apiSuccess(res, hall);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/halls/:hallId", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const hall = await platformService.updateHall(hallId, {
        slug: typeof req.body?.slug === "string" ? req.body.slug : undefined,
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        region: typeof req.body?.region === "string" ? req.body.region : undefined,
        address: typeof req.body?.address === "string" ? req.body.address : undefined,
        isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
        // BIN-540 admin-flip for the pilot cutover handle. Validated inside
        // PlatformService.assertClientVariant; unknown values return
        // INVALID_INPUT, not INTERNAL_ERROR.
        clientVariant: typeof req.body?.clientVariant === "string" ? req.body.clientVariant : undefined
      });
      auditAdmin(req, adminUser, "hall.update", "hall", hallId, {
        fields: Object.keys(req.body ?? {}),
      });
      apiSuccess(res, hall);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-503: Hall TV-display tokens ───────────────────────────────────────
  //
  // DB-backed rotation for the tokens used by the `/web/tv/` kiosk page.
  // Plaintext is returned exactly once (POST) and never read back.

  router.get("/api/admin/halls/:hallId/display-tokens", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const tokens = await platformService.listHallDisplayTokens(hallId);
      apiSuccess(res, tokens);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/halls/:hallId/display-tokens", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const label = typeof req.body?.label === "string" ? req.body.label : undefined;
      const token = await platformService.createHallDisplayToken(hallId, {
        label,
        createdByUserId: adminUser.id,
      });
      auditAdmin(req, adminUser, "hall.display_token.create", "hall", hallId, {
        tokenId: (token as { id?: string }).id ?? null,
        label: label ?? null,
      });
      apiSuccess(res, token);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/halls/:hallId/display-tokens/:tokenId", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const tokenId = mustBeNonEmptyString(req.params.tokenId, "tokenId");
      await platformService.revokeHallDisplayToken(tokenId, hallId);
      auditAdmin(req, adminUser, "hall.display_token.revoke", "hall", hallId, { tokenId });
      apiSuccess(res, { ok: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Terminals ─────────────────────────────────────────────────────────────

  router.get("/api/admin/terminals", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "TERMINAL_READ");
      const includeInactive = parseBooleanQueryValue(req.query.includeInactive, true);
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId : undefined;
      const terminals = await platformService.listTerminals({
        hallId,
        includeInactive
      });
      apiSuccess(res, terminals);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/terminals", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "TERMINAL_WRITE");
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      assertUserHallScope(adminUser, hallId); // BIN-591
      const terminalCode = mustBeNonEmptyString(req.body?.terminalCode, "terminalCode");
      const displayName =
        typeof req.body?.displayName === "string" && req.body.displayName.trim()
          ? req.body.displayName
          : terminalCode;
      const terminal = await platformService.createTerminal({
        hallId,
        terminalCode,
        displayName,
        isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined
      });
      auditAdmin(req, adminUser, "terminal.create", "terminal", terminal.id, {
        hallId,
        terminalCode,
      });
      apiSuccess(res, terminal);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/terminals/:terminalId", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "TERMINAL_WRITE");
      const terminalId = mustBeNonEmptyString(req.params.terminalId, "terminalId");
      const existing = await platformService.getTerminal(terminalId);
      assertUserHallScope(adminUser, existing.hallId); // BIN-591
      const terminal = await platformService.updateTerminal(terminalId, {
        terminalCode: typeof req.body?.terminalCode === "string" ? req.body.terminalCode : undefined,
        displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
        isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
        lastSeenAt: typeof req.body?.lastSeenAt === "string" ? req.body.lastSeenAt : undefined
      });
      auditAdmin(req, adminUser, "terminal.update", "terminal", terminalId, {
        hallId: existing.hallId,
        fields: Object.keys(req.body ?? {}),
      });
      apiSuccess(res, terminal);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Hall game config ──────────────────────────────────────────────────────

  router.get("/api/admin/halls/:hallId/game-config", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_GAME_CONFIG_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const includeDisabled = parseBooleanQueryValue(req.query.includeDisabled, true);
      const configs = await platformService.listHallGameConfigs({
        hallId,
        includeDisabled
      });
      apiSuccess(res, configs);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/halls/:hallId/game-config/:gameSlug", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "HALL_GAME_CONFIG_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(adminUser, hallId); // BIN-591
      const gameSlug = mustBeNonEmptyString(req.params.gameSlug, "gameSlug");
      const maxTicketsPerPlayer = parseOptionalInteger(req.body?.maxTicketsPerPlayer, "maxTicketsPerPlayer");
      const minRoundIntervalMs = parseOptionalInteger(req.body?.minRoundIntervalMs, "minRoundIntervalMs");
      const config = await platformService.upsertHallGameConfig({
        hallId,
        gameSlug,
        isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : undefined,
        maxTicketsPerPlayer: maxTicketsPerPlayer !== undefined ? Number(maxTicketsPerPlayer) : undefined,
        minRoundIntervalMs: minRoundIntervalMs !== undefined ? Number(minRoundIntervalMs) : undefined
      });
      auditAdmin(req, adminUser, "hall.game_config.update", "hall", hallId, {
        gameSlug,
        fields: Object.keys(req.body ?? {}),
      });
      apiSuccess(res, config);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Spilleplan — admin (§ 64) ─────────────────────────────────────────────

  // Admin: full schedule for a hall (all days, all states)
  router.get("/api/admin/halls/:hallId/schedule", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const activeOnly = parseBooleanQueryValue(req.query.activeOnly, false);
      const slots = await platformService.listScheduleSlots(hallId, { activeOnly });
      apiSuccess(res, slots);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Admin: create schedule slot
  router.post("/api/admin/halls/:hallId/schedule", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const slot = await platformService.createScheduleSlot(hallId, {
        gameType: mustBeNonEmptyString(req.body?.gameType, "gameType"),
        displayName: mustBeNonEmptyString(req.body?.displayName, "displayName"),
        startTime: mustBeNonEmptyString(req.body?.startTime, "startTime"),
        dayOfWeek: req.body?.dayOfWeek !== undefined ? req.body.dayOfWeek : null,
        prizeDescription: req.body?.prizeDescription ?? "",
        maxTickets: req.body?.maxTickets,
        isActive: req.body?.isActive,
        sortOrder: req.body?.sortOrder
      });
      res.status(201).json({ ok: true, data: slot });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Admin: update schedule slot
  router.put("/api/admin/halls/:hallId/schedule/:slotId", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_WRITE");
      const slotId = mustBeNonEmptyString(req.params.slotId, "slotId");
      const slot = await platformService.updateScheduleSlot(slotId, {
        gameType: req.body?.gameType,
        displayName: req.body?.displayName,
        startTime: req.body?.startTime,
        dayOfWeek: req.body?.dayOfWeek,
        prizeDescription: req.body?.prizeDescription,
        maxTickets: req.body?.maxTickets,
        isActive: req.body?.isActive,
        sortOrder: req.body?.sortOrder,
        variantConfig: req.body?.variantConfig,
      });
      apiSuccess(res, slot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Admin: delete schedule slot
  router.delete("/api/admin/halls/:hallId/schedule/:slotId", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_WRITE");
      const slotId = mustBeNonEmptyString(req.params.slotId, "slotId");
      await platformService.deleteScheduleSlot(slotId);
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Admin: log a completed scheduled game (audit trail)
  router.post("/api/admin/halls/:hallId/schedule/:slotId/log", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const slotId = mustBeNonEmptyString(req.params.slotId, "slotId");
      const entry = await platformService.logScheduledGame({
        hallId,
        scheduleSlotId: slotId,
        gameSessionId: req.body?.gameSessionId,
        endedAt: req.body?.endedAt,
        playerCount: req.body?.playerCount,
        totalPayout: req.body?.totalPayout,
        notes: req.body?.notes
      });
      res.status(201).json({ ok: true, data: entry });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Admin: view schedule audit log for a hall
  router.get("/api/admin/halls/:hallId/schedule-log", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "HALL_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const limit = parseOptionalInteger(req.query.limit, "limit");
      const entries = await platformService.listScheduleLog(hallId, {
        limit: limit !== undefined ? Number(limit) : undefined
      });
      apiSuccess(res, entries);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Rooms ─────────────────────────────────────────────────────────────────

  // BIN-591: hall-scope guard for room-control endpoints. Loads snapshot,
  // asserts user has access to the room's hall, returns snapshot for reuse.
  function requireRoomHallScope(
    adminUser: PublicAppUser,
    roomCodeRaw: string
  ): { roomCode: string; hallId: string } {
    const roomCode = mustBeNonEmptyString(roomCodeRaw, "roomCode").toUpperCase();
    const snapshot = engine.getRoomSnapshot(roomCode);
    if (!snapshot.hallId) {
      throw new DomainError(
        "ROOM_MISSING_HALL",
        "Rommet er ikke knyttet til en hall — kan ikke hall-scope-sjekkes."
      );
    }
    assertUserHallScope(adminUser, snapshot.hallId);
    return { roomCode, hallId: snapshot.hallId };
  }

  router.get("/api/admin/rooms", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
      const includeSnapshots = parseBooleanQueryValue(req.query.includeSnapshots, false);
      const rooms = engine.listRoomSummaries();
      // BIN-591: filter list to user's hall when HALL_OPERATOR
      const scopeHallId = resolveHallScopeFilter(adminUser);
      const scopedRooms = scopeHallId ? rooms.filter((r) => r.hallId === scopeHallId) : rooms;
      if (!includeSnapshots) {
        apiSuccess(res, scopedRooms);
        return;
      }
      const detailed = scopedRooms.map((room) => ({
        ...room,
        snapshot: buildRoomUpdatePayload(engine.getRoomSnapshot(room.code))
      }));
      apiSuccess(res, detailed);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/rooms/:roomCode", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
      const raw = engine.getRoomSnapshot(roomCode);
      if (raw.hallId) assertUserHallScope(adminUser, raw.hallId); // BIN-591
      const snapshot = buildRoomUpdatePayload(raw);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const hallId = await requireActiveHallIdFromInput(req.body?.hallId);
      assertUserHallScope(adminUser, hallId); // BIN-591

      // Enforce single room per hall — block creation if a canonical room already exists
      if (enforceSingleRoomPerHall) {
        const canonicalRoom = getPrimaryRoomForHall(hallId);
        if (canonicalRoom) {
          throw new DomainError(
            "SINGLE_ROOM_ONLY",
            `Kun ett bingo-rom er tillatt per hall. Rom ${canonicalRoom.code} er allerede aktivt.`
          );
        }
      }

      const requestedHostName =
        typeof req.body?.hostName === "string" && req.body.hostName.trim().length > 0
          ? req.body.hostName.trim()
          : `${adminUser.displayName} (Host)`;
      const requestedHostWalletId =
        typeof req.body?.hostWalletId === "string" && req.body.hostWalletId.trim().length > 0
          ? req.body.hostWalletId.trim()
          : `admin-host-${hallId}-${Date.now().toString(36)}`;
      const { roomCode, playerId } = await engine.createRoom({
        hallId,
        playerName: requestedHostName,
        walletId: requestedHostWalletId,
        roomCode: enforceSingleRoomPerHall ? "BINGO1" : undefined
      });
      // BIN-694: wire DEFAULT variantConfig for admin-created rooms. Admin
      // route defaults to "bingo" gameSlug (same fallback as `engine.createRoom`
      // when none specified) so the room gets the 5-phase Norsk-bingo config.
      deps.bindDefaultVariantConfig?.(roomCode, "bingo");
      const snapshot = await emitRoomUpdate(roomCode);
      auditAdmin(req, adminUser, "room.create", "room", roomCode, { hallId });
      apiSuccess(res, {
        roomCode,
        playerId,
        snapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/rooms/:roomCode", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode, hallId } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      engine.destroyRoom(roomCode);
      drawScheduler.releaseRoom(roomCode);
      roomConfiguredEntryFeeByRoom.delete(roomCode);
      auditAdmin(req, adminUser, "room.delete", "room", roomCode, { hallId });
      apiSuccess(res, { deleted: roomCode });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/start", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const entryFee = parseOptionalNonNegativeNumber(req.body?.entryFee, "entryFee") ?? getRoomConfiguredEntryFee(roomCode);
      const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
      const requestedTicketsPerPlayer = parseOptionalTicketsPerPlayerInput(req.body?.ticketsPerPlayer);
      const ticketsPerPlayer =
        requestedTicketsPerPlayer ??
        Math.min(hallGameConfig.maxTicketsPerPlayer, bingoSettingsState.runtimeBingoSettings.autoRoundTicketsPerPlayer);
      const { assertTicketsPerPlayerWithinHallLimit } = await import("../game/compliance.js");
      assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
      const beforeStartSnapshot = engine.getRoomSnapshot(roomCode);
      await engine.startGame({
        roomCode,
        actorPlayerId: beforeStartSnapshot.hostPlayerId,
        entryFee,
        ticketsPerPlayer,
        payoutPercent: bingoSettingsState.runtimeBingoSettings.payoutPercent,
        armedPlayerIds: getArmedPlayerIds(roomCode),
      });
      disarmAllPlayers(roomCode);
      clearDisplayTicketCache(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, {
        roomCode,
        snapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/draw-next", async (req, res) => {
    try {
      // BIN-254: Capture actual admin actor for audit log — not just the room host ID
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const snapshot = engine.getRoomSnapshot(roomCode);
      const drawResult = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: snapshot.hostPlayerId
      });
      console.info("[MEDIUM-4/BIN-254] Admin draw", {
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        adminWalletId: adminUser.walletId,
        roomCode,
        gameId: drawResult.gameId,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex
      });
      io.to(roomCode).emit("draw:new", { number: drawResult.number, source: "admin", drawIndex: drawResult.drawIndex, gameId: drawResult.gameId });
      const updatedSnapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, {
        roomCode,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex,
        gameId: drawResult.gameId,
        snapshot: updatedSnapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/end", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "Manual end from admin";
      const beforeEndSnapshot = engine.getRoomSnapshot(roomCode);
      await engine.endGame({
        roomCode,
        actorPlayerId: beforeEndSnapshot.hostPlayerId,
        reason
      });
      console.info("[MEDIUM-4] Admin end game", {
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        roomCode,
        reason
      });
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, {
        roomCode,
        snapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-515: Room-ready broadcast (admin) ─────────────────────────────────
  //
  // Mirrors the socket-event `admin:room-ready` for admin-web operators who
  // aren't on a live socket. Fires the same fan-out emit
  // (`admin:hall-event` → room-code + `hall:<id>:display`) so the TV and
  // spectator clients see the signal identically regardless of path.

  router.post("/api/admin/rooms/:roomCode/room-ready", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const countdownRaw = req.body?.countdownSeconds;
      const countdownSeconds = Number.isFinite(Number(countdownRaw))
        ? Math.max(0, Math.min(300, Math.floor(Number(countdownRaw))))
        : undefined;
      const message = typeof req.body?.message === "string"
        ? req.body.message.slice(0, 200)
        : undefined;
      // Confirm the room exists before advertising readiness.
      const snapshot = engine.getRoomSnapshot(roomCode);
      const event = {
        kind: "room-ready" as const,
        roomCode,
        hallId: snapshot.hallId ?? null,
        at: Date.now(),
        countdownSeconds,
        message,
        actor: { id: adminUser.id, displayName: adminUser.displayName },
      };
      io.to(roomCode).emit("admin:hall-event", event);
      if (event.hallId) io.to(`hall:${event.hallId}:display`).emit("admin:hall-event", event);
      apiSuccess(res, event);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-460: Game pause/resume (admin) ────────────────────────────────────

  router.post("/api/admin/rooms/:roomCode/game/pause", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const message = typeof req.body?.message === "string" ? req.body.message : undefined;
      engine.pauseGame(roomCode, message);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, { roomCode, isPaused: true, snapshot });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/game/resume", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      engine.resumeGame(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, { roomCode, isPaused: false, snapshot });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Wallet compliance (admin) ─────────────────────────────────────────────

  router.get("/api/admin/wallets/:walletId/compliance", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_READ");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const compliance = engine.getPlayerCompliance(walletId, hallId || undefined);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/wallets/:walletId/loss-limits", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const dailyLossLimit = parseOptionalNonNegativeNumber(req.body?.dailyLossLimit, "dailyLossLimit");
      const monthlyLossLimit = parseOptionalNonNegativeNumber(req.body?.monthlyLossLimit, "monthlyLossLimit");
      if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
        throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
      }
      const compliance = await engine.setPlayerLossLimits({
        walletId,
        hallId,
        daily: dailyLossLimit,
        monthly: monthlyLossLimit
      });
      auditAdmin(req, adminUser, "wallet.loss_limits.update", "wallet", walletId, {
        hallId,
        dailyLossLimit: dailyLossLimit ?? null,
        monthlyLossLimit: monthlyLossLimit ?? null,
      });
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/wallets/:walletId/timed-pause", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
      const compliance = await engine.setTimedPause({
        walletId,
        durationMinutes: durationMinutes ?? 15
      });
      auditAdmin(req, adminUser, "wallet.timed_pause.set", "wallet", walletId, {
        durationMinutes: durationMinutes ?? 15,
      });
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/wallets/:walletId/timed-pause", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const compliance = await engine.clearTimedPause(walletId);
      auditAdmin(req, adminUser, "wallet.timed_pause.clear", "wallet", walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const compliance = await engine.setSelfExclusion(walletId);
      auditAdmin(req, adminUser, "wallet.self_exclusion.set", "wallet", walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const compliance = await engine.clearSelfExclusion(walletId);
      auditAdmin(req, adminUser, "wallet.self_exclusion.clear", "wallet", walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Compliance ────────────────────────────────────────────────────────────

  router.get("/api/admin/compliance/extra-draw-denials", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "EXTRA_DRAW_DENIALS_READ");
      const limit = parseLimit(req.query.limit, 100);
      apiSuccess(res, engine.listExtraDrawDenials(limit));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Prize policy ──────────────────────────────────────────────────────────

  router.get("/api/admin/prize-policy/active", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PRIZE_POLICY_READ");
      const hallId = mustBeNonEmptyString(req.query.hallId, "hallId");
      const linkId = typeof req.query.linkId === "string" ? req.query.linkId.trim() : undefined;
      const at = typeof req.query.at === "string" ? req.query.at.trim() : undefined;
      const policy = engine.getActivePrizePolicy({
        hallId,
        linkId,
        gameType: "DATABINGO",
        at
      });
      apiSuccess(res, policy);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/prize-policy", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PRIZE_POLICY_WRITE");
      const hallId = typeof req.body?.hallId === "string" ? req.body.hallId : undefined;
      const linkId = typeof req.body?.linkId === "string" ? req.body.linkId : undefined;
      const policy = await engine.upsertPrizePolicy({
        gameType: "DATABINGO",
        hallId,
        linkId,
        effectiveFrom: mustBeNonEmptyString(req.body?.effectiveFrom, "effectiveFrom"),
        singlePrizeCap:
          req.body?.singlePrizeCap === undefined
            ? undefined
            : parseOptionalNonNegativeNumber(req.body?.singlePrizeCap, "singlePrizeCap"),
        dailyExtraPrizeCap:
          req.body?.dailyExtraPrizeCap === undefined
            ? undefined
            : parseOptionalNonNegativeNumber(req.body?.dailyExtraPrizeCap, "dailyExtraPrizeCap")
      });
      auditAdmin(req, adminUser, "prize_policy.update", "prize_policy", linkId ?? hallId ?? "global", {
        hallId: hallId ?? null,
        linkId: linkId ?? null,
        effectiveFrom: req.body?.effectiveFrom,
        fields: Object.keys(req.body ?? {}),
      });
      apiSuccess(res, policy);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/wallets/:walletId/extra-prize", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "EXTRA_PRIZE_AWARD");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const amount = mustBePositiveAmount(req.body?.amount);
      const linkId = typeof req.body?.linkId === "string" ? req.body.linkId : undefined;
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const result = await engine.awardExtraPrize({
        walletId,
        hallId,
        linkId,
        amount,
        reason
      });
      await emitWalletRoomUpdates([walletId]);
      auditAdmin(req, adminUser, "wallet.extra_prize.award", "wallet", walletId, {
        hallId,
        amount,
        linkId: linkId ?? null,
        reason: reason ?? null,
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Payout audit ──────────────────────────────────────────────────────────

  router.get("/api/admin/payout-audit", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PAYOUT_AUDIT_READ");
      const limit = parseLimit(req.query.limit, 100);
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const gameId = typeof req.query.gameId === "string" ? req.query.gameId.trim() : undefined;
      const walletId = typeof req.query.walletId === "string" ? req.query.walletId.trim() : undefined;
      const events = engine.listPayoutAuditTrail({
        limit,
        hallId,
        gameId,
        walletId
      });
      apiSuccess(res, events);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-173: Game replay endpoint — returns full checkpoint timeline for a game
  router.get("/api/admin/games/:gameId/replay", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "ADMIN_PANEL_ACCESS");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");

      if (!usePostgresBingoAdapter || !localBingoAdapter) {
        apiFailure(res, new DomainError("NOT_CONFIGURED", "Game checkpointing er ikke aktivert."));
        return;
      }

      const adapter = localBingoAdapter as { getGameSession: (id: string) => Promise<unknown>; getGameTimeline: (id: string) => Promise<unknown> };
      const session = await adapter.getGameSession(gameId);
      if (!session) {
        apiFailure(res, new DomainError("GAME_NOT_FOUND", `Spill ${gameId} finnes ikke.`));
        return;
      }

      const timeline = await adapter.getGameTimeline(gameId);
      apiSuccess(res, { session, timeline });
    } catch (error) {
      apiFailure(res, error);
    }
  });

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

  return router;
}
