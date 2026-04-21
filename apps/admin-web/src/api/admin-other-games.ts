// BIN-679 — admin mini-games config API wrappers (wired til backend).
//
// Backend-matrisen (se apps/backend/src/routes/adminMiniGames.ts):
//   GET /api/admin/mini-games/wheel
//   PUT /api/admin/mini-games/wheel
//   GET /api/admin/mini-games/chest
//   PUT /api/admin/mini-games/chest
//   GET /api/admin/mini-games/mystery
//   PUT /api/admin/mini-games/mystery
//   GET /api/admin/mini-games/colordraft
//   PUT /api/admin/mini-games/colordraft
//
// Svaret er en singleton-rad per spill-type (se MiniGameConfigRow i
// shared-types/schemas.ts). `config` er fri-form JSONB; spill-spesifikk
// shape er forklart i shared-types under WheelConfig/ChestConfig/
// MysteryConfig/ColordraftConfig.
//
// Merk: Endret fra legacy struktur der vi hadde separate typer per spill
// med hardkodede prize-arrays — nå er alle fire samme envelop med fri
// `config`-Record, og admin-UI har JSON-editor i tillegg til strukturert
// view for wheel/chest/mystery/colordraft.

import { apiRequest } from "./client.js";

export type MiniGameType = "wheel" | "chest" | "mystery" | "colordraft";

export const MINI_GAME_TYPES: readonly MiniGameType[] = [
  "wheel",
  "chest",
  "mystery",
  "colordraft",
] as const;

export interface MiniGameConfig {
  id: string;
  gameType: MiniGameType;
  config: Record<string, unknown>;
  active: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateMiniGameConfigBody {
  config?: Record<string, unknown>;
  active?: boolean;
}

export async function getMiniGameConfig(gameType: MiniGameType): Promise<MiniGameConfig> {
  return apiRequest<MiniGameConfig>(
    `/api/admin/mini-games/${encodeURIComponent(gameType)}`,
    { auth: true }
  );
}

export async function updateMiniGameConfig(
  gameType: MiniGameType,
  body: UpdateMiniGameConfigBody
): Promise<MiniGameConfig> {
  return apiRequest<MiniGameConfig>(
    `/api/admin/mini-games/${encodeURIComponent(gameType)}`,
    {
      method: "PUT",
      body,
      auth: true,
    }
  );
}
