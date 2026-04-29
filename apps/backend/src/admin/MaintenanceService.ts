/**
 * BIN-677: Maintenance-vinduer admin-service.
 *
 * En rad per maintenance-vindu. `status='active'` = vinduet er i kraft NÅ
 * (spillere ser banner / nye økter blokkeres i frontend). Aktiv-invariant
 * (kun ett samtidig aktivt vindu) håndheves i service-laget — `activate`
 * deaktiverer eksisterende active-vindu før den setter nytt.
 *
 * Legacy-opphav:
 *     - maintenance / editMaintenance / updateMaintenance / DailyReportsWithMaintanace
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "maintenance-service" });

export type MaintenanceStatus = "active" | "inactive";

export interface MaintenanceWindow {
  id: string;
  maintenanceStart: string;
  maintenanceEnd: string;
  message: string;
  showBeforeMinutes: number;
  status: MaintenanceStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

export interface CreateMaintenanceInput {
  maintenanceStart: string | Date;
  maintenanceEnd: string | Date;
  message?: string;
  showBeforeMinutes?: number;
  status?: MaintenanceStatus;
  createdByUserId: string;
}

export interface UpdateMaintenanceInput {
  maintenanceStart?: string | Date;
  maintenanceEnd?: string | Date;
  message?: string;
  showBeforeMinutes?: number;
  /**
   * Når status endres, oppdaterer vi `activated_at`/`deactivated_at` og
   * håndhever aktiv-invariant (max ett aktivt vindu av gangen).
   */
  status?: MaintenanceStatus;
}

export interface ListMaintenanceFilter {
  status?: MaintenanceStatus;
  limit?: number;
}

