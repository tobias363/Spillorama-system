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

/**
 * Task 1.1: auto-pause ved phase-won. Gap #1 i
 * docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md.
 *
 * Emittes av `Game1DrawEngineService.drawNext()` etter at en fase er vunnet
 * (og Fullt Hus IKKE er nådd — da ender spillet istedenfor å pause).
 * Mottakere på admin-siden bruker eventet for å vise Resume-knapp +
 * banner "Pause etter Rad N — trykk Resume for å fortsette".
 *
 * Merk: `AdminGame1PhaseWonEvent` emittes fortsatt for samme fase — auto-
 * pause er en TILLEGGS-signal til master-UI, ikke en erstatning.
 */
export interface AdminGame1AutoPausedEvent {
  gameId: string;
  /** Fasen som akkurat ble vunnet og utløste auto-pause (1..4). */
  phase: number;
  /** Unix-ms. */
  pausedAt: number;
}

/**
 * Task 1.1: emittes av `Game1MasterControlService.resumeGame()` etter at
 * master/agent manuelt har trykket Resume. Dekker både (a) manuell-pause
 * (status='paused' → 'running') og (b) auto-pause (paused=true →
 * paused=false) — `resumeType` skiller dem for UI-tekst.
 */
export interface AdminGame1ResumedEvent {
  gameId: string;
  /** Unix-ms. */
  resumedAt: number;
  actorUserId: string;
  /** `current_phase` engine vender tilbake til å trekke kuler for. */
  phase: number;
  /** 'auto' = avsluttet auto-pause; 'manual' = avsluttet eksplisitt master-pause. */
  resumeType: "auto" | "manual";
}

export interface AdminGame1Broadcaster {
  onStatusChange(event: AdminGame1StatusChangeEvent): void;
  onDrawProgressed(event: AdminGame1DrawProgressedEvent): void;
  onPhaseWon(event: AdminGame1PhaseWonEvent): void;
  /** PT4: fysisk-bong vinn-broadcast. */
  onPhysicalTicketWon(event: AdminGame1PhysicalTicketWonEvent): void;
  /** Task 1.1: auto-pause etter phase-won. */
  onAutoPaused(event: AdminGame1AutoPausedEvent): void;
  /** Task 1.1: manuell resume (fra auto-pause eller manuell pause). */
  onResumed(event: AdminGame1ResumedEvent): void;
}

/** No-op fallback — brukes i tester uten socket-miljø + ved manglende injeksjon. */
export const NoopAdminGame1Broadcaster: AdminGame1Broadcaster = {
  onStatusChange: () => undefined,
  onDrawProgressed: () => undefined,
  onPhaseWon: () => undefined,
  onPhysicalTicketWon: () => undefined,
  onAutoPaused: () => undefined,
  onResumed: () => undefined,
};
