/**
 * Agent IJ — Admin-router for Spill 1 akkumulerende pot-er (Innsatsen + Jackpott).
 *
 * Eksponerer hall-scopet pot-administrasjon slik at admin-UI kan:
 *   - lese current pot-saldo per hall (dashboard / schedule-listing)
 *   - editere pot-config (terskel, target, seed, dailyBoost, sale-andel)
 *   - resette pot manuelt ("admin-override", skriver reset-event i audit-log)
 *
 * Endepunkter:
 *   GET    /api/admin/halls/:hallId/game1-pots
 *   GET    /api/admin/halls/:hallId/game1-pots/:potKey
 *   POST   /api/admin/halls/:hallId/game1-pots  (getOrInit — brukes ved konfigurering
 *                                                 av ny pot per hall)
 *   PATCH  /api/admin/halls/:hallId/game1-pots/:potKey/config
 *   POST   /api/admin/halls/:hallId/game1-pots/:potKey/reset
 *
 * Rolle-krav: HALL_GAME_CONFIG_READ / HALL_GAME_CONFIG_WRITE (matches prize-policy-
 * og hall-game-config-pattern). HALL_OPERATOR har hall-scope — må spørre om egen hall.
 *
 * AuditLog: admin.game1_pot.{config_update,reset}. Init-eventet skrives av
 * Game1PotService.getOrInitPot selv (pot_events-tabell + admin-audit fra route).
 *
 * Legacy-kontekst:
 *   Innsatsen-potten i legacy lå på DailySchedule.innsatsenSales som en enkelt
 *   akkumulerende counter; jackpot-terskel (`jackpotDraw`) lå på hvert sub-game.
 *   Ny stack normaliserer dette til `app_game1_accumulating_pots` per
 *   (hallId, potKey) — flere pot-er kan kjøre parallelt (Innsatsen, Jackpott,
 *   ev. custom). Per-sub-game-terskel speiles fortsatt i
 *   schedule.subGames[*].jackpotData.jackpotDraw (bevart via ScheduleService).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  Game1PotService,
  PotConfig,
  PotRow,
  PotType,
  PotWinRule,
} from "../game/pot/Game1PotService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game1-pots" });

export interface AdminGame1PotsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  potService: Game1PotService;
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

function parsePotType(value: unknown): PotType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "potType må være en streng.");
  }
  const v = value as PotType;
  if (v !== "innsatsen" && v !== "jackpott" && v !== "generic") {
    throw new DomainError(
      "INVALID_INPUT",
      "potType må være én av innsatsen, jackpott, generic."
    );
  }
  return v;
}

function parseWinRule(value: unknown): PotWinRule {
  if (!isRecordObject(value)) {
    throw new DomainError("INVALID_INPUT", "winRule må være et objekt.");
  }
  const kind = value.kind;
  if (kind === "phase_at_or_before_draw") {
    const phase = Number(value.phase);
    const drawThreshold = Number(value.drawThreshold);
    if (!Number.isInteger(phase) || phase < 1 || phase > 5) {
      throw new DomainError("INVALID_INPUT", "winRule.phase må være 1..5.");
    }
    if (
      !Number.isInteger(drawThreshold) ||
      drawThreshold < 1 ||
      drawThreshold > 75
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "winRule.drawThreshold må være 1..75."
      );
    }
    return { kind, phase, drawThreshold };
  }
  if (kind === "progressive_threshold") {
    const phase = Number(value.phase);
    if (!Number.isInteger(phase) || phase < 1 || phase > 5) {
      throw new DomainError("INVALID_INPUT", "winRule.phase må være 1..5.");
    }
    if (!Array.isArray(value.thresholdLadder)) {
      throw new DomainError(
        "INVALID_INPUT",
        "winRule.thresholdLadder må være en array."
      );
    }
    const ladder = value.thresholdLadder.map((v) => Number(v));
    return { kind, phase, thresholdLadder: ladder };
  }
  throw new DomainError(
    "INVALID_INPUT",
    "winRule.kind må være phase_at_or_before_draw eller progressive_threshold."
  );
}

function parseConfig(value: unknown): PotConfig {
  if (!isRecordObject(value)) {
    throw new DomainError("INVALID_INPUT", "config må være et objekt.");
  }
  const cfg: PotConfig = {
    seedAmountCents: Number(value.seedAmountCents),
    dailyBoostCents: Number(value.dailyBoostCents),
    salePercentBps: Number(value.salePercentBps),
    maxAmountCents:
      value.maxAmountCents === null
        ? null
        : value.maxAmountCents === undefined
          ? null
          : Number(value.maxAmountCents),
    winRule: parseWinRule(value.winRule),
    ticketColors: Array.isArray(value.ticketColors)
      ? value.ticketColors.filter((c): c is string => typeof c === "string")
      : [],
  };
  const potType = parsePotType(value.potType);
  if (potType !== undefined) cfg.potType = potType;
  if (value.drawThresholdLower !== undefined && value.drawThresholdLower !== null) {
    cfg.drawThresholdLower = Number(value.drawThresholdLower);
  }
  if (value.targetAmountCents !== undefined && value.targetAmountCents !== null) {
    cfg.targetAmountCents = Number(value.targetAmountCents);
  }
  return cfg;
}

/** Sanitiser pot → wire-shape. Ingen deleted_at/internal-felter (ingen slike i PotRow). */
function toWire(row: PotRow): PotRow {
  return row;
}

