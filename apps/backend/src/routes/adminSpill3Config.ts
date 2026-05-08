/**
 * Admin-router for Spill 3 (monsterbingo) global singleton-konfig
 * (Tobias-direktiv 2026-05-08).
 *
 * Endepunkter:
 *   GET /api/admin/spill3/config — hent aktiv config
 *   PUT /api/admin/spill3/config — oppdater (partial patch)
 *
 * Rolle-krav (gjenbruker GAME_CATALOG-permission siden dette er global
 * game-katalog-level konfig — ikke per hall, ikke per spilleplan-item):
 *   - GAME_CATALOG_READ:  ADMIN, HALL_OPERATOR, SUPPORT, AGENT
 *   - GAME_CATALOG_WRITE: ADMIN
 *
 * Wire-format: cents over wire (admin-UI konverterer til/fra kr).
 *
 * Audit: update skriver via Spill3ConfigService.update → AuditLogService
 * med "spill3.config.update"-event.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type {
  Spill3ConfigService,
  Spill3PrizeMode,
  UpdateSpill3ConfigInput,
} from "../game/Spill3ConfigService.js";
import { assertAdminPermission } from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-spill3-config" });

export interface AdminSpill3ConfigRouterDeps {
  platformService: PlatformService;
  spill3ConfigService: Spill3ConfigService;
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

function parseNullablePct(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et tall eller null.`);
  }
  // Behold desimaler (NUMERIC(5,2) i DB).
  return n;
}

function parsePrizeMode(value: unknown): Spill3PrizeMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "prizeMode må være en streng.");
  }
  const v = value.trim().toLowerCase();
  if (v !== "fixed" && v !== "percentage") {
    throw new DomainError("INVALID_INPUT", `prizeMode må være "fixed" eller "percentage".`);
  }
  return v;
}

export function createAdminSpill3ConfigRouter(
  deps: AdminSpill3ConfigRouterDeps,
): express.Router {
  const { platformService, spill3ConfigService } = deps;
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

  // ── GET /api/admin/spill3/config ────────────────────────────────────────

  router.get("/api/admin/spill3/config", async (req, res) => {
    try {
      await requirePermission(req, "GAME_CATALOG_READ");
      const config = await spill3ConfigService.getActive();
      apiSuccess(res, config);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  // ── PUT /api/admin/spill3/config ────────────────────────────────────────

  router.put("/api/admin/spill3/config", async (req, res) => {
    try {
      const user = await requirePermission(req, "GAME_CATALOG_WRITE");
      const body = req.body;
      if (!isRecordObject(body)) {
        throw new DomainError("INVALID_INPUT", "Request body må være et objekt.");
      }

      const update: UpdateSpill3ConfigInput = {
        updatedByUserId: user.id,
      };

      // Bygg partial-update kun fra felter som faktisk er sendt. Service-
      // laget validerer hver verdi (tall-grenser, prize-mode-konsistens
      // etter merge).
      const minTickets = parseOptionalInt(body.minTicketsToStart, "minTicketsToStart");
      if (minTickets !== undefined) update.minTicketsToStart = minTickets;

      const prizeMode = parsePrizeMode(body.prizeMode);
      if (prizeMode !== undefined) update.prizeMode = prizeMode;

      const rad1Cents = parseNullableInt(body.prizeRad1Cents, "prizeRad1Cents");
      if (rad1Cents !== undefined) update.prizeRad1Cents = rad1Cents;
      const rad2Cents = parseNullableInt(body.prizeRad2Cents, "prizeRad2Cents");
      if (rad2Cents !== undefined) update.prizeRad2Cents = rad2Cents;
      const rad3Cents = parseNullableInt(body.prizeRad3Cents, "prizeRad3Cents");
      if (rad3Cents !== undefined) update.prizeRad3Cents = rad3Cents;
      const rad4Cents = parseNullableInt(body.prizeRad4Cents, "prizeRad4Cents");
      if (rad4Cents !== undefined) update.prizeRad4Cents = rad4Cents;
      const fhCents = parseNullableInt(body.prizeFullHouseCents, "prizeFullHouseCents");
      if (fhCents !== undefined) update.prizeFullHouseCents = fhCents;

      const rad1Pct = parseNullablePct(body.prizeRad1Pct, "prizeRad1Pct");
      if (rad1Pct !== undefined) update.prizeRad1Pct = rad1Pct;
      const rad2Pct = parseNullablePct(body.prizeRad2Pct, "prizeRad2Pct");
      if (rad2Pct !== undefined) update.prizeRad2Pct = rad2Pct;
      const rad3Pct = parseNullablePct(body.prizeRad3Pct, "prizeRad3Pct");
      if (rad3Pct !== undefined) update.prizeRad3Pct = rad3Pct;
      const rad4Pct = parseNullablePct(body.prizeRad4Pct, "prizeRad4Pct");
      if (rad4Pct !== undefined) update.prizeRad4Pct = rad4Pct;
      const fhPct = parseNullablePct(body.prizeFullHousePct, "prizeFullHousePct");
      if (fhPct !== undefined) update.prizeFullHousePct = fhPct;

      const ticketPrice = parseOptionalInt(body.ticketPriceCents, "ticketPriceCents");
      if (ticketPrice !== undefined) update.ticketPriceCents = ticketPrice;

      const pause = parseOptionalInt(body.pauseBetweenRowsMs, "pauseBetweenRowsMs");
      if (pause !== undefined) update.pauseBetweenRowsMs = pause;

      const updated = await spill3ConfigService.update(update);
      apiSuccess(res, updated);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}
