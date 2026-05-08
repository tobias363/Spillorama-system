/**
 * Spill 2 (rocket / Tallspill) globalt singleton-konfig (Tobias-direktiv
 * 2026-05-08, parallel til Spill 3 — #1006).
 *
 * Tabell: `app_spill2_config` med partial unique index på `(active=TRUE)`
 * som håndhever singleton (kun én aktiv rad globalt).
 *
 * Ansvar:
 *   - Lese aktiv konfig (read-through cache, 5s TTL — endringer slår inn
 *     ved neste runde-start uten restart).
 *   - Oppdatere konfig (admin via PUT /api/admin/spill2/config).
 *   - Validere åpningstider (HH:MM-format, start <= end), jackpot-tabell-
 *     shape, lucky-number-konsistens (hvis enabled må prize_cents være satt).
 *   - Skrive audit-log-events ved hver oppdatering.
 *
 * Out-of-scope (følger i egen PR ved behov):
 *   - Versjonering / endrings-historikk utover audit-log
 *   - Multi-tenant (per-hall-konfig — bevisst utenfor scope per Tobias-spec)
 *   - Persistens av jackpot-NumberTable utover JSONB (kan splittes til egen
 *     tabell hvis admin trenger versjonering pr tier senere)
 *
 * Mønster: speiler `Spill3ConfigService` (samme schema-håndtering, DomainError-
 * koder, audit-log-injection, cache-strategi).
 */

import { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";

const logger = rootLogger.child({ module: "spill2-config-service" });

/**
 * Min/max-grenser. Holdes synkrone med migration-CHECK-constraints og
 * admin-UI-validering. Per Tobias-direktiv 2026-05-08:
 *   - min_tickets_to_start: 0-1000
 *   - ticket_price_cents: 1-100_000
 *   - round_pause_ms: 1000-300000 (samme som ROUND_PAUSE_MS_MIN/MAX i variantConfig)
 *   - ball_interval_ms: 1000-10000 (samme som BALL_INTERVAL_MS_MIN/MAX)
 *   - lucky_number_prize_cents: 0-1_000_000_00 (sane absolutt-cap)
 */
export const MIN_TICKETS_TO_START_MIN = 0;
export const MIN_TICKETS_TO_START_MAX = 1000;
export const TICKET_PRICE_CENTS_MIN = 1;
export const TICKET_PRICE_CENTS_MAX = 100_000;
export const ROUND_PAUSE_MS_MIN = 1_000;
export const ROUND_PAUSE_MS_MAX = 300_000;
export const BALL_INTERVAL_MS_MIN = 1_000;
export const BALL_INTERVAL_MS_MAX = 10_000;
export const PRIZE_CENTS_MAX = 1_000_000_00; // 1 mill kr i øre

/**
 * Kanoniske jackpot-table-keys. "9".."13" matcher exact draw-count;
 * "1421" matcher draw-count i [14..21]-bucket. Speiler
 * `JACKPOT_TABLE_KEYS` i roomState.ts og `JACKPOT_BUCKET_14_21` i
 * Game2JackpotTable.ts.
 */
export const SPILL2_JACKPOT_KEYS = ["9", "10", "11", "12", "13", "1421"] as const;
export type Spill2JackpotKey = (typeof SPILL2_JACKPOT_KEYS)[number];

export interface Spill2JackpotEntry {
  /** Premie-verdi. isCash=true → flat kr-beløp, isCash=false → prosent (0-100). */
  price: number;
  isCash: boolean;
}

export type Spill2JackpotTable = Record<Spill2JackpotKey, Spill2JackpotEntry>;

export interface Spill2Config {
  id: string;
  /** HH:MM 24h-format, eller null for ingen begrensning. */
  openingTimeStart: string | null;
  openingTimeEnd: string | null;
  minTicketsToStart: number;
  ticketPriceCents: number;
  roundPauseMs: number;
  ballIntervalMs: number;
  /** Validert jackpot-table med alle 6 keys. */
  jackpotNumberTable: Spill2JackpotTable;
  luckyNumberEnabled: boolean;
  luckyNumberPrizeCents: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

/**
 * Partial update — admin sender kun de feltene som skal endres. Service-
 * laget validerer åpningstid-konsistens, jackpot-tabell-shape, og
 * lucky-number-konsistens etter merge.
 */
export interface UpdateSpill2ConfigInput {
  openingTimeStart?: string | null;
  openingTimeEnd?: string | null;
  minTicketsToStart?: number;
  ticketPriceCents?: number;
  roundPauseMs?: number;
  ballIntervalMs?: number;
  jackpotNumberTable?: Spill2JackpotTable;
  luckyNumberEnabled?: boolean;
  luckyNumberPrizeCents?: number | null;
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

function assertNullableInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  return assertNonNegativeInt(value, field, min, max);
}

/**
 * Valider HH:MM-format (24h, 00:00-23:59). Returnerer null for null-input
 * (utgjør "ingen begrensning"). Kaster INVALID_INPUT for ugyldig format.
 */
export function assertOpeningTime(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være en streng på formatet HH:MM eller null.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // HH:MM strict parsing — to-sifret time + minutter med kolon.
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(trimmed);
  if (!match) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være på formatet HH:MM (24-timer).`,
    );
  }
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field}: time må være 0-23 og minutter 0-59.`,
    );
  }
  // Normaliser til to-sifret form ("9:00" → "09:00") for konsistent lagring.
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Valider en enkelt jackpot-table-entry: {price: number, isCash: boolean}.
 * Kaster INVALID_INPUT ved ugyldig shape.
 */
function assertJackpotEntry(raw: unknown, key: string): Spill2JackpotEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DomainError(
      "INVALID_INPUT",
      `jackpotNumberTable["${key}"] må være et objekt med {price, isCash}.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const price = typeof obj.price === "string" ? Number(obj.price) : obj.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `jackpotNumberTable["${key}"].price må være et ikke-negativt tall.`,
    );
  }
  const isCash = obj.isCash;
  if (typeof isCash !== "boolean") {
    throw new DomainError(
      "INVALID_INPUT",
      `jackpotNumberTable["${key}"].isCash må være boolean.`,
    );
  }
  // Hvis isCash=false er price en prosent (0-100) — verifiser bound for å
  // unngå at admin lagrer 1000% av omsetning ved en feil.
  if (!isCash && (price < 0 || price > 100)) {
    throw new DomainError(
      "INVALID_INPUT",
      `jackpotNumberTable["${key}"].price (prosent) må være 0-100 når isCash=false.`,
    );
  }
  return { price, isCash };
}

/**
 * Valider og normaliser hele jackpot-tabellen. Krever alle 6 keys
 * ("9","10","11","12","13","1421"). Kaster INVALID_INPUT ved manglende
 * eller ugyldig key.
 */
export function assertJackpotTable(raw: unknown): Spill2JackpotTable {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DomainError(
      "INVALID_INPUT",
      "jackpotNumberTable må være et objekt med 6 keys (9, 10, 11, 12, 13, 1421).",
    );
  }
  const obj = raw as Record<string, unknown>;
  const out = {} as Spill2JackpotTable;
  for (const key of SPILL2_JACKPOT_KEYS) {
    const entry = obj[key];
    if (entry === undefined) {
      throw new DomainError(
        "INVALID_INPUT",
        `jackpotNumberTable mangler key "${key}". Alle 6 keys må være satt.`,
      );
    }
    out[key] = assertJackpotEntry(entry, key);
  }
  return out;
}

/**
 * Valider at config er internt konsistent etter en partial update:
 *   - Hvis både opening-times er satt: start <= end (samme dag-vindu).
 *     Hvis kun én av dem er satt → INVALID_CONFIG (entweder begge eller
 *     ingen).
 *   - Hvis luckyNumberEnabled=true → luckyNumberPrizeCents må være satt.
 *
 * Kaster DomainError("INVALID_CONFIG") ved inkonsistens. Caller skal
 * bruke denne ETTER at partial-update er merged inn i eksisterende rad
 * (slik at admin kan sende kun delta-felter).
 */
export function assertConfigConsistency(config: Spill2Config): void {
  // Åpningstid-konsistens: enten begge satt eller begge null.
  const startSet = config.openingTimeStart !== null;
  const endSet = config.openingTimeEnd !== null;
  if (startSet !== endSet) {
    throw new DomainError(
      "INVALID_CONFIG",
      "openingTimeStart og openingTimeEnd må enten begge være satt eller begge være null.",
    );
  }
  if (startSet && endSet) {
    // Sammenlign "HH:MM" som strenger — leksikografisk ordning fungerer
    // for to-sifret HH:MM-format ("09:00" < "21:00").
    if ((config.openingTimeStart as string) >= (config.openingTimeEnd as string)) {
      throw new DomainError(
        "INVALID_CONFIG",
        "openingTimeStart må være tidligere enn openingTimeEnd (samme dag-vindu).",
      );
    }
  }
  // Lucky-number-konsistens.
  if (config.luckyNumberEnabled && config.luckyNumberPrizeCents === null) {
    throw new DomainError(
      "INVALID_CONFIG",
      "luckyNumberEnabled=true krever at luckyNumberPrizeCents er satt.",
    );
  }
}

// ── Row-mapping ───────────────────────────────────────────────────────────

interface Spill2ConfigRow {
  id: string;
  opening_time_start: string | null;
  opening_time_end: string | null;
  min_tickets_to_start: number;
  ticket_price_cents: number;
  round_pause_ms: number;
  ball_interval_ms: number;
  jackpot_number_table_json: unknown;
  lucky_number_enabled: boolean;
  lucky_number_prize_cents: number | null;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  updated_by_user_id: string | null;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function mapRow(row: Spill2ConfigRow): Spill2Config {
  // jackpot-tabellen valideres ved load — hvis seed eller manuell DB-skrivning
  // har bommet på shape, kaster vi INVALID_CONFIG her slik at engine ikke
  // trekker baller med korrupt jackpot-tabell.
  const jackpotTable = assertJackpotTable(row.jackpot_number_table_json);
  return {
    id: row.id,
    openingTimeStart: row.opening_time_start,
    openingTimeEnd: row.opening_time_end,
    minTicketsToStart: row.min_tickets_to_start,
    ticketPriceCents: row.ticket_price_cents,
    roundPauseMs: row.round_pause_ms,
    ballIntervalMs: row.ball_interval_ms,
    jackpotNumberTable: jackpotTable,
    luckyNumberEnabled: row.lucky_number_enabled,
    luckyNumberPrizeCents: row.lucky_number_prize_cents,
    active: row.active,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    updatedByUserId: row.updated_by_user_id,
  };
}

// ── Service ───────────────────────────────────────────────────────────────

export interface Spill2ConfigServiceOptions {
  pool: Pool;
  schema?: string;
  auditLogService?: AuditLogService | null;
  /** Cache TTL i ms. Default 5 sek — endringer slår inn ved neste runde. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  config: Spill2Config;
  fetchedAt: number;
}

export class Spill2ConfigService {
  private readonly pool: Pool;
  private readonly schema: string;
  private auditLogService: AuditLogService | null;
  private readonly cacheTtlMs: number;
  private cache: CacheEntry | null = null;

  constructor(options: Spill2ConfigServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLogService = options.auditLogService ?? null;
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
  }

  /** @internal — test-hook (samme mønster som Spill3ConfigService). */
  static forTesting(
    pool: Pool,
    schema = "public",
    auditLogService: AuditLogService | null = null,
    cacheTtlMs = 5_000,
  ): Spill2ConfigService {
    const svc = Object.create(Spill2ConfigService.prototype) as Spill2ConfigService;
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
  async getActive(): Promise<Spill2Config> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.cacheTtlMs) {
      return this.cache.config;
    }
    const row = await this.fetchActiveRow();
    if (!row) {
      throw new DomainError(
        "CONFIG_MISSING",
        "Ingen aktiv Spill 2 config. Migrasjon må kjøres eller admin må aktivere en rad.",
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
   * Update aktiv config (partial). Validerer åpningstid- og lucky-number-
   * konsistens etter merge. Skriver audit-log-event "spill2.config.update"
   * med før/etter-snapshot.
   */
  async update(input: UpdateSpill2ConfigInput): Promise<Spill2Config> {
    if (!input.updatedByUserId || typeof input.updatedByUserId !== "string") {
      throw new DomainError("INVALID_INPUT", "updatedByUserId er påkrevd.");
    }
    const before = await this.getActive();

    // Validate input felter (kaster INVALID_INPUT ved ugyldig shape).
    const partialUpdate: Partial<Spill2Config> = {};
    if (input.openingTimeStart !== undefined) {
      partialUpdate.openingTimeStart = assertOpeningTime(
        input.openingTimeStart,
        "openingTimeStart",
      );
    }
    if (input.openingTimeEnd !== undefined) {
      partialUpdate.openingTimeEnd = assertOpeningTime(
        input.openingTimeEnd,
        "openingTimeEnd",
      );
    }
    if (input.minTicketsToStart !== undefined) {
      partialUpdate.minTicketsToStart = assertNonNegativeInt(
        input.minTicketsToStart,
        "minTicketsToStart",
        MIN_TICKETS_TO_START_MIN,
        MIN_TICKETS_TO_START_MAX,
      );
    }
    if (input.ticketPriceCents !== undefined) {
      partialUpdate.ticketPriceCents = assertPositiveInt(
        input.ticketPriceCents,
        "ticketPriceCents",
        TICKET_PRICE_CENTS_MIN,
        TICKET_PRICE_CENTS_MAX,
      );
    }
    if (input.roundPauseMs !== undefined) {
      partialUpdate.roundPauseMs = assertPositiveInt(
        input.roundPauseMs,
        "roundPauseMs",
        ROUND_PAUSE_MS_MIN,
        ROUND_PAUSE_MS_MAX,
      );
    }
    if (input.ballIntervalMs !== undefined) {
      partialUpdate.ballIntervalMs = assertPositiveInt(
        input.ballIntervalMs,
        "ballIntervalMs",
        BALL_INTERVAL_MS_MIN,
        BALL_INTERVAL_MS_MAX,
      );
    }
    if (input.jackpotNumberTable !== undefined) {
      partialUpdate.jackpotNumberTable = assertJackpotTable(input.jackpotNumberTable);
    }
    if (input.luckyNumberEnabled !== undefined) {
      if (typeof input.luckyNumberEnabled !== "boolean") {
        throw new DomainError(
          "INVALID_INPUT",
          "luckyNumberEnabled må være boolean.",
        );
      }
      partialUpdate.luckyNumberEnabled = input.luckyNumberEnabled;
    }
    if (input.luckyNumberPrizeCents !== undefined) {
      partialUpdate.luckyNumberPrizeCents = assertNullableInt(
        input.luckyNumberPrizeCents,
        "luckyNumberPrizeCents",
        0,
        PRIZE_CENTS_MAX,
      );
    }

    // Merge partial inn i eksisterende, valider total-konsistens.
    const merged: Spill2Config = { ...before, ...partialUpdate };
    assertConfigConsistency(merged);

    // Persist update (UPDATE singleton-rad WHERE id = before.id).
    await this.pool.query(
      `UPDATE ${this.schema}.app_spill2_config
       SET opening_time_start = $2,
           opening_time_end = $3,
           min_tickets_to_start = $4,
           ticket_price_cents = $5,
           round_pause_ms = $6,
           ball_interval_ms = $7,
           jackpot_number_table_json = $8::jsonb,
           lucky_number_enabled = $9,
           lucky_number_prize_cents = $10,
           updated_at = now(),
           updated_by_user_id = $11
       WHERE id = $1`,
      [
        before.id,
        merged.openingTimeStart,
        merged.openingTimeEnd,
        merged.minTicketsToStart,
        merged.ticketPriceCents,
        merged.roundPauseMs,
        merged.ballIntervalMs,
        JSON.stringify(merged.jackpotNumberTable),
        merged.luckyNumberEnabled,
        merged.luckyNumberPrizeCents,
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
          action: "spill2.config.update",
          resource: "spill2_config",
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
          "spill2-config: audit-log failed (best-effort, continuing)",
        );
      }
    }

    logger.info(
      {
        configId: before.id,
        actorId: input.updatedByUserId,
        openingTimeStart: after.openingTimeStart,
        openingTimeEnd: after.openingTimeEnd,
        minTicketsToStart: after.minTicketsToStart,
      },
      "spill2-config: updated",
    );

    return after;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async fetchActiveRow(): Promise<Spill2ConfigRow | null> {
    const result = await this.pool.query<Spill2ConfigRow>(
      `SELECT id, opening_time_start, opening_time_end,
              min_tickets_to_start, ticket_price_cents,
              round_pause_ms, ball_interval_ms,
              jackpot_number_table_json,
              lucky_number_enabled, lucky_number_prize_cents,
              active, created_at, updated_at, updated_by_user_id
         FROM ${this.schema}.app_spill2_config
        WHERE active = TRUE
        ORDER BY created_at ASC
        LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }
}

