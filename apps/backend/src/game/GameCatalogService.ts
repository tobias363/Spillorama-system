/**
 * Fase 1 (2026-05-07): GameCatalogService — admin-CRUD for spillkatalog.
 *
 * Tabell: `app_game_catalog` (én rad per "type spill" — Jackpot, Innsatsen,
 * Trafikklys osv.). Service-laget validerer ticket-farge-whitelist
 * (gul/hvit/lilla), bonus-game-slug-whitelist, prizes/prices-skjema og
 * slug-format.
 *
 * Audit-log-events skrives via en injisert `AuditLogService`-instans —
 * service-laget håndterer egen feiltoleranse (audit-feil blokkerer ikke
 * domain-operasjoner).
 *
 * Mønsteret følger `GameTypeService` (BIN-620) + `PatternService` (BIN-627):
 *   - Object.create-pattern for tester (forTesting + makeValidatingService)
 *   - DomainError med stabil kode
 *   - Soft-delete via is_active=false (ingen deleted_at i Fase 1 — kan
 *     legges til senere hvis Fase 4 trenger full historikk)
 *
 * Out-of-scope for Fase 1:
 *   - Routes (Fase 3)
 *   - Admin-UI (Fase 2)
 *   - Data-migrasjon (Fase 4)
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  CreateGameCatalogInput,
  GameCatalogEntry,
  ListGameCatalogFilter,
  PrizeMultiplierMode,
  PrizesCents,
  TicketColor,
  UpdateGameCatalogInput,
} from "./gameCatalog.types.js";
import {
  BONUS_GAME_SLUG_VALUES,
  PRIZE_MULTIPLIER_MODE_VALUES,
  TICKET_COLOR_VALUES,
} from "./gameCatalog.types.js";

const logger = rootLogger.child({ module: "game-catalog-service" });

const VALID_TICKET_COLORS = new Set<TicketColor>(TICKET_COLOR_VALUES);
const VALID_BONUS_GAME_SLUGS = new Set<string>(BONUS_GAME_SLUG_VALUES);
const VALID_PRIZE_MULTIPLIER_MODES = new Set<PrizeMultiplierMode>(
  PRIZE_MULTIPLIER_MODE_VALUES,
);
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SLUG_LENGTH = 80;

/**
 * Premise (Tobias 2026-05-07): billigste bong er ALLTID 5 kr (500 øre).
 * Auto-multiplikator beregner premie = base × (ticketPrice / 500).
 */
export const CHEAPEST_TICKET_PRICE_CENTS = 500;

/**
 * Beregn faktisk premie for en gitt katalog-entry og bong-pris.
 *
 * - "auto"-modus: returnerer `basePrize × (ticketPriceCents / 500)`,
 *   avrundet til nærmeste hele øre. Brukes både for rad-premier og
 *   bingoBase.
 * - "explicit_per_color"-modus: returnerer `basePrize` uendret —
 *   caller har allerede slått opp riktig farge-spesifikk premie i
 *   `prizesCents.bingo[color]` eller `rules.prizesPerRowColor`.
 *
 * Cheapest-pris er hardkodet til 500 øre (5 kr) per Tobias' premise —
 * hvis det noensinne endres må både migrasjons-skriptet og denne
 * helper-en oppdateres samtidig.
 */
export function calculateActualPrize(
  catalog: Pick<GameCatalogEntry, "prizeMultiplierMode">,
  basePrizeCents: number,
  ticketPriceCents: number,
): number {
  if (catalog.prizeMultiplierMode === "explicit_per_color") {
    return basePrizeCents;
  }
  // auto-modus
  if (
    !Number.isFinite(basePrizeCents) ||
    !Number.isFinite(ticketPriceCents) ||
    ticketPriceCents <= 0
  ) {
    return 0;
  }
  const multiplier = ticketPriceCents / CHEAPEST_TICKET_PRICE_CENTS;
  return Math.round(basePrizeCents * multiplier);
}

// ── input-validering ────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${max} tegn.`,
    );
  }
  return trimmed;
}

