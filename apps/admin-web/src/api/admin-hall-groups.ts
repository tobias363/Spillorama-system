// BIN-665/666: admin-web API-wrapper for HallGroup CRUD.
//
// Mirrors apps/backend/src/routes/adminHallGroups.ts:
//   GET    /api/admin/hall-groups
//   GET    /api/admin/hall-groups/:id
//   POST   /api/admin/hall-groups
//   PATCH  /api/admin/hall-groups/:id
//   DELETE /api/admin/hall-groups/:id
//
// Wire-shape canonicaliseres i packages/shared-types/src/schemas.ts
// (HallGroupRowSchema + CreateHallGroupSchema + UpdateHallGroupSchema).

import { apiRequest } from "./client.js";
import type {
  HallGroupRow,
  HallGroupMember,
  CreateHallGroupInput,
  UpdateHallGroupInput,
} from "../../../../packages/shared-types/src/schemas.js";

export type { HallGroupRow, HallGroupMember, CreateHallGroupInput, UpdateHallGroupInput };

export type HallGroupStatus = "active" | "inactive";

export interface ListHallGroupFilter {
  status?: HallGroupStatus;
  search?: string;
  limit?: number;
}

export interface HallGroupListResult {
  groups: HallGroupRow[];
  count: number;
}

function buildFilterQs(filter: ListHallGroupFilter = {}): string {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.search) qs.set("search", filter.search);
  if (filter.limit !== undefined) qs.set("limit", String(filter.limit));
  const qstr = qs.toString();
  return qstr ? `?${qstr}` : "";
}

export async function listHallGroups(
  filter: ListHallGroupFilter = {}
): Promise<HallGroupListResult> {
  return apiRequest<HallGroupListResult>(
    `/api/admin/hall-groups${buildFilterQs(filter)}`,
    { auth: true }
  );
}

export async function getHallGroup(id: string): Promise<HallGroupRow> {
  return apiRequest<HallGroupRow>(
    `/api/admin/hall-groups/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function createHallGroup(
  input: CreateHallGroupInput
): Promise<HallGroupRow> {
  return apiRequest<HallGroupRow>(`/api/admin/hall-groups`, {
    method: "POST",
    body: input,
    auth: true,
  });
}

export async function updateHallGroup(
  id: string,
  input: UpdateHallGroupInput
): Promise<HallGroupRow> {
  return apiRequest<HallGroupRow>(
    `/api/admin/hall-groups/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input, auth: true }
  );
}

export interface DeleteHallGroupResult {
  softDeleted: boolean;
}

export async function deleteHallGroup(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<DeleteHallGroupResult> {
  const qs = opts.hard ? "?hard=true" : "";
  return apiRequest<DeleteHallGroupResult>(
    `/api/admin/hall-groups/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}
