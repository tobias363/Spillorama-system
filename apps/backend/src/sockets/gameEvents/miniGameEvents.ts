/**
 * PR-R4: Mini-game-handlere som SPILLER mini-gamet (ikke aktiverer det).
 *
 * Inneholder:
 *   - jackpot:spin  (Game 5 Spillorama — et spinn på jackpot-hjulet)
 *   - minigame:play (Game 1 Wheel of Fortune / Treasure Chest)
 *
 * Aktivering av disse mini-gamene skjer fra `claim:submit` (claimEvents.ts)
 * etter en BINGO-win — ikke her. Denne fila tar imot senere "spill mini-gamet"-
 * kall fra klienten etter at `minigame:activated` / `jackpot:activated` er
 * mottatt.
 *
 * Koordinering med M6-arkitektur: `engine.playMiniGame` returnerer resultatet
 * direkte til den kallende socket (ingen room-fanout — mini-game er privat for
 * vinneren).
 *
 * Uendret fra opprinnelig gameEvents.ts.
 */
import type { SocketContext } from "./context.js";
import type { AckResponse, RoomActionPayload } from "./types.js";

export function registerMiniGameEvents(ctx: SocketContext): void {
  const {
    socket,
    engine,
    ackSuccess,
    ackFailure,
    rateLimited,
    requireAuthenticatedPlayerAction,
  } = ctx;

  // ── Jackpot (Game 5 Free Spin) ─────────────────────────────────────────
  socket.on("jackpot:spin", rateLimited("jackpot:spin", async (payload: RoomActionPayload, callback: (response: AckResponse<unknown>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const result = await engine.spinJackpot(roomCode, playerId);
      ackSuccess(callback, result);
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  // ── Mini-game (Game 1 — Wheel of Fortune / Treasure Chest) ─────────────
  socket.on("minigame:play", rateLimited("minigame:play", async (payload: RoomActionPayload & { selectedIndex?: number }, callback: (response: AckResponse<unknown>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const selectedIndex = typeof payload?.selectedIndex === "number" ? payload.selectedIndex : undefined;
      const result = await engine.playMiniGame(roomCode, playerId, selectedIndex);
      ackSuccess(callback, result);
    } catch (error) {
      ackFailure(callback, error);
    }
  }));
}
