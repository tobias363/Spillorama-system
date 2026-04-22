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

export interface AdminGame1Broadcaster {
  onStatusChange(event: AdminGame1StatusChangeEvent): void;
  onDrawProgressed(event: AdminGame1DrawProgressedEvent): void;
}

/** No-op fallback — brukes i tester uten socket-miljø + ved manglende injeksjon. */
export const NoopAdminGame1Broadcaster: AdminGame1Broadcaster = {
  onStatusChange: () => undefined,
  onDrawProgressed: () => undefined,
};
