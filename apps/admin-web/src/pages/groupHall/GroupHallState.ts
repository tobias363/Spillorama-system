// PR 4e.1 (2026-04-22) — state-laget for GroupHall-UI.
//
// Legger seg mellom api/admin-hall-groups.ts og GroupHall-sidene. Mirror-
// mønster fra apps/admin-web/src/pages/games/gameManagement/GameManagementState.ts:
//   - Thin wrapper rundt apiRequest-calls
//   - Normaliserer ApiError til WriteResult-envelope (ok-flag + reason)
//   - Row-typen er wire-shapen rett fra backend (vi mapper ikke ID-ene)
//
// Rapporteringsnivå: tester mocker kun fetch(), ikke denne fila direkte —
// se tests/groupHall/groupHallState.test.ts.
//
// Søkefilter (`search`) håndteres klient-side; backend tilbyr kun status +
// hallId som server-side filter.

import {
  listHallGroups,
  getHallGroup,
  createHallGroup as apiCreateHallGroup,
  updateHallGroup as apiUpdateHallGroup,
  deleteHallGroup as apiDeleteHallGroup,
  addHallToGroup as apiAddHallToGroup,
  removeHallFromGroup as apiRemoveHallFromGroup,
  type HallGroupRow,
  type HallGroupMember,
  type HallGroupStatus,
  type ListHallGroupFilter,
  type CreateHallGroupInput,
  type UpdateHallGroupInput,
} from "../../api/admin-hall-groups.js";
import { ApiError } from "../../api/client.js";

export type { HallGroupRow, HallGroupMember, HallGroupStatus };

/** Form-payload for create. */
export interface GroupHallCreatePayload {
  name: string;
  tvId?: number | null;
  hallIds?: string[];
  status?: HallGroupStatus;
  /** Free-form tekst-felt — persistert under `extra.description`. */
  description?: string;
}

/** Form-payload for patch — alle felt valgfrie. */
export interface GroupHallUpdatePayload {
  name?: string;
  tvId?: number | null;
  hallIds?: string[];
  status?: HallGroupStatus;
  description?: string;
}

/**
 * Normalisert write-resultat. Speiler GameManagementState.WriteResult.
 * BACKEND_MISSING er ikke relevant her (BIN-665 er levert), men tas med
 * for parity hvis Game 2/3 scheduler-integrasjon fylger på.
 */
export type WriteResult =
  | { ok: true; row: HallGroupRow }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "VALIDATION"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string };

export type DeleteResult =
  | { ok: true; softDeleted: boolean }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string };

export { ApiError };

