// BIN-655 — admin-transactions (generisk transaksjons-logg) API wrapper.
//
// GET /api/admin/transactions?from&to&type&userId&hallId&cursor&limit
//   → { items: AdminTransactionRow[], nextCursor: string | null }
//
// Read-only. Kreves PLAYER_KYC_READ (ADMIN + SUPPORT).
// Cursor-paginert (base64url-offset, samme mønster som BIN-647).

import { apiRequest } from "./client.js";

export type AdminTransactionSource =
  | "wallet"
  | "agent"
  | "deposit_request"
  | "withdraw_request";

export interface AdminTransactionRow {
  id: string;
  source: AdminTransactionSource;
  type: string;
  amountCents: number;
  timestamp: string;
  userId: string | null;
  hallId: string | null;
  description: string;
}

export interface AdminTransactionsListResponse {
  items: AdminTransactionRow[];
  nextCursor: string | null;
}

export interface ListAdminTransactionsParams {
  from?: string;
  to?: string;
  /** `type` query på backend — mapper til source-enum. */
  source?: AdminTransactionSource;
  userId?: string;
  hallId?: string;
  cursor?: string;
  limit?: number;
}

export async function listAdminTransactions(
  params: ListAdminTransactionsParams = {}
): Promise<AdminTransactionsListResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.source) qs.set("type", params.source);
  if (params.userId) qs.set("userId", params.userId);
  if (params.hallId) qs.set("hallId", params.hallId);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<AdminTransactionsListResponse>(
    `/api/admin/transactions${suffix}`,
    { auth: true }
  );
}
