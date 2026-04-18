/**
 * BIN-583 B3.3: hall cash + drop-safe ledger.
 *
 * Wraps app_halls.cash_balance/dropsafe_balance writes with an immutable
 * audit trail in app_hall_cash_transactions. Balansene muteres atomisk
 * sammen med tx-raden via samme PoolClient (BEGIN/COMMIT i caller).
 *
 * For InMemory: state holdes per-hall, ingen real transaksjons-grenser.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type HallCashTxType =
  | "DAILY_BALANCE_TRANSFER"
  | "DROP_SAFE_MOVE"
  | "SHIFT_DIFFERENCE"
  | "MANUAL_ADJUSTMENT";

export type HallCashDirection = "CREDIT" | "DEBIT";

export interface HallCashTransaction {
  id: string;
  hallId: string;
  agentUserId: string | null;
  shiftId: string | null;
  settlementId: string | null;
  txType: HallCashTxType;
  direction: HallCashDirection;
  amount: number;
  previousBalance: number;
  afterBalance: number;
  notes: string | null;
  otherData: Record<string, unknown>;
  createdAt: string;
}

export interface ApplyCashTxInput {
  hallId: string;
  agentUserId?: string | null;
  shiftId?: string | null;
  settlementId?: string | null;
  txType: HallCashTxType;
  direction: HallCashDirection;
  amount: number;
  notes?: string | null;
  otherData?: Record<string, unknown>;
}

export interface HallCashLedger {
  /**
   * Atomisk: muter app_halls.cash_balance + skriv tx-rad. Returnerer
   * tx-rad med previous/after-snapshot.
   */
  applyCashTx(input: ApplyCashTxInput): Promise<HallCashTransaction>;

  /** Les running cash + dropsafe balance for hall. */
  getHallBalances(hallId: string): Promise<{ cashBalance: number; dropsafeBalance: number }>;

  listForHall(hallId: string, opts?: { limit?: number; offset?: number }): Promise<HallCashTransaction[]>;
  listForSettlement(settlementId: string): Promise<HallCashTransaction[]>;
}

// ── Postgres implementation ─────────────────────────────────────────────────

interface TxRow {
  id: string;
  hall_id: string;
  agent_user_id: string | null;
  shift_id: string | null;
  settlement_id: string | null;
  tx_type: HallCashTxType;
  direction: HallCashDirection;
  amount: string | number;
  previous_balance: string | number;
  after_balance: string | number;
  notes: string | null;
  other_data: unknown;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

export interface PostgresHallCashLedgerOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresHallCashLedger implements HallCashLedger {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: PostgresHallCashLedgerOptions) {
    this.pool = options.pool;
    this.schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
  }

  private hallsTable(): string { return `"${this.schema}"."app_halls"`; }
  private txTable(): string { return `"${this.schema}"."app_hall_cash_transactions"`; }

  async applyCashTx(input: ApplyCashTxInput): Promise<HallCashTransaction> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock + read current balance
      const { rows: hallRows } = await client.query<{ cash_balance: string | number }>(
        `SELECT cash_balance FROM ${this.hallsTable()} WHERE id = $1 FOR UPDATE`,
        [input.hallId]
      );
      if (!hallRows[0]) {
        throw new Error("[BIN-583] hall not found");
      }
      const previousBalance = asNumber(hallRows[0].cash_balance);
      const delta = input.direction === "CREDIT" ? input.amount : -input.amount;
      const afterBalance = previousBalance + delta;

