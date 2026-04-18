/**
 * BIN-588: centralised compliance audit log.
 *
 * Legacy controllers logged audit events via console.log and scattered
 * per-controller DB writes. This service replaces that pattern with a
 * single append-only store so compliance can reconstruct "who did what,
 * when, why" without grepping JSON logs.
 *
 * Design notes:
 *   - Immutable. No update/delete API is exposed.
 *   - Fire-and-forget writes. A failing DB must never block a
 *     domain operation (same policy as ChatMessageStore — BIN-516).
 *     Failures log a warning; the event is lost, which is acceptable
 *     because we also keep structured logs via pino.
 *   - PII redaction is enforced at write time for a small blocklist of
 *     keys (password, token, ssn, etc.). The pino logger already redacts
 *     the log output; here we redact the row payload so the DB never
 *     stores raw credentials either.
 *   - Two implementations (Postgres / in-memory) mirror existing stores
 *     so we can run tests without spinning up Postgres.
 */

import type { Pool, QueryResult } from "pg";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "audit-log" });

export type AuditActorType =
  | "USER"
  | "ADMIN"
  | "HALL_OPERATOR"
  | "SUPPORT"
  | "PLAYER"
  | "SYSTEM"
  | "EXTERNAL";

export interface AuditLogInput {
  actorId: string | null;
  actorType: AuditActorType;
  /** Stable dotted verb, e.g. "user.role.change", "deposit.complete". */
  action: string;
  /** Entity kind, e.g. "user", "hall", "deposit". */
  resource: string;
  resourceId: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PersistedAuditEvent {
  id: string;
  actorId: string | null;
  actorType: AuditActorType;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditListFilter {
  actorId?: string;
  resource?: string;
  resourceId?: string;
  action?: string;
  since?: string; // ISO timestamp
  limit?: number;
}

export interface AuditLogStore {
  append(input: AuditLogInput): Promise<void>;
  list(filter?: AuditListFilter): Promise<PersistedAuditEvent[]>;
}

/**
 * Keys whose values must never be persisted. Case-insensitive; any
 * nested level is redacted. Mirrors the pino redaction list in
 * util/logger.ts.
 */
const REDACT_KEYS = new Set([
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "secret",
  "nationalid",
  "ssn",
  "personnummer",
  "fodselsnummer",
  "cardnumber",
  "cvv",
  "cvc",
  "pan",
  "authorization",
]);

const REDACTED = "[REDACTED]";

/**
 * Deep-clone the details object while replacing sensitive values with
 * "[REDACTED]". Strings, numbers, booleans, null are passed through;
 * arrays recurse; functions/symbols/undefined are dropped.
 */
export function redactDetails(input: unknown): Record<string, unknown> {
  const result = redactValue(input);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  // Callers always hand us an object; a non-object here means we got
  // fed something weird, which we coerce into { value: ... } so the
  // column is still a usable JSON object.
  return { value: result };
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[TOO_DEEP]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactValue(raw, depth + 1);
    }
    return out;
  }
  // functions, symbols, bigint → drop
  return null;
}

function normaliseInput(input: AuditLogInput): Required<Omit<AuditLogInput, "details" | "ipAddress" | "userAgent">> & {
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
} {
  const action = input.action.trim();
  const resource = input.resource.trim();
  if (!action) throw new Error("[BIN-588] audit: action is required");
  if (!resource) throw new Error("[BIN-588] audit: resource is required");
  return {
    actorId: input.actorId?.trim() || null,
    actorType: input.actorType,
    action,
    resource,
    resourceId: input.resourceId?.trim() || null,
    details: redactDetails(input.details ?? {}),
    ipAddress: input.ipAddress?.trim() || null,
    userAgent: input.userAgent?.trim() || null,
  };
}

// ── Postgres implementation ─────────────────────────────────────────────────

export interface PostgresAuditLogStoreOptions {
  pool: Pool;
  schema?: string;
}

interface AuditLogRow {
  id: number | string;
  actor_id: string | null;
  actor_type: AuditActorType;
  action: string;
  resource: string;
  resource_id: string | null;
  details: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date | string;
}

export class PostgresAuditLogStore implements AuditLogStore {
  private readonly pool: Pool;
  private readonly tableName: string;

  constructor(options: PostgresAuditLogStoreOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
    this.tableName = `${schema}.app_audit_log`;
  }

  async append(input: AuditLogInput): Promise<void> {
    const row = normaliseInput(input);
    try {
      await this.pool.query(
        `INSERT INTO ${this.tableName}
          (actor_id, actor_type, action, resource, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          row.actorId,
          row.actorType,
          row.action,
          row.resource,
          row.resourceId,
          JSON.stringify(row.details),
          row.ipAddress,
          row.userAgent,
        ],
      );
    } catch (err) {
      // Fire-and-forget: never block the caller on a DB outage. The
      // structured logger still captures the intent so ops can reconcile.
      logger.warn({
        err,
        action: row.action,
        resource: row.resource,
        resourceId: row.resourceId,
      }, "[BIN-588] audit append failed (continuing)");
    }
  }

  async list(filter: AuditListFilter = {}): Promise<PersistedAuditEvent[]> {
    const limit = Math.max(1, Math.min(1000, Math.floor(filter.limit ?? 100)));
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.actorId) {
      params.push(filter.actorId);
      where.push(`actor_id = $${params.length}`);
    }
    if (filter.resource) {
      params.push(filter.resource);
      where.push(`resource = $${params.length}`);
    }
    if (filter.resourceId) {
      params.push(filter.resourceId);
      where.push(`resource_id = $${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      where.push(`action = $${params.length}`);
    }
    if (filter.since) {
      params.push(filter.since);
      where.push(`created_at >= $${params.length}`);
    }
    params.push(limit);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `SELECT id, actor_id, actor_type, action, resource, resource_id,
                        details, ip_address, user_agent, created_at
                 FROM ${this.tableName}
                 ${whereSql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT $${params.length}`;
    try {
      const result: QueryResult<AuditLogRow> = await this.pool.query<AuditLogRow>(sql, params);
      return result.rows.map(rowToEvent);
    } catch (err) {
      logger.warn({ err }, "[BIN-588] audit list failed (returning empty)");
      return [];
    }
  }
}

function rowToEvent(row: AuditLogRow): PersistedAuditEvent {
  const details = parseDetails(row.details);
  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(String(row.created_at)).toISOString();
  return {
    id: String(row.id),
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    resource: row.resource,
    resourceId: row.resource_id,
    details,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt,
  };
}

function parseDetails(value: unknown): Record<string, unknown> {
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

// ── In-memory implementation ────────────────────────────────────────────────
// Used in tests and when APP_PG_CONNECTION_STRING is unset.

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly events: PersistedAuditEvent[] = [];
  private nextId = 1;

  async append(input: AuditLogInput): Promise<void> {
    const row = normaliseInput(input);
    this.events.push({
      id: String(this.nextId++),
      actorId: row.actorId,
      actorType: row.actorType,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      details: row.details,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: new Date().toISOString(),
    });
  }

  async list(filter: AuditListFilter = {}): Promise<PersistedAuditEvent[]> {
    const limit = Math.max(1, Math.min(1000, Math.floor(filter.limit ?? 100)));
    const filtered = this.events
      .filter((e) => {
        if (filter.actorId && e.actorId !== filter.actorId) return false;
        if (filter.resource && e.resource !== filter.resource) return false;
        if (filter.resourceId && e.resourceId !== filter.resourceId) return false;
        if (filter.action && e.action !== filter.action) return false;
        if (filter.since && e.createdAt < filter.since) return false;
        return true;
      })
      .slice()
      .reverse()
      .slice(0, limit);
    return filtered.map((e) => ({ ...e, details: { ...e.details } }));
  }

  /** Test helper. */
  clear(): void {
    this.events.length = 0;
    this.nextId = 1;
  }
}

// ── Service facade ─────────────────────────────────────────────────────────
//
// AuditLogService is the injectable surface the rest of the backend
// depends on. Pass in either store at wiring time; callers never touch
// the store directly.

export class AuditLogService {
  private readonly store: AuditLogStore;

  constructor(store: AuditLogStore) {
    this.store = store;
  }

  async record(input: AuditLogInput): Promise<void> {
    await this.store.append(input);
  }

  async list(filter?: AuditListFilter): Promise<PersistedAuditEvent[]> {
    return this.store.list(filter);
  }
}
