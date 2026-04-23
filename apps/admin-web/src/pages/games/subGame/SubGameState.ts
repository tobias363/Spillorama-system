// SubGameState — wires admin-UI to BIN-621 backend endpoints
// (`/api/admin/sub-games/*` via admin-sub-games.ts).
//
// A SubGame is a named bundle of (pattern-row-ids, ticket-color-names, status).
// Backend shape:
//   { id, gameTypeId, gameName, name, subGameNumber, patternRows: [{patternId, name}],
//     ticketColors: [...], status, extra, createdAt, updatedAt }
//
// UI-facing shape (legacy-compat, used by list/view pages):
//   { _id, gameName, patternRow: [{patternId, name}], ticketColor: [{name}],
//     status, createdAt, gameTypeRef }

import {
  listSubGames,
  getSubGame as apiGetSubGame,
  createSubGame as apiCreateSubGame,
  updateSubGame as apiUpdateSubGame,
  deleteSubGame as apiDeleteSubGame,
  type AdminSubGame,
  type SubGamePatternRef,
} from "../../../api/admin-sub-games.js";
import { ApiError } from "../../../api/client.js";
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
  /** Backend gameTypeId (slug or UUID). */
  gameTypeId?: string;
  gameName: string;
  patternRow: SubGamePatternRow[];
  ticketColor: SubGameTicketColor[];
  status: "active" | "inactive";
  createdAt: string;
  /** GameType scope — legacy inferred from the sidebar entry that loaded the page. */
  gameTypeRef?: Pick<GameType, "type">;
}

/** Form payload (mirrors legacy `addSubGame` + `subGameEdit` bodies). */
export interface SubGameFormPayload {
  /** gameTypeId required on create — UI collects it from a dropdown. */
  gameTypeId?: string;
  gameName: string;
  /** Array of pattern-row _id's — matches legacy `selectPatternRow` multi-select. */
  selectPatternRow: string[];
  /** Array of ticket color names (strings, legacy-compat). */
  selectTicketColor: string[];
  status: "active" | "inactive";
}

/** Unified write-result contract. Mirrors BIN-620 GameType pattern. */
export type WriteResult =
  | { ok: true; row: SubGameRow }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "VALIDATION"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string };

function toRow(sg: AdminSubGame): SubGameRow {
  return {
    _id: sg.id,
    gameTypeId: sg.gameTypeId,
    gameName: sg.gameName || sg.name,
    patternRow: sg.patternRows.map((p) => ({ patternId: p.patternId, name: p.name })),
    ticketColor: (sg.ticketColors ?? []).map((c) => ({ name: c })),
    status: sg.status,
    createdAt: sg.createdAt,
  };
}

function apiErrorToWriteResult(err: unknown): WriteResult {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return { ok: false, reason: "PERMISSION_DENIED", message: err.message };
    }
    if (err.status === 404) {
      return { ok: false, reason: "NOT_FOUND", message: err.message };
    }
    if (err.status === 400) {
      return { ok: false, reason: "VALIDATION", message: err.message };
    }
    return { ok: false, reason: "BACKEND_ERROR", message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, reason: "BACKEND_ERROR", message: msg };
}

/**
 * Fetch SubGame list via BIN-621 endpoint. Returns [] on 404 (backend
 * not migrated) or on empty result.
 */
export async function fetchSubGameList(gameTypeId?: string): Promise<SubGameRow[]> {
  try {
    const params = gameTypeId ? { gameTypeId } : {};
    const result = await listSubGames(params);
    return (result.subGames ?? []).map(toRow);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return [];
    }
    throw err;
  }
}

/** Fetch SubGame detail by id. Returns null on 404. */
export async function fetchSubGame(id: string): Promise<SubGameRow | null> {
  try {
    const sg = await apiGetSubGame(id);
    return toRow(sg);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Create or update a SubGame. */
export async function saveSubGame(
  payload: SubGameFormPayload,
  existingId?: string
): Promise<WriteResult> {
  try {
    // Map legacy-style (patternId-only) to backend SubGamePatternRef shape.
    // UI normally has display-names for these — when missing, fall back to
    // the patternId itself as the name so backend validation passes.
    const patternRows: SubGamePatternRef[] = payload.selectPatternRow.map((pid) => ({
      patternId: pid,
      name: pid,
    }));

    const sg = existingId
      ? await apiUpdateSubGame(existingId, {
          gameName: payload.gameName,
          name: payload.gameName,
          patternRows,
          ticketColors: payload.selectTicketColor,
          status: payload.status,
        })
      : await apiCreateSubGame({
          gameTypeId: payload.gameTypeId ?? "bingo",
          name: payload.gameName,
          gameName: payload.gameName,
          patternRows,
          ticketColors: payload.selectTicketColor,
          status: payload.status,
        });
    return { ok: true, row: toRow(sg) };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** Soft-delete a SubGame. */
export async function deleteSubGame(
  id: string
): Promise<WriteResult | { ok: true; softDeleted: boolean }> {
  try {
    const result = await apiDeleteSubGame(id);
    return { ok: true, softDeleted: result.softDeleted };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/**
 * Name-uniqueness client-side precheck. BIN-621 backend enforces the unique
 * constraint — this helper is kept to avoid a round-trip on clearly-invalid
 * forms (empty / too long).
 */
export function isGameNameLocallyValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 40;
}

/**
 * Legacy ticket-color options. Mirrors the `ticketColors` variable populated
 * as a constant. Backend validates the color names sent by the UI.
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
