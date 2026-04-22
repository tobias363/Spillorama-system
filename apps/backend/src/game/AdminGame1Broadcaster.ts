/**
 * GAME1_SCHEDULE PR 4d.3: fire-and-forget broadcast-port for admin-
 * namespace-events.
 *
 * Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.4.
 *
 * Service-laget kaller port-metodene etter DB-commit for state-endringer.
 * Port-implementasjon (i `apps/backend/src/sockets/adminGame1Namespace.ts`)
 * broadcaster til `/admin-game1.to(\`game1:${gameId}\`).emit(...)`. Portens
 * ansvar å aldri kaste — feil logges som warn, service-transaksjonen
 * fortsetter uforstyrret.
 *
 * Scope i 4d.3:
 *   - `onStatusChange` — kalles fra Game1MasterControlService ved start/
 *     pause/resume/stop/exclude-hall/include-hall etter DB-commit.
 *   - `onDrawProgressed` — kalles fra Game1DrawEngineService.drawNext()
 *     etter persisted draw.
 *
 * `onPhaseWon` er utsatt til 4d.4 (fase-overgang-deteksjon trenger mer
 * koordinering med payout-service). Flagget som gap i PR 4d.3-rapporten.
 */

export interface AdminGame1StatusChangeEvent {
  gameId: string;
  status: string;
  action: string;
  auditId: string;
  actorUserId: string;
  at: number;
}

export interface AdminGame1DrawProgressedEvent {
  gameId: string;
  ballNumber: number;
  drawIndex: number;
  currentPhase: number;
  at: number;
}

/**
 * PR 4d.4: fase-fullføring. Bevarer Agent 4-kontrakten på default namespace
 * — spiller-rettet `pattern:won` er urørt. Dette er admin-speiling med
 * aggregert winner-info (ingen wallet-detaljer).
 */
export interface AdminGame1PhaseWonEvent {
  gameId: string;
  patternName: string;
  phase: number;
  winnerIds: string[];
  winnerCount: number;
  drawIndex: number;
  at: number;
}

/**
 * PT4: fysisk-bong vinn-broadcast. Sendes til `/admin-game1`-namespace når
 * draw-engine detekterer at en fysisk bong (sold_to_scheduled_game_id satt)
 * treffer pattern for aktiv fase. Mottaker: bingovert-skjerm som viser
 * "Bong X vant Y — kontrollér". Ingen auto-payout.
 *
 * Forskjell fra `AdminGame1PhaseWonEvent`: PhaseWon rapporterer digital-
 * vinnere aggregert per fase; PhysicalTicketWon er per-bong og krever manuell
 * verifikasjon (scan) + utbetaling.
 */
export interface AdminGame1PhysicalTicketWonEvent {
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
  at: number;
}

export interface AdminGame1Broadcaster {
  onStatusChange(event: AdminGame1StatusChangeEvent): void;
  onDrawProgressed(event: AdminGame1DrawProgressedEvent): void;
  onPhaseWon(event: AdminGame1PhaseWonEvent): void;
  /** PT4: fysisk-bong vinn-broadcast. */
  onPhysicalTicketWon(event: AdminGame1PhysicalTicketWonEvent): void;
}

/** No-op fallback — brukes i tester uten socket-miljø + ved manglende injeksjon. */
export const NoopAdminGame1Broadcaster: AdminGame1Broadcaster = {
  onStatusChange: () => undefined,
  onDrawProgressed: () => undefined,
  onPhaseWon: () => undefined,
  onPhysicalTicketWon: () => undefined,
};
