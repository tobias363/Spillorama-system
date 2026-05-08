/**
 * Spill 3 (monsterbingo) globalt singleton-konfig (Tobias-direktiv 2026-05-08).
 *
 * Tabell: `app_spill3_config` med partial unique index på `(active=TRUE)`
 * som håndhever singleton (kun én aktiv rad globalt).
 *
 * Ansvar:
 *   - Lese aktiv konfig (read-through cache, 5s TTL — endringer slår inn
 *     ved neste runde-start uten restart).
 *   - Oppdatere konfig (admin via PUT /api/admin/spill3/config).
 *   - Validere prize-mode-konsistens: fixed-mode krever alle
 *     `prize_radN_cents`-felter satt; percentage-mode krever alle
 *     `prize_radN_pct`-felter satt.
 *   - Skrive audit-log-events ved hver oppdatering.
 *
 * Out-of-scope (følger i egen PR ved behov):
 *   - Versjonering / endrings-historikk utover audit-log
 *   - Multi-tenant (per-hall-konfig — bevisst utenfor scope per Tobias-spec)
 *
 * Mønster: matcher GameCatalogService (samme schema-håndtering, DomainError-
 * koder, audit-log-injection).
 */

import { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";

const logger = rootLogger.child({ module: "spill3-config-service" });

export type Spill3PrizeMode = "fixed" | "percentage";

const VALID_PRIZE_MODES = new Set<Spill3PrizeMode>(["fixed", "percentage"]);

/**
 * Min/max-grenser. Holdes synkrone med migration-CHECK-constraints og
 * admin-UI-validering. Per Tobias-direktiv 2026-05-08:
 *   - min_tickets_to_start: 0-1000 (0 = ingen gating; 1000 = sikkerhetsmargin)
 *   - prize_*_cents: ≥ 0 (DB-CHECK)
 *   - prize_*_pct: 0-100 (DB-CHECK)
 *   - ticket_price_cents: > 0 (DB-CHECK), default 500
 *   - pause_between_rows_ms: 0-60000 (DB-CHECK), default 3000
 */
export const MIN_TICKETS_TO_START_MIN = 0;
export const MIN_TICKETS_TO_START_MAX = 1000;
export const PRIZE_CENTS_MAX = 1_000_000_00; // 1 mill kr i øre — sane absolutt-cap
export const PAUSE_BETWEEN_ROWS_MS_MIN = 0;
export const PAUSE_BETWEEN_ROWS_MS_MAX = 60_000;
export const TICKET_PRICE_CENTS_MIN = 1;
export const TICKET_PRICE_CENTS_MAX = 100_000;

export interface Spill3Config {
  id: string;
  minTicketsToStart: number;
  prizeMode: Spill3PrizeMode;
  prizeRad1Cents: number | null;
  prizeRad2Cents: number | null;
  prizeRad3Cents: number | null;
  prizeRad4Cents: number | null;
  prizeFullHouseCents: number | null;
  prizeRad1Pct: number | null;
  prizeRad2Pct: number | null;
  prizeRad3Pct: number | null;
  prizeRad4Pct: number | null;
  prizeFullHousePct: number | null;
  ticketPriceCents: number;
  pauseBetweenRowsMs: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

/**
 * Partial update — admin sender kun de feltene som skal endres. Service-
 * laget validerer prize-mode-konsistens og leser ikke-sendte felter fra
 * eksisterende rad.
 */
export interface UpdateSpill3ConfigInput {
  minTicketsToStart?: number;
  prizeMode?: Spill3PrizeMode;
  prizeRad1Cents?: number | null;
  prizeRad2Cents?: number | null;
  prizeRad3Cents?: number | null;
  prizeRad4Cents?: number | null;
  prizeFullHouseCents?: number | null;
  prizeRad1Pct?: number | null;
  prizeRad2Pct?: number | null;
  prizeRad3Pct?: number | null;
  prizeRad4Pct?: number | null;
  prizeFullHousePct?: number | null;
  ticketPriceCents?: number;
  pauseBetweenRowsMs?: number;
  /** Audit-log-actor. Skrives til `updated_by_user_id` og audit-event. */
  updatedByUserId: string;
}

// ── Validering ─────────────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonNegativeInt(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være heltall mellom ${min} og ${max}.`,
    );
  }
  return n;
}

function assertNullableInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  return assertNonNegativeInt(value, field, min, max);
}

function assertPositiveInt(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være heltall mellom ${min} og ${max}.`,
    );
  }
  return n;
}

function assertNullablePct(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være tall mellom 0 og 100.`,
    );
  }
  // Rund av til 2 desimaler for å matche NUMERIC(5,2) i DB.
  return Math.round(n * 100) / 100;
}

function assertPrizeMode(value: unknown): Spill3PrizeMode {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "prizeMode må være en streng.");
  }
  const v = value.trim().toLowerCase();
  if (!VALID_PRIZE_MODES.has(v as Spill3PrizeMode)) {
    throw new DomainError(
      "INVALID_INPUT",
      `prizeMode må være "fixed" eller "percentage".`,
    );
  }
  return v as Spill3PrizeMode;
}

/**
 * Validerer at config er internt konsistent etter en partial update:
 *   - fixed-mode → alle prize_radN_cents og prize_full_house_cents må være satt
 *   - percentage-mode → alle prize_radN_pct og prize_full_house_pct må være satt
 *
 * Kaster DomainError("INVALID_CONFIG") ved inkonsistens. Caller skal
 * bruke denne ETTER at partial-update er merged inn i eksisterende rad
 * (slik at admin kan sende kun delta-felter).
 */
export function assertConfigConsistency(config: Spill3Config): void {
  if (config.prizeMode === "fixed") {
    if (
      config.prizeRad1Cents === null ||
      config.prizeRad2Cents === null ||
      config.prizeRad3Cents === null ||
      config.prizeRad4Cents === null ||
      config.prizeFullHouseCents === null
    ) {
      throw new DomainError(
        "INVALID_CONFIG",
        "fixed-modus krever at alle prize_*_cents-felter er satt (Rad 1-4 + Fullt Hus).",
      );
    }
  } else if (config.prizeMode === "percentage") {
    if (
      config.prizeRad1Pct === null ||
      config.prizeRad2Pct === null ||
      config.prizeRad3Pct === null ||
      config.prizeRad4Pct === null ||
      config.prizeFullHousePct === null
    ) {
      throw new DomainError(
        "INVALID_CONFIG",
        "percentage-modus krever at alle prize_*_pct-felter er satt (Rad 1-4 + Fullt Hus).",
      );
    }
    // Sum ≤ 100 — mer enn det betyr at vi utbetaler mer enn omsetningen.
    const total =
      config.prizeRad1Pct +
      config.prizeRad2Pct +
      config.prizeRad3Pct +
      config.prizeRad4Pct +
      config.prizeFullHousePct;
    if (total > 100) {
      throw new DomainError(
        "INVALID_CONFIG",
        `Sum av prize-prosenter må være ≤ 100. Fikk ${total}%.`,
      );
    }
  }
}

// ── Row-mapping ───────────────────────────────────────────────────────────

interface Spill3ConfigRow {
  id: string;
  min_tickets_to_start: number;
  prize_mode: string;
  prize_rad1_cents: number | null;
  prize_rad2_cents: number | null;
  prize_rad3_cents: number | null;
  prize_rad4_cents: number | null;
  prize_full_house_cents: number | null;
  prize_rad1_pct: string | number | null;
  prize_rad2_pct: string | number | null;
  prize_rad3_pct: string | number | null;
  prize_rad4_pct: string | number | null;
  prize_full_house_pct: string | number | null;
  ticket_price_cents: number;
  pause_between_rows_ms: number;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  updated_by_user_id: string | null;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function pgNumericToNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: Spill3ConfigRow): Spill3Config {
  return {
    id: row.id,
    minTicketsToStart: row.min_tickets_to_start,
    prizeMode: assertPrizeMode(row.prize_mode),
    prizeRad1Cents: row.prize_rad1_cents,
    prizeRad2Cents: row.prize_rad2_cents,
    prizeRad3Cents: row.prize_rad3_cents,
    prizeRad4Cents: row.prize_rad4_cents,
    prizeFullHouseCents: row.prize_full_house_cents,
    prizeRad1Pct: pgNumericToNumber(row.prize_rad1_pct),
    prizeRad2Pct: pgNumericToNumber(row.prize_rad2_pct),
    prizeRad3Pct: pgNumericToNumber(row.prize_rad3_pct),
    prizeRad4Pct: pgNumericToNumber(row.prize_rad4_pct),
    prizeFullHousePct: pgNumericToNumber(row.prize_full_house_pct),
    ticketPriceCents: row.ticket_price_cents,
    pauseBetweenRowsMs: row.pause_between_rows_ms,
    active: row.active,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    updatedByUserId: row.updated_by_user_id,
  };
}

