// PR-B6 (BIN-664) — admin Leaderboard tier CRUD API wrappers (PLACEHOLDER).
//
// STATUS: Backend-endpoints for leaderboard tier-konfig (place → points)
// eksisterer IKKE per 2026-04-19. Se Linear BIN-668 for
// "Leaderboard tier CRUD backend" (4-6t follow-up, P3).
//
// Denne fila definerer typer + stub-funksjoner som kaster en tydelig
// NOT_IMPLEMENTED-feil til frontend-placeholder-siden kan vise en
// "backend mangler"-banner UTEN å feile tsc/vite build.
//
// Når BIN-668 merger:
//   1. Slett NOT_IMPLEMENTED-stubbene
//   2. Erstatt med ekte apiRequest() mot
//      GET    /api/admin/leaderboard/tiers
//      POST   /api/admin/leaderboard/tiers   body {place, points}
//      PATCH  /api/admin/leaderboard/tiers/:place  body {points}
//      DELETE /api/admin/leaderboard/tiers/:place
//   3. Fjern placeholder-banner fra LeaderboardPage.ts
//
// Permissions (når BIN-668 merger):
//   - list:   GAME_CATALOG_READ  eller ny LEADERBOARD_READ
//   - mutate: GAME_CATALOG_WRITE eller ny LEADERBOARD_WRITE
//
// Regulatorisk: Points-konfig påvirker utbetaling av premier. Backend
// skal ha AuditLog-actions `leaderboard.tier.add/update/remove` og
// fail-closed "no write while game active"-sjekk (se PR-B6-PLAN §3.1).

import { ApiError } from "./client.js";

export interface LeaderboardTier {
  place: number;
  points: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ListLeaderboardTiersResponse {
  tiers: LeaderboardTier[];
  count: number;
}

/**
 * PLACEHOLDER — kaster NOT_IMPLEMENTED til BIN-668 leverer backend.
 *
 * Frontend-placeholder-siden fanger denne og viser en "Venter på
 * backend (BIN-668)"-banner i stedet for en normal tabell.
 */
export function listLeaderboardTiers(): Promise<ListLeaderboardTiersResponse> {
  return Promise.reject(
    new ApiError(
      "Leaderboard tier CRUD-backend ikke implementert (se BIN-668)",
      "NOT_IMPLEMENTED",
      501
    )
  );
}

export interface AddLeaderboardTierBody {
  place: number;
  points: number;
}

export function addLeaderboardTier(
  _body: AddLeaderboardTierBody
): Promise<LeaderboardTier> {
  return Promise.reject(
    new ApiError(
      "Leaderboard tier CRUD-backend ikke implementert (se BIN-668)",
      "NOT_IMPLEMENTED",
      501
    )
  );
}

export interface UpdateLeaderboardTierBody {
  points: number;
}

export function updateLeaderboardTier(
  _place: number,
  _body: UpdateLeaderboardTierBody
): Promise<LeaderboardTier> {
  return Promise.reject(
    new ApiError(
      "Leaderboard tier CRUD-backend ikke implementert (se BIN-668)",
      "NOT_IMPLEMENTED",
      501
    )
  );
}

export function deleteLeaderboardTier(
  _place: number
): Promise<{ removed: true }> {
  return Promise.reject(
    new ApiError(
      "Leaderboard tier CRUD-backend ikke implementert (se BIN-668)",
      "NOT_IMPLEMENTED",
      501
    )
  );
}
