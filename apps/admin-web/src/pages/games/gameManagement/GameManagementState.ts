// GameManagement state — legacy/unity-backend/App/Views/GameManagement/* (9 267 lines across 10 files).
//
// BIN-684 wire-up (bolk 1): erstatter BIN-622 placeholders med live
// apiRequest-calls mot `/api/admin/game-management/*`. Se
// `apps/admin-web/src/api/admin-game-management.ts` for kontrakt.
//
// Ikke-merget ennå — fortsatt placeholders:
//   - BIN-623 closeDay endpoint → `closeDay()` returnerer BACKEND_MISSING
//   - tickets-per-game endpoint → `fetchGameTickets()` returnerer []
//     (legacy hadde 4-tabell join; backend har ingen rute ennå — se GM
//      Detail tickets-side for placeholder-banner.)

import type { GameType } from "../common/types.js";
import {
  listGameManagement,
  getGameManagement as apiGetGameManagement,
  createGameManagement,
  updateGameManagement,
  deleteGameManagement as apiDeleteGameManagement,
  repeatGameManagement,
  type AdminGameManagement,
  type GameManagementStatus,
  type GameManagementTicketType,
} from "../../../api/admin-game-management.js";
import { ApiError } from "../../../api/client.js";

/** List-row shape for the main /gameManagement/:typeId/list table. */
export interface GameManagementRow {
  _id: string;
  /** FK → GameType._id (slug in new backend). Scopes visibility per dropdown. */
  gameTypeId: string;
  /** Parent game id (game_1 has child sub-games; game_3 has children per flavor). */
  childId?: string;
  name: string;
  /** "Large" ticket = 5x5 classic, "Small" = 3x5 databingo-60. Legacy had this. */
  ticketType: GameManagementTicketType | null;
  ticketPrice: number;
  startDate: string;
  endDate?: string;
  /** Legacy had "active" (pre-start), "running", "closed" — we preserve it. */
  status: GameManagementStatus;
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
  ticketType: GameManagementTicketType;
  ticketPrice: number;
  startDate: string;
  endDate?: string;
  status?: GameManagementStatus;
  // Legacy har ~50 flere felt (prize tiers, hall-group visibility, sub-game
  // komposisjon, ticket-color lists). Disse sendes opaque i `config` og
  // normaliseres av backend `config_json`-kolonnen.
  config?: Record<string, unknown>;
}

/** Repeat-game payload — legacy "Repeat"-modal rebinds startDate/endDate. */
export interface RepeatGamePayload {
  sourceGameId: string;
  startDate: string;
  endDate?: string;
  /** Idempotens — samme token returnerer samme nye rad ved retry. */
  repeatToken?: string;
  /** Valgfritt overstyrt navn (ellers gjenbruker backend source-name). */
  name?: string;
}

/** Close-day payload — BIN-623 (ikke levert ennå). */
export interface CloseDayPayload {
  gameTypeId: string;
  gameId: string;
  closeDate: string;
}

/**
 * Unified write-result contract. Success → ok:true med oppdatert row.
 * Feil-varianter:
 *   - PERMISSION_DENIED (HTTP 403)  — admin mangler GAME_MGMT_WRITE
 *   - NOT_FOUND (HTTP 404)          — spill finnes ikke
 *   - BACKEND_ERROR (HTTP 500-ish)  — transient / retry
 *   - BACKEND_MISSING (BIN-623)     — closeDay-endpoint ikke levert
 */
export type WriteResult =
  | { ok: true; row: GameManagementRow }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string }
  | { ok: false; reason: "BACKEND_MISSING"; issue: "BIN-623" };

/** Map backend-wire-shape til Row-formen UI-en bruker. */
function toRow(gm: AdminGameManagement): GameManagementRow {
  return {
    _id: gm.id,
    gameTypeId: gm.gameTypeId,
    childId: gm.parentId ?? undefined,
    name: gm.name,
    ticketType: gm.ticketType,
    ticketPrice: gm.ticketPrice,
    startDate: gm.startDate,
    endDate: gm.endDate ?? undefined,
    status: gm.status,
    totalSold: gm.totalSold,
    totalEarning: gm.totalEarning,
    createdAt: gm.createdAt,
  };
}

