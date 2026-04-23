/**
 * Game1DrawEngineCleanup — C1b room-cleanup for scheduled Spill 1.
 *
 * Ekstrahert fra `Game1DrawEngineService.ts` i refactor/s4-draw-engine-split
 * (Forslag A).
 *
 * **Scope:**
 *   - `destroyBingoEngineRoomIfPresent` (fail-closed destroyRoom-kall mot
 *     en BingoEngine-instans)
 *   - `destroyRoomForScheduledGameFromDb` (les `room_code` fra DB og kall
 *     destroyRoom fail-closed)
 *
 * **Kontrakt:**
 *   - Ren pure-funksjon-modul. Mottar alt den trenger som parametere.
 *   - Byte-identisk flytting — log-meldinger, idempotency-semantikk og
 *     fail-closed-kontrakt alle bevart.
 *
 * **Regulatorisk:** room-cleanup er IKKE regulatorisk-kritisk. En feilet
 * destroyRoom kan la et rom bli liggende som orphan (memory-leak) men
 * kan aldri blokkere draw-persistens eller master-stop-responsen.
 */

import type { Pool } from "pg";
import type { BingoEngine } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-cleanup" });

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * PR-C1b: fail-closed destroyRoom-kall. Kalles POST-commit fra
 * drawNext (ved `isFinished=true`) og fra stopGame. Idempotent ved
 * design: duplisert call til destroyRoom på samme roomCode gir
 * `ROOM_NOT_FOUND` (allerede slettet) som vi svelger.
 *
 * Fail-closed-kontrakt:
 *   - `bingoEngine` null → no-op (test-scenarier uten engine).
 *   - `roomCode` null/tomt → no-op (scheduled_game uten joinede spillere).
 *   - `destroyRoom` ikke definert på engine-instansen → no-op
 *     (defensivt; eldre engine-versjoner uten metoden).
 *   - `destroyRoom` kaster → log warning og returner normalt. Room
 *     kan i teorien bli liggende som orphan, men memory-leaket er
 *     begrenset og ikke regulatorisk-kritisk.
 */
export function destroyBingoEngineRoomIfPresent(
  bingoEngine: BingoEngine | null,
  scheduledGameId: string,
  roomCode: string | null,
  context: "completion" | "cancellation"
): void {
  if (!bingoEngine) return;
  if (roomCode == null || roomCode.trim() === "") return;
  const fn = bingoEngine.destroyRoom?.bind(bingoEngine);
  if (typeof fn !== "function") return;
  try {
    fn(roomCode);
    log.info(
      { scheduledGameId, roomCode, context },
      "[PR-C1b] destroyRoom etter scheduled-game-terminering"
    );
  } catch (err) {
    log.warn(
      { err, scheduledGameId, roomCode, context },
      "[PR-C1b] destroyRoom feilet — rommet kan bli liggende som orphan (ikke regulatorisk-kritisk)"
    );
  }
}

/**
 * PR-C1b: les `room_code` fra scheduled_games og kall
 * `destroyBingoEngineRoomIfPresent`. Fail-closed — SQL-feil eller DomainError
 * fra destroyRoom svelges med warning.
 *
 * Brukes av `stopGame` (via intern call) og eksponert som offentlig API på
 * service slik at Game1MasterControlService kan rydde rom ved cancel-
 * before-start (der `stopGame` ikke kalles pga. status-sjekken).
 */
export async function destroyRoomForScheduledGameFromDb(
  pool: Pool,
  scheduledGamesTable: string,
  bingoEngine: BingoEngine | null,
  scheduledGameId: string,
  context: "completion" | "cancellation"
): Promise<void> {
  try {
    const { rows } = await pool.query<{ room_code: string | null }>(
      `SELECT room_code
         FROM ${scheduledGamesTable}
        WHERE id = $1`,
      [scheduledGameId]
    );
    const row = rows[0];
    if (!row) return; // ingen rad → ingenting å rydde
    destroyBingoEngineRoomIfPresent(bingoEngine, scheduledGameId, row.room_code, context);
  } catch (err) {
    log.warn(
      { err, scheduledGameId, context },
      "[PR-C1b] room-cleanup feilet ved oppslag av room_code — ignorert (fail-closed)"
    );
  }
}
