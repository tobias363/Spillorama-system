/**
 * G9: ETL-modul for å importere legacy MongoDB sub-game-maler til ny stack.
 *
 * Per `docs/architecture/SUBGAME_LEGACY_PARITY_AUDIT_2026-04-27.md` har legacy
 * MongoDB sub-game-maler som er nødvendig før prod-pilot. Denne modulen tar
 * legacy-mal-objekter (JSON, eksportert fra MongoDB) og persister dem til:
 *
 *   - app_game_types  (GameType-katalog,  BIN-620)
 *   - app_sub_games   (SubGame-katalog,   BIN-621)
 *   - app_patterns    (Mønster-katalog,   BIN-627)
 *
 * Designvalg:
 *   - **Generisk format-input**: Vi har ikke direkte MongoDB-tilgang i
 *     agent-konteksten. ETL aksepterer derfor et generelt JSON-format som
 *     spaner alle tre tabellene i en enkelt mal-oppføring (legacy-MongoDB
 *     hadde subGame1Templates / gameTypes / patterns som separate
 *     collections, men eksport til JSON kan flate ut alt). Format støtter
 *     også top-level arrays per resurs-type for fleksibilitet.
 *   - **Validering**: Hver oppføring valideres mot Zod-schema før insert.
 *     Ugyldige rader logges til feil-rapport men stopper ikke import av
 *     resten.
 *   - **Idempotent**: UPSERT på naturlige nøkler:
 *       - GameType: `type_slug` (legacy `slug`/`gameTypeSlug`)
 *       - SubGame: `sub_game_number` (legacy `subGameNumber`/`legacyId`)
 *       - Pattern: `(game_type_id, pattern_number)` — pattern_number er
 *         enten legacy `patternNumber` eller utledet fra navnet.
 *     Re-import oppdaterer eksisterende rader (UPDATE) i stedet for å
 *     opprette duplikater.
 *   - **Dry-run**: `dryRun: true` validerer + rapporterer uten DB-writes.
 *   - **Mapping**: Felter mappes 1:1 der mulig. Ekstra legacy-felt går i
 *     `extra_json`. Mapper-laget bevarer `legacy_id` der mulig.
 *
 * Bruk:
 *   - CLI-wrapper: `apps/backend/scripts/import-legacy-subgame-templates.ts`
 *   - Direkte: `runImport(client, payload, options)`
 */

import { randomUUID } from "node:crypto";
import type { Client, PoolClient } from "pg";
import { z } from "zod";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * En "client-lignende" pg-instans som tilbyr query() — gjør det mulig å
 * sende inn både `pg.Client`, `pg.PoolClient` og test-stub uten å låse
 * implementasjonen til én konkret klasse.
 */
export interface QueryClient {
  query: Client["query"] | PoolClient["query"];
}

export interface ImportOptions {
  /** Hvis true: valider men gjør ingen INSERT/UPDATE. */
  dryRun?: boolean;
  /** Schema-prefiks. Default 'public'. */
  schema?: string;
  /** Created-by-id som settes på nye rader. Default 'system-etl'. */
  createdBy?: string;
  /** Logger — default console. Mock i tester. */
  logger?: ImportLogger;
}

export interface ImportLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface ImportRecordResult {
  resource: "gameType" | "subGame" | "pattern";
  /** Naturlig nøkkel (slug, sub_game_number, pattern_number). */
  key: string;
  action: "created" | "updated" | "skipped" | "failed";
  reason?: string;
  id?: string;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  records: ImportRecordResult[];
}

// ── Zod schemas for legacy input ────────────────────────────────────────────

/**
 * Defensivt schema — alle felter er optional og service-laget bygger
 * fornuftige defaults der mulig. Vi er strenge på type-validering (string
 * må være string, number må være number) men tolerante på struktur.
 */

const LegacyPatternRowSchema = z.object({
  /** Stable referanse — UUID eller legacy ObjectId-string. */
  patternId: z.string().min(1),
  name: z.string().min(1),
});

