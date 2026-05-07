/**
 * Fase 1 (2026-05-07): type-definisjoner for game-catalog.
 *
 * Disse typene speiler `app_game_catalog`-tabellen i
 * `migrations/20260507120000_app_game_catalog_and_plan.sql` og brukes
 * av `GameCatalogService` + framtidige routes/admin-UI.
 *
 * Whitelist:
 *   - TicketColor: gul/hvit/lilla (Tobias bekreftet 3 farger 2026-05-07)
 *   - BonusGameSlug: mystery/wheel_of_fortune/treasure_chest/color_draft
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
 * Premier per fase i øre (cents).
 *
 * - rad1-rad4: flatt int-beløp uavhengig av bongfarge.
 * - bingo: per-farge-lookup. Keys må matche `ticketColors`-listen.
 *
 * Tobias 2026-05-07: bingo-premier varierer per farge (gul gir mer enn
 * hvit). Rad-premier er flatt for nå — kan utvides i Fase 2 hvis kravet
 * endrer seg.
 */
export interface PrizesCents {
  rad1: number;
  rad2: number;
  rad3: number;
  rad4: number;
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
