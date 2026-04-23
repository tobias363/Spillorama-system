// PatternState — wires admin-UI to BIN-627 backend endpoints
// (`/api/admin/patterns/*` via admin-patterns.ts).
//
// PatternMask (25-bit bitmask) is imported from shared-types — the same type
// Agent C uses for Game 3 PatternMatcher (packages/shared-types/src/game.ts).

import type { PatternMask } from "../common/types.js";
// PATTERN_MASK_FULL + PATTERN_MASK_CENTER_BIT are runtime values; common/types.ts
// only re-exports the *type*, so we import the values directly from shared-types.
// eslint-disable-next-line — relative path matches common/types.ts PatternMask import.
import { PATTERN_MASK_FULL, PATTERN_MASK_CENTER_BIT } from "../../../../../../packages/shared-types/src/game.js";
import {
  listPatterns,
  getPattern as apiGetPattern,
  createPattern as apiCreatePattern,
  updatePattern as apiUpdatePattern,
  deletePattern as apiDeletePattern,
  type AdminPattern,
} from "../../../api/admin-patterns.js";
import { ApiError } from "../../../api/client.js";

/**
 * Row shape for the pattern list + view pages.
 *
 * Legacy `patternController.js` exposed these fields:
 *   { _id, gameName, patternNumber, patternName, patternType, patternPlace,
 *     status, createdAt, isWoF, isTchest, isMys, isRowPr, rowPercentage,
 *     isJackpot, isGameTypeExtra, isLuckyBonus }
 *
 * patternType is a legacy `.`+`,` separated 2D grid string (e.g. "0,1,1.1,0,0")
 * — we convert to/from PatternMask (25-bit integer) via the helpers below.
 */
export interface PatternRow {
  _id: string;
  gameName: string;
  /** Legacy auto-increment display index (1-based). */
  patternNumber: number;
  /** User-facing pattern name (e.g. "Line 1", "Four Corners"). */
  patternName: string;
  /** 25-bit bitmask encoding of the 5x5 grid (shared-types PatternMask). */
  mask: PatternMask;
  /** Raw legacy grid string (kept for 1:1 debugging; prefer `mask`). */
  patternType?: string;
  /** Game 1 optional flags. */
  isWoF?: boolean;
  isTchest?: boolean;
  isMys?: boolean;
  isRowPr?: boolean;
  rowPercentage?: number;
  isJackpot?: boolean;
  isGameTypeExtra?: boolean;
  isLuckyBonus?: boolean;
  status: "active" | "inactive";
  createdAt: string;
  /** Game type that this pattern belongs to (game_1, game_3, game_4, game_5). */
  gameType?: "game_1" | "game_3" | "game_4" | "game_5" | string;
}

/** Form payload (mirrors legacy `addPattern` / `patternEdit` bodies). */
export interface PatternFormPayload {
  patternName: string;
  /** 25-bit bitmask for 5x5; caller converts to the legacy "0,1,0..." string. */
  mask: PatternMask;
  isWoF?: boolean;
  isTchest?: boolean;
  isMys?: boolean;
  isRowPr?: boolean;
  rowPercentage?: number;
  isJackpot?: boolean;
  isGameTypeExtra?: boolean;
  isLuckyBonus?: boolean;
  status: "active" | "inactive";
}

/** Unified write-result contract — live after BIN-627 wire-up. */
export type WriteResult =
  | { ok: true; row: PatternRow }
  | { ok: false; reason: "PERMISSION_DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "VALIDATION"; message: string }
  | { ok: false; reason: "BACKEND_ERROR"; message: string };

function toRow(p: AdminPattern): PatternRow {
  return {
    _id: p.id,
    gameName: p.gameName || p.name,
    patternNumber: p.patternNumber ? Number(p.patternNumber) : 0,
    patternName: p.name,
    mask: p.mask,
    isWoF: p.isWoF,
    isTchest: p.isTchest,
    isMys: p.isMys,
    isRowPr: p.isRowPr,
    rowPercentage: p.rowPercentage,
    isJackpot: p.isJackpot,
    isGameTypeExtra: p.isGameTypeExtra,
    isLuckyBonus: p.isLuckyBonus,
    status: p.status,
    createdAt: p.createdAt,
    gameType: p.gameTypeId,
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

// ── Helpers: legacy grid-string ↔ PatternMask ───────────────────────────────

/**
 * Parse legacy `patternType` (rows separated by `.`, cols by `,`) into a
 * 25-bit PatternMask. Grid layout is (row, col) → bit = row*cols + col.
 *
 * Accepts 3x5, 5x5 and 3x3 grids — any larger shape than 5x5 is truncated
 * at the 25-bit boundary and logged via thrown error.
 *
 * Example: `"1,1,1,1,1.0,0,0,0,0.0,0,0,0,0.0,0,0,0,0.0,0,0,0,0"` (top row)
 * → bits 0..4 set → PatternMask = 31.
 */
export function legacyGridToMask(raw: string, cols = 5): PatternMask {
  if (!raw) return 0;
  let mask = 0;
  const rows = raw.split(".");
  for (let r = 0; r < rows.length; r++) {
    const rawRow = rows[r];
    if (rawRow === undefined) continue;
    const cells = rawRow.split(",");
    for (let c = 0; c < cells.length; c++) {
      const bitIdx = r * cols + c;
      if (bitIdx >= 25) {
        throw new Error(`legacyGridToMask: bit index ${bitIdx} exceeds 25-bit mask budget`);
      }
      if (cells[c] === "1") {
        mask |= 1 << bitIdx;
      }
    }
  }
  return mask;
}

/**
 * Serialize a 25-bit PatternMask back to the legacy `patternType` grid-string.
 * Always emits a 5x5 grid (25 cells). Callers for 3x5 or 3x3 grids must pass
 * explicit rows/cols if they want a truncated representation.
 */
export function maskToLegacyGrid(mask: PatternMask, rows = 5, cols = 5): string {
  if (rows * cols > 25) {
    throw new Error(`maskToLegacyGrid: ${rows}x${cols} exceeds 25-bit mask budget`);
  }
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const bitIdx = r * cols + c;
      cells.push(mask & (1 << bitIdx) ? "1" : "0");
    }
    out.push(cells.join(","));
  }
  return out.join(".");
}

/** Toggle a single bit (row, col) in a PatternMask. Returns the new mask. */
export function toggleCell(mask: PatternMask, row: number, col: number, cols = 5): PatternMask {
  if (row < 0 || col < 0 || row * cols + col >= 25) return mask;
  const bit = row * cols + col;
  return mask ^ (1 << bit);
}

/** True if (row, col) is set in the mask. */
export function isCellSet(mask: PatternMask, row: number, col: number, cols = 5): boolean {
  const bit = row * cols + col;
  if (bit < 0 || bit >= 25) return false;
  return (mask & (1 << bit)) !== 0;
}

/** Count of set bits (pop-count for 25-bit values). */
export function countCells(mask: PatternMask): number {
  let m = mask & PATTERN_MASK_FULL;
  let count = 0;
  while (m > 0) {
    count += m & 1;
    m >>>= 1;
  }
  return count;
}

// Re-export shared-types utilities for convenience.
export { PATTERN_MASK_FULL, PATTERN_MASK_CENTER_BIT };

// ── Live fetch/write operations (BIN-627) ───────────────────────────────────

/**
 * Fetch pattern list for a given game-type. Returns [] on 404 so UI keeps
 * rendering the DataTable empty-state without erroring.
 */
export async function fetchPatternList(typeId: string): Promise<PatternRow[]> {
  try {
    const result = await listPatterns({ gameTypeId: typeId });
    return (result.patterns ?? []).map(toRow);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return [];
    }
    throw err;
  }
}

