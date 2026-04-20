/**
 * BIN-618: top-N players by current wallet balance — pure aggregate builder.
 *
 * Legacy reference:
 *   legacy/unity-backend/App/Controllers/Dashboard.js:120-127 — admin dashboard
 *   calls
 *     PlayerServices.getAllPlayerDataTableSelected(
 *       query, { username:1, profilePic:1, walletAmount:1 }, 0, 5,
 *       { walletAmount: -1 }
 *     )
 *   to render the "Top 5 Players" widget (legacy dashboard.html:537-595,
 *   `.users-list` box-danger). `query` excludes Bots + requires a hall
 *   assignment; HALL_OPERATORs add `hall.id = <their hall>`.
 *
 * Contract preserved:
 *   - Sort by wallet balance desc.
 *   - Tie-break by id asc for determinism.
 *   - Only PLAYER-role users are considered (Bots / admin users excluded
 *     upstream via `listPlayersForExport`).
 *   - Hall-filter applied upstream; this builder is hall-agnostic.
 *
 * This file is pure — no DB I/O. The route wires up `PlatformService`
 * (for the player list) + `WalletAdapter` (for balances) and feeds the
 * results here. Same pattern as `SubgameDrillDownReport.ts`.
 */

import type { AppUser } from "../../platform/PlatformService.js";
import type { TopPlayerEntry, TopPlayersResponse } from "@spillorama/shared-types";

/** Max limit accepted from callers — keeps the response bounded. */
export const TOP_PLAYERS_MAX_LIMIT = 100;
/** Default limit when caller omits `?limit=`. Matches legacy (top 5). */
export const TOP_PLAYERS_DEFAULT_LIMIT = 5;

export interface TopPlayersInput {
  /** Eligible players (PLAYER-role, hall-scoped upstream). */
  players: AppUser[];
  /** Map from `walletId` → current balance in Kr. Unknown wallets default to 0. */
  balances: Map<string, number>;
  /**
   * Extra profile lookup: `userId` → `avatar` URL. Optional — legacy
   * `profilePic` lives on the player-row so most callers can skip this
   * and pass `avatar` on the `AppUser` itself once the schema catches up.
   */
  avatars?: Map<string, string | null | undefined>;
  /** 1..TOP_PLAYERS_MAX_LIMIT — coerced into range. */
  limit?: number;
  /** ISO timestamp used in the response envelope. Defaults to `new Date().toISOString()`. */
  now?: () => Date;
}

/**
 * Build the top-N response. `players` is expected to be pre-filtered by the
 * caller (role=PLAYER, hall-scope, soft-deleted excluded). The builder only
 * handles the ranking + shape conversion.
 */
export function buildTopPlayers(input: TopPlayersInput): TopPlayersResponse {
  const limit = clampLimit(input.limit);

  const ranked: TopPlayerEntry[] = input.players
    .map((u): TopPlayerEntry & { _sortKey: number } => {
      const balance = input.balances.get(u.walletId) ?? 0;
      const avatar = input.avatars?.get(u.id) ?? undefined;
      const entry: TopPlayerEntry = {
        id: u.id,
        username: u.displayName || u.email || u.id,
        walletAmount: roundKr(balance),
      };
      if (avatar) entry.avatar = avatar;
      return Object.assign(entry, { _sortKey: balance });
    })
    .sort((a, b) => {
      if (b._sortKey !== a._sortKey) return b._sortKey - a._sortKey;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit)
    .map(({ _sortKey, ...rest }) => rest);

  const now = input.now ? input.now() : new Date();
  return {
    generatedAt: now.toISOString(),
    limit,
    count: ranked.length,
    players: ranked,
  };
}

export function clampLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return TOP_PLAYERS_DEFAULT_LIMIT;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return TOP_PLAYERS_DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), TOP_PLAYERS_MAX_LIMIT);
}

/** Round to whole Kr — legacy renders `Math.floor(walletAmount) Kr` so a
 *  stale decimal would mismatch the legacy box. We round to 2 decimals to
 *  keep the wire-shape numeric and let the UI pick its own formatter. */
function roundKr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
