/**
 * Game1DrawEngineBroadcast — C4 player-broadcast + admin-broadcast-helpers.
 *
 * Ekstrahert fra `Game1DrawEngineService.ts` i refactor/s4-draw-engine-split
 * (Forslag A).
 *
 * **Scope:**
 *   - Player-broadcast (C4, default-namespace):
 *       `emitPlayerDrawNew`, `emitPlayerPatternWon`, `emitPlayerRoomUpdate`
 *   - Admin-broadcast (PR 4d.3/4d.4 + PT4):
 *       `emitAdminDrawProgressed`, `emitAdminPhaseWon`,
 *       `emitAdminPhysicalTicketWon`
 *
 * **Kontrakt:**
 *   - Alle funksjoner er fire-and-forget — broadcaster null → no-op,
 *     broadcaster kaster → log warning og returner normalt.
 *   - Byte-identisk flytting — log-meldinger, event-felter og null-sjekker
 *     alle bevart.
 *
 * **Regulatorisk:** broadcast er alltid POST-commit (service-en kaller
 * dem fra `.then`-blokken etter `runInTransaction`). Feil i broadcast
 * kan ikke rulle tilbake databaseoperasjoner.
 */

import type { AdminGame1Broadcaster } from "./AdminGame1Broadcaster.js";
import type { Game1PlayerBroadcaster } from "./Game1PlayerBroadcaster.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-broadcast" });

// ── Player-broadcast (C4, default-namespace) ─────────────────────────────────

/**
 * PR-C4: fire-and-forget broadcast av `draw:new` til spiller-klient via
 * default-namespace. Kalles POST-commit fra drawNext() med 0-basert
 * drawIndex (matcher `GameBridge.lastAppliedDrawIndex`-kontrakten).
 */
export function emitPlayerDrawNew(
  playerBroadcaster: Game1PlayerBroadcaster | null,
  roomCode: string,
  scheduledGameId: string,
  ballNumber: number,
  drawIndex0Based: number
): void {
  if (!playerBroadcaster) return;
  try {
    playerBroadcaster.onDrawNew({
      roomCode,
      number: ballNumber,
      drawIndex: drawIndex0Based,
      gameId: scheduledGameId,
    });
  } catch (err) {
    log.warn(
      { err, scheduledGameId, roomCode, drawIndex: drawIndex0Based },
      "playerBroadcaster.onDrawNew kastet — ignorert"
    );
  }
}

/**
 * PR-C4: fire-and-forget broadcast av `pattern:won` til spiller-klient
 * via default-namespace. Matcher admin phase-won-event men sendes til
 * `roomCode` istedenfor admin-rommet.
 */
export function emitPlayerPatternWon(
  playerBroadcaster: Game1PlayerBroadcaster | null,
  roomCode: string,
  scheduledGameId: string,
  patternName: string,
  phase: number,
  winnerIds: string[],
  drawIndex0Based: number
): void {
  if (!playerBroadcaster) return;
  try {
    playerBroadcaster.onPatternWon({
      roomCode,
      gameId: scheduledGameId,
      patternName,
      phase,
      winnerIds,
      winnerCount: winnerIds.length,
      drawIndex: drawIndex0Based,
    });
  } catch (err) {
    log.warn(
      { err, scheduledGameId, roomCode, patternName },
      "playerBroadcaster.onPatternWon kastet — ignorert"
    );
  }
}

/**
 * PR-C4: fire-and-forget push av oppdatert `room:update`-snapshot til
 * spiller-klient. Tynn adapter — kaller på eksisterende `emitRoomUpdate`-
 * infrastruktur i index.ts.
 */
export function emitPlayerRoomUpdate(
  playerBroadcaster: Game1PlayerBroadcaster | null,
  roomCode: string
): void {
  if (!playerBroadcaster) return;
  try {
    playerBroadcaster.onRoomUpdate(roomCode);
  } catch (err) {
    log.warn(
      { err, roomCode },
      "playerBroadcaster.onRoomUpdate kastet — ignorert"
    );
  }
}

// ── Admin-broadcast (PR 4d.3/4d.4) ───────────────────────────────────────────

/** PR 4d.3: fire-and-forget admin-broadcast for draw-progress. */
export function emitAdminDrawProgressed(
  adminBroadcaster: AdminGame1Broadcaster | null,
  scheduledGameId: string,
  ballNumber: number,
  drawIndex: number,
  currentPhase: number
): void {
  if (!adminBroadcaster) return;
  try {
    adminBroadcaster.onDrawProgressed({
      gameId: scheduledGameId,
      ballNumber,
      drawIndex,
      currentPhase,
      at: Date.now(),
    });
  } catch (err) {
    log.warn(
      { err, scheduledGameId, drawIndex },
      "adminBroadcaster.onDrawProgressed kastet — ignorert"
    );
  }
}

