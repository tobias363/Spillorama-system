/**
 * PR-R4: Game-lifecycle handlers — start + end for en runde.
 *
 * Cluster inneholder:
 *   - game:start (initier runde, låser armed-spillere, charger entryFee via engine)
 *   - game:end   (avslutt runde manuelt)
 *
 * Ingen logikk endret fra opprinnelig gameEvents.ts.
 */
import { parseTicketsPerPlayerInput } from "../../util/httpHelpers.js";
import { assertTicketsPerPlayerWithinHallLimit } from "../../game/compliance.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
  EndGamePayload,
  StartGamePayload,
} from "./types.js";
import type { RoomSnapshot } from "../../game/types.js";

export function registerGameLifecycleEvents(ctx: SocketContext): void {
  const {
    socket,
    deps,
    engine,
    ackSuccess,
    ackFailure,
    rateLimited,
    requireAuthenticatedPlayerAction,
  } = ctx;
  const {
    emitRoomUpdate,
    runtimeBingoSettings,
    getRoomConfiguredEntryFee,
    getArmedPlayerIds,
    disarmAllPlayers,
    clearDisplayTicketCache,
    resolveBingoHallGameConfigForRoom,
  } = deps;

  socket.on("game:start", rateLimited("game:start", async (payload: StartGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const requestedTicketsPerPlayer =
        payload?.ticketsPerPlayer === undefined || payload?.ticketsPerPlayer === null
          ? undefined
          : parseTicketsPerPlayerInput(payload.ticketsPerPlayer);
      const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
      const ticketsPerPlayer =
        requestedTicketsPerPlayer ??
        Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeBingoSettings.autoRoundTicketsPerPlayer);
      assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
      const variantInfo = deps.getVariantConfig?.(roomCode);
      // BIN-690: snapshot the display-ticket cache BEFORE startGame so
      // we can pass it in — the cache is cleared below, and startGame
      // itself pushes `emitRoomUpdate` which would re-populate the
      // cache with new random grids if we read it after.
      const preRoundTicketsByPlayerId = deps.getPreRoundTicketsByPlayerId?.(roomCode);
      await engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: payload?.entryFee ?? getRoomConfiguredEntryFee(roomCode),
        ticketsPerPlayer,
        payoutPercent: runtimeBingoSettings.payoutPercent,
        armedPlayerIds: getArmedPlayerIds(roomCode),
        armedPlayerTicketCounts: deps.getArmedPlayerTicketCounts(roomCode),
        armedPlayerSelections: deps.getArmedPlayerSelections(roomCode),
        gameType: variantInfo?.gameType,
        variantConfig: variantInfo?.config,
        preRoundTicketsByPlayerId,
      });
      disarmAllPlayers(roomCode);
      clearDisplayTicketCache(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("game:end", rateLimited("game:end", async (payload: EndGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      await engine.endGame({
        roomCode,
        actorPlayerId: playerId,
        reason: payload?.reason
      });
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));
}
