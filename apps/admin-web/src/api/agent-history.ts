/**
 * PDF 17 §17.29-§17.32: Agent history-list API-wrappers.
 *
 * Speiler backend-routen `routes/agentHistoryLists.ts`:
 *   - GET /api/agent/orders/history   — Order History (product sales)
 *   - GET /api/agent/orders/:id       — View Order Details
 *   - GET /api/agent/sold-tickets     — Sold Ticket UI
 *   - GET /api/agent/winnings-history — Past Game Winning History (alias)
 */

import { apiRequest } from "./client.js";

// ── Order History ──────────────────────────────────────────────────────────

export type OrderPaymentMethod = "CASH" | "CARD" | "CUSTOMER_NUMBER";

export interface OrderSale {
  id: string;
  cartId: string;
  orderId: string;
  hallId: string;
  shiftId: string;
  agentUserId: string;
  playerUserId: string | null;
  paymentMethod: OrderPaymentMethod;
  totalCents: number;
  walletTxId: string | null;
  agentTxId: string | null;
  createdAt: string;
}

export interface OrderHistoryResponse {
  sales: OrderSale[];
  total: number;
  from: string;
  to: string;
  hallId: string | null;
  offset: number;
  limit: number;
  generatedAt: string;
}

export interface OrderHistoryQuery {
  from?: string;
  to?: string;
  hallId?: string;
  agentUserId?: string;
  paymentMethod?: OrderPaymentMethod;
  paymentType?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

export async function getOrderHistory(
  q: OrderHistoryQuery,
): Promise<OrderHistoryResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  const path = qs
    ? `/api/agent/orders/history?${qs}`
    : "/api/agent/orders/history";
  return apiRequest<OrderHistoryResponse>(path, { auth: true });
}

// ── Order Detail (PDF 17 §17.30) ──────────────────────────────────────────

export interface OrderCartLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface OrderCart {
  id: string;
  orderId: string;
  agentUserId: string;
  hallId: string;
  shiftId: string;
  userType: "ONLINE" | "PHYSICAL";
  userId: string | null;
  username: string | null;
  totalCents: number;
  status: "CART_CREATED" | "ORDER_PLACED" | "CANCELLED";
  lines: OrderCartLine[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailResponse {
  sale: OrderSale;
  cart: OrderCart;
}

export async function getOrderDetail(saleId: string): Promise<OrderDetailResponse> {
  const id = encodeURIComponent(saleId);
  return apiRequest<OrderDetailResponse>(`/api/agent/orders/${id}`, { auth: true });
}

// ── Sold Tickets (PDF 17 §17.31) ──────────────────────────────────────────

export type SoldTicketSourceType = "physical" | "terminal" | "web" | "all";

export interface SoldTicketRow {
  dateTime: string;
  ticketId: string;
  ticketType: string;
  ticketColor: string;
  priceCents: number | null;
  winningPattern: string | null;
  soldType: "physical";
  hallId: string;
}

export interface SoldTicketsResponse {
  rows: SoldTicketRow[];
  total: number;
  from: string;
  to: string;
  hallId: string | null;
  offset: number;
  limit: number;
  type: string;
  generatedAt: string;
}

export interface SoldTicketsQuery {
  from?: string;
  to?: string;
  hallId?: string;
  ticketId?: string;
  search?: string;
  type?: SoldTicketSourceType;
  offset?: number;
  limit?: number;
}

export async function getSoldTickets(
  q: SoldTicketsQuery,
): Promise<SoldTicketsResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  const path = qs ? `/api/agent/sold-tickets?${qs}` : "/api/agent/sold-tickets";
  return apiRequest<SoldTicketsResponse>(path, { auth: true });
}

// ── Winnings History (PDF 17 §17.32 alias) ────────────────────────────────

export interface WinningsHistoryRow {
  dateTime: string;
  ticketId: string;
  ticketType: string;
  ticketColor: string;
  priceCents: number | null;
  winningPattern: string | null;
}

export interface WinningsHistoryResponse {
  from: string;
  to: string;
  generatedAt: string;
  hallId: string | null;
  rows: WinningsHistoryRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface WinningsHistoryQuery {
  from?: string;
  to?: string;
  hallId?: string;
  ticketId?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

export async function getWinningsHistory(
  q: WinningsHistoryQuery,
): Promise<WinningsHistoryResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  const path = qs
    ? `/api/agent/winnings-history?${qs}`
    : "/api/agent/winnings-history";
  return apiRequest<WinningsHistoryResponse>(path, { auth: true });
}
