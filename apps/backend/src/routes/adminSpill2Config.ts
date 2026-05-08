/**
 * Admin-router for Spill 2 (rocket / Tallspill) global singleton-konfig
 * (Tobias-direktiv 2026-05-08, parallel til Spill 3).
 *
 * Endepunkter:
 *   GET /api/admin/spill2/config — hent aktiv config
 *   PUT /api/admin/spill2/config — oppdater (partial patch)
 *
 * Rolle-krav (gjenbruker GAME_CATALOG-permission siden dette er global
 * game-katalog-level konfig — ikke per hall, ikke per spilleplan-item):
 *   - GAME_CATALOG_READ:  ADMIN, HALL_OPERATOR, SUPPORT, AGENT
 *   - GAME_CATALOG_WRITE: ADMIN
 *
 * Wire-format:
 *   - cents over wire (admin-UI konverterer til/fra kr)
 *   - opening-times som "HH:MM"-strenger eller null
 *   - jackpotNumberTable som objekt med 6 keys (9, 10, 11, 12, 13, 1421)
 *
 * Audit: update skriver via Spill2ConfigService.update → AuditLogService
 * med "spill2.config.update"-event.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type {
  Spill2ConfigService,
  Spill2JackpotTable,
  UpdateSpill2ConfigInput,
} from "../game/Spill2ConfigService.js";
import { assertJackpotTable } from "../game/Spill2ConfigService.js";
import { assertAdminPermission } from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-spill2-config" });

export interface AdminSpill2ConfigRouterDeps {
  platformService: PlatformService;
  spill2ConfigService: Spill2ConfigService;
}

function parseOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    throw new DomainError("INVALID_INPUT", `${field} kan ikke være null.`);
  }
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et tall.`);
  }
  return Math.floor(n);
}

function parseNullableInt(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et tall eller null.`);
  }
  return Math.floor(n);
}

function parseNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være en streng eller null.`);
  }
  return value;
}

function parseOptionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    // Aksepter "true"/"false"-strenger fra form-body for robusthet.
    if (value === "true") return true;
    if (value === "false") return false;
    throw new DomainError("INVALID_INPUT", `${field} må være boolean.`);
  }
  return value;
}

function parseOptionalJackpotTable(
  value: unknown,
  field: string,
): Spill2JackpotTable | undefined {
  if (value === undefined) return undefined;
  // assertJackpotTable kaster INVALID_INPUT med presis melding hvis feil.
  return assertJackpotTable(value);
}

export function createAdminSpill2ConfigRouter(
  deps: AdminSpill2ConfigRouterDeps,
): express.Router {
  const { platformService, spill2ConfigService } = deps;
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

  // ── GET /api/admin/spill2/config ────────────────────────────────────────

  router.get("/api/admin/spill2/config", async (req, res) => {
    try {
      await requirePermission(req, "GAME_CATALOG_READ");
      const config = await spill2ConfigService.getActive();
      apiSuccess(res, config);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── PUT /api/admin/spill2/config ────────────────────────────────────────

  router.put("/api/admin/spill2/config", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME_CATALOG_WRITE");
      const body = req.body;
      if (!isRecordObject(body)) {
        throw new DomainError("INVALID_INPUT", "Request body må være et objekt.");
      }

      const update: UpdateSpill2ConfigInput = {
        updatedByUserId: user.id,
      };

      // Bygg partial-update kun fra felter som faktisk er sendt. Service-
      // laget validerer hver verdi (tall-grenser, åpningstid-format,
      // jackpot-shape, lucky-number-konsistens etter merge).
      const startTime = parseNullableString(body.openingTimeStart, "openingTimeStart");
      if (startTime !== undefined) update.openingTimeStart = startTime;

      const endTime = parseNullableString(body.openingTimeEnd, "openingTimeEnd");
      if (endTime !== undefined) update.openingTimeEnd = endTime;

      const minTickets = parseOptionalInt(body.minTicketsToStart, "minTicketsToStart");
      if (minTickets !== undefined) update.minTicketsToStart = minTickets;

      const ticketPrice = parseOptionalInt(body.ticketPriceCents, "ticketPriceCents");
      if (ticketPrice !== undefined) update.ticketPriceCents = ticketPrice;

      const roundPause = parseOptionalInt(body.roundPauseMs, "roundPauseMs");
      if (roundPause !== undefined) update.roundPauseMs = roundPause;

      const ballInterval = parseOptionalInt(body.ballIntervalMs, "ballIntervalMs");
      if (ballInterval !== undefined) update.ballIntervalMs = ballInterval;

      const jackpotTable = parseOptionalJackpotTable(
        body.jackpotNumberTable,
        "jackpotNumberTable",
      );
      if (jackpotTable !== undefined) update.jackpotNumberTable = jackpotTable;

      const luckyEnabled = parseOptionalBool(body.luckyNumberEnabled, "luckyNumberEnabled");
      if (luckyEnabled !== undefined) update.luckyNumberEnabled = luckyEnabled;

      const luckyPrize = parseNullableInt(
        body.luckyNumberPrizeCents,
        "luckyNumberPrizeCents",
      );
      if (luckyPrize !== undefined) update.luckyNumberPrizeCents = luckyPrize;

      const updated = await spill2ConfigService.update(update);
      apiSuccess(res, updated);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}

// Suppress unused warning for logger when no log statements remain (kept
// for future debug-tracing).
void logger;
