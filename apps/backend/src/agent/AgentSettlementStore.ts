/**
 * BIN-583 B3.3: Postgres access layer for app_agent_settlements.
 *
 * Settlement-rader er nesten-immutable: bare admin-edit-flyten kan
 * mutere etter opprettelse, og det skjer kun via dedikert update-metode
 * som logger edited_by + edited_at + edit_reason. Ingen DELETE.
 */

import type { Pool } from "pg";

export interface AgentSettlement {
  id: string;
  shiftId: string;
  agentUserId: string;
  hallId: string;
  businessDate: string;
  dailyBalanceAtStart: number;
  dailyBalanceAtEnd: number;
  reportedCashCount: number;
  dailyBalanceDifference: number;
  settlementToDropSafe: number;
  withdrawFromTotalBalance: number;
  totalDropSafe: number;
  shiftCashInTotal: number;
  shiftCashOutTotal: number;
  shiftCardInTotal: number;
  shiftCardOutTotal: number;
  settlementNote: string | null;
  closedByUserId: string;
  isForced: boolean;
  editedByUserId: string | null;
  editedAt: string | null;
  editReason: string | null;
  otherData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InsertSettlementInput {
  id: string;
  shiftId: string;
  agentUserId: string;
  hallId: string;
  businessDate: string;
  dailyBalanceAtStart: number;
  dailyBalanceAtEnd: number;
  reportedCashCount: number;
  dailyBalanceDifference: number;
  settlementToDropSafe?: number;
  withdrawFromTotalBalance?: number;
  totalDropSafe?: number;
  shiftCashInTotal: number;
  shiftCashOutTotal: number;
  shiftCardInTotal: number;
  shiftCardOutTotal: number;
  settlementNote?: string | null;
  closedByUserId: string;
  isForced: boolean;
  otherData?: Record<string, unknown>;
}

export interface UpdateSettlementInput {
  reportedCashCount?: number;
  settlementToDropSafe?: number;
  withdrawFromTotalBalance?: number;
  totalDropSafe?: number;
  settlementNote?: string | null;
  otherData?: Record<string, unknown>;
}

export interface ListSettlementFilter {
  hallId?: string;
  agentUserId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface AgentSettlementStore {
  insert(input: InsertSettlementInput): Promise<AgentSettlement>;
  getById(id: string): Promise<AgentSettlement | null>;
  getByShiftId(shiftId: string): Promise<AgentSettlement | null>;
  list(filter: ListSettlementFilter): Promise<AgentSettlement[]>;
  applyEdit(id: string, patch: UpdateSettlementInput, editedByUserId: string, reason: string): Promise<AgentSettlement>;
}

// ── Postgres implementation ─────────────────────────────────────────────────

interface Row {
  id: string;
  shift_id: string;
  agent_user_id: string;
  hall_id: string;
  business_date: Date | string;
  daily_balance_at_start: string | number;
  daily_balance_at_end: string | number;
  reported_cash_count: string | number;
  daily_balance_difference: string | number;
  settlement_to_drop_safe: string | number;
  withdraw_from_total_balance: string | number;
  total_drop_safe: string | number;
  shift_cash_in_total: string | number;
  shift_cash_out_total: string | number;
  shift_card_in_total: string | number;
  shift_card_out_total: string | number;
  settlement_note: string | null;
  closed_by_user_id: string;
  is_forced: boolean;
  edited_by_user_id: string | null;
  edited_at: Date | string | null;
  edit_reason: string | null;
  other_data: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function asNumber(value: string | number): number {
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

export interface PostgresAgentSettlementStoreOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresAgentSettlementStore implements AgentSettlementStore {
  private readonly pool: Pool;
  private readonly tableName: string;

  constructor(options: PostgresAgentSettlementStoreOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
    this.tableName = `"${schema}"."app_agent_settlements"`;
  }

  async insert(input: InsertSettlementInput): Promise<AgentSettlement> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO ${this.tableName}
        (id, shift_id, agent_user_id, hall_id, business_date,
         daily_balance_at_start, daily_balance_at_end, reported_cash_count,
         daily_balance_difference, settlement_to_drop_safe,
         withdraw_from_total_balance, total_drop_safe,
         shift_cash_in_total, shift_cash_out_total, shift_card_in_total,
         shift_card_out_total, settlement_note, closed_by_user_id,
         is_forced, other_data)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20::jsonb)
       RETURNING *`,
      [
        input.id, input.shiftId, input.agentUserId, input.hallId, input.businessDate,
        input.dailyBalanceAtStart, input.dailyBalanceAtEnd, input.reportedCashCount,
        input.dailyBalanceDifference, input.settlementToDropSafe ?? 0,
        input.withdrawFromTotalBalance ?? 0, input.totalDropSafe ?? 0,
        input.shiftCashInTotal, input.shiftCashOutTotal, input.shiftCardInTotal,
        input.shiftCardOutTotal, input.settlementNote ?? null, input.closedByUserId,
        input.isForced, JSON.stringify(input.otherData ?? {}),
      ]
    );
    return this.map(rows[0]!);
  }

  async getById(id: string): Promise<AgentSettlement | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  async getByShiftId(shiftId: string): Promise<AgentSettlement | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.tableName} WHERE shift_id = $1`,
      [shiftId]
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  async list(filter: ListSettlementFilter): Promise<AgentSettlement[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    const where: string[] = [];
    const params: unknown[] = [];
    function add(col: string, value: unknown): void {
      params.push(value);
      where.push(`${col} = $${params.length}`);
    }
    if (filter.hallId) add("hall_id", filter.hallId);
    if (filter.agentUserId) add("agent_user_id", filter.agentUserId);
    if (filter.fromDate) {
      params.push(filter.fromDate);
      where.push(`business_date >= $${params.length}::date`);
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      where.push(`business_date <= $${params.length}::date`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.tableName}
       ${whereSql}
       ORDER BY business_date DESC, created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async applyEdit(id: string, patch: UpdateSettlementInput, editedByUserId: string, reason: string): Promise<AgentSettlement> {
    const sets: string[] = [];
    const params: unknown[] = [];
    function setField(col: string, value: unknown, jsonb = false): void {
      params.push(jsonb ? JSON.stringify(value) : value);
      sets.push(`${col} = $${params.length}${jsonb ? "::jsonb" : ""}`);
    }
    if (patch.reportedCashCount !== undefined) setField("reported_cash_count", patch.reportedCashCount);
    if (patch.settlementToDropSafe !== undefined) setField("settlement_to_drop_safe", patch.settlementToDropSafe);
    if (patch.withdrawFromTotalBalance !== undefined) setField("withdraw_from_total_balance", patch.withdrawFromTotalBalance);
    if (patch.totalDropSafe !== undefined) setField("total_drop_safe", patch.totalDropSafe);
    if (patch.settlementNote !== undefined) setField("settlement_note", patch.settlementNote);
    if (patch.otherData !== undefined) setField("other_data", patch.otherData, true);
    if (sets.length === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error("[BIN-583] settlement not found");
      return existing;
    }
    params.push(editedByUserId);
    const editedByIdx = params.length;
    params.push(reason);
    const reasonIdx = params.length;
    params.push(id);
    const idIdx = params.length;
    const { rows } = await this.pool.query<Row>(
      `UPDATE ${this.tableName}
       SET ${sets.join(", ")},
           edited_by_user_id = $${editedByIdx},
           edited_at = now(),
           edit_reason = $${reasonIdx},
           updated_at = now()
       WHERE id = $${idIdx}
       RETURNING *`,
      params
    );
    if (!rows[0]) throw new Error("[BIN-583] settlement not found");
    return this.map(rows[0]);
  }

  private map(row: Row): AgentSettlement {
    return {
      id: row.id,
      shiftId: row.shift_id,
      agentUserId: row.agent_user_id,
      hallId: row.hall_id,
      businessDate: asDate(row.business_date),
      dailyBalanceAtStart: asNumber(row.daily_balance_at_start),
      dailyBalanceAtEnd: asNumber(row.daily_balance_at_end),
      reportedCashCount: asNumber(row.reported_cash_count),
      dailyBalanceDifference: asNumber(row.daily_balance_difference),
      settlementToDropSafe: asNumber(row.settlement_to_drop_safe),
      withdrawFromTotalBalance: asNumber(row.withdraw_from_total_balance),
      totalDropSafe: asNumber(row.total_drop_safe),
      shiftCashInTotal: asNumber(row.shift_cash_in_total),
      shiftCashOutTotal: asNumber(row.shift_cash_out_total),
      shiftCardInTotal: asNumber(row.shift_card_in_total),
      shiftCardOutTotal: asNumber(row.shift_card_out_total),
      settlementNote: row.settlement_note,
      closedByUserId: row.closed_by_user_id,
      isForced: row.is_forced,
      editedByUserId: row.edited_by_user_id,
      editedAt: row.edited_at ? asIso(row.edited_at) : null,
      editReason: row.edit_reason,
      otherData: asJsonObject(row.other_data),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }
}

// ── In-memory implementation (tests) ────────────────────────────────────────

export class InMemoryAgentSettlementStore implements AgentSettlementStore {
  private readonly rows = new Map<string, AgentSettlement>();

  async insert(input: InsertSettlementInput): Promise<AgentSettlement> {
    // Enforce UNIQUE(shift_id) — mirror Postgres constraint
    for (const r of this.rows.values()) {
      if (r.shiftId === input.shiftId) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      }
    }
    const now = new Date().toISOString();
    const row: AgentSettlement = {
      id: input.id,
      shiftId: input.shiftId,
      agentUserId: input.agentUserId,
      hallId: input.hallId,
      businessDate: input.businessDate,
      dailyBalanceAtStart: input.dailyBalanceAtStart,
      dailyBalanceAtEnd: input.dailyBalanceAtEnd,
      reportedCashCount: input.reportedCashCount,
      dailyBalanceDifference: input.dailyBalanceDifference,
      settlementToDropSafe: input.settlementToDropSafe ?? 0,
      withdrawFromTotalBalance: input.withdrawFromTotalBalance ?? 0,
      totalDropSafe: input.totalDropSafe ?? 0,
      shiftCashInTotal: input.shiftCashInTotal,
      shiftCashOutTotal: input.shiftCashOutTotal,
      shiftCardInTotal: input.shiftCardInTotal,
      shiftCardOutTotal: input.shiftCardOutTotal,
      settlementNote: input.settlementNote ?? null,
      closedByUserId: input.closedByUserId,
      isForced: input.isForced,
      editedByUserId: null,
      editedAt: null,
      editReason: null,
      otherData: input.otherData ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(input.id, row);
    return { ...row };
  }

  async getById(id: string): Promise<AgentSettlement | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async getByShiftId(shiftId: string): Promise<AgentSettlement | null> {
    for (const r of this.rows.values()) {
      if (r.shiftId === shiftId) return { ...r };
    }
    return null;
  }

  async list(filter: ListSettlementFilter): Promise<AgentSettlement[]> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    let filtered = Array.from(this.rows.values());
    if (filter.hallId) filtered = filtered.filter((r) => r.hallId === filter.hallId);
    if (filter.agentUserId) filtered = filtered.filter((r) => r.agentUserId === filter.agentUserId);
    if (filter.fromDate) filtered = filtered.filter((r) => r.businessDate >= filter.fromDate!);
    if (filter.toDate) filtered = filtered.filter((r) => r.businessDate <= filter.toDate!);
    return filtered
      .sort((a, b) => (b.businessDate.localeCompare(a.businessDate) || b.createdAt.localeCompare(a.createdAt)))
      .slice(offset, offset + limit)
      .map((r) => ({ ...r }));
  }

  async applyEdit(id: string, patch: UpdateSettlementInput, editedByUserId: string, reason: string): Promise<AgentSettlement> {
    const row = this.rows.get(id);
    if (!row) throw new Error("[BIN-583] settlement not found");
    if (patch.reportedCashCount !== undefined) row.reportedCashCount = patch.reportedCashCount;
    if (patch.settlementToDropSafe !== undefined) row.settlementToDropSafe = patch.settlementToDropSafe;
    if (patch.withdrawFromTotalBalance !== undefined) row.withdrawFromTotalBalance = patch.withdrawFromTotalBalance;
    if (patch.totalDropSafe !== undefined) row.totalDropSafe = patch.totalDropSafe;
    if (patch.settlementNote !== undefined) row.settlementNote = patch.settlementNote;
    if (patch.otherData !== undefined) row.otherData = { ...patch.otherData };
    row.editedByUserId = editedByUserId;
    row.editedAt = new Date().toISOString();
    row.editReason = reason;
    row.updatedAt = row.editedAt;
    return { ...row };
  }
}
