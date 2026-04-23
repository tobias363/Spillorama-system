/**
 * BIN-700: schema-init for loyalty-tabeller.
 *
 * Utskilt fra LoyaltyService.ts som del av loyalty-service-split-refactor.
 * SQL-en er bevart 1:1; kun organisering er endret. Tabellene matcher
 * migrasjonene under apps/backend/migrations (defense-in-depth ved
 * first-run).
 */

import type { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "loyalty-schema" });

export interface LoyaltyTableNames {
  tiers: string;
  state: string;
  events: string;
}

export function loyaltyTableNames(schema: string): LoyaltyTableNames {
  return {
    tiers: `"${schema}"."app_loyalty_tiers"`,
    state: `"${schema}"."app_loyalty_player_state"`,
    events: `"${schema}"."app_loyalty_events"`,
  };
}

/**
 * Oppretter tiers/state/events-tabellene + indekser hvis de mangler.
 * Idempotent (IF NOT EXISTS overalt). Én transaksjon — ALLER eller
 * INGENTING.
 */
export async function initializeLoyaltySchema(
  pool: Pool,
  schema: string
): Promise<void> {
  const tables = loyaltyTableNames(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tables.tiers} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rank INTEGER NOT NULL CHECK (rank > 0),
        min_points INTEGER NOT NULL DEFAULT 0 CHECK (min_points >= 0),
        max_points INTEGER NULL CHECK (max_points IS NULL OR max_points > min_points),
        benefits_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        active BOOLEAN NOT NULL DEFAULT true,
        created_by_user_id TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL
      )`
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_${schema}_loyalty_tiers_name
       ON ${tables.tiers}(name) WHERE deleted_at IS NULL`
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_${schema}_loyalty_tiers_rank
       ON ${tables.tiers}(rank) WHERE deleted_at IS NULL`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_loyalty_tiers_rank_active
       ON ${tables.tiers}(rank DESC, min_points ASC)
       WHERE deleted_at IS NULL AND active = true`
    );

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tables.state} (
        user_id TEXT PRIMARY KEY,
        current_tier_id TEXT NULL,
        lifetime_points INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
        month_points INTEGER NOT NULL DEFAULT 0 CHECK (month_points >= 0),
        month_key TEXT NULL,
        tier_locked BOOLEAN NOT NULL DEFAULT false,
        last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_loyalty_player_state_tier
       ON ${tables.state}(current_tier_id) WHERE current_tier_id IS NOT NULL`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_loyalty_player_state_lifetime
       ON ${tables.state}(lifetime_points DESC)`
    );

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tables.events} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        points_delta INTEGER NOT NULL DEFAULT 0,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_loyalty_events_user_time
       ON ${tables.events}(user_id, created_at DESC)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_loyalty_events_type_time
       ON ${tables.events}(event_type, created_at DESC)`
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof DomainError) throw err;
    logger.error({ err }, "[BIN-700] loyalty schema init failed");
    throw new DomainError(
      "LOYALTY_INIT_FAILED",
      "Kunne ikke initialisere loyalty-tabeller."
    );
  } finally {
    client.release();
  }
}
