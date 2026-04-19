// PR-B2: admin player-activity API.
// Mirrors apps/backend/src/routes/adminPlayerActivity.ts (BIN-587 B5-rest).

import { apiRequest } from "./client.js";

export interface WalletTransaction {
  id: string;
  walletId: string;
  amount: number;
  type: string;
  description?: string | null;
  externalRef?: string | null;
  createdAt: string;
}

export interface WalletTxResult {
  userId: string;
  walletId: string;
  transactions: WalletTransaction[];
  count: number;
}

export async function listPlayerTransactions(id: string, limit = 100): Promise<WalletTxResult> {
  return apiRequest<WalletTxResult>(
    `/api/admin/players/${encodeURIComponent(id)}/transactions?limit=${limit}`,
    { auth: true }
  );
}

export interface LedgerEntry {
  id: string;
  walletId: string;
  amount: number;
  type: string;
  gameId?: string | null;
  gameSlug?: string | null;
  hallId?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface GameHistoryResult {
  userId: string;
  walletId: string;
  entries: LedgerEntry[];
  count: number;
}

export interface GameHistoryParams {
  dateFrom?: string;
  dateTo?: string;
  hallId?: string;
  limit?: number;
}

export async function listPlayerGameHistory(
  id: string,
  params: GameHistoryParams = {}
): Promise<GameHistoryResult> {
  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.hallId) qs.set("hallId", params.hallId);
  qs.set("limit", String(params.limit ?? 200));
  return apiRequest<GameHistoryResult>(
    `/api/admin/players/${encodeURIComponent(id)}/game-history?${qs}`,
    { auth: true }
  );
}
