// ── BIN-679: MiniGames config wire schemas ──────────────────────────────────
// Admin-CRUD for de fire Game 1 mini-spillene (wheel, chest, mystery,
// colordraft). Én singleton-rad per spill-type. Mirror av migration
// `20260425000600_mini_games_config.sql`. Ren KONFIGURASJON — runtime-
// integrasjonen i Game 1 leser i dag hardkodede arrays (BingoEngine.
// MINIGAME_PRIZES); wiring til denne tabellen er egen PR.
//
// `otherGame`-kolleksjonen med slug-diskriminator + per-spill prizeList-
// felt). Fire separate felter flatet ut til én discriminated tabell fordi
// hvert spill er singleton-konfig.
//
// Merk: runtime socket schemas (`MiniGameTypeSchema`, `MiniGamePlayResultSchema`
// m.fl.) bor i `./game.ts` — dette er admin-KONFIG, ikke event-payload.

import { z } from "zod";
import { IsoDateString } from "./_shared.js";

/**
 * Admin-side short-form game-type slugs brukt i `app_mini_games_config`.
 * Skiller seg bevisst fra runtime-`MiniGameTypeSchema` (lengre event-navn
 * "wheelOfFortune", etc. definert i ./game.ts) — dette er
 * database-discriminatoren, ikke socket-event-typen.
 */
export const MiniGameConfigTypeSchema = z.enum([
  "wheel",
  "chest",
  "mystery",
  "colordraft",
]);
export type MiniGameConfigType = z.infer<typeof MiniGameConfigTypeSchema>;

/**
 * Wire-shape for en mini-game-config-rad. Dette er den generiske formen
 * som alle 4 spill deler; spill-spesifikk validering av `config` gjøres
 * i egne schemas (WheelConfig, ChestConfig, MysteryConfig, ColordraftConfig)
 * som admin-UI kan parse før render. Service-laget lagrer `config` som
 * fri-form JSONB og gjør ingen semantisk validering ut over objekt-sjekk —
 * det holder payload-sjansen åpen for nye felter uten migrasjon.
 */
export const MiniGameConfigRowSchema = z.object({
  id: z.string().min(1),
  gameType: MiniGameConfigTypeSchema,
  config: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type MiniGameConfigRow = z.infer<typeof MiniGameConfigRowSchema>;

/**
 * PUT-payload. Begge felter optional — admin-UI kan sende hele config hver
 * gang uten diff-logikk. Minst ett felt må være oppgitt (ellers gir service
 * samme rad tilbake uendret).
 */
export const UpdateMiniGameConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type UpdateMiniGameConfigInput = z.infer<
  typeof UpdateMiniGameConfigSchema
>;

// ── Spill-spesifikke hjelper-schemas (valgfrie — admin-UI kan bruke) ────────
// Disse validerer ikke i backend (service tar generisk Record), men gir
// admin-UI og shared-types-forbrukere en typed form å parse mot ved behov.

/** Ett segment på 50-segment lykkehjulet. */
export const WheelSegmentSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
  color: z.string().optional(),
});
export type WheelSegment = z.infer<typeof WheelSegmentSchema>;

export const WheelConfigSchema = z.object({
  segments: z.array(WheelSegmentSchema),
});
export type WheelConfig = z.infer<typeof WheelConfigSchema>;

/** Én premie i kiste-listen. */
export const ChestPrizeSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
});
export type ChestPrize = z.infer<typeof ChestPrizeSchema>;

export const ChestConfigSchema = z.object({
  prizes: z.array(ChestPrizeSchema),
  chestCount: z.number().int().positive().optional(),
});
export type ChestConfig = z.infer<typeof ChestConfigSchema>;

/** Én belønning i mystery-tabellen. */
export const MysteryRewardSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
});
export type MysteryReward = z.infer<typeof MysteryRewardSchema>;

export const MysteryConfigSchema = z.object({
  rewards: z.array(MysteryRewardSchema),
});
export type MysteryConfig = z.infer<typeof MysteryConfigSchema>;

/** Ett farge-oppsett i colordraft-hjulet. */
export const ColordraftColorSchema = z.object({
  color: z.string(),
  prizeAmounts: z.array(z.number().nonnegative()),
  weight: z.number().nonnegative().optional(),
});
export type ColordraftColor = z.infer<typeof ColordraftColorSchema>;

export const ColordraftConfigSchema = z.object({
  colors: z.array(ColordraftColorSchema),
});
export type ColordraftConfig = z.infer<typeof ColordraftConfigSchema>;