// ── Helpers for åpningstid-evaluering ──────────────────────────────────────

/**
 * Avgjør om gitt tidspunkt er innenfor konfigurert åpningstid-vindu.
 * Bruker Europe/Oslo-tidssone — bingolokalet kjører i lokal tid.
 *
 * Returnerer:
 *   - true hvis ingen åpningstid er konfigurert (begge null)
 *   - true hvis tidspunkt ∈ [start, end)
 *   - false ellers
 *
 * NB: samme-dag-vindu antas. Over-midnatt-vindu (eks. 22:00-02:00) støttes
 * IKKE i denne pilot-versjonen — admin må sette to konfig-rader hvis
 * de trenger det (out-of-scope per Tobias-direktiv 2026-05-08).
 */
export function isWithinOpeningHours(
  config: Spill2Config,
  now: Date = new Date(),
): boolean {
  // Null-vindu = alltid åpent.
  if (config.openingTimeStart === null || config.openingTimeEnd === null) {
    return true;
  }
  // Hent timer/minutter i Europe/Oslo. Intl.DateTimeFormat med `hour12:false`
  // gir oss to-sifret HH:MM som vi kan sammenligne leksikografisk.
  const oslo = new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  // Format er typisk "HH.MM" eller "HH:MM" avhengig av locale-runtime.
  // Normaliser til kolon for sammenligning.
  const nowHHMM = oslo.replace(".", ":");
  return nowHHMM >= config.openingTimeStart && nowHHMM < config.openingTimeEnd;
}