/** Fetch a single pattern by id. Returns null on 404. */
export async function fetchPattern(_typeId: string, id: string): Promise<PatternRow | null> {
  try {
    const p = await apiGetPattern(id);
    return toRow(p);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Create or update a pattern. */
export async function savePattern(
  typeId: string,
  payload: PatternFormPayload,
  existingId?: string
): Promise<WriteResult> {
  try {
    const p = existingId
      ? await apiUpdatePattern(existingId, {
          name: payload.patternName,
          mask: payload.mask,
          status: payload.status,
          ...(payload.isWoF !== undefined ? { isWoF: payload.isWoF } : {}),
          ...(payload.isTchest !== undefined ? { isTchest: payload.isTchest } : {}),
          ...(payload.isMys !== undefined ? { isMys: payload.isMys } : {}),
          ...(payload.isRowPr !== undefined ? { isRowPr: payload.isRowPr } : {}),
          ...(payload.rowPercentage !== undefined ? { rowPercentage: payload.rowPercentage } : {}),
          ...(payload.isJackpot !== undefined ? { isJackpot: payload.isJackpot } : {}),
          ...(payload.isGameTypeExtra !== undefined ? { isGameTypeExtra: payload.isGameTypeExtra } : {}),
          ...(payload.isLuckyBonus !== undefined ? { isLuckyBonus: payload.isLuckyBonus } : {}),
        })
      : await apiCreatePattern({
          gameTypeId: typeId,
          name: payload.patternName,
          mask: payload.mask,
          status: payload.status,
          ...(payload.isWoF !== undefined ? { isWoF: payload.isWoF } : {}),
          ...(payload.isTchest !== undefined ? { isTchest: payload.isTchest } : {}),
          ...(payload.isMys !== undefined ? { isMys: payload.isMys } : {}),
          ...(payload.isRowPr !== undefined ? { isRowPr: payload.isRowPr } : {}),
          ...(payload.rowPercentage !== undefined ? { rowPercentage: payload.rowPercentage } : {}),
          ...(payload.isJackpot !== undefined ? { isJackpot: payload.isJackpot } : {}),
          ...(payload.isGameTypeExtra !== undefined ? { isGameTypeExtra: payload.isGameTypeExtra } : {}),
          ...(payload.isLuckyBonus !== undefined ? { isLuckyBonus: payload.isLuckyBonus } : {}),
        });
    return { ok: true, row: toRow(p) };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/** Soft-delete a pattern. */
export async function deletePattern(
  id: string
): Promise<WriteResult | { ok: true; softDeleted: boolean }> {
  try {
    const result = await apiDeletePattern(id);
    return { ok: true, softDeleted: result.softDeleted };
  } catch (err) {
    return apiErrorToWriteResult(err);
  }
}

/**
 * Max patterns per game-type per legacy business rules (see pattern.html:31-54):
 *   Game 1: unlimited
 *   Game 3: 32
 *   Game 4: 15 (DEPRECATED per BIN-496 — hidden from dropdowns but limit kept for data-consistency)
 *   Game 5: 17
 */
export function maxPatternsForGameType(gameType: string): number | null {
  switch (gameType) {
    case "game_1":
      return null; // unlimited
    case "game_3":
      return 32;
    case "game_4":
      return 15;
    case "game_5":
      return 17;
    default:
      return null;
  }
}
