// BIN-625: admin-web API-wrapper for Schedule CRUD (gjenbrukbare spill-maler).
//
// Mirrors apps/backend/src/routes/adminSchedules.ts:
//   GET    /api/admin/schedules
//   GET    /api/admin/schedules/:id
//   POST   /api/admin/schedules
//   PATCH  /api/admin/schedules/:id
//   DELETE /api/admin/schedules/:id
//
// Wire-shape canonicaliseres i packages/shared-types/src/schemas.ts
// (ScheduleRowSchema + CreateScheduleSchema + UpdateScheduleSchema).

import { apiRequest } from "./client.js";
import type {
  ScheduleRow,
  ScheduleSubgame,
  CreateScheduleInput,
  UpdateScheduleInput,
} from "../../../../packages/shared-types/src/schemas.js";

export type { ScheduleRow, ScheduleSubgame, CreateScheduleInput, UpdateScheduleInput };

export type ScheduleType = "Auto" | "Manual";
export type ScheduleStatus = "active" | "inactive";

export interface ListScheduleFilter {
  type?: ScheduleType;
  status?: ScheduleStatus;
  search?: string;
  createdBy?: string;
  limit?: number;
}

export interface ScheduleListResult {
  schedules: ScheduleRow[];
  count: number;
}

/** Bygg query-string fra filter. */
function buildFilterQs(filter: ListScheduleFilter = {}): string {
  const qs = new URLSearchParams();
  if (filter.type) qs.set("type", filter.type);
  if (filter.status) qs.set("status", filter.status);
  if (filter.search) qs.set("search", filter.search);
  if (filter.createdBy) qs.set("createdBy", filter.createdBy);
  if (filter.limit !== undefined) qs.set("limit", String(filter.limit));
  const qstr = qs.toString();
  return qstr ? `?${qstr}` : "";
}

export async function listSchedules(
  filter: ListScheduleFilter = {}
): Promise<ScheduleListResult> {
  return apiRequest<ScheduleListResult>(`/api/admin/schedules${buildFilterQs(filter)}`, {
    auth: true,
  });
}

export async function getSchedule(id: string): Promise<ScheduleRow> {
  return apiRequest<ScheduleRow>(
    `/api/admin/schedules/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function createSchedule(input: CreateScheduleInput): Promise<ScheduleRow> {
  return apiRequest<ScheduleRow>(`/api/admin/schedules`, {
    method: "POST",
    body: input,
    auth: true,
  });
}

export async function updateSchedule(
  id: string,
  input: UpdateScheduleInput
): Promise<ScheduleRow> {
  return apiRequest<ScheduleRow>(`/api/admin/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    auth: true,
  });
}

export interface DeleteScheduleResult {
  softDeleted: boolean;
}

export async function deleteSchedule(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<DeleteScheduleResult> {
  const qs = opts.hard ? "?hard=true" : "";
  return apiRequest<DeleteScheduleResult>(
    `/api/admin/schedules/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}
