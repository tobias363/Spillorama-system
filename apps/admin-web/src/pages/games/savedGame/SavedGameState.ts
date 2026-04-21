//
//   GET  /savedGameList                        → list (DataTable ajax)
//   GET  /savedGameDetailList/:id              → type-scoped details
//   POST /addSavedGameManagement/:typeId/:type → add POST    ← PLACEHOLDER (BIN-624)
//   GET  /savedGameManagementEdit/:typeId/:id  → edit-form GET (Game-3 variant)
//   GET  /viewSaveGameManagement/:id           → view-only
//
// Excluded backup files (archived in PR-A3a per PM decision):
//   - savedGame/gameAdd_bkp.html (1185L)
//   - savedGame/gameView_bkp.html (370L)
//   - savedGame/list copy.html   (422L)
//
// Write-ops are deferred to BIN-624 backend CRUD.

/** Row shape for the /savedGameList table. */
export interface SavedGameRow {
  _id: string;
  gameTypeId: string;
  name: string;
  status: "active" | "inactive";
  createdAt: string;
}

/** Form payload (mirrors legacy savedGame/gameAdd.html; ~50 fields collapsed to opaque extra). */
export interface SavedGameFormPayload {
  gameTypeId: string;
  name: string;
  extra?: Record<string, unknown>;
}

export type WriteResult = { ok: false; reason: "BACKEND_MISSING"; issue: "BIN-624" };

/** PLACEHOLDER — list endpoint not yet ported. Returns [] until BIN-624. */
export async function fetchSavedGameList(): Promise<SavedGameRow[]> {
  return [];
}

/** PLACEHOLDER — single fetch for view/:id. Returns null until BIN-624. */
export async function fetchSavedGame(_id: string): Promise<SavedGameRow | null> {
  return null;
}

/** PLACEHOLDER — save not yet backed. Tracked in BIN-624. */
export async function saveSavedGame(
  _payload: SavedGameFormPayload,
  _existingId?: string
): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-624" };
}

/** PLACEHOLDER — delete not yet backed. Tracked in BIN-624. */
export async function deleteSavedGame(_id: string): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-624" };
}
