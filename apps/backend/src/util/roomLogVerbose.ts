/**
 * Verbose-room-log gating helper (LIVE_ROOM_OBSERVABILITY 2026-04-29).
 *
 * **Bakgrunn:** Tobias-incident 2026-04-29 (game `057c0502`) viste at engine
 * loggene knapt fanget 3 minutters live-runde — én "orphan reservation
 * released"-event over hele perioden. Når en runde går galt er det
 * post-mortem nesten umulig uten DB-forensics.
 *
 * Helper-en eksponerer en gating-funksjon for INFO-level lifecycle-events
 * (room.created, player.joined, game.started, game.draw, pattern.won, etc.).
 * Default `true` (verbose). Ops kan slå AV via `BINGO_VERBOSE_ROOM_LOGS=false`
 * hvis log-volum blir et problem på Render.
 *
 * **Hvorfor en separat gate-flag og ikke bare LOG_LEVEL:**
 *   - LOG_LEVEL gjelder hele backend; vi vil ikke at TRACE-level fra
 *     compliance/wallet-laget skal flomme samtidig.
 *   - Per-event gating gir presis ops-kontroll: skru av live-room-spam
 *     mens HALL_DEFICIT/payout-events fortsatt går på info.
 *   - Future-proofing: hvis volume eksploderer kan vi enkelt swap-e
 *     `isRoomVerboseEnabled()` til `LOG_LEVEL <= debug`.
 *
 * **Bruksmønster:**
 * ```ts
 * import { logRoomEvent } from "../util/roomLogVerbose.js";
 * logRoomEvent(logger, { roomCode, gameId, playerId }, "game.player.joined");
 * ```
 */

import type pino from "pino";
import { parseBooleanEnv } from "./httpHelpers.js";

let cachedFlag: boolean | undefined;

/**
 * Returner om verbose-room-logger er på. Default `true` — sett
 * `BINGO_VERBOSE_ROOM_LOGS=false` for å slå av.
 *
 * Caches verdien etter første kall så hot-paths (game.draw, pattern.won)
 * ikke betaler env-parse-overhead per kall. Tester som trenger å reset-e
 * (eks `BINGO_VERBOSE_ROOM_LOGS=false` per test) kan kalle
 * {@link resetRoomVerboseFlagForTest}.
 */
export function isRoomVerboseEnabled(): boolean {
  if (cachedFlag === undefined) {
    cachedFlag = parseBooleanEnv(process.env.BINGO_VERBOSE_ROOM_LOGS, true);
  }
  return cachedFlag;
}

/**
 * Test-hook: tving re-evaluering av env-flag ved neste {@link isRoomVerboseEnabled}-kall.
 * Brukes kun fra unit-tester som vil simulere `BINGO_VERBOSE_ROOM_LOGS=false`-state.
 */
export function resetRoomVerboseFlagForTest(): void {
  cachedFlag = undefined;
}

/**
 * Logg et structured INFO-event hvis verbose-mode er på. No-op ellers.
 *
 * `event` er en kanonisk kort-streng som ops kan grep-e i Render-logger
 * (eks `room.created`, `game.started`, `pattern.won`, `auto.round.tick`).
 * Se `docs/operations/LIVE_ROOM_OBSERVABILITY_2026-04-29.md` for fullt
 * katalog over event-navn.
 */
export function logRoomEvent(
  logger: pino.Logger,
  fields: Record<string, unknown>,
  event: string,
): void {
  if (!isRoomVerboseEnabled()) return;
  logger.info({ ...fields, event }, event);
}
