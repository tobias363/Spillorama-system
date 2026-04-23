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
  };
}
