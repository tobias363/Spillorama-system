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
import { isCanonicalRoomCode } from "../util/canonicalRoomCode.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-cleanup" });

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * PR-C1b: fail-closed cleanup etter scheduled-game-terminering. Kalles
 * POST-commit fra drawNext (ved `isFinished=true`) og fra stopGame.
 * Idempotent ved design.
 *
 * # Tobias-direktiv 2026-05-13 — lobby-rom-persistens for Spill 1
 *
 * For HALL-SHARED CANONICAL Spill 1 lobby-rom (`BINGO_<groupId>`)
 * destruerer vi IKKE rommet — vi RESETER det med
 * `resetCanonicalRoomAfterGameEnd` slik at lobbyen forblir åpen for
 * neste scheduled-game innenfor spilleplanens åpningstid.
 *
 * Bakgrunn: pre-fix destruerte vi `BINGO_DEMO-PILOT-GOH` ved hver
 * scheduled-game-end. Spillere som ikke disconnectet socket fikk
 * `ROOM_NOT_FOUND` på neste `bet:arm` → kunne ikke kjøpe bonger til
 * neste runde. Per Tobias' immutable direktiv: "Lobby-rommet skal
 * være åpent innenfor åpningstid. Spillere skal alltid kunne kjøpe
 * bonger til neste spill — også under aktiv trekning og rett etter
 * trekningsslutt."
 *
 * For PER-HALL / non-canonical rom (single-hall scheduled, Demo Hall
 * ad-hoc, legacy random-coded rom): vi destruerer som før (matcher
 * eksisterende memory-leak-prevention-kontrakt).
 *
 * Fail-closed-kontrakt:
 *   - `bingoEngine` null → no-op (test-scenarier uten engine).
 *   - `roomCode` null/tomt → no-op (scheduled_game uten joinede spillere).
 *   - `destroyRoom`/`resetCanonicalRoomAfterGameEnd` ikke definert på
 *     engine-instansen → no-op (defensivt; eldre engine-versjoner).
 *   - Cleanup-funksjon kaster → log warning og returner normalt.
 */
export function destroyBingoEngineRoomIfPresent(
  bingoEngine: BingoEngine | null,
  scheduledGameId: string,
  roomCode: string | null,
  context: "completion" | "cancellation"
): void {
  if (!bingoEngine) return;
  if (roomCode == null || roomCode.trim() === "") return;
  const trimmedCode = roomCode.trim().toUpperCase();

  // Tobias-direktiv 2026-05-13: For canonical Spill 1 lobby-rom
  // (BINGO_<groupId>), RESET istedenfor å destruere. Rommet skal
  // overleve scheduled-game-completion slik at spillere kan kjøpe
  // bonger til neste runde uten å disconnecte + rejoine.
  //
  // Sjekken er kun på prefix (BINGO_), ikke på isHallShared/isCanonical
  // som er room-state — det avgjøres inne i
  // resetCanonicalRoomAfterGameEnd som returnerer false for non-shared
  // rom. Det er trygt å forsøke reset for et BINGO_-prefix-rom — hvis
  // det viser seg å være per-hall (ikke hall-shared), returnerer reset
  // false og vi faller tilbake til destroyRoom-pathen nedenfor.
  if (isCanonicalRoomCode(trimmedCode) && trimmedCode.startsWith("BINGO_")) {
    const resetFn = bingoEngine.resetCanonicalRoomAfterGameEnd?.bind(bingoEngine);
    if (typeof resetFn === "function") {
      try {
        const didReset = resetFn(trimmedCode);
        if (didReset) {
          log.info(
            { scheduledGameId, roomCode: trimmedCode, context },
            "[PR-C1b] resetCanonicalRoomAfterGameEnd — lobby beholdt for neste runde"
          );
          return; // Successfully reset — don't fall through to destroyRoom.
        }
        // didReset=false betyr rommet ikke var canonical hall-shared —
        // fall gjennom til destroyRoom-pathen (per-hall / Demo Hall).
        log.debug(
          { scheduledGameId, roomCode: trimmedCode, context },
          "[PR-C1b] reset returnerte false — faller tilbake til destroyRoom (ikke hall-shared)"
        );
      } catch (err) {
        // Reset feilet uventet (eks. GAME_IN_PROGRESS). Log og fall
        // tilbake til destroyRoom som best-effort cleanup.
        log.warn(
          { err, scheduledGameId, roomCode: trimmedCode, context },
          "[PR-C1b] resetCanonicalRoomAfterGameEnd kastet — faller tilbake til destroyRoom"
        );
      }
    }
  }

  // Per-hall / non-canonical / fallback path: destruer rommet som før.
  const fn = bingoEngine.destroyRoom?.bind(bingoEngine);
  if (typeof fn !== "function") return;
  try {
    fn(trimmedCode);
    log.info(
      { scheduledGameId, roomCode: trimmedCode, context },
      "[PR-C1b] destroyRoom etter scheduled-game-terminering"
    );
  } catch (err) {
    log.warn(
      { err, scheduledGameId, roomCode: trimmedCode, context },
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
