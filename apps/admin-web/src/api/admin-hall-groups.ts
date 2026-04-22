// BIN-665/666: admin-web API-wrapper for HallGroup CRUD.
//
// PR 4e.1 (2026-04-22) — utvidelse av basis-CRUD for GroupHall-UI wire-up:
//   * `listHallGroups` / `fetchHallGroupList` — backend støtter `status`
//     + `hallId` som server-side filter. `search` filtreres klient-side
//     i GroupHallListPage.
//   * `fetchHallGroupMembers` — konvenienshenter som trekker ut
//     `members`-feltet fra detail-responsen.
//   * `addHallToGroup` / `removeHallFromGroup` — backend eksponerer ikke
//     dedikerte member-endpoints; vi implementerer som diff-over-PATCH
//     mot `hallIds` (backend erstatter hele medlemsskaps-listen).
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
  /** Serverside: scope til grupper som inkluderer gitt hall. */
  hallId?: string;
  /** Klientside filter — brukes av list-page for name-search. */
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
  if (filter.hallId) qs.set("hallId", filter.hallId);
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

/** Alias for PR 4e.1 design-dok — same payload som listHallGroups. */
export async function fetchHallGroupList(
  filter: ListHallGroupFilter = {}
): Promise<HallGroupListResult> {
  return listHallGroups(filter);
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

// ── Member-helpers ──────────────────────────────────────────────────────────
//
// Backend eksponerer ingen dedikerte /members-endpoints — medlemskap
// mutasjoneres via PATCH-en for hele gruppen med et nytt `hallIds`-array.
// Disse wrappers gjør diff-en for callers som ikke vil håndtere hele listen.

/** Hent medlemshallene i en gruppe (henter hele gruppen og plukker `members`). */
export async function fetchHallGroupMembers(id: string): Promise<HallGroupMember[]> {
  const group = await getHallGroup(id);
  return group.members;
}

/** Legg til en hall. Idempotent — gjør ingen endring hvis hall-id allerede er medlem. */
export async function addHallToGroup(
  id: string,
  hallId: string
): Promise<HallGroupRow> {
  const group = await getHallGroup(id);
  const current = group.members.map((m) => m.hallId);
  if (current.includes(hallId)) return group;
  return updateHallGroup(id, { hallIds: [...current, hallId] });
}

/** Fjern en hall. Idempotent — gjør ingen endring hvis hall-id ikke er medlem. */
export async function removeHallFromGroup(
  id: string,
  hallId: string
): Promise<HallGroupRow> {
  const group = await getHallGroup(id);
  const current = group.members.map((m) => m.hallId);
  if (!current.includes(hallId)) return group;
  return updateHallGroup(id, {
    hallIds: current.filter((x) => x !== hallId),
  });
}
