// Shared types for the GameManagement stack (PR-A3).
//
// Imported by every /pages/games/** module. Kept deliberately slim —
// per-bolk state files carry their own domain types.
//
// PatternMask is re-exported from packages/shared-types so Game 3 backend
// (PR-C3, Agent C) and Pattern admin-UI use the same 25-bit encoding.
// We import via relative path because admin-web does not (yet) declare the
// shared-types package as a dependency — the relative import matches what
// Vite resolves at build-time from within the workspace.

// eslint-disable-next-line — TS moduleResolution=bundler resolves this fine.
import type { PatternMask as SharedPatternMask } from "../../../../../../packages/shared-types/src/game.js";

/**
 * GameType (admin-facing catalog entry) — mirrors legacy GameType schema from
 * exposed in the read-only port; write-ops are placeholders until backend
 * endpoints ship (BIN-620 GameType CRUD).
 */
export interface GameType {
  /** Mongo ObjectId as string in legacy; slug in new backend. Both are stable. */
  _id: string;
  /** Display name — "Game 1", "Game 2", "Game 3", "Game 5". */
  name: string;
  /** Backend slug: "bingo", "rocket", "monsterbingo", "spillorama", ... */
  slug: string;
  /**
   * Legacy game-engine discriminator ("game_1" | "game_2" | "game_3" | "game_4" | "game_5").
   * Drives dropdown visibility and page variants in legacy. Game 4 is DEPRECATED
   * (BIN-496) and hidden from admin dropdowns per PM-scope 2026-04-19.
   */
  type: "game_1" | "game_2" | "game_3" | "game_4" | "game_5" | string;
  /** Ticket grid rows. Legacy stores as string; we coerce to number on read. */
  row: number;
  /** Ticket grid columns. */
  columns: number;
  /** Filename under /profile/bingo/ — legacy static-path. */
  photo: string;
  /** True if this game supports custom pattern-bingo (Game 1 + Game 3). */
  pattern: boolean;
  /** True if game is currently enabled in the catalog. */
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * DataTables.net server-side JSON shape — matches legacy `backend.js` DT-response
 * pattern and the new `apps/backend` paged-list convention.
 */
export interface Paginated<T> {
  draw?: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: T[];
}

/** GET /api/admin/games response row shape. */
export interface PlatformGameRow {
  slug: string;
  title: string;
  description: string;
  route: string;
  isEnabled: boolean;
  sortOrder: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Re-export PatternMask so games/* modules can import from one place. */
export type PatternMask = SharedPatternMask;

/** Game 4 guard per PM-scope (DEPRECATED BIN-496 — hide from dropdowns). */
export const GAME_TYPE_HIDDEN_FROM_DROPDOWN: ReadonlySet<string> = new Set(["game_4"]);

/** True if the given GameType should be shown in admin dropdowns. */
export function isDropdownVisible(gt: Pick<GameType, "type">): boolean {
  return !GAME_TYPE_HIDDEN_FROM_DROPDOWN.has(gt.type);
}
