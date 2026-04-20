/**
 * BIN-624: admin-router for SavedGame CRUD + load-to-game.
 *
 * Endepunkter (matches apps/admin-web savedGame-sidene — placeholder-
 * state i SavedGameState.ts peker hit):
 *   GET    /api/admin/saved-games                  → liste
 *   GET    /api/admin/saved-games/:id              → detalj
 *   POST   /api/admin/saved-games                  → opprett
 *   PATCH  /api/admin/saved-games/:id              → oppdater
 *   DELETE /api/admin/saved-games/:id              → soft-delete (default)
 *                                                     / hard-delete (?hard=true)
 *   POST   /api/admin/saved-games/:id/load-to-game → last template som
 *                                                     utgangspunkt for nytt
 *                                                     GameManagement
 *
 * Rolle-krav: SAVED_GAME_READ for GETs, SAVED_GAME_WRITE for
 * POST/PATCH/DELETE/load-to-game. SavedGame-maler ikke er like sentrale
 * som GameType-katalogen, så HALL_OPERATOR får samme WRITE-tilgang (matches
 * SUB_GAME_WRITE / PATTERN_WRITE / SCHEDULE_WRITE).
 *
 * Audit: create/update/delete/load-to-game skriver til AuditLogService
 * (fire-and-forget samme mønster som BIN-620 / BIN-621 / BIN-622 / BIN-627).
 *
 * Load-to-game-flyten (design):
 *   - Router mottar POST /api/admin/saved-games/:id/load-to-game.
 *   - Kall savedGameService.loadToGame(id) → `{savedGameId, gameTypeId, name,
 *     config}`.
 *   - Router returnerer payload til klient. Klient kan deretter POSTe til
 *     /api/admin/game-management (BIN-622) for å opprette faktisk spill.
 *     Vi IKKE oppretter GameManagement inline — det holder ansvars-
 *     grenseflatene rene (SavedGame er template-katalog, GameManagement er
 *     kjørbare spill) og lar klient-flyten justere felter (name, startDate,
 *     endDate, halls) før den opprettet spillet.
 *   - Audit-event `admin.saved_game.loaded` skriver `{savedGameId,
 *     gameTypeId}` slik at regulatorisk sporbarhet er bevart.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  SavedGameService,
  SavedGame,
  SavedGameStatus,
  CreateSavedGameInput,
  UpdateSavedGameInput,
} from "../admin/SavedGameService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-saved-games" });

export interface AdminSavedGamesRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  savedGameService: SavedGameService;
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

function parseOptionalStatus(value: unknown): SavedGameStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as SavedGameStatus;
  if (v !== "active" && v !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være én av active, inactive."
    );
  }
  return v;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError("INVALID_INPUT", `${field} må være en boolean.`);
  }
  return value;
}

function parseOptionalConfig(
  value: unknown
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "config må være et objekt.");
  }
  return value as Record<string, unknown>;
}

/**
 * Trim ned internt `SavedGame`-objekt til wire-shape (ingen deletedAt
 * eksponert) — samme mønster som adminSubGames.ts / adminGameTypes.ts.
 */
function toWireShape(g: SavedGame): Omit<SavedGame, "deletedAt"> {
  const { deletedAt: _deletedAt, ...rest } = g;
  return rest;
}