      await client.query(
        `UPDATE ${this.hallsTable()} SET cash_balance = $2, updated_at = now() WHERE id = $1`,
        [input.hallId, afterBalance]
      );
      const id = `hcashtx-${randomUUID()}`;
      const { rows } = await client.query<TxRow>(
        `INSERT INTO ${this.txTable()}
          (id, hall_id, agent_user_id, shift_id, settlement_id,
           tx_type, direction, amount, previous_balance, after_balance,
           notes, other_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         RETURNING *`,
        [
          id, input.hallId, input.agentUserId ?? null, input.shiftId ?? null,
          input.settlementId ?? null, input.txType, input.direction, input.amount,
          previousBalance, afterBalance, input.notes ?? null,
          JSON.stringify(input.otherData ?? {}),
        ]
      );
      await client.query("COMMIT");
      return this.map(rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getHallBalances(hallId: string): Promise<{ cashBalance: number; dropsafeBalance: number }> {
    const { rows } = await this.pool.query<{ cash_balance: string | number; dropsafe_balance: string | number }>(
      `SELECT cash_balance, dropsafe_balance FROM ${this.hallsTable()} WHERE id = $1`,
      [hallId]
    );
    if (!rows[0]) throw new Error("[BIN-583] hall not found");
    return {
      cashBalance: asNumber(rows[0].cash_balance),
      dropsafeBalance: asNumber(rows[0].dropsafe_balance),
    };
  }

  async listForHall(hallId: string, opts?: { limit?: number; offset?: number }): Promise<HallCashTransaction[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? 100)));
    const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
    const { rows } = await this.pool.query<TxRow>(
      `SELECT * FROM ${this.txTable()}
       WHERE hall_id = $1
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [hallId]
    );
    return rows.map((r) => this.map(r));
  }

  async listForSettlement(settlementId: string): Promise<HallCashTransaction[]> {
    const { rows } = await this.pool.query<TxRow>(
      `SELECT * FROM ${this.txTable()}
       WHERE settlement_id = $1
       ORDER BY created_at ASC`,
      [settlementId]
    );
    return rows.map((r) => this.map(r));
  }

  private map(row: TxRow): HallCashTransaction {
    return {
      id: row.id,
      hallId: row.hall_id,
      agentUserId: row.agent_user_id,
      shiftId: row.shift_id,
      settlementId: row.settlement_id,
      txType: row.tx_type,
      direction: row.direction,
      amount: asNumber(row.amount),
      previousBalance: asNumber(row.previous_balance),
      afterBalance: asNumber(row.after_balance),
      notes: row.notes,
      otherData: asJsonObject(row.other_data),
      createdAt: asIso(row.created_at),
    };
  }
}

// ── In-memory implementation (tests) ────────────────────────────────────────

export class InMemoryHallCashLedger implements HallCashLedger {
  private readonly balances = new Map<string, { cashBalance: number; dropsafeBalance: number }>();
  private readonly txs: HallCashTransaction[] = [];

  /** Test-helper: seed initial balance for a hall. */
  seedHallBalance(hallId: string, cashBalance: number, dropsafeBalance = 0): void {
    this.balances.set(hallId, { cashBalance, dropsafeBalance });
  }

  async applyCashTx(input: ApplyCashTxInput): Promise<HallCashTransaction> {
    const balances = this.balances.get(input.hallId) ?? { cashBalance: 0, dropsafeBalance: 0 };
    const previousBalance = balances.cashBalance;
    const delta = input.direction === "CREDIT" ? input.amount : -input.amount;
    const afterBalance = previousBalance + delta;
    balances.cashBalance = afterBalance;
    this.balances.set(input.hallId, balances);
    const tx: HallCashTransaction = {
      id: `hcashtx-${randomUUID()}`,
      hallId: input.hallId,
      agentUserId: input.agentUserId ?? null,
      shiftId: input.shiftId ?? null,
      settlementId: input.settlementId ?? null,
      txType: input.txType,
      direction: input.direction,
      amount: input.amount,
      previousBalance,
      afterBalance,
      notes: input.notes ?? null,
      otherData: input.otherData ?? {},
      createdAt: new Date().toISOString(),
    };
    this.txs.push(tx);
    return { ...tx };
  }

  async getHallBalances(hallId: string): Promise<{ cashBalance: number; dropsafeBalance: number }> {
    return this.balances.get(hallId) ?? { cashBalance: 0, dropsafeBalance: 0 };
  }

  async listForHall(hallId: string, opts?: { limit?: number; offset?: number }): Promise<HallCashTransaction[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    return this.txs
      .filter((t) => t.hallId === hallId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit)
      .map((t) => ({ ...t }));
  }

  async listForSettlement(settlementId: string): Promise<HallCashTransaction[]> {
    return this.txs
      .filter((t) => t.settlementId === settlementId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((t) => ({ ...t }));
  }
}
