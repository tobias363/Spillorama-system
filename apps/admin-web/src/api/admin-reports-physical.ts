// BIN-647..651 wiring — physical-tickets + unique-tickets report API wrappers.
//
// Previously (PR-A4a / BIN-645) these wrappers returned placeholder shapes and
// flagged `isPlaceholder=true` when the backend endpoint did not exist. All
// four endpoints have since landed:
//   - BIN-648: GET /api/admin/reports/physical-tickets/aggregate
//   - BIN-649: GET /api/admin/reports/unique-tickets/range
// (BIN-650/651 live in admin-reports-redflag.ts).
//
// The wrappers now call the real endpoints directly. The legacy shapes
// (`PhysicalTicketReportRow`, `UniqueTicketRow`) are still exported for
// back-compat with page code; new page code prefers the canonical wire-shapes
// `PhysicalTicketsAggregateResponse` + the new `UniqueTicketsRangeResponse`
// (defined inline below since shared-types doesn't export it yet).
//
// 404/501 fallbacks are kept to gracefully handle staging environments where
// the backend is rolling forward — callers opt-in via the `isPlaceholder`
// flag rather than throwing.

import { apiRequest, ApiError } from "./client.js";
import type {
  PhysicalTicketsAggregateResponse,
  PhysicalTicketsAggregateRow,
  PhysicalTicketsGamesInHallResponse,
  PhysicalTicketsGameInHallRow,
} from "../../../../packages/shared-types/src/reports.js";

/**
 * Legacy placeholder shape. Page code may import either this or the canonical
 * `PhysicalTicketsAggregateRow` — the gap-banner wrappers always return the
 * canonical shape now and callers coerce/adapt as needed.
 */
export type { PhysicalTicketsAggregateRow, PhysicalTicketsAggregateResponse };

export interface PhysicalTicketsAggregateQuery {
  hallId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface PhysicalTicketsAggregateResult {
  response: PhysicalTicketsAggregateResponse | null;
  isPlaceholder: boolean;
}

export async function fetchPhysicalTicketsAggregate(
  q: PhysicalTicketsAggregateQuery
): Promise<PhysicalTicketsAggregateResult> {
  const qs = new URLSearchParams();
  if (q.hallId) qs.set("hallId", q.hallId);
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.limit !== undefined) qs.set("limit", String(q.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const res = await apiRequest<PhysicalTicketsAggregateResponse>(
      `/api/admin/reports/physical-tickets/aggregate${suffix}`,
      { auth: true }
    );
    return { response: res, isPlaceholder: false };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return { response: null, isPlaceholder: true };
    }
    throw err;
  }
}

// ── BIN-649: unique-ticket range report ─────────────────────────────────────

export type UniqueTicketStatus = "SOLD" | "UNSOLD" | "VOIDED";

/**
 * Wire-shape for `GET /api/admin/reports/unique-tickets/range`.
 *
 * Backend returns `rows: PhysicalTicket[]` directly (plus request-echo fields).
 * Shared-types doesn't export the canonical shape yet — we declare it inline
 * to keep the wrapper strongly-typed. When shared-types adds a formal
 * definition, replace this with an import.
 */
export interface UniqueTicketsRangeRow {
  id: string;
  uniqueId: number;
  hallId: string;
  status: string;
  assignedGameId: string | null;
  priceCents: number | null;
  createdAt: string;
  soldAt: string | null;
  // Additional fields may be present; we keep it open.
  [key: string]: unknown;
}

export interface UniqueTicketsRangeResponse {
  hallId: string | null;
  status: string | null;
  uniqueIdStart: number | null;
  uniqueIdEnd: number | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
  rows: UniqueTicketsRangeRow[];
  count: number;
}

export interface UniqueTicketsRangeQuery {
  hallId?: string;
  status?: UniqueTicketStatus;
  uniqueIdStart?: number;
  uniqueIdEnd?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface UniqueTicketsRangeResult {
  response: UniqueTicketsRangeResponse | null;
  isPlaceholder: boolean;
}

export async function fetchUniqueTicketsRange(
  q: UniqueTicketsRangeQuery
): Promise<UniqueTicketsRangeResult> {
  const qs = new URLSearchParams();
  if (q.hallId) qs.set("hallId", q.hallId);
  if (q.status) qs.set("status", q.status);
  if (q.uniqueIdStart !== undefined) qs.set("uniqueIdStart", String(q.uniqueIdStart));
  if (q.uniqueIdEnd !== undefined) qs.set("uniqueIdEnd", String(q.uniqueIdEnd));
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.limit !== undefined) qs.set("limit", String(q.limit));
  if (q.offset !== undefined) qs.set("offset", String(q.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const res = await apiRequest<UniqueTicketsRangeResponse>(
      `/api/admin/reports/unique-tickets/range${suffix}`,
      { auth: true }
    );
    return { response: res, isPlaceholder: false };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return { response: null, isPlaceholder: true };
    }
    throw err;
  }
}

// ── BIN-638: physical-tickets games-in-hall ────────────────────────────────

export type { PhysicalTicketsGamesInHallResponse, PhysicalTicketsGameInHallRow };

export interface PhysicalTicketsGamesInHallQuery {
  hallId: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface PhysicalTicketsGamesInHallResult {
  response: PhysicalTicketsGamesInHallResponse | null;
  isPlaceholder: boolean;
}

export async function fetchPhysicalTicketsGamesInHall(
  q: PhysicalTicketsGamesInHallQuery
): Promise<PhysicalTicketsGamesInHallResult> {
  const qs = new URLSearchParams();
  qs.set("hallId", q.hallId);
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.limit !== undefined) qs.set("limit", String(q.limit));
  try {
    const res = await apiRequest<PhysicalTicketsGamesInHallResponse>(
      `/api/admin/physical-tickets/games/in-hall?${qs}`,
      { auth: true }
    );
    return { response: res, isPlaceholder: false };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return { response: null, isPlaceholder: true };
    }
    throw err;
  }
}

// ── Back-compat placeholders (kept for existing non-report callers) ─────────
//
// No new code should use these. Retained so a transitive import from older
// code compiles until callers migrate to the canonical wrappers above.

/** @deprecated Use {@link fetchPhysicalTicketsAggregate} instead. */
export async function fetchPhysicalTicketReport(q: {
  startDate: string;
  endDate: string;
  hallId?: string;
}): Promise<{ rows: never[]; isPlaceholder: boolean }> {
  void q;
  return { rows: [], isPlaceholder: true };
}

/** @deprecated Use {@link fetchUniqueTicketsRange} instead. */
export async function fetchUniqueTicketReport(q: {
  startDate: string;
  endDate: string;
  hallId?: string;
}): Promise<{ rows: never[]; isPlaceholder: boolean }> {
  void q;
  return { rows: [], isPlaceholder: true };
}

export const hasBackendGap = false;
