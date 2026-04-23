import express from "express";
import type { Server } from "socket.io";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission
} from "../platform/AdminAccessPolicy.js";
import type { PublicAppUser } from "../platform/PlatformService.js";
import type { PostgresResponsibleGamingStore } from "../game/PostgresResponsibleGamingStore.js";
import {
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { RoomSnapshot } from "../game/types.js";
import type { RoomUpdatePayload } from "../util/roomHelpers.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import type { EmailService } from "../integration/EmailService.js";
import type { HallCashLedger } from "../agent/HallCashLedger.js";

// ── BIN-588 wire-up helpers ───────────────────────────────────────────────────

export function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

export function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

export function mapRoleToActorType(role: UserRole): AuditActorType {
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
  /**
   * PR C: Async binder som leser admin-config via `gameManagementId` og
   * faller til default ellers. Erstatter `bindDefaultVariantConfig` i
   * admin-router-calls; plumbing-en forbereder fremtidig scope der
   * ID-en kommer inn på body til `/room/create`.
   */
  bindVariantConfigForRoom?: (
    roomCode: string,
    opts: { gameSlug: string; gameManagementId?: string | null },
  ) => Promise<void>;
  // BIN-588 wire-up: compliance audit + transactional mail. Both are
  // injected so tests can pass fakes and prod can pass the real store.
  auditLogService: AuditLogService;
  emailService: EmailService;
  supportEmail?: string;
  /**
   * Hall cash-balanse ledger. Brukes av admin "Add Money"-endpointet for å
   * kreditere available balance atomisk + skrive tx-rad (immutable audit).
   * Gjenbruker samme ledger som `AgentSettlementService`.
   */
  hallCashLedger: HallCashLedger;
}

// ── Shared helpers factory ────────────────────────────────────────────────────
//
// `buildAdminRouterHelpers` returns helpers that every sub-router needs:
// audit-log write + auth-guards. Single-use helpers (f.eks. `parseUserRoleInput`
// for auth, `requireActiveHallIdFromInput` for rooms,
// `normalizeGameSettingsForUpdate` for games) bor i sitt eget domenefil i
// stedet for å holde shared-surface minimal.

export interface AdminRouterHelpers {
  auditAdmin: (
    req: express.Request,
    actor: { id: string; role: UserRole },
    action: string,
    resource: string,
    resourceId: string | null,
    details?: Record<string, unknown>,
  ) => void;
  getAuthenticatedUser: (req: express.Request) => Promise<PublicAppUser>;
  requireAdminPermissionUser: (
    req: express.Request,
    permission: AdminPermission,
    message?: string,
  ) => Promise<PublicAppUser>;
  requireAdminPanelUser: (req: express.Request, message?: string) => Promise<PublicAppUser>;
}

export function buildAdminRouterHelpers(deps: AdminRouterDeps): AdminRouterHelpers {
  const { platformService, auditLogService } = deps;

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

  return {
    auditAdmin,
    getAuthenticatedUser,
    requireAdminPermissionUser,
    requireAdminPanelUser,
  };
}

// Convenience type for sub-routers: includes deps + shared helpers.
export type AdminSubRouterDeps = AdminRouterDeps & { helpers: AdminRouterHelpers };