export interface MaintenanceServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface MaintenanceRow {
  id: string;
  maintenance_start: Date | string;
  maintenance_end: Date | string;
  message: string;
  show_before_minutes: number | string;
  status: MaintenanceStatus;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  activated_at: Date | string | null;
  deactivated_at: Date | string | null;
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

function assertDate(value: unknown, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DomainError("INVALID_INPUT", `${field} er en ugyldig dato.`);
    }
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et gyldig ISO 8601 tidspunkt.`
    );
  }
  return d;
}

function assertMessage(value: unknown): string {
  if (value === undefined || value === null) return "Systemet er under vedlikehold.";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "message må være en streng.");
  }
  if (value.length > 2000) {
    throw new DomainError(
      "INVALID_INPUT",
      "message kan maksimalt være 2000 tegn."
    );
  }
  return value;
}

function assertShowBefore(value: unknown): number {
  if (value === undefined || value === null) return 60;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10_080) {
    throw new DomainError(
      "INVALID_INPUT",
      "showBeforeMinutes må være et heltall 0-10080."
    );
  }
  return n;
}

function assertStatus(value: unknown): MaintenanceStatus {
  if (value !== "active" && value !== "inactive") {
    throw new DomainError(
      "INVALID_INPUT",
      "status må være 'active' eller 'inactive'."
    );
  }
  return value;
}

export class MaintenanceService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: MaintenanceServiceOptions) {
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
        "MaintenanceService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): MaintenanceService {
    const svc = Object.create(MaintenanceService.prototype) as MaintenanceService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_maintenance_windows"`;
  }

  async list(filter: ListMaintenanceFilter = {}): Promise<MaintenanceWindow[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0
        ? Math.min(Math.floor(filter.limit), 500)
        : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<MaintenanceRow>(
      `SELECT id, maintenance_start, maintenance_end, message,
              show_before_minutes, status, created_by_user_id,
              created_at, updated_at, activated_at, deactivated_at
       FROM ${this.table()}
       ${where}
       ORDER BY maintenance_start DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<MaintenanceWindow> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<MaintenanceRow>(
      `SELECT id, maintenance_start, maintenance_end, message,
              show_before_minutes, status, created_by_user_id,
              created_at, updated_at, activated_at, deactivated_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "MAINTENANCE_NOT_FOUND",
        "Maintenance-vinduet finnes ikke."
      );
    }
    return this.map(row);
  }

  /**
   * Returnerer currently-active maintenance window (om det finnes). Brukes
   * av frontend for å avgjøre om banner skal vises.
   */
  async getActive(): Promise<MaintenanceWindow | null> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<MaintenanceRow>(
      `SELECT id, maintenance_start, maintenance_end, message,
              show_before_minutes, status, created_by_user_id,
              created_at, updated_at, activated_at, deactivated_at
       FROM ${this.table()}
       WHERE status = 'active'
       ORDER BY activated_at DESC NULLS LAST, updated_at DESC
       LIMIT 1`
    );
    const row = rows[0];
    return row ? this.map(row) : null;
  }

  async create(input: CreateMaintenanceInput): Promise<MaintenanceWindow> {
    await this.ensureInitialized();
    if (!input.createdByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdByUserId er påkrevd.");
    }
    const start = assertDate(input.maintenanceStart, "maintenanceStart");
    const end = assertDate(input.maintenanceEnd, "maintenanceEnd");
    if (end.getTime() < start.getTime()) {
      throw new DomainError(
        "INVALID_INPUT",
        "maintenanceEnd må være samme tid eller etter maintenanceStart."
      );
    }
    const message = assertMessage(input.message);
    const showBefore = assertShowBefore(input.showBeforeMinutes);
    const status: MaintenanceStatus = input.status
      ? assertStatus(input.status)
      : "inactive";

    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Aktiv-invariant: hvis nytt vindu skal aktiveres, deaktiver alle
      // andre aktive.
      if (status === "active") {
        await client.query(
          `UPDATE ${this.table()}
           SET status = 'inactive',
               deactivated_at = now(),
               updated_at = now()
           WHERE status = 'active'`
        );
      }

      const activatedAt = status === "active" ? new Date() : null;
      await client.query(
        `INSERT INTO ${this.table()}
           (id, maintenance_start, maintenance_end, message,
            show_before_minutes, status, created_by_user_id, activated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          start.toISOString(),
          end.toISOString(),
          message,
          showBefore,
          status,
          input.createdByUserId,
          activatedAt ? activatedAt.toISOString() : null,
        ]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-677] maintenance create failed");
      throw new DomainError(
        "MAINTENANCE_CREATE_FAILED",
        "Kunne ikke opprette maintenance-vindu."
      );
    } finally {
      client.release();
    }
    return this.get(id);
  }

  /**
   * Full update. Hvis `status` endres til 'active' deaktiveres eksisterende
   * aktive vinduer først. Hvis `status` endres til 'inactive' settes
   * `deactivated_at`.
   */
  async update(
    id: string,
    update: UpdateMaintenanceInput
  ): Promise<MaintenanceWindow> {
    await this.ensureInitialized();
    const existing = await this.get(id);

    const sets: string[] = [];
    const params: unknown[] = [];

    let nextStart = new Date(existing.maintenanceStart);
    let nextEnd = new Date(existing.maintenanceEnd);

    if (update.maintenanceStart !== undefined) {
      nextStart = assertDate(update.maintenanceStart, "maintenanceStart");
      sets.push(`maintenance_start = $${params.length + 1}`);
      params.push(nextStart.toISOString());
    }
    if (update.maintenanceEnd !== undefined) {
      nextEnd = assertDate(update.maintenanceEnd, "maintenanceEnd");
      sets.push(`maintenance_end = $${params.length + 1}`);
      params.push(nextEnd.toISOString());
    }
    if (nextEnd.getTime() < nextStart.getTime()) {
      throw new DomainError(
        "INVALID_INPUT",
        "maintenanceEnd må være samme tid eller etter maintenanceStart."
      );
    }
    if (update.message !== undefined) {
      sets.push(`message = $${params.length + 1}`);
      params.push(assertMessage(update.message));
    }
    if (update.showBeforeMinutes !== undefined) {
      sets.push(`show_before_minutes = $${params.length + 1}`);
      params.push(assertShowBefore(update.showBeforeMinutes));
    }

    let statusChange: MaintenanceStatus | null = null;
    if (update.status !== undefined) {
      const newStatus = assertStatus(update.status);
      if (newStatus !== existing.status) {
        statusChange = newStatus;
        sets.push(`status = $${params.length + 1}`);
        params.push(newStatus);
        if (newStatus === "active") {
          sets.push(`activated_at = now()`);
        } else {
          sets.push(`deactivated_at = now()`);
        }
      }
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push("updated_at = now()");
    params.push(existing.id);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (statusChange === "active") {
        // Deaktiver andre aktive vinduer før vi aktiverer dette.
        await client.query(
          `UPDATE ${this.table()}
           SET status = 'inactive',
               deactivated_at = now(),
               updated_at = now()
           WHERE status = 'active' AND id <> $1`,
          [existing.id]
        );
      }
      await client.query(
        `UPDATE ${this.table()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}`,
        params
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-677] maintenance update failed");
      throw new DomainError(
        "MAINTENANCE_UPDATE_FAILED",
        "Kunne ikke oppdatere maintenance-vindu."
      );
    } finally {
      client.release();
    }
    return this.get(existing.id);
  }

  /**
   * Convenience-metoder brukt av PUT /api/admin/maintenance/:id — aktiverer
   * eller deaktiverer et vindu i én kall.
   */
  async setStatus(
    id: string,
    status: MaintenanceStatus
  ): Promise<MaintenanceWindow> {
    return this.update(id, { status: assertStatus(status) });
  }

  private map(row: MaintenanceRow): MaintenanceWindow {
    return {
      id: row.id,
      maintenanceStart: asIso(row.maintenance_start),
      maintenanceEnd: asIso(row.maintenance_end),
      message: row.message,
      showBeforeMinutes: Number(row.show_before_minutes),
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      activatedAt: asIsoOrNull(row.activated_at),
      deactivatedAt: asIsoOrNull(row.deactivated_at),
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
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          id TEXT PRIMARY KEY,
          maintenance_start TIMESTAMPTZ NOT NULL,
          maintenance_end TIMESTAMPTZ NOT NULL,
          message TEXT NOT NULL DEFAULT 'Systemet er under vedlikehold.',
          show_before_minutes INTEGER NOT NULL DEFAULT 60
            CHECK (show_before_minutes >= 0),
          status TEXT NOT NULL DEFAULT 'inactive'
            CHECK (status IN ('active','inactive')),
          created_by_user_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          activated_at TIMESTAMPTZ NULL,
          deactivated_at TIMESTAMPTZ NULL,
          CHECK (maintenance_end >= maintenance_start)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_maintenance_windows_status
         ON ${this.table()}(status)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_maintenance_windows_start
         ON ${this.table()}(maintenance_start DESC)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-677] maintenance_windows schema init failed");
      throw new DomainError(
        "MAINTENANCE_INIT_FAILED",
        "Kunne ikke initialisere maintenance_windows-tabell."
      );
    } finally {
      client.release();
    }
  }
}
