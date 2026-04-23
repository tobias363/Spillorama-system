/**
 * BIN-700: pure row-mappers for LoyaltyService.
 *
 * Utskilt fra LoyaltyService.ts som del av loyalty-service-split-refactor.
 * Disse er rene sync-funksjoner (row → domain). Asynkron berikelse av
 * currentTier gjøres fortsatt inne i service-klassen (krever getTier-
 * oppslag på tvers av tabellen).
 */

import type {
  LoyaltyTier,
  LoyaltyTierRow,
  LoyaltyPlayerState,
  LoyaltyPlayerStateRow,
  LoyaltyEvent,
  LoyaltyEventRow,
} from "./LoyaltyTypes.js";
import { asIso, asIsoOrNull } from "./LoyaltyValidators.js";

export function mapTierRow(row: LoyaltyTierRow): LoyaltyTier {
  return {
    id: row.id,
    name: row.name,
    rank: Number(row.rank),
    minPoints: Number(row.min_points),
    maxPoints: row.max_points === null ? null : Number(row.max_points),
    benefits: (row.benefits_json ?? {}) as Record<string, unknown>,
    active: Boolean(row.active),
    createdByUserId: row.created_by_user_id,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    deletedAt: asIsoOrNull(row.deleted_at),
  };
}

/**
 * Mapper state-rad uten å berike currentTier. Aktiviteter som trenger
 * full tier-info bruker service-klassens mapStateRowAsync.
 */
export function mapStateRow(row: LoyaltyPlayerStateRow): LoyaltyPlayerState {
  return {
    userId: row.user_id,
    currentTier: null,
    lifetimePoints: Number(row.lifetime_points),
    monthPoints: Number(row.month_points),
    monthKey: row.month_key,
    tierLocked: Boolean(row.tier_locked),
    lastUpdatedAt: asIso(row.last_updated_at),
    createdAt: asIso(row.created_at),
  };
}

export function mapEventRow(row: LoyaltyEventRow): LoyaltyEvent {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    pointsDelta: Number(row.points_delta),
    metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
    createdByUserId: row.created_by_user_id,
    createdAt: asIso(row.created_at),
  };
}
