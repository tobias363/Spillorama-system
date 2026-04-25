// Wireframe gaps #8/#10/#11 (2026-04-24): API wrappers for Agent Unique ID flow.
// Endpoints: POST /create, POST /add-money, POST /withdraw, GET /details,
// POST /reprint, POST /regenerate.

import { apiRequest } from "./client.js";

export type UniqueIdPaymentType = "CASH" | "CARD";
export type UniqueIdStatus = "ACTIVE" | "WITHDRAWN" | "REGENERATED" | "EXPIRED";
export type UniqueIdActionType =
  | "CREATE"
  | "ADD_MONEY"
  | "WITHDRAW"
  | "REPRINT"
  | "REGENERATE";

export interface UniqueIdCard {
  id: string;
  hallId: string;
  balanceCents: number;
  purchaseDate: string;
  expiryDate: string;
  hoursValidity: number;
  paymentType: UniqueIdPaymentType;
  createdByAgentId: string;
  printedAt: string;
  reprintedCount: number;
  lastReprintedAt: string | null;
  lastReprintedBy: string | null;
  status: UniqueIdStatus;
  regeneratedFromId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UniqueIdTransaction {
  id: string;
  uniqueId: string;
  actionType: UniqueIdActionType;
  amountCents: number;
  previousBalance: number;
  newBalance: number;
  paymentType: UniqueIdPaymentType | null;
  agentUserId: string;
  gameType: string | null;
  reason: string | null;
  createdAt: string;
}

export interface UniqueIdDetailsResponse {
  card: UniqueIdCard;
  transactions: UniqueIdTransaction[];
  gameHistory: UniqueIdTransaction[];
}

export interface CreateUniqueIdRequest {
  hallId: string;
  amount: number;
  hoursValidity: number;
  paymentType: UniqueIdPaymentType;
}

export interface CreateUniqueIdResponse {
  card: UniqueIdCard;
  transaction: UniqueIdTransaction;
}

export interface AddMoneyRequest {
  amount: number;
  paymentType: UniqueIdPaymentType;
}

export interface WithdrawRequest {
  amount: number;
  /** Must be "CASH" per wireframe 17.11/17.28. */
  paymentType?: "CASH";
}

export interface BalanceMutationResponse {
  card: UniqueIdCard;
  transaction: UniqueIdTransaction;
}

export interface RegenerateResponse {
  previousCard: UniqueIdCard;
  newCard: UniqueIdCard;
  transferredBalanceCents: number;
}

export interface ListUniqueIdsResponse {
  cards: UniqueIdCard[];
  count: number;
}

export function createUniqueId(body: CreateUniqueIdRequest): Promise<CreateUniqueIdResponse> {
  return apiRequest<CreateUniqueIdResponse>("/api/agent/unique-ids", {
    method: "POST",
    body,
    auth: true,
  });
}

export function listUniqueIds(q: {
  hallId?: string;
  status?: UniqueIdStatus;
  limit?: number;
} = {}): Promise<ListUniqueIdsResponse> {
  const params = new URLSearchParams();
  if (q.hallId) params.set("hallId", q.hallId);
  if (q.status) params.set("status", q.status);
  if (q.limit !== undefined) params.set("limit", String(q.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<ListUniqueIdsResponse>(`/api/agent/unique-ids${qs}`, { auth: true });
}

export function getUniqueIdCard(id: string): Promise<UniqueIdCard> {
  return apiRequest<UniqueIdCard>(`/api/agent/unique-ids/${encodeURIComponent(id)}`, { auth: true });
}

export function getUniqueIdDetails(
  id: string,
  gameType?: string
): Promise<UniqueIdDetailsResponse> {
  const qs = gameType ? `?gameType=${encodeURIComponent(gameType)}` : "";
  return apiRequest<UniqueIdDetailsResponse>(
    `/api/agent/unique-ids/${encodeURIComponent(id)}/details${qs}`,
    { auth: true }
  );
}

export function addMoneyToUniqueId(
  id: string,
  body: AddMoneyRequest
): Promise<BalanceMutationResponse> {
  return apiRequest<BalanceMutationResponse>(
    `/api/agent/unique-ids/${encodeURIComponent(id)}/add-money`,
    { method: "POST", body, auth: true }
  );
}

export function withdrawFromUniqueId(
  id: string,
  body: WithdrawRequest
): Promise<BalanceMutationResponse> {
  return apiRequest<BalanceMutationResponse>(
    `/api/agent/unique-ids/${encodeURIComponent(id)}/withdraw`,
    { method: "POST", body, auth: true }
  );
}

export function reprintUniqueId(
  id: string,
  body: { reason?: string } = {}
): Promise<BalanceMutationResponse> {
  return apiRequest<BalanceMutationResponse>(
    `/api/agent/unique-ids/${encodeURIComponent(id)}/reprint`,
    { method: "POST", body, auth: true }
  );
}

export function regenerateUniqueId(id: string): Promise<RegenerateResponse> {
  return apiRequest<RegenerateResponse>(
    `/api/agent/unique-ids/${encodeURIComponent(id)}/regenerate`,
    { method: "POST", auth: true }
  );
}
