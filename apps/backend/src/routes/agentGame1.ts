/**
 * Task 1.4 (2026-04-24): agent-portal Spill 1 unified-control router.
 *
 * Forener agent-portal + master-konsoll mot `app_game1_scheduled_games`-
 * paradigmet. I dag bruker `NextGamePanel.ts` room-kode + in-memory
 * BingoEngine, mens master-konsollet styrer Spill 1 via scheduled_game_id.
 * Resultatet er at agent ikke kan trigge Spill 1-runder uten å gå via
 * master-konsollet.
 *
 * Dette router-laget eksponerer et tynt agent-scope-view over de samme
 * backend-tjenestene som master-konsollet bruker. Spill 2/3 (rocket /
 * monsterbingo) berøres ikke — de kjører fortsatt via room-code-flyten
 * i `NextGamePanel`.
 *
 * Endepunkter:
 *   GET  /api/agent/game1/current-game
 *     Returnerer aktivt scheduled_game for agentens hall (master_hall_id
 *     ELLER i participating_halls_json). Inkluderer hall-status for alle
 *     deltakende haller og flagg `isMasterAgent` som styrer om start/
 *     resume-knapper vises i UI.
 *   POST /api/agent/game1/start
 *     Delegerer til `Game1MasterControlService.startGame` hvis agent er i
 *     master-hall. Ikke-master-agent får 403.
 *   POST /api/agent/game1/resume
 *     Delegerer til `resumeGame` — samme scope-regler.
 *   GET  /api/agent/game1/hall-status
 *     Gjenbruker `Game1HallReadyService.getReadyStatusForGame` for å gi
 *     agent-portalens hall-badge-stripe samme datakilde som master-
 *     konsollet.
 *
 * Rolle-krav:
 *   Alle endepunkter bruker permission `GAME1_MASTER_WRITE`
 *   (ADMIN + HALL_OPERATOR + AGENT, SUPPORT utelatt) — samme som
 *   master-routen. Forskjellen er at agent-routen alltid bruker
 *   agentens egen `hallId` som scope-utgangspunkt og returnerer 403 hvis
 *   agent prøver å starte fra en ikke-master-hall.
 *
 * Audit: writes går via `masterControlService`, som allerede skriver
 *   `app_game1_master_audit`-rader for start/resume/timeout osv.
 */

import express from "express";
import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type {
  Game1MasterControlService,
  MasterActor,
} from "../game/Game1MasterControlService.js";
import type { Game1HallReadyService } from "../game/Game1HallReadyService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-game1" });

export interface AgentGame1RouterDeps {
  platformService: PlatformService;
  masterControlService: Game1MasterControlService;
  hallReadyService: Game1HallReadyService;
  pool: Pool;
  schema?: string;
}

interface ActiveGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
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

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Bygg MasterActor-objekt for agent-rollen. Agent-routen krever alltid at
 * actor har `hallId` — unkjown-hall faller tilbake til 403 allerede før
 * service-laget kalles.
 */
function buildAgentActor(user: PublicAppUser): MasterActor {
  if (user.role === "ADMIN") {
    return {
      userId: user.id,
      hallId: user.hallId ?? "ADMIN_CONSOLE",
      role: "ADMIN",
    };
  }
  if (user.role === "HALL_OPERATOR" || user.role === "AGENT") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin."
      );
    }
    return {
      userId: user.id,
      hallId: user.hallId,
      role: user.role,
    };
  }
  throw new DomainError(
    "FORBIDDEN",
    "Rollen din har ikke tilgang til agent-Spill 1-actions."
  );
}

/**
 * Returner hallId som "agent scope". ADMIN kan overstyre via query-param
 * `?hallId=<id>` (f.eks. fra admin-console), men må ellers peke på sin
 * tildelte hall. HALL_OPERATOR/AGENT lock-scoped til `user.hallId`.
 */
function resolveHallScope(
  user: PublicAppUser,
  queryHallId: string | undefined
): string {
  if (user.role === "ADMIN") {
    if (queryHallId && queryHallId.trim().length > 0) {
      return queryHallId.trim();
    }
    if (user.hallId) return user.hallId;
    throw new DomainError(
      "INVALID_INPUT",
      "ADMIN må angi ?hallId for agent-scope (egen hallId ikke satt)."
    );
  }
  if (!user.hallId) {
    throw new DomainError(
      "FORBIDDEN",
      "Din bruker er ikke tildelt en hall — kontakt admin."
    );
  }
  return user.hallId;
}

