/**
 * BIN-700: public types + internal row-types for LoyaltyService.
 *
 * Utskilt fra LoyaltyService.ts som del av loyalty-service-split-refactor;
 * re-eksportert derfra slik at eksisterende imports fortsetter å fungere.
 */

import type { Pool } from "pg";

// ── Public types ────────────────────────────────────────────────────────────

export interface LoyaltyTier {
  id: string;
  name: string;
  rank: number;
  minPoints: number;
  maxPoints: number | null;
  benefits: Record<string, unknown>;
  active: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateLoyaltyTierInput {
  name: string;
  rank: number;
  minPoints?: number;
  maxPoints?: number | null;
  benefits?: Record<string, unknown>;
  active?: boolean;
  createdByUserId: string;
}

export interface UpdateLoyaltyTierInput {
  name?: string;
  rank?: number;
  minPoints?: number;
  maxPoints?: number | null;
  benefits?: Record<string, unknown>;
  active?: boolean;
}

export interface ListLoyaltyTierFilter {
  active?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

export interface LoyaltyPlayerState {
  userId: string;
  currentTier: LoyaltyTier | null;
  lifetimePoints: number;
  monthPoints: number;
  monthKey: string | null;
  tierLocked: boolean;
  lastUpdatedAt: string;
  createdAt: string;
}

export interface AwardLoyaltyPointsInput {
  userId: string;
  pointsDelta: number;
  reason: string;
  metadata?: Record<string, unknown>;
  createdByUserId: string;
}

/**
 * GAME1_SCHEDULE PR 5: automatisk activity-award-input. Brukes fra
 * BingoEngine-hook ved buy-in / game-win. Forskjellig fra admin-award ved:
 *   - `eventType` er fritt-form (f.eks. 'ticket.purchase', 'game.win').
 *   - `createdByUserId` er NULL (system-event).
 *   - `pointsDelta=0` er tillatt — vi lar porten sende 0 hvis
 *     business-regelen bestemmer at små buy-ins ikke gir poeng enda.
 *     Da skrives KUN en event-rad (markør), ingen state-mutasjon.
 */
export interface AwardLoyaltyActivityInput {
  userId: string;
  /** Fritt-form event-type-slug. F.eks. 'ticket.purchase', 'game.win'. */
  eventType: string;
  /** Poeng-endring. 0 = bare markør-event, ingen state-oppdatering. */
  pointsDelta: number;
  /**
   * Fri-form metadata om aktiviteten (gameId, roomCode, amount i kr, etc.).
   * Lagret i events.metadata_json. Ingen PII forventet.
   */
  metadata?: Record<string, unknown>;
}

export interface OverrideLoyaltyTierInput {
  userId: string;
  /** NULL = fjern override (lås opp for automatic assignment). */
  tierId: string | null;
  reason: string;
  createdByUserId: string;
}

export interface LoyaltyEvent {
  id: string;
  userId: string;
  eventType: string;
  pointsDelta: number;
  metadata: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
}

export interface AwardResult {
  state: LoyaltyPlayerState;
  event: LoyaltyEvent;
  /** true hvis tier endret seg som følge av award (auto-assignment). */
  tierChanged: boolean;
}

export interface MonthlyResetResult {
  playersReset: number;
  monthKey: string;
}

export interface LoyaltyServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

// ── Row types for DB mapping ────────────────────────────────────────────────

export interface LoyaltyTierRow {
  id: string;
  name: string;
  rank: number | string;
  min_points: number | string;
  max_points: number | string | null;
  benefits_json: Record<string, unknown> | null;
  active: boolean;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

export interface LoyaltyPlayerStateRow {
  user_id: string;
  current_tier_id: string | null;
  lifetime_points: number | string;
  month_points: number | string;
  month_key: string | null;
  tier_locked: boolean;
  last_updated_at: Date | string;
  created_at: Date | string;
}

export interface LoyaltyEventRow {
  id: string;
  user_id: string;
  event_type: string;
  points_delta: number | string;
  metadata_json: Record<string, unknown> | null;
  created_by_user_id: string | null;
  created_at: Date | string;
}
