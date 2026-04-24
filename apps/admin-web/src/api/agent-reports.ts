/**
 * BIN-17.32: Agent-reports API-wrappers.
 *
 * Per nå dekker denne Past Game Winning History (17.32). Oppfølger-rapporter
 * (Payout History, Transaction History, etc.) følger samme mønster.
 */

import { apiRequest } from "./client.js";

export interface PastWinningHistoryRow {
  dateTime: string;
  ticketId: string;
  ticketType: string;
  ticketColor: string;
  priceCents: number | null;
  winningPattern: string | null;
}

export interface PastWinningHistoryResponse {
  from: string;
  to: string;
  generatedAt: string;
  hallId: string | null;
  rows: PastWinningHistoryRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface PastWinningHistoryQuery {
  from?: string;
  to?: string;
  hallId?: string;
  ticketId?: string;
  offset?: number;
  limit?: number;
}

export async function getPastWinningHistory(
  q: PastWinningHistoryQuery,
): Promise<PastWinningHistoryResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  const path = qs
    ? `/api/agent/reports/past-winning-history?${qs}`
    : "/api/agent/reports/past-winning-history";
  return apiRequest<PastWinningHistoryResponse>(path, { auth: true });
}
