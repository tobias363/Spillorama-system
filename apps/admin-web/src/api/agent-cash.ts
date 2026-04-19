// API wrappers for agent cash-in/out flows.
// Backs onto BIN-583 endpoints delivered in B3.2 / B3.4 / B3.6 / B3.7:
//   - agentTransactions.ts  (player lookup, cash in/out, physical tickets, transactions list)
//   - agentProducts.ts      (product catalog, cart CRUD, sales)
//   - agentMetronia.ts      (slot provider: Metronia)
//   - agentOkBingo.ts       (slot provider: OK Bingo)
//
// See PR-B1-PLAN.md §3 for endpoint mapping.

import { apiRequest } from "./client.js";

// ───────── Shared DTOs ─────────

export interface PlayerLookupResult {
  id: string;
  username: string;
  displayName?: string;
  balance: number;
  walletAmount?: number;
  hallId?: string;
  kycStatus?: string;
}

export interface TransactionListItem {
  id: string;
  type: "cash-in" | "cash-out" | "ticket-sale" | "product-sale" | "slot-topup" | "slot-payout" | "refund";
  amount: number;
  currency: "NOK";
  paymentType: "Cash" | "Card" | "customerNumber";
  playerId?: string;
  playerName?: string;
  createdAt: string;
  note?: string;
}

export type PaymentType = "Cash" | "Card" | "customerNumber";

// ───────── Player lookup / balance ─────────

export function lookupPlayer(query: {
  uniqueId?: string;
  username?: string;
  phone?: string;
  customerNumber?: string;
}): Promise<PlayerLookupResult> {
  return apiRequest<PlayerLookupResult>("/api/agent/players/lookup", {
    method: "POST",
    body: query,
    auth: true,
  });
}

export function getPlayerBalance(playerId: string): Promise<{ balance: number; walletAmount?: number }> {
  return apiRequest(`/api/agent/players/${encodeURIComponent(playerId)}/balance`, { auth: true });
}

// ───────── Cash in / cash out ─────────

export interface CashOperationRequest {
  amount: number;
  paymentType: PaymentType;
  uniqueId?: string;
  note?: string;
}

export interface CashOperationResult {
  transactionId: string;
  playerAfterBalance: number;
  dailyBalance: number;
}

export function cashIn(playerId: string, body: CashOperationRequest): Promise<CashOperationResult> {
  return apiRequest(`/api/agent/players/${encodeURIComponent(playerId)}/cash-in`, {
    method: "POST",
    body,
    auth: true,
  });
}

export function cashOut(playerId: string, body: CashOperationRequest): Promise<CashOperationResult> {
  return apiRequest(`/api/agent/players/${encodeURIComponent(playerId)}/cash-out`, {
    method: "POST",
    body,
    auth: true,
  });
}

// ───────── Physical tickets ─────────

export interface PhysicalInventoryItem {
  ticketType: string;
  ticketColor: string;
  initialId: number;
  finalId: number;
  count: number;
  unitPrice: number;
}

export function getPhysicalInventory(hallId?: string): Promise<PhysicalInventoryItem[]> {
  const qs = hallId ? `?hallId=${encodeURIComponent(hallId)}` : "";
  return apiRequest<PhysicalInventoryItem[]>(`/api/agent/physical/inventory${qs}`, { auth: true });
}

export interface SellPhysicalTicketRequest {
  gameId: string;
  finalId: number;
  initialId?: number;
  hallId?: string;
  agentId?: string;
}

export interface SellPhysicalTicketResult {
  saleId: string;
  ticketIds: string[];
  totalPrice: number;
  dailyBalance: number;
}

export function sellPhysicalTicket(body: SellPhysicalTicketRequest): Promise<SellPhysicalTicketResult> {
  return apiRequest("/api/agent/physical/sell", { method: "POST", body, auth: true });
}

export function cancelPhysicalSale(saleId: string): Promise<{ cancelled: true }> {
  return apiRequest("/api/agent/physical/sell/cancel", {
    method: "POST",
    body: { saleId },
    auth: true,
  });
}

export function registerTicket(body: { gameId: string; ticketNumber: string }): Promise<{ accepted: true }> {
  return apiRequest("/api/agent/tickets/register", { method: "POST", body, auth: true });
}

// ───────── Transactions list ─────────

export function listTransactionsToday(): Promise<TransactionListItem[]> {
  return apiRequest("/api/agent/transactions/today", { auth: true });
}

export interface TransactionListQuery {
  from?: string; // yyyy-mm-dd
  to?: string;
  type?: TransactionListItem["type"];
  playerId?: string;
  limit?: number;
  offset?: number;
}

export function listTransactions(q: TransactionListQuery = {}): Promise<TransactionListItem[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null) params.set(k, String(v));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiRequest(`/api/agent/transactions${qs}`, { auth: true });
}

export function getTransaction(id: string): Promise<TransactionListItem> {
  return apiRequest(`/api/agent/transactions/${encodeURIComponent(id)}`, { auth: true });
}

// ───────── Products (cart + checkout) ─────────

export interface ProductSummary {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
  category?: string;
  available: boolean;
}

export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CartSummary {
  id: string;
  hallId: string;
  userType: "registered" | "anonymous";
  userName?: string;
  playerId?: string;
  lines: CartLine[];
  totalAmount: number;
  status: "open" | "finalized" | "cancelled";
}

export function listProducts(hallId?: string): Promise<ProductSummary[]> {
  const qs = hallId ? `?hallId=${encodeURIComponent(hallId)}` : "";
  return apiRequest<ProductSummary[]>(`/api/agent/products${qs}`, { auth: true });
}

export interface CreateCartRequest {
  hallId: string;
  userType: "registered" | "anonymous";
  playerId?: string;
  userName?: string;
  lines: Array<{ productId: string; quantity: number }>;
}

export function createCart(body: CreateCartRequest): Promise<CartSummary> {
  return apiRequest<CartSummary>("/api/agent/products/carts", { method: "POST", body, auth: true });
}

export function getCart(id: string): Promise<CartSummary> {
  return apiRequest<CartSummary>(`/api/agent/products/carts/${encodeURIComponent(id)}`, { auth: true });
}

export interface FinalizeCartRequest {
  paymentType: PaymentType;
  note?: string;
}

export function finalizeCart(id: string, body: FinalizeCartRequest): Promise<{ orderId: string; dailyBalance: number }> {
  return apiRequest(`/api/agent/products/carts/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    body,
    auth: true,
  });
}

export function cancelCart(id: string): Promise<{ cancelled: true }> {
  return apiRequest(`/api/agent/products/carts/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    auth: true,
  });
}

export function getCurrentShiftProductSales(): Promise<{ totalAmount: number; orderCount: number; lines: CartLine[] }> {
  return apiRequest("/api/agent/products/sales/current-shift", { auth: true });
}