/** PR 4d.4: fire-and-forget admin-broadcast for phase-won. */
export function emitAdminPhaseWon(
  adminBroadcaster: AdminGame1Broadcaster | null,
  scheduledGameId: string,
  patternName: string,
  phase: number,
  winnerIds: string[],
  drawIndex: number
): void {
  if (!adminBroadcaster) return;
  try {
    adminBroadcaster.onPhaseWon({
      gameId: scheduledGameId,
      patternName,
      phase,
      winnerIds,
      winnerCount: winnerIds.length,
      drawIndex,
      at: Date.now(),
    });
  } catch (err) {
    log.warn(
      { err, scheduledGameId, patternName },
      "adminBroadcaster.onPhaseWon kastet — ignorert"
    );
  }
}

/**
 * Task 1.1: fire-and-forget admin-broadcast for auto-pause etter phase-won.
 * Kalles POST-commit fra `Game1DrawEngineService.drawNext()` når phaseWon
 * utløser `paused=true + paused_at_phase=current_phase`. Eventet er
 * ADDITIV til `game1:phase-won` som fortsatt emittes i samme sekvens —
 * admin-UI bruker `game1:auto-paused` for å vise Resume-knapp uten å
 * måtte hente fresh DB-state.
 */
export function emitAdminAutoPaused(
  adminBroadcaster: AdminGame1Broadcaster | null,
  scheduledGameId: string,
  phase: number
): void {
  if (!adminBroadcaster) return;
  try {
    adminBroadcaster.onAutoPaused({
      gameId: scheduledGameId,
      phase,
      pausedAt: Date.now(),
    });
  } catch (err) {
    log.warn(
      { err, scheduledGameId, phase },
      "adminBroadcaster.onAutoPaused kastet — ignorert"
    );
  }
}

/**
 * Task 1.1: fire-and-forget admin-broadcast for manuell resume.
 * Kalles POST-commit fra `Game1MasterControlService.resumeGame()`.
 * `resumeType='auto'` = avsluttet en auto-pause; `'manual'` = avsluttet
 * en eksplisitt master-pause (status='paused' → 'running').
 */
export function emitAdminResumed(
  adminBroadcaster: AdminGame1Broadcaster | null,
  scheduledGameId: string,
  actorUserId: string,
  phase: number,
  resumeType: "auto" | "manual"
): void {
  if (!adminBroadcaster) return;
  try {
    adminBroadcaster.onResumed({
      gameId: scheduledGameId,
      resumedAt: Date.now(),
      actorUserId,
      phase,
      resumeType,
    });
  } catch (err) {
    log.warn(
      { err, scheduledGameId, actorUserId, resumeType },
      "adminBroadcaster.onResumed kastet — ignorert"
    );
  }
}

/**
 * PT4: fire-and-forget admin-broadcast for fysisk-bong-vinn.
 * Kalles POST-commit slik at broadcast IKKE sendes hvis transaksjonen
 * ruller tilbake.
 */
export function emitAdminPhysicalTicketWon(
  adminBroadcaster: AdminGame1Broadcaster | null,
  evt: {
    gameId: string;
    phase: number;
    patternName: string;
    pendingPayoutId: string;
    ticketId: string;
    hallId: string;
    responsibleUserId: string;
    expectedPayoutCents: number;
    color: string;
    adminApprovalRequired: boolean;
  }
): void {
  if (!adminBroadcaster) return;
  try {
    adminBroadcaster.onPhysicalTicketWon({
      gameId: evt.gameId,
      phase: evt.phase,
      patternName: evt.patternName,
      pendingPayoutId: evt.pendingPayoutId,
      ticketId: evt.ticketId,
      hallId: evt.hallId,
      responsibleUserId: evt.responsibleUserId,
      expectedPayoutCents: evt.expectedPayoutCents,
      color: evt.color,
      adminApprovalRequired: evt.adminApprovalRequired,
      at: Date.now(),
    });
  } catch (err) {
    log.warn(
      {
        err,
        scheduledGameId: evt.gameId,
        ticketId: evt.ticketId,
        pendingPayoutId: evt.pendingPayoutId,
      },
      "adminBroadcaster.onPhysicalTicketWon kastet — ignorert"
    );
  }
}
