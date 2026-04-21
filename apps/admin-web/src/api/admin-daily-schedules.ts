// BIN-626: admin-web API-wrapper for DailySchedule CRUD + special + subgame-details.
//
// Mirrors apps/backend/src/routes/adminDailySchedules.ts:
//   GET    /api/admin/daily-schedules
//   GET    /api/admin/daily-schedules/:id
//   GET    /api/admin/daily-schedules/:id/details
//   POST   /api/admin/daily-schedules
//   POST   /api/admin/daily-schedules/special
//   PATCH  /api/admin/daily-schedules/:id
//   DELETE /api/admin/daily-schedules/:id
//
// Wire-shape canonicaliseres i packages/shared-types/src/schemas.ts
// (DailyScheduleRowSchema + CreateDailyScheduleSchema + UpdateDailyScheduleSchema).

import { apiRequest } from "./client.js";
import type {
  DailyScheduleRow,
  DailyScheduleHallIds,
  DailyScheduleSubgameSlot,
  CreateDailyScheduleInput,
  UpdateDailyScheduleInput,
  DailyScheduleDetailsResponse,
} from "../../../../packages/shared-types/src/schemas.js";

export type {
  DailyScheduleRow,
  DailyScheduleHallIds,
  DailyScheduleSubgameSlot,
  CreateDailyScheduleInput,
  UpdateDailyScheduleInput,
  DailyScheduleDetailsResponse,
};

export type DailyScheduleStatus = "active" | "running" | "finish" | "inactive";
export type DailyScheduleDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface ListDailyScheduleFilter {
  gameManagementId?: string;
  hallId?: string;
  weekDays?: number;
  fromDate?: string;
  toDate?: string;
  status?: DailyScheduleStatus;
  specialGame?: boolean;
  limit?: number;
}

export interface DailyScheduleListResult {
  schedules: DailyScheduleRow[];
  count: number;
}

function buildFilterQs(filter: ListDailyScheduleFilter = {}): string {
  const qs = new URLSearchParams();
  if (filter.gameManagementId) qs.set("gameManagementId", filter.gameManagementId);
  if (filter.hallId) qs.set("hallId", filter.hallId);
  if (filter.weekDays !== undefined) qs.set("weekDays", String(filter.weekDays));
  if (filter.fromDate) qs.set("fromDate", filter.fromDate);
  if (filter.toDate) qs.set("toDate", filter.toDate);
  if (filter.status) qs.set("status", filter.status);
  if (filter.specialGame !== undefined) qs.set("specialGame", String(filter.specialGame));
  if (filter.limit !== undefined) qs.set("limit", String(filter.limit));
  const qstr = qs.toString();
  return qstr ? `?${qstr}` : "";
}

export async function listDailySchedules(
  filter: ListDailyScheduleFilter = {}
): Promise<DailyScheduleListResult> {
  return apiRequest<DailyScheduleListResult>(
    `/api/admin/daily-schedules${buildFilterQs(filter)}`,
    { auth: true }
  );
}

export async function getDailySchedule(id: string): Promise<DailyScheduleRow> {
  return apiRequest<DailyScheduleRow>(
    `/api/admin/daily-schedules/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function getDailyScheduleDetails(
  id: string
): Promise<DailyScheduleDetailsResponse> {
  return apiRequest<DailyScheduleDetailsResponse>(
    `/api/admin/daily-schedules/${encodeURIComponent(id)}/details`,
    { auth: true }
  );
}

export async function createDailySchedule(
  input: CreateDailyScheduleInput
): Promise<DailyScheduleRow> {
  return apiRequest<DailyScheduleRow>(`/api/admin/daily-schedules`, {
    method: "POST",
    body: input,
    auth: true,
  });
}

export async function createSpecialDailySchedule(
  input: CreateDailyScheduleInput
): Promise<DailyScheduleRow> {
  return apiRequest<DailyScheduleRow>(`/api/admin/daily-schedules/special`, {
    method: "POST",
    body: input,
    auth: true,
  });
}

export async function updateDailySchedule(
  id: string,
  input: UpdateDailyScheduleInput
): Promise<DailyScheduleRow> {
  return apiRequest<DailyScheduleRow>(
    `/api/admin/daily-schedules/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input, auth: true }
  );
}

export interface DeleteDailyScheduleResult {
  softDeleted: boolean;
}

export async function deleteDailySchedule(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<DeleteDailyScheduleResult> {
  const qs = opts.hard ? "?hard=true" : "";
  return apiRequest<DeleteDailyScheduleResult>(
    `/api/admin/daily-schedules/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}

// ── Weekday bitmask-helpers (mirror legacy) ────────────────────────────────

/** Bitmask-konstanter: mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64. */
export const WEEKDAY_MASKS = {
  mon: 1,
  tue: 2,
  wed: 4,
  thu: 8,
  fri: 16,
  sat: 32,
  sun: 64,
} as const;

export type WeekDayKey = keyof typeof WEEKDAY_MASKS;
export type WeekDayMask = number;

export const WEEKDAY_MASK_ALL: WeekDayMask = 127;

export function maskFromDays(days: Array<WeekDayKey>): WeekDayMask {
  let mask: WeekDayMask = 0;
  for (const d of days) mask |= WEEKDAY_MASKS[d];
  return mask;
}

export function daysFromMask(mask: WeekDayMask): WeekDayKey[] {
  const out: WeekDayKey[] = [];
  for (const [k, v] of Object.entries(WEEKDAY_MASKS) as Array<[WeekDayKey, number]>) {
    if ((mask & v) === v) out.push(k);
  }
  return out;
}
