/**
 * PR-R4: Draw-cluster handlers.
 *
 * Inneholder:
 *   - draw:next            (trekk neste tall; emitter pattern:won + G2/G3-effekter)
 *   - draw:extra:purchase  (avvis ekstra-trekk-kjop; alltid REJECTED)
 *
 * G2/G3 wire-effekter emittes via `emitG2DrawEvents` / `emitG3DrawEvents`
 * (gameEvents/drawEmits.ts). Game2Engine/Game3Engine er søsker-subklasser av
 * BingoEngine — hver `instanceof`-greining matcher kun sin engine-type.
 */
import { Game2Engine } from "../../game/Game2Engine.js";
import { Game3Engine } from "../../game/Game3Engine.js";
import type { SocketContext } from "./context.js";
import { emitG2DrawEvents, emitG3DrawEvents } from "./drawEmits.js";
import type {
  AckResponse,
  ExtraDrawPayload,
  RoomActionPayload,
} from "./types.js";
import type { RoomSnapshot } from "../../game/types.js";

export function registerDrawEvents(ctx: SocketContext): void {
  const {
    socket,
    engine,
    io,
    ackSuccess,
    ackFailure,
    rateLimited,
    requireAuthenticatedPlayerAction,
    deps,
  } = ctx;
  const { emitRoomUpdate } = deps;

  socket.on("draw:next", rateLimited("draw:next", async (payload: RoomActionPayload, callback: (response: AckResponse<{ number: number; snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);

      // BIN-694: snapshot won-pattern-ids BEFORE draw so we can emit
      // `pattern:won` for each phase auto-claim committed during
      // `drawNextNumber` → `evaluateActivePhase`. Without this emit,
      // clients would only see the new isWon=true via the next
      // room:update — no dedicated event to trigger toast / animation.
      const beforeSnap = engine.getRoomSnapshot(roomCode);
      const wonBefore = new Set(
        (beforeSnap.currentGame?.patternResults ?? [])
          .filter((r) => r.isWon)
          .map((r) => r.patternId),
      );

      const { number, drawIndex, gameId } = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
      io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });

      // BIN-694: emit pattern:won for every phase the draw just closed.
      // BIN-696: include winnerIds + winnerCount for multi-winner popup.
      const afterSnap = engine.getRoomSnapshot(roomCode);
      const afterResults = afterSnap.currentGame?.patternResults ?? [];
      for (const r of afterResults) {
        if (r.isWon && !wonBefore.has(r.patternId)) {
          const winnerIds = r.winnerIds ?? (r.winnerId ? [r.winnerId] : []);
          io.to(roomCode).emit("pattern:won", {
            patternId: r.patternId,
            patternName: r.patternName,
            winnerId: r.winnerId,
            wonAtDraw: r.wonAtDraw,
            payoutAmount: r.payoutAmount,
            claimType: r.claimType,
            gameId: afterSnap.currentGame?.id,
            winnerIds,
            winnerCount: winnerIds.length,
          });
        }
      }

      // BIN-615 / PR-C2: emit Game 2 wire events for any G2 draw effects
      // stashed by Game2Engine.onDrawCompleted. No-op for non-G2 rooms.
      if (engine instanceof Game2Engine) {
        const effects = engine.getG2LastDrawEffects(roomCode);
        if (effects) emitG2DrawEvents(io, effects);
      }
      // BIN-615 / PR-C3b: emit Game 3 wire events for any G3 draw effects
      // stashed by Game3Engine.onDrawCompleted. No-op for non-G3 rooms.
      // Game2Engine and Game3Engine are sibling subclasses of BingoEngine
      // — each `instanceof` branch matches exactly one engine type, and
      // the engine concretely instantiated for a room determines which
      // stash can be non-empty.
      if (engine instanceof Game3Engine) {
        const g3Effects = engine.getG3LastDrawEffects(roomCode);
        if (g3Effects) emitG3DrawEvents(io, g3Effects);
      }

      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { number, snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("draw:extra:purchase", rateLimited("draw:extra:purchase", async (payload: ExtraDrawPayload, callback: (response: AckResponse<{ denied: true }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      engine.rejectExtraDrawPurchase({
        source: "SOCKET",
        roomCode,
        playerId,
        metadata: {
          requestedCount:
            payload?.requestedCount === undefined ? undefined : Number(payload.requestedCount),
          packageId: typeof payload?.packageId === "string" ? payload.packageId : undefined
        }
      });
      ackSuccess(callback, { denied: true });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));
}
