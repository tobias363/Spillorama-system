/**
 * BIN-679: MiniGamesConfig admin-service (Wheel + Chest + Mystery + Colordraft).
 *
 * Admin-CRUD for de fire Game 1 mini-spillene. Tabellen `app_mini_games_config`
 * lagrer én singleton-rad per spill-type med `config_json` JSONB-payload.
 * Ren KONFIGURASJON — runtime-integrasjonen i Game 1 eksisterer allerede
 * (BingoEngine.MINIGAME_PRIZES hardkodet), men leser i dag IKKE fra denne
 * tabellen. Wiring av runtime til admin-konfig lander som separat PR slik
 * at admin-UI kan lande først uten runtime-risk.
 *
 * Design:
 *   - GET returnerer defaults (empty config, active=true) hvis raden ikke
 *     finnes — admin-UI trenger ikke egne "init"-knapper. Første PUT
 *     upsert-er raden.
 *   - PUT er idempotent: `config` + `active` er begge optional; ingen
 *     endring trigger INVALID_INPUT slik at admin-UI kan sende hele
 *     payload hver gang uten diff-logikk på klienten.
 *   - Ingen soft-delete: 4 singleton-rader. `active = false` er eneste
 *     disable-mekanisme.
 *
 * Gjenbruk:
 *   - Samme Object.create test-hook som LeaderboardTierService (BIN-668),
 *     PatternService (BIN-627), GameTypeService (BIN-620).
 *   - Idempotent ensureInitialized — trygt å kalle parallelt.
 *
 * Legacy-opphav:
 *   legacy/unity-backend/App/Models/otherGame.js (Mongo `otherGame` collection)
 *   legacy/unity-backend/App/Controllers/otherGameController.js
 *     - wheelOfFortune / editWheelOfFortune
 *     - treasureChest / editTreasureChestPostData
 *     - mystery / editMysteryPostData
 *     - colorDraft / editColordraftPostData
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "mini-games-config-service" });

export type MiniGameType = "wheel" | "chest" | "mystery" | "colordraft";

export const MINI_GAME_TYPES: readonly MiniGameType[] = [
  "wheel",
  "chest",
  "mystery",
  "colordraft",
] as const;

export interface MiniGameConfig {
  id: string;
  gameType: MiniGameType;
  config: Record<string, unknown>;
  active: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateMiniGameConfigInput {
  config?: Record<string, unknown>;
  active?: boolean;
  updatedByUserId: string;
}

export interface MiniGamesConfigServiceOptions {
  connectionString: string;
  schema?: string;
}

interface MiniGameConfigRow {
  id: string;
  game_type: string;
  config_json: Record<string, unknown> | null;
  active: boolean;
  updated_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

export function assertMiniGameType(value: unknown): MiniGameType {
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      "gameType må være en streng.",
    );
  }
  if (!(MINI_GAME_TYPES as readonly string[]).includes(value)) {
    throw new DomainError(
      "INVALID_INPUT",
      `gameType må være en av: ${MINI_GAME_TYPES.join(", ")}.`,
    );
  }
  return value as MiniGameType;
}

function assertConfigObject(
  value: unknown,
  field = "config",
): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Default-konfig som returneres av `get()` hvis raden ikke finnes ennå.
 * Brukes også som fallback i PUT når ingen eksisterende rad er lagret.
 * Holder config = {} og active = true; admin-UI kan skrive over ved første
 * PUT.
 */
