/**
 * BIN-583 B3.1: Postgres access layer for AGENT users + shifts.
 *
 * Pattern follows PostgresAuditLogStore / ChatMessageStore: thin wrapper
 * over pg Pool with an in-memory twin for tests. Services depend on the
 * AgentStore interface, not the Postgres class directly.
 *
 * Scope: agent-profile extensions on app_users, m:n on app_agent_halls,
 * shift lifecycle on app_agent_shifts. Cash-column mutations (B3.2/B3.3)
 * land in separate store-methods later.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type AgentLanguage = string;
export type AgentStatus = "active" | "inactive";

export interface AgentHallAssignment {
  userId: string;
  hallId: string;
  isPrimary: boolean;
  assignedAt: string;
  assignedByUserId: string | null;
}

export interface AgentProfile {
  userId: string;
  email: string;
  displayName: string;
  surname: string | null;
  phone: string | null;
  role: "AGENT";
  agentStatus: AgentStatus;
  language: AgentLanguage;
  avatarFilename: string | null;
  parentUserId: string | null;
  halls: AgentHallAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentListFilter {
  hallId?: string;
  status?: AgentStatus;
  limit?: number;
  offset?: number;
}

export interface AgentShift {
  id: string;
  userId: string;
  hallId: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  isLoggedOut: boolean;
  isDailyBalanceTransferred: boolean;

  // B3.2/B3.3 populated — exposed for read so admin can inspect:
  dailyBalance: number;
  totalDailyBalanceIn: number;
  totalCashIn: number;
  totalCashOut: number;
  totalCardIn: number;
  totalCardOut: number;
  sellingByCustomerNumber: number;
  hallCashBalance: number;
  hallDropsafeBalance: number;
  dailyDifference: number;
  controlDailyBalance: Record<string, unknown>;
  settlement: Record<string, unknown>;
  previousSettlement: Record<string, unknown>;

  // BIN-583 B3.3: settlement freeze-flag.
  settledAt: string | null;
  settledByUserId: string | null;

  // Wireframe Gap #9: Shift Log Out-flagg satt fra agent-popup.
  distributedWinnings: boolean;
  transferredRegisterTickets: boolean;
  logoutNotes: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Wireframe Gap #9: Flags til store.endShift — opt-in logout-handlinger. */
export interface EndShiftFlags {
  distributeWinnings?: boolean;
  transferRegisterTickets?: boolean;
  logoutNotes?: string | null;
}

export interface StartShiftInput {
  userId: string;
  hallId: string;
}

export interface AgentStore {
  // Profile ──
  getAgentById(userId: string): Promise<AgentProfile | null>;
  getAgentByEmail(email: string): Promise<AgentProfile | null>;
  listAgents(filter?: AgentListFilter): Promise<AgentProfile[]>;
  createAgentProfile(input: {
    userId: string;
    language?: AgentLanguage;
    parentUserId?: string | null;
    agentStatus?: AgentStatus;
  }): Promise<void>;
  updateAgentProfile(userId: string, patch: {
    displayName?: string;
    email?: string;
    phone?: string | null;
    language?: AgentLanguage;
    avatarFilename?: string | null;
    agentStatus?: AgentStatus;
    parentUserId?: string | null;
  }): Promise<AgentProfile>;

  // Hall assignment ──
  assignHall(input: {
    userId: string;
    hallId: string;
    isPrimary?: boolean;
    assignedByUserId?: string | null;
  }): Promise<void>;
  unassignHall(userId: string, hallId: string): Promise<void>;
  setPrimaryHall(userId: string, hallId: string): Promise<void>;
  listAssignedHalls(userId: string): Promise<AgentHallAssignment[]>;
  hasHallAssignment(userId: string, hallId: string): Promise<boolean>;

  // Shift ──
  insertShift(input: StartShiftInput): Promise<AgentShift>;
  /**
   * Avslutter aktiv shift.
   * Wireframe Gap #9: `flags` er valgfri; uten flags = legacy-oppførsel.
   */
  endShift(shiftId: string, flags?: EndShiftFlags): Promise<AgentShift>;
  getActiveShiftForUser(userId: string): Promise<AgentShift | null>;
  getShiftById(shiftId: string): Promise<AgentShift | null>;
  listShiftsForUser(userId: string, limit?: number, offset?: number): Promise<AgentShift[]>;
  listActiveShiftsForHall(hallId: string): Promise<AgentShift[]>;