function assertSlug(value: unknown, field = "slug"): string {
  const s = assertNonEmptyString(value, field, MAX_SLUG_LENGTH);
  if (!SLUG_REGEX.test(s)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være lowercase, alfanumerisk eller bindestrek (eks. "jackpot-1").`,
    );
  }
  return s;
}

function assertTicketColors(value: unknown): TicketColor[] {
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "ticketColors må være en liste.");
  }
  if (value.length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "ticketColors må ha minst én farge.",
    );
  }
  const seen = new Set<TicketColor>();
  const result: TicketColor[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new DomainError(
        "INVALID_INPUT",
        "ticketColors må være en liste av strenger.",
      );
    }
    const normalised = raw.trim().toLowerCase() as TicketColor;
    if (!VALID_TICKET_COLORS.has(normalised)) {
      throw new DomainError(
        "INVALID_INPUT",
        `ticketColors må være subset av ${TICKET_COLOR_VALUES.join(", ")} (fikk "${raw}").`,
      );
    }
    if (!seen.has(normalised)) {
      seen.add(normalised);
      result.push(normalised);
    }
  }
  return result;
}

function assertPositiveCentsMap(
  value: unknown,
  field: string,
  allowedColors: Set<TicketColor>,
): Partial<Record<TicketColor, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  const out: Partial<Record<TicketColor, number>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowedColors.has(key as TicketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field}.${key} matcher ikke aktive ticketColors.`,
      );
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field}.${key} må være positivt heltall (øre).`,
      );
    }
    out[key as TicketColor] = n;
  }
  return out;
}

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være ikke-negativt heltall (øre).`,
    );
  }
  return n;
}

function assertPrizeMultiplierMode(value: unknown): PrizeMultiplierMode {
  if (value === undefined || value === null) return "auto";
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      "prizeMultiplierMode må være en streng.",
    );
  }
  const normalised = value.trim().toLowerCase() as PrizeMultiplierMode;
  if (!VALID_PRIZE_MULTIPLIER_MODES.has(normalised)) {
    throw new DomainError(
      "INVALID_INPUT",
      `prizeMultiplierMode må være én av ${PRIZE_MULTIPLIER_MODE_VALUES.join(", ")}.`,
    );
  }
  return normalised;
}

/**
 * Validér prizes-skjema basert på premie-modus.
 *
 * - "auto"-modus: krever `bingoBase` som int > 0; ignorerer `bingo`-
 *   per-farge-objektet (men tolererer at det finnes for backwards-
 *   compat).
 * - "explicit_per_color"-modus: krever `bingo` som per-farge-objekt
 *   (gammel shape, samme validering som før).
 */
function assertPrizesCents(
  value: unknown,
  ticketColors: TicketColor[],
  mode: PrizeMultiplierMode,
): PrizesCents {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "prizesCents må være et objekt.");
  }
  const obj = value as Record<string, unknown>;
  const rad1 = assertNonNegativeInt(obj.rad1, "prizesCents.rad1");
  const rad2 = assertNonNegativeInt(obj.rad2, "prizesCents.rad2");
  const rad3 = assertNonNegativeInt(obj.rad3, "prizesCents.rad3");
  const rad4 = assertNonNegativeInt(obj.rad4, "prizesCents.rad4");
  const allowed = new Set<TicketColor>(ticketColors);

  if (mode === "auto") {
    // Auto-modus krever én base — bingoBase. bingo-per-farge ignoreres
    // men aksepteres (backwards-compat for klienter som sender begge).
    if (obj.bingoBase === undefined || obj.bingoBase === null) {
      throw new DomainError(
        "INVALID_INPUT",
        "prizesCents.bingoBase er påkrevd i auto-modus (gjelder billigste bong).",
      );
    }
    const bingoBase = Number(obj.bingoBase);
    if (
      !Number.isFinite(bingoBase) ||
      !Number.isInteger(bingoBase) ||
      bingoBase <= 0
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "prizesCents.bingoBase må være positivt heltall (øre).",
      );
    }
    // Behold eventuelt eksisterende bingo-objekt for backwards-compat,
    // men valider at hvis det finnes, så er det et objekt med kjente
    // farger (vi vil ikke ha sløkkede strukturer i DB).
    let bingo: Partial<Record<TicketColor, number>> = {};
    if (obj.bingo !== undefined && obj.bingo !== null) {
      if (typeof obj.bingo !== "object" || Array.isArray(obj.bingo)) {
        throw new DomainError(
          "INVALID_INPUT",
          "prizesCents.bingo må være et objekt eller utelates.",
        );
      }
      bingo = assertPositiveCentsMap(obj.bingo, "prizesCents.bingo", allowed);
    }
    return { rad1, rad2, rad3, rad4, bingoBase, bingo };
  }

  // explicit_per_color-modus: per-farge bingo (gammel shape)
  if (
    !obj.bingo ||
    typeof obj.bingo !== "object" ||
    Array.isArray(obj.bingo)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "prizesCents.bingo må være et objekt med per-bongfarge-beløp i explicit_per_color-modus.",
    );
  }
  const bingo = assertPositiveCentsMap(obj.bingo, "prizesCents.bingo", allowed);
  // Hver aktiv farge bør ha en bingo-premie. Service-laget krever ikke at
  // alle ticketColors finnes i bingo-mappen (admin kan rulle ut nye farger
  // gradvis), men hvis nøkler IKKE er i ticketColors blir det avvist over.
  return { rad1, rad2, rad3, rad4, bingo };
}

