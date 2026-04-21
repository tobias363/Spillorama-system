// BIN-626: DailySchedule admin state — wired to /api/admin/daily-schedules.
//
// Mirror av apps/backend/src/routes/adminDailySchedules.ts. Typer canonical
// i packages/shared-types/src/schemas.ts (DailyScheduleRowSchema).
//
// WeekDayMask-helpers beholdes her så legacy-tester som importerer dem
// fortsatt fungerer. De delegerer til api/admin-daily-schedules.ts.

import {
  listDailySchedules as apiListDailySchedules,
  getDailySchedule as apiGetDailySchedule,
  getDailyScheduleDetails as apiGetDailyScheduleDetails,
  createDailySchedule as apiCreateDailySchedule,
  createSpecialDailySchedule as apiCreateSpecialDailySchedule,
  updateDailySchedule as apiUpdateDailySchedule,
  deleteDailySchedule as apiDeleteDailySchedule,
  type DailyScheduleRow as ApiDailyScheduleRow,
  type DailyScheduleHallIds,
  type DailyScheduleSubgameSlot,
  type CreateDailyScheduleInput as ApiCreateDailyScheduleInput,
  type UpdateDailyScheduleInput as ApiUpdateDailyScheduleInput,
  type DailyScheduleDetailsResponse,
  type DailyScheduleStatus,
  type DailyScheduleDay,
  type ListDailyScheduleFilter,
  WEEKDAY_MASKS,
  WEEKDAY_MASK_ALL,
  maskFromDays,
  daysFromMask,
} from "../../../api/admin-daily-schedules.js";

export {
  WEEKDAY_MASKS,
  WEEKDAY_MASK_ALL,
  maskFromDays,
  daysFromMask,
};
export type {
  DailyScheduleHallIds,
  DailyScheduleSubgameSlot,
  DailyScheduleStatus,
  DailyScheduleDay,
  DailyScheduleDetailsResponse,
};
export type WeekDayMask = number;

/**
 * DailySchedule-rad brukt av admin-web. Beriket med `_id`-alias for
 * bakoverkompatibilitet med legacy Mongo-skjermer.
 */
export interface DailyScheduleRow extends ApiDailyScheduleRow {
  _id: string;
}

export interface DailyScheduleFormPayload {
  name: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string;
  endTime?: string;
  gameManagementId?: string | null;
  hallId?: string | null;
  hallIds?: DailyScheduleHallIds;
  weekDays?: number;
  day?: DailyScheduleDay | null;
  status?: DailyScheduleStatus;
  stopGame?: boolean;
  specialGame?: boolean;
  isSavedGame?: boolean;
  isAdminSavedGame?: boolean;
  subgames?: DailyScheduleSubgameSlot[];
  otherData?: Record<string, unknown>;
}

export interface DailyScheduleListOptions {
  gameManagementId?: string;
  hallId?: string;
  weekDays?: number;
  fromDate?: string;
  toDate?: string;
  status?: DailyScheduleStatus;
  specialGame?: boolean;
  limit?: number;
}

function attachLegacyId(row: ApiDailyScheduleRow): DailyScheduleRow {
  return { ...row, _id: row.id };
}

export async function fetchDailyScheduleList(
  opts: DailyScheduleListOptions = {}
): Promise<DailyScheduleRow[]> {
  const filter: ListDailyScheduleFilter = {};
  if (opts.gameManagementId) filter.gameManagementId = opts.gameManagementId;
  if (opts.hallId) filter.hallId = opts.hallId;
  if (opts.weekDays !== undefined) filter.weekDays = opts.weekDays;
  if (opts.fromDate) filter.fromDate = opts.fromDate;
  if (opts.toDate) filter.toDate = opts.toDate;
  if (opts.status) filter.status = opts.status;
  if (opts.specialGame !== undefined) filter.specialGame = opts.specialGame;
  if (opts.limit !== undefined) filter.limit = opts.limit;
  const res = await apiListDailySchedules(filter);
  return res.schedules.map(attachLegacyId);
}

export async function fetchDailySchedule(id: string): Promise<DailyScheduleRow | null> {
  try {
    const row = await apiGetDailySchedule(id);
    return attachLegacyId(row);
  } catch {
    return null;
  }
}

