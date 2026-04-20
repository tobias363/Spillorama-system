// BIN-647 wiring — sub-game drill-down API wrapper.
//
// Previously (PR-A4a / BIN-645) this wrapper returned a placeholder `rows: []`
// with `isPlaceholder=true`. BIN-647 shipped the canonical endpoint:
//
//   GET /api/admin/reports/subgame-drill-down?parentId=&from=&to=&cursor=&limit=
//
// Response: `SubgameDrillDownResponse` (see shared-types/src/reports.ts).
// Cursor is an opaque base64url offset; null when exhausted.

import { apiRequest, ApiError } from "./client.js";
import type {
  SubgameDrillDownResponse,
  SubgameDrillDownItem,
} from "../../../../packages/shared-types/src/reports.js";

export type { SubgameDrillDownResponse, SubgameDrillDownItem };

export interface SubgameDrillDownQuery {
  /** `hall_game_schedules.id` of the parent bingo-match. Required. */
  parentId: string;
  /** ISO-8601 lower bound. Optional — backend defaults to last 7 days. */
  from?: string;
  /** ISO-8601 upper bound. Optional — defaults to now. */
  to?: string;
  /** Opaque cursor from previous response's `nextCursor`. */
  cursor?: string;
  /** Page size, default 50 on backend. */
  limit?: number;
}

export interface SubgameDrillDownResult {
  response: SubgameDrillDownResponse | null;
  isPlaceholder: boolean;
}

export async function fetchSubgameDrillDown(
  q: SubgameDrillDownQuery
): Promise<SubgameDrillDownResult> {
  const qs = new URLSearchParams();
  qs.set("parentId", q.parentId);
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.cursor) qs.set("cursor", q.cursor);
  if (q.limit !== undefined) qs.set("limit", String(q.limit));
  try {
    const res = await apiRequest<SubgameDrillDownResponse>(
      `/api/admin/reports/subgame-drill-down?${qs}`,
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

export const hasBackendGap = false;