export function createAdminGame1PotsRouter(
  deps: AdminGame1PotsRouterDeps
): express.Router {
  const { platformService, auditLogService, potService } = deps;
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
      logger.warn({ err, action: event.action }, "[IJ] audit append failed");
    });
  }

  // ── Read: list all pots for hall ─────────────────────────────────────

  router.get("/api/admin/halls/:hallId/game1-pots", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_GAME_CONFIG_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      const rows = await potService.listPotsForHall(hallId);
      apiSuccess(res, {
        pots: rows.map(toWire),
        count: rows.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Read: single pot ─────────────────────────────────────────────────

  router.get("/api/admin/halls/:hallId/game1-pots/:potKey", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_GAME_CONFIG_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const potKey = mustBeNonEmptyString(req.params.potKey, "potKey");
      assertUserHallScope(actor, hallId);
      const row = await potService.loadPot(hallId, potKey);
      if (!row) {
        throw new DomainError("POT_NOT_FOUND", `Pot ikke funnet (${hallId}, ${potKey}).`);
      }
      apiSuccess(res, toWire(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Create: init new pot ─────────────────────────────────────────────

  router.post("/api/admin/halls/:hallId/game1-pots", async (req, res) => {
    try {
      const actor = await requirePermission(req, "HALL_GAME_CONFIG_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const potKey = mustBeNonEmptyString(req.body.potKey, "potKey");
      const displayName = mustBeNonEmptyString(req.body.displayName, "displayName");
      const config = parseConfig(req.body.config);
      const row = await potService.getOrInitPot({
        hallId,
        potKey,
        displayName,
        config,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.game1_pot.init",
        resource: "game1_accumulating_pot",
        resourceId: row.id,
        details: {
          hallId,
          potKey,
          displayName,
          potType: config.potType ?? "generic",
          seedAmountCents: config.seedAmountCents,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, toWire(row));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Update: pot config ───────────────────────────────────────────────

  router.patch(
    "/api/admin/halls/:hallId/game1-pots/:potKey/config",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "HALL_GAME_CONFIG_WRITE");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        const potKey = mustBeNonEmptyString(req.params.potKey, "potKey");
        assertUserHallScope(actor, hallId);
        if (!isRecordObject(req.body)) {
          throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
        }
        const config = parseConfig(req.body.config);
        const row = await potService.updateConfig({ hallId, potKey, config });
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.game1_pot.config_update",
          resource: "game1_accumulating_pot",
          resourceId: row.id,
          details: {
            hallId,
            potKey,
            potType: config.potType ?? "generic",
            winRuleKind: config.winRule.kind,
            drawThresholdLower: config.drawThresholdLower ?? null,
            targetAmountCents: config.targetAmountCents ?? null,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        apiSuccess(res, toWire(row));
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  // ── Admin reset ──────────────────────────────────────────────────────

  router.post(
    "/api/admin/halls/:hallId/game1-pots/:potKey/reset",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "HALL_GAME_CONFIG_WRITE");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        const potKey = mustBeNonEmptyString(req.params.potKey, "potKey");
        assertUserHallScope(actor, hallId);
        const body = isRecordObject(req.body) ? req.body : {};
        const reason = mustBeNonEmptyString(body.reason, "reason");
        const result = await potService.resetPot({
          hallId,
          potKey,
          reason,
          actorUserId: actor.id,
        });
        fireAudit({
          actorId: actor.id,
          actorType: actorTypeFromRole(actor.role),
          action: "admin.game1_pot.reset",
          resource: "game1_accumulating_pot",
          resourceId: result.eventId,
          details: {
            hallId,
            potKey,
            reason,
            newBalanceCents: result.newBalanceCents,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        apiSuccess(res, result);
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  return router;
}