export function createAdminSavedGamesRouter(
  deps: AdminSavedGamesRouterDeps
): express.Router {
  const { platformService, auditLogService, savedGameService } = deps;
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
      logger.warn(
        { err, action: event.action },
        "[BIN-624] audit append failed"
      );
    });
  }

  // ── Read: list ──────────────────────────────────────────────────────

  router.get("/api/admin/saved-games", async (req, res) => {
    try {
      await requirePermission(req, "SAVED_GAME_READ");
      const status = parseOptionalStatus(req.query.status);
      const limit = parseLimit(req.query.limit, 200);
      const gameTypeRaw = req.query.gameType ?? req.query.gameTypeId;
      const gameTypeId =
        gameTypeRaw !== undefined && gameTypeRaw !== null && gameTypeRaw !== ""
          ? mustBeNonEmptyString(gameTypeRaw, "gameType")
          : undefined;
      const createdByRaw = req.query.createdBy;
      const createdBy =
        createdByRaw !== undefined && createdByRaw !== null && createdByRaw !== ""
          ? mustBeNonEmptyString(createdByRaw, "createdBy")
          : undefined;
      const savedGames = await savedGameService.list({
        status,
        limit,
        gameTypeId,
        createdBy,
      });
      apiSuccess(res, {
        savedGames: savedGames.map(toWireShape),
        count: savedGames.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: detail ────────────────────────────────────────────────────

  router.get("/api/admin/saved-games/:id", async (req, res) => {
    try {
      await requirePermission(req, "SAVED_GAME_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const savedGame = await savedGameService.get(id);
      apiSuccess(res, toWireShape(savedGame));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: create ───────────────────────────────────────────────────

  router.post("/api/admin/saved-games", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SAVED_GAME_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const input: CreateSavedGameInput = {
        gameTypeId: mustBeNonEmptyString(body.gameTypeId, "gameTypeId"),
        name: mustBeNonEmptyString(body.name, "name"),
        createdBy: actor.id,
      };
      const isAdminSave = parseOptionalBoolean(body.isAdminSave, "isAdminSave");
      if (isAdminSave !== undefined) input.isAdminSave = isAdminSave;
      const config = parseOptionalConfig(body.config);
      if (config !== undefined) input.config = config;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) input.status = status;

      const savedGame = await savedGameService.create(input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.saved_game.created",
        resource: "saved_game",
        resourceId: savedGame.id,
        details: {
          gameTypeId: savedGame.gameTypeId,
          name: savedGame.name,
          status: savedGame.status,
          isAdminSave: savedGame.isAdminSave,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(savedGame));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: patch ────────────────────────────────────────────────────

  router.patch("/api/admin/saved-games/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SAVED_GAME_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const update: UpdateSavedGameInput = {};

      if (body.name !== undefined) {
        update.name = mustBeNonEmptyString(body.name, "name");
      }
      const isAdminSave = parseOptionalBoolean(body.isAdminSave, "isAdminSave");
      if (isAdminSave !== undefined) update.isAdminSave = isAdminSave;
      const config = parseOptionalConfig(body.config);
      if (config !== undefined) update.config = config;
      const status = parseOptionalStatus(body.status);
      if (status !== undefined) update.status = status;

      const savedGame = await savedGameService.update(id, update);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.saved_game.updated",
        resource: "saved_game",
        resourceId: savedGame.id,
        details: {
          gameTypeId: savedGame.gameTypeId,
          name: savedGame.name,
          changed: Object.keys(update),
          status: savedGame.status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWireShape(savedGame));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: delete ───────────────────────────────────────────────────

  router.delete("/api/admin/saved-games/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SAVED_GAME_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const hardRaw = req.query.hard;
      const hard =
        typeof hardRaw === "string" && hardRaw.trim().toLowerCase() === "true";
      const existing = await savedGameService.get(id);
      const result = await savedGameService.remove(id, { hard });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: result.softDeleted
          ? "admin.saved_game.soft_deleted"
          : "admin.saved_game.deleted",
        resource: "saved_game",
        resourceId: id,
        details: {
          gameTypeId: existing.gameTypeId,
          name: existing.name,
          softDeleted: result.softDeleted,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Write: load-to-game ─────────────────────────────────────────────

  router.post("/api/admin/saved-games/:id/load-to-game", async (req, res) => {
    try {
      const actor = await requirePermission(req, "SAVED_GAME_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const payload = await savedGameService.loadToGame(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.saved_game.loaded_to_game",
        resource: "saved_game",
        resourceId: payload.savedGameId,
        details: {
          gameTypeId: payload.gameTypeId,
          name: payload.name,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, payload);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
