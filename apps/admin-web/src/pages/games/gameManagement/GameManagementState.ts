//
//   GET  /gameManagement                              → type-picker + list
//   GET  /gameManagementDetailList/:id                → type-scoped list (DataTable ajax)
//   GET  /addGameManagement/:id                       → add-form GET (Game 1/2)
//   GET  /addGameManagement/:id  (game3 mode)         → add-form GET (Game 3 — game3Add.html)
//   POST /addGameManagement/:typeId/:type             → add POST           ← PLACEHOLDER (BIN-622)
//   GET  /viewGameManagement/:typeId/:id              → view-only page
//   GET  /viewsubGamesManagement/:typeId/:id          → nested sub-games
//   GET  /viewGameTickets/:typeId/:id                 → ticket-view list
//   GET  /closeDayGameManagement/:typeId/:id/:type    → close-day page
//   POST /closeDayGameManagement/...                  → close POST         ← PLACEHOLDER (BIN-623)
//   POST /repeatGame/...                              → repeat-game POST   ← PLACEHOLDER (BIN-622)
//
// Write-ops are deferred to BIN-622 (CRUD + repeat) and BIN-623 (close-day);
// this module intentionally does NOT call fetch() for POST/PUT/DELETE in PR-A3b.
//
// The list endpoint itself (GET) is gated on BIN-622 — legacy joined 4 Mongo
// collections (Game, SubGame, GameType, HallGroup) which we cannot reproduce
// without the new-backend endpoint. Until then fetch returns [] and the UI
// surfaces the same "awaiting backend" banner as the sub-game stack.

import type { GameType } from "../common/types.js";

/** List-row shape for the main /gameManagement/:typeId/list table. */
export interface GameManagementRow {
  _id: string;
  /** FK → GameType._id (slug in new backend). Scopes visibility per dropdown. */
  gameTypeId: string;
  /** Parent game id (game_1 has child sub-games; game_3 has children per flavor). */
  childId?: string;
  name: string;
  /** "Large" ticket = 5x5 classic, "Small" = 3x5 databingo-60. Legacy had this. */
  ticketType: "Large" | "Small" | null;
  ticketPrice: number;
  startDate: string;
  endDate?: string;
  /** Legacy had "active" (pre-start), "running", "closed" — we preserve it. */
  status: "active" | "running" | "closed" | "inactive";
  /** Tickets sold from unique-id channels + digital sales (summed in legacy). */
  totalSold?: number;
  /** Sum of sold-ticket earnings (currency amount). */
  totalEarning?: number;
  createdAt: string;
}

/** Form-payload shape (mirrors legacy gameAdd.html / game3Add.html). */
export interface GameManagementFormPayload {
  gameTypeId: string;
  name: string;
  ticketType: "Large" | "Small";
  ticketPrice: number;
  startDate: string;
  endDate?: string;
  // Legacy has ~50 more fields (prize tiers, hall-group visibility, sub-game
  // composition, ticket-color lists). They're modelled as opaque key→value
  // until BIN-622 backend lands and we can negotiate the exact schema.
  extra?: Record<string, unknown>;
}

/** Repeat-game payload — legacy "Repeat"-modal rebinds startDate/endDate. */
export interface RepeatGamePayload {
  sourceGameId: string;
  startDate: string;
  endDate?: string;
}

/** Close-day payload — confirms day-end cut-off for a running game. */
export interface CloseDayPayload {
  gameTypeId: string;
  gameId: string;
  closeDate: string;
}

/** Unified write-result contract — matches GameType/SubGame placeholder shape. */
export type WriteResult =
  | { ok: false; reason: "BACKEND_MISSING"; issue: "BIN-622" | "BIN-623" };

/**
 * PLACEHOLDER — list endpoint not yet ported. Returns empty array so the
 * DataTable still renders (with the empty-state message from the legacy
 * shell). Tracked in BIN-622.
 *
 * When BIN-622 lands, call apiRequest(`/api/admin/game-management?typeId=${typeId}`).
 */
export async function fetchGameManagementList(_typeId: string): Promise<GameManagementRow[]> {
  return [];
}

/** PLACEHOLDER — single fetch for view/:id. Returns null until BIN-622. */
export async function fetchGameManagement(_typeId: string, _id: string): Promise<GameManagementRow | null> {
  return null;
}

/**
 * PLACEHOLDER — tickets-for-a-game. Legacy opened a nested modal/table with the
 * list of physical + digital tickets bought for a specific game; it also shows
 * running-game ball-draw. Returns [] until BIN-622.
 */
export async function fetchGameTickets(_typeId: string, _id: string): Promise<GameManagementRow[]> {
  return [];
}

/** PLACEHOLDER — save not yet backed. Tracked in BIN-622. */
export async function saveGameManagement(
  _payload: GameManagementFormPayload,
  _existingId?: string
): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-622" };
}

/** PLACEHOLDER — repeat-game endpoint (BIN-622). */
export async function repeatGame(_payload: RepeatGamePayload): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-622" };
}

/** PLACEHOLDER — close-day endpoint (BIN-623). */
export async function closeDay(_payload: CloseDayPayload): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-623" };
}

/** PLACEHOLDER — delete (BIN-622). */
export async function deleteGameManagement(
  _typeId: string,
  _id: string
): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-622" };
}

/**
 * True if the given GameType is "Game 3"-shaped — admin uses a dedicated
 * add/view variant (`game3Add.html` / `game3View.html`) with pattern-selector
 * grid instead of the sub-game multi-select.
 */
export function isGame3Variant(gt: Pick<GameType, "type"> | null | undefined): boolean {
  return gt?.type === "game_3";
}