// ── Service ───────────────────────────────────────────────────────────────

export interface Spill3ConfigServiceOptions {
  pool: Pool;
  schema?: string;
  auditLogService?: AuditLogService | null;
  /** Cache TTL i ms. Default 5 sek — endringer slår inn ved neste runde. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  config: Spill3Config;
  fetchedAt: number;
}

export class Spill3ConfigService {
  private readonly pool: Pool;
  private readonly schema: string;
  private auditLogService: AuditLogService | null;
  private readonly cacheTtlMs: number;
  private cache: CacheEntry | null = null;

  constructor(options: Spill3ConfigServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLogService = options.auditLogService ?? null;
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
  }

  /** @internal — test-hook (samme mønster som GameCatalogService). */
  static forTesting(
    pool: Pool,
    schema = "public",
    auditLogService: AuditLogService | null = null,
    cacheTtlMs = 5_000,
  ): Spill3ConfigService {
    const svc = Object.create(Spill3ConfigService.prototype) as Spill3ConfigService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { auditLogService: AuditLogService | null }).auditLogService = auditLogService;
    (svc as unknown as { cacheTtlMs: number }).cacheTtlMs = cacheTtlMs;
    (svc as unknown as { cache: CacheEntry | null }).cache = null;
    return svc;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service;
  }

  /**
   * Hent aktiv config. Read-through cache med konfigurerbar TTL — endringer
   * slår inn ved neste cache-miss (default ~5s).
   *
   * Kaster `DomainError("CONFIG_MISSING")` hvis ingen aktiv rad finnes.
   * Default-rad seedes av migrasjonen, så dette skal aldri skje i praksis
   * untatt at admin har (feilaktig) deaktivert alle rader.
   */
  async getActive(): Promise<Spill3Config> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.cacheTtlMs) {
      return this.cache.config;
    }
    const row = await this.fetchActiveRow();
    if (!row) {
      throw new DomainError(
        "CONFIG_MISSING",
        "Ingen aktiv Spill 3 config. Migrasjon må kjøres eller admin må aktivere en rad.",
      );
    }
    const config = mapRow(row);
    this.cache = { config, fetchedAt: now };
    return config;
  }

  /**
   * Force-refresh cache. Brukes etter `update()` slik at neste `getActive()`
   * leser fra DB istedenfor stale cache.
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Update aktiv config (partial). Validerer prize-mode-konsistens etter
   * merge. Skriver audit-log-event "spill3.config.update" med før/etter-
   * snapshot.
   */
  async update(input: UpdateSpill3ConfigInput): Promise<Spill3Config> {
    if (!input.updatedByUserId || typeof input.updatedByUserId !== "string") {
      throw new DomainError("INVALID_INPUT", "updatedByUserId er påkrevd.");
    }
    const before = await this.getActive();

    // Validate input felter (kaster INVALID_INPUT ved ugyldig shape).
    const partialUpdate: Partial<Spill3Config> = {};
    if (input.minTicketsToStart !== undefined) {
      partialUpdate.minTicketsToStart = assertNonNegativeInt(
        input.minTicketsToStart,
        "minTicketsToStart",
        MIN_TICKETS_TO_START_MIN,
        MIN_TICKETS_TO_START_MAX,
      );
    }
    if (input.prizeMode !== undefined) {
      partialUpdate.prizeMode = assertPrizeMode(input.prizeMode);
    }
    if (input.prizeRad1Cents !== undefined) {
      partialUpdate.prizeRad1Cents = assertNullableInt(
        input.prizeRad1Cents,
        "prizeRad1Cents",
        0,
        PRIZE_CENTS_MAX,
      );
    }
    if (input.prizeRad2Cents !== undefined) {
      partialUpdate.prizeRad2Cents = assertNullableInt(
        input.prizeRad2Cents,
        "prizeRad2Cents",
        0,
        PRIZE_CENTS_MAX,
      );
    }
    if (input.prizeRad3Cents !== undefined) {
      partialUpdate.prizeRad3Cents = assertNullableInt(
        input.prizeRad3Cents,
        "prizeRad3Cents",
        0,
        PRIZE_CENTS_MAX,
      );
    }
    if (input.prizeRad4Cents !== undefined) {
      partialUpdate.prizeRad4Cents = assertNullableInt(
        input.prizeRad4Cents,
        "prizeRad4Cents",
        0,
        PRIZE_CENTS_MAX,
      );
    }
    if (input.prizeFullHouseCents !== undefined) {
      partialUpdate.prizeFullHouseCents = assertNullableInt(
        input.prizeFullHouseCents,
        "prizeFullHouseCents",
        0,
        PRIZE_CENTS_MAX,
      );
    }
    if (input.prizeRad1Pct !== undefined) {
      partialUpdate.prizeRad1Pct = assertNullablePct(input.prizeRad1Pct, "prizeRad1Pct");
    }
    if (input.prizeRad2Pct !== undefined) {
      partialUpdate.prizeRad2Pct = assertNullablePct(input.prizeRad2Pct, "prizeRad2Pct");
    }
    if (input.prizeRad3Pct !== undefined) {
      partialUpdate.prizeRad3Pct = assertNullablePct(input.prizeRad3Pct, "prizeRad3Pct");
    }
    if (input.prizeRad4Pct !== undefined) {
      partialUpdate.prizeRad4Pct = assertNullablePct(input.prizeRad4Pct, "prizeRad4Pct");
    }
    if (input.prizeFullHousePct !== undefined) {
      partialUpdate.prizeFullHousePct = assertNullablePct(input.prizeFullHousePct, "prizeFullHousePct");
    }
    if (input.ticketPriceCents !== undefined) {
      partialUpdate.ticketPriceCents = assertPositiveInt(
        input.ticketPriceCents,
        "ticketPriceCents",
        TICKET_PRICE_CENTS_MIN,
        TICKET_PRICE_CENTS_MAX,
      );
    }
    if (input.pauseBetweenRowsMs !== undefined) {
      partialUpdate.pauseBetweenRowsMs = assertNonNegativeInt(
        input.pauseBetweenRowsMs,
        "pauseBetweenRowsMs",
        PAUSE_BETWEEN_ROWS_MS_MIN,
        PAUSE_BETWEEN_ROWS_MS_MAX,
      );
    }

    // Merge partial inn i eksisterende, valider total-konsistens.
    const merged: Spill3Config = { ...before, ...partialUpdate };
    assertConfigConsistency(merged);

    // Persist update (UPDATE singleton-rad WHERE id = before.id).
    await this.pool.query(
      `UPDATE ${this.schema}.app_spill3_config
       SET min_tickets_to_start = $2,
           prize_mode = $3,
           prize_rad1_cents = $4,
           prize_rad2_cents = $5,
           prize_rad3_cents = $6,
           prize_rad4_cents = $7,
           prize_full_house_cents = $8,
           prize_rad1_pct = $9,
           prize_rad2_pct = $10,
           prize_rad3_pct = $11,
           prize_rad4_pct = $12,
           prize_full_house_pct = $13,
           ticket_price_cents = $14,
           pause_between_rows_ms = $15,
           updated_at = now(),
           updated_by_user_id = $16
       WHERE id = $1`,
      [
        before.id,
        merged.minTicketsToStart,
        merged.prizeMode,
        merged.prizeRad1Cents,
        merged.prizeRad2Cents,
        merged.prizeRad3Cents,
        merged.prizeRad4Cents,
        merged.prizeFullHouseCents,
        merged.prizeRad1Pct,
        merged.prizeRad2Pct,
        merged.prizeRad3Pct,
        merged.prizeRad4Pct,
        merged.prizeFullHousePct,
        merged.ticketPriceCents,
        merged.pauseBetweenRowsMs,
        input.updatedByUserId,
      ],
    );

    this.invalidateCache();
    const after = await this.getActive();

    // Audit-log-event (best-effort — feiler aldri caller).
    if (this.auditLogService) {
      try {
        await this.auditLogService.record({
          actorType: "ADMIN",
          actorId: input.updatedByUserId,
          action: "spill3.config.update",
          resource: "spill3_config",
          resourceId: before.id,
          details: {
            before: serializeForAudit(before),
            after: serializeForAudit(after),
            changedFields: diffChangedFields(before, after),
          },
        });
      } catch (err) {
        logger.warn(
          { err, configId: before.id, actorId: input.updatedByUserId },
          "spill3-config: audit-log failed (best-effort, continuing)",
        );
      }
    }

    logger.info(
      {
        configId: before.id,
        actorId: input.updatedByUserId,
        prizeMode: after.prizeMode,
        minTicketsToStart: after.minTicketsToStart,
      },
      "spill3-config: updated",
    );

    return after;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async fetchActiveRow(): Promise<Spill3ConfigRow | null> {
    const result = await this.pool.query<Spill3ConfigRow>(
      `SELECT id, min_tickets_to_start, prize_mode,
              prize_rad1_cents, prize_rad2_cents, prize_rad3_cents,
              prize_rad4_cents, prize_full_house_cents,
              prize_rad1_pct, prize_rad2_pct, prize_rad3_pct,
              prize_rad4_pct, prize_full_house_pct,
              ticket_price_cents, pause_between_rows_ms,
              active, created_at, updated_at, updated_by_user_id
         FROM ${this.schema}.app_spill3_config
        WHERE active = TRUE
        ORDER BY created_at ASC
        LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }
}

// ── Helpers for audit-log ──────────────────────────────────────────────────

/** Serialize-shape for audit-events. Strenger og tall, ingen Date-objekter. */
function serializeForAudit(c: Spill3Config): Record<string, unknown> {
  return {
    id: c.id,
    minTicketsToStart: c.minTicketsToStart,
    prizeMode: c.prizeMode,
    prizeRad1Cents: c.prizeRad1Cents,
    prizeRad2Cents: c.prizeRad2Cents,
    prizeRad3Cents: c.prizeRad3Cents,
    prizeRad4Cents: c.prizeRad4Cents,
    prizeFullHouseCents: c.prizeFullHouseCents,
    prizeRad1Pct: c.prizeRad1Pct,
    prizeRad2Pct: c.prizeRad2Pct,
    prizeRad3Pct: c.prizeRad3Pct,
    prizeRad4Pct: c.prizeRad4Pct,
    prizeFullHousePct: c.prizeFullHousePct,
    ticketPriceCents: c.ticketPriceCents,
    pauseBetweenRowsMs: c.pauseBetweenRowsMs,
    active: c.active,
    updatedAt: c.updatedAt,
  };
}

/** Liste av felter som faktisk endret seg (for audit-log). */
function diffChangedFields(before: Spill3Config, after: Spill3Config): string[] {
  const fields: Array<keyof Spill3Config> = [
    "minTicketsToStart",
    "prizeMode",
    "prizeRad1Cents",
    "prizeRad2Cents",
    "prizeRad3Cents",
    "prizeRad4Cents",
    "prizeFullHouseCents",
    "prizeRad1Pct",
    "prizeRad2Pct",
    "prizeRad3Pct",
    "prizeRad4Pct",
    "prizeFullHousePct",
    "ticketPriceCents",
    "pauseBetweenRowsMs",
  ];
  return fields.filter((f) => before[f] !== after[f]);
}
