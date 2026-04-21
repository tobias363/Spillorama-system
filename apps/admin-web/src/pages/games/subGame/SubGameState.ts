//
//   GET  /subGame                            → list-page (DataTable ajax: /subGames/getSubGameList)
//   GET  /addSubGame                         → add-form GET
//   POST /addSubGameData                     → add-form POST          ← PLACEHOLDER (BIN-621)
//   GET  /subGameEdit/:id                    → edit-form GET (reuses add.html)
//   POST /subGameEdit/:id                    → edit-form POST         ← PLACEHOLDER (BIN-621)
//   GET  /viewSubGame/:id                    → view-only page
//   POST /subGames/getSubGameDelete          → delete                 ← PLACEHOLDER (BIN-621)
//   POST /checkForGameName/                  → uniqueness check        ← PLACEHOLDER (BIN-621)
//
// A SubGame is a named bundle of (pattern-row-ids, ticket-color-ids, status).
//   { _id, gameName, patternRow: [{ patternId, name }], ticketColor: [{ name }], status, createdAt }
//
// Write-ops are deferred to BIN-621 backend CRUD; this module intentionally
// does NOT call fetch() for POST/PUT/DELETE in this PR.

import type { GameType } from "../common/types.js";

/** Single pattern-row reference embedded in a sub-game. */
export interface SubGamePatternRow {
  /** Pattern-row _id (legacy ObjectId string). */
  patternId: string;
  /** Display name e.g. "1 line", "2 lines", "Full house". */
  name: string;
}

/** Single ticket-color reference embedded in a sub-game. */
export interface SubGameTicketColor {
  /** Color name (e.g. "Yellow", "Blue"). Legacy stored the string directly. */
  name: string;
}

/** Row shape for the sub-game list/view pages. */
export interface SubGameRow {
  _id: string;
  gameName: string;
  patternRow: SubGamePatternRow[];
  ticketColor: SubGameTicketColor[];
  status: "active" | "inactive";
  createdAt: string;
  /**
   * GameType scope — legacy inferred from the sidebar entry that loaded the
   * page (always Game 1 in practice, since only Game 1 had sub-games). We keep
   * the field explicit so Game 4 (DEPRECATED) rows can be filtered out.
   */
  gameTypeRef?: Pick<GameType, "type">;
}

/** Form payload (mirrors legacy `addSubGame` + `subGameEdit` bodies). */
export interface SubGameFormPayload {
  gameName: string;
  /** Array of pattern-row _id's — matches legacy `selectPatternRow` multi-select. */
  selectPatternRow: string[];
  /** Array of ticket color names (strings, legacy-compat). */
  selectTicketColor: string[];
  status: "active" | "inactive";
}

/** Outcome of a placeholder write-op — matches the BIN-620 GameType contract. */
export type WriteResult =
  | { ok: false; reason: "BACKEND_MISSING"; issue: "BIN-621" };

/**
 * PLACEHOLDER — list endpoint not yet ported. Returns empty array so the
 * DataTable still renders (with the empty-state message from the legacy
 * shell). Tracked in BIN-621.
 */
export async function fetchSubGameList(): Promise<SubGameRow[]> {
  // NOTE: when BIN-621 lands, call apiRequest("/api/admin/sub-games", { auth: true })
  // here and map the response.
  return [];
}

/** PLACEHOLDER — single fetch for view/:id. Returns null until BIN-621. */
export async function fetchSubGame(_id: string): Promise<SubGameRow | null> {
  return null;
}

/** PLACEHOLDER — save not yet backed. Tracked in BIN-621. */
export async function saveSubGame(
  _payload: SubGameFormPayload,
  _existingId?: string
): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-621" };
}

/** PLACEHOLDER — delete not yet backed. Tracked in BIN-621. */
export async function deleteSubGame(_id: string): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-621" };
}

/**
 * PLACEHOLDER — name-uniqueness AJAX replacement for legacy
 * `/checkForGameName/`. Until BIN-621 ships, we accept any name that passes
 * basic validation (non-empty, <= 40 chars, not purely whitespace).
 */
export function isGameNameLocallyValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 40;
}

/**
 * Legacy ticket-color options. Mirrors the `ticketColors` variable populated
 * as a constant until BIN-621 ships a proper backend endpoint.
 *
 * Source of truth: Unity TicketColorManager (see apps/game1-unity/.../).
 * These legacy names remain the user-facing labels in admin even though
 * Unity runtime uses different internal keys.
 */
export const LEGACY_TICKET_COLOR_OPTIONS = [
  "Yellow",
  "Blue",
  "Green",
  "Red",
  "White",
  "Orange",
  "Pink",
  "Violet",
] as const;
