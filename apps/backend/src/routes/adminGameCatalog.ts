/**
 * Fase 2 (2026-05-07): admin-router for spillkatalog.
 *
 * Endepunkter (matches apps/admin-web/.../GameCatalogState.ts-kontrakten i Fase 2):
 *   GET    /api/admin/game-catalog              — list (filter ?isActive=true|false)
 *   POST   /api/admin/game-catalog              — opprett
 *   GET    /api/admin/game-catalog/:id          — detalj
 *   PUT    /api/admin/game-catalog/:id          — oppdater (partial patch)
 *   DELETE /api/admin/game-catalog/:id          — soft-deactivate
 *
 * Rolle-krav (fra AdminAccessPolicy.ts):
 *   - GAME_CATALOG_READ:  ADMIN, HALL_OPERATOR, SUPPORT, AGENT
 *   - GAME_CATALOG_WRITE: ADMIN
 *
 * Wire-format speiler `GameCatalogEntry` 1:1. Ticket-priser og premier
 * kommer i ØRE (cents) over wire — admin-UI konverterer til/fra kr.
 *
 * Audit: create/update/deactivate skriver til AuditLogService via
 * GameCatalogService (samme mønster som adminGameTypes.ts).
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { GameCatalogService } from "../game/GameCatalogService.js";
import type {
  CreateGameCatalogInput,
  GameCatalogEntry,
  UpdateGameCatalogInput,
} from "../game/gameCatalog.types.js";
import { assertAdminPermission } from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game-catalog" });

export interface AdminGameCatalogRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  catalogService: GameCatalogService;
}

function actorTypeFromRole(
  role: PublicAppUser["role"],
): "ADMIN" | "USER" {
  return role === "ADMIN" ? "ADMIN" : "USER";
}

function parseOptionalBool(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  throw new DomainError("INVALID_INPUT", `${field} må være true/false.`);
}

export function createAdminGameCatalogRouter(
  deps: AdminGameCatalogRouterDeps,
): express.Router {
  const { platformService, catalogService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: "GAME_CATALOG_READ" | "GAME_CATALOG_WRITE",
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  // ── List ──────────────────────────────────────────────────────────────

  router.get("/api/admin/game-catalog", async (req, res) => {
    try {
      await requirePermission(req, "GAME_CATALOG_READ");
      const isActive = parseOptionalBool(req.query.isActive, "isActive");
      const limit = parseLimit(req.query.limit, 200);
      const filter: { isActive?: boolean; limit?: number } = { limit };
      if (isActive !== undefined) filter.isActive = isActive;
      const entries = await catalogService.list(filter);
      apiSuccess(res, { entries, count: entries.length });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Detail ────────────────────────────────────────────────────────────

  router.get("/api/admin/game-catalog/:id", async (req, res) => {
    try {
      await requirePermission(req, "GAME_CATALOG_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const entry = await catalogService.getById(id);
      if (!entry) {
        throw new DomainError(
          "GAME_CATALOG_NOT_FOUND",
          "Spillkatalog finnes ikke.",
        );
      }
      apiSuccess(res, entry);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Create ────────────────────────────────────────────────────────────

  router.post("/api/admin/game-catalog", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;

      // Prizes-cents er obligatorisk; service-laget gjør full validering.
      if (!isRecordObject(body.prizesCents)) {
        throw new DomainError(
          "INVALID_INPUT",
          "prizesCents er påkrevd og må være et objekt.",
        );
      }

      const input: CreateGameCatalogInput = {
        slug: mustBeNonEmptyString(body.slug, "slug"),
        displayName: mustBeNonEmptyString(body.displayName, "displayName"),
        prizesCents: body.prizesCents as unknown as CreateGameCatalogInput["prizesCents"],
        createdByUserId: actor.id,
      };

      if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== "string") {
          throw new DomainError(
            "INVALID_INPUT",
            "description må være streng eller null.",
          );
        }
        input.description = body.description;
      }
      if (body.rules !== undefined) {
        if (!isRecordObject(body.rules)) {
          throw new DomainError("INVALID_INPUT", "rules må være et objekt.");
        }
        input.rules = body.rules;
      }
      if (body.ticketColors !== undefined) {
        if (!Array.isArray(body.ticketColors)) {
          throw new DomainError(
            "INVALID_INPUT",
            "ticketColors må være en liste.",
          );
        }
        input.ticketColors = body.ticketColors as CreateGameCatalogInput["ticketColors"];
      }
      if (body.ticketPricesCents !== undefined) {
        if (!isRecordObject(body.ticketPricesCents)) {
          throw new DomainError(
            "INVALID_INPUT",
            "ticketPricesCents må være et objekt.",
          );
        }
        input.ticketPricesCents = body.ticketPricesCents as CreateGameCatalogInput["ticketPricesCents"];
      }
      if (body.bonusGameSlug !== undefined) {
        if (
          body.bonusGameSlug !== null &&
          typeof body.bonusGameSlug !== "string"
        ) {
          throw new DomainError(
            "INVALID_INPUT",
            "bonusGameSlug må være streng eller null.",
          );
        }
        input.bonusGameSlug = body.bonusGameSlug as CreateGameCatalogInput["bonusGameSlug"];
      }
      if (body.bonusGameEnabled !== undefined) {
        const flag = parseOptionalBool(body.bonusGameEnabled, "bonusGameEnabled");
        if (flag !== undefined) input.bonusGameEnabled = flag;
      }
      if (body.requiresJackpotSetup !== undefined) {
        const flag = parseOptionalBool(
          body.requiresJackpotSetup,
          "requiresJackpotSetup",
        );
        if (flag !== undefined) input.requiresJackpotSetup = flag;
      }
      if (body.isActive !== undefined) {
        const flag = parseOptionalBool(body.isActive, "isActive");
        if (flag !== undefined) input.isActive = flag;
      }
      if (body.sortOrder !== undefined) {
        const n = Number(body.sortOrder);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          throw new DomainError(
            "INVALID_INPUT",
            "sortOrder må være ikke-negativt heltall.",
          );
        }
        input.sortOrder = n;
      }

      const entry = await catalogService.create(input, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, entry);
    } catch (err) {
      logger.warn({ err }, "create game-catalog failed");
      apiFailure(res, err);
    }
  });

  // ── Update (partial patch) ────────────────────────────────────────────

  router.put("/api/admin/game-catalog/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const body = req.body;
      const patch: UpdateGameCatalogInput = {};

      if (body.slug !== undefined) {
        patch.slug = mustBeNonEmptyString(body.slug, "slug");
      }
      if (body.displayName !== undefined) {
        patch.displayName = mustBeNonEmptyString(body.displayName, "displayName");
      }
      if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== "string") {
          throw new DomainError(
            "INVALID_INPUT",
            "description må være streng eller null.",
          );
        }
        patch.description = body.description as string | null;
      }
      if (body.rules !== undefined) {
        if (!isRecordObject(body.rules)) {
          throw new DomainError("INVALID_INPUT", "rules må være et objekt.");
        }
        patch.rules = body.rules;
      }
      if (body.ticketColors !== undefined) {
        if (!Array.isArray(body.ticketColors)) {
          throw new DomainError(
            "INVALID_INPUT",
            "ticketColors må være en liste.",
          );
        }
        patch.ticketColors = body.ticketColors as UpdateGameCatalogInput["ticketColors"];
      }
      if (body.ticketPricesCents !== undefined) {
        if (!isRecordObject(body.ticketPricesCents)) {
          throw new DomainError(
            "INVALID_INPUT",
            "ticketPricesCents må være et objekt.",
          );
        }
        patch.ticketPricesCents = body.ticketPricesCents as UpdateGameCatalogInput["ticketPricesCents"];
      }
      if (body.prizesCents !== undefined) {
        if (!isRecordObject(body.prizesCents)) {
          throw new DomainError(
            "INVALID_INPUT",
            "prizesCents må være et objekt.",
          );
        }
        patch.prizesCents = body.prizesCents as unknown as UpdateGameCatalogInput["prizesCents"];
      }
      if (body.bonusGameSlug !== undefined) {
        if (
          body.bonusGameSlug !== null &&
          typeof body.bonusGameSlug !== "string"
        ) {
          throw new DomainError(
            "INVALID_INPUT",
            "bonusGameSlug må være streng eller null.",
          );
        }
        patch.bonusGameSlug = body.bonusGameSlug as UpdateGameCatalogInput["bonusGameSlug"];
      }
      if (body.bonusGameEnabled !== undefined) {
        const flag = parseOptionalBool(body.bonusGameEnabled, "bonusGameEnabled");
        if (flag !== undefined) patch.bonusGameEnabled = flag;
      }
      if (body.requiresJackpotSetup !== undefined) {
        const flag = parseOptionalBool(
          body.requiresJackpotSetup,
          "requiresJackpotSetup",
        );
        if (flag !== undefined) patch.requiresJackpotSetup = flag;
      }
      if (body.isActive !== undefined) {
        const flag = parseOptionalBool(body.isActive, "isActive");
        if (flag !== undefined) patch.isActive = flag;
      }
      if (body.sortOrder !== undefined) {
        const n = Number(body.sortOrder);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          throw new DomainError(
            "INVALID_INPUT",
            "sortOrder må være ikke-negativt heltall.",
          );
        }
        patch.sortOrder = n;
      }

      const entry: GameCatalogEntry = await catalogService.update(id, patch, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, entry);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── Soft-deactivate ───────────────────────────────────────────────────

  router.delete("/api/admin/game-catalog/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME_CATALOG_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await catalogService.deactivate(id, {
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
      });
      apiSuccess(res, { deactivated: true });
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}