function assertBonusGameSlug(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      "bonusGameSlug må være en streng eller null.",
    );
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;
  if (!VALID_BONUS_GAME_SLUGS.has(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `bonusGameSlug må være én av ${BONUS_GAME_SLUG_VALUES.join(", ")}.`,
    );
  }
  return trimmed;
}

function assertRulesObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "rules må være et objekt.");
  }
  return value as Record<string, unknown>;
}

function assertNonNegativeIntField(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være ikke-negativt heltall.`,
    );
  }
  return n;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}

// ── row-mapping ─────────────────────────────────────────────────────────

interface GameCatalogRow {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  rules_json: unknown;
  ticket_colors_json: unknown;
  ticket_prices_cents_json: unknown;
  prizes_cents_json: unknown;
  prize_multiplier_mode: string;
  bonus_game_slug: string | null;
  bonus_game_enabled: boolean;
  requires_jackpot_setup: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
  created_by_user_id: string | null;
}

function parseTicketColors(raw: unknown): TicketColor[] {
  if (!Array.isArray(raw)) return [];
  const out: TicketColor[] = [];
  const seen = new Set<TicketColor>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const c = v.trim().toLowerCase() as TicketColor;
    if (VALID_TICKET_COLORS.has(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

function parseCentsMap(raw: unknown): Partial<Record<TicketColor, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<TicketColor, number>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_TICKET_COLORS.has(k as TicketColor)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      out[k as TicketColor] = n;
    }
  }
  return out;
}

function parsePrizesCents(raw: unknown): PrizesCents {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { rad1: 0, rad2: 0, rad3: 0, rad4: 0, bingo: {} };
  }
  const obj = raw as Record<string, unknown>;
  const num = (k: string): number => {
    const n = Number(obj[k]);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : 0;
  };
  const result: PrizesCents = {
    rad1: num("rad1"),
    rad2: num("rad2"),
    rad3: num("rad3"),
    rad4: num("rad4"),
    bingo: parseCentsMap(obj.bingo),
  };
  // bingoBase er bare relevant for "auto"-modus, men vi parser den
  // alltid hvis den finnes — caller (mapRow + helpers) bruker den når
  // mode = "auto".
  if (obj.bingoBase !== undefined) {
    const n = Number(obj.bingoBase);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      result.bingoBase = n;
    }
  }
  return result;
}

function parsePrizeMultiplierMode(raw: unknown): PrizeMultiplierMode {
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase() as PrizeMultiplierMode;
    if (VALID_PRIZE_MULTIPLIER_MODES.has(v)) return v;
  }
  return "auto";
}

function mapRow(row: GameCatalogRow): GameCatalogEntry {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    rules:
      row.rules_json && typeof row.rules_json === "object" && !Array.isArray(row.rules_json)
        ? (row.rules_json as Record<string, unknown>)
        : {},
    ticketColors: parseTicketColors(row.ticket_colors_json),
    ticketPricesCents: parseCentsMap(row.ticket_prices_cents_json),
    prizesCents: parsePrizesCents(row.prizes_cents_json),
    prizeMultiplierMode: parsePrizeMultiplierMode(row.prize_multiplier_mode),
    bonusGameSlug:
      row.bonus_game_slug &&
      VALID_BONUS_GAME_SLUGS.has(row.bonus_game_slug.toLowerCase())
        ? (row.bonus_game_slug as GameCatalogEntry["bonusGameSlug"])
        : null,
    bonusGameEnabled: Boolean(row.bonus_game_enabled),
    requiresJackpotSetup: Boolean(row.requires_jackpot_setup),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    createdByUserId: row.created_by_user_id,
  };
}

// ── service ─────────────────────────────────────────────────────────────

export interface GameCatalogServiceOptions {
  pool: Pool;
  schema?: string;
  auditLogService?: AuditLogService | null;
}

export class GameCatalogService {
  private readonly pool: Pool;
  private readonly schema: string;
  private auditLogService: AuditLogService | null;

  constructor(options: GameCatalogServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLogService = options.auditLogService ?? null;
  }

  /** @internal — test-hook (matcher GameTypeService.forTesting). */
  static forTesting(
    pool: Pool,
    schema = "public",
    auditLogService: AuditLogService | null = null,
  ): GameCatalogService {
    const svc = Object.create(GameCatalogService.prototype) as GameCatalogService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as {
      auditLogService: AuditLogService | null;
    }).auditLogService = auditLogService;
    return svc;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  private table(): string {
    return `"${this.schema}"."app_game_catalog"`;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(filter: ListGameCatalogFilter = {}): Promise<GameCatalogEntry[]> {
    const limit =
      filter.limit && filter.limit > 0
        ? Math.min(Math.floor(filter.limit), 500)
        : 200;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filter.isActive !== undefined) {
      params.push(Boolean(filter.isActive));
      conditions.push(`is_active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<GameCatalogRow>(
      `SELECT id, slug, display_name, description, rules_json,
              ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
              prize_multiplier_mode,
              bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
              is_active, sort_order, created_at, updated_at, created_by_user_id
       FROM ${this.table()}
       ${where}
       ORDER BY sort_order ASC, display_name ASC, created_at ASC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(mapRow);
  }

  async getById(id: string): Promise<GameCatalogEntry | null> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<GameCatalogRow>(
      `SELECT id, slug, display_name, description, rules_json,
              ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
              prize_multiplier_mode,
              bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
              is_active, sort_order, created_at, updated_at, created_by_user_id
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async getByIds(ids: string[]): Promise<GameCatalogEntry[]> {
    const uniqueIds = Array.from(
      new Set(ids.map((id) => id?.trim()).filter(Boolean)),
    );
    if (uniqueIds.length === 0) return [];

    const { rows } = await this.pool.query<GameCatalogRow>(
      `SELECT id, slug, display_name, description, rules_json,
              ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
              prize_multiplier_mode,
              bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
              is_active, sort_order, created_at, updated_at, created_by_user_id
       FROM ${this.table()}
       WHERE id = ANY($1::text[])`,
      [uniqueIds],
    );
    return rows.map(mapRow);
  }

  async getBySlug(slug: string): Promise<GameCatalogEntry | null> {
    if (!slug?.trim()) {
      throw new DomainError("INVALID_INPUT", "slug er påkrevd.");
    }
    const normalised = slug.trim().toLowerCase();
    const { rows } = await this.pool.query<GameCatalogRow>(
      `SELECT id, slug, display_name, description, rules_json,
              ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
              prize_multiplier_mode,
              bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
              is_active, sort_order, created_at, updated_at, created_by_user_id
       FROM ${this.table()}
       WHERE slug = $1`,
      [normalised],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  // ── writes ────────────────────────────────────────────────────────────

  async create(
    input: CreateGameCatalogInput,
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: input.createdByUserId,
      actorType: "ADMIN",
    },
  ): Promise<GameCatalogEntry> {
    const slug = assertSlug(input.slug);
    const displayName = assertNonEmptyString(
      input.displayName,
      "displayName",
      MAX_NAME_LENGTH,
    );
    const description =
      input.description === undefined || input.description === null
        ? null
        : input.description.trim().length === 0
          ? null
          : assertNonEmptyString(
              input.description,
              "description",
              MAX_DESCRIPTION_LENGTH,
            );
    const rules = assertRulesObject(input.rules);
    const ticketColors =
      input.ticketColors !== undefined
        ? assertTicketColors(input.ticketColors)
        : (["gul", "hvit"] as TicketColor[]);
    const allowedColorSet = new Set<TicketColor>(ticketColors);
    const ticketPricesCents =
      input.ticketPricesCents !== undefined
        ? assertPositiveCentsMap(
            input.ticketPricesCents,
            "ticketPricesCents",
            allowedColorSet,
          )
        : Object.fromEntries(
            ticketColors.map((c) => [c, c === "gul" ? 1000 : c === "hvit" ? 500 : 2000]),
          );
    // Hver aktiv farge må ha en pris.
    for (const c of ticketColors) {
      if (ticketPricesCents[c] === undefined) {
        throw new DomainError(
          "INVALID_INPUT",
          `ticketPricesCents.${c} mangler — alle aktive ticketColors må ha pris.`,
        );
      }
    }
    const prizeMultiplierMode = assertPrizeMultiplierMode(
      input.prizeMultiplierMode,
    );
    const prizesCents = assertPrizesCents(
      input.prizesCents,
      ticketColors,
      prizeMultiplierMode,
    );
    const bonusGameSlug = assertBonusGameSlug(input.bonusGameSlug);
    const bonusGameEnabled = input.bonusGameEnabled === true;
    if (bonusGameEnabled && bonusGameSlug === null) {
      throw new DomainError(
        "INVALID_INPUT",
        "bonusGameEnabled=true krever bonusGameSlug.",
      );
    }
    const requiresJackpotSetup = input.requiresJackpotSetup === true;
    const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
    const sortOrder =
      input.sortOrder === undefined
        ? 0
        : assertNonNegativeIntField(input.sortOrder, "sortOrder");
    const createdByUserId = assertNonEmptyString(
      input.createdByUserId,
      "createdByUserId",
      200,
    );

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, slug, display_name, description, rules_json,
            ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
            prize_multiplier_mode,
            bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
            is_active, sort_order, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
                 $9,
                 $10, $11, $12, $13, $14, $15)`,
        [
          id,
          slug,
          displayName,
          description,
          JSON.stringify(rules),
          JSON.stringify(ticketColors),
          JSON.stringify(ticketPricesCents),
          JSON.stringify(prizesCents),
          prizeMultiplierMode,
          bonusGameSlug,
          bonusGameEnabled,
          requiresJackpotSetup,
          isActive,
          sortOrder,
          createdByUserId,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "GAME_CATALOG_DUPLICATE",
          `Spillkatalog med slug '${slug}' finnes allerede.`,
        );
      }
      throw err;
    }
    const created = await this.getById(id);
    if (!created) {
      throw new DomainError(
        "GAME_CATALOG_NOT_FOUND",
        "Spillkatalog forsvant rett etter oppretting.",
      );
    }
    void this.audit(
      {
        actorId: actor.actorId,
        actorType: actor.actorType ?? "ADMIN",
        action: "game_catalog.create",
        resourceId: id,
        details: {
          slug,
          displayName,
          ticketColors,
          prizeMultiplierMode,
          requiresJackpotSetup,
          bonusGameSlug,
        },
      },
    );
    return created;
  }

  async update(
    id: string,
    patch: UpdateGameCatalogInput,
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: "system",
      actorType: "ADMIN",
    },
  ): Promise<GameCatalogEntry> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const existing = await this.getById(id.trim());
    if (!existing) {
      throw new DomainError(
        "GAME_CATALOG_NOT_FOUND",
        "Spillkatalog finnes ikke.",
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.slug !== undefined) {
      sets.push(`slug = $${params.length + 1}`);
      params.push(assertSlug(patch.slug));
    }
    if (patch.displayName !== undefined) {
      sets.push(`display_name = $${params.length + 1}`);
      params.push(
        assertNonEmptyString(patch.displayName, "displayName", MAX_NAME_LENGTH),
      );
    }
    if (patch.description !== undefined) {
      const desc =
        patch.description === null
          ? null
          : patch.description.trim().length === 0
            ? null
            : assertNonEmptyString(
                patch.description,
                "description",
                MAX_DESCRIPTION_LENGTH,
              );
      sets.push(`description = $${params.length + 1}`);
      params.push(desc);
    }
    if (patch.rules !== undefined) {
      sets.push(`rules_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertRulesObject(patch.rules)));
    }

    // ticketColors + ticketPricesCents + prizesCents må valideres sammen
    // (cross-field). Vi resolver til "endelige" verdier først.
    const finalTicketColors =
      patch.ticketColors !== undefined
        ? assertTicketColors(patch.ticketColors)
        : existing.ticketColors;
    const finalAllowedSet = new Set<TicketColor>(finalTicketColors);

    if (patch.ticketColors !== undefined) {
      sets.push(`ticket_colors_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(finalTicketColors));
    }

    if (patch.ticketPricesCents !== undefined) {
      const prices = assertPositiveCentsMap(
        patch.ticketPricesCents,
        "ticketPricesCents",
        finalAllowedSet,
      );
      // Hver aktiv farge må ha en pris.
      for (const c of finalTicketColors) {
        if (prices[c] === undefined) {
          throw new DomainError(
            "INVALID_INPUT",
            `ticketPricesCents.${c} mangler — alle aktive ticketColors må ha pris.`,
          );
        }
      }
      sets.push(`ticket_prices_cents_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(prices));
    } else if (patch.ticketColors !== undefined) {
      // Hvis ticketColors endres uten at prices oppdateres, må vi sjekke
      // at eksisterende prices fortsatt dekker alle nye farger.
      for (const c of finalTicketColors) {
        if (existing.ticketPricesCents[c] === undefined) {
          throw new DomainError(
            "INVALID_INPUT",
            `ticketColors utvidet til ${c} — oppdater ticketPricesCents samtidig.`,
          );
        }
      }
    }

    // Resolve final mode before validating prizes (cross-field).
    const finalPrizeMode: PrizeMultiplierMode =
      patch.prizeMultiplierMode !== undefined
        ? assertPrizeMultiplierMode(patch.prizeMultiplierMode)
        : existing.prizeMultiplierMode;

    if (patch.prizeMultiplierMode !== undefined) {
      sets.push(`prize_multiplier_mode = $${params.length + 1}`);
      params.push(finalPrizeMode);
    }

    if (patch.prizesCents !== undefined) {
      const prizes = assertPrizesCents(
        patch.prizesCents,
        finalTicketColors,
        finalPrizeMode,
      );
      sets.push(`prizes_cents_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(prizes));
    } else if (patch.prizeMultiplierMode !== undefined) {
      // Mode endret uten å sende inn nye prizes — re-valider eksisterende
      // prizes mot ny mode for å unngå inkonsistente DB-rader.
      try {
        assertPrizesCents(
          existing.prizesCents,
          finalTicketColors,
          finalPrizeMode,
        );
      } catch (err) {
        if (err instanceof DomainError) {
          throw new DomainError(
            "INVALID_INPUT",
            `prizeMultiplierMode endret til ${finalPrizeMode}, men eksisterende prizesCents passer ikke nye modus: ${err.message}`,
          );
        }
        throw err;
      }
    }

    if (patch.bonusGameSlug !== undefined) {
      sets.push(`bonus_game_slug = $${params.length + 1}`);
      params.push(assertBonusGameSlug(patch.bonusGameSlug));
    }
    if (patch.bonusGameEnabled !== undefined) {
      if (typeof patch.bonusGameEnabled !== "boolean") {
        throw new DomainError(
          "INVALID_INPUT",
          "bonusGameEnabled må være boolean.",
        );
      }
      // Cross-field: bonus_game_enabled=true krever bonus_game_slug.
      const finalSlug =
        patch.bonusGameSlug !== undefined
          ? assertBonusGameSlug(patch.bonusGameSlug)
          : existing.bonusGameSlug;
      if (patch.bonusGameEnabled === true && finalSlug === null) {
        throw new DomainError(
          "INVALID_INPUT",
          "bonusGameEnabled=true krever bonusGameSlug.",
        );
      }
      sets.push(`bonus_game_enabled = $${params.length + 1}`);
      params.push(patch.bonusGameEnabled);
    }
    if (patch.requiresJackpotSetup !== undefined) {
      if (typeof patch.requiresJackpotSetup !== "boolean") {
        throw new DomainError(
          "INVALID_INPUT",
          "requiresJackpotSetup må være boolean.",
        );
      }
      sets.push(`requires_jackpot_setup = $${params.length + 1}`);
      params.push(patch.requiresJackpotSetup);
    }
    if (patch.isActive !== undefined) {
      if (typeof patch.isActive !== "boolean") {
        throw new DomainError("INVALID_INPUT", "isActive må være boolean.");
      }
      sets.push(`is_active = $${params.length + 1}`);
      params.push(patch.isActive);
    }
    if (patch.sortOrder !== undefined) {
      sets.push(`sort_order = $${params.length + 1}`);
      params.push(assertNonNegativeIntField(patch.sortOrder, "sortOrder"));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    sets.push("updated_at = now()");
    params.push(existing.id);
    try {
      await this.pool.query(
        `UPDATE ${this.table()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}`,
        params,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "GAME_CATALOG_DUPLICATE",
          "Slug finnes allerede.",
        );
      }
      throw err;
    }
    const updated = await this.getById(existing.id);
    if (!updated) {
      throw new DomainError(
        "GAME_CATALOG_NOT_FOUND",
        "Spillkatalog forsvant under update.",
      );
    }
    void this.audit({
      actorId: actor.actorId,
      actorType: actor.actorType ?? "ADMIN",
      action: "game_catalog.update",
      resourceId: existing.id,
      details: {
        slug: updated.slug,
        changedFields: Object.keys(patch),
      },
    });
    return updated;
  }

  /**
   * Soft-delete via is_active=false. Hard-delete er ikke støttet i Fase 1
   * — bruk `update(id, { isActive: false })` direkte hvis du vil oppdatere
   * noen andre felt samtidig. Her gir vi en navngitt entry-point for at
   * admin-UI kan kalle den eksplisitt.
   */
  async deactivate(
    id: string,
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: "system",
      actorType: "ADMIN",
    },
  ): Promise<void> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const existing = await this.getById(id.trim());
    if (!existing) {
      throw new DomainError(
        "GAME_CATALOG_NOT_FOUND",
        "Spillkatalog finnes ikke.",
      );
    }
    if (!existing.isActive) {
      // Idempotent — allerede deaktivert.
      return;
    }
    await this.pool.query(
      `UPDATE ${this.table()}
       SET is_active = FALSE, updated_at = now()
       WHERE id = $1`,
      [existing.id],
    );
    void this.audit({
      actorId: actor.actorId,
      actorType: actor.actorType ?? "ADMIN",
      action: "game_catalog.deactivate",
      resourceId: existing.id,
      details: { slug: existing.slug },
    });
  }

  // ── audit-helper ──────────────────────────────────────────────────────

  private async audit(input: {
    actorId: string;
    actorType: "ADMIN" | "USER";
    action: string;
    resourceId: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogService) return;
    try {
      await this.auditLogService.record({
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        resource: "game_catalog",
        resourceId: input.resourceId,
        details: input.details,
      });
    } catch (err) {
      logger.warn(
        { err, action: input.action },
        "[fase-1] audit-log feilet — fortsetter",
      );
    }
  }
}
