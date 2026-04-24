/**
 * BIN-GAP#4 — Agent-portal Register Sold Tickets API.
 *
 * Backend: apps/backend/src/routes/agentTicketRegistration.ts
 *   GET  /api/agent/ticket-registration/:gameId/initial-ids
 *   POST /api/agent/ticket-registration/:gameId/final-ids
 *   GET  /api/agent/ticket-registration/:gameId/summary
 */

import { apiRequest } from "./client.js";

export type TicketType =
  | "small_yellow"
  | "small_white"
  | "large_yellow"
  | "large_white"
  | "small_purple"
  | "large_purple";

export const TICKET_TYPES: readonly TicketType[] = [
  "small_yellow",
  "small_white",
  "large_yellow",
  "large_white",
  "small_purple",
  "large_purple",
] as const;

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  small_yellow: "Small Yellow",
  small_white: "Small White",
  large_yellow: "Large Yellow",
  large_white: "Large White",
  small_purple: "Small Purple",
  large_purple: "Large Purple",
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
