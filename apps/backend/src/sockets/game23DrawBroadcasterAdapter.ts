/**
 * Game23DrawBroadcasterAdapter — broadcasting-bro mellom auto-draw-cron og
 * spillerklientene for Spill 2 (rocket / tallspill / game_2) og Spill 3
 * (monsterbingo / mønsterbingo / game_3).
 *
 * Bakgrunn (Tobias-direktiv 2026-05-04, bekreftet via Playwright E2E):
 *   `Game2AutoDrawTickService.tick()` (og søsken `Game3AutoDrawTickService`)
 *   trekker baller server-side via cron — men emitterte INGEN
 *   `draw:new` / `room:update` ut til klientene. Resultat: server-state
 *   var korrekt, men UI sto stille på "Trekk: 00/21".
 *
 *   Eneste eksisterende emit-sti for `draw:new` lå i admin-socket-handleren
 *   `draw:next` (apps/backend/src/sockets/gameEvents/drawEvents.ts:60-61),
 *   som aldri trigges når cron driver trekkene. Spill 1 har eksakt samme
 *   utfordring og løste det med {@link createGame1PlayerBroadcaster} —
 *   denne adapteren replikerer mønsteret for Spill 2/3.
 *
 * Wire-protokoll (matcher klient-handlere i
 * `packages/game-client/src/bridge/GameBridge.ts:274-285`):
 *   - `draw:new`        — `{ number, drawIndex, gameId }` per ball.
 *   - `room:update`     — full RoomUpdatePayload via `emitRoomUpdate`.
 *   - `g2:*` / `g3:*`   — engine-spesifikke effekter via eksisterende
 *                         `emitG2DrawEvents` / `emitG3DrawEvents` helpers.
 *
 * Designvalg: tynn adapter som speiler `Game1PlayerBroadcasterAdapter`.
 * Ingen logikk legges her — kun bro mellom service-kall og socket-laget.
 * Alle kall sluker feil lokalt (warn-logg) så en socket-feil aldri kan
 * kaste tilbake til cron-tick-en og blokkere andre rom.
 */

import type { Server as SocketServer } from "socket.io";
import { Game2Engine } from "../game/Game2Engine.js";
import { Game3Engine } from "../game/Game3Engine.js";
import { emitG2DrawEvents, emitG3DrawEvents } from "./gameEvents/drawEmits.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game23-draw-broadcaster" });

/**
 * Public broadcaster-flate som auto-draw-tick-servicene bruker. Definert som
 * interface for testbarhet — testene injecter fakes uten å mounte
 * Socket.IO eller `emitRoomUpdate`-pipelinen.
 */
export interface Game23DrawBroadcaster {
  /**
   * Fyres etter en vellykket `engine.drawNextNumber(...)` fra cron-tick-en.
   * Adapter-en skal:
   *   1) Emit `draw:new` med `{ number, drawIndex, gameId }`.
   *   2) Drain engine-spesifikke effekter (G2 jackpot/winners, G3 patterns)
   *      via eksisterende `emit{G2,G3}DrawEvents`.
   *   3) Trigge `emitRoomUpdate(roomCode)` så alle klienter får oppdatert
   *      snapshot (inkludert `marks` etter `autoMarkPlayerCells`-hooken
   *      som kjører i `onDrawCompleted`).
   *
   * Fail-soft: alle feil logges men kastes ikke videre.
   */
  onDrawCompleted(input: {
    roomCode: string;
    number: number;
    drawIndex: number;
    gameId: string;
  }): void;
}

export interface Game23DrawBroadcasterAdapterDeps {
  io: SocketServer;
  /**
   * Engine-instans. Brukes for `instanceof`-greining mot Game2Engine /
   * Game3Engine før vi drainer effekter — speiler eksisterende mønster i
   * `apps/backend/src/sockets/gameEvents/drawEvents.ts:114-127`.
   *
   * Skrevet som `unknown` her for ikke å lekke konkrete engine-typer ut i
   * cron-laget; runtime-greiningen skjer via `instanceof` lokalt og er
   * trygg uavhengig av subklassering.
   */
  engine: unknown;
  /**
   * Hook for `room:update`. Samme funksjon som resten av Spill 1/2/3-
   * flowen bruker (apps/backend/src/index.ts:1312). Adapter-en bryr seg
   * ikke om returverdien — fire-and-forget.
   */
  emitRoomUpdate: (roomCode: string) => Promise<unknown>;
}

/**
 * Konstruér broadcaster-en. Eksportert som factory så det er trivielt å
 * stubbe ut adapter-en i unit-tester ved å erstatte hele factory-en.
 */
export function createGame23DrawBroadcaster(
  deps: Game23DrawBroadcasterAdapterDeps,
): Game23DrawBroadcaster {
  const { io, engine, emitRoomUpdate } = deps;

  return {
    onDrawCompleted({ roomCode, number, drawIndex, gameId }): void {
      // 1) `draw:new` — same shape som drawEvents.ts:60-61 og
      //    Game1PlayerBroadcasterAdapter:48-52. Dette er det viktigste
      //    eventet — uten det rendrer ikke klient-UIet nye baller.
      try {
        io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });
      } catch (err) {
        log.warn(
          { err, roomCode, drawIndex, number },
          "[game23-broadcast] io.emit draw:new failed — fortsetter uansett",
        );
      }

      // 2) Engine-spesifikke effekter — drainer atomisk fra engine-stash.
      //    Speiler drawEvents.ts:114-127. Hver `instanceof`-greining
      //    matcher konkret en engine-type; runtime-engine i prod er
      //    Game3Engine (extends BingoEngine), så Game3 vil fyre, mens
      //    Game2 forblir no-op inntil engine-arkitekturen oppdateres.
      //    Ved å gjøre samme guarding her holder vi cron- og socket-
      //    veiene wire-kompatible når Game2-flytene aktiveres.
      try {
        if (engine instanceof Game2Engine) {
          const effects = engine.getG2LastDrawEffects(roomCode);
          if (effects) emitG2DrawEvents(io, effects);
        }
        if (engine instanceof Game3Engine) {
          const effects = engine.getG3LastDrawEffects(roomCode);
          if (effects) emitG3DrawEvents(io, effects);
        }
      } catch (err) {
        log.warn(
          { err, roomCode, drawIndex },
          "[game23-broadcast] engine-effects emit failed — fortsetter uansett",
        );
      }

      // 3) `room:update` — full snapshot. Etter PR #899 inkluderer
      //    snapshot også marks satt av `autoMarkPlayerCells` i
      //    `Game{2,3}Engine.onDrawCompleted`, så klienten ser oppdaterte
      //    bonger. Fire-and-forget — vi bryr oss ikke om payload-en.
      void Promise.resolve()
        .then(() => emitRoomUpdate(roomCode))
        .catch((err) => {
          log.warn(
            { err, roomCode, drawIndex },
            "[game23-broadcast] emitRoomUpdate failed — fortsetter uansett",
          );
        });
    },
  };
}
