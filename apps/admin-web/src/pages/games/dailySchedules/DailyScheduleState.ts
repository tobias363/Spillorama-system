// DailySchedule state — legacy/unity-backend/App/Views/dailySchedules/* (6 files, 6 991 lines).
//
// Legacy files:
//   - view.html                      ( 385L) → top-level view (hall-scoped)
//   - create.html                    ( 878L) → create daily schedule
//   - createSpecialSchedules.html    ( 951L) → special-day schedules
//   - scheduleGame.html              (1 221L) → game-scheduling form
//   - editSubgame.html               (1 336L) → edit sub-game within slot
//   - viewSubgame.html               (2 220L) → view sub-game (largest in bolk)
//
// Legacy backend-routes (see legacy/unity-backend/src/routes/backend.js):
//   GET  /viewDailySchedule/:id              → view
//   GET  /createDailySchedule/:id            → create GET
//   POST /createDailySchedule                → create POST         ← PLACEHOLDER (BIN-626)
//   POST /createDailySpecialSchedule         → special POST        ← PLACEHOLDER (BIN-626)
//   GET  /editDailySchedule/:id              → edit subgame GET
//   POST /editDailySchedule/:id              → edit subgame POST   ← PLACEHOLDER (BIN-626)
//   GET  /viewDailySchduleDetails/:id        → view subgame [sic: legacy-typo]
//
// Partially supported via existing backend halls-schedule endpoints:
//   - /api/admin/halls/:hallId/schedule             (list)
//   - POST /api/admin/halls/:hallId/schedule        (create)
//   - PUT /api/admin/halls/:hallId/schedule/:slotId (update)
// but the legacy shape joins in patterns + sub-game metadata, which is not
// yet surfaced on the new endpoint. Until BIN-626, we keep these routes as
// placeholders.

/** Day-of-week bitmask — mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64. */
export type WeekDayMask = number;

export const WEEKDAY_MASKS = {
  mon: 1,
  tue: 2,
  wed: 4,
  thu: 8,
  fri: 16,
  sat: 32,
  sun: 64,
} as const;

export const WEEKDAY_MASK_ALL: WeekDayMask = 127;

export interface DailyScheduleRow {
  _id: string;
  hallId: string;
  gameTypeId: string;
  weekDays: WeekDayMask;
  startTime: string;
  endTime: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface DailyScheduleFormPayload {
  hallId: string;
  gameTypeId: string;
  weekDays: WeekDayMask;
  startTime: string;
  endTime: string;
  extra?: Record<string, unknown>;
}

export type WriteResult = { ok: false; reason: "BACKEND_MISSING"; issue: "BIN-626" };

export async function fetchDailyScheduleList(): Promise<DailyScheduleRow[]> {
  return [];
}

export async function fetchDailySchedule(_id: string): Promise<DailyScheduleRow | null> {
  return null;
}

export async function saveDailySchedule(
  _payload: DailyScheduleFormPayload,
  _existingId?: string
): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-626" };
}

export async function deleteDailySchedule(_id: string): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-626" };
}

/**
 * Combine an array of weekday keys into a WeekDayMask bitmask. Exported for
 * unit-testing — legacy encoding is used by the backend endpoint family.
 */
export function maskFromDays(days: Array<keyof typeof WEEKDAY_MASKS>): WeekDayMask {
  let mask: WeekDayMask = 0;
  for (const d of days) mask |= WEEKDAY_MASKS[d];
  return mask;
}

/** Decompose a WeekDayMask back into weekday keys. */
export function daysFromMask(mask: WeekDayMask): Array<keyof typeof WEEKDAY_MASKS> {
  const out: Array<keyof typeof WEEKDAY_MASKS> = [];
  for (const [k, v] of Object.entries(WEEKDAY_MASKS) as Array<[keyof typeof WEEKDAY_MASKS, number]>) {
    if ((mask & v) === v) out.push(k);
  }
  return out;
}