  /**
   * BIN-583 B3.2: atomic mutation of shift cash-columns during cash-ops.
   * Deltas are signed (cash-in is positive, cash-out is negative). Must be
   * called inside the same DB transaction as the transaction-row insert.
   */
  applyShiftCashDelta(shiftId: string, delta: ShiftCashDelta, client?: PoolClient): Promise<AgentShift>;
  /**
   * BIN-PILOT-K1 (Code Review #1 P0-1): kjør callback i en delt PG-tx slik
   * at cross-store atomicity oppnås (applyShiftCashDelta + insertIdempotent
   * i samme BEGIN/COMMIT). In-memory-impl kjører callback med null-client
   * (single-threaded JS, ingen tx-grenser) — service-laget skal være
   * tolerant for null.
   */
  runInTransaction<T>(callback: (client: PoolClient | null) => Promise<T>): Promise<T>;

  /**
   * BIN-583 B3.3: skriv control_daily_balance JSONB med agent's reported
   * sjekk. Kan kalles flere ganger — overskriver sist kjøring.
   */
  setShiftControlDailyBalance(shiftId: string, payload: Record<string, unknown>): Promise<AgentShift>;

  /**
   * BIN-583 B3.3: marker shift som settled (close-day fullført). Etter
   * dette nekter AgentTransactionService alle mutation-paths med
   * SHIFT_SETTLED. Idempotent feiler hvis allerede settled.
   *
   * HV-9 (audit §3.9): tar valgfri `client?` slik at caller kan binde
   * UPDATE-en til samme PG-tx som settlement-INSERT + hall-cash-applies.
   * Uten dette ville et crash midt i closeDay etterlate shift settled
   * uten settlement-rad og uten cash-bevegelse.
   *
   * Pilot-day-fix 2026-05-01: tar valgfri `flags?` slik at close-day kan
   * sette distributed_winnings / transferred_register_tickets / logout_notes
   * atomisk sammen med settled_at. Tidligere gjorde route-laget en separat
   * /shift/logout etter close-day, men det er ugjørbart — markShiftSettled
   * setter is_active=false så endShift feiler etterpå.
   */
  markShiftSettled(
    shiftId: string,
    settledByUserId: string,
    client?: PoolClient,
    flags?: EndShiftFlags,
  ): Promise<AgentShift>;
}

export interface ShiftCashDelta {
  totalCashIn?: number;
  totalCashOut?: number;
  totalCardIn?: number;
  totalCardOut?: number;
  dailyBalance?: number;
  sellingByCustomerNumber?: number;
}

// ── Postgres implementation ─────────────────────────────────────────────────

interface AgentRow {
  id: string;
  email: string;
  display_name: string;
  surname: string | null;
  phone: string | null;
  role: string;
  agent_status: AgentStatus;
  language: string;
  avatar_filename: string | null;
  parent_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AgentHallRow {
  user_id: string;
  hall_id: string;
  is_primary: boolean;
  assigned_at: Date | string;
  assigned_by_user_id: string | null;
}

interface ShiftRow {
  id: string;
  user_id: string;
  hall_id: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  is_active: boolean;
  is_logged_out: boolean;
  is_daily_balance_transferred: boolean;
  daily_balance: string | number;
  total_daily_balance_in: string | number;
  total_cash_in: string | number;
  total_cash_out: string | number;
  total_card_in: string | number;
  total_card_out: string | number;
  selling_by_customer_number: number;
  hall_cash_balance: string | number;
  hall_dropsafe_balance: string | number;
  daily_difference: string | number;
  control_daily_balance: unknown;
  settlement: unknown;
  previous_settlement: unknown;
  settled_at: Date | string | null;
  settled_by_user_id: string | null;
  // Wireframe Gap #9:
  distributed_winnings: boolean | null;
  transferred_register_tickets: boolean | null;
  logout_notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
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

export interface PostgresAgentStoreOptions {
  pool: Pool;
  schema?: string;
}

export class PostgresAgentStore implements AgentStore {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: PostgresAgentStoreOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
    this.schema = schema;
  }

  private users(): string { return `"${this.schema}"."app_users"`; }
  private halls(): string { return `"${this.schema}"."app_agent_halls"`; }
  private shifts(): string { return `"${this.schema}"."app_agent_shifts"`; }

