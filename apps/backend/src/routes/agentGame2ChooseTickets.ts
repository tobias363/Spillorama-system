/**
 * 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): HTTP-routes for
 * Spill 2 Choose Tickets-side. Spillere ser 32 forhåndsgenererte 3×3-
 * brett, velger N (max 30), trykker Buy.
 *
 * Endepunkter:
 *   GET  /api/agent/game2/choose-tickets/:roomCode
 *     Henter 32 brett + purchasedIndices for innlogget spiller. Pool er
 *     deterministisk per (roomCode, playerId, gameId).
 *
 *   POST /api/agent/game2/choose-tickets/:roomCode/buy
 *     Body: { indices: number[], pickAnyNumber?: number }
 *     Markerer indeksene som kjøpt + lagrer Lucky Number. Returnerer
 *     oppdatert pool-state.
 *
 * Permissions: ingen spesiell admin-permission — vanlig spiller-token
 * (samme som annen game2-flyt). Backend resolver playerId fra access-
 * token slik at en spiller ikke kan kjøpe brett for en annen spiller.
 *
 * Wallet-debit / arming i BingoEngine: NOT YET integrert. Denne MVP-en
 * lagrer kun pool-state. v2-arbeid kobler buy → bet:arm med tilsvarende
 * count, og v3 kobler ticket-tallene til BingoEngine.startGame.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { Game2TicketPoolService } from "../game/Game2TicketPoolService.js";
import type { PlatformService } from "../platform/PlatformService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";

export interface AgentGame2ChooseTicketsDeps {
  platformService: PlatformService;
  ticketPoolService: Game2TicketPoolService;
  /**
   * Resolver-funksjon: fra roomCode → currentGameId. Returnerer null hvis
   * det ikke pågår en aktiv runde for rommet (Spill 2 har én runde av
   * gangen). Caller injiserer pga. circular-dep-frykt mot BingoEngine.
   */
  getCurrentGameIdForRoom: (roomCode: string) => string | null;
}

export function createAgentGame2ChooseTicketsRouter(
  deps: AgentGame2ChooseTicketsDeps,
): express.Router {
  const { platformService, ticketPoolService, getCurrentGameIdForRoom } = deps;
  const router = express.Router();

  async function resolvePlayerId(req: express.Request): Promise<string> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    return user.id;
  }

  function resolveGameIdOrThrow(roomCode: string): string {
    const gameId = getCurrentGameIdForRoom(roomCode);
    if (!gameId) {
      throw new DomainError(
        "NO_ACTIVE_GAME",
        "Ingen aktiv Spill 2-runde for dette rommet — vent på neste runde.",
      );
    }
    return gameId;
  }

  // ── GET /api/agent/game2/choose-tickets/:roomCode ─────────────────────────

  router.get("/api/agent/game2/choose-tickets/:roomCode", async (req, res) => {
    try {
      const playerId = await resolvePlayerId(req);
      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
      const gameId = resolveGameIdOrThrow(roomCode);
      const snapshot = ticketPoolService.getOrCreatePool(roomCode, playerId, gameId);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/game2/choose-tickets/:roomCode/buy ────────────────────

  router.post("/api/agent/game2/choose-tickets/:roomCode/buy", async (req, res) => {
    try {
      const playerId = await resolvePlayerId(req);
      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
      const gameId = resolveGameIdOrThrow(roomCode);

      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const rawIndices = req.body.indices;
      if (!Array.isArray(rawIndices)) {
        throw new DomainError("INVALID_INPUT", "indices må være en array.");
      }
      const indices: number[] = [];
      for (const idx of rawIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= 32) {
          throw new DomainError("INVALID_INPUT", `Ugyldig brett-indeks: ${idx}`);
        }
        indices.push(idx as number);
      }
      // 30-brett-max — speiler bet:arm-grensen.
      if (indices.length > 30) {
        throw new DomainError(
          "INVALID_INPUT",
          `Du kan velge maks 30 brett. Du valgte ${indices.length}.`,
        );
      }
      let pickAnyNumber: number | null | undefined;
      if (req.body.pickAnyNumber !== undefined) {
        if (req.body.pickAnyNumber === null) {
          pickAnyNumber = null;
        } else if (
          typeof req.body.pickAnyNumber === "number" &&
          Number.isInteger(req.body.pickAnyNumber) &&
          req.body.pickAnyNumber >= 1 &&
          req.body.pickAnyNumber <= 21
        ) {
          pickAnyNumber = req.body.pickAnyNumber;
        } else {
          throw new DomainError(
            "INVALID_INPUT",
            "pickAnyNumber må være et heltall mellom 1 og 21, eller null.",
          );
        }
      }

      const buyInput: Parameters<Game2TicketPoolService["buy"]>[0] = {
        roomCode,
        playerId,
        gameId,
        indices,
      };
      if (pickAnyNumber !== undefined) {
        buyInput.pickAnyNumber = pickAnyNumber;
      }
      const snapshot = ticketPoolService.buy(buyInput);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
