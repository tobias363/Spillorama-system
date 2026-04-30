// HV2-B3 (Tobias 2026-04-30) — admin-API for per-hall Spill 1 default
// gevinst-floors. Wrappers rundt:
//   GET /api/admin/halls/:hallId/spill1-prize-defaults  (HALL_GAME_CONFIG_READ)
//   PUT /api/admin/halls/:hallId/spill1-prize-defaults  (HALL_GAME_CONFIG_WRITE)
//
// Backend-route: apps/backend/src/routes/adminSpill1PrizeDefaults.ts
// Service-laget: apps/backend/src/game/Spill1PrizeDefaultsService.ts
//
// Beløpene er i HELE KRONER (ikke øre). Backend cap-er på 2500 kr per fase
// per pengespillforskriften enkelt-premie-cap; UI advarer brukeren før
// submit, men siste validering skjer server-side.

import { apiRequest } from "./client.js";

/**
 * Komplett floor-snapshot for en hall. Alle felt er i kroner.
 * Speiler `Spill1PrizeDefaults` på backend-siden.
 */
export interface Spill1PrizeDefaults {
  /** Rad 1 floor (kr). */
  phase1: number;
  /** Rad 2 floor (kr). */
  phase2: number;
  /** Rad 3 floor (kr). */
  phase3: number;
  /** Rad 4 floor (kr). */
  phase4: number;
  /** Fullt Hus floor (kr). */
  phase5: number;
}

/**
 * Response-shape fra både GET og PUT (full snapshot etter operasjonen).
 */
export interface Spill1PrizeDefaultsResponse extends Spill1PrizeDefaults {
  /** Den faktiske hall-id-en (etter slug→id-mapping). */
  hallId: string;
}

/**
 * Partial patch til PUT — alle felt er optional. Kun feltene som faktisk
 * sendes blir oppdatert; resten beholdes uendret.
 */
export type Spill1PrizeDefaultsPatch = Partial<Spill1PrizeDefaults>;

/**
 * §11 enkelt-premie-cap (matcher backend MAX_SINGLE_PRIZE_NOK).
 * Eksporteres slik at UI kan vise advarsel/validering før submit.
 */
export const SPILL1_MAX_PRIZE_NOK = 2500;

/**
 * Hent floor-defaults for en hall. Returnerer alltid en komplett snapshot
 * (alle 5 faser). Hall-spesifikke overrides + wildcard-fallback per fase
 * blir merget på backend-siden.
 */
export function getSpill1PrizeDefaults(
  hallId: string,
): Promise<Spill1PrizeDefaultsResponse> {
  return apiRequest<Spill1PrizeDefaultsResponse>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/spill1-prize-defaults`,
    { auth: true },
  );
}

/**
 * Oppdater floor-defaults for en hall. Send kun feltene du vil endre.
 * Backend skriver én audit-event per fase som faktisk endret seg.
 *
 * Validering:
 *   - Hver phase ≥ 0 og ≤ SPILL1_MAX_PRIZE_NOK
 *   - Minst én av phase1-phase5 må oppgis
 *
 * Returnerer ny full snapshot etter UPSERT.
 */
export function updateSpill1PrizeDefaults(
  hallId: string,
  patch: Spill1PrizeDefaultsPatch,
): Promise<Spill1PrizeDefaultsResponse> {
  return apiRequest<Spill1PrizeDefaultsResponse>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/spill1-prize-defaults`,
    {
      method: "PUT",
      body: patch,
      auth: true,
    },
  );
}
