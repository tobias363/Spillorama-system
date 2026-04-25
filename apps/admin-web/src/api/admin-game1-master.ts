// GAME1_SCHEDULE PR 3: admin-web API-adapter for master-control-flow.
//
// Backend-router: apps/backend/src/routes/adminGame1Master.ts
// Permissions: GAME1_MASTER_WRITE for writes; GAME1_GAME_READ for GET.

import { apiRequest } from "./client.js";

export type Game1MasterAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "exclude_hall"
  | "include_hall"
  | "timeout_detected";

export interface Game1MasterActionResponse {
  gameId: string;
  status: string;
  auditId: string;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  hallId?: string;
}

export interface Game1HallDetail {
  hallId: string;
  hallName: string;
  isReady: boolean;
  readyAt: string | null;
  readyByUserId: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
  excludedFromGame: boolean;
  excludedReason: string | null;
}

/**
 * TASK HS: beriket per-hall status med farge-kode + scan-data.
 * Hentes fra GET /api/admin/game1/games/:gameId/hall-status.
 */
export type HallStatusColor = "red" | "orange" | "green";

export interface Game1HallStatus {
  hallId: string;
  hallName: string;
  color: HallStatusColor;
  playerCount: number;
  startScanDone: boolean;
  finalScanDone: boolean;
  readyConfirmed: boolean;
  soldCount: number;
  startTicketId: string | null;
  finalScanTicketId: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
  excludedFromGame: boolean;
  excludedReason: string | null;
}

export interface Game1HallStatusResponse {
  gameId: string;
  halls: Game1HallStatus[];
}

export interface Game1MasterAuditEntry {
  id: string;
  action: Game1MasterAction;
  actorUserId: string;
  actorHallId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * MASTER_PLAN §2.3 — jackpot-state for hall-gruppen spillet tilhører.
 * Vises i master-konsoll-header og brukt som source-of-truth for
 * confirm-popup pre-start.
 */
export interface Game1JackpotState {
  currentAmountCents: number;
  maxCapCents: number;
  dailyIncrementCents: number;
  drawThresholds: number[];
  lastAccumulationDate: string;
}

export interface Game1GameDetail {
  game: {
    id: string;
    status: string;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    actualStartTime: string | null;
    actualEndTime: string | null;
    masterHallId: string;
    groupHallId: string;
    participatingHallIds: string[];
    subGameName: string;
    customGameName: string | null;
    startedByUserId: string | null;
    stoppedByUserId: string | null;
    stopReason: string | null;
  };
  halls: Game1HallDetail[];
  allReady: boolean;
  auditRecent: Game1MasterAuditEntry[];
  /**
   * Task 1.1: engine-state speiling. Satt når draw-engine er startet
   * (status='running'|'paused'). Brukes av Game1MasterConsole til å
   * vise auto-pause-banner + aktivere Resume-knapp.
   *
   * Valgfri i type fordi eksisterende backend-responser ikke alltid
   * inkluderer feltet ennå; UI faller bakover til `game.status`-sjekk
   * når engineState mangler.
   */
  engineState?: {
    isPaused: boolean;
    pausedAtPhase: number | null;
    currentPhase: number;
    drawsCompleted: number;
    isFinished: boolean;
  } | null;
  /**
   * MASTER_PLAN §2.3 — nåværende jackpot-state. null hvis jackpot-service
   * ikke er wired i backend (legacy-mode) eller hall-gruppen mangler state.
   */
  jackpot: Game1JackpotState | null;
}

export async function fetchGame1Detail(gameId: string): Promise<Game1GameDetail> {
  return apiRequest<Game1GameDetail>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}`,
    { auth: true }
  );
}

/**
 * Task 1.5: valgfri override-flagg for `startGame1`. Sendes når master velger
 * "Start uansett" i "Agents not ready"-popupen.
 *   - `confirmExcludedHalls`: haller master aktivt ekskluderte før start.
 *   - `confirmUnreadyHalls`: haller som var orange (ikke-klar) på start-
 *     tidspunktet og som master bekrefter skal ekskluderes fra runden.
 *   - `confirmExcludeRedHalls`: haller som er røde (0 spillere) — auto-
 *     ekskluderes (forward-compat mot HS #451).
 */
export interface StartGame1Overrides {
  confirmExcludedHalls?: string[];
  confirmUnreadyHalls?: string[];
  confirmExcludeRedHalls?: string[];
}

export async function startGame1(
  gameId: string,
  overrides?: StartGame1Overrides | string[],
  jackpotConfirmed?: boolean
): Promise<Game1MasterActionResponse & { jackpotAmountCents?: number | null }> {
  const body: Record<string, unknown> = {};
  // Backward-compat: tidligere signatur `startGame1(gameId, confirmExcludedHalls?)`
  // støttes fortsatt.
  if (Array.isArray(overrides)) {
    body.confirmExcludedHalls = overrides;
  } else if (overrides) {
    if (overrides.confirmExcludedHalls !== undefined) {
      body.confirmExcludedHalls = overrides.confirmExcludedHalls;
    }
    if (overrides.confirmUnreadyHalls !== undefined) {
      body.confirmUnreadyHalls = overrides.confirmUnreadyHalls;
    }
    // TASK HS: ny liste for røde haller (0 spillere) som master eksplisitt
    // ekskluderer fra dagens spill.
    if (overrides.confirmExcludeRedHalls !== undefined) {
      body.confirmExcludeRedHalls = overrides.confirmExcludeRedHalls;
    }
  }
  if (jackpotConfirmed === true) {
    body.jackpotConfirmed = true;
  }
  return apiRequest<Game1MasterActionResponse & { jackpotAmountCents?: number | null }>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/start`,
    { method: "POST", auth: true, body }
  );
}

