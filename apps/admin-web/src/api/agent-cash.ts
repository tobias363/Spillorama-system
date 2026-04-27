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

// ───────── Wireframe 17.7 + 17.8: Add Money / Withdraw — Registered User ─────────

export interface AgentUserSearchRow {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  walletBalance: number;
}

export interface AgentUserCashResponse {
  transaction: {
    id: string;
    actionType: string;
    amount: number;
    paymentMethod: string;
    previousBalance: number;
    afterBalance: number;
    hallId: string;
    shiftId: string;
    createdAt: string;
  };
  amlFlagged: boolean;
}

/**
 * Wireframe 17.7/17.8: PLAYER-søk i agentens hall. Brukes av autocomplete-
 * dropdown i AddMoneyRegisteredUserModal + WithdrawRegisteredUserModal.
 * Returnerer inntil 10 rader inklusive wallet-saldo.
 */
export function searchUsersForAgent(query: string): Promise<{ users: AgentUserSearchRow[]; query: string }> {
  const qs = `?q=${encodeURIComponent(query)}`;
  return apiRequest(`/api/agent/transactions/search-users${qs}`, { auth: true });
}

export interface AddMoneyRegisteredUserRequest {
  targetUserId: string;
  amount: number;
  paymentType: "Cash" | "Card";
  clientRequestId: string;
  notes?: string;
}

export interface WithdrawRegisteredUserRequest {
  targetUserId: string;
  amount: number;
  paymentType: "Cash";
  clientRequestId: string;
  notes?: string;
  /** Sendt etter second-opinion-dialog for uttak > 10 000 NOK. */
  requireConfirm?: boolean;
}

export function addMoneyToRegisteredUser(body: AddMoneyRegisteredUserRequest): Promise<AgentUserCashResponse> {
  return apiRequest("/api/agent/transactions/add-money-user", {
    method: "POST",
    body,
    auth: true,
  });
}

export function withdrawFromRegisteredUser(body: WithdrawRegisteredUserRequest): Promise<AgentUserCashResponse> {
  return apiRequest("/api/agent/transactions/withdraw-user", {
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
//
// Backend (BIN-583 B3.6) eier:
//   GET  /api/agent/products                  → ProductListEnvelope
//   POST /api/agent/products/carts            → CartSummary
//                                               (userType=ONLINE|PHYSICAL, lines)
//   POST /api/agent/products/carts/:id/finalize → FinalizeCartResponse
//                                               (paymentMethod, expectedTotalCents, clientRequestId)
//   POST /api/agent/products/carts/:id/cancel → CartSummary
//   GET  /api/agent/products/sales/current-shift → { shiftId, sales[], count }
//
// listProducts() mapper backend-shape (priceCents) til UI-friendly NOK.

export interface ProductSummary {
  id: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  category?: string;
  available: boolean;
}

export interface CartLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export type ProductCartUserType = "ONLINE" | "PHYSICAL";
export type ProductPaymentMethod = "CASH" | "CARD" | "CUSTOMER_NUMBER";

export interface CartSummary {
  id: string;
  orderId: string;
  agentUserId: string;
  hallId: string;
  shiftId: string;
  userType: ProductCartUserType;
  userId: string | null;
  username: string | null;
  totalCents: number;
  status: "CART_CREATED" | "ORDER_PLACED" | "CANCELLED";
  lines: CartLine[];
  createdAt: string;
  updatedAt: string;
}

interface ProductListEnvelope {
  hallId: string;
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    categoryId: string | null;
    status: "ACTIVE" | "INACTIVE";
  }>;
  count: number;
}

export async function listProducts(hallId?: string): Promise<ProductSummary[]> {
  const qs = hallId ? `?hallId=${encodeURIComponent(hallId)}` : "";
  // Backend scopes to agent's active-shift hall — `hallId` query is ignored
  // there but we keep the parameter for forward-compat.
  const env = await apiRequest<ProductListEnvelope>(`/api/agent/products${qs}`, { auth: true });
  return (env.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.priceCents / 100,
    description: p.description ?? undefined,
    available: p.status === "ACTIVE",
  }));
}

export interface CreateCartRequest {
  userType: ProductCartUserType;
  userId?: string | null;
  username?: string | null;
  lines: Array<{ productId: string; quantity: number }>;
}

export function createCart(body: CreateCartRequest): Promise<CartSummary> {
  return apiRequest<CartSummary>("/api/agent/products/carts", { method: "POST", body, auth: true });
}

export function getCart(id: string): Promise<CartSummary> {
  return apiRequest<CartSummary>(`/api/agent/products/carts/${encodeURIComponent(id)}`, { auth: true });
}

export interface FinalizeCartRequest {
  paymentMethod: ProductPaymentMethod;
  expectedTotalCents: number;
  clientRequestId: string;
}

export interface FinalizeCartResponse {
  sale: {
    id: string;
    orderId: string;
    totalCents: number;
    paymentMethod: ProductPaymentMethod;
    createdAt: string;
  };
  cart: CartSummary;
}

export function finalizeCart(
  id: string,
  body: FinalizeCartRequest,
): Promise<FinalizeCartResponse> {
  return apiRequest(`/api/agent/products/carts/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    body,
    auth: true,
  });
}

export function cancelCart(id: string): Promise<CartSummary> {
  return apiRequest<CartSummary>(`/api/agent/products/carts/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    auth: true,
  });
}

export interface ShiftProductSaleRow {
  id: string;
  cartId: string;
  orderId: string;
  paymentMethod: ProductPaymentMethod;
  totalCents: number;
  createdAt: string;
}

export function getCurrentShiftProductSales(): Promise<{
  shiftId: string | null;
  sales: ShiftProductSaleRow[];
  count: number;
}> {
  return apiRequest("/api/agent/products/sales/current-shift", { auth: true });
}
