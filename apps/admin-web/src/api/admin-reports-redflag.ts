// BIN-650/651 wiring — red-flag categories + players API wrappers.
//
// Previously (PR-A4a / BIN-645) these wrappers returned placeholder shapes and
// flagged `isPlaceholder=true`. Both endpoints have since landed:
//   - BIN-650: GET /api/admin/reports/red-flag/categories
//   - BIN-651: GET /api/admin/reports/red-flag/players (cursor paginated)
//
// REGULATORY BIN-651: the backend automatically writes an AuditLog row for
// each GET on `/api/admin/reports/red-flag/players` (spec: task description).
// Front-end no longer needs to POST an explicit audit event — the call to the
// canonical endpoint IS the audit trigger. We keep `logRedFlagPlayersViewed`
// exported as a no-op for call-site stability during the migration window.

import { apiRequest, ApiError } from "./client.js";
import type {
  RedFlagCategoriesResponse,
  RedFlagCategoryRow,
  RedFlagPlayersResponse,
  RedFlagPlayerEntry,
} from "../../../../packages/shared-types/src/reports.js";

export type { RedFlagCategoryRow, RedFlagCategoriesResponse };
export type { RedFlagPlayerEntry, RedFlagPlayersResponse };

// ── BIN-650: red-flag categories ────────────────────────────────────────────

export interface RedFlagCategoriesQuery {
  from?: string;
  to?: string;
}

export interface RedFlagCategoriesResult {
  response: RedFlagCategoriesResponse | null;
  isPlaceholder: boolean;
}

export async function fetchRedFlagCategories(
  q: RedFlagCategoriesQuery = {}
): Promise<RedFlagCategoriesResult> {
  const qs = new URLSearchParams();
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const res = await apiRequest<RedFlagCategoriesResponse>(
      `/api/admin/reports/red-flag/categories${suffix}`,
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

// ── BIN-651: red-flag players ──────────────────────────────────────────────

export interface RedFlagPlayersQuery {
  /** AML rule-category slug, or undefined for all categories. */
  category?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface RedFlagPlayersResult {
  response: RedFlagPlayersResponse | null;
  isPlaceholder: boolean;
}

export async function fetchRedFlagPlayers(
  q: RedFlagPlayersQuery
): Promise<RedFlagPlayersResult> {
  const qs = new URLSearchParams();
  if (q.category) qs.set("category", q.category);
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.cursor) qs.set("cursor", q.cursor);
  if (q.limit !== undefined) qs.set("limit", String(q.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const res = await apiRequest<RedFlagPlayersResponse>(
      `/api/admin/reports/red-flag/players${suffix}`,
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

/**
 * @deprecated BIN-651 backend writes AuditLog automatically on every GET on
 * `/api/admin/reports/red-flag/players`. Front-end no longer needs an explicit
 * audit POST. Retained as no-op for call-site stability.
 */
export async function logRedFlagPlayersViewed(_categoryId?: string): Promise<void> {
  // Backend-side AuditLog writer is wired in adminReportsRedFlagPlayers.ts.
  // Front-end does not POST an audit event; the GET itself is the trigger.
  return;
}

export const hasBackendGap = false;
