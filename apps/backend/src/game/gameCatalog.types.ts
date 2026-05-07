/**
 * Fase 1 (2026-05-07): type-definisjoner for game-catalog.
 *
 * Disse typene speiler `app_game_catalog`-tabellen i
 * `migrations/20261210000000_app_game_catalog_and_plan.sql` og brukes
 * av `GameCatalogService` + framtidige routes/admin-UI.
 *
 * Whitelist:
 *   - TicketColor: gul/hvit/lilla (Tobias bekreftet 3 farger 2026-05-07)
 *   - BonusGameSlug: mystery/wheel_of_fortune/treasure_chest/color_draft
 *   - PrizeMultiplierMode: auto/explicit_per_color (Tobias 2026-05-07)
 */

export const TICKET_COLOR_VALUES = ["gul", "hvit", "lilla"] as const;
export type TicketColor = (typeof TICKET_COLOR_VALUES)[number];

export const BONUS_GAME_SLUG_VALUES = [
  "mystery",
  "wheel_of_fortune",
  "treasure_chest",
  "color_draft",
] as const;
export type BonusGameSlug = (typeof BONUS_GAME_SLUG_VALUES)[number];

/**
 * Premie-modus.
 *
 * Tobias 2026-05-07 (auto-multiplikator + spesialpris):
 *
 * - "auto": billigste bong (5 kr = 500 øre) får base-premie. Dyrere
 *   bonger får `base × (ticketPrice / 500)`. Bingo er et skalar
 *   `bingoBase` per katalog. Standard for nye hovedspill.
 *
 * - "explicit_per_color": flat pris per bong + eksplisitt gevinst per
 *   bong-farge / pattern. Brukes for spesialspill som Trafikklys
 *   (modellert via `rules.gameVariant` + `rules.prizesPerRowColor`).
 *   Bingo er et per-farge-objekt.
 *
 * Whitelist håndheves i `GameCatalogService` — backend tabellen har
 * NOT NULL DEFAULT 'auto'.
 */
export const PRIZE_MULTIPLIER_MODE_VALUES = [
  "auto",
  "explicit_per_color",
] as const;
export type PrizeMultiplierMode = (typeof PRIZE_MULTIPLIER_MODE_VALUES)[number];

/**
 * Premier per fase i øre (cents).
 *
 * - rad1-rad4: flatt int-beløp uavhengig av bongfarge (base for "auto"-
 *   modus, billigste bong = 500 øre; konkret beløp for
 *   "explicit_per_color"-modus).
 * - bingoBase: base-bingo-premie for "auto"-modus (gjelder billigste
 *   bong). Multipliseres opp for dyrere bonger ved
 *   `calculateActualPrize`. NULL/undefined for "explicit_per_color".
 * - bingo: per-farge-lookup for "explicit_per_color"-modus. Keys må
 *   matche `ticketColors`-listen. Beholdes som backwards-compat for
 *   eksisterende plan-runs i "auto"-modus, men ny kode skal lese
 *   `bingoBase`.
 */
export interface PrizesCents {
  rad1: number;
  rad2: number;
  rad3: number;
  rad4: number;
  /** Base bingo-premie for "auto"-modus (billigste bong = 500 øre). */
  bingoBase?: number;
  /** Per-farge bingo for "explicit_per_color" (Trafikklys o.l.). */
  bingo: Partial<Record<TicketColor, number>>;
}

export interface GameCatalogEntry {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  rules: Record<string, unknown>;
  ticketColors: TicketColor[];
  ticketPricesCents: Partial<Record<TicketColor, number>>;
  prizesCents: PrizesCents;
  prizeMultiplierMode: PrizeMultiplierMode;
  bonusGameSlug: BonusGameSlug | null;
  bonusGameEnabled: boolean;
  requiresJackpotSetup: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface CreateGameCatalogInput {
  slug: string;
  displayName: string;
  description?: string | null;
  rules?: Record<string, unknown>;
  ticketColors?: TicketColor[];
  ticketPricesCents?: Partial<Record<TicketColor, number>>;
  prizesCents: PrizesCents;
  prizeMultiplierMode?: PrizeMultiplierMode;
  bonusGameSlug?: BonusGameSlug | null;
  bonusGameEnabled?: boolean;
  requiresJackpotSetup?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  createdByUserId: string;
}

export interface UpdateGameCatalogInput {
  slug?: string;
  displayName?: string;
  description?: string | null;
  rules?: Record<string, unknown>;
  ticketColors?: TicketColor[];
  ticketPricesCents?: Partial<Record<TicketColor, number>>;
  prizesCents?: PrizesCents;
  prizeMultiplierMode?: PrizeMultiplierMode;
  bonusGameSlug?: BonusGameSlug | null;
  bonusGameEnabled?: boolean;
  requiresJackpotSetup?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ListGameCatalogFilter {
  isActive?: boolean;
  limit?: number;
}
