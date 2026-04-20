/**
 * BIN-679: admin-router for MiniGames config CRUD.
 *
 * 8 endepunkter — GET+PUT per spill-type (wheel, chest, mystery, colordraft):
 *   GET    /api/admin/mini-games/wheel
 *   PUT    /api/admin/mini-games/wheel
 *   GET    /api/admin/mini-games/chest
 *   PUT    /api/admin/mini-games/chest
 *   GET    /api/admin/mini-games/mystery
 *   PUT    /api/admin/mini-games/mystery
 *   GET    /api/admin/mini-games/colordraft
 *   PUT    /api/admin/mini-games/colordraft
 *
 * Rolle-krav: MINI_GAMES_READ for GETs, MINI_GAMES_WRITE (ADMIN-only) for
 * PUTs (se AdminAccessPolicy.ts — matches GAME_CATALOG_WRITE /
 * LEADERBOARD_TIER_WRITE siden dette er sentralt definert konfig, ikke
 * hall-lokal).
 *
 * Svar-formatet matcher `MiniGameConfigRow` i shared-types/schemas.ts.
 *
 * Audit: PUT skriver til AuditLogService (fire-and-forget, samme mønster
 * som BIN-620/622/626/627/665/668). Action-navn per krav i issue:
 * `admin.mini_games.wheel.update`, `admin.mini_games.chest.update`,
 * `admin.mini_games.mystery.update`, `admin.mini_games.colordraft.update`.
 *
 * Avgrensning: dette er ADMIN-CRUD av konfigurasjonen. Runtime-integrasjonen
 * i Game 1 (BingoEngine.MINIGAME_PRIZES) leser i dag hardkodede arrays —
 * wiring til denne tabellen er egen PR.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  MiniGamesConfigService,
  MiniGameConfig,
  MiniGameType,
  UpdateMiniGameConfigInput,
} from "../admin/MiniGamesConfigService.js";
import { MINI_GAME_TYPES } from "../admin/MiniGamesConfigService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-mini-games" });

export interface AdminMiniGamesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  miniGamesConfigService: MiniGamesConfigService;
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
  role: PublicAppUser["role"],
): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

function parseOptionalConfig(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "config må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function parseOptionalActive(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError("INVALID_INPUT", "active må være boolean.");
  }
  return value;
}

export function createAdminMiniGamesRouter(
  deps: AdminMiniGamesRouterDeps,
): express.Router {
  const { platformService, auditLogService, miniGamesConfigService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn(
        { err, action: event.action },
        "[BIN-679] audit append failed",
      );
    });
  }

  // Register GET + PUT for each of the 4 mini-games. Using a loop keeps all
  // 8 endpoints in lock-step and avoids 8 near-identical copies.
  for (const gameType of MINI_GAME_TYPES) {
    const path = `/api/admin/mini-games/${gameType}`;

    // ── GET: read singleton config ──────────────────────────────────
    router.get(path, async (req, res) => {
      try {
        await requirePermission(req, "MINI_GAMES_READ");
        const config = await miniGamesConfigService.get(gameType);
        apiSuccess(res, config);
      } catch (error) {
        apiFailure(res, error);
      }
    });

    // ── PUT: upsert singleton config ────────────────────────────────
    router.put(path, async (req, res) => {
      try {
        const actor = await requirePermission(req, "MINI_GAMES_WRITE");
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const body = req.body as Record<string, unknown>;
        const config = parseOptionalConfig(body.config);
        const active = parseOptionalActive(body.active);

        const input: UpdateMiniGameConfigInput = {
          updatedByUserId: actor.id,
        };
        if (config !== undefined) input.config = config;
        if (active !== undefined) input.active = active;

        const updated = await miniGamesConfigService.update(gameType, input);
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: `admin.mini_games.${gameType}.update`,
          resource: "mini_game_config",
          resourceId: updated.id,
          details: {
            gameType: updated.gameType,
            active: updated.active,
            changed: Object.keys(input).filter((k) => k !== "updatedByUserId"),
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        apiSuccess(res, updated);
      } catch (error) {
        apiFailure(res, error);
      }
    });
  }

  return router;
}

export { MINI_GAME_TYPES };
export type { MiniGameConfig, MiniGameType };