/**
 * MASTER_PLAN §2.3 — fetch jackpot-state direkte (uten å gå via game-detail).
 * Null når jackpot-service ikke er wired i backend.
 */
export async function fetchGame1JackpotState(
  hallGroupId: string
): Promise<{ jackpot: (Game1JackpotState & { hallGroupId: string }) | null }> {
  return apiRequest<{ jackpot: (Game1JackpotState & { hallGroupId: string }) | null }>(
    `/api/admin/game1/jackpot-state/${encodeURIComponent(hallGroupId)}`,
    { auth: true }
  );
}

// TASK HS ───────────────────────────────────────────────────────────────────

export async function fetchGame1HallStatus(
  gameId: string
): Promise<Game1HallStatusResponse> {
  return apiRequest<Game1HallStatusResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/hall-status`,
    { auth: true }
  );
}

export interface Game1ScanResponse {
  gameId: string;
  hallId: string;
  startTicketId: string | null;
  finalScanTicketId: string | null;
  startScannedAt?: string | null;
  finalScannedAt?: string | null;
  physicalTicketsSold?: number;
}

export async function recordGame1StartScan(
  gameId: string,
  hallId: string,
  ticketId: string
): Promise<Game1ScanResponse> {
  return apiRequest<Game1ScanResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/halls/${encodeURIComponent(hallId)}/scan-start`,
    { method: "POST", auth: true, body: { ticketId } }
  );
}

export async function recordGame1FinalScan(
  gameId: string,
  hallId: string,
  ticketId: string
): Promise<Game1ScanResponse> {
  return apiRequest<Game1ScanResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/halls/${encodeURIComponent(hallId)}/scan-final`,
    { method: "POST", auth: true, body: { ticketId } }
  );
}

export async function excludeGame1Hall(
  gameId: string,
  hallId: string,
  reason: string
): Promise<Game1MasterActionResponse> {
  return apiRequest<Game1MasterActionResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/exclude-hall`,
    {
      method: "POST",
      auth: true,
      body: { hallId, reason },
    }
  );
}

export async function includeGame1Hall(
  gameId: string,
  hallId: string
): Promise<Game1MasterActionResponse> {
  return apiRequest<Game1MasterActionResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/include-hall`,
    {
      method: "POST",
      auth: true,
      body: { hallId },
    }
  );
}

export async function pauseGame1(
  gameId: string,
  reason?: string
): Promise<Game1MasterActionResponse> {
  const body: Record<string, unknown> = {};
  if (reason !== undefined && reason.trim()) body.reason = reason.trim();
  return apiRequest<Game1MasterActionResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/pause`,
    { method: "POST", auth: true, body }
  );
}

export async function resumeGame1(gameId: string): Promise<Game1MasterActionResponse> {
  return apiRequest<Game1MasterActionResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/resume`,
    { method: "POST", auth: true, body: {} }
  );
}

export async function stopGame1(
  gameId: string,
  reason: string
): Promise<Game1MasterActionResponse> {
  return apiRequest<Game1MasterActionResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/stop`,
    {
      method: "POST",
      auth: true,
      body: { reason },
    }
  );
}
