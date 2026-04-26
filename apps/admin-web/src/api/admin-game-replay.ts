// LOW-1: admin-web API-adapter for /api/admin/games/:gameId/replay.
//
// Backend-router: apps/backend/src/routes/adminGameReplay.ts
// Service: apps/backend/src/game/Game1ReplayService.ts
// Permissions: GAME1_GAME_READ + PLAYER_KYC_READ.
//
// Returnerer rekonstruert event-strøm for et Spill 1 scheduled_game.
// PII er redacted før det forlater backend (e-post, display-name, walletId).

import { apiRequest } from "./client.js";

export type Game1ReplayEventType =
  | "room_created"
  | "player_joined"
  | "tickets_purchased"
  | "game_started"
  | "draw"
  | "phase_won"
  | "mini_game_triggered"
  | "mini_game_completed"
  | "payout"
  | "game_paused"
  | "game_resumed"
  | "game_stopped"
  | "hall_excluded"
  | "hall_included"
  | "game_ended";

export interface Game1ReplayActor {
  kind: "user" | "system";
  userId: string | null;
  role: string | null;
  hallId: string | null;
}

export interface Game1ReplayEvent {
  sequence: number;
  type: Game1ReplayEventType;
  timestamp: string;
  actor: Game1ReplayActor;
  data: Record<string, unknown>;
}

export interface Game1ReplayMeta {
  scheduledGameId: string;
  status: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  actualStartTime: string | null;
  actualEndTime: string | null;
  masterHallId: string;
  groupHallId: string;
  participatingHallIds: string[];
  excludedHallIds: string[];
  subGameName: string;
  customGameName: string | null;
  startedByUserId: string | null;
  stoppedByUserId: string | null;
  stopReason: string | null;
  eventCount: number;
  generatedAt: string;
}

export interface Game1ReplayResult {
  meta: Game1ReplayMeta;
  events: Game1ReplayEvent[];
}

export async function fetchGameReplay(gameId: string): Promise<Game1ReplayResult> {
  return apiRequest<Game1ReplayResult>(
    `/api/admin/games/${encodeURIComponent(gameId)}/replay`,
    { auth: true }
  );
}
