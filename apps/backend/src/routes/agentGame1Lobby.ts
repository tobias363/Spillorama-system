/**
 * Bølge 1 (2026-05-08): kanonisk Spill 1 lobby-endpoint for master-/agent-
 * konsoll. Eksponerer `GameLobbyAggregator` via en enkelt GET-route.
 *
 * Mandat (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.2):
 *   `GET /api/agent/game1/lobby?hallId=X` → Spill1AgentLobbyState
 *
 * RBAC: `GAME1_MASTER_WRITE` — samme som eksisterende
 *   `/api/agent/game1/current-game` så ingen RBAC-graf-endring kreves.
 *   ADMIN + HALL_OPERATOR + AGENT har tilgang. SUPPORT er utelatt.
 *
 * Hall-scope: HALL_OPERATOR/AGENT er låst til egen `hallId` (cross-hall
 *   query → 403 FORBIDDEN). ADMIN kan overstyre via `?hallId`-param.
 *
 * Cache: ingen cache-headere — state endrer seg fort, og UI poller
 *   eksplisitt med 2-10s mellomrom. `Cache-Control: no-cache, max-age=0`
 *   settes så ingen mellomliggende proxy-er beholder gammel state.
 *
 * Audit-logging: Aggregator er pure read; ingen writes audit-log-event
 *   ved 200-respons. 401/403/INVALID_INPUT logges via standard
 *   `apiFailure`-helper.
 *
 * Bakover-kompatibilitet:
 *   Eksisterende endpoints (`/api/agent/game1/current-game`,
 *   `/api/agent/game-plan/current`) er IKKE påvirket. UI bytter til ny
 *   endpoint i Bølge 3.
 */

import express from "express";
import { Spill1AgentLobbyStateSchema } from "@spillorama/shared-types";
import { DomainError } from "../errors/DomainError.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { GameLobbyAggregator, LobbyActorContext } from "../game/GameLobbyAggregator.js";
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

const logger = rootLogger.child({ module: "agent-game1-lobby" });

export interface AgentGame1LobbyRouterDeps {
  platformService: PlatformService;
  aggregator: GameLobbyAggregator;
}

/**
 * Resolve hall-scope identisk med agentGame1.ts. ADMIN kan overstyre via
 * `?hallId` (default fall back til user.hallId). HALL_OPERATOR/AGENT er
 * låst til user.hallId — cross-hall query returnerer 403.
 *
 * Vi avviser ikke ADMIN uten hallId her — i stedet bruker vi en
 * empty-state-respons (samme strategi som agentGamePlan.ts:343-380, hvor
 * read-only polling ikke skal støye Sentry).
 */
function resolveHallScope(
  user: PublicAppUser,
  queryHallId: string | undefined,
): string | null {
  if (user.role === "ADMIN") {
    if (queryHallId && queryHallId.trim().length > 0) {
      return queryHallId.trim();
    }
    if (user.hallId) return user.hallId;
    // Soft-fail: read-only polling for ADMIN uten hallId returnerer null
    // (caller bygger empty-state-respons).
    return null;
  }
  if (user.role === "HALL_OPERATOR" || user.role === "AGENT") {
    if (!user.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin.",
      );
    }
    if (
      queryHallId &&
      queryHallId.trim().length > 0 &&
      queryHallId.trim() !== user.hallId
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "Du kan kun lese lobby for din egen hall.",
      );
    }
    return user.hallId;
  }
  // SUPPORT/PLAYER er allerede utestengt av assertAdminPermission, men
  // defensiv:
  throw new DomainError(
    "FORBIDDEN",
    "Rollen din har ikke tilgang til Spill 1 lobby.",
  );
}

/**
 * Bygg `LobbyActorContext` for aggregator. Drives `isMasterAgent`-flagget
 * i responsen.
 */
function buildActorContext(user: PublicAppUser): LobbyActorContext {
  return {
    role: user.role,
    hallId: user.hallId ?? null,
  };
}

export function createAgentGame1LobbyRouter(
  deps: AgentGame1LobbyRouterDeps,
): express.Router {
  const { platformService, aggregator } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user, permission);
    return user;
  }

  // ── GET /api/agent/game1/lobby?hallId=X ────────────────────────────────

  router.get("/api/agent/game1/lobby", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_MASTER_WRITE");
      const queryHallId =
        typeof req.query.hallId === "string" ? req.query.hallId : undefined;

      const hallId = resolveHallScope(actor, queryHallId);

      // Soft-fail empty-state for ADMIN uten hallId (samme strategi som
      // agentGamePlan.ts §343-380). Frontend rendrer "velg hall først"-state.
      if (hallId === null) {
        const emptyState = {
          hallId: null,
          hallName: null,
          businessDate: null,
          generatedAt: new Date().toISOString(),
          currentScheduledGameId: null,
          planMeta: null,
          scheduledGameMeta: null,
          halls: [] as never[],
          allHallsReady: false,
          masterHallId: null,
          groupOfHallsId: null,
          isMasterAgent: false,
          nextScheduledStartTime: null,
          inconsistencyWarnings: [] as never[],
        };
        // Code-review (PR #1050) funn 5: validér payload mot Zod-skjemaet
        // før wire. Fanger typos, manglende felter og kontrakt-skew der
        // backend driver UI-en uten Bølge 3-frontend-validering.
        const parsed = Spill1AgentLobbyStateSchema.safeParse(emptyState);
        if (!parsed.success) {
          logger.error(
            { issues: parsed.error.issues },
            "[lobby-route] empty-state failed Zod validation — backend bug",
          );
          res.status(500).json({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Lobby empty-state schema-validation failed",
            },
          });
          return;
        }
        apiSuccess(res, parsed.data);
        return;
      }

      const actorContext = buildActorContext(actor);

      const state = await aggregator.getLobbyState(hallId, actorContext);

      // Cache-Control: never-stale. UI poller eksplisitt; ingen
      // intermediær cache skal returnere stale state etter master-action.
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

      // Code-review (PR #1050) funn 5: validér aggregator-respons mot
      // Zod-skjemaet før wire. Fanger drift mellom Spill1AgentLobbyState-
      // typen og det vi faktisk returnerer (typo, nytt felt på typen som
      // ikke er i skjemaet, etc.). En feil her er en backend-bug → 500
      // INTERNAL_ERROR; UI skal aldri se en payload som ikke matcher
      // schemaet det parser mot.
      const parsed = Spill1AgentLobbyStateSchema.safeParse(state);
      if (!parsed.success) {
        logger.error(
          {
            issues: parsed.error.issues,
            hallId,
          },
          "[lobby-route] aggregator returned schema-violating payload — backend bug",
        );
        res.status(500).json({
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Lobby state schema-validation failed",
          },
        });
        return;
      }

      apiSuccess(res, parsed.data);
    } catch (err) {
      // Logg infrastruktur-feil med kontext, men la apiFailure håndtere
      // serialisering til wire-format (DomainError → 4xx, andre → 5xx).
      if (err instanceof DomainError && err.code === "LOBBY_AGGREGATOR_INFRA_ERROR") {
        logger.error(
          { err, hallId: req.query.hallId },
          "[lobby-route] aggregator infrastructure error",
        );
      }
      apiFailure(res, err);
    }
  });

  return router;
}