export const LegacyPatternSchema = z.object({
  /** Stable identifikator fra legacy. */
  patternNumber: z.string().min(1).optional(),
  legacyId: z.string().min(1).optional(),
  /** Påkrevd: hvilken GameType mønsteret hører til. */
  gameTypeSlug: z.string().min(1).optional(),
  gameTypeId: z.string().min(1).optional(),
  gameName: z.string().min(1).optional(),
  name: z.string().min(1),
  /** 25-bit bitmask (5x5). */
  mask: z.number().int().min(0).max(0x1ffffff),
  claimType: z.enum(["LINE", "BINGO"]).optional(),
  prizePercent: z.number().min(0).max(100).optional(),
  orderIndex: z.number().int().min(0).optional(),
  design: z.number().int().min(0).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  isWoF: z.boolean().optional(),
  isTchest: z.boolean().optional(),
  isMys: z.boolean().optional(),
  isRowPr: z.boolean().optional(),
  rowPercentage: z.number().min(0).optional(),
  isJackpot: z.boolean().optional(),
  isGameTypeExtra: z.boolean().optional(),
  isLuckyBonus: z.boolean().optional(),
  patternPlace: z.string().nullable().optional(),
  /** Ekstra legacy-felter — bevares i extra_json. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const LegacyGameTypeSchema = z.object({
  /** Stabil slug — sannhet for upsert. */
  typeSlug: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  legacyId: z.string().min(1).optional(),
  name: z.string().min(1),
  photo: z.string().optional(),
  pattern: z.boolean().optional(),
  gridRows: z.number().int().positive().optional(),
  gridColumns: z.number().int().positive().optional(),
  rangeMin: z.number().int().nullable().optional(),
  rangeMax: z.number().int().nullable().optional(),
  totalNoTickets: z.number().int().positive().nullable().optional(),
  userMaxTickets: z.number().int().positive().nullable().optional(),
  luckyNumbers: z.array(z.number().int()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const LegacySubGameSchema = z.object({
  /** Påkrevd: hvilken GameType sub-game tilhører (slug eller id). */
  gameTypeSlug: z.string().min(1).optional(),
  gameTypeId: z.string().min(1).optional(),
  gameName: z.string().min(1).optional(),
  name: z.string().min(1),
  subGameNumber: z.string().min(1).optional(),
  legacyId: z.string().min(1).optional(),
  patternRows: z.array(LegacyPatternRowSchema).optional(),
  ticketColors: z.array(z.string().min(1)).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Top-level payload-format. Akseptérer både:
 *   - `{ gameTypes: [...], subGames: [...], patterns: [...] }`
 *   - Legacy aliaser: `subGame1Templates`, `gameTypeTemplates`, `patternTemplates`
 *
 * Ukjente top-level keys ignoreres med warning, så et rå MongoDB-dump kan
 * sendes uten preprosessering.
 */
export const LegacyPayloadSchema = z
  .object({
    gameTypes: z.array(LegacyGameTypeSchema).optional(),
    gameTypeTemplates: z.array(LegacyGameTypeSchema).optional(),
    subGames: z.array(LegacySubGameSchema).optional(),
    subGame1Templates: z.array(LegacySubGameSchema).optional(),
    subGameTemplates: z.array(LegacySubGameSchema).optional(),
    patterns: z.array(LegacyPatternSchema).optional(),
    patternTemplates: z.array(LegacyPatternSchema).optional(),
  })
  .passthrough();

export type LegacyPattern = z.infer<typeof LegacyPatternSchema>;
export type LegacyGameType = z.infer<typeof LegacyGameTypeSchema>;
export type LegacySubGame = z.infer<typeof LegacySubGameSchema>;
export type LegacyPayload = z.infer<typeof LegacyPayloadSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Ugyldig schema-navn: ${schema}`);
  }
  return schema;
}

function defaultLogger(): ImportLogger {
  return {
    info: (msg: string) => console.log(msg),
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
  };
}

function nullLogger(): ImportLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function pickSlug(input: LegacyGameType): string | null {
  return (input.typeSlug ?? input.slug ?? input.legacyId ?? null) || null;
}

function pickGameTypeRef(input: LegacySubGame | LegacyPattern): string | null {
  return (input.gameTypeSlug ?? input.gameTypeId ?? null) || null;
}

function deriveSubGameNumber(input: LegacySubGame): string {
  if (input.subGameNumber) return input.subGameNumber;
  if (input.legacyId) return `SG_LEGACY_${input.legacyId}`;
  // Stable derivation: navn + game-type-ref. Lower-case, alfanumerisk.
  const ref = pickGameTypeRef(input) ?? "unknown";
  const slug = `${ref}_${input.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `SG_${slug}`;
}

function derivePatternNumber(input: LegacyPattern): string {
  if (input.patternNumber) return input.patternNumber;
  if (input.legacyId) return `PT_LEGACY_${input.legacyId}`;
  const ref = pickGameTypeRef(input) ?? "unknown";
  const slug = `${ref}_${input.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `PT_${slug}`;
}

function gameNameFromTypeRef(ref: string): string {
  return ref
    .split(/[_\s-]+/)
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
    .join("");
}

// ── Importer-implementasjoner ───────────────────────────────────────────────

/**
 * Upsert én GameType. Returnerer den faktiske raden's id i ny stack
 * (UUID eller eksisterende id) sammen med action ('created'|'updated').
 */
async function upsertGameType(
  client: QueryClient,
  schema: string,
  input: LegacyGameType,
  options: { dryRun: boolean; createdBy: string }
): Promise<ImportRecordResult> {
  const slug = pickSlug(input);
  if (!slug) {
    return {
      resource: "gameType",
      key: input.name,
      action: "failed",
      reason: "Mangler typeSlug/slug/legacyId — kan ikke upsert.",
    };
  }

  const table = `"${schema}"."app_game_types"`;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE type_slug = $1 AND deleted_at IS NULL`,
    [slug]
  );

  const luckyNumbers = input.luckyNumbers ?? [];
  const extra = input.extra ?? {};

  if (options.dryRun) {
    return {
      resource: "gameType",
      key: slug,
      action: existing.rowCount && existing.rowCount > 0 ? "updated" : "created",
      reason: "dry-run",
      id: existing.rows[0]?.id,
    };
  }

  if (existing.rowCount && existing.rowCount > 0) {
    const id = existing.rows[0]!.id;
    await client.query(
      `UPDATE ${table}
       SET name = $2,
           photo = COALESCE($3, photo),
           pattern = COALESCE($4, pattern),
           grid_rows = COALESCE($5, grid_rows),
           grid_columns = COALESCE($6, grid_columns),
           range_min = $7,
           range_max = $8,
           total_no_tickets = $9,
           user_max_tickets = $10,
           lucky_numbers_json = $11::jsonb,
           status = COALESCE($12, status),
           extra_json = $13::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        input.name,
        input.photo ?? null,
        input.pattern ?? null,
        input.gridRows ?? null,
        input.gridColumns ?? null,
        input.rangeMin ?? null,
        input.rangeMax ?? null,
        input.totalNoTickets ?? null,
        input.userMaxTickets ?? null,
        JSON.stringify(luckyNumbers),
        input.status ?? null,
        JSON.stringify(extra),
      ]
    );
    return { resource: "gameType", key: slug, action: "updated", id };
  }

  // Create new
  const id = randomUuid();
  await client.query(
    `INSERT INTO ${table}
       (id, type_slug, name, photo, pattern,
        grid_rows, grid_columns, range_min, range_max,
        total_no_tickets, user_max_tickets, lucky_numbers_json,
        status, extra_json, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15)`,
    [
      id,
      slug,
      input.name,
      input.photo ?? "",
      input.pattern ?? false,
      input.gridRows ?? 5,
      input.gridColumns ?? 5,
      input.rangeMin ?? null,
      input.rangeMax ?? null,
      input.totalNoTickets ?? null,
      input.userMaxTickets ?? null,
      JSON.stringify(luckyNumbers),
      input.status ?? "active",
      JSON.stringify(extra),
      options.createdBy,
    ]
  );
  return { resource: "gameType", key: slug, action: "created", id };
}

async function resolveGameTypeId(
  client: QueryClient,
  schema: string,
  ref: string
): Promise<string | null> {
  const table = `"${schema}"."app_game_types"`;
  // Prøv først som type_slug, så som id.
  const bySlug = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE type_slug = $1 AND deleted_at IS NULL`,
    [ref]
  );
  if (bySlug.rows[0]) return bySlug.rows[0].id;
  const byId = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
    [ref]
  );
  return byId.rows[0]?.id ?? null;
}

async function upsertSubGame(
  client: QueryClient,
  schema: string,
  input: LegacySubGame,
  options: { dryRun: boolean; createdBy: string }
): Promise<ImportRecordResult> {
  const ref = pickGameTypeRef(input);
  if (!ref) {
    return {
      resource: "subGame",
      key: input.name,
      action: "failed",
      reason: "Mangler gameTypeSlug/gameTypeId — kan ikke upsert.",
    };
  }

  const subGameNumber = deriveSubGameNumber(input);
  const table = `"${schema}"."app_sub_games"`;

  // Resolve gameTypeId (slug → id) — feiler hvis GameType ikke finnes ennå.
  const gameTypeId = options.dryRun
    ? ref // i dry-run aksepteres ref direkte uten oppslag
    : await resolveGameTypeId(client, schema, ref);
  if (!gameTypeId) {
    return {
      resource: "subGame",
      key: subGameNumber,
      action: "failed",
      reason: `GameType '${ref}' finnes ikke — importer GameTypes først.`,
    };
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE sub_game_number = $1 AND deleted_at IS NULL`,
    [subGameNumber]
  );

  const patternRows = input.patternRows ?? [];
  const ticketColors = input.ticketColors ?? [];
  const extra = input.extra ?? {};
  const gameName = input.gameName ?? input.name;

  if (options.dryRun) {
    return {
      resource: "subGame",
      key: subGameNumber,
      action: existing.rowCount && existing.rowCount > 0 ? "updated" : "created",
      reason: "dry-run",
      id: existing.rows[0]?.id,
    };
  }

  if (existing.rowCount && existing.rowCount > 0) {
    const id = existing.rows[0]!.id;
    await client.query(
      `UPDATE ${table}
       SET game_type_id = $2,
           game_name = $3,
           name = $4,
           pattern_rows_json = $5::jsonb,
           ticket_colors_json = $6::jsonb,
           status = COALESCE($7, status),
           extra_json = $8::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        gameTypeId,
        gameName,
        input.name,
        JSON.stringify(patternRows),
        JSON.stringify(ticketColors),
        input.status ?? null,
        JSON.stringify(extra),
      ]
    );
    return { resource: "subGame", key: subGameNumber, action: "updated", id };
  }

  const id = randomUuid();
  await client.query(
    `INSERT INTO ${table}
       (id, game_type_id, game_name, name, sub_game_number,
        pattern_rows_json, ticket_colors_json,
        status, extra_json, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10)`,
    [
      id,
      gameTypeId,
      gameName,
      input.name,
      subGameNumber,
      JSON.stringify(patternRows),
      JSON.stringify(ticketColors),
      input.status ?? "active",
      JSON.stringify(extra),
      options.createdBy,
    ]
  );
  return { resource: "subGame", key: subGameNumber, action: "created", id };
}

async function upsertPattern(
  client: QueryClient,
  schema: string,
  input: LegacyPattern,
  options: { dryRun: boolean; createdBy: string }
): Promise<ImportRecordResult> {
  const ref = pickGameTypeRef(input);
  if (!ref) {
    return {
      resource: "pattern",
      key: input.name,
      action: "failed",
      reason: "Mangler gameTypeSlug/gameTypeId — kan ikke upsert.",
    };
  }

  const patternNumber = derivePatternNumber(input);
  const table = `"${schema}"."app_patterns"`;

  const gameTypeId = options.dryRun
    ? ref
    : await resolveGameTypeId(client, schema, ref);
  if (!gameTypeId) {
    return {
      resource: "pattern",
      key: patternNumber,
      action: "failed",
      reason: `GameType '${ref}' finnes ikke — importer GameTypes først.`,
    };
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM ${table}
     WHERE game_type_id = $1 AND pattern_number = $2 AND deleted_at IS NULL`,
    [gameTypeId, patternNumber]
  );

  const gameName = input.gameName ?? gameNameFromTypeRef(ref);
  const extra = input.extra ?? {};

  if (options.dryRun) {
    return {
      resource: "pattern",
      key: patternNumber,
      action: existing.rowCount && existing.rowCount > 0 ? "updated" : "created",
      reason: "dry-run",
      id: existing.rows[0]?.id,
    };
  }

  if (existing.rowCount && existing.rowCount > 0) {
    const id = existing.rows[0]!.id;
    await client.query(
      `UPDATE ${table}
       SET game_name = $2,
           name = $3,
           mask = $4,
           claim_type = COALESCE($5, claim_type),
           prize_percent = COALESCE($6, prize_percent),
           order_index = COALESCE($7, order_index),
           design = COALESCE($8, design),
           status = COALESCE($9, status),
           is_wof = COALESCE($10, is_wof),
           is_tchest = COALESCE($11, is_tchest),
           is_mys = COALESCE($12, is_mys),
           is_row_pr = COALESCE($13, is_row_pr),
           row_percentage = COALESCE($14, row_percentage),
           is_jackpot = COALESCE($15, is_jackpot),
           is_game_type_extra = COALESCE($16, is_game_type_extra),
           is_lucky_bonus = COALESCE($17, is_lucky_bonus),
           pattern_place = $18,
           extra_json = $19::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        gameName,
        input.name,
        input.mask,
        input.claimType ?? null,
        input.prizePercent ?? null,
        input.orderIndex ?? null,
        input.design ?? null,
        input.status ?? null,
        input.isWoF ?? null,
        input.isTchest ?? null,
        input.isMys ?? null,
        input.isRowPr ?? null,
        input.rowPercentage ?? null,
        input.isJackpot ?? null,
        input.isGameTypeExtra ?? null,
        input.isLuckyBonus ?? null,
        input.patternPlace ?? null,
        JSON.stringify(extra),
      ]
    );
    return { resource: "pattern", key: patternNumber, action: "updated", id };
  }

  const id = randomUuid();
  await client.query(
    `INSERT INTO ${table}
       (id, game_type_id, game_name, pattern_number, name, mask,
        claim_type, prize_percent, order_index, design, status,
        is_wof, is_tchest, is_mys, is_row_pr, row_percentage,
        is_jackpot, is_game_type_extra, is_lucky_bonus, pattern_place,
        extra_json, created_by)
     VALUES ($1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16,
             $17, $18, $19, $20,
             $21::jsonb, $22)`,
    [
      id,
      gameTypeId,
      gameName,
      patternNumber,
      input.name,
      input.mask,
      input.claimType ?? "BINGO",
      input.prizePercent ?? 0,
      input.orderIndex ?? 0,
      input.design ?? 0,
      input.status ?? "active",
      input.isWoF ?? false,
      input.isTchest ?? false,
      input.isMys ?? false,
      input.isRowPr ?? false,
      input.rowPercentage ?? 0,
      input.isJackpot ?? false,
      input.isGameTypeExtra ?? false,
      input.isLuckyBonus ?? false,
      input.patternPlace ?? null,
      JSON.stringify(extra),
      options.createdBy,
    ]
  );
  return { resource: "pattern", key: patternNumber, action: "created", id };
}

// ── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Hoved-ETL: les payload, valider hver oppføring mot Zod, og upsert i
 * riktig rekkefølge (GameType → SubGame → Pattern).
 *
 * Hver oppføring importeres uavhengig — én feil avbryter ikke resten.
 */
export async function runImport(
  client: QueryClient,
  rawPayload: unknown,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const schema = assertSchemaName(options.schema ?? "public");
  const dryRun = options.dryRun === true;
  const createdBy = options.createdBy?.trim() || "system-etl";
  const logger = options.logger ?? defaultLogger();

  const parsed = LegacyPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new Error(
      `Ugyldig payload-shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`
    );
  }

  const payload = parsed.data;
  const records: ImportRecordResult[] = [];

  // 1) GameTypes først — sub-games + patterns trenger gameTypeId.
  const gameTypes = [
    ...(payload.gameTypes ?? []),
    ...(payload.gameTypeTemplates ?? []),
  ];
  if (gameTypes.length > 0) {
    logger.info(`[ETL] Importerer ${gameTypes.length} GameType-mal(er)…`);
  }
  for (const raw of gameTypes) {
    try {
      const result = await upsertGameType(client, schema, raw, {
        dryRun,
        createdBy,
      });
      records.push(result);
      if (result.action === "failed") {
        logger.warn(`[ETL] GameType '${result.key}' feilet: ${result.reason}`);
      } else {
        logger.info(`[ETL] GameType '${result.key}' → ${result.action}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      records.push({
        resource: "gameType",
        key: raw.name,
        action: "failed",
        reason: msg,
      });
      logger.error(`[ETL] GameType '${raw.name}' feil: ${msg}`);
    }
  }

  // 2) SubGames
  const subGames = [
    ...(payload.subGames ?? []),
    ...(payload.subGame1Templates ?? []),
    ...(payload.subGameTemplates ?? []),
  ];
  if (subGames.length > 0) {
    logger.info(`[ETL] Importerer ${subGames.length} SubGame-mal(er)…`);
  }
  for (const raw of subGames) {
    try {
      const result = await upsertSubGame(client, schema, raw, {
        dryRun,
        createdBy,
      });
      records.push(result);
      if (result.action === "failed") {
        logger.warn(`[ETL] SubGame '${result.key}' feilet: ${result.reason}`);
      } else {
        logger.info(`[ETL] SubGame '${result.key}' → ${result.action}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      records.push({
        resource: "subGame",
        key: raw.name,
        action: "failed",
        reason: msg,
      });
      logger.error(`[ETL] SubGame '${raw.name}' feil: ${msg}`);
    }
  }

  // 3) Patterns
  const patterns = [
    ...(payload.patterns ?? []),
    ...(payload.patternTemplates ?? []),
  ];
  if (patterns.length > 0) {
    logger.info(`[ETL] Importerer ${patterns.length} Pattern-mal(er)…`);
  }
  for (const raw of patterns) {
    try {
      const result = await upsertPattern(client, schema, raw, {
        dryRun,
        createdBy,
      });
      records.push(result);
      if (result.action === "failed") {
        logger.warn(`[ETL] Pattern '${result.key}' feilet: ${result.reason}`);
      } else {
        logger.info(`[ETL] Pattern '${result.key}' → ${result.action}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      records.push({
        resource: "pattern",
        key: raw.name,
        action: "failed",
        reason: msg,
      });
      logger.error(`[ETL] Pattern '${raw.name}' feil: ${msg}`);
    }
  }

  const report: ImportReport = {
    total: records.length,
    created: records.filter((r) => r.action === "created").length,
    updated: records.filter((r) => r.action === "updated").length,
    skipped: records.filter((r) => r.action === "skipped").length,
    failed: records.filter((r) => r.action === "failed").length,
    records,
  };

  logger.info(
    `[ETL] Ferdig. total=${report.total} created=${report.created} updated=${report.updated} skipped=${report.skipped} failed=${report.failed}${dryRun ? " (DRY RUN)" : ""}`
  );

  return report;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function randomUuid(): string {
  return randomUUID();
}

// Eksponert også som named-export for testbarhet.
export const _internals = {
  pickSlug,
  pickGameTypeRef,
  deriveSubGameNumber,
  derivePatternNumber,
  gameNameFromTypeRef,
  defaultLogger,
  nullLogger,
};
