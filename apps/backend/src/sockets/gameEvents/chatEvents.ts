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
 * Bølge D Issue 3 (MEDIUM, 2026-04-25): hall-scope-sjekken er fail-closed.
 * Tidligere kode skipper sjekken når `player.hallId` er undefined — typen
 * tillater det (`Player.hallId?: string`). Det betød at en spiller uten
 * hall kunne sende chat på tvers av haller. Nå avvises chat-eventet med
 * `HALL_REQUIRED` hvis spilleren mangler hallId, og anomalien logges.
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
    logger,
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
      // Bølge D Issue 3 (2026-04-25): FAIL-CLOSED hall-scope.
      //
      // Tidligere ble cross-hall-sjekken silent-skippet hvis `player.hallId`
      // var undefined (typen tillater `?: string`). Da kunne en spiller uten
      // hall sende chat på tvers av haller. Nå:
      //   1) Mangler player → INVALID_INPUT (eksisterende — behold default).
      //   2) Mangler player.hallId → HALL_REQUIRED + logg anomali.
      //   3) Mangler snapshot.hallId → INVALID_STATE (skal aldri skje siden
      //      RoomSnapshot.hallId er required, men beskyttelse mot type-drift).
      //   4) Hall mismatch → FORBIDDEN (uendret).
      if (!player) {
        throw new DomainError("INVALID_INPUT", "Spilleren finnes ikke i rommet.");
      }
      if (!player.hallId) {
        // Spillevett-audit: log anomalien (uautorisert tilgang fra spiller
        // uten hall-tilhørighet). Bør aldri skje på prod siden alle joins
        // setter hallId — men typen tillater det og fail-open her ville
        // bypass-e cross-hall-sjekken.
        logger.warn(
          { event: "chat:send", playerId, roomCode, snapshotHallId: snapshot.hallId },
          "chat fail-closed: player mangler hallId — avvist med HALL_REQUIRED",
        );
        throw new DomainError("HALL_REQUIRED", "Spilleren mangler hall-tilhørighet og kan ikke chatte.");
      }
      if (!snapshot.hallId) {
        // RoomSnapshot.hallId er required i typen — denne grenen er en
        // beskyttelse mot framtidig type-drift. Logg som anomali.
        logger.error(
          { event: "chat:send", roomCode, playerId },
          "chat fail-closed: snapshot mangler hallId (type-drift?) — avvist",
        );
        throw new DomainError("INVALID_STATE", "Rommet mangler hall-tilhørighet.");
      }
      // BIN-516 hall-scoping: a player must belong to the room's hall to chat
      // in it. Cross-hall chat is a spillevett audit hazard.
      if (player.hallId !== snapshot.hallId) {
        throw new DomainError("FORBIDDEN", "Spilleren tilhører en annen hall enn rommet.");
      }
      const chatMsg: ChatMessage = {
        id: randomUUID(),
        playerId,
        // Bølge D Issue 3: player er garantert non-null nå (sjekken over).
        playerName: player.name,
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
