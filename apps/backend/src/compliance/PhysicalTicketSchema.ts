/**
 * BIN-587 B4a: schema-init for physical-ticket-tabeller.
 *
 * Utskilt fra PhysicalTicketService.ts som del av S2-refactor. SQL-en er
 * bevart 1:1; kun organisering er endret. Tabellene matcher migrasjonene
 * under apps/backend/migrations (defense-in-depth ved first-run).
 */

import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";

export interface PhysicalTicketTableNames {
  batches: string;
  tickets: string;
  cashouts: string;
}

export function physicalTicketTableNames(schema: string): PhysicalTicketTableNames {
  return {
    batches: `"${schema}"."app_physical_ticket_batches"`,
    tickets: `"${schema}"."app_physical_tickets"`,
    cashouts: `"${schema}"."app_physical_ticket_cashouts"`,
  };
}

/**
 * Oppretter batches/tickets/cashouts-tabellene + indekser hvis de mangler.
 * Idempotent (IF NOT EXISTS overalt). Én transaksjon — ALLER eller INGENTING.
 */
export async function initializePhysicalTicketSchema(
  pool: Pool,
  schema: string,
): Promise<void> {
  const tables = physicalTicketTableNames(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tables.batches} (
        id TEXT PRIMARY KEY,
        hall_id TEXT NOT NULL,
        batch_name TEXT NOT NULL,
        range_start BIGINT NOT NULL,
        range_end BIGINT NOT NULL,
        default_price_cents BIGINT NOT NULL CHECK (default_price_cents >= 0),
        game_slug TEXT NULL,
        assigned_game_id TEXT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
        created_by TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (range_end >= range_start),
        UNIQUE (hall_id, batch_name)
      )`
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tables.tickets} (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES ${tables.batches}(id) ON DELETE CASCADE,
        unique_id TEXT UNIQUE NOT NULL,
        hall_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNSOLD'
          CHECK (status IN ('UNSOLD', 'SOLD', 'VOIDED')),
        price_cents BIGINT NULL CHECK (price_cents IS NULL OR price_cents >= 0),
        assigned_game_id TEXT NULL,
        sold_at TIMESTAMPTZ NULL,
        sold_by TEXT NULL,
        buyer_user_id TEXT NULL,
        voided_at TIMESTAMPTZ NULL,
        voided_by TEXT NULL,
        voided_reason TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        numbers_json JSONB NULL,
        pattern_won TEXT NULL
          CHECK (pattern_won IS NULL OR pattern_won IN ('row_1','row_2','row_3','row_4','full_house')),
        won_amount_cents BIGINT NULL
          CHECK (won_amount_cents IS NULL OR won_amount_cents >= 0),
        evaluated_at TIMESTAMPTZ NULL,
        is_winning_distributed BOOLEAN NOT NULL DEFAULT false,
        winning_distributed_at TIMESTAMPTZ NULL
      )`
    );
    // BIN-698: Defense-in-depth for miljøer der tabellen finnes fra før —
    // legger til kolonner hvis de mangler (matcher migrasjon 20260427000100).
    await client.query(
      `ALTER TABLE ${tables.tickets}
         ADD COLUMN IF NOT EXISTS numbers_json JSONB NULL,
         ADD COLUMN IF NOT EXISTS pattern_won TEXT NULL,
         ADD COLUMN IF NOT EXISTS won_amount_cents BIGINT NULL,
         ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ NULL,
         ADD COLUMN IF NOT EXISTS is_winning_distributed BOOLEAN NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS winning_distributed_at TIMESTAMPTZ NULL`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_ptb_hall
       ON ${tables.batches}(hall_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_pt_batch
       ON ${tables.tickets}(batch_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_pt_game_status
       ON ${tables.tickets}(assigned_game_id, status)
       WHERE assigned_game_id IS NOT NULL`
    );
    // BIN-698: partial index for BIN-639 reward-all query
    //   ("alle vinnende billetter i et game som ikke er utbetalt ennå").
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_pt_undistributed_winners
       ON ${tables.tickets}(assigned_game_id)
       WHERE won_amount_cents > 0 AND is_winning_distributed = false`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_pt_hall_status
       ON ${tables.tickets}(hall_id, status)`
    );
    // BIN-640: single-ticket cashouts — én rad per utbetalt fysisk billett.
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tables.cashouts} (
        id TEXT PRIMARY KEY,
        ticket_unique_id TEXT NOT NULL UNIQUE,
        hall_id TEXT NOT NULL,
        game_id TEXT NULL,
        payout_cents BIGINT NOT NULL CHECK (payout_cents > 0),
        paid_by TEXT NOT NULL,
        paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        notes TEXT NULL,
        other_data JSONB NOT NULL DEFAULT '{}'::jsonb
      )`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_ptc_hall_paid_at
       ON ${tables.cashouts}(hall_id, paid_at DESC)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_${schema}_ptc_game
       ON ${tables.cashouts}(game_id, paid_at DESC)
       WHERE game_id IS NOT NULL`
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof DomainError) throw err;
    throw new DomainError("PHYSICAL_INIT_FAILED", "Kunne ikke initialisere physical-ticket-tabeller.");
  } finally {
    client.release();
  }
}
