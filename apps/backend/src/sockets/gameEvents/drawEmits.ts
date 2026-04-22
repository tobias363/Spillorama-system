/**
 * PR-R4: Game 2 / Game 3 draw-effect emit-helpers — flyttet uendret fra
 * `gameEvents.ts`. `emitG3DrawEvents` eksporteres siden det testes direkte
 * fra `__tests__/g3Events.test.ts` (og re-eksporteres fra
 * `gameEvents.ts`-fasaden for bakoverkompatibilitet).
 */
import type { Server } from "socket.io";
import type { G2DrawEffects } from "../../game/Game2Engine.js";
import type { G3DrawEffects } from "../../game/Game3Engine.js";

/**
 * BIN-615 / PR-C2: Emit Game 2 wire-contract events from a single draw's
 * stashed side-effects. Legacy parity:
 *   - g2:jackpot:list-update → always (every G2 draw, legacy game2JackpotUpdate)
 *   - g2:rocket:launch       → broadcast when the round ends with winners
 *   - g2:ticket:completed    → broadcast per winner (legacy TicketCompleted;
 *                              legacy emitted to socketId only, we broadcast
 *                              so all viewers see completions)
 */
export function emitG2DrawEvents(io: Server, effects: G2DrawEffects): void {
  // Per-draw jackpot list — emitted on every G2 draw regardless of winners.
  // Legacy ref: Game2/Controllers/GameController.js:873-891 (game2JackpotUpdate).
  io.to(effects.roomCode).emit("g2:jackpot:list-update", {
    roomCode: effects.roomCode,
    gameId: effects.gameId,
    jackpotList: effects.jackpotList,
    currentDraw: effects.drawIndex,
  });

  if (effects.winners.length === 0) return;

  // Rocket-launch celebratory broadcast — one per round at terminal draw.
  // Legacy emitted Game2RocketLaunch at round-start; PM Q2 decision: reuse for
  // ticket-completion semantics (matches the C1-reserved payload shape).
  for (const winner of effects.winners) {
    io.to(effects.roomCode).emit("g2:rocket:launch", {
      roomCode: effects.roomCode,
      gameId: effects.gameId,
      playerId: winner.playerId,
      ticketId: winner.ticketId,
      drawIndex: effects.drawIndex,
      totalDraws: effects.drawIndex,
    });
    // Per-winner ticket-completed — legacy Game2/GameProcess.js:343-354.
    io.to(effects.roomCode).emit("g2:ticket:completed", {
      roomCode: effects.roomCode,
      gameId: effects.gameId,
      playerId: winner.playerId,
      ticketId: winner.ticketId,
      drawIndex: effects.drawIndex,
    });
  }
}

/**
 * BIN-615 / PR-C3b: Emit Game 3 wire-contract events from a single draw's
 * stashed side-effects (`Game3Engine.getG3LastDrawEffects`). Legacy parity:
 *   - g3:pattern:changed  → emit only when `effects.patternsChanged === true`
 *                           (cycler.step returned changed=true on this draw).
 *   - g3:pattern:auto-won → emit once per winning pattern batch after the
 *                           auto-claim has paid all (ticket, pattern) winners.
 *
 * Emission order: `g3:pattern:changed` first (so clients update pattern UI
 * before win banners), then one `g3:pattern:auto-won` per winning pattern.
 */
export function emitG3DrawEvents(io: Server, effects: G3DrawEffects): void {
  // Pattern list mutation: fire before any winner event so listeners can
  // refresh active-pattern UI before a winner banner references it.
  if (effects.patternsChanged) {
    io.to(effects.roomCode).emit("g3:pattern:changed", {
      roomCode: effects.roomCode,
      gameId: effects.gameId,
      activePatterns: effects.patternSnapshot
        .filter((p) => !p.isWon)
        .map((p) => ({
          id: p.id,
          name: p.name,
          design: p.design,
          patternDataList: p.patternDataList,
          ballNumberThreshold: p.ballThreshold,
        })),
      drawIndex: effects.drawIndex,
    });
  }

  // One g3:pattern:auto-won per winning pattern batch — legacy parity with
  // processPatternWinners broadcasting one PatternWon per pattern.
  for (const winner of effects.winners) {
    if (winner.ticketWinners.length === 0) continue;
    io.to(effects.roomCode).emit("g3:pattern:auto-won", {
      roomCode: effects.roomCode,
      gameId: effects.gameId,
      patternId: winner.patternId,
      patternName: winner.patternName,
      winnerPlayerIds: winner.ticketWinners.map((t) => t.playerId),
      prizePerWinner: winner.pricePerWinner,
      drawIndex: effects.drawIndex,
    });
  }
}
