/**
 * Wireframe gaps #8/#10/#11 (2026-04-24): data layer for Unique ID cards.
 *
 * Pattern follows AgentTransactionStore: a thin store interface + Postgres
 * implementation + InMemory twin for unit tests. The service layer
 * (UniqueIdService) depends on the interface, not the concrete class.
 *
 * Append-only transaction log mirrors app_agent_transactions — balance
 * mutations always write a row to `app_unique_id_transactions` and the
 * current balance on `app_unique_ids` is advanced in the same pass.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type UniqueIdPaymentType = "CASH" | "CARD";
export type UniqueIdStatus = "ACTIVE" | "WITHDRAWN" | "REGENERATED" | "EXPIRED";
export type UniqueIdActionType =
  | "CREATE"
  | "ADD_MONEY"
  | "WITHDRAW"
  | "REPRINT"
  | "REGENERATE";

export interface UniqueIdCard {
  id: string;
  hallId: string;
  balanceCents: number;
  purchaseDate: string;
  expiryDate: string;
  hoursValidity: number;
  paymentType: UniqueIdPaymentType;
  createdByAgentId: string;
  printedAt: string;
  reprintedCount: number;
  lastReprintedAt: string | null;
  lastReprintedBy: string | null;
  status: UniqueIdStatus;
  regeneratedFromId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UniqueIdTransaction {
  id: string;
  uniqueId: string;
  actionType: UniqueIdActionType;
  amountCents: number;
  previousBalance: number;
  newBalance: number;
  paymentType: UniqueIdPaymentType | null;
  agentUserId: string;
  gameType: string | null;
  reason: string | null;
  createdAt: string;
}

export interface InsertUniqueIdInput {
  id: string;
  hallId: string;
  balanceCents: number;
  hoursValidity: number;
  paymentType: UniqueIdPaymentType;
  createdByAgentId: string;
  regeneratedFromId?: string | null;
}

export interface InsertUniqueIdTransactionInput {
  uniqueId: string;
  actionType: UniqueIdActionType;
  amountCents: number;
  previousBalance: number;
  newBalance: number;
  paymentType?: UniqueIdPaymentType | null;
  agentUserId: string;
  gameType?: string | null;
  reason?: string | null;
}

export interface UniqueIdListFilter {
  hallId?: string;
  status?: UniqueIdStatus;
  createdByAgentId?: string;
  limit?: number;
  offset?: number;
}

export interface UniqueIdStore {
  insertCard(input: InsertUniqueIdInput): Promise<UniqueIdCard>;
  getCardById(id: string): Promise<UniqueIdCard | null>;
  listCards(filter: UniqueIdListFilter): Promise<UniqueIdCard[]>;
  updateBalance(id: string, newBalance: number, status?: UniqueIdStatus): Promise<UniqueIdCard>;
  updateStatus(id: string, status: UniqueIdStatus): Promise<UniqueIdCard>;
  markReprinted(id: string, agentId: string): Promise<UniqueIdCard>;

  insertTransaction(input: InsertUniqueIdTransactionInput): Promise<UniqueIdTransaction>;
  listTransactions(uniqueId: string, limit?: number): Promise<UniqueIdTransaction[]>;
}

// ──────────────────────────────────────────────────────────────────────
// InMemory implementation — used by tests and the service when running
// without Postgres (e.g. dev mode). Behaviour must mirror Postgres exactly
// for the test-suite to reflect production.

interface MemCard extends UniqueIdCard {}

export class InMemoryUniqueIdStore implements UniqueIdStore {
  private readonly cards = new Map<string, MemCard>();
  private readonly transactions: UniqueIdTransaction[] = [];

  async insertCard(input: InsertUniqueIdInput): Promise<UniqueIdCard> {
    if (this.cards.has(input.id)) {
      const err = new Error("DUPLICATE_UNIQUE_ID") as Error & { code: string };
      err.code = "23505";
      throw err;
    }
    const now = new Date();
    const expiry = new Date(now.getTime() + input.hoursValidity * 60 * 60 * 1000);
    const card: MemCard = {
      id: input.id,
      hallId: input.hallId,
      balanceCents: input.balanceCents,
      purchaseDate: now.toISOString(),
      expiryDate: expiry.toISOString(),
      hoursValidity: input.hoursValidity,
      paymentType: input.paymentType,
      createdByAgentId: input.createdByAgentId,
      printedAt: now.toISOString(),
      reprintedCount: 0,
      lastReprintedAt: null,
      lastReprintedBy: null,
      status: "ACTIVE",
      regeneratedFromId: input.regeneratedFromId ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.cards.set(card.id, card);
    return { ...card };
  }

  async getCardById(id: string): Promise<UniqueIdCard | null> {
    const card = this.cards.get(id);
    return card ? { ...card } : null;
  }

  async listCards(filter: UniqueIdListFilter): Promise<UniqueIdCard[]> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    let rows = Array.from(this.cards.values());
    if (filter.hallId) rows = rows.filter((r) => r.hallId === filter.hallId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.createdByAgentId) rows = rows.filter((r) => r.createdByAgentId === filter.createdByAgentId);
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows.slice(offset, offset + limit).map((r) => ({ ...r }));
  }

  async updateBalance(id: string, newBalance: number, status?: UniqueIdStatus): Promise<UniqueIdCard> {
    const card = this.cards.get(id);
    if (!card) throw new Error("CARD_NOT_FOUND");
    card.balanceCents = newBalance;
    if (status) card.status = status;
    card.updatedAt = new Date().toISOString();
    return { ...card };
  }

  async updateStatus(id: string, status: UniqueIdStatus): Promise<UniqueIdCard> {
    const card = this.cards.get(id);
    if (!card) throw new Error("CARD_NOT_FOUND");
    card.status = status;
    card.updatedAt = new Date().toISOString();
    return { ...card };
  }

  async markReprinted(id: string, agentId: string): Promise<UniqueIdCard> {
    const card = this.cards.get(id);
    if (!card) throw new Error("CARD_NOT_FOUND");
    const now = new Date().toISOString();
    card.reprintedCount += 1;
    card.lastReprintedAt = now;
    card.lastReprintedBy = agentId;
    card.updatedAt = now;
    return { ...card };
  }

  async insertTransaction(input: InsertUniqueIdTransactionInput): Promise<UniqueIdTransaction> {
    const tx: UniqueIdTransaction = {
      id: randomUUID(),
      uniqueId: input.uniqueId,
      actionType: input.actionType,
      amountCents: input.amountCents,
      previousBalance: input.previousBalance,
      newBalance: input.newBalance,
      paymentType: input.paymentType ?? null,
      agentUserId: input.agentUserId,
      gameType: input.gameType ?? null,
      reason: input.reason ?? null,
      createdAt: new Date().toISOString(),
    };
    this.transactions.push(tx);
    return { ...tx };
  }

  async listTransactions(uniqueId: string, limit = 200): Promise<UniqueIdTransaction[]> {
    return this.transactions
      .filter((t) => t.uniqueId === uniqueId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }
}

// ──────────────────────────────────────────────────────────────────────
// Postgres implementation — mirrors the InMemory twin 1:1. Kept at the
// bottom since tests only import the InMemory variant.

export interface PostgresUniqueIdStoreOptions {
  pool: Pool;
  schema?: string;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class PostgresUniqueIdStore implements UniqueIdStore {
  private readonly pool: Pool;

  constructor(opts: PostgresUniqueIdStoreOptions) {
    this.pool = opts.pool;
  }

  async insertCard(input: InsertUniqueIdInput): Promise<UniqueIdCard> {
    // P0-4 (BIN-pilot 2026-05-01): bind `hours_validity` som TEXT for
    // `($4 || ' hours')::interval`-konstruksjonen. Hvis verdien sendes som
    // raw JS `number`, binder `node-postgres` parameteren som integer, og
    // PostgreSQL kaster `operator does not exist: integer || unknown` på
    // konkateneringen — noe som blir til `INTERNAL_ERROR — "Uventet feil i
    // server."` mot klienten (apiFailure → toPublicError fanger ikke det
    // som DomainError). Samme mønster som SwedbankPayService.ts:666,
    // swedbankPaymentSync.ts:61, Game1TransferHallService.ts:319 og
    // bankIdExpiryReminder.ts:92,103 som alle bruker `String(...)`. Vi
    // caster tilbake til INTEGER i SQL for `hours_validity`-kolonnen som
    // har INTEGER-type i schemaet.
    const hoursText = String(input.hoursValidity);
    const result = await this.pool.query<{
      id: string;
      hall_id: string;
      balance_cents: string;
      purchase_date: Date;
      expiry_date: Date;
      hours_validity: number;
      payment_type: UniqueIdPaymentType;
      created_by_agent_id: string;
      printed_at: Date;
      reprinted_count: number;
      last_reprinted_at: Date | null;
      last_reprinted_by: string | null;
      status: UniqueIdStatus;
      regenerated_from_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO app_unique_ids (
         id, hall_id, balance_cents, purchase_date, expiry_date, hours_validity,
         payment_type, created_by_agent_id, printed_at, reprinted_count, status,
         regenerated_from_id
       ) VALUES (
         $1, $2, $3, now(), now() + ($4 || ' hours')::interval, $4::int, $5, $6, now(), 0, 'ACTIVE', $7
       ) RETURNING *`,
      [
        input.id,
        input.hallId,
        input.balanceCents,
        hoursText,
        input.paymentType,
        input.createdByAgentId,
        input.regeneratedFromId ?? null,
      ]
    );
    return this.rowToCard(result.rows[0]!);
  }

  async getCardById(id: string): Promise<UniqueIdCard | null> {
    const r = await this.pool.query(`SELECT * FROM app_unique_ids WHERE id = $1`, [id]);
    return r.rows[0] ? this.rowToCard(r.rows[0]) : null;
  }

  async listCards(filter: UniqueIdListFilter): Promise<UniqueIdCard[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter.hallId) { conds.push(`hall_id = $${params.length + 1}`); params.push(filter.hallId); }
    if (filter.status) { conds.push(`status = $${params.length + 1}`); params.push(filter.status); }
    if (filter.createdByAgentId) { conds.push(`created_by_agent_id = $${params.length + 1}`); params.push(filter.createdByAgentId); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    params.push(limit, offset);
    const r = await this.pool.query(
      `SELECT * FROM app_unique_ids ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows.map((row) => this.rowToCard(row));
  }

  async updateBalance(id: string, newBalance: number, status?: UniqueIdStatus): Promise<UniqueIdCard> {
    const r = await this.pool.query(
      status
        ? `UPDATE app_unique_ids SET balance_cents = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *`
        : `UPDATE app_unique_ids SET balance_cents = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      status ? [newBalance, status, id] : [newBalance, id]
    );
    if (!r.rows[0]) throw new Error("CARD_NOT_FOUND");
    return this.rowToCard(r.rows[0]);
  }

  async updateStatus(id: string, status: UniqueIdStatus): Promise<UniqueIdCard> {
    const r = await this.pool.query(
      `UPDATE app_unique_ids SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!r.rows[0]) throw new Error("CARD_NOT_FOUND");
    return this.rowToCard(r.rows[0]);
  }

  async markReprinted(id: string, agentId: string): Promise<UniqueIdCard> {
    const r = await this.pool.query(
      `UPDATE app_unique_ids
         SET reprinted_count = reprinted_count + 1,
             last_reprinted_at = now(),
             last_reprinted_by = $1,
             updated_at = now()
       WHERE id = $2 RETURNING *`,
      [agentId, id]
    );
    if (!r.rows[0]) throw new Error("CARD_NOT_FOUND");
    return this.rowToCard(r.rows[0]);
  }

  async insertTransaction(input: InsertUniqueIdTransactionInput): Promise<UniqueIdTransaction> {
    const id = randomUUID();
    const r = await this.pool.query(
      `INSERT INTO app_unique_id_transactions (
        id, unique_id, action_type, amount_cents, previous_balance, new_balance,
        payment_type, agent_user_id, game_type, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        id,
        input.uniqueId,
        input.actionType,
        input.amountCents,
        input.previousBalance,
        input.newBalance,
        input.paymentType ?? null,
        input.agentUserId,
        input.gameType ?? null,
        input.reason ?? null,
      ]
    );
    return this.rowToTx(r.rows[0]);
  }

  async listTransactions(uniqueId: string, limit = 200): Promise<UniqueIdTransaction[]> {
    const r = await this.pool.query(
      `SELECT * FROM app_unique_id_transactions WHERE unique_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [uniqueId, limit]
    );
    return r.rows.map((row) => this.rowToTx(row));
  }

  private rowToCard(row: Record<string, unknown>): UniqueIdCard {
    return {
      id: row.id as string,
      hallId: row.hall_id as string,
      balanceCents: Number(row.balance_cents),
      purchaseDate: isoDate(row.purchase_date as Date | string),
      expiryDate: isoDate(row.expiry_date as Date | string),
      hoursValidity: Number(row.hours_validity),
      paymentType: row.payment_type as UniqueIdPaymentType,
      createdByAgentId: row.created_by_agent_id as string,
      printedAt: isoDate(row.printed_at as Date | string),
      reprintedCount: Number(row.reprinted_count),
      lastReprintedAt: row.last_reprinted_at ? isoDate(row.last_reprinted_at as Date | string) : null,
      lastReprintedBy: (row.last_reprinted_by as string | null) ?? null,
      status: row.status as UniqueIdStatus,
      regeneratedFromId: (row.regenerated_from_id as string | null) ?? null,
      createdAt: isoDate(row.created_at as Date | string),
      updatedAt: isoDate(row.updated_at as Date | string),
    };
  }

  private rowToTx(row: Record<string, unknown>): UniqueIdTransaction {
    return {
      id: row.id as string,
      uniqueId: row.unique_id as string,
      actionType: row.action_type as UniqueIdActionType,
      amountCents: Number(row.amount_cents),
      previousBalance: Number(row.previous_balance),
      newBalance: Number(row.new_balance),
      paymentType: (row.payment_type as UniqueIdPaymentType | null) ?? null,
      agentUserId: row.agent_user_id as string,
      gameType: (row.game_type as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      createdAt: isoDate(row.created_at as Date | string),
    };
  }
}
