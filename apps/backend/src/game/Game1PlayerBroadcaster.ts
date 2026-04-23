/**
 * PR-C4: fire-and-forget broadcast-port for spiller-rettet socket-events
 * (default-namespace) under scheduled Spill 1.
 *
 * Kontekst:
 *   - `Game1DrawEngineService.drawNext()` trekker en ball og persisterer
 *     den i `app_game1_draws`. Før PR-C4 broadcastet engine kun til
 *     `/admin-game1`-namespace via `AdminGame1Broadcaster`. Spiller-klient
 *     bor i default-namespace og mottok ingen live-oppdatering → UI frøs
 *     til neste reconnect/resync.
 *   - Spill 1 er "alle i rommet ser nøyaktig det samme". Uten direkte
 *     broadcast til spiller-rommet (`io.to(roomCode)...`) brytes denne
 *     garantien.
 *
 * Portens ansvar:
 *   - Mappe domene-event (ball trukket, fase vunnet) → eksisterende wire-
 *     kontrakter brukt av `gameEvents.ts` for ad-hoc Spill 2/3:
 *       * `draw:new` — `{ number, drawIndex, gameId }`
 *       * `pattern:won` — speiler `Game1AutoClaim` event-shape.
 *       * `room:update` — oppdatert RoomSnapshot (via eksisterende
 *         `emitRoomUpdate`-hook).
 *   - Aldri kaste: service-transaksjonen er allerede committed når porten
 *     kalles, så en broadcast-feil skal bare logges.
 *
 * Scope-avgrensning mot AdminGame1Broadcaster:
 *   - Admin-broadcaster = master-konsoll på `/admin-game1` (admin-namespace).
 *   - Player-broadcaster = spiller-klient på default-namespace, scoped til
 *     `roomCode`.
 *   - Begge fyres POST-commit fra `Game1DrawEngineService.drawNext()`.
 */

export interface Game1PlayerDrawNewEvent {
  /**
   * BingoEngine room_code (samme kode som spillerens socket er joinet inn
   * i). Broadcast gjøres via `io.to(roomCode).emit(...)`.
   */
  roomCode: string;
  /** Kulas numeriske verdi (1..75). */
  number: number;
  /**
   * 0-basert drawIndex matcher `GameBridge.lastAppliedDrawIndex`-kontrakten:
   * første ball får `drawIndex=0`, andre `drawIndex=1`, osv. Beregnes fra
   * `view.drawsCompleted - 1` (DB-feltet er 1-basert count).
   */
  drawIndex: number;
  /**
   * Stabil spill-identifikator på wire-formatet. Bruker `scheduledGameId`
   * slik at klientens new-game-detection fungerer selv om BingoEngine-
   * rommet ikke har en egen `currentGame` for scheduled Spill 1.
   */
  gameId: string;
}

export interface Game1PlayerPatternWonEvent {
  roomCode: string;
  gameId: string;
  /** Tekst-id matcher `AdminGame1PhaseWonEvent.patternName` (f.eks. "row_1"). */
  patternName: string;
  phase: number;
  winnerIds: string[];
  winnerCount: number;
  /** 0-basert draw-index der fasen ble vunnet. */
  drawIndex: number;
}

export interface Game1PlayerBroadcaster {
  /** Kalles POST-commit fra `Game1DrawEngineService.drawNext()`. */
  onDrawNew(event: Game1PlayerDrawNewEvent): void;
  /** Kalles POST-commit fra `drawNext()` når `evaluateAndPayoutPhase` ga `phaseWon=true`. */
  onPatternWon(event: Game1PlayerPatternWonEvent): void;
  /**
   * Trigger push av oppdatert `RoomSnapshot` via eksisterende
   * `emitRoomUpdate`-infrastruktur. Adapter-en her er tynn: den skal bare
   * kalle `emitRoomUpdate(roomCode)` uten å bry seg om returverdien.
   */
  onRoomUpdate(roomCode: string): void;
}

/** No-op fallback — brukes i tester uten socket-miljø + ved manglende injeksjon. */
export const NoopGame1PlayerBroadcaster: Game1PlayerBroadcaster = {
  onDrawNew: () => undefined,
  onPatternWon: () => undefined,
  onRoomUpdate: () => undefined,
};
