/**
 * BIN-583 B3.4/B3.5: store for app_machine_tickets.
 *
 * Felles for Metronia (B3.4) og OK Bingo (B3.5). machine_name-felt
 * diskriminerer. Store-metoder er machine-agnostiske; service-laget
 * (MetroniaTicketService, OkBingoTicketService) styrer logikk.
 */

import type { Pool } from "pg";

export type MachineName = "METRONIA" | "OK_BINGO";

export interface MachineTicket {
  id: string;
  machineName: MachineName;
  ticketNumber: string;
  externalTicketId: string;
  hallId: string;
  shiftId: string | null;
  agentUserId: string;
  playerUserId: string;
  roomId: string | null;
  initialAmountCents: number;
  totalTopupCents: number;
  currentBalanceCents: number;
  payoutCents: number | null;
  isClosed: boolean;
  closedAt: string | null;
  closedByUserId: string | null;
  voidAt: string | null;
  voidByUserId: string | null;
  voidReason: string | null;
  uniqueTransaction: string;
  otherData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InsertMachineTicketInput {
  id: string;
  machineName: MachineName;
  ticketNumber: string;
  externalTicketId: string;
  hallId: string;
  shiftId: string | null;
  agentUserId: string;
  playerUserId: string;
  roomId?: string | null;
  initialAmountCents: number;
  uniqueTransaction: string;
  otherData?: Record<string, unknown>;
}

export interface ListMachineTicketsFilter {
  machineName?: MachineName;
  hallId?: string;
  agentUserId?: string;
  playerUserId?: string;
  shiftId?: string;
  isClosed?: boolean;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface MachineTicketStore {
  insert(input: InsertMachineTicketInput): Promise<MachineTicket>;
  getById(id: string): Promise<MachineTicket | null>;
  getByTicketNumber(machineName: MachineName, ticketNumber: string): Promise<MachineTicket | null>;
  list(filter: ListMachineTicketsFilter): Promise<MachineTicket[]>;
  applyTopup(id: string, deltaCents: number, currentBalanceCents: number): Promise<MachineTicket>;
  markClosed(id: string, closedByUserId: string, payoutCents: number): Promise<MachineTicket>;
  markVoid(id: string, voidByUserId: string, reason: string | null): Promise<MachineTicket>;
}

// ── Postgres implementation ─────────────────────────────────────────────────

interface Row {
  id: string;
  machine_name: MachineName;
  ticket_number: string;
  external_ticket_id: string;
  hall_id: string;
  shift_id: string | null;
  agent_user_id: string;
  player_user_id: string;
  room_id: string | null;
  initial_amount_cents: string | number;
  total_topup_cents: string | number;
  current_balance_cents: string | number;
  payout_cents: string | number | null;
  is_closed: boolean;
  closed_at: Date | string | null;
  closed_by_user_id: string | null;
  void_at: Date | string | null;
  void_by_user_id: string | null;
  void_reason: string | null;
  unique_transaction: string;
  other_data: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asNumber(value: string | number | null): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function map(row: Row): MachineTicket {
  return {
    id: row.id,
    machineName: row.machine_name,
    ticketNumber: row.ticket_number,
    externalTicketId: row.external_ticket_id,
    hallId: row.hall_id,
    shiftId: row.shift_id,
    agentUserId: row.agent_user_id,
    playerUserId: row.player_user_id,
    roomId: row.room_id,
    initialAmountCents: asNumber(row.initial_amount_cents),
    totalTopupCents: asNumber(row.total_topup_cents),
    currentBalanceCents: asNumber(row.current_balance_cents),
    payoutCents: row.payout_cents === null ? null : asNumber(row.payout_cents),
    isClosed: row.is_closed,
    closedAt: row.closed_at ? asIso(row.closed_at) : null,
    closedByUserId: row.closed_by_user_id,
    voidAt: row.void_at ? asIso(row.void_at) : null,
    voidByUserId: row.void_by_user_id,
    voidReason: row.void_reason,
    uniqueTransaction: row.unique_transaction,
    otherData: asJsonObject(row.other_data),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

export interface PostgresMachineTicketStoreOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresMachineTicketStore implements MachineTicketStore {
  private readonly pool: Pool;
  private readonly tableName: string;

  constructor(options: PostgresMachineTicketStoreOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
    this.tableName = `"${schema}"."app_machine_tickets"`;
  }

  async insert(input: InsertMachineTicketInput): Promise<MachineTicket> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO ${this.tableName}
        (id, machine_name, ticket_number, external_ticket_id, hall_id,
         shift_id, agent_user_id, player_user_id, room_id,
         initial_amount_cents, current_balance_cents, unique_transaction, other_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12::jsonb)
       RETURNING *`,
      [
        input.id, input.machineName, input.ticketNumber, input.externalTicketId,
        input.hallId, input.shiftId, input.agentUserId, input.playerUserId,
        input.roomId ?? null, input.initialAmountCents,
        input.uniqueTransaction, JSON.stringify(input.otherData ?? {}),
      ]
    );
    return map(rows[0]!);
  }

  async getById(id: string): Promise<MachineTicket | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async getByTicketNumber(machineName: MachineName, ticketNumber: string): Promise<MachineTicket | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.tableName}
       WHERE machine_name = $1 AND ticket_number = $2
       LIMIT 1`,
      [machineName, ticketNumber]
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async list(filter: ListMachineTicketsFilter): Promise<MachineTicket[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    const where: string[] = [];
    const params: unknown[] = [];
    function add(col: string, value: unknown): void {
      params.push(value);
      where.push(`${col} = $${params.length}`);
    }
    if (filter.machineName) add("machine_name", filter.machineName);
    if (filter.hallId) add("hall_id", filter.hallId);
    if (filter.agentUserId) add("agent_user_id", filter.agentUserId);
    if (filter.playerUserId) add("player_user_id", filter.playerUserId);
    if (filter.shiftId) add("shift_id", filter.shiftId);
    if (filter.isClosed !== undefined) add("is_closed", filter.isClosed);
    if (filter.fromDate) {
      params.push(filter.fromDate);
      where.push(`created_at >= $${params.length}`);
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      where.push(`created_at <= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.tableName}
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return rows.map(map);
  }

  async applyTopup(id: string, deltaCents: number, currentBalanceCents: number): Promise<MachineTicket> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE ${this.tableName}
       SET total_topup_cents = total_topup_cents + $2,
           current_balance_cents = $3,
           updated_at = now()
       WHERE id = $1 AND is_closed = false
       RETURNING *`,
      [id, deltaCents, currentBalanceCents]
    );
    if (!rows[0]) throw new Error("[BIN-583] machine ticket not found or closed");
    return map(rows[0]);
  }

  async markClosed(id: string, closedByUserId: string, payoutCents: number): Promise<MachineTicket> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE ${this.tableName}
       SET is_closed = true,
           closed_at = now(),
           closed_by_user_id = $2,
           payout_cents = $3,
           current_balance_cents = 0,
           updated_at = now()
       WHERE id = $1 AND is_closed = false
       RETURNING *`,
      [id, closedByUserId, payoutCents]
    );
    if (!rows[0]) throw new Error("[BIN-583] machine ticket not found or already closed");
    return map(rows[0]);
  }

  async markVoid(id: string, voidByUserId: string, reason: string | null): Promise<MachineTicket> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE ${this.tableName}
       SET is_closed = true,
           void_at = now(),
           void_by_user_id = $2,
           void_reason = $3,
           current_balance_cents = 0,
           updated_at = now()
       WHERE id = $1 AND is_closed = false
       RETURNING *`,
      [id, voidByUserId, reason]
    );
    if (!rows[0]) throw new Error("[BIN-583] machine ticket not found or already closed");
    return map(rows[0]);
  }
}

// ── In-memory implementation ────────────────────────────────────────────────

export class InMemoryMachineTicketStore implements MachineTicketStore {
  private readonly tickets = new Map<string, MachineTicket>();

  async insert(input: InsertMachineTicketInput): Promise<MachineTicket> {
    // Mirror Postgres UNIQUE-violations
    for (const t of this.tickets.values()) {
      if (t.uniqueTransaction === input.uniqueTransaction) {
        throw Object.assign(new Error("duplicate unique_transaction"), { code: "23505" });
      }
      if (t.machineName === input.machineName && t.ticketNumber === input.ticketNumber) {
        throw Object.assign(new Error("duplicate ticket_number"), { code: "23505" });
      }
    }
    const now = new Date().toISOString();
    const ticket: MachineTicket = {
      id: input.id,
      machineName: input.machineName,
      ticketNumber: input.ticketNumber,
      externalTicketId: input.externalTicketId,
      hallId: input.hallId,
      shiftId: input.shiftId,
      agentUserId: input.agentUserId,
      playerUserId: input.playerUserId,
      roomId: input.roomId ?? null,
      initialAmountCents: input.initialAmountCents,
      totalTopupCents: 0,
      currentBalanceCents: input.initialAmountCents,
      payoutCents: null,
      isClosed: false,
      closedAt: null,
      closedByUserId: null,
      voidAt: null,
      voidByUserId: null,
      voidReason: null,
      uniqueTransaction: input.uniqueTransaction,
      otherData: input.otherData ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.tickets.set(input.id, ticket);
    return { ...ticket };
  }

  async getById(id: string): Promise<MachineTicket | null> {
    const t = this.tickets.get(id);
    return t ? { ...t } : null;
  }

  async getByTicketNumber(machineName: MachineName, ticketNumber: string): Promise<MachineTicket | null> {
    for (const t of this.tickets.values()) {
      if (t.machineName === machineName && t.ticketNumber === ticketNumber) return { ...t };
    }
    return null;
  }

  async list(filter: ListMachineTicketsFilter): Promise<MachineTicket[]> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    let filtered = Array.from(this.tickets.values());
    if (filter.machineName) filtered = filtered.filter((t) => t.machineName === filter.machineName);
    if (filter.hallId) filtered = filtered.filter((t) => t.hallId === filter.hallId);
    if (filter.agentUserId) filtered = filtered.filter((t) => t.agentUserId === filter.agentUserId);
    if (filter.playerUserId) filtered = filtered.filter((t) => t.playerUserId === filter.playerUserId);
    if (filter.shiftId) filtered = filtered.filter((t) => t.shiftId === filter.shiftId);
    if (filter.isClosed !== undefined) filtered = filtered.filter((t) => t.isClosed === filter.isClosed);
    if (filter.fromDate) filtered = filtered.filter((t) => t.createdAt >= filter.fromDate!);
    if (filter.toDate) filtered = filtered.filter((t) => t.createdAt <= filter.toDate!);
    return filtered
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit)
      .map((t) => ({ ...t }));
  }

  async applyTopup(id: string, deltaCents: number, currentBalanceCents: number): Promise<MachineTicket> {
    const t = this.tickets.get(id);
    if (!t || t.isClosed) throw new Error("[BIN-583] machine ticket not found or closed");
    t.totalTopupCents += deltaCents;
    t.currentBalanceCents = currentBalanceCents;
    t.updatedAt = new Date().toISOString();
    return { ...t };
  }

  async markClosed(id: string, closedByUserId: string, payoutCents: number): Promise<MachineTicket> {
    const t = this.tickets.get(id);
    if (!t || t.isClosed) throw new Error("[BIN-583] machine ticket not found or already closed");
    const now = new Date().toISOString();
    t.isClosed = true;
    t.closedAt = now;
    t.closedByUserId = closedByUserId;
    t.payoutCents = payoutCents;
    t.currentBalanceCents = 0;
    t.updatedAt = now;
    return { ...t };
  }

  async markVoid(id: string, voidByUserId: string, reason: string | null): Promise<MachineTicket> {
    const t = this.tickets.get(id);
    if (!t || t.isClosed) throw new Error("[BIN-583] machine ticket not found or already closed");
    const now = new Date().toISOString();
    t.isClosed = true;
    t.voidAt = now;
    t.voidByUserId = voidByUserId;
    t.voidReason = reason;
    t.currentBalanceCents = 0;
    t.updatedAt = now;
    return { ...t };
  }
}
