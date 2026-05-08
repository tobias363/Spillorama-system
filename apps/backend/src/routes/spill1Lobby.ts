/**
 * Public lobby-endepunkt for Spill 1 (2026-05-08).
 *
 * Bakgrunn (Tobias-direktiv 2026-05-08):
 *   "Så lenge rommet er åpent skal man ha mulighet til å gå inn i rommet og
 *    kjøpe bonger. Åpningstidene blir da samme som spilleplanen."
 *
 * Tidligere oppførsel: klient måtte ha en aktiv `app_game1_scheduled_games`-
 * rad å koble til. Hvis ingen runde var spawnet (runden mellom kl 11:00 og
 * 11:00:30 før master har trykket Start) fikk klienten "FÅR IKKE KOBLET TIL
 * ROM"-feil.
 *
 * Nytt: dette endepunktet returnerer "lobby-state" som er åpen så lenge
 * `now ∈ [plan.startTime, plan.endTime]` for en plan som dekker hallen
 * (direkte hall-binding eller GoH-medlemskap). UI bruker `overallStatus`
 * til å bestemme oppførsel:
 *   - `closed` → "Stengt"-melding (med åpningstider for "Åpner kl HH:MM")
 *   - `idle` → "Venter på neste runde — bonger ikke i salg ennå"
 *   - `purchase_open` → "Kjøp bonger"-knapp
 *   - `ready_to_start` / `running` → bytt til runde-modus i samme rom
 *
 * Endepunkt:
 *   GET /api/games/spill1/lobby?hallId={hallId}
 *
 * Auth: ingen (public). Spillere skal kunne se rom-status FØR de logger
 *   inn (matcher pattern fra `/api/games/status` i routes/game.ts).
 *   Vi reserverer høyre å legge til auth senere uten å bryte kontrakten —
 *   svaret er bevisst slankt og avslører ikke run-detaljer som ikke vises
 *   i UI.
 *
 * Cache: `Cache-Control: no-store`. Klient som poller hvert 10s må alltid
 *   få fersk state — å serve gammel state via CDN ville gi master/lobby-
 *   desync.
 *
 * Rate-limit: rute-laget har global rate-limit, ingen per-endpoint-grense.
 *
 * Wire-format: se `Game1LobbyService.Game1LobbyState`.
 */

import express from "express";

import { DomainError } from "../errors/DomainError.js";
import type { Game1LobbyService } from "../game/Game1LobbyService.js";
import { apiSuccess, apiFailure } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "spill1-lobby-router" });

export interface Spill1LobbyRouterDeps {
  lobbyService: Game1LobbyService;
}

export function createSpill1LobbyRouter(
  deps: Spill1LobbyRouterDeps,
): express.Router {
  const { lobbyService } = deps;
  const router = express.Router();

  router.get("/api/games/spill1/lobby", async (req, res) => {
    try {
      const rawHallId = req.query.hallId;
      if (typeof rawHallId !== "string" || rawHallId.trim().length === 0) {
        throw new DomainError(
          "INVALID_INPUT",
          "hallId-query-parameter er påkrevd.",
        );
      }
      const state = await lobbyService.getLobbyState(rawHallId.trim());
      // No-store: poller hvert 10s og master-handlinger må reflekteres
      // umiddelbart. CDN-cache ville gjøre lobby/master-desync mulig.
      res.setHeader("Cache-Control", "no-store");
      apiSuccess(res, state);
    } catch (err) {
      if (!(err instanceof DomainError)) {
        logger.warn(
          { err, hallId: req.query.hallId },
          "[lobby] uventet feil — propagerer til apiFailure",
        );
      }
      apiFailure(res, err);
    }
  });

  return router;
}
