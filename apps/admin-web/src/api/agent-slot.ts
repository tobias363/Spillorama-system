// Slot-machine provider wrappers. Dispatches to Metronia or OK Bingo based on
// `hall.slotProvider`. See PR-B1-PLAN.md §7 Q2 — the `slot_provider` column
// does not yet exist on `app_halls`; callers must handle a `null` provider by
// surfacing `slot_provider_not_configured` to the user. Follow-up issue BIN-TBD
// tracks the schema migration + admin-UI to set the provider.

import { apiRequest } from "./client.js";

export type SlotProvider = "metronia" | "okbingo";

export interface SlotTicketStatus {
  ticketNumber: string;
  enabled: boolean;
  balance: number;
  lastActivityAt?: string;
}

export interface SlotRegisterTicketRequest {
  ticketNumber: string;
  machineName?: string;
  balance: number;
  playerId?: string;
  username?: string;
  paymentType: "Cash" | "Card" | "customerNumber";
  amount: number;
}

export interface SlotOperationResult {
  ok: true;
  ticketNumber: string;
  newBalance: number;
  transactionId?: string;
  dailyBalance?: number;
}

/**
 * Build an API path for a provider-specific slot operation.
 * Throws if the provider is unsupported — callers should check for a null
 * provider before calling these wrappers.
 */
function slotPath(provider: SlotProvider, endpoint: string): string {
  if (provider !== "metronia" && provider !== "okbingo") {
    throw new Error(`Unsupported slot provider: ${String(provider)}`);
  }
  return `/api/agent/${provider}/${endpoint}`;
}

export function registerSlotTicket(
  provider: SlotProvider,
  body: SlotRegisterTicketRequest
): Promise<SlotOperationResult> {
  return apiRequest(slotPath(provider, "register-ticket"), { method: "POST", body, auth: true });
}

export function slotTopup(
  provider: SlotProvider,
  body: { ticketNumber: string; amount: number; paymentType: "Cash" | "Card" | "customerNumber" }
): Promise<SlotOperationResult> {
  return apiRequest(slotPath(provider, "topup"), { method: "POST", body, auth: true });
}

export function slotPayout(
  provider: SlotProvider,
  body: { ticketNumber: string; amount: number }
): Promise<SlotOperationResult> {
  return apiRequest(slotPath(provider, "payout"), { method: "POST", body, auth: true });
}

export function slotVoid(provider: SlotProvider, body: { ticketNumber: string }): Promise<SlotOperationResult> {
  return apiRequest(slotPath(provider, "void"), { method: "POST", body, auth: true });
}

export function getSlotTicketStatus(provider: SlotProvider, ticketNumber: string): Promise<SlotTicketStatus> {
  return apiRequest(slotPath(provider, `ticket/${encodeURIComponent(ticketNumber)}`), { auth: true });
}

export function getSlotDailySales(provider: SlotProvider): Promise<{ totalAmount: number; ticketCount: number }> {
  return apiRequest(slotPath(provider, "daily-sales"), { auth: true });
}

// OK Bingo has a dedicated `open-day` endpoint to sync the provider's shift.
// Metronia opens day implicitly. `agentOpenDay.ts` covers the local side.
export function okbingoOpenDay(body: { hallId: string; openingBalance: number }): Promise<SlotOperationResult> {
  return apiRequest(slotPath("okbingo", "open-day"), { method: "POST", body, auth: true });
}
