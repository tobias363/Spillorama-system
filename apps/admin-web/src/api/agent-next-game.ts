/**
 * Agent-portal Next Game — API-adapter.
 *
 * Tynn wrapper rundt de eksisterende admin-hall-endpointene (BIN-460 +
 * BIN-515). Agent-rollen arver ROOM_CONTROL_WRITE via hall-scope når
 * backend er konfigurert for det — dette modulet kaster bare gjennom
 * feilen så UI-laget kan vise "Forbidden" hvis så ikke er tilfelle.
 *
 * Backend-endpointer brukt:
 *   - GET  /api/admin/rooms                              — scope-filtrert
 *   - POST /api/admin/rooms/:code/start                  — start game
 *   - POST /api/admin/rooms/:code/game/pause             — PAUSE
 *   - POST /api/admin/rooms/:code/game/resume            — Resume
 *   - POST /api/admin/rooms/:code/end                    — Force End
 *   - POST /api/admin/rooms/:code/room-ready             — broadcast
 *                                                          ready+countdown
 *
 * Hvorfor HTTP heller enn socket: admin:pause-game/resume-game/force-end
 * krever socket-login først. HTTP-endpointene bruker JWT fra
 * getToken() direkte og er dermed enklere å kalle fra en SPA som allerede
 * er autentisert. Live-oppdateringer går via AgentHallSocket.
 */

import { apiRequest } from "./client.js";

export interface AgentRoomSummary {
  code: string;
  hallId: string;
  hallName?: string;
  gameSlug?: string;
  status?: string;
  currentGame?: {
    id: string;
    status: string;
    gameType?: string;
    gameSlug?: string;
    startedAt?: string;
    endsAt?: string;
    ticketPrice?: number;
    minTicketCount?: number;
    luckyNumberPrize?: number;
  } | null;
  createdAt?: string;
}

export interface AgentRoomActionResult {
  roomCode: string;
  snapshot?: unknown;
  isPaused?: boolean;
}

export interface AgentRoomReadyResult {
  kind: "room-ready";
  roomCode: string;
  hallId: string | null;
  at: number;
  countdownSeconds?: number;
  message?: string;
  actor: { id: string; displayName: string };
}

/**
 * Liste rom scoped til kalleren. Backend gir `resolveHallScopeFilter(adminUser)`
 * for HALL_OPERATOR som kun eksponerer egen hall — for AGENT er scope styrt
 * av JWT. Vi filtrerer ikke igjen i UI; forventer at backend gir rett subset.
 */
export async function listAgentRooms(): Promise<AgentRoomSummary[]> {
  const raw = await apiRequest<AgentRoomSummary[]>("/api/admin/rooms", { auth: true });
  return Array.isArray(raw) ? raw : [];
}

/**
 * Start neste spill i rommet. Backend spawner Game 1-runde (eller
 * game-slug-scope-valgt variant) via engine.startGame. Tar kun manual-mode
 * gjennom eksisterende validator-kjede.
 */
export async function startNextGame(roomCode: string): Promise<AgentRoomActionResult> {
  return apiRequest<AgentRoomActionResult>(
    `/api/admin/rooms/${encodeURIComponent(roomCode)}/start`,
    { method: "POST", auth: true, body: {} },
  );
}

/** PAUSE pågående runde. Message valgfritt (audit-logges). */
export async function pauseRoomGame(
  roomCode: string,
  message?: string,
): Promise<AgentRoomActionResult> {
  const body: Record<string, unknown> = {};
  if (message && message.trim()) body.message = message.trim().slice(0, 200);
  return apiRequest<AgentRoomActionResult>(
    `/api/admin/rooms/${encodeURIComponent(roomCode)}/game/pause`,
    { method: "POST", auth: true, body },
  );
}

/** Fortsett spillet etter PAUSE. */
export async function resumeRoomGame(roomCode: string): Promise<AgentRoomActionResult> {
  return apiRequest<AgentRoomActionResult>(
    `/api/admin/rooms/${encodeURIComponent(roomCode)}/game/resume`,
    { method: "POST", auth: true, body: {} },
  );
}

/**
 * Avbryt spillet (Force End). Reason brukes til Lotteritilsynet-audit.
 */
export async function forceEndRoomGame(
  roomCode: string,
  reason: string,
): Promise<AgentRoomActionResult> {
  return apiRequest<AgentRoomActionResult>(
    `/api/admin/rooms/${encodeURIComponent(roomCode)}/end`,
    { method: "POST", auth: true, body: { reason: reason.trim() || "Manual end from agent" } },
  );
}

/**
 * Signaliser at hallens agent er klar — trigger admin:hall-event-broadcast
 * til alle i rommet (inkl. andre agenter på andre terminaler i samme hall)
 * + TV-display. Agent-portal Next-Game-panel bruker dette til 2-min-
 * countdown og "klar" / "ikke klar" popup.
 */
export async function markRoomReady(
  roomCode: string,
  opts?: { countdownSeconds?: number; message?: string },
): Promise<AgentRoomReadyResult> {
  const body: Record<string, unknown> = {};
  if (opts?.countdownSeconds !== undefined) {
    body.countdownSeconds = Math.max(0, Math.floor(opts.countdownSeconds));
  }
  if (opts?.message && opts.message.trim()) {
    body.message = opts.message.trim().slice(0, 200);
  }
  return apiRequest<AgentRoomReadyResult>(
    `/api/admin/rooms/${encodeURIComponent(roomCode)}/room-ready`,
    { method: "POST", auth: true, body },
  );
}
