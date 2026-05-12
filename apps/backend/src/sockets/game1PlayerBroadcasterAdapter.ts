/**
 * PR-C4: adapter som implementerer `Game1PlayerBroadcaster` på toppen av
 * default-namespace-infrastrukturen (io + emitRoomUpdate).
 *
 * Mål: spiller-klient (scheduled Spill 1) skal motta samme wire-kontrakt som
 * ad-hoc Spill 2/3 — `draw:new`, `pattern:won`, `room:update` — slik at
 * eksisterende `GameBridge`-kode i game-client virker uten endringer.
 *
 * Adapter-en er tynn: den wrapper bare `io.to(roomCode).emit(...)` og
 * delegerer `room:update` til eksisterende `emitRoomUpdate`-hook. Alle
 * kall er fire-and-forget; ingen kaster mot service-laget.
 */

import type { Server as SocketServer } from "socket.io";
import type {
  Game1PlayerBroadcaster,
  Game1PlayerDrawNewEvent,
  Game1PlayerPatternWonEvent,
} from "../game/Game1PlayerBroadcaster.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-player-broadcaster-adapter" });

/**
 * Debug-logging-toggle (2026-05-11, Tobias-direktiv): når
 * `DEBUG_SPILL1_DRAWS=true` emit `[draw] emitted`-strukturert log med
 * `{roomCode, drawIndex, ball, scheduledGameId}` rett før hver
 * `io.to(roomCode).emit("draw:new")`. Lar ops grep "[draw]" og se nøyaktig
 * hvilke `roomCode` server emitter til vs hvilke klient sockets joiner.
 * Default OFF for ikke å spamme prod.
 */
const DEBUG_SPILL1_DRAWS =
  process.env.DEBUG_SPILL1_DRAWS?.trim().toLowerCase() === "true";

export interface Game1PlayerBroadcasterAdapterDeps {
  io: SocketServer;
  /**
   * Hook for å pushe `room:update`-snapshot ut til default-namespace. Samme
   * funksjon som resten av Spill 1-flyten bruker (lukkede rom, stake-
   * oppdateringer, etc.). Adapter-en bryr seg ikke om returverdien.
   */
  emitRoomUpdate: (roomCode: string) => Promise<unknown>;
}

/**
 * Konstruér en broadcaster som sender `draw:new` og `pattern:won` via
 * default-namespace + trigger `emitRoomUpdate`. Alle kall sluker feil
 * lokalt (logg-warn), slik at en socket-feil aldri kan kaste tilbake til
 * `Game1DrawEngineService.drawNext()` POST-commit.
 */
export function createGame1PlayerBroadcaster(
  deps: Game1PlayerBroadcasterAdapterDeps
): Game1PlayerBroadcaster {
  const { io, emitRoomUpdate } = deps;

  return {
    onDrawNew(event: Game1PlayerDrawNewEvent): void {
      try {
        if (DEBUG_SPILL1_DRAWS) {
          // 2026-05-11: deterministisk diagnose-log. Bruker `log.info` (ikke
          // `.debug`) så loggen vises uavhengig av LOG_LEVEL=info-default.
          log.info(
            {
              roomCode: event.roomCode,
              drawIndex: event.drawIndex,
              ball: event.number,
              scheduledGameId: event.gameId,
            },
            "[draw] emitted"
          );
        }
        io.to(event.roomCode).emit("draw:new", {
          number: event.number,
          drawIndex: event.drawIndex,
          gameId: event.gameId,
        });
      } catch (err) {
        log.warn(
          { err, roomCode: event.roomCode, drawIndex: event.drawIndex },
          "io.emit draw:new failed — service fortsetter uansett"
        );
      }
    },

    onPatternWon(event: Game1PlayerPatternWonEvent): void {
      try {
        // BIN-696 / Tobias 2026-04-26: emit komplett PatternWonPayload-shape
        // — inkluderer `payoutAmount` (per-winner kr) og `claimType` slik at
        // klient-popup viser faktisk credited beløp og kan route LINE/BINGO
        // korrekt. Manglet før i scheduled-Spill1-flow → undefined → 0 kr
        // i WinPopup ved Fullt Hus + feil popup-routing.
        //
        // Tobias 2026-05-12 pilot-fix: `winnerWalletIds` lar klient matche
        // `isMe`-popup på walletId hvis server's playerId-mapping
        // (resolvePlayerPatternWinnerIds) falt tilbake til auth-userId.
        io.to(event.roomCode).emit("pattern:won", {
          patternId: event.patternName,
          patternName: event.patternName,
          wonAtDraw: event.drawIndex,
          gameId: event.gameId,
          winnerIds: event.winnerIds,
          winnerCount: event.winnerCount,
          // `winnerId` (singular) beholdt for legacy-kompat med Spill 2/3
          // toast-kode som fortsatt ser på første vinner.
          winnerId: event.winnerIds[0] ?? null,
          payoutAmount: event.payoutAmount,
          claimType: event.claimType,
          winnerWalletIds: event.winnerWalletIds,
        });
      } catch (err) {
        log.warn(
          { err, roomCode: event.roomCode, patternName: event.patternName },
          "io.emit pattern:won failed — service fortsetter uansett"
        );
      }
    },

    onRoomUpdate(roomCode: string): void {
      // Fire-and-forget: rpc-formen returnerer Promise, men vi bryr oss
      // ikke om resultatet — snapshot er allerede emitted av emitRoomUpdate.
      void Promise.resolve()
        .then(() => emitRoomUpdate(roomCode))
        .catch((err) => {
          log.warn(
            { err, roomCode },
            "emitRoomUpdate failed — service fortsetter uansett"
          );
        });
    },
    async awaitRoomUpdate(roomCode: string): Promise<void> {
      // Tobias 2026-05-12: blocking variant for destroyRoom-race-fix.
      // Caller awaiter denne FØR de muterer room-state. Aldri rejects —
      // feil logges og swallow-es som i fire-and-forget-versjonen.
      try {
        await emitRoomUpdate(roomCode);
      } catch (err) {
        log.warn(
          { err, roomCode },
          "awaitRoomUpdate: emitRoomUpdate failed — service fortsetter uansett"
        );
      }
    },
  };
}