function buildDefault(gameType: MiniGameType): MiniGameConfig {
  const now = new Date().toISOString();
  return {
    id: `default-${gameType}`,
    gameType,
    config: {},
    active: true,
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export class MiniGamesConfigService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: MiniGamesConfigServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for MiniGamesConfigService.",
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    schema = "public",
  ): MiniGamesConfigService {
    const svc = Object.create(
      MiniGamesConfigService.prototype,
    ) as MiniGamesConfigService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_mini_games_config"`;
  }

  /**
   * Henter konfig for et mini-spill. Returnerer defaults (tom config,
   * active=true) hvis raden ikke finnes ennå — første PUT upsert-er.
   */
  async get(gameType: MiniGameType): Promise<MiniGameConfig> {
    assertMiniGameType(gameType);
    await this.ensureInitialized();
    const { rows } = await this.pool.query<MiniGameConfigRow>(
      `SELECT id, game_type, config_json, active, updated_by_user_id,
              created_at, updated_at
       FROM ${this.table()}
       WHERE game_type = $1
       LIMIT 1`,
      [gameType],
    );
    const row = rows[0];
    if (!row) {
      return buildDefault(gameType);
    }
    return this.mapRow(row);
  }

  /**
   * Oppdaterer konfig for et mini-spill. Upsert: hvis raden ikke finnes,
   * opprettes den. `config` og `active` er begge optional — hvis ingen er
   * oppgitt returneres eksisterende rad uendret (ingen INVALID_INPUT).
   */
  async update(
    gameType: MiniGameType,
    update: UpdateMiniGameConfigInput,
  ): Promise<MiniGameConfig> {
    assertMiniGameType(gameType);
    await this.ensureInitialized();
    if (!update.updatedByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "updatedByUserId er påkrevd.");
    }
    const config =
      update.config !== undefined ? assertConfigObject(update.config) : undefined;
    const active =
      update.active !== undefined ? this.assertBoolean(update.active, "active") : undefined;

    // Upsert — ON CONFLICT (game_type) DO UPDATE. Bruker COALESCE slik at
    // ikke-oppgitte felter beholder eksisterende verdi.
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO ${this.table()}
         (id, game_type, config_json, active, updated_by_user_id, updated_at)
       VALUES ($1, $2, COALESCE($3::jsonb, '{}'::jsonb), COALESCE($4, true), $5, now())
       ON CONFLICT (game_type) DO UPDATE SET
         config_json = COALESCE($3::jsonb, ${this.table()}.config_json),
         active = COALESCE($4, ${this.table()}.active),
         updated_by_user_id = $5,
         updated_at = now()`,
      [
        id,
        gameType,
        config === undefined ? null : JSON.stringify(config),
        active === undefined ? null : active,
        update.updatedByUserId,
      ],
    );
    return this.get(gameType);
  }

  /** Lister alle 4 konfig-rader (returnerer defaults for manglende). */
  async listAll(): Promise<MiniGameConfig[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<MiniGameConfigRow>(
      `SELECT id, game_type, config_json, active, updated_by_user_id,
              created_at, updated_at
       FROM ${this.table()}`,
    );
    const byType = new Map<MiniGameType, MiniGameConfig>();
    for (const row of rows) {
      try {
        const gt = assertMiniGameType(row.game_type);
        byType.set(gt, this.mapRow(row));
      } catch {
        // Ukjent game_type i DB — ignorer (skulle vært fanget av CHECK).
      }
    }
    return MINI_GAME_TYPES.map((gt) => byType.get(gt) ?? buildDefault(gt));
  }

  private assertBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") {
      throw new DomainError("INVALID_INPUT", `${field} må være boolean.`);
    }
    return value;
  }

  private mapRow(row: MiniGameConfigRow): MiniGameConfig {
    return {
      id: row.id,
      gameType: assertMiniGameType(row.game_type),
      config: (row.config_json ?? {}) as Record<string, unknown>,
      active: Boolean(row.active),
      updatedByUserId: row.updated_by_user_id,
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
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          id TEXT PRIMARY KEY,
          game_type TEXT NOT NULL
            CHECK (game_type IN ('wheel', 'chest', 'mystery', 'colordraft')),
          config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          active BOOLEAN NOT NULL DEFAULT true,
          updated_by_user_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_mini_games_config_game_type
         ON ${this.table()}(game_type)`,
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-679] mini_games_config schema init failed");
      throw new DomainError(
        "MINI_GAMES_CONFIG_INIT_FAILED",
        "Kunne ikke initialisere mini_games_config-tabell.",
      );
    } finally {
      client.release();
    }
  }
}
