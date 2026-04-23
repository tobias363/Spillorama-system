// Agent IJ — admin-web API-wrapper for Game1 akkumulerende pot-er
// (Innsatsen + Jackpott). Speiler apps/backend/src/routes/adminGame1Pots.ts.
//
// Endepunkter:
//   GET    /api/admin/halls/:hallId/game1-pots
//   GET    /api/admin/halls/:hallId/game1-pots/:potKey
//   POST   /api/admin/halls/:hallId/game1-pots                  (init)
//   PATCH  /api/admin/halls/:hallId/game1-pots/:potKey/config
//   POST   /api/admin/halls/:hallId/game1-pots/:potKey/reset

import { apiRequest } from "./client.js";

export type PotType = "innsatsen" | "jackpott" | "generic";

export type PotWinRule =
  | {
      kind: "phase_at_or_before_draw";
      phase: number;
      drawThreshold: number;
    }
  | {
      kind: "progressive_threshold";
      phase: number;
      thresholdLadder: number[];
    };

export interface PotConfig {
  seedAmountCents: number;
  dailyBoostCents: number;
  salePercentBps: number;
  maxAmountCents: number | null;
  winRule: PotWinRule;
  ticketColors: string[];
  potType?: PotType;
  drawThresholdLower?: number;
  targetAmountCents?: number;
}

export interface PotRow {
  id: string;
  hallId: string;
  potKey: string;
  displayName: string;
  currentAmountCents: number;
  config: PotConfig;
  lastDailyBoostDate: string | null;
  lastResetAt: string | null;
  lastResetReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListPotsResult {
  pots: PotRow[];
  count: number;
}

export async function listHallPots(hallId: string): Promise<ListPotsResult> {
  return apiRequest<ListPotsResult>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/game1-pots`,
    { auth: true }
  );
}

export async function getHallPot(hallId: string, potKey: string): Promise<PotRow> {
  return apiRequest<PotRow>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/game1-pots/${encodeURIComponent(potKey)}`,
    { auth: true }
  );
}

export interface InitPotInput {
  potKey: string;
  displayName: string;
  config: PotConfig;
}

export async function initHallPot(
  hallId: string,
  input: InitPotInput
): Promise<PotRow> {
  return apiRequest<PotRow>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/game1-pots`,
    { method: "POST", body: input, auth: true }
  );
}

export async function updateHallPotConfig(
  hallId: string,
  potKey: string,
  config: PotConfig
): Promise<PotRow> {
  return apiRequest<PotRow>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/game1-pots/${encodeURIComponent(potKey)}/config`,
    { method: "PATCH", body: { config }, auth: true }
  );
}

export interface ResetPotResult {
  newBalanceCents: number;
  eventId: string;
}

export async function resetHallPot(
  hallId: string,
  potKey: string,
  reason: string
): Promise<ResetPotResult> {
  return apiRequest<ResetPotResult>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/game1-pots/${encodeURIComponent(potKey)}/reset`,
    { method: "POST", body: { reason }, auth: true }
  );
}
