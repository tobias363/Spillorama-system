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
import { metrics as promMetrics } from "../../util/metrics.js";
import { walletRoomKey } from "../walletStatePusher.js";
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
      // Tobias prod-incident 2026-04-29: snapshot mini-game-state PRE-draw
      // så vi kan detektere at `evaluateActivePhase` aktiverte mini-game
      // (Fullt Hus auto-claim → `onAutoClaimedFullHouse`). Vi har ingen
      // egen event-trigger fra engine, så vi bruker before/after-pattern
      // — samme strategi som `pattern:won` over.
      const miniGameBefore = engine.getCurrentMiniGame(roomCode);

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

      // Tobias prod-incident 2026-04-29: emit `minigame:activated` når
      // engine aktiverte mini-game i `evaluateActivePhase` (auto-claim av
      // Fullt Hus). Tidligere ble denne event-en kun emittert fra
      // `claim:submit`-handler-en (claimEvents.ts:93), men auto-round-
      // flow-en sender aldri claim:submit fra klient — engine auto-
      // claimer patterns server-side. Ved å detektere mini-game-state-
      // overgang her får vi samme wire-shape som manuell claim-pathen.
      //
      // Emit-target: `wallet:<walletId>`-rommet for vinneren (ikke hele
      // room-fanout) — mini-game-popup skal kun vises for spilleren som
      // vant, ikke alle observers. Wallet-rommet er authoritativt etter
      // BIN-760.
      const miniGameAfter = engine.getCurrentMiniGame(roomCode);
      if (
        miniGameAfter &&
        (!miniGameBefore || miniGameBefore.playerId !== miniGameAfter.playerId)
      ) {
        const winner = afterSnap.players.find((p) => p.id === miniGameAfter.playerId);
        if (winner?.walletId) {
          io.to(walletRoomKey(winner.walletId)).emit("minigame:activated", {
            gameId: afterSnap.currentGame?.id,
            playerId: miniGameAfter.playerId,
            type: miniGameAfter.type,
            prizeList: miniGameAfter.prizeList,
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
      //
      // 2026-05-04: Game3Engine extends Game2Engine (ikke BingoEngine direkte
      // som tidligere), så et Game3Engine-instans matcher BÅDE `instanceof
      // Game2Engine` og `instanceof Game3Engine`. Begge greiningene er
      // idempotente og safe — hver `getG{2,3}LastDrawEffects` returnerer
      // undefined når aktuell runde ikke fyrte den effekt-typen. For G3-rom
      // er G2-stashen tom (Game2Engine.isGame2Round false → no-op), og for
      // G2-rom er G3-stashen tom (Game3Engine.isGame3Round false → no-op).
      if (engine instanceof Game3Engine) {
        const g3Effects = engine.getG3LastDrawEffects(roomCode);
        if (g3Effects) emitG3DrawEvents(io, g3Effects);
      }

      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { number, snapshot });
    } catch (error) {
      // HIGH-5: telle draw-lock-rejections så ops kan se om to admin-paneler
      // (eller en aggressiv retry-løkke) prøver å trekke samtidig.
      const code = (error as { code?: string } | null)?.code;
      if (code === "DRAW_IN_PROGRESS") {
        promMetrics.drawLockRejections.inc();
      }
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
