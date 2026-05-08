/**
 * Spill 3 (monsterbingo) global singleton-konfig — admin-API-wrapper
 * (Tobias-direktiv 2026-05-08).
 *
 * Backend-endpoints:
 *   GET /api/admin/spill3/config     (GAME_CATALOG_READ)
 *   PUT /api/admin/spill3/config     (GAME_CATALOG_WRITE)
 *
 * Wire-format matcher backend `Spill3Config`. Beløp er i ØRE; admin-UI
 * konverterer til/fra kr i editor-laget. Opening-times er HH:MM-strenger
 * (24t, eks "11:00").
 */

import { apiRequest } from "./client.js";

// ── Whitelists (samme som backend) ─────────────────────────────────────────

export const SPILL3_PRIZE_MODE_VALUES = ["fixed", "percentage"] as const;
export type Spill3PrizeMode = (typeof SPILL3_PRIZE_MODE_VALUES)[number];

// ── Typer ──────────────────────────────────────────────────────────────────

export interface Spill3Config {
  id: string;
  minTicketsToStart: number;
  prizeMode: Spill3PrizeMode;
  prizeRad1Cents: number | null;
  prizeRad2Cents: number | null;
  prizeRad3Cents: number | null;
  prizeRad4Cents: number | null;
  prizeFullHouseCents: number | null;
  prizeRad1Pct: number | null;
  prizeRad2Pct: number | null;
  prizeRad3Pct: number | null;
  prizeRad4Pct: number | null;
  prizeFullHousePct: number | null;
  ticketPriceCents: number;
  pauseBetweenRowsMs: number;
  /** HH:MM 24t — daglig vindu for når runder kan spawnes. */
  openingTimeStart: string;
  openingTimeEnd: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

/**
 * Partial update — kun felter som faktisk endres trenger å sendes.
 * Service-laget validerer prize-mode-konsistens og fyller inn
 * resten fra eksisterende rad.
 */
export interface UpdateSpill3ConfigInput {
  minTicketsToStart?: number;
  prizeMode?: Spill3PrizeMode;
  prizeRad1Cents?: number | null;
  prizeRad2Cents?: number | null;
  prizeRad3Cents?: number | null;
  prizeRad4Cents?: number | null;
  prizeFullHouseCents?: number | null;
  prizeRad1Pct?: number | null;
  prizeRad2Pct?: number | null;
  prizeRad3Pct?: number | null;
  prizeRad4Pct?: number | null;
  prizeFullHousePct?: number | null;
  ticketPriceCents?: number;
  pauseBetweenRowsMs?: number;
  openingTimeStart?: string;
  openingTimeEnd?: string;
}

// ── API-wrappere ───────────────────────────────────────────────────────────

export async function getSpill3Config(): Promise<Spill3Config> {
  return apiRequest<Spill3Config>("/api/admin/spill3/config", { auth: true });
}

export async function updateSpill3Config(
  patch: UpdateSpill3ConfigInput,
): Promise<Spill3Config> {
  return apiRequest<Spill3Config>("/api/admin/spill3/config", {
    method: "PUT",
    auth: true,
    body: patch,
  });
}