export function createAgentGame1Router(
  deps: AgentGame1RouterDeps
): express.Router {
  const { platformService, masterControlService, hallReadyService, pool } = deps;
  const schema = (deps.schema ?? "public").trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  const scheduledGamesTable = `"${schema}"."app_game1_scheduled_games"`;

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

  /**
   * Finn "aktivt" scheduled_game for gitt hall. Prioritet:
   *   1. running / paused / ready_to_start / purchase_open (ikke completed)
   *      sortert med nærmeste scheduled_start først (latest scheduled).
   * Returnerer null hvis ingen aktiv rad.
   */
  async function findActiveGameForHall(
    hallId: string
  ): Promise<ActiveGameRow | null> {
    try {
      const { rows } = await pool.query<ActiveGameRow>(
        `SELECT id, status, master_hall_id, group_hall_id,
                participating_halls_json, sub_game_name, custom_game_name,
                scheduled_start_time, scheduled_end_time,
                actual_start_time, actual_end_time
           FROM ${scheduledGamesTable}
           WHERE (master_hall_id = $1
              OR participating_halls_json::jsonb @> to_jsonb($1::text))
             AND status IN ('purchase_open','ready_to_start','running','paused')
           ORDER BY scheduled_start_time ASC
           LIMIT 1`,
        [hallId]
      );
      return rows[0] ?? null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        // Tabellen/kolonnen mangler (dev uten migrations) — tolk som
        // "ingen aktiv runde". Agent-portal får tom-state.
        logger.debug(
          { hallId, code },
          "scheduled-games table missing; returning null"
        );
        return null;
      }
      throw err;
    }
  }

  // ── GET /api/agent/game1/current-game ────────────────────────────────────

  router.get("/api/agent/game1/current-game", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const queryHallId =
        typeof req.query.hallId === "string" ? req.query.hallId : undefined;
      const hallId = resolveHallScope(actor, queryHallId);

      const active = await findActiveGameForHall(hallId);
      if (!active) {
        apiSuccess(res, {
          hallId,
          currentGame: null,
          isMasterAgent: false,
          halls: [],
          allReady: false,
        });
        return;
      }

      const isMasterAgent =
        actor.role === "ADMIN" || hallId === active.master_hall_id;

      const halls = await hallReadyService.getReadyStatusForGame(active.id);
      const allReady = await hallReadyService.allParticipatingHallsReady(
        active.id
      );

      // Berik hall-list med hall-name (soft-fail hvis ukjent).
      const hallsWithName = await Promise.all(
        halls.map(async (h) => {
          let hallName = h.hallId;
          try {
            const hall = await platformService.getHall(h.hallId);
            hallName = hall.name;
          } catch {
            // soft-fail
          }
          return {
            hallId: h.hallId,
            hallName,
            isReady: h.isReady,
            readyAt: h.readyAt,
            digitalTicketsSold: h.digitalTicketsSold,
            physicalTicketsSold: h.physicalTicketsSold,
            excludedFromGame: h.excludedFromGame,
            excludedReason: h.excludedReason,
          };
        })
      );

      apiSuccess(res, {
        hallId,
        isMasterAgent,
        currentGame: {
          id: active.id,
          status: active.status,
          masterHallId: active.master_hall_id,
          groupHallId: active.group_hall_id,
          participatingHallIds: parseHallIdsArray(
            active.participating_halls_json
          ),
          subGameName: active.sub_game_name,
          customGameName: active.custom_game_name,
          scheduledStartTime: toIso(active.scheduled_start_time),
          scheduledEndTime: toIso(active.scheduled_end_time),
          actualStartTime: toIso(active.actual_start_time),
          actualEndTime: toIso(active.actual_end_time),
        },
        halls: hallsWithName,
        allReady,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/game1/start ──────────────────────────────────────────

  router.post("/api/agent/game1/start", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      // Slipper SUPPORT allerede i requirePermission (ikke i GAME1_MASTER_WRITE).
      const hallId = resolveHallScope(actor, undefined);
      const active = await findActiveGameForHall(hallId);
      if (!active) {
        throw new DomainError(
          "NO_ACTIVE_GAME",
          "Ingen aktiv Spill 1-runde for din hall akkurat nå."
        );
      }

      const isMasterAgent =
        actor.role === "ADMIN" || hallId === active.master_hall_id;
      if (!isMasterAgent) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan starte runden. Din hall er deltaker, ikke master."
        );
      }

      const masterActor = buildAgentActor(actor);
      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const confirmExcludedHalls = Array.isArray(body.confirmExcludedHalls)
        ? body.confirmExcludedHalls.filter(
            (v: unknown): v is string => typeof v === "string"
          )
        : undefined;
      // REQ-007 (2026-04-26): master kan overstyre "agents not ready"-popup
      // ved å sende `confirmUnreadyHalls`. Backend ekskluderer disse hallene
      // og logger `start_game_with_unready_override`-audit.
      const confirmUnreadyHalls = Array.isArray(body.confirmUnreadyHalls)
        ? body.confirmUnreadyHalls.filter(
            (v: unknown): v is string => typeof v === "string"
          )
        : undefined;

      const startInput: Parameters<Game1MasterControlService["startGame"]>[0] =
        {
          gameId: active.id,
          actor: masterActor,
        };
      if (confirmExcludedHalls !== undefined) {
        startInput.confirmExcludedHalls = confirmExcludedHalls;
      }
      if (confirmUnreadyHalls !== undefined) {
        startInput.confirmUnreadyHalls = confirmUnreadyHalls;
      }
      const result = await masterControlService.startGame(startInput);

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        actualStartTime: result.actualStartTime,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/game1/resume ─────────────────────────────────────────

  router.post("/api/agent/game1/resume", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const active = await findActiveGameForHall(hallId);
      if (!active) {
        throw new DomainError(
          "NO_ACTIVE_GAME",
          "Ingen aktiv Spill 1-runde for din hall akkurat nå."
        );
      }

      const isMasterAgent =
        actor.role === "ADMIN" || hallId === active.master_hall_id;
      if (!isMasterAgent) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan resume runden."
        );
      }

      const masterActor = buildAgentActor(actor);
      const result = await masterControlService.resumeGame({
        gameId: active.id,
        actor: masterActor,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/game1/stop ───────────────────────────────────────────
  // 2026-05-02: master-agent stopper aktiv runde fra cash-inout-dashboardet.
  // Delegerer til Game1MasterControlService.stopGame med master-actor-bygging.

  router.post("/api/agent/game1/stop", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const hallId = resolveHallScope(actor, undefined);
      const active = await findActiveGameForHall(hallId);
      if (!active) {
        throw new DomainError(
          "NO_ACTIVE_GAME",
          "Ingen aktiv Spill 1-runde for din hall akkurat nå."
        );
      }

      const isMasterAgent =
        actor.role === "ADMIN" || hallId === active.master_hall_id;
      if (!isMasterAgent) {
        throw new DomainError(
          "FORBIDDEN",
          "Kun master-hallens agent kan stoppe runden."
        );
      }

      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : "Stoppet fra cash-inout-dashboard";

      const masterActor = buildAgentActor(actor);
      const result = await masterControlService.stopGame({
        gameId: active.id,
        actor: masterActor,
        reason,
      });

      apiSuccess(res, {
        gameId: result.gameId,
        status: result.status,
        actualEndTime: result.actualEndTime,
        auditId: result.auditId,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/game1/hall-status ─────────────────────────────────────

  router.get("/api/agent/game1/hall-status", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const queryHallId =
        typeof req.query.hallId === "string" ? req.query.hallId : undefined;
      const hallId = resolveHallScope(actor, queryHallId);
      const active = await findActiveGameForHall(hallId);
      if (!active) {
        apiSuccess(res, { hallId, gameId: null, halls: [], allReady: false });
        return;
      }

      const halls = await hallReadyService.getReadyStatusForGame(active.id);
      const allReady = await hallReadyService.allParticipatingHallsReady(
        active.id
      );
      const hallsWithName = await Promise.all(
        halls.map(async (h) => {
          let hallName = h.hallId;
          try {
            const hall = await platformService.getHall(h.hallId);
            hallName = hall.name;
          } catch {
            // soft-fail
          }
          return {
            hallId: h.hallId,
            hallName,
            isReady: h.isReady,
            excludedFromGame: h.excludedFromGame,
            digitalTicketsSold: h.digitalTicketsSold,
            physicalTicketsSold: h.physicalTicketsSold,
          };
        })
      );

      apiSuccess(res, {
        hallId,
        gameId: active.id,
        halls: hallsWithName,
        allReady,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
