// ADMIN Super-User Operations Console — admin-ops API wrapper.
//
// Path-prefix: /api/admin/ops/*
//
// GET    /api/admin/ops/overview                     → OpsOverviewResponse
// GET    /api/admin/ops/alerts                       → { alerts: OpsAlert[] }
// POST   /api/admin/ops/alerts/:id/acknowledge       → { alert: OpsAlert }
// POST   /api/admin/ops/halls/:id/disable            body: { reason: string }
// POST   /api/admin/ops/halls/:id/enable
// POST   /api/admin/ops/rooms/:code/force-pause      → { ok: true }
// POST   /api/admin/ops/rooms/:code/force-resume     → { ok: true }
// POST   /api/admin/ops/rooms/:code/force-end        body: { reason: string }
// POST   /api/admin/ops/rooms/:code/skip-ball        → { ok: true }
//
// Socket-event (default ns): admin:ops:update      payload: OpsOverviewDelta
//
// RBAC: ADMIN + super-admin only. Backend enforces — frontend mounts the
// route only for those roles, but never trusts the client.
//
// Backend-agent (feat/admin-ops-console-backend) ships these endpoints in
// parallel; until merged, the page renders with a loading-skeleton and
// a clear error-state if the request 404s.

import { apiRequest } from "./client.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface OpsHall {
  id: string;
  name: string;
  hallNumber: number | null;
  groupOfHallsId: string | null;
  groupName: string | null;
  /** Master hall id for the GoH (used by Spill 1 multi-hall). */
  masterHallId: string | null;
  isActive: boolean;
  isTestHall: boolean;
  activeRoomCount: number;
  playersOnline: number;
}

export type OpsRoomStatus =
  | "NONE"
  | "WAITING"
  | "RUNNING"
  | "PAUSED"
  | "ENDED";

export interface OpsRoomGame {
  id: string;
  status: OpsRoomStatus;
  drawnNumbersCount: number;
  maxDraws: number;
  isPaused: boolean;
  endedReason: string | null;
}

export interface OpsRoom {
  code: string;
  hallId: string;
  currentGame: OpsRoomGame | null;
  playersOnline: number;
  /** ISO-8601 timestamp of last draw, or null if no draw yet. */
  lastDrawAt: string | null;
}

export interface OpsGroupAggregate {
  id: string;
  name: string;
  hallCount: number;
  /**
   * Aggregate-string showing per-group ready-state, e.g. "4/4" or "2/3".
   * Backend computes this from per-hall ready-flags. Null when no game
   * is currently in ready/start phase.
   */
  readyAggregate: string | null;
  /** Total payout (NOK) for the calendar day, summed across the group. */
  totalPayoutToday: number;
}

export type OpsAlertSeverity = "INFO" | "WARN" | "CRITICAL";

export type OpsAlertType =
  // Stuck draw — RUNNING with no draw progress for >60s.
  | "DRAW_STUCK"
  // Master hall did not start runde innen forventet vindu.
  | "MASTER_NOT_READY"
  // Settlement unfinished or shift-end check failed.
  | "SETTLEMENT_WARN"
  // Hall nearing/exceeded payout-cap (per-hall cash-balanse).
  | "HALL_CASH_LOW"
  // Reconciliation diff > tolerance.
  | "RECON_DIFF"
  // Generisk feilmelding fra backend (system-level).
  | "SYSTEM_ERROR";

export interface OpsAlert {
  id: string;
  severity: OpsAlertSeverity;
  type: OpsAlertType;
  hallId: string | null;
  roomCode: string | null;
  message: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  createdAt: string;
}

export interface OpsMetrics {
  totalActiveRooms: number;
  totalPlayersOnline: number;
}

export interface OpsOverviewResponse {
  halls: OpsHall[];
  rooms: OpsRoom[];
  groups: OpsGroupAggregate[];
  alerts: OpsAlert[];
  metrics: OpsMetrics;
  /** Server-side timestamp of the snapshot, for client clock-skew display. */
  snapshotAt: string;
}

/**
 * Delta payload broadcast over `admin:ops:update`. Each field is optional —
 * the backend sends only the slices that changed since last broadcast. The
 * frontend merges by id-key (halls/rooms/groups/alerts) into the local
 * state-store.
 */
export interface OpsOverviewDelta {
  halls?: OpsHall[];
  rooms?: OpsRoom[];
  groups?: OpsGroupAggregate[];
  /** New or updated alerts. Use `alertsRemovedIds` to remove. */
  alerts?: OpsAlert[];
  alertsRemovedIds?: string[];
  metrics?: OpsMetrics;
  snapshotAt?: string;
}

// ── HTTP wrappers ────────────────────────────────────────────────────────

// FE-P0-003: optional AbortSignal so the consumer (AdminOpsConsolePage) can
// cancel an in-flight overview fetch when the page unmounts or a new
// fallback-poll tick supersedes a slow-pending one. Without cancellation,
// a stale 5 s-late overview can overwrite a newer one and flicker hall
// status backwards on the ops console — exactly the wrong UX during a
// pilot night.
export async function fetchOverview(opts: { signal?: AbortSignal } = {}): Promise<OpsOverviewResponse> {
  return apiRequest<OpsOverviewResponse>("/api/admin/ops/overview", {
    auth: true,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

export async function fetchAlerts(opts: { signal?: AbortSignal } = {}): Promise<{ alerts: OpsAlert[] }> {
  return apiRequest<{ alerts: OpsAlert[] }>("/api/admin/ops/alerts", {
    auth: true,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

export async function acknowledgeAlert(
  alertId: string
): Promise<{ alert: OpsAlert }> {
  return apiRequest<{ alert: OpsAlert }>(
    `/api/admin/ops/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    { method: "POST", auth: true }
  );
}

export async function disableHall(
  hallId: string,
  reason: string
): Promise<{ hall: OpsHall }> {
  return apiRequest<{ hall: OpsHall }>(
    `/api/admin/ops/halls/${encodeURIComponent(hallId)}/disable`,
    { method: "POST", auth: true, body: { reason } }
  );
}

export async function enableHall(hallId: string): Promise<{ hall: OpsHall }> {
  return apiRequest<{ hall: OpsHall }>(
    `/api/admin/ops/halls/${encodeURIComponent(hallId)}/enable`,
    { method: "POST", auth: true }
  );
}

export async function forcePauseRoom(roomCode: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    `/api/admin/ops/rooms/${encodeURIComponent(roomCode)}/force-pause`,
    { method: "POST", auth: true }
  );
}

export async function forceResumeRoom(roomCode: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    `/api/admin/ops/rooms/${encodeURIComponent(roomCode)}/force-resume`,
    { method: "POST", auth: true }
  );
}

export async function forceEndRoom(
  roomCode: string,
  reason: string
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    `/api/admin/ops/rooms/${encodeURIComponent(roomCode)}/force-end`,
    { method: "POST", auth: true, body: { reason } }
  );
}

export async function skipBall(roomCode: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    `/api/admin/ops/rooms/${encodeURIComponent(roomCode)}/skip-ball`,
    { method: "POST", auth: true }
  );
}
