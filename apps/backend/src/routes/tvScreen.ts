/**
 * TV Screen + Winners public display router.
 *
 * Public endpoints — ingen auth-middleware, kun tvToken-sjekk mot
 * app_halls.tv_token. Ved ugyldig token returnerer vi 404 (uniform med
 * ukjent hall) slik at enumeration-angrep ikke kan kartlegge gyldige
 * hall-IDer.
 *
 * Endpoints:
 *   GET /api/tv/:hallId/:tvToken/state    → current game state
 *   GET /api/tv/:hallId/:tvToken/winners  → last completed game winners
 *
 * Klient-frontend: apps/admin-web/src/pages/tv/*.ts (public routes,
 * utenfor normal auth-gate).
 */

import express from "express";
import type { PlatformService } from "../platform/PlatformService.js";
import type { TvScreenService } from "../game/TvScreenService.js";
import { DomainError } from "../game/BingoEngine.js";

export interface TvRouterDeps {
  platformService: PlatformService;
  tvScreenService: TvScreenService;
}

export function createTvScreenRouter(deps: TvRouterDeps): express.Router {
  const { platformService, tvScreenService } = deps;
  const router = express.Router();

  router.get("/api/tv/:hallId/:tvToken/state", async (req, res) => {
    try {
      const hall = await platformService.verifyHallTvToken(
        req.params.hallId ?? "",
        req.params.tvToken ?? ""
      );
      const state = await tvScreenService.getState({ id: hall.id, name: hall.name });
      res.json({ ok: true, data: state });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/api/tv/:hallId/:tvToken/winners", async (req, res) => {
    try {
      const hall = await platformService.verifyHallTvToken(
        req.params.hallId ?? "",
        req.params.tvToken ?? ""
      );
      const summary = await tvScreenService.getWinners({ id: hall.id, name: hall.name });
      res.json({ ok: true, data: summary });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}

/**
 * Token-fail ⇒ 404 uniform: aldri avslør om hallen finnes. Øvrige feil
 * logges som 500 men uten stack til klient (public endpoint).
 */
function handleError(res: express.Response, error: unknown): void {
  if (error instanceof DomainError && error.code === "TV_TOKEN_INVALID") {
    res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });
    return;
  }
  console.error("[tv-screen] internal error", error);
  res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR" } });
}
