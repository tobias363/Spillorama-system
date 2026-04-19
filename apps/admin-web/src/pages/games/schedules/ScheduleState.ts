// Schedule state — legacy/unity-backend/App/Views/schedules/* (3 files, 6 530 lines).
//
// Legacy files:
//   - schedule.html  (  246L) → list
//   - create.html    (5 382L) → complex scheduler-builder (nested subgame modals, hall-groups, timezones)
//   - view.html      (  902L) → read-only view
//
// Legacy backend-routes (see legacy/unity-backend/src/routes/backend.js):
//   GET  /schedules              → list
//   GET  /createSchedule         → create-form GET
//   POST /createSchedule         → create POST          ← PLACEHOLDER (BIN-625)
//   GET  /viewSchedule/:id       → view-only
//
// schedule.create.html is the largest single file in PR-A3 (16 % of total legacy
// linjer). The full builder UI lands in a BIN-625 follow-up PR; this file exposes
// the state contract + placeholder fetchers so the shell mounts cleanly.

export interface ScheduleRow {
  _id: string;
  name: string;
  startDate: string;
  endDate?: string;
  hallGroupId?: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface ScheduleSubGame {
  _id?: string;
  scheduleId: string;
  subGameId: string;
  startTime: string;
  priceOverride?: number;
}

export interface ScheduleFormPayload {
  name: string;
  startDate: string;
  endDate?: string;
  hallGroupIds: string[];
  subGames: ScheduleSubGame[];
}

export type WriteResult = { ok: false; reason: "BACKEND_MISSING"; issue: "BIN-625" };

/** PLACEHOLDER — list endpoint not yet ported. Returns [] until BIN-625. */
export async function fetchScheduleList(): Promise<ScheduleRow[]> {
  return [];
}

/** PLACEHOLDER — single fetch for view/:id. Returns null until BIN-625. */
export async function fetchSchedule(_id: string): Promise<ScheduleRow | null> {
  return null;
}

/** PLACEHOLDER — save not yet backed. Tracked in BIN-625. */
export async function saveSchedule(
  _payload: ScheduleFormPayload,
  _existingId?: string
): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-625" };
}

/** PLACEHOLDER — delete (BIN-625). */
export async function deleteSchedule(_id: string): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-625" };
}