/** Sentinel-kastet av wrappers når API returnerer ApiError — for testing. */
export { ApiError };

/** Map ApiError til normalisert WriteResult. */
function apiErrorToWriteResult(err: unknown): WriteResult {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return { ok: false, reason: "PERMISSION_DENIED", message: err.message };
    }
    if (err.status === 404) {
      return { ok: false, reason: "NOT_FOUND", message: err.message };
    }
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

/** GET /api/admin/game-management?gameTypeId=X — BIN-622 live. */
export async function fetchGameManagementList(typeId: string): Promise<GameManagementRow[]> {
  const result = await listGameManagement({ gameTypeId: typeId });
  return result.games.map(toRow);
}

/** GET /api/admin/game-management/:typeId/:id — BIN-622 live. */
export async function fetchGameManagement(
  typeId: string,
  id: string
): Promise<GameManagementRow | null> {
  try {
    const gm = await apiGetGameManagement(typeId, id);
    return toRow(gm);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Tickets-per-game. Legacy slo sammen 4 Mongo-kolleksjoner; det finnes enda
 * ingen ekvivalent backend-endpoint. Returnerer [] inntil utstedt.
 */
export async function fetchGameTickets(_typeId: string, _id: string): Promise<GameManagementRow[]> {
  return [];
}

/** POST/PATCH /api/admin/game-management — BIN-622 live. */
export async function saveGameManagement(
  payload: GameManagementFormPayload,
  existingId?: string
): Promise<WriteResult> {
  try {
    const gm = existingId
      ? await updateGameManagement(existingId, {
          name: payload.name,
          ticketType: payload.ticketType,
          ticketPrice: payload.ticketPrice,
          startDate: payload.startDate,
          endDate: payload.endDate ?? null,
          status: payload.status,
          config: payload.config,
        })
      : await createGameManagement({
          gameTypeId: payload.gameTypeId,
          name: payload.name,
          ticketType: payload.ticketType,
          ticketPrice: payload.ticketPrice,
          startDate: payload.startDate,
          endDate: payload.endDate ?? null,
          status: payload.status,
          config: payload.config,
        });
    return { ok: true, row: toRow(gm) };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** POST /api/admin/game-management/:id/repeat — BIN-622 live (idempotent via repeatToken). */
export async function repeatGame(payload: RepeatGamePayload): Promise<WriteResult> {
  try {
    const gm = await repeatGameManagement(payload.sourceGameId, {
      startDate: payload.startDate,
      endDate: payload.endDate ?? null,
      name: payload.name ?? null,
      repeatToken: payload.repeatToken ?? null,
    });
    return { ok: true, row: toRow(gm) };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** BIN-623 closeDay endpoint — IKKE levert ennå. */
export async function closeDay(_payload: CloseDayPayload): Promise<WriteResult> {
  return { ok: false, reason: "BACKEND_MISSING", issue: "BIN-623" };
}

/** DELETE /api/admin/game-management/:id — BIN-622 live (soft-delete default). */
export async function deleteGameManagement(
  _typeId: string,
  id: string,
  hard = false
): Promise<WriteResult> {
  try {
    await apiDeleteGameManagement(id, hard);
    // Soft-delete fortsatt har rad — men UI trenger ikke oppdatert row-data,
    // så vi returnerer en dummy-row. Caller bruker bare ok-flag.
    return {
      ok: true,
      row: {
        _id: id,
        gameTypeId: "",
        name: "",
        ticketType: null,
        ticketPrice: 0,
        startDate: "",
        status: "inactive",
        createdAt: "",
      },
    };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/**
 * True if the given GameType is "Game 3"-shaped — admin uses a dedicated
 * add/view variant (`game3Add.html` / `game3View.html`) with pattern-selector
 * grid instead of the sub-game multi-select.
 */
export function isGame3Variant(gt: Pick<GameType, "type"> | null | undefined): boolean {
  return gt?.type === "game_3";
}
