// API wrappers for agent shift / settlement flows.
// Backs onto BIN-583 endpoints delivered in B3.3 / B3.8:
//   - agentOpenDay.ts       (open day, daily balance snapshot, physical cashouts)
//   - agentSettlement.ts    (control daily balance, close day, settlement)
//   - agent.ts              (shift start/end/current/history)
//
// See PR-B1-PLAN.md §3 for endpoint mapping.

import { apiRequest } from "./client.js";

// ───────── Shift (session) ─────────

export interface Shift {
  id: string;
  hallId: string;
  agentId: string;
  startedAt: string;
  endedAt?: string;
  openingBalance: number;
  currentBalance: number;
  status: "open" | "closed";
}

export function startShift(body: { hallId: string; openingBalance: number }): Promise<Shift> {
  return apiRequest<Shift>("/api/agent/shift/start", { method: "POST", body, auth: true });
}

export function endShift(body: { actualCountedCash: number; note?: string }): Promise<Shift> {
  return apiRequest<Shift>("/api/agent/shift/end", { method: "POST", body, auth: true });
}

export function getCurrentShift(): Promise<Shift | null> {
  return apiRequest<Shift | null>("/api/agent/shift/current", { auth: true });
}

export function getShiftHistory(limit = 20): Promise<Shift[]> {
  return apiRequest<Shift[]>(`/api/agent/shift/history?limit=${limit}`, { auth: true });
}

// ───────── Open day / daily balance ─────────

export interface DailyBalance {
  openingBalance: number;
  totalCashIn: number;
  totalCashOut: number;
  dailyBalance: number;
  totalHallCashBalance: number;
  updatedAt: string;
}

export function openDay(body: { openingBalance: number; note?: string }): Promise<DailyBalance> {
  return apiRequest<DailyBalance>("/api/agent/shift/open-day", { method: "POST", body, auth: true });
}

export function getDailyBalance(): Promise<DailyBalance> {
  return apiRequest<DailyBalance>("/api/agent/shift/daily-balance", { auth: true });
}

export interface PhysicalCashoutItem {
  id: string;
  gameId: string;
  ticketNumber: string;
  amount: number;
  createdAt: string;
  playerId?: string;
}

export function getPhysicalCashouts(): Promise<PhysicalCashoutItem[]> {
  return apiRequest<PhysicalCashoutItem[]>("/api/agent/shift/physical-cashouts", { auth: true });
}

export function getPhysicalCashoutSummary(): Promise<{ count: number; totalAmount: number }> {
  return apiRequest("/api/agent/shift/physical-cashouts/summary", { auth: true });
}

// ───────── Control daily balance (midtveis-sjekk) ─────────

export interface ControlDailyBalanceRequest {
  actualCountedCash: number;
  note?: string;
}

export interface ControlDailyBalanceResult {
  expected: number;
  actual: number;
  difference: number;
  /** True if diff > 500 kr OR > 5% of expected — a note is required. */
  requiresNote: boolean;
  /** `"within-tolerance" | "diff-requires-note" | "accepted-with-note"` */
  status: "within-tolerance" | "diff-requires-note" | "accepted-with-note";
  controlId?: string;
}

export function controlDailyBalance(body: ControlDailyBalanceRequest): Promise<ControlDailyBalanceResult> {
  return apiRequest<ControlDailyBalanceResult>("/api/agent/shift/control-daily-balance", {
    method: "POST",
    body,
    auth: true,
  });
}

// ───────── Close day / settlement ─────────

export interface CloseDayRequest {
  actualCountedCash: number;
  note?: string;
  confirmed: true;
}

export function closeDay(body: CloseDayRequest): Promise<{ shiftId: string; closedAt: string; finalBalance: number }> {
  return apiRequest("/api/agent/shift/close-day", { method: "POST", body, auth: true });
}

export interface SettlementDate {
  date: string;
  shiftId?: string;
}

export function getSettlementDate(): Promise<SettlementDate> {
  return apiRequest<SettlementDate>("/api/agent/shift/settlement-date", { auth: true });
}

export interface Settlement {
  shiftId: string;
  hallId: string;
  hallName: string;
  agentId: string;
  agentName: string;
  openedAt: string;
  closedAt?: string;
  openingBalance: number;
  totalCashIn: number;
  totalCashOut: number;
  totalTicketSales: number;
  totalProductSales: number;
  totalSlotTopUp: number;
  totalSlotPayout: number;
  expectedBalance: number;
  actualCountedCash?: number;
  difference?: number;
  note?: string;
}

export function getShiftSettlement(shiftId: string): Promise<Settlement> {
  return apiRequest<Settlement>(`/api/agent/shift/${encodeURIComponent(shiftId)}/settlement`, { auth: true });
}

export function getShiftSettlementPdfUrl(shiftId: string): string {
  return `/api/agent/shift/${encodeURIComponent(shiftId)}/settlement.pdf`;
}

// ───────── Wireframe Gap #9: Shift Log Out med checkboxer ─────────

export interface AgentShiftLogoutFlags {
  distributeWinnings?: boolean;
  transferRegisterTickets?: boolean;
  logoutNotes?: string | null;
}

export interface AgentShiftLogoutResponse {
  /** Den oppdaterte shiften (isActive=false, logged_out=true). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shift: any;
  /** Antall pending cashouts som ble flagget for neste agent. */
  pendingCashoutsFlagged: number;
  /** Antall åpne ticket-ranges som ble flagget for neste agent. */
  ticketRangesFlagged: number;
}

/** POST /api/agent/shift/logout — Gap #9 (wireframe PDF 17.6). */
export function agentShiftLogout(
  flags: AgentShiftLogoutFlags = {}
): Promise<AgentShiftLogoutResponse> {
  return apiRequest<AgentShiftLogoutResponse>("/api/agent/shift/logout", {
    method: "POST",
    body: flags,
    auth: true,
  });
}

export interface AgentPendingCashoutSummary {
  id: string;
  ticketId: string;
  hallId: string;
  scheduledGameId: string;
  patternPhase: string;
  expectedPayoutCents: number;
  color: string;
  detectedAt: string;
  verifiedAt: string | null;
  adminApprovalRequired: boolean;
}

export interface AgentPendingCashoutsResponse {
  pendingCashouts: AgentPendingCashoutSummary[];
  count: number;
}

/** GET /api/agent/shift/pending-cashouts — brukt av logout-popup "View Cashout Details". */
export function agentListPendingCashouts(): Promise<AgentPendingCashoutsResponse> {
  return apiRequest<AgentPendingCashoutsResponse>(
    "/api/agent/shift/pending-cashouts",
    { auth: true }
  );
}
