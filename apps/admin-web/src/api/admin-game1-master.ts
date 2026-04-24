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

export interface Game1MasterAuditEntry {
  id: string;
  action: Game1MasterAction;
  actorUserId: string;
  actorHallId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
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
}

export async function fetchGame1Detail(gameId: string): Promise<Game1GameDetail> {
  return apiRequest<Game1GameDetail>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}`,
    { auth: true }
  );
}

export async function startGame1(
  gameId: string,
  confirmExcludedHalls?: string[]
): Promise<Game1MasterActionResponse> {
  const body: Record<string, unknown> = {};
  if (confirmExcludedHalls !== undefined) {
    body.confirmExcludedHalls = confirmExcludedHalls;
  }
  return apiRequest<Game1MasterActionResponse>(
    `/api/admin/game1/games/${encodeURIComponent(gameId)}/start`,
    { method: "POST", auth: true, body }
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
