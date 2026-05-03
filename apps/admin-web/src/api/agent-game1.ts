/**
 * Task 1.4 (2026-04-24): admin-web API-adapter for unified agent-portal
 * Spill 1-control mot `scheduled_games`-paradigmet.
 *
 * Backend-router: apps/backend/src/routes/agentGame1.ts
 *   - GET  /api/agent/game1/current-game
 *   - GET  /api/agent/game1/hall-status
 *   - POST /api/agent/game1/start
 *   - POST /api/agent/game1/resume
 *
 * Permissions: GAME1_MASTER_WRITE (samme som master-konsollet). Agent-
 * router legger til hall-scope-sjekk: kun master-hall-agent kan POSTe
 * start/resume, mens GET-endepunkter er tilgjengelig for alle deltakende
 * haller slik at slave-agenter også kan rendre status-stripen.
 */

import { apiRequest } from "./client.js";

export interface Spill1CurrentGameHall {
  hallId: string;
  hallName: string;
  isReady: boolean;
  readyAt: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
  excludedFromGame: boolean;
  excludedReason: string | null;
}

export interface Spill1CurrentGame {
  id: string;
  status: string;
  masterHallId: string;
  groupHallId: string;
  participatingHallIds: string[];
  subGameName: string;
  customGameName: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
}

export interface Spill1CurrentGameResponse {
  hallId: string;
  isMasterAgent: boolean;
  currentGame: Spill1CurrentGame | null;
  halls: Spill1CurrentGameHall[];
  allReady: boolean;
}

export interface Spill1HallStatusEntry {
  hallId: string;
  hallName: string;
  isReady: boolean;
  excludedFromGame: boolean;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
}

export interface Spill1HallStatusResponse {
  hallId: string;
  gameId: string | null;
  halls: Spill1HallStatusEntry[];
  allReady: boolean;
}

export interface Spill1ActionResponse {
  gameId: string;
  status: string;
  actualStartTime?: string | null;
  auditId: string;
}

export async function fetchAgentGame1CurrentGame(
  opts: { signal?: AbortSignal } = {}
): Promise<Spill1CurrentGameResponse> {
  return apiRequest<Spill1CurrentGameResponse>(
    "/api/agent/game1/current-game",
    { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
  );
}

export async function fetchAgentGame1HallStatus(): Promise<Spill1HallStatusResponse> {
  return apiRequest<Spill1HallStatusResponse>(
    "/api/agent/game1/hall-status",
    { auth: true }
  );
}

/**
 * REQ-007 (2026-04-26): start Spill 1 med valgfrie override-lister.
 *
 *   - `confirmExcludedHalls`: bekreft haller som allerede er ekskludert
 *     (admin/master har klikket "ekskluder" tidligere).
 *   - `confirmUnreadyHalls`: master overstyrer "agents not ready"-popup ved
 *     å eksplisitt bekrefte at disse hallene SKAL ekskluderes selv om de
 *     ikke har trykket klar. Backend skriver `start_game_with_unready_override`
 *     audit-event og setter excluded_from_game=true for hver hall i listen.
 */
export async function startAgentGame1(
  confirmExcludedHalls?: string[],
  confirmUnreadyHalls?: string[]
): Promise<Spill1ActionResponse> {
  const body: Record<string, unknown> = {};
  if (confirmExcludedHalls !== undefined) {
    body.confirmExcludedHalls = confirmExcludedHalls;
  }
  if (confirmUnreadyHalls !== undefined) {
    body.confirmUnreadyHalls = confirmUnreadyHalls;
  }
  return apiRequest<Spill1ActionResponse>(
    "/api/agent/game1/start",
    { method: "POST", auth: true, body }
  );
}

export async function resumeAgentGame1(): Promise<Spill1ActionResponse> {
  return apiRequest<Spill1ActionResponse>(
    "/api/agent/game1/resume",
    { method: "POST", auth: true, body: {} }
  );
}

/**
 * 2026-05-02 (Tobias UX-feedback): non-master agent kan markere egen hall
 * som klar. Backend-rute er admin-side (`/api/admin/game1/halls/:hallId/ready`)
 * men AGENT har `GAME1_HALL_READY_WRITE`-permission + hall-scope.
 */
export async function markHallReadyForGame(
  hallId: string,
  gameId: string,
  digitalTicketsSold?: number
): Promise<unknown> {
  const body: Record<string, unknown> = { gameId };
  if (typeof digitalTicketsSold === "number") {
    body.digitalTicketsSold = digitalTicketsSold;
  }
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/ready`,
    { method: "POST", auth: true, body }
  );
}

export async function unmarkHallReadyForGame(
  hallId: string,
  gameId: string
): Promise<unknown> {
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/unready`,
    { method: "POST", auth: true, body: { gameId } }
  );
}
/**
 * 2026-05-02: bingovert markerer egen hall som "Ingen kunder" — hallen
 * ekskluderes fra runden. Master-konsollet ser hallen som rød. Agent
 * kan re-åpne via `setHallHasCustomersForGame`.
 *
 * Backend-rute: POST /api/admin/game1/halls/:hallId/no-customers
 * Permission:   GAME1_HALL_READY_WRITE + hall-scope (egen hall)
 */
export async function setHallNoCustomersForGame(
  hallId: string,
  gameId: string,
  reason?: string
): Promise<unknown> {
  const body: Record<string, unknown> = { gameId };
  if (reason && reason.trim()) {
    body.reason = reason.trim();
  }
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/no-customers`,
    { method: "POST", auth: true, body }
  );
}

/**
 * 2026-05-02: bingovert un-ekskluderer egen hall (angrer "Ingen kunder").
 *
 * Backend-rute: POST /api/admin/game1/halls/:hallId/has-customers
 */
export async function setHallHasCustomersForGame(
  hallId: string,
  gameId: string
): Promise<unknown> {
  return apiRequest<unknown>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/has-customers`,
    { method: "POST", auth: true, body: { gameId } }
  );
}

/**
 * 2026-05-02: master-agent stopper aktiv runde fra cash-inout-dashboardet.
 *
 * Backend-rute: POST /api/agent/game1/stop
 */
export async function stopAgentGame1(reason?: string): Promise<Spill1ActionResponse> {
  const body: Record<string, unknown> = {};
  if (reason && reason.trim()) {
    body.reason = reason.trim();
  }
  return apiRequest<Spill1ActionResponse>(
    "/api/agent/game1/stop",
    { method: "POST", auth: true, body }
  );
}
