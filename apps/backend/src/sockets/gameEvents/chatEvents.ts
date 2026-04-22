/**
 * PR-R4: Chat-cluster handlers — BIN-516.
 *
 * Inneholder:
 *   - chat:send    (validering, hall-scope-check, persistens via store, fanout)
 *   - chat:history (les fra store hvis tilgjengelig, ellers in-memory cache)
 *
 * Persistens er fire-and-forget: chat skal fortsette å flyte selv om DB er syk
 * (store-implementasjonene logger og svelger feil internt).
 *
 * Uendret fra opprinnelig gameEvents.ts.
 */
import { randomUUID } from "node:crypto";
import { DomainError } from "../../game/BingoEngine.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
  ChatMessage,
  ChatSendPayload,
  RoomActionPayload,
} from "./types.js";

export function registerChatEvents(ctx: SocketContext): void {
  const {
    engine,
    io,
    socket,
    deps,
    ackSuccess,
    ackFailure,
    appendChatMessage,
    rateLimited,
    requireAuthenticatedPlayerAction,
  } = ctx;
  const { chatHistoryByRoom } = deps;

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
}
