/**
 * REQ-101/146: Agent manuell mini-game-trigger.
 *
 * I produksjon trigges mini-games automatisk av orchestrator etter
 * Fullt Hus (Game1MiniGameOrchestrator.maybeTriggerFor). Men for
 * pilot-haller trenger bingoverten et manuelt fallback når:
 *   - en mini-game-trigger feilet (audit "trigger_failed")
 *   - en spiller fikk Fullt Hus etter manuell ticket-utbetaling og
 *     mini-gamen ikke ble trigget automatisk
 *   - admin-config ble endret midt-runde og ny mini-game ønskes
 *
 * Endepunkt:
 *   POST /api/agent/game1/mini-game/trigger
 *     Body: { scheduledGameId, playerId, miniGameType }
 *
 * Sikkerhet:
 *   - RBAC: AGENT/HALL_OPERATOR/ADMIN
 *   - AGENT må ha aktiv shift, og scheduled-gamens master_hall_id eller
 *     ett av deltakende haller må matche shift.hallId. ADMIN bypasser
 *     hall-scope.
 *   - Spilleren må eksistere og ha hallId som matcher shift-hallen
 *     (ellers PLAYER_NOT_AT_HALL).
 *
 * Audit:
 *   - Manuelt trigget audit-event `agent.minigame.manual_trigger` skrives
 *     med `{ scheduledGameId, playerId, miniGameType, actorId,
 *     orchestratorResult }`.
 *   - Selve orchestrator-trigget audit-eventet (`game1_minigame.triggered`)
 *     skrives av Game1MiniGameOrchestrator.maybeTriggerFor.
 *
 * Notat: orchestrator's `maybeTriggerFor` har en `MYSTERY_FORCE_DEFAULT_FOR_TESTING`-
 * override som tvinger mystery uavhengig av input-type. Manuell trigger fra
 * agent gir derfor potensielt en annen type enn forespurt så lenge testing-
 * flagget er på. Vi logger både forespurt og faktisk type i audit.
 */

import express from "express";
import type { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { Game1MiniGameOrchestrator } from "../game/minigames/Game1MiniGameOrchestrator.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import { MINI_GAME_TYPES, type MiniGameType } from "../game/minigames/types.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-game1-minigame" });

export interface AgentGame1MiniGameRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  miniGameOrchestrator: Game1MiniGameOrchestrator;
  auditLogService: AuditLogService;
  pool: Pool;
  schema?: string;
}

interface ScheduledGameRow {
  id: string;
  master_hall_id: string;
  participating_halls_json: unknown;
  game_config_json: unknown;
  status: string;
}

interface PlayerRow {
  id: string;
  wallet_id: string;
  hall_id: string | null;
}

function parseHallIdsArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((x: unknown): x is string => typeof x === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

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

export function createAgentGame1MiniGameRouter(
  deps: AgentGame1MiniGameRouterDeps
): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    miniGameOrchestrator,
    auditLogService,
    pool,
  } = deps;
  const schema = (deps.schema ?? "public").trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  const scheduledGamesTable = `"${schema}"."app_game1_scheduled_games"`;
  const usersTable = `"${schema}"."app_users"`;

  const router = express.Router();

  /**
   * Bestem hall-scope for actor. AGENT må ha aktiv shift; HALL_OPERATOR må
   * ha tildelt hall; ADMIN bypasser scope (returnerer null).
   */
  async function resolveActorHallScope(
    user: PublicAppUser
  ): Promise<{ hallId: string | null; role: "AGENT" | "HALL_OPERATOR" | "ADMIN" }> {
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
      const shift = await agentShiftService.getCurrentShift(user.id);
      if (!shift) {
        throw new DomainError(
          "NO_ACTIVE_SHIFT",
          "Du må starte en shift før du kan trigge mini-games."
        );
      }
      return { hallId: shift.hallId, role: "AGENT" };
    }
    if (user.role === "HALL_OPERATOR") {
      if (!user.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Din bruker er ikke tildelt en hall — kontakt admin."
        );
      }
      return { hallId: user.hallId, role: "HALL_OPERATOR" };
    }
    if (user.role === "ADMIN") {
      return { hallId: null, role: "ADMIN" };
    }
    throw new DomainError(
      "FORBIDDEN",
      "Kun AGENT, HALL_OPERATOR og ADMIN har tilgang til mini-game-triggeren."
    );
  }

  async function loadScheduledGame(
    scheduledGameId: string
  ): Promise<ScheduledGameRow | null> {
    try {
      const { rows } = await pool.query<ScheduledGameRow>(
        `SELECT id, master_hall_id, participating_halls_json, game_config_json, status
           FROM ${scheduledGamesTable}
           WHERE id = $1
           LIMIT 1`,
        [scheduledGameId]
      );
      return rows[0] ?? null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        // Tabellen mangler (dev uten migrations).
        return null;
      }
      throw err;
    }
  }

  async function loadPlayer(playerId: string): Promise<PlayerRow | null> {
    try {
      const { rows } = await pool.query<PlayerRow>(
        `SELECT id, wallet_id, hall_id
           FROM ${usersTable}
           WHERE id = $1
           LIMIT 1`,
        [playerId]
      );
      return rows[0] ?? null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        return null;
      }
      throw err;
    }
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[agent-minigame] audit append failed");
    });
  }

  // ── POST /api/agent/game1/mini-game/trigger ──────────────────────────────

  router.post("/api/agent/game1/mini-game/trigger", async (req, res) => {
    try {
      const accessToken = getAccessTokenFromRequest(req);
      const user = await platformService.getUserFromAccessToken(accessToken);
      const scope = await resolveActorHallScope(user);

      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const scheduledGameId = mustBeNonEmptyString(req.body.scheduledGameId, "scheduledGameId");
      const playerId = mustBeNonEmptyString(req.body.playerId, "playerId");
      const miniGameTypeRaw = mustBeNonEmptyString(req.body.miniGameType, "miniGameType");
      const miniGameType = miniGameTypeRaw as MiniGameType;
      if (!(MINI_GAME_TYPES as readonly string[]).includes(miniGameType)) {
        throw new DomainError(
          "INVALID_INPUT",
          `miniGameType må være én av: ${MINI_GAME_TYPES.join(", ")}.`
        );
      }

      // Hent scheduled-game + sjekk hall-scope.
      const scheduled = await loadScheduledGame(scheduledGameId);
      if (!scheduled) {
        throw new DomainError(
          "SCHEDULED_GAME_NOT_FOUND",
          "Spillet finnes ikke."
        );
      }
      const participatingHallIds = parseHallIdsArray(
        scheduled.participating_halls_json
      );
      if (scope.hallId !== null) {
        const isInScope =
          scheduled.master_hall_id === scope.hallId ||
          participatingHallIds.includes(scope.hallId);
        if (!isInScope) {
          throw new DomainError(
            "FORBIDDEN",
            "Spillet er ikke for din hall."
          );
        }
      }

      // Hent spiller + sjekk hall-tilhørighet (kun for AGENT/HALL_OPERATOR).
      const player = await loadPlayer(playerId);
      if (!player) {
        throw new DomainError("USER_NOT_FOUND", "Spiller finnes ikke.");
      }
      if (scope.hallId !== null) {
        // Spilleren må være tilknyttet en hall som er med i spillet
        // (master eller deltakende). Vi tillater alle deltakende haller,
        // ikke bare agentens egen, fordi multi-hall-spill kan ha vinner i
        // annen hall — men kun en agent fra samme hall som spillet kan
        // trigge.
        const playerInGame =
          player.hall_id !== null &&
          (player.hall_id === scheduled.master_hall_id ||
            participatingHallIds.includes(player.hall_id));
        if (!playerInGame) {
          throw new DomainError(
            "PLAYER_NOT_AT_HALL",
            "Spilleren er ikke tilknyttet noen av hallene i dette spillet."
          );
        }
      }

      // Forced gameConfigJson som inkluderer kun forespurt mini-game-type
      // — slik at orchestrator velger denne (ikke admin-config-rotasjonen).
      // Merk: orchestrator har en testing-override som kan velge "mystery"
      // uavhengig av input når den er aktivert. Vi logger requested-type
      // separat i audit slik at det er sporbart.
      const forcedConfig = {
        spill1: {
          miniGames: [miniGameType],
        },
      } as const;

      // Bestem hallId for orchestrator-context: prioriter spillerens
      // hall_id (samsvarer med vinner-perspektivet i auto-trigger), faller
      // tilbake til scheduled.master_hall_id hvis spiller er hall-løs.
      const winnerHallId = player.hall_id ?? scheduled.master_hall_id;

      const result = await miniGameOrchestrator.maybeTriggerFor({
        scheduledGameId: scheduled.id,
        winnerUserId: player.id,
        winnerWalletId: player.wallet_id,
        hallId: winnerHallId,
        // Manuell trigger har ingen tilknyttet draw-sequence —
        // settings 0 er semantisk "ingen draw" (orchestrator bruker dette
        // kun for audit-logging).
        drawSequenceAtWin: 0,
        gameConfigJson: forcedConfig,
      });

      fireAudit({
        actorId: user.id,
        actorType:
          user.role === "ADMIN"
            ? "ADMIN"
            : user.role === "AGENT"
              ? "AGENT"
              : user.role === "HALL_OPERATOR"
                ? "HALL_OPERATOR"
                : "SYSTEM",
        action: "agent.minigame.manual_trigger",
        resource: "scheduled_game",
        resourceId: scheduled.id,
        details: {
          scheduledGameId: scheduled.id,
          playerId: player.id,
          requestedMiniGameType: miniGameType,
          actualMiniGameType: result.miniGameType,
          triggered: result.triggered,
          resultId: result.resultId,
          reason: result.reason ?? null,
          actorRole: scope.role,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, {
        triggered: result.triggered,
        resultId: result.resultId,
        miniGameType: result.miniGameType,
        requestedMiniGameType: miniGameType,
        reason: result.reason ?? null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
