/**
 * Wireframe Gap #9: Ports for Shift Log Out-flyt.
 *
 * AgentShiftService.logout() trenger å flagge pending cashouts + åpne
 * ticket-ranges for overtagelse av neste agent. Disse portene isolerer
 * service-laget fra PT4-storen (app_physical_ticket_pending_payouts) og
 * range-tabellen (app_agent_ticket_ranges) slik at vi kan kjøre service-
 * tester med in-memory-twinner uten full DB-graf.
 *
 * PostgresImpl brukes av index.ts-wiringen; InMemoryImpl brukes av
 * AgentShiftService-tester.
 */

import type { Pool } from "pg";
import type {
  ShiftPendingPayoutPort,
  ShiftTicketRangePort,
  PendingCashoutSummary,
} from "../AgentShiftService.js";

// ── Postgres implementations ────────────────────────────────────────────────

interface PendingRow {
  id: string;
  ticket_id: string;
  hall_id: string;
  scheduled_game_id: string;
  pattern_phase: string;
  expected_payout_cents: string | number;
  color: string;
  detected_at: Date | string;
  verified_at: Date | string | null;
  admin_approval_required: boolean;
}

function asIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function mapPendingRow(r: PendingRow): PendingCashoutSummary {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    hallId: r.hall_id,
    scheduledGameId: r.scheduled_game_id,
    patternPhase: r.pattern_phase,
    expectedPayoutCents: Number(r.expected_payout_cents),
    color: r.color,
    detectedAt: asIso(r.detected_at),
    verifiedAt: r.verified_at ? asIso(r.verified_at) : null,
    adminApprovalRequired: r.admin_approval_required,
  };
}

export interface PostgresShiftPendingPayoutPortOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresShiftPendingPayoutPort implements ShiftPendingPayoutPort {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: PostgresShiftPendingPayoutPortOptions) {
    this.pool = opts.pool;
    this.schema = (opts.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
  }

  private table(): string {
    return `"${this.schema}"."app_physical_ticket_pending_payouts"`;
  }

  async listPendingForAgent(agentUserId: string): Promise<PendingCashoutSummary[]> {
    const { rows } = await this.pool.query<PendingRow>(
      `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
              expected_payout_cents, color, detected_at, verified_at,
              admin_approval_required
       FROM ${this.table()}
       WHERE responsible_user_id = $1
         AND paid_out_at IS NULL
         AND rejected_at IS NULL
       ORDER BY detected_at DESC`,
      [agentUserId]
    );
    return rows.map(mapPendingRow);
  }

  async markPendingForNextAgent(agentUserId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.table()}
       SET pending_for_next_agent = true
       WHERE responsible_user_id = $1
         AND paid_out_at IS NULL
         AND rejected_at IS NULL
         AND pending_for_next_agent = false`,
      [agentUserId]
    );
    return rowCount ?? 0;
  }
}

export interface PostgresShiftTicketRangePortOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresShiftTicketRangePort implements ShiftTicketRangePort {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: PostgresShiftTicketRangePortOptions) {
    this.pool = opts.pool;
    this.schema = (opts.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
  }

  private table(): string {
    return `"${this.schema}"."app_agent_ticket_ranges"`;
  }

  async markRangesForTransfer(agentUserId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.table()}
       SET transfer_to_next_agent = true
       WHERE agent_id = $1
         AND closed_at IS NULL
         AND transfer_to_next_agent = false`,
      [agentUserId]
    );
    return rowCount ?? 0;
  }
}

// ── In-memory implementations (for tests) ───────────────────────────────────

/**
 * Test-hjelper: enkel PT4-pending-store uten DB. Holder rader i minne og
 * lar tester seede, list, og verifisere flag-endringer.
 */
export interface InMemoryPendingRow extends PendingCashoutSummary {
  responsibleUserId: string;
  paidOutAt: string | null;
  rejectedAt: string | null;
  pendingForNextAgent: boolean;
}

export class InMemoryShiftPendingPayoutPort implements ShiftPendingPayoutPort {
  private readonly rows = new Map<string, InMemoryPendingRow>();

  seed(row: InMemoryPendingRow): void {
    this.rows.set(row.id, { ...row });
  }

  snapshot(): InMemoryPendingRow[] {
    return Array.from(this.rows.values()).map((r) => ({ ...r }));
  }

  async listPendingForAgent(agentUserId: string): Promise<PendingCashoutSummary[]> {
    return Array.from(this.rows.values())
      .filter(
        (r) =>
          r.responsibleUserId === agentUserId &&
          r.paidOutAt === null &&
          r.rejectedAt === null
      )
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
      .map((r) => ({
        id: r.id,
        ticketId: r.ticketId,
        hallId: r.hallId,
        scheduledGameId: r.scheduledGameId,
        patternPhase: r.patternPhase,
        expectedPayoutCents: r.expectedPayoutCents,
        color: r.color,
        detectedAt: r.detectedAt,
        verifiedAt: r.verifiedAt,
        adminApprovalRequired: r.adminApprovalRequired,
      }));
  }

  async markPendingForNextAgent(agentUserId: string): Promise<number> {
    let count = 0;
    for (const r of this.rows.values()) {
      if (
        r.responsibleUserId === agentUserId &&
        r.paidOutAt === null &&
        r.rejectedAt === null &&
        r.pendingForNextAgent === false
      ) {
        r.pendingForNextAgent = true;
        count++;
      }
    }
    return count;
  }
}

export interface InMemoryRangeRow {
  id: string;
  agentId: string;
  hallId: string;
  closedAt: string | null;
  transferToNextAgent: boolean;
}

export class InMemoryShiftTicketRangePort implements ShiftTicketRangePort {
  private readonly rows = new Map<string, InMemoryRangeRow>();

  seed(row: InMemoryRangeRow): void {
    this.rows.set(row.id, { ...row });
  }

  snapshot(): InMemoryRangeRow[] {
    return Array.from(this.rows.values()).map((r) => ({ ...r }));
  }

  async markRangesForTransfer(agentUserId: string): Promise<number> {
    let count = 0;
    for (const r of this.rows.values()) {
      if (
        r.agentId === agentUserId &&
        r.closedAt === null &&
        r.transferToNextAgent === false
      ) {
        r.transferToNextAgent = true;
        count++;
      }
    }
    return count;
  }
}
