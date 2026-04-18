/**
 * BIN-583 B3.2: read-only boundary into B4a's app_physical_tickets.
 *
 * Agent 1 eier write-path via PhysicalTicketService. Vi trenger read-
 * access for inventory + sell-validering. TODO BIN-607: flytt til
 * PhysicalTicketService.{listAvailableInHall,getByUniqueId}() når
 * Agent 1 eksporterer dem.
 */

import type { Pool } from "pg";
import type { PhysicalTicketInventoryRow } from "../AgentTransactionService.js";

export interface PhysicalTicketReadPort {
  listUnsoldInHall(hallId: string, opts?: { limit?: number; offset?: number }): Promise<PhysicalTicketInventoryRow[]>;
  getByUniqueId(uniqueId: string): Promise<PhysicalTicketInventoryRow | null>;
}

// ── Postgres implementation ─────────────────────────────────────────────────

interface Row {
  unique_id: string;
  batch_id: string;
  hall_id: string;
  status: "UNSOLD" | "SOLD" | "VOIDED";
  price_cents: string | number | null;
  default_price_cents: string | number;
  assigned_game_id: string | null;
}

function mapRow(r: Row): PhysicalTicketInventoryRow {
  return {
    uniqueId: r.unique_id,
    batchId: r.batch_id,
    hallId: r.hall_id,
    status: r.status,
    priceCents: Number(r.price_cents ?? r.default_price_cents),
    assignedGameId: r.assigned_game_id,
  };
}

export interface PostgresPhysicalTicketReadPortOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresPhysicalTicketReadPort implements PhysicalTicketReadPort {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: PostgresPhysicalTicketReadPortOptions) {
    this.pool = options.pool;
    this.schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
  }

  async listUnsoldInHall(hallId: string, opts?: { limit?: number; offset?: number }): Promise<PhysicalTicketInventoryRow[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? 100)));
    const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
    const { rows } = await this.pool.query<Row>(
      `SELECT t.unique_id, t.batch_id, t.hall_id, t.status,
              t.price_cents, b.default_price_cents, t.assigned_game_id
       FROM "${this.schema}"."app_physical_tickets" t
       JOIN "${this.schema}"."app_physical_ticket_batches" b ON b.id = t.batch_id
       WHERE t.hall_id = $1 AND t.status = 'UNSOLD'
       ORDER BY t.unique_id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [hallId]
    );
    return rows.map(mapRow);
  }

  async getByUniqueId(uniqueId: string): Promise<PhysicalTicketInventoryRow | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT t.unique_id, t.batch_id, t.hall_id, t.status,
              t.price_cents, b.default_price_cents, t.assigned_game_id
       FROM "${this.schema}"."app_physical_tickets" t
       JOIN "${this.schema}"."app_physical_ticket_batches" b ON b.id = t.batch_id
       WHERE t.unique_id = $1
       LIMIT 1`,
      [uniqueId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
}

// ── In-memory implementation (tests) ────────────────────────────────────────

export class InMemoryPhysicalTicketReadPort implements PhysicalTicketReadPort {
  private readonly tickets = new Map<string, PhysicalTicketInventoryRow>();

  seed(ticket: PhysicalTicketInventoryRow): void {
    this.tickets.set(ticket.uniqueId, { ...ticket });
  }

  /** Test-helper: oppdater status (for å simulere B4a markSold). */
  setStatus(uniqueId: string, status: "UNSOLD" | "SOLD" | "VOIDED"): void {
    const existing = this.tickets.get(uniqueId);
    if (existing) existing.status = status;
  }

  async listUnsoldInHall(hallId: string, opts?: { limit?: number; offset?: number }): Promise<PhysicalTicketInventoryRow[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    return Array.from(this.tickets.values())
      .filter((t) => t.hallId === hallId && t.status === "UNSOLD")
      .sort((a, b) => a.uniqueId.localeCompare(b.uniqueId))
      .slice(offset, offset + limit)
      .map((t) => ({ ...t }));
  }

  async getByUniqueId(uniqueId: string): Promise<PhysicalTicketInventoryRow | null> {
    const t = this.tickets.get(uniqueId);
    return t ? { ...t } : null;
  }
}