// ── Helpers for audit-log ──────────────────────────────────────────────────

/** Serialize-shape for audit-events. Strenger og tall, ingen Date-objekter. */
function serializeForAudit(c: Spill2Config): Record<string, unknown> {
  return {
    id: c.id,
    openingTimeStart: c.openingTimeStart,
    openingTimeEnd: c.openingTimeEnd,
    minTicketsToStart: c.minTicketsToStart,
    ticketPriceCents: c.ticketPriceCents,
    roundPauseMs: c.roundPauseMs,
    ballIntervalMs: c.ballIntervalMs,
    jackpotNumberTable: c.jackpotNumberTable,
    luckyNumberEnabled: c.luckyNumberEnabled,
    luckyNumberPrizeCents: c.luckyNumberPrizeCents,
    active: c.active,
    updatedAt: c.updatedAt,
  };
}

/** Liste av felter som faktisk endret seg (for audit-log). */
function diffChangedFields(before: Spill2Config, after: Spill2Config): string[] {
  const fields: Array<keyof Spill2Config> = [
    "openingTimeStart",
    "openingTimeEnd",
    "minTicketsToStart",
    "ticketPriceCents",
    "roundPauseMs",
    "ballIntervalMs",
    "luckyNumberEnabled",
    "luckyNumberPrizeCents",
  ];
  const changed = fields.filter((f) => before[f] !== after[f]);
  // jackpotNumberTable er object — sammenlign via JSON-shallow-stringify.
  // Det dekker "samme keys, samme verdier" siden vi har strict whitelist.
  if (
    JSON.stringify(before.jackpotNumberTable) !==
    JSON.stringify(after.jackpotNumberTable)
  ) {
    changed.push("jackpotNumberTable");
  }
  return changed;
}
