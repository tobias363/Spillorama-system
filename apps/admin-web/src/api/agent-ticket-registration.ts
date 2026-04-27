/**
 * BIN-GAP#4 — Agent-portal Register Sold Tickets API.
 *
 * Backend: apps/backend/src/routes/agentTicketRegistration.ts
 *   GET  /api/agent/ticket-registration/:gameId/initial-ids
 *   POST /api/agent/ticket-registration/:gameId/final-ids
 *   GET  /api/agent/ticket-registration/:gameId/summary
 */

import { apiRequest } from "./client.js";

/**
 * 11-palette (utvidet pre-pilot 2026-10-01) — speilbilde av backend-konstantene
 * i apps/backend/src/agent/TicketRegistrationService.ts. Hold synkronisert.
 */
export type TicketType =
  | "small_yellow"
  | "small_white"
  | "large_yellow"
  | "large_white"
  | "small_purple"
  | "large_purple"
  | "small_red"
  | "large_red"
  | "small_green"
  | "large_green"
  | "small_blue";

export const TICKET_TYPES: readonly TicketType[] = [
  "small_yellow",
  "small_white",
  "large_yellow",
  "large_white",
  "small_purple",
  "large_purple",
  "small_red",
  "large_red",
  "small_green",
  "large_green",
  "small_blue",
] as const;

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  small_yellow: "Small Yellow",
  small_white: "Small White",
  large_yellow: "Large Yellow",
  large_white: "Large White",
  small_purple: "Small Purple",
  large_purple: "Large Purple",
  small_red: "Small Red",
  large_red: "Large Red",
  small_green: "Small Green",
  large_green: "Large Green",
  small_blue: "Small Blue",
};

export interface TicketRange {
  id: string;
  gameId: string;
  hallId: string;
  ticketType: TicketType;
  initialId: number;
  finalId: number | null;
  soldCount: number;
  roundNumber: number;
  carriedFromGameId: string | null;
  recordedByUserId: string | null;
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitialIdEntry {
  ticketType: TicketType;
  initialId: number;
  roundNumber: number;
  carriedFromGameId: string | null;
  existingRange: TicketRange | null;
}

export interface GetInitialIdsResponse {
  gameId: string;
  hallId: string;
  entries: InitialIdEntry[];
}

export function agentGetInitialIds(
  gameId: string,
  opts: { hallId?: string } = {},
): Promise<GetInitialIdsResponse> {
  const q = opts.hallId ? `?hallId=${encodeURIComponent(opts.hallId)}` : "";
  return apiRequest<GetInitialIdsResponse>(
    `/api/agent/ticket-registration/${encodeURIComponent(gameId)}/initial-ids${q}`,
    { auth: true },
  );
}

export interface RecordFinalIdsBody {
  perTypeFinalIds: Partial<Record<TicketType, number>>;
  /** ADMIN kan overstyre hallId — ignoreres for AGENT/HALL_OPERATOR. */
  hallId?: string;
}

export interface RecordFinalIdsResponse {
  gameId: string;
  hallId: string;
  totalSoldCount: number;
  ranges: TicketRange[];
  hallReadyStatus: { isReady: boolean; error?: string } | null;
}

export function agentRecordFinalIds(
  gameId: string,
  body: RecordFinalIdsBody,
): Promise<RecordFinalIdsResponse> {
  return apiRequest<RecordFinalIdsResponse>(
    `/api/agent/ticket-registration/${encodeURIComponent(gameId)}/final-ids`,
    {
      method: "POST",
      body,
      auth: true,
    },
  );
}

export interface GetSummaryResponse {
  gameId: string;
  ranges: TicketRange[];
  totalSoldCount: number;
}

export function agentGetSummary(gameId: string): Promise<GetSummaryResponse> {
  return apiRequest<GetSummaryResponse>(
    `/api/agent/ticket-registration/${encodeURIComponent(gameId)}/summary`,
    { auth: true },
  );
}

// ── REQ-091: edit ticket-range mellom runder ────────────────────────────────

export interface EditTicketRangeBody {
  gameId: string;
  initialId: number;
  finalId: number;
  /** ADMIN kan overstyre hallId — ignoreres for AGENT/HALL_OPERATOR. */
  hallId?: string;
}

export interface EditTicketRangeResponse {
  range: TicketRange;
  before: TicketRange;
}

/**
 * REQ-091 — Endrer initial_id/final_id på en eksisterende ticket-range mellom
 * runder. Returnerer både pre- og post-state for UI/audit-visning.
 *
 * Backend: PUT /api/agent/ticket-ranges/:rangeId
 *
 * Feilkoder:
 *   - 404 RANGE_NOT_FOUND / GAME_NOT_FOUND
 *   - 409 GAME_NOT_EDITABLE (spillet kjører)
 *   - 409 FINAL_LESS_THAN_INITIAL
 *   - 409 RANGE_OVERLAP
 *   - 409 RANGE_HALL_MISMATCH / RANGE_GAME_MISMATCH
 *   - 403 FORBIDDEN (cross-hall)
 *   - 400 INVALID_INPUT
 */
export function agentEditTicketRange(
  rangeId: string,
  body: EditTicketRangeBody,
): Promise<EditTicketRangeResponse> {
  return apiRequest<EditTicketRangeResponse>(
    `/api/agent/ticket-ranges/${encodeURIComponent(rangeId)}`,
    {
      method: "PUT",
      body,
      auth: true,
    },
  );
}
