// BIN-625: Schedule admin state — wired to /api/admin/schedules.
//
// Denne filen eksponerer det admin-UI-ene forventer (ScheduleRow + CRUD-
// funksjoner). Typer gjenspeiler backend `ScheduleService` + wire-shape i
// packages/shared-types/src/schemas.ts (ScheduleRowSchema).
//
// Backend-router lever i apps/backend/src/routes/adminSchedules.ts
// (SCHEDULE_READ / SCHEDULE_WRITE).

import {
  listSchedules as apiListSchedules,
  getSchedule as apiGetSchedule,
  createSchedule as apiCreateSchedule,
  updateSchedule as apiUpdateSchedule,
  deleteSchedule as apiDeleteSchedule,
  type ScheduleRow as ApiScheduleRow,
  type ScheduleSubgame,
  type CreateScheduleInput as ApiCreateScheduleInput,
  type UpdateScheduleInput as ApiUpdateScheduleInput,
  type ListScheduleFilter,
} from "../../../api/admin-schedules.js";

export type { ScheduleSubgame };
export type ScheduleType = "Auto" | "Manual";
export type ScheduleStatus = "active" | "inactive";

/**
 * Row-shape brukt av admin-web. Fellesform mellom listen og detail-siden.
 * Matcher `ScheduleRowSchema` i shared-types; både `id` og `_id` er tilgjengelig
 * for bakoverkompatibilitet (legacy-skjermer brukte `_id` fra Mongo-opphav).
 */
export interface ScheduleRow extends ApiScheduleRow {
  /** Alias for `id` — legacy Mongo-skjemaet brukte `_id`. */
  _id: string;
}

export interface ScheduleFormPayload {
  scheduleName: string;
  scheduleType?: ScheduleType;
  luckyNumberPrize?: number;
  status?: ScheduleStatus;
  manualStartTime?: string;
  manualEndTime?: string;
  subGames?: ScheduleSubgame[];
}

export interface ScheduleListOptions {
  type?: ScheduleType;
  status?: ScheduleStatus;
  search?: string;
  limit?: number;
}

function attachLegacyId(row: ApiScheduleRow): ScheduleRow {
  return { ...row, _id: row.id };
}

export async function fetchScheduleList(
  opts: ScheduleListOptions = {}
): Promise<ScheduleRow[]> {
  const filter: ListScheduleFilter = {};
  if (opts.type) filter.type = opts.type;
  if (opts.status) filter.status = opts.status;
  if (opts.search) filter.search = opts.search;
  if (opts.limit !== undefined) filter.limit = opts.limit;
  const res = await apiListSchedules(filter);
  return res.schedules.map(attachLegacyId);
}

export async function fetchSchedule(id: string): Promise<ScheduleRow | null> {
  try {
    const row = await apiGetSchedule(id);
    return attachLegacyId(row);
  } catch {
    return null;
  }
}

export async function saveSchedule(
  payload: ScheduleFormPayload,
  existingId?: string
): Promise<ScheduleRow> {
  if (existingId) {
    const update: ApiUpdateScheduleInput = {
      scheduleName: payload.scheduleName,
    };
    if (payload.scheduleType) update.scheduleType = payload.scheduleType;
    if (payload.luckyNumberPrize !== undefined)
      update.luckyNumberPrize = payload.luckyNumberPrize;
    if (payload.status) update.status = payload.status;
    if (payload.manualStartTime !== undefined)
      update.manualStartTime = payload.manualStartTime;
    if (payload.manualEndTime !== undefined)
      update.manualEndTime = payload.manualEndTime;
    if (payload.subGames) update.subGames = payload.subGames;
    const row = await apiUpdateSchedule(existingId, update);
    return attachLegacyId(row);
  }
  const create: ApiCreateScheduleInput = {
    scheduleName: payload.scheduleName,
  };
  if (payload.scheduleType) create.scheduleType = payload.scheduleType;
  if (payload.luckyNumberPrize !== undefined)
    create.luckyNumberPrize = payload.luckyNumberPrize;
  if (payload.status) create.status = payload.status;
  if (payload.manualStartTime !== undefined)
    create.manualStartTime = payload.manualStartTime;
  if (payload.manualEndTime !== undefined)
    create.manualEndTime = payload.manualEndTime;
  if (payload.subGames) create.subGames = payload.subGames;
  const row = await apiCreateSchedule(create);
  return attachLegacyId(row);
}

export async function deleteSchedule(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<{ softDeleted: boolean }> {
  return apiDeleteSchedule(id, opts);
}
