/**
 * PR-R4: fasade for socket-event-handlerne.
 *
 * Denne filen er igang med å splittes per event-cluster under
 * `sockets/gameEvents/`. Offentlige eksporter (`createGameEventHandlers`,
 * `GameEventsDeps`, `BingoSchedulerSettings`, `emitG3DrawEvents`) bevares
 * for bakoverkompatibilitet — eksisterende importer i
 * `apps/backend/src/index.ts` og `__tests__/` påvirkes ikke.
 */
import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { DomainError } from "./../game/BingoEngine.js";
import { addBreadcrumb } from "./../observability/sentry.js";
import { metrics as promMetrics } from "./../util/metrics.js";
import type { RoomSnapshot } from "./../game/types.js";
import { buildRegistryContext, buildSocketContext } from "./gameEvents/context.js";
import { registerRoomEvents } from "./gameEvents/roomEvents.js";
import { registerGameLifecycleEvents } from "./gameEvents/gameLifecycleEvents.js";
import { registerDrawEvents } from "./gameEvents/drawEvents.js";
import { registerTicketEvents } from "./gameEvents/ticketEvents.js";
import { registerClaimEvents } from "./gameEvents/claimEvents.js";
import { registerMiniGameEvents } from "./gameEvents/miniGameEvents.js";
import type {
  AckResponse,
  ChatMessage,
  ChatSendPayload,
  LeaderboardEntry,
  LeaderboardPayload,
  RoomActionPayload,
} from "./gameEvents/types.js";
import type { BingoSchedulerSettings, GameEventsDeps } from "./gameEvents/deps.js";

export { emitG3DrawEvents } from "./gameEvents/drawEmits.js";
export type { BingoSchedulerSettings, GameEventsDeps } from "./gameEvents/deps.js";

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGameEventHandlers(deps: GameEventsDeps) {
  const ctx = buildRegistryContext(deps);
  const {
    engine,
    io,
    ackSuccess,
    ackFailure,
    appendChatMessage,
  } = ctx;
  const {
    socketRateLimiter: _socketRateLimiter,
    emitRoomUpdate,
    runtimeBingoSettings,
    chatHistoryByRoom,
    getRoomConfiguredEntryFee,
    getArmedPlayerIds,
    disarmAllPlayers,
    clearDisplayTicketCache,
    resolveBingoHallGameConfigForRoom,
    buildLeaderboard,
  } = deps;

  return function registerGameEvents(socket: Socket): void {
    const sctx = buildSocketContext(socket, ctx);
    const { rateLimited, requireAuthenticatedPlayerAction } = sctx;

    registerRoomEvents(sctx);
    registerGameLifecycleEvents(sctx);
    registerDrawEvents(sctx);
    registerTicketEvents(sctx);
    registerClaimEvents(sctx);
    registerMiniGameEvents(sctx);

    // ── Chat ─────────────────────────────────────────────────────────────────
    socket.on("chat:send", rateLimited("chat:send", async (payload: ChatSendPayload, callback: (response: AckResponse<{ message: ChatMessage }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const message = (payload?.message ?? "").trim();
        if (!message && (payload?.emojiId ?? 0) === 0) {
          throw new DomainError("INVALID_INPUT", "Meldingen kan ikke være tom.");
        }
        const snapshot = engine.getRoomSnapshot(roomCode);
        const player = snapshot.players.find((p) => p.id === playerId);
        // BIN-516 hall-scoping: a player must belong to the room's hall to chat
        // in it. Cross-hall chat is a spillevett audit hazard.
        if (player?.hallId && snapshot.hallId && player.hallId !== snapshot.hallId) {
          throw new DomainError("FORBIDDEN", "Spilleren tilhører en annen hall enn rommet.");
        }
        const chatMsg: ChatMessage = {
          id: randomUUID(),
          playerId,
          playerName: player?.name ?? "Ukjent",
          message: message.slice(0, 500),
          emojiId: payload?.emojiId ?? 0,
          createdAt: new Date().toISOString()
        };
        appendChatMessage(roomCode, chatMsg);
        // BIN-516: fire-and-forget persistence. The store implementations log
        // and swallow errors — chat must keep flowing even if the DB is sick.
        if (deps.chatMessageStore) {
          void deps.chatMessageStore.insert({
            hallId: snapshot.hallId,
            roomCode,
            playerId,
            playerName: chatMsg.playerName,
            message: chatMsg.message,
            emojiId: chatMsg.emojiId,
          });
        }
        io.to(roomCode).emit("chat:message", chatMsg);
        ackSuccess(callback, { message: chatMsg });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("chat:history", rateLimited("chat:history", async (payload: RoomActionPayload, callback: (response: AckResponse<{ messages: ChatMessage[] }>) => void) => {
      try {
        const { roomCode } = await requireAuthenticatedPlayerAction(payload);
        // BIN-516: prefer the persistent store when available so a fresh
        // browser session sees pre-load chat history. Fall back to the
        // in-memory window for the dev-without-DB case.
        if (deps.chatMessageStore) {
          const persisted = await deps.chatMessageStore.listRecent(roomCode);
          ackSuccess(callback, { messages: persisted as ChatMessage[] });
          return;
        }
        const messages = chatHistoryByRoom.get(roomCode) ?? [];
        ackSuccess(callback, { messages });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Leaderboard ──────────────────────────────────────────────────────────
    socket.on("leaderboard:get", rateLimited("leaderboard:get", async (payload: LeaderboardPayload, callback: (response: AckResponse<{ leaderboard: LeaderboardEntry[] }>) => void) => {
      try {
        const leaderboard = buildLeaderboard(payload?.roomCode);
        ackSuccess(callback, { leaderboard });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("disconnect", (reason: string) => {
      engine.detachSocket(socket.id);
      _socketRateLimiter.cleanup(socket.id);
      // BIN-539: Every disconnect rolls into reconnect/retry dashboards. The
      // `reason` label is bounded (Socket.IO enumerates it), so cardinality
      // stays safe for Prometheus.
      promMetrics.reconnectTotal.inc({ reason: reason || "unknown" });
      addBreadcrumb("socket.disconnected", { socketId: socket.id, reason }, "warning");
    });
  };
}
