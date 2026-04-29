import { apiRequest, ApiError } from "./client.js";

// ── Halls ────────────────────────────────────────────────────────────────────

export interface AdminHall {
  id: string;
  name: string;
  isActive: boolean;
}

export async function listHalls(opts: { signal?: AbortSignal } = {}): Promise<AdminHall[]> {
  const raw = await apiRequest<AdminHall[] | { halls: AdminHall[] }>(
    "/api/admin/halls?includeInactive=true",
    { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
  );
  if (Array.isArray(raw)) return raw;
  return raw.halls ?? [];
}

// ── Admin users (agents) ─────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  isActive?: boolean;
  isDeleted?: boolean;
}

/**
 * Hent agents for dashboard "active agents"-widget.
 *
 * PR fix/admin-ux-polish (2026-04-23): tidligere kalt
 * `/api/admin/users?role=agent`, men backend's `/api/admin/users`
 * aksepterer kun ADMIN|SUPPORT|HALL_OPERATOR som role (BIN-587 B6).
 * AGENT er egen ressurs siden BIN-583 B3.1 — /api/admin/agents.
 * Tidligere feilaktig rute returnerte 400 INVALID_INPUT på hver
 * dashboard-poll og spammet DevTools-konsollen.
 *
 * Vi mapper `Agent { userId, agentStatus, ... }` til det dashboardet
 * allerede forventer (`AdminUser { id, isActive, ... }`) så widget-koden
 * ikke trenger å endres.
 */
interface DashboardAgentRow {
  userId: string;
  email: string;
  displayName: string;
  agentStatus: "active" | "inactive";
}

export async function listAgents(opts: { signal?: AbortSignal } = {}): Promise<AdminUser[]> {
  try {
    const res = await apiRequest<{ agents: DashboardAgentRow[] }>(
      "/api/admin/agents",
      { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
    );
    return (res.agents ?? []).map((a) => ({
      id: a.userId,
      email: a.email,
      displayName: a.displayName,
      role: "agent",
      isActive: a.agentStatus === "active",
      isDeleted: false,
    }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return [];
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return [];
    }
    throw err;
  }
}

// ── Rooms (source for ongoing games) ─────────────────────────────────────────

export interface AdminRoomSummary {
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

export async function listRooms(opts: { signal?: AbortSignal } = {}): Promise<AdminRoomSummary[]> {
  const raw = await apiRequest<AdminRoomSummary[]>(
    "/api/admin/rooms",
    { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
  );
  return Array.isArray(raw) ? raw : [];
}

// ── Players — approved count ─────────────────────────────────────────────────

// No dedicated `/api/admin/players/stats` yet (flagged as BIN-A2-API-2-approved).
// `players/search` requires a non-empty query — we can't use it for totals.
// Return null; DashboardPage displays `"—"` until the stats-endpoint lands.
export async function fetchApprovedPlayerCount(): Promise<number | null> {
  return null;
}

// ── Top 5 players — not yet available (BIN-A2-API-2) ─────────────────────────

export interface TopPlayerRow {
  id: string;
  username: string;
  avatar?: string;
  walletAmount: number;
}

export async function fetchTopPlayers(
  limit = 5,
  opts: { signal?: AbortSignal } = {}
): Promise<TopPlayerRow[] | null> {
  try {
    const raw = await apiRequest<{ players: TopPlayerRow[] } | TopPlayerRow[]>(
      `/api/admin/players/top?metric=wallet&limit=${limit}`,
      { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
    );
    if (Array.isArray(raw)) return raw;
    return raw.players ?? [];
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      // Endpoint not implemented yet — BIN-A2-API-2.
      return null;
    }
    // 400 INVALID_INPUT: f.eks. hvis backend-contracten endrer seg eller
    // hall-scope gir et query-avvik. Dashboardet skal aldri eskalere til
    // rød error-box for top-players — widget viser "—". Match 403 silent
    // return og behandle input-errors som "ingen data".
    if (err instanceof ApiError && err.status === 400) return null;
    if (err instanceof ApiError && err.status === 403) return [];
    throw err;
  }
}

// ── Hall groups — not yet available (BIN-A2-API-1) ───────────────────────────

export interface HallGroup {
  id: string;
  name: string;
  isActive: boolean;
}

export async function fetchHallGroups(opts: { signal?: AbortSignal } = {}): Promise<HallGroup[] | null> {
  try {
    const raw = await apiRequest<{ groups: HallGroup[] } | HallGroup[]>(
      "/api/admin/hall-groups",
      { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
    );
    if (Array.isArray(raw)) return raw;
    return raw.groups ?? [];
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      // Endpoint not implemented yet — BIN-A2-API-1.
      return null;
    }
    if (err instanceof ApiError && err.status === 403) return [];
    throw err;
  }
}

// ── Convenience aggregate ────────────────────────────────────────────────────

export interface SummaryCounts {
  totalApprovedPlayers: number | null;
  activeAgents: { active: number; total: number } | null;
  activeHallGroups: { active: number; total: number } | null;
  activeHalls: { active: number; total: number };
}

export async function fetchSummaryCounts(opts: { signal?: AbortSignal } = {}): Promise<SummaryCounts> {
  const signalOpt = opts.signal ? { signal: opts.signal } : {};
  const [players, agents, groups, halls] = await Promise.all([
    fetchApprovedPlayerCount(),
    listAgents(signalOpt).catch(() => [] as AdminUser[]),
    fetchHallGroups(signalOpt),
    listHalls(signalOpt).catch(() => [] as AdminHall[]),
  ]);

  const agentTotals = agents.length
    ? {
        active: agents.filter((a) => a.isActive !== false && a.isDeleted !== true).length,
        total: agents.length,
      }
    : null;

  const hallGroupTotals = groups
    ? { active: groups.filter((g) => g.isActive).length, total: groups.length }
    : null;

  const hallTotals = {
    active: halls.filter((h) => h.isActive).length,
    total: halls.length,
  };

  return {
    totalApprovedPlayers: players,
    activeAgents: agentTotals,
    activeHallGroups: hallGroupTotals,
    activeHalls: hallTotals,
  };
}