  async getAgentById(userId: string): Promise<AgentProfile | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `SELECT id, email, display_name, surname, phone, role, agent_status, language,
              avatar_filename, parent_user_id, created_at, updated_at
       FROM ${this.users()}
       WHERE id = $1 AND role = 'AGENT' AND deleted_at IS NULL`,
      [userId]
    );
    const row = rows[0];
    if (!row) return null;
    const halls = await this.listAssignedHalls(row.id);
    return this.mapProfile(row, halls);
  }

  async getAgentByEmail(email: string): Promise<AgentProfile | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `SELECT id, email, display_name, surname, phone, role, agent_status, language,
              avatar_filename, parent_user_id, created_at, updated_at
       FROM ${this.users()}
       WHERE LOWER(email) = LOWER($1) AND role = 'AGENT' AND deleted_at IS NULL`,
      [email]
    );
    const row = rows[0];
    if (!row) return null;
    const halls = await this.listAssignedHalls(row.id);
    return this.mapProfile(row, halls);
  }

  async listAgents(filter: AgentListFilter = {}): Promise<AgentProfile[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    const where: string[] = [`u.role = 'AGENT'`, `u.deleted_at IS NULL`];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`u.agent_status = $${params.length}`);
    }
    let sql: string;
    if (filter.hallId) {
      params.push(filter.hallId);
      const p = params.length;
      sql = `SELECT DISTINCT u.id, u.email, u.display_name, u.surname, u.phone, u.role,
                     u.agent_status, u.language, u.avatar_filename, u.parent_user_id,
                     u.created_at, u.updated_at
             FROM ${this.users()} u
             JOIN ${this.halls()} h ON h.user_id = u.id
             WHERE ${where.join(" AND ")} AND h.hall_id = $${p}
             ORDER BY u.display_name ASC
             LIMIT ${limit} OFFSET ${offset}`;
    } else {
      sql = `SELECT u.id, u.email, u.display_name, u.surname, u.phone, u.role,
                    u.agent_status, u.language, u.avatar_filename, u.parent_user_id,
                    u.created_at, u.updated_at
             FROM ${this.users()} u
             WHERE ${where.join(" AND ")}
             ORDER BY u.display_name ASC
             LIMIT ${limit} OFFSET ${offset}`;
    }
    const { rows } = await this.pool.query<AgentRow>(sql, params);
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.id);
    const hallsByUser = await this.loadHallsForUsers(userIds);
    return rows.map((r) => this.mapProfile(r, hallsByUser.get(r.id) ?? []));
  }

  async createAgentProfile(input: {
    userId: string;
    language?: string;
    parentUserId?: string | null;
    agentStatus?: AgentStatus;
  }): Promise<void> {
    // Agent profile extensions (language/status/parent) are columns on
    // app_users — row is already created by PlatformService.register or
    // an admin-controlled INSERT. This just patches the extension fields
    // for agents that didn't go through the standard register-flow.
    await this.pool.query(
      `UPDATE ${this.users()}
       SET language       = COALESCE($2, language),
           parent_user_id = $3,
           agent_status   = COALESCE($4, agent_status),
           updated_at     = now()
       WHERE id = $1 AND role = 'AGENT'`,
      [
        input.userId,
        input.language ?? null,
        input.parentUserId ?? null,
        input.agentStatus ?? null
      ]
    );
  }

  async updateAgentProfile(userId: string, patch: {
    displayName?: string;
    email?: string;
    phone?: string | null;
    language?: string;
    avatarFilename?: string | null;
    agentStatus?: AgentStatus;
    parentUserId?: string | null;
  }): Promise<AgentProfile> {
    const sets: string[] = [];
    const params: unknown[] = [];
    function setField(column: string, value: unknown): void {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (patch.displayName !== undefined) setField("display_name", patch.displayName);
    if (patch.email !== undefined) setField("email", patch.email);
    if (patch.phone !== undefined) setField("phone", patch.phone);
    if (patch.language !== undefined) setField("language", patch.language);
    if (patch.avatarFilename !== undefined) setField("avatar_filename", patch.avatarFilename);
    if (patch.agentStatus !== undefined) setField("agent_status", patch.agentStatus);
    if (patch.parentUserId !== undefined) setField("parent_user_id", patch.parentUserId);
    if (sets.length === 0) {
      const existing = await this.getAgentById(userId);
      if (!existing) throw new Error("[BIN-583] agent not found");
      return existing;
    }
    params.push(userId);
    await this.pool.query(
      `UPDATE ${this.users()}
       SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${params.length} AND role = 'AGENT'`,
      params
    );
    const updated = await this.getAgentById(userId);
    if (!updated) throw new Error("[BIN-583] agent not found after update");
    return updated;
  }

  async assignHall(input: {
    userId: string;
    hallId: string;
    isPrimary?: boolean;
    assignedByUserId?: string | null;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.isPrimary) {
        // Drop any previous primary for this user to honour partial unique-index.
        await client.query(
          `UPDATE ${this.halls()} SET is_primary = false WHERE user_id = $1 AND is_primary`,
          [input.userId]
        );
      }
      await client.query(
        `INSERT INTO ${this.halls()} (user_id, hall_id, is_primary, assigned_by_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, hall_id) DO UPDATE
           SET is_primary = EXCLUDED.is_primary,
               assigned_by_user_id = EXCLUDED.assigned_by_user_id`,
        [input.userId, input.hallId, input.isPrimary ?? false, input.assignedByUserId ?? null]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async unassignHall(userId: string, hallId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.halls()} WHERE user_id = $1 AND hall_id = $2`,
      [userId, hallId]
    );
  }

  async setPrimaryHall(userId: string, hallId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ${this.halls()} SET is_primary = false WHERE user_id = $1 AND is_primary`,
        [userId]
      );
      const { rowCount } = await client.query(
        `UPDATE ${this.halls()} SET is_primary = true WHERE user_id = $1 AND hall_id = $2`,
        [userId, hallId]
      );
      if (rowCount === 0) {
        throw new Error("[BIN-583] hall not assigned to agent");
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listAssignedHalls(userId: string): Promise<AgentHallAssignment[]> {
    const { rows } = await this.pool.query<AgentHallRow>(
      `SELECT user_id, hall_id, is_primary, assigned_at, assigned_by_user_id
       FROM ${this.halls()}
       WHERE user_id = $1
       ORDER BY is_primary DESC, assigned_at ASC`,
      [userId]
    );
    return rows.map((r) => this.mapHall(r));
  }

  async hasHallAssignment(userId: string, hallId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ${this.halls()} WHERE user_id = $1 AND hall_id = $2
       ) AS exists`,
      [userId, hallId]
    );
    return Boolean(rows[0]?.exists);
  }

  private async loadHallsForUsers(userIds: string[]): Promise<Map<string, AgentHallAssignment[]>> {
    if (userIds.length === 0) return new Map();
    const { rows } = await this.pool.query<AgentHallRow>(
      `SELECT user_id, hall_id, is_primary, assigned_at, assigned_by_user_id
       FROM ${this.halls()}
       WHERE user_id = ANY($1::text[])
       ORDER BY user_id, is_primary DESC, assigned_at ASC`,
      [userIds]
    );
    const map = new Map<string, AgentHallAssignment[]>();
    for (const r of rows) {
      const list = map.get(r.user_id) ?? [];
      list.push(this.mapHall(r));
      map.set(r.user_id, list);
    }
    return map;
  }

  async insertShift(input: StartShiftInput): Promise<AgentShift> {
    const id = `shift-${randomUUID()}`;
    const { rows } = await this.pool.query<ShiftRow>(
      `INSERT INTO ${this.shifts()} (id, user_id, hall_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, input.userId, input.hallId]
    );
    return this.mapShift(rows[0]!);
  }

  async endShift(shiftId: string, flags?: EndShiftFlags): Promise<AgentShift> {
    // Wireframe Gap #9: Logout-flagg + notes er valgfri; uten flags
    // overskriver vi ikke eksisterende verdier (default = false fra DB).
    const sets: string[] = [
      "is_active = false",
      "is_logged_out = true",
      "ended_at = now()",
      "updated_at = now()",
    ];
    const params: unknown[] = [];
    if (flags?.distributeWinnings !== undefined) {
      params.push(flags.distributeWinnings);
      sets.push(`distributed_winnings = $${params.length + 1}`);
    }
    if (flags?.transferRegisterTickets !== undefined) {
      params.push(flags.transferRegisterTickets);
      sets.push(`transferred_register_tickets = $${params.length + 1}`);
    }
    if (flags?.logoutNotes !== undefined) {
      params.push(flags.logoutNotes);
      sets.push(`logout_notes = $${params.length + 1}`);
    }
    const sql = `UPDATE ${this.shifts()}
       SET ${sets.join(", ")}
       WHERE id = $1 AND is_active
       RETURNING *`;
    const { rows } = await this.pool.query<ShiftRow>(sql, [shiftId, ...params]);
    const row = rows[0];
    if (!row) throw new Error("[BIN-583] shift not found or already ended");
    return this.mapShift(row);
  }

  async getActiveShiftForUser(userId: string): Promise<AgentShift | null> {
    const { rows } = await this.pool.query<ShiftRow>(
      `SELECT * FROM ${this.shifts()}
       WHERE user_id = $1 AND is_active
       LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    return row ? this.mapShift(row) : null;
  }

  async getShiftById(shiftId: string): Promise<AgentShift | null> {
    const { rows } = await this.pool.query<ShiftRow>(
      `SELECT * FROM ${this.shifts()} WHERE id = $1`,
      [shiftId]
    );
    const row = rows[0];
    return row ? this.mapShift(row) : null;
  }

  async listShiftsForUser(userId: string, limit = 50, offset = 0): Promise<AgentShift[]> {
    const cappedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const cappedOffset = Math.max(0, Math.floor(offset));
    const { rows } = await this.pool.query<ShiftRow>(
      `SELECT * FROM ${this.shifts()}
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT ${cappedLimit} OFFSET ${cappedOffset}`,
      [userId]
    );
    return rows.map((r) => this.mapShift(r));
  }

  async listActiveShiftsForHall(hallId: string): Promise<AgentShift[]> {
    const { rows } = await this.pool.query<ShiftRow>(
      `SELECT * FROM ${this.shifts()}
       WHERE hall_id = $1 AND is_active
       ORDER BY started_at DESC`,
      [hallId]
    );
    return rows.map((r) => this.mapShift(r));
  }

  async applyShiftCashDelta(
    shiftId: string,
    delta: ShiftCashDelta,
    client?: PoolClient,
  ): Promise<AgentShift> {
    // BIN-PILOT-K1: optional `client` lar caller binde UPDATE-en til samme
    // tx som `agentTransactionStore.insertIdempotent(... , client)`.
    const exec = client ?? this.pool;
    // Bygg UPDATE-setning dynamisk basert på hvilke felter som er med.
    const sets: string[] = [];
    const params: unknown[] = [];
    function addDelta(col: string, value: number | undefined): void {
      if (value === undefined || value === 0) return;
      params.push(value);
      sets.push(`${col} = ${col} + $${params.length}`);
    }
    addDelta("total_cash_in", delta.totalCashIn);
    addDelta("total_cash_out", delta.totalCashOut);
    addDelta("total_card_in", delta.totalCardIn);
    addDelta("total_card_out", delta.totalCardOut);
    addDelta("daily_balance", delta.dailyBalance);
    addDelta("selling_by_customer_number", delta.sellingByCustomerNumber);
    if (sets.length === 0) {
      const { rows: noopRows } = await exec.query<ShiftRow>(
        `SELECT * FROM ${this.shifts()} WHERE id = $1`,
        [shiftId]
      );
      if (!noopRows[0]) throw new Error("[BIN-583] shift not found");
      return this.mapShift(noopRows[0]);
    }
    params.push(shiftId);
    const { rows } = await exec.query<ShiftRow>(
      `UPDATE ${this.shifts()}
       SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    if (!rows[0]) throw new Error("[BIN-583] shift not found");
    return this.mapShift(rows[0]);
  }

  /**
   * BIN-PILOT-K1: kjør callback i en delt PG-tx (BEGIN/COMMIT/ROLLBACK).
   * Caller skal videreformidle den passerte client-en til alle store-
   * metoder som tar `client?` for å oppnå atomicity.
   */
  async runInTransaction<T>(callback: (client: PoolClient | null) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // best-effort rollback
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async setShiftControlDailyBalance(shiftId: string, payload: Record<string, unknown>): Promise<AgentShift> {
    const { rows } = await this.pool.query<ShiftRow>(
      `UPDATE ${this.shifts()}
       SET control_daily_balance = $2::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [shiftId, JSON.stringify(payload)]
    );
    if (!rows[0]) throw new Error("[BIN-583] shift not found");
    return this.mapShift(rows[0]);
  }

  async markShiftSettled(
    shiftId: string,
    settledByUserId: string,
    client?: PoolClient,
    flags?: EndShiftFlags,
  ): Promise<AgentShift> {
    // HV-9: optional `client` lar closeDay binde UPDATE til samme tx som
    // settlement-INSERT + hall-cash-applies (atomic close-day).
    const exec = client ?? this.pool;
    // Pilot-day-fix 2026-05-01: bygg dynamisk SET-liste for å støtte
    // valgfri flags fra logout-popup (Wireframe Gap #9 17.6) atomisk i
    // samme close-day-tx.
    const sets: string[] = [
      "settled_at = now()",
      "settled_by_user_id = $2",
      "is_active = false",
      "is_logged_out = true",
      "is_daily_balance_transferred = true",
      "ended_at = COALESCE(ended_at, now())",
      "updated_at = now()",
    ];
    const params: unknown[] = [shiftId, settledByUserId];
    if (flags?.distributeWinnings !== undefined) {
      params.push(flags.distributeWinnings);
      sets.push(`distributed_winnings = $${params.length}`);
    }
    if (flags?.transferRegisterTickets !== undefined) {
      params.push(flags.transferRegisterTickets);
      sets.push(`transferred_register_tickets = $${params.length}`);
    }
    if (flags?.logoutNotes !== undefined) {
      params.push(flags.logoutNotes);
      sets.push(`logout_notes = $${params.length}`);
    }
    const { rows } = await exec.query<ShiftRow>(
      `UPDATE ${this.shifts()}
       SET ${sets.join(", ")}
       WHERE id = $1 AND settled_at IS NULL
       RETURNING *`,
      params
    );
    if (!rows[0]) {
      // Either shift not found or already settled — caller-distinguishes via getShiftById.
      const existing = await this.getShiftById(shiftId);
      if (!existing) throw new Error("[BIN-583] shift not found");
      throw new Error("[BIN-583] shift already settled");
    }
    return this.mapShift(rows[0]);
  }

  private mapProfile(row: AgentRow, halls: AgentHallAssignment[]): AgentProfile {
    return {
      userId: row.id,
      email: row.email,
      displayName: row.display_name,
      surname: row.surname,
      phone: row.phone,
      role: "AGENT",
      agentStatus: row.agent_status,
      language: row.language,
      avatarFilename: row.avatar_filename,
      parentUserId: row.parent_user_id,
      halls,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapHall(row: AgentHallRow): AgentHallAssignment {
    return {
      userId: row.user_id,
      hallId: row.hall_id,
      isPrimary: row.is_primary,
      assignedAt: asIso(row.assigned_at),
      assignedByUserId: row.assigned_by_user_id
    };
  }

  private mapShift(row: ShiftRow): AgentShift {
    return {
      id: row.id,
      userId: row.user_id,
      hallId: row.hall_id,
      startedAt: asIso(row.started_at),
      endedAt: row.ended_at ? asIso(row.ended_at) : null,
      isActive: row.is_active,
      isLoggedOut: row.is_logged_out,
      isDailyBalanceTransferred: row.is_daily_balance_transferred,
      dailyBalance: asNumber(row.daily_balance),
      totalDailyBalanceIn: asNumber(row.total_daily_balance_in),
      totalCashIn: asNumber(row.total_cash_in),
      totalCashOut: asNumber(row.total_cash_out),
      totalCardIn: asNumber(row.total_card_in),
      totalCardOut: asNumber(row.total_card_out),
      sellingByCustomerNumber: row.selling_by_customer_number,
      hallCashBalance: asNumber(row.hall_cash_balance),
      hallDropsafeBalance: asNumber(row.hall_dropsafe_balance),
      dailyDifference: asNumber(row.daily_difference),
      controlDailyBalance: asJsonObject(row.control_daily_balance),
      settlement: asJsonObject(row.settlement),
      previousSettlement: asJsonObject(row.previous_settlement),
      settledAt: row.settled_at ? asIso(row.settled_at) : null,
      settledByUserId: row.settled_by_user_id,
      distributedWinnings: Boolean(row.distributed_winnings),
      transferredRegisterTickets: Boolean(row.transferred_register_tickets),
      logoutNotes: row.logout_notes,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }
}

// ── In-memory implementation (tests) ────────────────────────────────────────

interface MemAgentRow {
  userId: string;
  email: string;
  displayName: string;
  surname: string | null;
  phone: string | null;
  agentStatus: AgentStatus;
  language: string;
  avatarFilename: string | null;
  parentUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class InMemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, MemAgentRow>();
  private readonly halls: AgentHallAssignment[] = [];
  private readonly shifts = new Map<string, AgentShift>();

  /** Test helper — seed an agent row without going through PlatformService. */
  seedAgent(input: {
    userId: string;
    email: string;
    displayName: string;
    surname?: string;
    phone?: string;
    language?: string;
    agentStatus?: AgentStatus;
    parentUserId?: string | null;
    avatarFilename?: string | null;
  }): void {
    const now = new Date().toISOString();
    this.agents.set(input.userId, {
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
      surname: input.surname ?? null,
      phone: input.phone ?? null,
      agentStatus: input.agentStatus ?? "active",
      language: input.language ?? "nb",
      avatarFilename: input.avatarFilename ?? null,
      parentUserId: input.parentUserId ?? null,
      createdAt: now,
      updatedAt: now
    });
  }

  async getAgentById(userId: string): Promise<AgentProfile | null> {
    const row = this.agents.get(userId);
    if (!row) return null;
    return this.toProfile(row);
  }

  async getAgentByEmail(email: string): Promise<AgentProfile | null> {
    const lower = email.toLowerCase();
    for (const row of this.agents.values()) {
      if (row.email.toLowerCase() === lower) {
        return this.toProfile(row);
      }
    }
    return null;
  }

  async listAgents(filter: AgentListFilter = {}): Promise<AgentProfile[]> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    let rows = Array.from(this.agents.values());
    if (filter.status) {
      rows = rows.filter((r) => r.agentStatus === filter.status);
    }
    if (filter.hallId) {
      const allowed = new Set(
        this.halls.filter((h) => h.hallId === filter.hallId).map((h) => h.userId)
      );
      rows = rows.filter((r) => allowed.has(r.userId));
    }
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return rows.slice(offset, offset + limit).map((r) => this.toProfile(r));
  }

  async createAgentProfile(input: {
    userId: string;
    language?: string;
    parentUserId?: string | null;
    agentStatus?: AgentStatus;
  }): Promise<void> {
    const row = this.agents.get(input.userId);
    if (!row) return;
    if (input.language !== undefined) row.language = input.language;
    if (input.parentUserId !== undefined) row.parentUserId = input.parentUserId;
    if (input.agentStatus !== undefined) row.agentStatus = input.agentStatus;
    row.updatedAt = new Date().toISOString();
  }

  async updateAgentProfile(userId: string, patch: {
    displayName?: string;
    email?: string;
    phone?: string | null;
    language?: string;
    avatarFilename?: string | null;
    agentStatus?: AgentStatus;
    parentUserId?: string | null;
  }): Promise<AgentProfile> {
    const row = this.agents.get(userId);
    if (!row) throw new Error("[BIN-583] agent not found");
    if (patch.displayName !== undefined) row.displayName = patch.displayName;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.language !== undefined) row.language = patch.language;
    if (patch.avatarFilename !== undefined) row.avatarFilename = patch.avatarFilename;
    if (patch.agentStatus !== undefined) row.agentStatus = patch.agentStatus;
    if (patch.parentUserId !== undefined) row.parentUserId = patch.parentUserId;
    row.updatedAt = new Date().toISOString();
    return this.toProfile(row);
  }

  async assignHall(input: {
    userId: string;
    hallId: string;
    isPrimary?: boolean;
    assignedByUserId?: string | null;
  }): Promise<void> {
    if (input.isPrimary) {
      for (const h of this.halls) {
        if (h.userId === input.userId) h.isPrimary = false;
      }
    }
    const existing = this.halls.find((h) => h.userId === input.userId && h.hallId === input.hallId);
    if (existing) {
      existing.isPrimary = input.isPrimary ?? existing.isPrimary;
      existing.assignedByUserId = input.assignedByUserId ?? existing.assignedByUserId;
      return;
    }
    this.halls.push({
      userId: input.userId,
      hallId: input.hallId,
      isPrimary: input.isPrimary ?? false,
      assignedAt: new Date().toISOString(),
      assignedByUserId: input.assignedByUserId ?? null
    });
  }

  async unassignHall(userId: string, hallId: string): Promise<void> {
    const idx = this.halls.findIndex((h) => h.userId === userId && h.hallId === hallId);
    if (idx >= 0) this.halls.splice(idx, 1);
  }

  async setPrimaryHall(userId: string, hallId: string): Promise<void> {
    const target = this.halls.find((h) => h.userId === userId && h.hallId === hallId);
    if (!target) throw new Error("[BIN-583] hall not assigned to agent");
    for (const h of this.halls) {
      if (h.userId === userId) h.isPrimary = false;
    }
    target.isPrimary = true;
  }

  async listAssignedHalls(userId: string): Promise<AgentHallAssignment[]> {
    return this.halls
      .filter((h) => h.userId === userId)
      .sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1))
      .map((h) => ({ ...h }));
  }

  async hasHallAssignment(userId: string, hallId: string): Promise<boolean> {
    return this.halls.some((h) => h.userId === userId && h.hallId === hallId);
  }

  async insertShift(input: StartShiftInput): Promise<AgentShift> {
    // Enforce partial unique-index logic.
    for (const s of this.shifts.values()) {
      if (s.userId === input.userId && s.isActive) {
        throw new Error("[BIN-583] user already has an active shift");
      }
    }
    const id = `shift-${randomUUID()}`;
    const now = new Date().toISOString();
    const shift: AgentShift = {
      id,
      userId: input.userId,
      hallId: input.hallId,
      startedAt: now,
      endedAt: null,
      isActive: true,
      isLoggedOut: false,
      isDailyBalanceTransferred: false,
      dailyBalance: 0,
      totalDailyBalanceIn: 0,
      totalCashIn: 0,
      totalCashOut: 0,
      totalCardIn: 0,
      totalCardOut: 0,
      sellingByCustomerNumber: 0,
      hallCashBalance: 0,
      hallDropsafeBalance: 0,
      dailyDifference: 0,
      controlDailyBalance: {},
      settlement: {},
      previousSettlement: {},
      settledAt: null,
      settledByUserId: null,
      distributedWinnings: false,
      transferredRegisterTickets: false,
      logoutNotes: null,
      createdAt: now,
      updatedAt: now
    };
    this.shifts.set(id, shift);
    return shift;
  }

  async endShift(shiftId: string, flags?: EndShiftFlags): Promise<AgentShift> {
    const shift = this.shifts.get(shiftId);
    if (!shift || !shift.isActive) {
      throw new Error("[BIN-583] shift not found or already ended");
    }
    const now = new Date().toISOString();
    shift.isActive = false;
    shift.isLoggedOut = true;
    shift.endedAt = now;
    shift.updatedAt = now;
    if (flags?.distributeWinnings !== undefined) {
      shift.distributedWinnings = flags.distributeWinnings;
    }
    if (flags?.transferRegisterTickets !== undefined) {
      shift.transferredRegisterTickets = flags.transferRegisterTickets;
    }
    if (flags?.logoutNotes !== undefined) {
      shift.logoutNotes = flags.logoutNotes;
    }
    return { ...shift };
  }

  async getActiveShiftForUser(userId: string): Promise<AgentShift | null> {
    for (const s of this.shifts.values()) {
      if (s.userId === userId && s.isActive) return { ...s };
    }
    return null;
  }

  async getShiftById(shiftId: string): Promise<AgentShift | null> {
    const s = this.shifts.get(shiftId);
    return s ? { ...s } : null;
  }

  async listShiftsForUser(userId: string, limit = 50, offset = 0): Promise<AgentShift[]> {
    const all = Array.from(this.shifts.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(offset, offset + limit).map((s) => ({ ...s }));
  }

  async listActiveShiftsForHall(hallId: string): Promise<AgentShift[]> {
    return Array.from(this.shifts.values())
      .filter((s) => s.hallId === hallId && s.isActive)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((s) => ({ ...s }));
  }

  async applyShiftCashDelta(
    shiftId: string,
    delta: ShiftCashDelta,
    _client?: PoolClient,
  ): Promise<AgentShift> {
    // BIN-PILOT-K1: client-arg ignoreres for in-memory (single-threaded JS,
    // ingen tx-grenser).
    const s = this.shifts.get(shiftId);
    if (!s) throw new Error("[BIN-583] shift not found");
    if (delta.totalCashIn) s.totalCashIn += delta.totalCashIn;
    if (delta.totalCashOut) s.totalCashOut += delta.totalCashOut;
    if (delta.totalCardIn) s.totalCardIn += delta.totalCardIn;
    if (delta.totalCardOut) s.totalCardOut += delta.totalCardOut;
    if (delta.dailyBalance) s.dailyBalance += delta.dailyBalance;
    if (delta.sellingByCustomerNumber) s.sellingByCustomerNumber += delta.sellingByCustomerNumber;
    s.updatedAt = new Date().toISOString();
    return { ...s };
  }

  /**
   * BIN-PILOT-K1: in-memory mirror — kjører callback med null-client.
   */
  async runInTransaction<T>(callback: (client: PoolClient | null) => Promise<T>): Promise<T> {
    return callback(null);
  }

  async setShiftControlDailyBalance(shiftId: string, payload: Record<string, unknown>): Promise<AgentShift> {
    const s = this.shifts.get(shiftId);
    if (!s) throw new Error("[BIN-583] shift not found");
    s.controlDailyBalance = { ...payload };
    s.updatedAt = new Date().toISOString();
    return { ...s };
  }

  async markShiftSettled(
    shiftId: string,
    settledByUserId: string,
    _client?: PoolClient,
    flags?: EndShiftFlags,
  ): Promise<AgentShift> {
    // HV-9: client-arg ignoreres for in-memory (single-threaded JS, ingen
    // tx-grenser). I tester kan vi simulere mid-tx-feil ved å la callback
    // til runInTransaction kaste — InMemory rollback er en no-op fordi
    // mutasjoner skjer in-place; tester må derfor mocke store-metoder
    // for å verifisere rollback-semantikk.
    const s = this.shifts.get(shiftId);
    if (!s) throw new Error("[BIN-583] shift not found");
    if (s.settledAt) throw new Error("[BIN-583] shift already settled");
    const now = new Date().toISOString();
    s.settledAt = now;
    s.settledByUserId = settledByUserId;
    s.isActive = false;
    s.isLoggedOut = true;
    s.isDailyBalanceTransferred = true;
    s.endedAt = s.endedAt ?? now;
    s.updatedAt = now;
    // Pilot-day-fix 2026-05-01: persistér valgfri logout-flags atomisk
    // sammen med settlement (matcher PostgresAgentStore-impl).
    if (flags?.distributeWinnings !== undefined) {
      s.distributedWinnings = flags.distributeWinnings;
    }
    if (flags?.transferRegisterTickets !== undefined) {
      s.transferredRegisterTickets = flags.transferRegisterTickets;
    }
    if (flags?.logoutNotes !== undefined) {
      s.logoutNotes = flags.logoutNotes;
    }
    return { ...s };
  }

  private toProfile(row: MemAgentRow): AgentProfile {
    return {
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      surname: row.surname,
      phone: row.phone,
      role: "AGENT",
      agentStatus: row.agentStatus,
      language: row.language,
      avatarFilename: row.avatarFilename,
      parentUserId: row.parentUserId,
      halls: this.halls
        .filter((h) => h.userId === row.userId)
        .map((h) => ({ ...h })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