export async function fetchDailyScheduleDetails(
  id: string
): Promise<DailyScheduleDetailsResponse | null> {
  try {
    return await apiGetDailyScheduleDetails(id);
  } catch {
    return null;
  }
}

function toCreate(payload: DailyScheduleFormPayload): ApiCreateDailyScheduleInput {
  const input: ApiCreateDailyScheduleInput = {
    name: payload.name,
    startDate: payload.startDate,
  };
  if (payload.endDate !== undefined) input.endDate = payload.endDate;
  if (payload.startTime !== undefined) input.startTime = payload.startTime;
  if (payload.endTime !== undefined) input.endTime = payload.endTime;
  if (payload.gameManagementId !== undefined)
    input.gameManagementId = payload.gameManagementId;
  if (payload.hallId !== undefined) input.hallId = payload.hallId;
  if (payload.hallIds !== undefined) input.hallIds = payload.hallIds;
  if (payload.weekDays !== undefined) input.weekDays = payload.weekDays;
  if (payload.day !== undefined) input.day = payload.day;
  if (payload.status !== undefined) input.status = payload.status;
  if (payload.stopGame !== undefined) input.stopGame = payload.stopGame;
  if (payload.specialGame !== undefined) input.specialGame = payload.specialGame;
  if (payload.isSavedGame !== undefined) input.isSavedGame = payload.isSavedGame;
  if (payload.isAdminSavedGame !== undefined)
    input.isAdminSavedGame = payload.isAdminSavedGame;
  if (payload.subgames !== undefined) input.subgames = payload.subgames;
  if (payload.otherData !== undefined) input.otherData = payload.otherData;
  return input;
}

function toUpdate(payload: Partial<DailyScheduleFormPayload>): ApiUpdateDailyScheduleInput {
  const input: ApiUpdateDailyScheduleInput = {};
  if (payload.name !== undefined) input.name = payload.name;
  if (payload.startDate !== undefined) input.startDate = payload.startDate;
  if (payload.endDate !== undefined) input.endDate = payload.endDate;
  if (payload.startTime !== undefined) input.startTime = payload.startTime;
  if (payload.endTime !== undefined) input.endTime = payload.endTime;
  if (payload.gameManagementId !== undefined)
    input.gameManagementId = payload.gameManagementId;
  if (payload.hallId !== undefined) input.hallId = payload.hallId;
  if (payload.hallIds !== undefined) input.hallIds = payload.hallIds;
  if (payload.weekDays !== undefined) input.weekDays = payload.weekDays;
  if (payload.day !== undefined) input.day = payload.day;
  if (payload.status !== undefined) input.status = payload.status;
  if (payload.stopGame !== undefined) input.stopGame = payload.stopGame;
  if (payload.specialGame !== undefined) input.specialGame = payload.specialGame;
  if (payload.isSavedGame !== undefined) input.isSavedGame = payload.isSavedGame;
  if (payload.isAdminSavedGame !== undefined)
    input.isAdminSavedGame = payload.isAdminSavedGame;
  if (payload.subgames !== undefined) input.subgames = payload.subgames;
  if (payload.otherData !== undefined) input.otherData = payload.otherData;
  return input;
}

export async function saveDailySchedule(
  payload: DailyScheduleFormPayload,
  existingId?: string
): Promise<DailyScheduleRow> {
  if (existingId) {
    const row = await apiUpdateDailySchedule(existingId, toUpdate(payload));
    return attachLegacyId(row);
  }
  const row = await apiCreateDailySchedule(toCreate(payload));
  return attachLegacyId(row);
}

/**
 * Opprett en special-schedule (specialGame=true håndheves serverside).
 * Bruker samme form-payload som `saveDailySchedule`.
 */
export async function saveSpecialDailySchedule(
  payload: DailyScheduleFormPayload
): Promise<DailyScheduleRow> {
  const row = await apiCreateSpecialDailySchedule(toCreate(payload));
  return attachLegacyId(row);
}

export async function deleteDailySchedule(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<{ softDeleted: boolean }> {
  return apiDeleteDailySchedule(id, opts);
}
