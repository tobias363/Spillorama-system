/**
 * PR-R4: Claim-cluster.
 *
 * Inneholder:
 *   - claim:submit (spillerens BINGO/LINE-claim — emitter `pattern:won`,
 *                   aktiverer mini-game for Game 1 og jackpot for Game 5)
 *
 * Hvorfor her: BINGO-claim er eneste trigger for mini-game / jackpot-aktivering
 * (Game 1 / Game 5). Å dele dette ut i egen `miniGameEvents`-fil ville brutt
 * "én trigger — én fil"-prinsippet. Mini-game / jackpot-SPILL-handlers
 * (minigame:play, jackpot:spin) ligger i miniGameEvents.ts siden de ikke deler
 * claim-trigger-logikk.
 *
 * BIN-813 R5: claim:submit er wrapped med `withSocketIdempotency`. Klient
 * sender UUID v4 som `clientRequestId` per claim — reconnect-replay får
 * cached respons uten å dobbel-utbetale (selv om wallet-laget også er
 * idempotent via deterministisk key i `Game1PayoutService`).
 */
import { ClaimSubmitPayloadSchema } from "@spillorama/shared-types/socket-events";
import { DomainError } from "../../errors/DomainError.js";
import { addBreadcrumb } from "../../observability/sentry.js";
import { metrics as promMetrics } from "../../util/metrics.js";
import { withSocketIdempotency } from "../withSocketIdempotency.js";
import type { SocketContext } from "./context.js";
import type { AckResponse, ClaimPayload } from "./types.js";
import type { RoomSnapshot } from "../../game/types.js";

export function registerClaimEvents(ctx: SocketContext): void {
  const {
    socket,
    engine,
    io,
    deps,
    ackSuccess,
    ackFailure,
    rateLimited,
    requireAuthenticatedPlayerAction,
  } = ctx;
  const { emitRoomUpdate, socketIdempotencyStore } = deps;

  // BIN-813 R5: hver socket-handler som har sideeffekter wrapper handler-
  // kroppen sin med `withSocketIdempotency`. Wrapper-en er en pass-through
  // når clientRequestId mangler (legacy-klient) eller idempotency-store
  // er udefinert (test-harness uten Redis), så eksisterende tester kjører
  // uendret.
  const baseClaimHandler = async (
    payload: ClaimPayload,
    callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void,
  ): Promise<void> => {
    try {
      // BIN-545: runtime-validate the incoming claim:submit payload against the
      // shared-types Zod schema. `roomCode` and `type` must be present and
      // well-typed before we let the engine act.
      const parsed = ClaimSubmitPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path.join(".") || "payload";
        throw new DomainError("INVALID_INPUT", `claim:submit payload invalid (${field}: ${first?.message ?? "unknown"}).`);
      }
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
      const claim = await engine.submitClaim({
        roomCode,
        playerId,
        type: parsed.data.type
      });
      const snapshot = await emitRoomUpdate(roomCode);
      // BIN-539: Record the claim + payout so operator dashboards can
      // correlate wallet movement with in-game state. `hallId` is taken
      // from the room snapshot because `snapshot.hallId` is the canonical
      // source of truth (client-claimed hall is untrusted).
      const gameLabel = snapshot.gameSlug ?? "unknown";
      const hallLabel = snapshot.hallId ?? "unknown";
      promMetrics.claimSubmitted.inc({ game: gameLabel, hall: hallLabel, type: parsed.data.type });
      if (claim.valid && typeof claim.payoutAmount === "number" && claim.payoutAmount > 0) {
        promMetrics.payoutAmount.observe(
          { game: gameLabel, hall: hallLabel, type: parsed.data.type },
          claim.payoutAmount,
        );
      }
      addBreadcrumb("claim:submit", {
        game: gameLabel,
        hall: hallLabel,
        type: parsed.data.type,
        valid: claim.valid,
        payoutAmount: claim.payoutAmount ?? 0,
      });
      // Emit pattern:won if a pattern was completed by this claim
      if (claim.valid) {
        const wonPattern = snapshot.currentGame?.patternResults?.find(
          (r) => r.claimId === claim.id && r.isWon
        );
        if (wonPattern) {
          io.to(roomCode).emit("pattern:won", {
            patternId: wonPattern.patternId,
            patternName: wonPattern.patternName,
            winnerId: wonPattern.winnerId,
            wonAtDraw: wonPattern.wonAtDraw,
            payoutAmount: wonPattern.payoutAmount,
            claimType: wonPattern.claimType,
            gameId: snapshot.currentGame?.id
          });
        }
        // Game 1 (Classic Bingo): activate mini-game after BINGO win
        if (payload.type === "BINGO" && snapshot.gameSlug === "bingo") {
          const miniGame = engine.activateMiniGame(roomCode, playerId);
          if (miniGame) {
            socket.emit("minigame:activated", {
              gameId: snapshot.currentGame?.id,
              playerId,
              type: miniGame.type,
              prizeList: miniGame.prizeList,
            });
          }
        }
        // Game 5 (Spillorama): activate jackpot after BINGO win
        if (payload.type === "BINGO" && snapshot.gameSlug === "spillorama") {
          const jackpot = engine.activateJackpot(roomCode, playerId);
          if (jackpot) {
            // Send jackpot activation to the winning player only
            socket.emit("jackpot:activated", {
              gameId: snapshot.currentGame?.id,
              playerId,
              prizeList: jackpot.prizeList,
              totalSpins: jackpot.totalSpins,
              playedSpins: jackpot.playedSpins,
              spinHistory: jackpot.spinHistory,
            });
          }
        }
      }
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  };

  // BIN-813 R5: wrap base-handler med idempotency. Hvis store ikke er
  // konfigurert, registrer base-handler direkte (legacy-mode for tester).
  const handler = socketIdempotencyStore
    ? withSocketIdempotency(
        { store: socketIdempotencyStore, eventName: "claim:submit", socket },
        baseClaimHandler,
      )
    : baseClaimHandler;

  socket.on("claim:submit", rateLimited("claim:submit", handler));
}
