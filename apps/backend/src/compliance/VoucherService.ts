/**
 * BIN-587 B4b: voucher admin-service.
 *
 * Første versjon: admin-CRUD for rabatt-koder. Redemption (player-
 * flyt i G2/G3) kommer som follow-up — da trenger vi også
 * `app_voucher_redemptions`-tabell for historikk.
 *
 * Validering:
 *   - PERCENTAGE: value ∈ [0, 100]
 *   - FLAT_AMOUNT: value ≥ 0 (cents)
 *   - validFrom ≤ validTo hvis begge er satt
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "voucher-service" });

export type VoucherType = "PERCENTAGE" | "FLAT_AMOUNT";

const VALID_TYPES: VoucherType[] = ["PERCENTAGE", "FLAT_AMOUNT"];

export interface Voucher {
  id: string;
  code: string;
  type: VoucherType;
  value: number;
  maxUses: number | null;
  usesCount: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVoucherInput {
  code: string;
  type: VoucherType;
  value: number;
  maxUses?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  isActive?: boolean;
  description?: string | null;
  createdBy: string;
}

export interface UpdateVoucherInput {
  value?: number;
  maxUses?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  isActive?: boolean;
  description?: string | null;
}

export interface ListVouchersFilter {
  isActive?: boolean;
  limit?: number;
}

export interface VoucherServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface VoucherRow {
  id: string;
  code: string;
  type: VoucherType;
  value: string | number;
  max_uses: number | null;
  uses_count: number;
  valid_from: Date | string | null;
  valid_to: Date | string | null;
  is_active: boolean;
  description: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertCode(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "code er påkrevd.");
  }
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z0-9_\-]+$/.test(trimmed)) {
    throw new DomainError("INVALID_INPUT", "code kan bare inneholde A-Z, 0-9, '_' og '-'.");
  }
  if (trimmed.length < 3 || trimmed.length > 40) {
    throw new DomainError("INVALID_INPUT", "code må være 3-40 tegn.");
  }
  return trimmed;
}

function assertType(value: unknown): VoucherType {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "type må være en streng.");
  }
  const upper = value.trim().toUpperCase() as VoucherType;
  if (!VALID_TYPES.includes(upper)) {
    throw new DomainError("INVALID_INPUT", `type må være én av ${VALID_TYPES.join(", ")}.`);
  }
  return upper;
}

function assertValue(type: VoucherType, value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", "value må være et ikke-negativt heltall.");
  }
  if (type === "PERCENTAGE" && n > 100) {
    throw new DomainError("INVALID_INPUT", "PERCENTAGE-value kan ikke overstige 100.");
  }
  return n;
}

function assertOptionalMaxUses(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError("INVALID_INPUT", "maxUses må være et positivt heltall (eller null).");
  }
  return n;
}

function assertOptionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  if (isNaN(Date.parse(s))) {
    throw new DomainError("INVALID_INPUT", `${field} må være en ISO-timestamp.`);
  }
  return s;
}

export class VoucherService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: VoucherServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "VoucherService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): VoucherService {
    const svc = Object.create(VoucherService.prototype) as VoucherService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private vouchersTable(): string { return `"${this.schema}"."app_vouchers"`; }

  async list(filter: ListVouchersFilter = {}): Promise<Voucher[]> {
    await this.ensureInitialized();
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.isActive !== undefined) {
      params.push(filter.isActive);
      conditions.push(`is_active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<VoucherRow>(
      `SELECT id, code, type, value, max_uses, uses_count, valid_from, valid_to,
              is_active, description, created_by, created_at, updated_at
       FROM ${this.vouchersTable()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapVoucher(r));
  }

  async get(id: string): Promise<Voucher> {
    await this.ensureInitialized();
    if (!id?.trim()) throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    const { rows } = await this.pool.query<VoucherRow>(
      `SELECT id, code, type, value, max_uses, uses_count, valid_from, valid_to,
              is_active, description, created_by, created_at, updated_at
       FROM ${this.vouchersTable()}
       WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) throw new DomainError("VOUCHER_NOT_FOUND", "Voucher finnes ikke.");
    return this.mapVoucher(row);
  }

  async getByCode(code: string): Promise<Voucher | null> {
    await this.ensureInitialized();
    const normalized = assertCode(code);
    const { rows } = await this.pool.query<VoucherRow>(
      `SELECT id, code, type, value, max_uses, uses_count, valid_from, valid_to,
              is_active, description, created_by, created_at, updated_at
       FROM ${this.vouchersTable()}
       WHERE code = $1`,
      [normalized]
    );
    return rows[0] ? this.mapVoucher(rows[0]) : null;
  }

  async create(input: CreateVoucherInput): Promise<Voucher> {
    await this.ensureInitialized();
    const code = assertCode(input.code);
    const type = assertType(input.type);
    const value = assertValue(type, input.value);
    const maxUses = assertOptionalMaxUses(input.maxUses);
    const validFrom = assertOptionalTimestamp(input.validFrom, "validFrom");
    const validTo = assertOptionalTimestamp(input.validTo, "validTo");
    if (validFrom && validTo && Date.parse(validFrom) > Date.parse(validTo)) {
      throw new DomainError("INVALID_INPUT", "validFrom må være ≤ validTo.");
    }
    const isActive = typeof input.isActive === "boolean" ? input.isActive : true;
    const description =
      input.description === null || input.description === undefined
        ? null
        : typeof input.description === "string" && input.description.trim()
          ? input.description.trim().slice(0, 500)
          : null;
    const id = randomUUID();

    try {
      const { rows } = await this.pool.query<VoucherRow>(
        `INSERT INTO ${this.vouchersTable()}
           (id, code, type, value, max_uses, valid_from, valid_to, is_active, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10)
         RETURNING id, code, type, value, max_uses, uses_count, valid_from, valid_to,
                   is_active, description, created_by, created_at, updated_at`,
        [id, code, type, value, maxUses, validFrom, validTo, isActive, description, input.createdBy]
      );
      return this.mapVoucher(rows[0]!);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg)) {
        throw new DomainError("VOUCHER_CODE_EXISTS", `Voucher-kode "${code}" finnes allerede.`);
      }
      throw err;
    }
  }

  async update(id: string, update: UpdateVoucherInput): Promise<Voucher> {
    await this.ensureInitialized();
    const existing = await this.get(id);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (update.value !== undefined) {
      sets.push(`value = $${params.length + 1}`);
      params.push(assertValue(existing.type, update.value));
    }
    if (update.maxUses !== undefined) {
      sets.push(`max_uses = $${params.length + 1}`);
      params.push(assertOptionalMaxUses(update.maxUses));
    }
    if (update.validFrom !== undefined) {
      sets.push(`valid_from = $${params.length + 1}::timestamptz`);
      params.push(assertOptionalTimestamp(update.validFrom, "validFrom"));
    }
    if (update.validTo !== undefined) {
      sets.push(`valid_to = $${params.length + 1}::timestamptz`);
      params.push(assertOptionalTimestamp(update.validTo, "validTo"));
    }
    if (update.isActive !== undefined) {
      sets.push(`is_active = $${params.length + 1}`);
      params.push(Boolean(update.isActive));
    }
    if (update.description !== undefined) {
      sets.push(`description = $${params.length + 1}`);
      params.push(
        update.description === null
          ? null
          : typeof update.description === "string"
            ? update.description.trim().slice(0, 500) || null
            : null
      );
    }
    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push(`updated_at = now()`);
    params.push(existing.id);

    const { rows } = await this.pool.query<VoucherRow>(
      `UPDATE ${this.vouchersTable()}
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, code, type, value, max_uses, uses_count, valid_from, valid_to,
                 is_active, description, created_by, created_at, updated_at`,
      params
    );
    const row = rows[0];
    if (!row) throw new DomainError("VOUCHER_NOT_FOUND", "Voucher finnes ikke.");
    // Ekstra sjekk: valid_from ≤ valid_to etter oppdatering
    const result = this.mapVoucher(row);
    if (result.validFrom && result.validTo && Date.parse(result.validFrom) > Date.parse(result.validTo)) {
      throw new DomainError("INVALID_INPUT", "validFrom må være ≤ validTo.");
    }
    return result;
  }

  /**
   * Soft-delete hvis voucheren har blitt brukt (uses_count > 0) —
   * bevarer historikk. Hard-delete kun hvis ingen bruk. Strategien
   * matcher PhysicalTicket deleteBatch-pattern.
   */
  async remove(id: string): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.usesCount > 0) {
      await this.pool.query(
        `UPDATE ${this.vouchersTable()}
         SET is_active = false, updated_at = now()
         WHERE id = $1`,
        [existing.id]
      );
      return { softDeleted: true };
    }
    await this.pool.query(
      `DELETE FROM ${this.vouchersTable()} WHERE id = $1`,
      [existing.id]
    );
    return { softDeleted: false };
  }

  private mapVoucher(row: VoucherRow): Voucher {
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: Number(row.value),
      maxUses: row.max_uses,
      usesCount: row.uses_count,
      validFrom: asIsoOrNull(row.valid_from),
      validTo: asIsoOrNull(row.valid_to),
      isActive: row.is_active,
      description: row.description,
      createdBy: row.created_by,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.vouchersTable()} (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('PERCENTAGE', 'FLAT_AMOUNT')),
          value BIGINT NOT NULL CHECK (value >= 0),
          max_uses INTEGER NULL CHECK (max_uses IS NULL OR max_uses > 0),
          uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
          valid_from TIMESTAMPTZ NULL,
          valid_to TIMESTAMPTZ NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          description TEXT NULL,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (type != 'PERCENTAGE' OR value <= 100),
          CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_vouchers_active_code
         ON ${this.vouchersTable()}(code) WHERE is_active = true`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-587 B4b] voucher schema init failed");
      throw new DomainError("VOUCHER_INIT_FAILED", "Kunne ikke initialisere voucher-tabell.");
    } finally {
      client.release();
    }
  }
}
