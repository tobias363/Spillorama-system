/**
 * Admin-API for Spill 2 (rocket) global singleton-konfig
 * (Tobias-direktiv 2026-05-08, parallel til Spill 3).
 *
 * Backend-route: apps/backend/src/routes/adminSpill2Config.ts
 * Service: apps/backend/src/game/Spill2ConfigService.ts
 * Tabell: app_spill2_config (singleton — ETT globalt rom)
 *
 *   GET /api/admin/spill2/config              (GAME_CATALOG_READ)
 *   PUT /api/admin/spill2/config              (GAME_CATALOG_WRITE — ADMIN-only)
 *
 * Wire-format:
 *   - Beløp i ØRE (UI konverterer til/fra kr ved render og submit)
 *   - Åpningstider som "HH:MM"-strenger eller null (ingen begrensning)
 *   - jackpotNumberTable som objekt med 6 keys (9, 10, 11, 12, 13, 1421)
 */

import { apiRequest } from "./client.js";

// ── Whitelists (matcher backend Spill2ConfigService) ───────────────────────

export const SPILL2_JACKPOT_KEYS = ["9", "10", "11", "12", "13", "1421"] as const;
export type Spill2JackpotKey = (typeof SPILL2_JACKPOT_KEYS)[number];

export interface Spill2JackpotEntry {
  /**
   * Premie-verdi.
   *   - isCash=true  → flat øre-beløp som utbetales per vinner (etter
   *                     multi-winner split)
   *   - isCash=false → prosent (0-100) av (ticketCount × ticketPrice)
   */
  price: number;
  isCash: boolean;
}

export type Spill2JackpotTable = Record<Spill2JackpotKey, Spill2JackpotEntry>;

// ── Typer ───────────────────────────────────────────────────────────────────

export interface Spill2Config {
  id: string;
  /** HH:MM 24h-format, eller null for ingen begrensning. */
  openingTimeStart: string | null;
  openingTimeEnd: string | null;
  minTicketsToStart: number;
  ticketPriceCents: number;
  roundPauseMs: number;
  ballIntervalMs: number;
  jackpotNumberTable: Spill2JackpotTable;
  luckyNumberEnabled: boolean;
  luckyNumberPrizeCents: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

/**
 * Partial update — alle felt er optional. Kun feltene som faktisk sendes
 * blir oppdatert; resten beholdes uendret. Service-laget validerer
 * konsistens (åpningstid-vindu, lucky-number, jackpot-tabell-shape).
 */
export interface Spill2ConfigPatch {
  openingTimeStart?: string | null;
  openingTimeEnd?: string | null;
  minTicketsToStart?: number;
  ticketPriceCents?: number;
  roundPauseMs?: number;
  ballIntervalMs?: number;
  jackpotNumberTable?: Spill2JackpotTable;
  luckyNumberEnabled?: boolean;
  luckyNumberPrizeCents?: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Konverter øre → kr for UI-render. */
export function centsToKr(cents: number | null | undefined): number {
  if (cents === null || cents === undefined) return 0;
  return Math.floor(cents / 100);
}

/** Konverter kr → øre for backend-submit. */
export function krToCents(kr: number): number {
  if (!Number.isFinite(kr)) return 0;
  return Math.floor(kr * 100);
}

// ── API-wrappers ────────────────────────────────────────────────────────────

/**
 * Hent aktiv Spill 2-konfig. Returnerer alltid en komplett snapshot.
 * Backend cacher i 5 sek — endringer slår inn på neste runde-spawn uten
 * restart.
 */
export function getSpill2Config(): Promise<Spill2Config> {
  return apiRequest<Spill2Config>("/api/admin/spill2/config", { auth: true });
}

/**
 * Oppdater Spill 2-konfig. Send kun feltene du vil endre. Backend skriver
 * én audit-event ("spill2.config.update") med før/etter-snapshot.
 *
 * Validering (server-side):
 *   - Tall-grenser per felt (min/max)
 *   - openingTimeStart/End: enten begge null eller begge satt
 *     (start < end, samme dag-vindu, HH:MM-format)
 *   - jackpotNumberTable: alle 6 keys må være satt
 *   - luckyNumberEnabled=true → luckyNumberPrizeCents må være satt
 *
 * Returnerer ny full snapshot etter update.
 */
export function updateSpill2Config(
  patch: Spill2ConfigPatch,
): Promise<Spill2Config> {
  return apiRequest<Spill2Config>("/api/admin/spill2/config", {
    method: "PUT",
    body: patch,
    auth: true,
  });
}
