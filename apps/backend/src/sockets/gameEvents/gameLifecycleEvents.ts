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
import { DomainError } from "../../errors/DomainError.js";
import { isPerpetualGameSlug } from "../../util/roomHelpers.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
  EndGamePayload,
  StartGamePayload,
} from "./types.js";
import type { RoomSnapshot } from "../../game/types.js";

function assertGenericLifecycleAllowed(snapshot: RoomSnapshot): void {
  if (!isPerpetualGameSlug(snapshot.gameSlug)) {
    return;
  }
  throw new DomainError(
    "PERPETUAL_LIFECYCLE_FORBIDDEN",
    "Spill 2/3-rom styres av systemtjenester og kan ikke startes eller stoppes manuelt.",
  );
}

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
      assertGenericLifecycleAllowed(engine.getRoomSnapshot(roomCode));
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
      // Tobias 2026-04-29 (post-orphan-fix UX): bygg onPlayerRejected-
      // callback som emitter `bet:rejected` til hver droppet spiller.
      // Klient lytter til wallet:<walletId>-rommet og fjerner
      // pre-round-bonger + viser klar feilmelding ("Du nådde dagens
      // tapsgrense — bongene ble ikke med i denne runden").
      // Type matches BingoEngine.StartGameInput.onPlayerRejected (3 reasons —
      // pause-states blokkeres allerede på bet:arm).
      type RejectInput = {
        player: import("../../game/types.js").Player;
        reason:
          | "DAILY_LOSS_LIMIT_REACHED"
          | "MONTHLY_LOSS_LIMIT_REACHED"
          | "INSUFFICIENT_FUNDS";
        rejectedTicketCount: number;
        hallId: string;
      };
      const onPlayerRejected = deps.emitBetRejected
        ? (input: RejectInput): void => {
            // Bygg bruker-vennlig norsk feilmelding her på server-siden
            // så audit-log + bet:rejected har samme catalog. Klient kan
            // lokalisere via reason-koden men har fallback til message.
            const lossState = engine.getLossLimitState
              ? (() => {
                  try {
                    const ls = engine.getLossLimitState!(
                      input.player.walletId,
                      input.hallId,
                      Date.now(),
                    );
                    return {
                      hallId: input.hallId,
                      dailyUsed: ls.dailyUsed,
                      dailyLimit: ls.dailyLimit,
                      monthlyUsed: ls.monthlyUsed,
                      monthlyLimit: ls.monthlyLimit,
                      walletBalance: input.player.balance,
                    };
                  } catch {
                    return undefined;
                  }
                })()
              : undefined;
            const message = (() => {
              switch (input.reason) {
                case "DAILY_LOSS_LIMIT_REACHED":
                  return lossState
                    ? `Du har nådd dagens tapsgrense (${lossState.dailyUsed} / ${lossState.dailyLimit} kr). Forhåndskjøp ble derfor avvist.`
                    : "Du har nådd dagens tapsgrense. Forhåndskjøp ble avvist.";
                case "MONTHLY_LOSS_LIMIT_REACHED":
                  return lossState
                    ? `Du har nådd månedens tapsgrense (${lossState.monthlyUsed} / ${lossState.monthlyLimit} kr). Forhåndskjøp ble derfor avvist.`
                    : "Du har nådd månedens tapsgrense. Forhåndskjøp ble avvist.";
                case "INSUFFICIENT_FUNDS":
                default:
                  return "Du har ikke nok saldo til å delta i denne runden. Forhåndskjøp ble avvist.";
              }
            })();
            deps.emitBetRejected!(input.player.walletId, {
              roomCode,
              playerId: input.player.id,
              reason: input.reason,
              rejectedTicketCount: input.rejectedTicketCount,
              ...(lossState ? { lossState } : {}),
              message,
              serverTimestamp: Date.now(),
            });
          }
        : undefined;
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
        ...(onPlayerRejected ? { onPlayerRejected } : {}),
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
      assertGenericLifecycleAllowed(engine.getRoomSnapshot(roomCode));
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
