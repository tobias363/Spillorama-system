/**
 * GAP #38: Player-initiated stop-game (Spillvett-vote).
 *
 * Wires the `game:stop:vote` socket event to `Spill1StopVoteService`.
 * Each authenticated player in the room can cast one vote per running
 * round. When the threshold is reached, the service stops the game and
 * releases armed wallet-reservations.
 *
 * Returns NOT_SUPPORTED when the service is not wired (test-harness
 * fallback) so the deploy is fail-fast rather than silently no-op.
 */
import { DomainError } from "../../game/BingoEngine.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
  StopGameVoteAckData,
  StopGameVotePayload,
} from "./types.js";

export function registerStopVoteEvents(ctx: SocketContext): void {
  const {
    socket,
    deps,
    ackSuccess,
    ackFailure,
    rateLimited,
    requireAuthenticatedPlayerAction,
  } = ctx;

  socket.on(
    "game:stop:vote",
    rateLimited(
      "game:stop:vote",
      async (
        payload: StopGameVotePayload,
        callback: (response: AckResponse<StopGameVoteAckData>) => void,
      ) => {
        try {
          const service = deps.spill1StopVoteService;
          if (!service) {
            throw new DomainError(
              "NOT_SUPPORTED",
              "Spillvett-stop-vote er ikke aktivert i denne deployen.",
            );
          }
          const { roomCode, playerId } = await requireAuthenticatedPlayerAction(
            payload,
          );

          const ipAddress =
            (typeof socket.handshake.headers["x-forwarded-for"] === "string"
              ? socket.handshake.headers["x-forwarded-for"]
                  .split(",")[0]
                  ?.trim()
              : null) ||
            socket.handshake.address ||
            null;
          const userAgent =
            typeof socket.handshake.headers["user-agent"] === "string"
              ? socket.handshake.headers["user-agent"]
              : null;

          const result = await service.castVote({
            roomCode,
            playerId,
            ipAddress,
            userAgent,
          });

          ackSuccess(callback, {
            recorded: result.recorded,
            voteCount: result.voteCount,
            threshold: result.threshold,
            playerCount: result.playerCount,
            thresholdReached: result.thresholdReached,
          });
        } catch (error) {
          ackFailure(callback, error, "game:stop:vote");
        }
      },
    ),
  );
}