function apiErrorToWriteResult(err: unknown): WriteResult {
  if (err instanceof ApiError) {
    if (err.status === 403) return { ok: false, reason: "PERMISSION_DENIED", message: err.message };
    if (err.status === 404) return { ok: false, reason: "NOT_FOUND", message: err.message };
    if (err.status === 400 || err.status === 422)
      return { ok: false, reason: "VALIDATION", message: err.message };
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

function apiErrorToDeleteResult(err: unknown): DeleteResult {
  if (err instanceof ApiError) {
    if (err.status === 403) return { ok: false, reason: "PERMISSION_DENIED", message: err.message };
    if (err.status === 404) return { ok: false, reason: "NOT_FOUND", message: err.message };
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

/**
 * Validering. Returnerer null om OK, ellers en oversatt i18n-nøkkel-tag
 * `{key}` som caller kan konvertere med t().
 */
export function validateGroupHallPayload(
  input: GroupHallCreatePayload | GroupHallUpdatePayload
): string | null {
  if ("name" in input && input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) return "name_required";
    if (name.length > 200) return "name_too_long";
  }
  if ("tvId" in input && input.tvId !== undefined && input.tvId !== null) {
    if (!Number.isInteger(input.tvId) || input.tvId < 0) return "tv_id_invalid";
  }
  if ("hallIds" in input && input.hallIds !== undefined) {
    for (const h of input.hallIds) {
      if (!h.trim()) return "hall_id_invalid";
    }
  }
  return null;
}

/** GET /api/admin/hall-groups — returnerer alle (ikke-slettede) grupper. */
export async function fetchHallGroupList(
  filter: ListHallGroupFilter = {}
): Promise<HallGroupRow[]> {
  const result = await listHallGroups(filter);
  // Klient-side name-search over hele resultat-settet.
  const search = filter.search?.trim().toLowerCase();
  if (!search) return result.groups;
  return result.groups.filter((g) =>
    g.name.toLowerCase().includes(search) ||
    g.id.toLowerCase().includes(search) ||
    g.members.some((m) => m.hallName.toLowerCase().includes(search))
  );
}

/** GET /api/admin/hall-groups/:id — null hvis ikke funnet. */
export async function fetchHallGroup(id: string): Promise<HallGroupRow | null> {
  try {
    return await getHallGroup(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

function toExtra(description?: string): Record<string, unknown> | undefined {
  if (description === undefined) return undefined;
  const trimmed = description.trim();
  return trimmed.length === 0 ? {} : { description: trimmed };
}

function extractDescription(extra: Record<string, unknown>): string {
  const raw = extra?.description;
  return typeof raw === "string" ? raw : "";
}

/** Helper for GroupHallEditorModal — trekker ut description fra `extra`. */
export function getDescriptionFromRow(row: HallGroupRow): string {
  return extractDescription(row.extra);
}

/** POST /api/admin/hall-groups. */
export async function createGroupHall(
  payload: GroupHallCreatePayload
): Promise<WriteResult> {
  const validationErr = validateGroupHallPayload(payload);
  if (validationErr) return { ok: false, reason: "VALIDATION", message: validationErr };
  try {
    const input: CreateHallGroupInput = {
      name: payload.name.trim(),
      hallIds: payload.hallIds ?? [],
    };
    if (payload.status) input.status = payload.status;
    if (payload.tvId !== undefined) input.tvId = payload.tvId;
    const extra = toExtra(payload.description);
    if (extra !== undefined) input.extra = extra;
    const row = await apiCreateHallGroup(input);
    return { ok: true, row };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** PATCH /api/admin/hall-groups/:id. */
export async function updateGroupHall(
  id: string,
  payload: GroupHallUpdatePayload
): Promise<WriteResult> {
  const validationErr = validateGroupHallPayload(payload);
  if (validationErr) return { ok: false, reason: "VALIDATION", message: validationErr };
  try {
    const update: UpdateHallGroupInput = {};
    if (payload.name !== undefined) update.name = payload.name.trim();
    if (payload.tvId !== undefined) update.tvId = payload.tvId;
    if (payload.hallIds !== undefined) update.hallIds = payload.hallIds;
    if (payload.status !== undefined) update.status = payload.status;
    const extra = toExtra(payload.description);
    if (extra !== undefined) update.extra = extra;
    if (Object.keys(update).length === 0) {
      return { ok: false, reason: "VALIDATION", message: "no_changes" };
    }
    const row = await apiUpdateHallGroup(id, update);
    return { ok: true, row };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** DELETE /api/admin/hall-groups/:id. Default soft-delete. */
export async function deleteGroupHall(
  id: string,
  opts: { hard?: boolean } = {}
): Promise<DeleteResult> {
  try {
    const result = await apiDeleteHallGroup(id, opts);
    return { ok: true, softDeleted: result.softDeleted };
  } catch (err) {
    return apiErrorToDeleteResult(err);
  }
}

/** Legg til én hall via diff-over-PATCH. Returnerer oppdatert rad. */
export async function addHallToGroup(
  id: string,
  hallId: string
): Promise<WriteResult> {
  if (!hallId.trim()) {
    return { ok: false, reason: "VALIDATION", message: "hall_id_invalid" };
  }
  try {
    const row = await apiAddHallToGroup(id, hallId);
    return { ok: true, row };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** Fjern én hall via diff-over-PATCH. Returnerer oppdatert rad. */
export async function removeHallFromGroup(
  id: string,
  hallId: string
): Promise<WriteResult> {
  if (!hallId.trim()) {
    return { ok: false, reason: "VALIDATION", message: "hall_id_invalid" };
  }
  try {
    const row = await apiRemoveHallFromGroup(id, hallId);
    return { ok: true, row };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}
