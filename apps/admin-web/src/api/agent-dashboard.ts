// API wrappers for agent dashboard + player-list + CSV-export.
// Backs onto /api/agent/dashboard, /api/agent/players, /api/agent/players/:id/export.csv.
// AGENT-only — ADMIN/HALL_OPERATOR/SUPPORT bruker /api/admin/players.

import { apiRequest, getToken } from "./client.js";

export interface AgentDashboardLatestRequest {
  id: string;
  kind: "deposit" | "withdraw";
  userId: string;
  amountCents: number;
  createdAt: string;
}

export interface AgentDashboardTopPlayer {
  id: string;
  username: string;
  walletAmount: number;
  avatar?: string;
}

export interface AgentDashboardOngoingGame {
  roomCode: string;
  hallId: string;
  gameSlug: string;
  gameStatus: string;
  playerCount: number;
  createdAt: string;
}

export interface AgentDashboard {
  agent: {
    userId: string;
    email: string;
    displayName: string;
  };
  shift: {
    id: string;
    hallId: string;
    startedAt: string;
    endedAt: string | null;
    dailyBalance: number;
    totalCashIn: number;
    totalCashOut: number;
    totalCardIn: number;
    totalCardOut: number;
    sellingByCustomerNumber: number;
    hallCashBalance: number;
    settledAt: string | null;
  } | null;
  counts: {
    transactionsToday: number;
    playersInHall: number | null;
    activeShiftsInHall: number | null;
    pendingRequests: number | null;
  };
  recentTransactions: Array<{
    id: string;
    actionType: string;
    amount: number;
    paymentMethod: string;
    createdAt: string;
  }>;
  /** Wireframe widget — pending deposit-requests for agentens hall (max 5). */
  latestRequests: AgentDashboardLatestRequest[];
  /** Wireframe widget — top 5 spillere etter wallet-balanse i hallen. */
  topPlayers: AgentDashboardTopPlayer[];
  /** Wireframe widget — pågående spill (Spill 1-3 + SpinnGo) i hallen. */
  ongoingGames: AgentDashboardOngoingGame[];
}

export interface AgentPlayer {
  id: string;
  email: string;
  displayName: string;
  surname: string | null;
  phone: string | null;
  kycStatus: string;
  createdAt: string;
}

export interface AgentPlayerList {
  hallId: string;
  players: AgentPlayer[];
  count: number;
  limit: number;
}

export function getAgentDashboard(): Promise<AgentDashboard> {
  return apiRequest<AgentDashboard>("/api/agent/dashboard", { auth: true });
}

export function listAgentPlayers(opts?: {
  query?: string;
  limit?: number;
}): Promise<AgentPlayerList> {
  const params = new URLSearchParams();
  if (opts?.query) params.set("query", opts.query);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<AgentPlayerList>(`/api/agent/players${qs}`, { auth: true });
}

/**
 * Trigger CSV-download via window.open — fetch-basert fordi endepunktet
 * krever Authorization-header. Vi bruker Blob-nedlasting i stedet for
 * direkte navigasjon (som ville miste token-header).
 */
export async function downloadAgentPlayerExport(playerId: string): Promise<void> {
  const token = getToken();
  const res = await fetch(
    `/api/agent/players/${encodeURIComponent(playerId)}/export.csv`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "same-origin",
    }
  );
  if (!res.ok) {
    // Prøv å tolke JSON-feil fra backend
    const text = await res.text().catch(() => "");
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      throw new Error(parsed?.error?.message ?? `HTTP ${res.status}`);
    } catch {
      throw new Error(`HTTP ${res.status}`);
    }
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `agent-player-${playerId}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
