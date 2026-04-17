import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type { KycAdapter } from "../adapters/KycAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import { DomainError } from "../game/BingoEngine.js";

const scrypt = promisify(scryptCallback);

export const APP_USER_ROLES = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "PLAYER"] as const;
export type UserRole = (typeof APP_USER_ROLES)[number];
export type KycStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  surname?: string;
  phone?: string;
  complianceData?: Record<string, unknown>;
  walletId: string;
  role: UserRole;
  kycStatus: KycStatus;
  birthDate?: string;
  kycVerifiedAt?: string;
  kycProviderRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAppUser extends AppUser {
  balance: number;
}

export interface SessionInfo {
  accessToken: string;
  expiresAt: string;
  user: PublicAppUser;
}

export interface GameDefinition {
  slug: string;
  title: string;
  description: string;
  route: string;
  isEnabled: boolean;
  sortOrder: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateGameInput {
  title?: string;
  description?: string;
  route?: string;
  isEnabled?: boolean;
  sortOrder?: number;
  settings?: Record<string, unknown>;
}

/** BIN-540: per-hall rollback flag. */
export type HallClientVariant = "unity" | "web" | "unity-fallback";
export const HALL_CLIENT_VARIANTS: readonly HallClientVariant[] = ["unity", "web", "unity-fallback"] as const;

export interface HallDefinition {
  id: string;
  slug: string;
  name: string;
  region: string;
  address: string;
  organizationNumber?: string;
  settlementAccount?: string;
  invoiceMethod?: string;
  isActive: boolean;
  /** BIN-540: which client engine this hall serves (unity | web | unity-fallback). */
  clientVariant: HallClientVariant;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHallInput {
  slug: string;
  name: string;
  region?: string;
  address?: string;
  organizationNumber?: string;
  settlementAccount?: string;
  invoiceMethod?: string;
  isActive?: boolean;
}

export interface UpdateHallInput {
  slug?: string;
  name?: string;
  region?: string;
  address?: string;
  organizationNumber?: string;
  settlementAccount?: string;
  invoiceMethod?: string;
  isActive?: boolean;
}

export interface TerminalDefinition {
  id: string;
  hallId: string;
  terminalCode: string;
  displayName: string;
  isActive: boolean;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTerminalInput {
  hallId: string;
  terminalCode: string;
  displayName: string;
  isActive?: boolean;
}

export interface UpdateTerminalInput {
  terminalCode?: string;
  displayName?: string;
  isActive?: boolean;
  lastSeenAt?: string;
}

export interface HallGameConfigDefinition {
  hallId: string;
  gameSlug: string;
  isEnabled: boolean;
  maxTicketsPerPlayer: number;
  minRoundIntervalMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertHallGameConfigInput {
  hallId: string;
  gameSlug: string;
  isEnabled?: boolean;
  maxTicketsPerPlayer?: number;
  minRoundIntervalMs?: number;
}

// ── Spilleplan (§ 64) ────────────────────────────────────────────────────────

export const MAIN_GAME_TYPES = ["standard", "kvikkis", "3r_jack", "ekstrapremie"] as const;
export type MainGameType = (typeof MAIN_GAME_TYPES)[number];

export interface ScheduleSlot {
  id: string;
  hallId: string;
  gameType: string;
  displayName: string;
  dayOfWeek: number | null; // 0=Sun..6=Sat, null=every day
  startTime: string;        // "HH:MM"
  prizeDescription: string;
  maxTickets: number;
  isActive: boolean;
  sortOrder: number;
  /** BIN-436: Variant config with ticket types, patterns, prices. */
  variantConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleSlotInput {
  gameType: string;
  displayName: string;
  dayOfWeek?: number | null;
  startTime: string;
  prizeDescription?: string;
  maxTickets?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateScheduleSlotInput {
  gameType?: string;
  displayName?: string;
  dayOfWeek?: number | null;
  startTime?: string;
  prizeDescription?: string;
  maxTickets?: number;
  isActive?: boolean;
  sortOrder?: number;
  /** BIN-442: Variant config with ticket types, patterns, etc. */
  variantConfig?: Record<string, unknown>;
}

export interface ScheduleLogEntry {
  id: string;
  hallId: string;
  scheduleSlotId: string | null;
  gameSessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  playerCount: number | null;
  totalPayout: number | null;
  notes: string | null;
  createdAt: string;
}

export interface GameSettingsChangeContext {
  userId: string;
  displayName: string;
  role: UserRole;
}

export interface ListGameSettingsChangeLogOptions {
  gameSlug?: string;
  limit?: number;
}

export interface GameSettingsChangeLogEntry {
  id: string;
  gameSlug: string;
  changedByUserId?: string;
  changedByDisplayName: string;
  changedByRole: string;
  source: string;
  effectiveFrom?: string;
  payloadSummary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface PlatformServiceOptions {
  connectionString: string;
  schema?: string;
  sessionTtlHours?: number;
  minAgeYears?: number;
  kycAdapter?: KycAdapter;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  surname: string | null;
  phone: string | null;
  wallet_id: string;
  role: UserRole;
  kyc_status: KycStatus;
  birth_date: Date | string | null;
  kyc_verified_at: Date | string | null;
  kyc_provider_ref: string | null;
  compliance_data: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface GameRow {
  slug: string;
  title: string;
  description: string;
  route: string;
  is_enabled: boolean;
  sort_order: number;
  settings_json: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface HallRow {
  id: string;
  slug: string;
  name: string;
  region: string;
  address: string;
  organization_number: string | null;
  settlement_account: string | null;
  invoice_method: string | null;
  is_active: boolean;
  /** BIN-540. */
  client_variant: HallClientVariant;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TerminalRow {
  id: string;
  hall_id: string;
  terminal_code: string;
  display_name: string;
  is_active: boolean;
  last_seen_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface HallGameConfigRow {
  hall_id: string;
  game_slug: string;
  is_enabled: boolean;
  max_tickets_per_player: number;
  min_round_interval_ms: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface GameSettingsChangeLogRow {
  id: string;
  game_slug: string;
  changed_by_user_id: string | null;
  changed_by_display_name: string;
  changed_by_role: string;
  source: string;
  effective_from: Date | string | null;
  payload_summary: string;
  payload_json: Record<string, unknown>;
  created_at: Date | string;
}

interface ScheduleSlotRow {
  id: string;
  hall_id: string;
  game_type: string;
  display_name: string;
  day_of_week: number | null;
  start_time: string;
  prize_description: string;
  max_tickets: number;
  is_active: boolean;
  sort_order: number;
  variant_config?: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ScheduleLogRow {
  id: string;
  hall_id: string;
  schedule_slot_id: string | null;
  game_session_id: string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
  player_count: number | null;
  total_payout: string | number | null;
  notes: string | null;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new DomainError(
      "INVALID_CONFIG",
      "APP_PG_SCHEMA er ugyldig. Bruk kun bokstaver, tall og underscore."
    );
  }
  return trimmed;
}

function parseHashEnvelope(hash: string): { saltHex: string; digestHex: string } {
  const parts = hash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    throw new DomainError("INVALID_PASSWORD_HASH", "Ugyldig password hash-format.");
  }
  return {
    saltHex: parts[1],
    digestHex: parts[2]
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function calculateAgeYears(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age;
}

const DEFAULT_HALL_ID = "hall-default";
const DEFAULT_HALL_SLUG = "default-hall";

export class PlatformService {
  private readonly pool: Pool;

  private readonly schema: string;

  private readonly sessionTtlHours: number;

  private readonly minAgeYears: number;

  private readonly kycAdapter?: KycAdapter;

  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly walletAdapter: WalletAdapter,
    options: PlatformServiceOptions
  ) {
    if (!options.connectionString.trim()) {
      throw new DomainError("INVALID_CONFIG", "Mangler connection string for plattform-database.");
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.sessionTtlHours = options.sessionTtlHours ?? 24 * 7;
    this.minAgeYears = Math.max(18, Math.floor(options.minAgeYears ?? 18));
    this.kycAdapter = options.kycAdapter;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning()
    });
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    surname: string;
    phone?: string;
    birthDate: string;
    complianceData?: Record<string, unknown>;
  }): Promise<SessionInfo> {
    await this.ensureInitialized();
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    const surname = input.surname.trim();
    const birthDate = this.assertBirthDate(input.birthDate);
    this.assertEmail(email);
    this.assertDisplayName(displayName);
    this.assertSurname(surname);
    this.assertPassword(input.password);

    const ageYears = calculateAgeYears(new Date(birthDate), new Date());
    if (ageYears < this.minAgeYears) {
      throw new DomainError("AGE_RESTRICTED", `Du må være minst ${this.minAgeYears} år for å registrere deg.`);
    }

    const passwordHash = await this.hashPassword(input.password);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existingRows } = await client.query<{ id: string }>(
        `SELECT id FROM ${this.usersTable()} WHERE email = $1`,
        [email]
      );
      if (existingRows[0]) {
        throw new DomainError("EMAIL_EXISTS", "E-post er allerede registrert.");
      }

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.usersTable()}`
      );
      const role: UserRole = Number(countRows[0]?.count ?? "0") === 0 ? "ADMIN" : "PLAYER";

      const userId = randomUUID();
      const walletId = `wallet-user-${userId}`;
      const phone = input.phone?.trim() || null;
      const complianceData = input.complianceData ?? null;
      const { rows: createdRows } = await client.query<UserRow>(
        `INSERT INTO ${this.usersTable()}
          (id, email, display_name, surname, password_hash, wallet_id, role, phone, birth_date, compliance_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::jsonb)
         RETURNING id, email, display_name, surname, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at, phone`,
        [userId, email, displayName, surname, passwordHash, walletId, role, phone, birthDate, complianceData ? JSON.stringify(complianceData) : null]
      );
      await client.query("COMMIT");

      await this.walletAdapter.ensureAccount(walletId);
      const user = await this.withBalance(this.mapUser(createdRows[0]));
      const session = await this.createSession(user.id);
      return {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        user
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  async login(input: { email: string; password: string }): Promise<SessionInfo> {
    await this.ensureInitialized();
    const email = normalizeEmail(input.email);
    this.assertEmail(email);
    this.assertLoginPassword(input.password);

    const { rows } = await this.pool.query<
      UserRow & {
        password_hash: string;
      }
    >(
      `SELECT id, email, display_name, surname, phone, password_hash, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at
       FROM ${this.usersTable()}
       WHERE email = $1`,
      [email]
    );
    const userRow = rows[0];
    if (!userRow) {
      throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
    }
    const ok = await this.verifyPassword(input.password, userRow.password_hash);
    if (!ok) {
      throw new DomainError("INVALID_CREDENTIALS", "Ugyldig e-post eller passord.");
    }

    const session = await this.createSession(userRow.id);
    const user = await this.withBalance(this.mapUser(userRow));
    return {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      user
    };
  }

  async logout(accessToken: string): Promise<void> {
    await this.ensureInitialized();
    const token = accessToken.trim();
    if (!token) {
      return;
    }
    await this.pool.query(
      `UPDATE ${this.sessionsTable()}
       SET revoked_at = now()
       WHERE token_hash = $1`,
      [hashToken(token)]
    );
  }

  async getUserFromAccessToken(accessToken: string): Promise<PublicAppUser> {
    await this.ensureInitialized();
    const token = accessToken.trim();
    if (!token) {
      throw new DomainError("UNAUTHORIZED", "Mangler access token.");
    }

    const { rows } = await this.pool.query<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.surname, u.wallet_id, u.role, u.kyc_status, u.birth_date, u.kyc_verified_at, u.kyc_provider_ref, u.created_at, u.updated_at
       FROM ${this.sessionsTable()} s
       JOIN ${this.usersTable()} u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [hashToken(token)]
    );

    const row = rows[0];
    if (!row) {
      throw new DomainError("UNAUTHORIZED", "Innlogging er utløpt eller ugyldig.");
    }
    return this.withBalance(this.mapUser(row));
  }

  async listGames(options?: { includeDisabled?: boolean }): Promise<GameDefinition[]> {
    await this.ensureInitialized();
    const includeDisabled = options?.includeDisabled ?? false;
    const { rows } = await this.pool.query<GameRow>(
      `SELECT slug, title, description, route, is_enabled, sort_order, settings_json, created_at, updated_at
       FROM ${this.gamesTable()}
       ${includeDisabled ? "" : "WHERE is_enabled = true"}
       ORDER BY sort_order ASC, slug ASC`
    );
    return rows.map((row) => this.mapGame(row));
  }

  async getGame(slug: string): Promise<GameDefinition> {
    await this.ensureInitialized();
    const normalizedSlug = this.assertGameSlug(slug);
    const { rows } = await this.pool.query<GameRow>(
      `SELECT slug, title, description, route, is_enabled, sort_order, settings_json, created_at, updated_at
       FROM ${this.gamesTable()}
       WHERE slug = $1`,
      [normalizedSlug]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
    }
    return this.mapGame(row);
  }

  async updateGame(
    slug: string,
    update: UpdateGameInput,
    options?: {
      changedBy?: GameSettingsChangeContext;
      source?: string;
      effectiveFrom?: string;
    }
  ): Promise<GameDefinition> {
    await this.ensureInitialized();
    const normalizedSlug = this.assertGameSlug(slug);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const { rows: currentRows } = await client.query<GameRow>(
        `SELECT slug, title, description, route, is_enabled, sort_order, settings_json, created_at, updated_at
         FROM ${this.gamesTable()}
         WHERE slug = $1
         FOR UPDATE`,
        [normalizedSlug]
      );
      const currentRow = currentRows[0];
      if (!currentRow) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
      }
      const current = this.mapGame(currentRow);

      const nextTitle = update.title !== undefined ? this.assertTitle(update.title) : current.title;
      const nextDescription =
        update.description !== undefined ? this.assertDescription(update.description) : current.description;
      const nextRoute = update.route !== undefined ? this.assertRoute(update.route) : current.route;
      const nextEnabled =
        update.isEnabled !== undefined ? Boolean(update.isEnabled) : current.isEnabled;
      const nextSortOrder =
        update.sortOrder !== undefined ? this.assertSortOrder(update.sortOrder) : current.sortOrder;
      const nextSettings =
        update.settings !== undefined ? this.assertSettings(update.settings) : current.settings;

      const { rows } = await client.query<GameRow>(
        `UPDATE ${this.gamesTable()}
         SET title = $2,
             description = $3,
             route = $4,
             is_enabled = $5,
             sort_order = $6,
             settings_json = $7::jsonb,
             updated_at = now()
         WHERE slug = $1
         RETURNING slug, title, description, route, is_enabled, sort_order, settings_json, created_at, updated_at`,
        [
          normalizedSlug,
          nextTitle,
          nextDescription,
          nextRoute,
          nextEnabled,
          nextSortOrder,
          JSON.stringify(nextSettings)
        ]
      );

      if (
        update.settings !== undefined &&
        this.areSettingsDifferent(current.settings, nextSettings)
      ) {
        await this.insertGameSettingsChangeLog(client, {
          gameSlug: normalizedSlug,
          previousSettings: current.settings,
          nextSettings,
          changedBy: options?.changedBy,
          source: options?.source ?? "ADMIN_API",
          effectiveFrom: options?.effectiveFrom
        });
      }

      await client.query("COMMIT");
      return this.mapGame(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  async listGameSettingsChangeLog(
    options?: ListGameSettingsChangeLogOptions
  ): Promise<GameSettingsChangeLogEntry[]> {
    await this.ensureInitialized();
    const limit = this.assertAuditLimit(options?.limit ?? 50);
    const gameSlug = options?.gameSlug ? this.assertGameSlug(options.gameSlug) : undefined;

    const values: unknown[] = [];
    const whereParts: string[] = [];
    if (gameSlug) {
      values.push(gameSlug);
      whereParts.push(`game_slug = $${values.length}`);
    }
    values.push(limit);

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const { rows } = await this.pool.query<GameSettingsChangeLogRow>(
      `SELECT id,
              game_slug,
              changed_by_user_id,
              changed_by_display_name,
              changed_by_role,
              source,
              effective_from,
              payload_summary,
              payload_json,
              created_at
       FROM ${this.gameSettingsChangeLogTable()}
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values
    );
    return rows.map((row) => this.mapGameSettingsChangeLogEntry(row));
  }

  async listHalls(options?: { includeInactive?: boolean }): Promise<HallDefinition[]> {
    await this.ensureInitialized();
    const includeInactive = options?.includeInactive ?? false;
    const { rows } = await this.pool.query<HallRow>(
      `SELECT id, slug, name, region, address, is_active, client_variant, created_at, updated_at
       FROM ${this.hallsTable()}
       ${includeInactive ? "" : "WHERE is_active = true"}
       ORDER BY name ASC, slug ASC`
    );
    return rows.map((row) => this.mapHall(row));
  }

  async getHall(hallReference: string): Promise<HallDefinition> {
    await this.ensureInitialized();
    const hallRow = await this.resolveHallRowByReference(hallReference);
    if (!hallRow) {
      throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
    }
    return this.mapHall(hallRow);
  }

  async requireActiveHall(hallReference: string): Promise<HallDefinition> {
    const hall = await this.getHall(hallReference);
    if (!hall.isActive) {
      throw new DomainError("HALL_INACTIVE", "Hallen er ikke aktiv.");
    }
    return hall;
  }

  // ── BIN-540: client-variant feature flag ─────────────────────────────────
  // Read-through cache so the rollout flag doesn't hit Postgres on every
  // /api/halls/:slug/client-variant call. TTL 60s is a deliberate trade-off:
  // fast enough that a rollback is effective inside the SLA (< 2 min), slow
  // enough that the DB never takes more than ~1 rps per hall even under a
  // thundering-herd reconnect storm.
  private readonly clientVariantCache = new Map<string, { value: HallClientVariant; expiresAt: number }>();
  private static readonly CLIENT_VARIANT_TTL_MS = 60_000;

  /**
   * Public entry point used by the web shell / admin web to decide which
   * client engine to mount. Fails CLOSED to "unity" on any DB error so a
   * flipped-flag rollout can never turn into a deny-all.
   */
  async getHallClientVariant(hallReference: string): Promise<HallClientVariant> {
    const cached = this.clientVariantCache.get(hallReference);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    try {
      const hall = await this.getHall(hallReference);
      const value = hall.clientVariant;
      this.clientVariantCache.set(hallReference, { value, expiresAt: Date.now() + PlatformService.CLIENT_VARIANT_TTL_MS });
      return value;
    } catch (err) {
      // Fail-safe: DB miss / connection error defaults to the legacy client.
      // This is the safe direction — a broken rollout keeps the status quo.
      console.warn("[BIN-540] getHallClientVariant failed, defaulting to 'unity'", err);
      return "unity";
    }
  }

  /** Test-only: clear the client-variant cache so tests can rotate the flag. */
  clearClientVariantCache(): void {
    this.clientVariantCache.clear();
  }

  async createHall(input: CreateHallInput): Promise<HallDefinition> {
    await this.ensureInitialized();
    const slug = this.assertHallSlug(input.slug);
    const name = this.assertHallName(input.name);
    const region = this.assertHallRegion(input.region ?? "NO");
    const address = this.assertHallAddress(input.address ?? "");
    const organizationNumber = input.organizationNumber?.trim() || null;
    const settlementAccount = input.settlementAccount?.trim() || null;
    const invoiceMethod = input.invoiceMethod?.trim() || null;
    const isActive = input.isActive ?? true;
    const hallId = randomUUID();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existingRows } = await client.query<{ id: string }>(
        `SELECT id FROM ${this.hallsTable()} WHERE slug = $1`,
        [slug]
      );
      if (existingRows[0]) {
        throw new DomainError("HALL_SLUG_EXISTS", "Hall med samme slug finnes allerede.");
      }

      const { rows } = await client.query<HallRow>(
        `INSERT INTO ${this.hallsTable()} (id, slug, name, region, address, organization_number, settlement_account, invoice_method, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [hallId, slug, name, region, address, organizationNumber, settlementAccount, invoiceMethod, isActive]
      );
      await this.seedHallGameConfigForHall(client, hallId);
      await client.query("COMMIT");
      return this.mapHall(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  async updateHall(hallReference: string, update: UpdateHallInput): Promise<HallDefinition> {
    await this.ensureInitialized();
    const currentRow = await this.resolveHallRowByReference(hallReference);
    if (!currentRow) {
      throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
    }
    const current = this.mapHall(currentRow);

    const nextSlug = update.slug !== undefined ? this.assertHallSlug(update.slug) : current.slug;
    const nextName = update.name !== undefined ? this.assertHallName(update.name) : current.name;
    const nextRegion = update.region !== undefined ? this.assertHallRegion(update.region) : current.region;
    const nextAddress = update.address !== undefined ? this.assertHallAddress(update.address) : current.address;
    const nextOrgNumber = update.organizationNumber !== undefined ? (update.organizationNumber?.trim() || null) : (current.organizationNumber ?? null);
    const nextSettlementAccount = update.settlementAccount !== undefined ? (update.settlementAccount?.trim() || null) : (current.settlementAccount ?? null);
    const nextInvoiceMethod = update.invoiceMethod !== undefined ? (update.invoiceMethod?.trim() || null) : (current.invoiceMethod ?? null);
    const nextIsActive = update.isActive !== undefined ? Boolean(update.isActive) : current.isActive;

    if (nextSlug !== current.slug) {
      const { rows: conflictRows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM ${this.hallsTable()} WHERE slug = $1 AND id <> $2`,
        [nextSlug, current.id]
      );
      if (conflictRows[0]) {
        throw new DomainError("HALL_SLUG_EXISTS", "Hall med samme slug finnes allerede.");
      }
    }

    const { rows } = await this.pool.query<HallRow>(
      `UPDATE ${this.hallsTable()}
       SET slug = $2,
           name = $3,
           region = $4,
           address = $5,
           organization_number = $6,
           settlement_account = $7,
           invoice_method = $8,
           is_active = $9,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [current.id, nextSlug, nextName, nextRegion, nextAddress, nextOrgNumber, nextSettlementAccount, nextInvoiceMethod, nextIsActive]
    );

    return this.mapHall(rows[0]);
  }

  // ── Spilleplan — CRUD (§ 64) ────────────────────────────────────────────

  async listScheduleSlots(
    hallReference: string,
    options?: { dayOfWeek?: number; activeOnly?: boolean }
  ): Promise<ScheduleSlot[]> {
    await this.ensureInitialized();
    const hall = await this.getHall(hallReference);
    const activeOnly = options?.activeOnly ?? true;
    const conditions: string[] = ["hall_id = $1"];
    const params: unknown[] = [hall.id];
    if (activeOnly) conditions.push("is_active = true");
    if (options?.dayOfWeek !== undefined) {
      params.push(options.dayOfWeek);
      conditions.push(`(day_of_week IS NULL OR day_of_week = $${params.length})`);
    }
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, variant_config, created_at, updated_at
       FROM ${this.scheduleTable()} WHERE ${conditions.join(" AND ")}
       ORDER BY sort_order ASC, start_time ASC`,
      params
    );
    return rows.map((r) => this.mapScheduleSlot(r));
  }

  async createScheduleSlot(
    hallReference: string,
    input: CreateScheduleSlotInput
  ): Promise<ScheduleSlot> {
    await this.ensureInitialized();
    const hall = await this.getHall(hallReference);
    const id = randomUUID();
    const gameType = this.assertNonEmptyString(input.gameType, "gameType", 40);
    const displayName = this.assertNonEmptyString(input.displayName, "displayName", 80);
    const startTime = this.assertTimeString(input.startTime);
    const prizeDescription = (input.prizeDescription ?? "").slice(0, 200);
    const maxTickets = Math.min(30, Math.max(1, Number(input.maxTickets ?? 30)));
    const dayOfWeek =
      input.dayOfWeek != null
        ? Math.min(6, Math.max(0, Math.round(Number(input.dayOfWeek))))
        : null;
    const isActive = input.isActive !== false;
    const sortOrder = Number(input.sortOrder ?? 0);
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `INSERT INTO ${this.scheduleTable()}
        (id, hall_id, game_type, display_name, day_of_week, start_time,
         prize_description, max_tickets, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6::time,$7,$8,$9,$10)
       RETURNING id, hall_id, game_type, display_name, day_of_week,
                 start_time::text, prize_description, max_tickets,
                 is_active, sort_order, created_at, updated_at`,
      [id, hall.id, gameType, displayName, dayOfWeek, startTime,
       prizeDescription, maxTickets, isActive, sortOrder]
    );
    return this.mapScheduleSlot(rows[0]);
  }

  async updateScheduleSlot(slotId: string, input: UpdateScheduleSlotInput): Promise<ScheduleSlot> {
    await this.ensureInitialized();
    const { rows: ex } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, created_at, updated_at
       FROM ${this.scheduleTable()} WHERE id = $1`,
      [slotId]
    );
    if (!ex[0]) throw new DomainError("SCHEDULE_SLOT_NOT_FOUND", "Spilleplansslot finnes ikke.");
    const c = this.mapScheduleSlot(ex[0]);
    const gameType =
      input.gameType !== undefined
        ? this.assertNonEmptyString(input.gameType, "gameType", 40)
        : c.gameType;
    const displayName =
      input.displayName !== undefined
        ? this.assertNonEmptyString(input.displayName, "displayName", 80)
        : c.displayName;
    const startTime =
      input.startTime !== undefined ? this.assertTimeString(input.startTime) : c.startTime;
    const prizeDescription =
      input.prizeDescription !== undefined
        ? input.prizeDescription.slice(0, 200)
        : c.prizeDescription;
    const maxTickets =
      input.maxTickets !== undefined
        ? Math.min(30, Math.max(1, Number(input.maxTickets)))
        : c.maxTickets;
    const dayOfWeek =
      input.dayOfWeek !== undefined
        ? input.dayOfWeek != null
          ? Math.min(6, Math.max(0, Math.round(Number(input.dayOfWeek))))
          : null
        : c.dayOfWeek;
    const isActive = input.isActive !== undefined ? Boolean(input.isActive) : c.isActive;
    const sortOrder = input.sortOrder !== undefined ? Number(input.sortOrder) : c.sortOrder;
    const variantConfig = input.variantConfig !== undefined ? input.variantConfig : c.variantConfig;
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `UPDATE ${this.scheduleTable()}
       SET game_type=$2, display_name=$3, day_of_week=$4, start_time=$5::time,
           prize_description=$6, max_tickets=$7, is_active=$8, sort_order=$9,
           variant_config=$10::jsonb, updated_at=now()
       WHERE id=$1
       RETURNING id, hall_id, game_type, display_name, day_of_week,
                 start_time::text, prize_description, max_tickets,
                 is_active, sort_order, variant_config, created_at, updated_at`,
      [slotId, gameType, displayName, dayOfWeek, startTime,
       prizeDescription, maxTickets, isActive, sortOrder, JSON.stringify(variantConfig)]
    );
    return this.mapScheduleSlot(rows[0]);
  }

  async deleteScheduleSlot(slotId: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(`DELETE FROM ${this.scheduleTable()} WHERE id = $1`, [slotId]);
  }

  async logScheduledGame(input: {
    hallId: string;
    scheduleSlotId?: string;
    gameSessionId?: string;
    endedAt?: string;
    playerCount?: number;
    totalPayout?: number;
    notes?: string;
  }): Promise<ScheduleLogEntry> {
    await this.ensureInitialized();
    const id = randomUUID();
    const { rows } = await this.pool.query<ScheduleLogRow>(
      `INSERT INTO ${this.scheduleLogTable()}
        (id, hall_id, schedule_slot_id, game_session_id,
         ended_at, player_count, total_payout, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [id, input.hallId, input.scheduleSlotId ?? null, input.gameSessionId ?? null,
       input.endedAt ?? null, input.playerCount ?? null,
       input.totalPayout ?? null, input.notes ?? null]
    );
    return this.mapScheduleLog(rows[0]);
  }

  async listScheduleLog(
    hallReference: string,
    options?: { limit?: number }
  ): Promise<ScheduleLogEntry[]> {
    await this.ensureInitialized();
    const hall = await this.getHall(hallReference);
    const limit = Math.min(200, Math.max(1, Number(options?.limit ?? 50)));
    const { rows } = await this.pool.query<ScheduleLogRow>(
      `SELECT * FROM ${this.scheduleLogTable()}
       WHERE hall_id=$1 ORDER BY started_at DESC LIMIT $2`,
      [hall.id, limit]
    );
    return rows.map((r) => this.mapScheduleLog(r));
  }

  async listTerminals(options?: {
    hallId?: string;
    includeInactive?: boolean;
  }): Promise<TerminalDefinition[]> {
    await this.ensureInitialized();
    const includeInactive = options?.includeInactive ?? false;
    let hallId: string | undefined;
    if (options?.hallId) {
      const hall = await this.getHall(options.hallId);
      hallId = hall.id;
    }

    const params: string[] = [];
    const conditions: string[] = [];
    if (!includeInactive) {
      conditions.push("is_active = true");
    }
    if (hallId) {
      params.push(hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await this.pool.query<TerminalRow>(
      `SELECT id, hall_id, terminal_code, display_name, is_active, last_seen_at, created_at, updated_at
       FROM ${this.terminalsTable()}
       ${whereClause}
       ORDER BY hall_id ASC, terminal_code ASC`,
      params
    );
    return rows.map((row) => this.mapTerminal(row));
  }

  async createTerminal(input: CreateTerminalInput): Promise<TerminalDefinition> {
    await this.ensureInitialized();
    const hall = await this.getHall(input.hallId);
    const terminalCode = this.assertTerminalCode(input.terminalCode);
    const displayName = this.assertTerminalDisplayName(input.displayName);
    const isActive = input.isActive ?? true;
    const terminalId = randomUUID();

    const { rows: existingRows } = await this.pool.query<{ id: string }>(
      `SELECT id
       FROM ${this.terminalsTable()}
       WHERE hall_id = $1
         AND terminal_code = $2`,
      [hall.id, terminalCode]
    );
    if (existingRows[0]) {
      throw new DomainError("TERMINAL_CODE_EXISTS", "Terminalkode finnes allerede i hallen.");
    }

    const { rows } = await this.pool.query<TerminalRow>(
      `INSERT INTO ${this.terminalsTable()} (id, hall_id, terminal_code, display_name, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, hall_id, terminal_code, display_name, is_active, last_seen_at, created_at, updated_at`,
      [terminalId, hall.id, terminalCode, displayName, isActive]
    );
    return this.mapTerminal(rows[0]);
  }

  async updateTerminal(terminalIdInput: string, update: UpdateTerminalInput): Promise<TerminalDefinition> {
    await this.ensureInitialized();
    const terminalId = this.assertEntityReference(terminalIdInput, "terminalId");
    const { rows: existingRows } = await this.pool.query<TerminalRow>(
      `SELECT id, hall_id, terminal_code, display_name, is_active, last_seen_at, created_at, updated_at
       FROM ${this.terminalsTable()}
       WHERE id = $1`,
      [terminalId]
    );
    const existing = existingRows[0];
    if (!existing) {
      throw new DomainError("TERMINAL_NOT_FOUND", "Terminalen finnes ikke.");
    }

    const nextTerminalCode =
      update.terminalCode !== undefined
        ? this.assertTerminalCode(update.terminalCode)
        : existing.terminal_code;
    const nextDisplayName =
      update.displayName !== undefined
        ? this.assertTerminalDisplayName(update.displayName)
        : existing.display_name;
    const nextIsActive = update.isActive !== undefined ? Boolean(update.isActive) : existing.is_active;
    const nextLastSeenAt =
      update.lastSeenAt !== undefined
        ? this.assertOptionalIsoDate(update.lastSeenAt, "lastSeenAt")
        : existing.last_seen_at;

    if (nextTerminalCode !== existing.terminal_code) {
      const { rows: conflictRows } = await this.pool.query<{ id: string }>(
        `SELECT id
         FROM ${this.terminalsTable()}
         WHERE hall_id = $1
           AND terminal_code = $2
           AND id <> $3`,
        [existing.hall_id, nextTerminalCode, existing.id]
      );
      if (conflictRows[0]) {
        throw new DomainError("TERMINAL_CODE_EXISTS", "Terminalkode finnes allerede i hallen.");
      }
    }

    const { rows } = await this.pool.query<TerminalRow>(
      `UPDATE ${this.terminalsTable()}
       SET terminal_code = $2,
           display_name = $3,
           is_active = $4,
           last_seen_at = $5,
           updated_at = now()
       WHERE id = $1
       RETURNING id, hall_id, terminal_code, display_name, is_active, last_seen_at, created_at, updated_at`,
      [existing.id, nextTerminalCode, nextDisplayName, nextIsActive, nextLastSeenAt]
    );
    return this.mapTerminal(rows[0]);
  }

  async listHallGameConfigs(options?: {
    hallId?: string;
    includeDisabled?: boolean;
  }): Promise<HallGameConfigDefinition[]> {
    await this.ensureInitialized();
    const includeDisabled = options?.includeDisabled ?? true;
    let hallId: string | undefined;
    if (options?.hallId) {
      const hall = await this.getHall(options.hallId);
      hallId = hall.id;
    }

    const params: string[] = [];
    const conditions: string[] = [];
    if (!includeDisabled) {
      conditions.push("is_enabled = true");
    }
    if (hallId) {
      params.push(hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await this.pool.query<HallGameConfigRow>(
      `SELECT hall_id, game_slug, is_enabled, max_tickets_per_player, min_round_interval_ms, created_at, updated_at
       FROM ${this.hallGameConfigTable()}
       ${whereClause}
       ORDER BY hall_id ASC, game_slug ASC`,
      params
    );
    return rows.map((row) => this.mapHallGameConfig(row));
  }

  async upsertHallGameConfig(input: UpsertHallGameConfigInput): Promise<HallGameConfigDefinition> {
    await this.ensureInitialized();
    const hall = await this.getHall(input.hallId);
    const gameSlug = this.assertGameSlug(input.gameSlug);
    await this.getGame(gameSlug);

    const { rows: existingRows } = await this.pool.query<HallGameConfigRow>(
      `SELECT hall_id, game_slug, is_enabled, max_tickets_per_player, min_round_interval_ms, created_at, updated_at
       FROM ${this.hallGameConfigTable()}
       WHERE hall_id = $1
         AND game_slug = $2`,
      [hall.id, gameSlug]
    );
    const existing = existingRows[0];

    const nextIsEnabled = input.isEnabled ?? existing?.is_enabled ?? true;
    const nextMaxTicketsPerPlayer = this.assertMaxTicketsPerPlayer(
      input.maxTicketsPerPlayer ?? existing?.max_tickets_per_player ?? 5
    );
    const nextMinRoundIntervalMs = this.assertMinRoundIntervalMs(
      input.minRoundIntervalMs ?? existing?.min_round_interval_ms ?? 30000
    );

    const { rows } = await this.pool.query<HallGameConfigRow>(
      `INSERT INTO ${this.hallGameConfigTable()}
        (hall_id, game_slug, is_enabled, max_tickets_per_player, min_round_interval_ms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (hall_id, game_slug) DO UPDATE
       SET is_enabled = EXCLUDED.is_enabled,
           max_tickets_per_player = EXCLUDED.max_tickets_per_player,
           min_round_interval_ms = EXCLUDED.min_round_interval_ms,
           updated_at = now()
       RETURNING hall_id, game_slug, is_enabled, max_tickets_per_player, min_round_interval_ms, created_at, updated_at`,
      [hall.id, gameSlug, nextIsEnabled, nextMaxTicketsPerPlayer, nextMinRoundIntervalMs]
    );
    return this.mapHallGameConfig(rows[0]);
  }

  async submitKycVerification(input: {
    userId: string;
    birthDate: string;
    nationalId?: string;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const birthDate = this.assertBirthDate(input.birthDate);
    const current = await this.getUserById(userId);

    const nowIso = new Date().toISOString();
    if (!this.kycAdapter) {
      const ageYears = calculateAgeYears(new Date(birthDate), new Date());
      if (ageYears < this.minAgeYears) {
        const updated = await this.updateKycStatus({
          userId: current.id,
          status: "REJECTED",
          birthDate,
          providerRef: "local-no-provider",
          verifiedAt: nowIso
        });
        return updated;
      }
      return this.updateKycStatus({
        userId: current.id,
        status: "VERIFIED",
        birthDate,
        providerRef: "local-no-provider",
        verifiedAt: nowIso
      });
    }

    await this.updateKycStatus({
      userId: current.id,
      status: "PENDING",
      birthDate,
      providerRef: undefined,
      verifiedAt: undefined
    });

    let result: Awaited<ReturnType<KycAdapter["verify"]>>;
    try {
      result = await this.kycAdapter.verify({
        userId: current.id,
        birthDate,
        nationalId: input.nationalId
      });
    } catch {
      throw new DomainError("KYC_PROVIDER_ERROR", "Klarte ikke verifisere KYC akkurat nå.");
    }

    return this.updateKycStatus({
      userId: current.id,
      status: result.decision === "VERIFIED" ? "VERIFIED" : "REJECTED",
      birthDate,
      providerRef: result.providerReference,
      verifiedAt: result.checkedAt
    });
  }

  async getUserById(userIdInput: string): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(userIdInput, "userId");
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, display_name, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at
       FROM ${this.usersTable()}
       WHERE id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.mapUser(row);
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string; email?: string; phone?: string }
  ): Promise<PublicAppUser> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userId, "userId");
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.displayName !== undefined) {
      const name = input.displayName.trim();
      this.assertDisplayName(name);
      sets.push(`display_name = $${idx++}`);
      values.push(name);
    }
    if (input.email !== undefined) {
      const email = normalizeEmail(input.email);
      this.assertEmail(email);
      const { rows: existing } = await this.pool.query<{ id: string }>(
        `SELECT id FROM ${this.usersTable()} WHERE email = $1 AND id != $2`,
        [email, id]
      );
      if (existing[0]) {
        throw new DomainError("EMAIL_EXISTS", "E-post er allerede i bruk.");
      }
      sets.push(`email = $${idx++}`);
      values.push(email);
    }
    if (input.phone !== undefined) {
      sets.push(`phone = $${idx++}`);
      values.push(input.phone.trim());
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    sets.push(`updated_at = now()`);
    values.push(id);

    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET ${sets.join(", ")}
       WHERE id = $${idx}
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at`,
      values
    );
    if (!rows[0]) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.withBalance(this.mapUser(rows[0]));
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string }
  ): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userId, "userId");
    this.assertPassword(input.newPassword);

    const { rows } = await this.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM ${this.usersTable()} WHERE id = $1`,
      [id]
    );
    if (!rows[0]) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    const ok = await this.verifyPassword(input.currentPassword, rows[0].password_hash);
    if (!ok) {
      throw new DomainError("INVALID_CREDENTIALS", "Nåværende passord er feil.");
    }

    const newHash = await this.hashPassword(input.newPassword);
    await this.pool.query(
      `UPDATE ${this.usersTable()} SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [id, newHash]
    );
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userId, "userId");

    const user = await this.getUserById(id);
    if (user.role === "ADMIN") {
      const { rows } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.usersTable()} WHERE role = 'ADMIN'`
      );
      if (Number(rows[0]?.count ?? "0") <= 1) {
        throw new DomainError("LAST_ADMIN_REQUIRED", "Kan ikke slette siste admin.");
      }
    }

    // Revoke all sessions
    await this.pool.query(
      `UPDATE ${this.sessionsTable()} SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [id]
    );
    // Soft-delete by anonymising
    await this.pool.query(
      `UPDATE ${this.usersTable()}
       SET email = 'deleted-' || id || '@deleted',
           display_name = 'Slettet bruker',
           password_hash = 'DELETED',
           updated_at = now()
       WHERE id = $1`,
      [id]
    );
  }

  async updateUserRole(userIdInput: string, roleInput: UserRole): Promise<PublicAppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(userIdInput, "userId");
    const nextRole = this.assertUserRole(roleInput);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existingRows } = await client.query<UserRow>(
        `SELECT id, email, display_name, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at
         FROM ${this.usersTable()}
         WHERE id = $1
         FOR UPDATE`,
        [userId]
      );
      const existing = existingRows[0];
      if (!existing) {
        throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
      }

      if (existing.role === "ADMIN" && nextRole !== "ADMIN") {
        const { rows: adminRows } = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM ${this.usersTable()}
           WHERE role = 'ADMIN'`
        );
        const adminCount = Number(adminRows[0]?.count ?? "0");
        if (adminCount <= 1) {
          throw new DomainError("LAST_ADMIN_REQUIRED", "Kan ikke fjerne siste admin-bruker.");
        }
      }

      const { rows: updatedRows } = await client.query<UserRow>(
        `UPDATE ${this.usersTable()}
         SET role = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at`,
        [userId, nextRole]
      );
      await client.query("COMMIT");
      return this.withBalance(this.mapUser(updatedRows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  assertUserEligibleForGameplay(user: PublicAppUser): void {
    // DEV: skip KYC/age checks in development mode
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (user.kycStatus !== "VERIFIED") {
      throw new DomainError("KYC_REQUIRED", "KYC må verifiseres før spill kan startes.");
    }
    if (!user.birthDate) {
      throw new DomainError("KYC_REQUIRED", "Fødselsdato mangler for KYC-verifisering.");
    }

    const birthDate = new Date(user.birthDate);
    if (Number.isNaN(birthDate.getTime())) {
      throw new DomainError("KYC_REQUIRED", "Ugyldig fødselsdato registrert på bruker.");
    }
    const ageYears = calculateAgeYears(birthDate, new Date());
    if (ageYears < this.minAgeYears) {
      throw new DomainError("AGE_RESTRICTED", `Spiller må være minst ${this.minAgeYears} år.`);
    }
  }

  /**
   * BIN-174: Refresh an existing session — issue a new token and revoke the old one.
   * The old token must still be valid (not expired, not revoked).
   */
  async refreshSession(oldAccessToken: string): Promise<SessionInfo> {
    await this.ensureInitialized();
    const token = oldAccessToken.trim();
    if (!token) {
      throw new DomainError("UNAUTHORIZED", "Mangler access token.");
    }

    const tokenHash = hashToken(token);

    // Validate old token and get user
    const { rows } = await this.pool.query<UserRow & { session_id: string }>(
      `SELECT s.id AS session_id, u.id, u.email, u.display_name, u.surname, u.wallet_id, u.role, u.kyc_status,
              u.birth_date, u.kyc_verified_at, u.kyc_provider_ref, u.created_at, u.updated_at
       FROM ${this.sessionsTable()} s
       JOIN ${this.usersTable()} u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [tokenHash]
    );

    const row = rows[0];
    if (!row) {
      throw new DomainError("UNAUTHORIZED", "Token er utlopt eller ugyldig. Logg inn pa nytt.");
    }

    // Revoke old session
    await this.pool.query(
      `UPDATE ${this.sessionsTable()} SET revoked_at = now() WHERE token_hash = $1`,
      [tokenHash]
    );

    // Create new session
    const newSession = await this.createSession(row.id);
    const user = await this.withBalance(this.mapUser(row));

    return {
      accessToken: newSession.accessToken,
      expiresAt: newSession.expiresAt,
      user
    };
  }

  private async createSession(userId: string): Promise<{ accessToken: string; expiresAt: string }> {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1000).toISOString();
    await this.pool.query(
      `INSERT INTO ${this.sessionsTable()} (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, tokenHash, expiresAt]
    );
    return { accessToken: rawToken, expiresAt };
  }

  private async withBalance(user: AppUser): Promise<PublicAppUser> {
    const balance = await this.walletAdapter.getBalance(user.walletId);
    return {
      ...user,
      balance
    };
  }

  private mapUser(row: UserRow): AppUser {
    const birthDate =
      typeof row.birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.birth_date)
        ? row.birth_date
        : row.birth_date
          ? asIso(row.birth_date).slice(0, 10)
          : undefined;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      surname: row.surname ?? undefined,
      phone: row.phone ?? undefined,
      complianceData: row.compliance_data ?? undefined,
      walletId: row.wallet_id,
      role: row.role,
      kycStatus: row.kyc_status,
      birthDate,
      kycVerifiedAt: row.kyc_verified_at ? asIso(row.kyc_verified_at) : undefined,
      kycProviderRef: row.kyc_provider_ref ?? undefined,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapGame(row: GameRow): GameDefinition {
    return {
      slug: row.slug,
      title: row.title,
      description: row.description,
      route: row.route,
      isEnabled: row.is_enabled,
      sortOrder: Number(row.sort_order),
      settings: row.settings_json ?? {},
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapHall(row: HallRow): HallDefinition {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      region: row.region,
      address: row.address,
      organizationNumber: row.organization_number ?? undefined,
      settlementAccount: row.settlement_account ?? undefined,
      invoiceMethod: row.invoice_method ?? undefined,
      isActive: row.is_active,
      // BIN-540: default to "unity" if the column is somehow null (should not
      // happen — CHECK constraint enforces non-null with DEFAULT 'unity' — but
      // guards against rows pre-dating the migration on a mid-flight deploy).
      clientVariant: (row.client_variant ?? "unity") as HallClientVariant,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapTerminal(row: TerminalRow): TerminalDefinition {
    return {
      id: row.id,
      hallId: row.hall_id,
      terminalCode: row.terminal_code,
      displayName: row.display_name,
      isActive: row.is_active,
      lastSeenAt: row.last_seen_at ? asIso(row.last_seen_at) : undefined,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapHallGameConfig(row: HallGameConfigRow): HallGameConfigDefinition {
    return {
      hallId: row.hall_id,
      gameSlug: row.game_slug,
      isEnabled: row.is_enabled,
      maxTicketsPerPlayer: Number(row.max_tickets_per_player),
      minRoundIntervalMs: Number(row.min_round_interval_ms),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapScheduleSlot(row: ScheduleSlotRow): ScheduleSlot {
    return {
      id: row.id,
      hallId: row.hall_id,
      gameType: row.game_type,
      displayName: row.display_name,
      dayOfWeek: row.day_of_week,
      startTime: typeof row.start_time === "string" ? row.start_time.slice(0, 5) : String(row.start_time),
      prizeDescription: row.prize_description,
      maxTickets: Number(row.max_tickets),
      isActive: row.is_active,
      sortOrder: Number(row.sort_order),
      variantConfig: row.variant_config ?? {},
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  private mapScheduleLog(row: ScheduleLogRow): ScheduleLogEntry {
    return {
      id: row.id,
      hallId: row.hall_id,
      scheduleSlotId: row.schedule_slot_id,
      gameSessionId: row.game_session_id,
      startedAt: asIso(row.started_at),
      endedAt: row.ended_at ? asIso(row.ended_at) : null,
      playerCount: row.player_count,
      totalPayout: row.total_payout != null ? Number(row.total_payout) : null,
      notes: row.notes,
      createdAt: asIso(row.created_at)
    };
  }

  private mapGameSettingsChangeLogEntry(row: GameSettingsChangeLogRow): GameSettingsChangeLogEntry {
    return {
      id: row.id,
      gameSlug: row.game_slug,
      changedByUserId: row.changed_by_user_id ?? undefined,
      changedByDisplayName: row.changed_by_display_name,
      changedByRole: row.changed_by_role,
      source: row.source,
      effectiveFrom: row.effective_from ? asIso(row.effective_from) : undefined,
      payloadSummary: row.payload_summary,
      payload: row.payload_json ?? {},
      createdAt: asIso(row.created_at)
    };
  }

  private areSettingsDifferent(
    previousSettings: Record<string, unknown>,
    nextSettings: Record<string, unknown>
  ): boolean {
    return this.stableJsonStringify(previousSettings) !== this.stableJsonStringify(nextSettings);
  }

  private stableJsonStringify(value: unknown): string {
    return JSON.stringify(this.sortJsonValue(value));
  }

  private sortJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.sortJsonValue(entry));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
      sorted[key] = this.sortJsonValue(record[key]);
    }
    return sorted;
  }

  private extractChangedTopLevelKeys(
    previousSettings: Record<string, unknown>,
    nextSettings: Record<string, unknown>
  ): string[] {
    const keys = new Set<string>([...Object.keys(previousSettings), ...Object.keys(nextSettings)]);
    const changed: string[] = [];
    for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
      if (this.stableJsonStringify(previousSettings[key]) !== this.stableJsonStringify(nextSettings[key])) {
        changed.push(key);
      }
    }
    return changed;
  }

  private pickSettingsKeys(
    settings: Record<string, unknown>,
    keys: string[]
  ): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        picked[key] = settings[key];
      }
    }
    return picked;
  }

  private buildSettingsChangeSummary(changedKeys: string[]): string {
    if (changedKeys.length === 0) {
      return "Ingen settings-endring registrert.";
    }
    const preview = changedKeys.slice(0, 6).join(", ");
    if (changedKeys.length <= 6) {
      return `Endret ${changedKeys.length} felt: ${preview}.`;
    }
    return `Endret ${changedKeys.length} felt: ${preview} (+${changedKeys.length - 6} til).`;
  }

  private async insertGameSettingsChangeLog(
    client: PoolClient,
    input: {
      gameSlug: string;
      previousSettings: Record<string, unknown>;
      nextSettings: Record<string, unknown>;
      changedBy?: GameSettingsChangeContext;
      source: string;
      effectiveFrom?: string;
    }
  ): Promise<void> {
    const changedKeys = this.extractChangedTopLevelKeys(input.previousSettings, input.nextSettings);
    const payload = {
      changedKeys,
      previous: this.pickSettingsKeys(input.previousSettings, changedKeys),
      next: this.pickSettingsKeys(input.nextSettings, changedKeys)
    };

    const changedByDisplayName = this.assertAuditDisplayName(input.changedBy?.displayName ?? "System");
    const changedByRole = this.assertAuditActorRole(input.changedBy?.role);
    const source = this.assertAuditSource(input.source);
    const effectiveFrom =
      input.effectiveFrom !== undefined
        ? this.assertOptionalIsoDate(input.effectiveFrom, "effectiveFrom")
        : null;

    await client.query(
      `INSERT INTO ${this.gameSettingsChangeLogTable()}
        (id, game_slug, changed_by_user_id, changed_by_display_name, changed_by_role, source, effective_from, payload_summary, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        randomUUID(),
        input.gameSlug,
        input.changedBy?.userId ?? null,
        changedByDisplayName,
        changedByRole,
        source,
        effectiveFrom,
        this.buildSettingsChangeSummary(changedKeys),
        JSON.stringify(payload)
      ]
    );
  }

  private async resolveHallRowByReference(hallReference: string): Promise<HallRow | undefined> {
    const normalizedReference = this.assertEntityReference(hallReference, "hallId");
    const normalizedSlug = normalizedReference.toLowerCase();
    const { rows } = await this.pool.query<HallRow>(
      `SELECT id, slug, name, region, address, is_active, client_variant, created_at, updated_at
       FROM ${this.hallsTable()}
       WHERE id = $1
          OR slug = $2
       LIMIT 1`,
      [normalizedReference, normalizedSlug]
    );
    return rows[0];
  }

  private async seedHallGameConfigForHall(client: PoolClient, hallId: string): Promise<void> {
    await client.query(
      `INSERT INTO ${this.hallGameConfigTable()}
        (hall_id, game_slug, is_enabled, max_tickets_per_player, min_round_interval_ms)
       SELECT $1, g.slug, true, 30, 30000
       FROM ${this.gamesTable()} g
       ON CONFLICT (hall_id, game_slug) DO NOTHING`,
      [hallId]
    );
  }

  private async seedHallGameConfigForAllHalls(client: PoolClient): Promise<void> {
    await client.query(
      `INSERT INTO ${this.hallGameConfigTable()}
        (hall_id, game_slug, is_enabled, max_tickets_per_player, min_round_interval_ms)
       SELECT h.id, g.slug, true, 30, 30000
       FROM ${this.hallsTable()} h
       CROSS JOIN ${this.gamesTable()} g
       ON CONFLICT (hall_id, game_slug) DO NOTHING`
    );
  }

  private async updateKycStatus(input: {
    userId: string;
    status: KycStatus;
    birthDate: string;
    providerRef?: string;
    verifiedAt?: string;
  }): Promise<AppUser> {
    const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt).toISOString() : null;
    const providerRef = input.providerRef?.trim() || null;
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET kyc_status = $2,
           birth_date = $3::date,
           kyc_provider_ref = $4,
           kyc_verified_at = $5,
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, created_at, updated_at`,
      [input.userId, input.status, input.birthDate, providerRef, verifiedAt]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.mapUser(row);
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
        `CREATE TABLE IF NOT EXISTS ${this.usersTable()} (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          wallet_id TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER')),
          kyc_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          birth_date DATE NULL,
          kyc_verified_at TIMESTAMPTZ NULL,
          kyc_provider_ref TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'UNVERIFIED'`
      );
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS birth_date DATE NULL`
      );
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ NULL`
      );
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS kyc_provider_ref TEXT NULL`
      );
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS phone TEXT NULL`
      );
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS surname TEXT NULL`
      );
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS compliance_data JSONB NULL`
      );
      await this.ensureUserRoleConstraint(client);

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.sessionsTable()} (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES ${this.usersTable()}(id),
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.gamesTable()} (
          slug TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          route TEXT NOT NULL,
          is_enabled BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER NOT NULL DEFAULT 100,
          settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.gameSettingsChangeLogTable()} (
          id TEXT PRIMARY KEY,
          game_slug TEXT NOT NULL REFERENCES ${this.gamesTable()}(slug) ON DELETE CASCADE,
          changed_by_user_id TEXT NULL REFERENCES ${this.usersTable()}(id) ON DELETE SET NULL,
          changed_by_display_name TEXT NOT NULL,
          changed_by_role TEXT NOT NULL,
          source TEXT NOT NULL,
          effective_from TIMESTAMPTZ NULL,
          payload_summary TEXT NOT NULL,
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.hallsTable()} (
          id TEXT PRIMARY KEY,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          region TEXT NOT NULL DEFAULT 'NO',
          address TEXT NOT NULL DEFAULT '',
          organization_number TEXT,
          settlement_account TEXT,
          invoice_method TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      // Add columns if upgrading from older schema
      for (const col of ["organization_number TEXT", "settlement_account TEXT", "invoice_method TEXT"]) {
        await client.query(
          `ALTER TABLE ${this.hallsTable()} ADD COLUMN IF NOT EXISTS ${col}`
        ).catch(() => {});
      }

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.terminalsTable()} (
          id TEXT PRIMARY KEY,
          hall_id TEXT NOT NULL REFERENCES ${this.hallsTable()}(id) ON DELETE CASCADE,
          terminal_code TEXT NOT NULL,
          display_name TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          last_seen_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (hall_id, terminal_code)
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.hallGameConfigTable()} (
          hall_id TEXT NOT NULL REFERENCES ${this.hallsTable()}(id) ON DELETE CASCADE,
          game_slug TEXT NOT NULL REFERENCES ${this.gamesTable()}(slug) ON DELETE CASCADE,
          is_enabled BOOLEAN NOT NULL DEFAULT true,
          max_tickets_per_player INTEGER NOT NULL DEFAULT 30 CHECK (max_tickets_per_player >= 1 AND max_tickets_per_player <= 30),
          min_round_interval_ms INTEGER NOT NULL DEFAULT 30000 CHECK (min_round_interval_ms >= 30000),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (hall_id, game_slug)
        )`
      );

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_sessions_token_hash
         ON ${this.sessionsTable()} (token_hash)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_terminals_hall_id
         ON ${this.terminalsTable()} (hall_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_hall_game_config_game_slug
         ON ${this.hallGameConfigTable()} (game_slug)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_game_settings_change_log_created_at
         ON ${this.gameSettingsChangeLogTable()} (created_at DESC)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_game_settings_change_log_game_slug_created_at
         ON ${this.gameSettingsChangeLogTable()} (game_slug, created_at DESC)`
      );

      // ── Spilleplan (§ 64) ─────────────────────────────────────────────────
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.scheduleTable()} (
          id TEXT PRIMARY KEY,
          hall_id TEXT NOT NULL REFERENCES ${this.hallsTable()}(id) ON DELETE CASCADE,
          game_type TEXT NOT NULL DEFAULT 'standard',
          display_name TEXT NOT NULL,
          day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
          start_time TIME NOT NULL,
          prize_description TEXT NOT NULL DEFAULT '',
          max_tickets INTEGER NOT NULL DEFAULT 30 CHECK (max_tickets >= 1 AND max_tickets <= 30),
          is_active BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.scheduleLogTable()} (
          id TEXT PRIMARY KEY,
          hall_id TEXT NOT NULL,
          schedule_slot_id TEXT REFERENCES ${this.scheduleTable()}(id) ON DELETE SET NULL,
          game_session_id TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at TIMESTAMPTZ,
          player_count INTEGER,
          total_payout NUMERIC,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_hall_game_schedules_hall_id
         ON ${this.scheduleTable()} (hall_id, is_active, day_of_week, start_time)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_hall_schedule_log_hall_id
         ON ${this.scheduleLogTable()} (hall_id, started_at DESC)`
      );

      const gameSeeds: Array<[string, string, string, string, boolean, number, object]> = [
        ["bingo",        "Bingo",        "75-kulsbingo med flere spillvarianter",    "/bingo",        true, 1, { gameNumber: 1 }],
        ["rocket",       "Rocket",       "Tallspill med 3x3 brett og Lucky Number",  "/rocket",       true, 2, { gameNumber: 2 }],
        ["monsterbingo", "Mønsterbingo", "Bingo med mønstergevinster",               "/monsterbingo", true, 3, { gameNumber: 3 }],
        // temabingo (game 4) utgår per BIN-496. isEnabled=false sikrer at fresh DB
        // ikke får aktiv temabingo. ON CONFLICT-oppdateringen under rører ikke
        // is_enabled, så eksisterende DB-verdier (styrt av migration
        // 20260417120000_deactivate_game4_temabingo.sql) beholdes.
        ["temabingo",    "Temabingo",    "Bingo med temaer og multiplikator (utgått, BIN-496)", "/temabingo", false, 4, { gameNumber: 4, deprecated: true }],
        ["spillorama",   "Spillorama",   "Spillorama-bingo med bonusspill",           "/spillorama",   true, 5, { gameNumber: 5 }],
        ["candy",        "Candy Mania",  "Candy-spillet",                             "/candy",        true, 6, { gameNumber: 6 }],
      ];
      for (const [slug, title, description, route, isEnabled, sortOrder, settings] of gameSeeds) {
        await client.query(
          `INSERT INTO ${this.gamesTable()} (slug, title, description, route, is_enabled, sort_order, settings_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (slug) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             route = EXCLUDED.route,
             sort_order = EXCLUDED.sort_order,
             settings_json = ${this.gamesTable()}.settings_json || EXCLUDED.settings_json,
             updated_at = now()`,
          [slug, title, description, route, isEnabled, sortOrder, JSON.stringify(settings)]
        );
      }
      await client.query(
        `INSERT INTO ${this.hallsTable()} (id, slug, name, region, address, is_active)
         VALUES ($1, $2, 'Default hall', 'NO', '', true)
         ON CONFLICT DO NOTHING`,
        [DEFAULT_HALL_ID, DEFAULT_HALL_SLUG]
      );
      await this.seedHallGameConfigForAllHalls(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  private usersTable(): string {
    return `"${this.schema}"."app_users"`;
  }

  private sessionsTable(): string {
    return `"${this.schema}"."app_sessions"`;
  }

  private gamesTable(): string {
    return `"${this.schema}"."app_games"`;
  }

  private gameSettingsChangeLogTable(): string {
    return `"${this.schema}"."app_game_settings_change_log"`;
  }

  private hallsTable(): string {
    return `"${this.schema}"."app_halls"`;
  }

  private terminalsTable(): string {
    return `"${this.schema}"."app_terminals"`;
  }

  private hallGameConfigTable(): string {
    return `"${this.schema}"."app_hall_game_config"`;
  }

  private scheduleTable(): string {
    return `"${this.schema}"."hall_game_schedules"`;
  }

  private scheduleLogTable(): string {
    return `"${this.schema}"."hall_schedule_log"`;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const digest = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const { saltHex, digestHex } = parseHashEnvelope(storedHash);
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(digestHex, "hex");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }

  private assertEmail(email: string): void {
    if (!email || email.length > 255 || !email.includes("@")) {
      throw new DomainError("INVALID_EMAIL", "Ugyldig e-post.");
    }
  }

  private assertDisplayName(displayName: string): void {
    if (!displayName || displayName.length > 40) {
      throw new DomainError("INVALID_NAME", "displayName må være 1-40 tegn.");
    }
  }

  private assertSurname(surname: string): void {
    if (!surname || surname.length > 80) {
      throw new DomainError("INVALID_NAME", "Etternavn må være 1-80 tegn.");
    }
  }

  private assertPassword(password: string): void {
    if (password.length < 12 || password.length > 128) {
      throw new DomainError("INVALID_PASSWORD", "Passord må være mellom 12 og 128 tegn.");
    }
    if (!/[A-Z]/.test(password)) {
      throw new DomainError("INVALID_PASSWORD", "Passord må inneholde minst én stor bokstav.");
    }
    if (!/[a-z]/.test(password)) {
      throw new DomainError("INVALID_PASSWORD", "Passord må inneholde minst én liten bokstav.");
    }
    if (!/[0-9]/.test(password)) {
      throw new DomainError("INVALID_PASSWORD", "Passord må inneholde minst ett siffer.");
    }
  }

  /** Light check used only at login — avoids locking out existing users with legacy passwords. */
  private assertLoginPassword(password: string): void {
    if (!password || password.length > 128) {
      throw new DomainError("INVALID_PASSWORD", "Passord mangler eller er for langt.");
    }
  }

  private assertUserRole(roleInput: string): UserRole {
    const normalized = roleInput.trim().toUpperCase() as UserRole;
    if (!APP_USER_ROLES.includes(normalized)) {
      throw new DomainError("INVALID_INPUT", `role må være en av: ${APP_USER_ROLES.join(", ")}.`);
    }
    return normalized;
  }

  private assertBirthDate(birthDateInput: string): string {
    const value = birthDateInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new DomainError("INVALID_BIRTH_DATE", "birthDate må være i format YYYY-MM-DD.");
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new DomainError("INVALID_BIRTH_DATE", "birthDate er ugyldig.");
    }
    return value;
  }

  private assertGameSlug(slug: string): string {
    const normalized = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(normalized)) {
      throw new DomainError("INVALID_GAME_SLUG", "Ugyldig game slug.");
    }
    return normalized;
  }

  private assertTitle(title: string): string {
    const value = title.trim();
    if (!value || value.length > 80) {
      throw new DomainError("INVALID_TITLE", "title må være 1-80 tegn.");
    }
    return value;
  }

  private assertDescription(description: string): string {
    const value = description.trim();
    if (!value || value.length > 500) {
      throw new DomainError("INVALID_DESCRIPTION", "description må være 1-500 tegn.");
    }
    return value;
  }

  private assertRoute(route: string): string {
    const value = route.trim();
    if (!value.startsWith("/") || value.length > 120) {
      throw new DomainError("INVALID_ROUTE", "route må starte med '/' og være maks 120 tegn.");
    }
    return value;
  }

  private assertSortOrder(sortOrder: number): number {
    if (!Number.isFinite(sortOrder)) {
      throw new DomainError("INVALID_SORT_ORDER", "sortOrder må være et tall.");
    }
    return Math.floor(sortOrder);
  }

  private assertSettings(settings: Record<string, unknown>): Record<string, unknown> {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new DomainError("INVALID_SETTINGS", "settings må være et objekt.");
    }
    return settings;
  }

  private assertEntityReference(value: string, fieldName: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 120) {
      throw new DomainError("INVALID_INPUT", `${fieldName} er ugyldig.`);
    }
    return normalized;
  }

  private assertNonEmptyString(value: string, field: string, maxLen: number): string {
    const v = (value ?? "").trim();
    if (!v || v.length > maxLen) {
      throw new DomainError("INVALID_INPUT", `${field} er påkrevd og må være maks ${maxLen} tegn.`);
    }
    return v;
  }

  private assertTimeString(value: string): string {
    const v = (value ?? "").trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(v)) {
      throw new DomainError("INVALID_INPUT", "startTime må være på formatet HH:MM eller HH:MM:SS.");
    }
    return v;
  }

  private assertHallSlug(slug: string): string {
    const normalized = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(normalized)) {
      throw new DomainError("INVALID_HALL_SLUG", "hall.slug må være 2-40 tegn (a-z, 0-9, bindestrek).");
    }
    return normalized;
  }

  private assertHallName(name: string): string {
    const value = name.trim();
    if (!value || value.length > 120) {
      throw new DomainError("INVALID_HALL_NAME", "hall.name må være 1-120 tegn.");
    }
    return value;
  }

  private assertHallRegion(region: string): string {
    const value = region.trim().toUpperCase();
    if (!value || value.length > 40) {
      throw new DomainError("INVALID_HALL_REGION", "hall.region må være 1-40 tegn.");
    }
    return value;
  }

  private assertHallAddress(address: string): string {
    const value = address.trim();
    if (value.length > 200) {
      throw new DomainError("INVALID_HALL_ADDRESS", "hall.address kan være maks 200 tegn.");
    }
    return value;
  }

  private assertTerminalCode(terminalCode: string): string {
    const value = terminalCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(value)) {
      throw new DomainError("INVALID_TERMINAL_CODE", "terminalCode må være 2-40 tegn (A-Z, 0-9, _ eller -).");
    }
    return value;
  }

  private assertTerminalDisplayName(displayName: string): string {
    const value = displayName.trim();
    if (!value || value.length > 80) {
      throw new DomainError("INVALID_TERMINAL_NAME", "displayName må være 1-80 tegn.");
    }
    return value;
  }

  private assertOptionalIsoDate(value: string, fieldName: string): string | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være en gyldig dato.`);
    }
    return parsed.toISOString();
  }

  private assertMaxTicketsPerPlayer(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new DomainError("INVALID_MAX_TICKETS", "maxTicketsPerPlayer må være et heltall mellom 1 og 5.");
    }
    return value;
  }

  private assertMinRoundIntervalMs(value: number): number {
    if (!Number.isFinite(value) || value < 30000) {
      throw new DomainError("INVALID_MIN_ROUND_INTERVAL", "minRoundIntervalMs må være minst 30000.");
    }
    return Math.floor(value);
  }

  private assertAuditLimit(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 50;
    }
    return Math.max(1, Math.min(200, Math.floor(value)));
  }

  private assertAuditSource(sourceInput: string): string {
    const source = sourceInput.trim().toUpperCase();
    if (!source || source.length > 80) {
      throw new DomainError("INVALID_INPUT", "source må være 1-80 tegn.");
    }
    return source;
  }

  private assertAuditDisplayName(displayNameInput: string): string {
    const displayName = displayNameInput.trim();
    if (!displayName || displayName.length > 120) {
      throw new DomainError("INVALID_INPUT", "changedByDisplayName må være 1-120 tegn.");
    }
    return displayName;
  }

  private assertAuditActorRole(roleInput: UserRole | undefined): string {
    if (!roleInput) {
      return "SYSTEM";
    }
    return this.assertUserRole(roleInput);
  }

  private async ensureUserRoleConstraint(client: PoolClient): Promise<void> {
    const { rows } = await client.query<{ constraint_name: string; definition: string }>(
      `SELECT c.conname AS constraint_name,
              pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t
         ON t.oid = c.conrelid
       JOIN pg_namespace n
         ON n.oid = t.relnamespace
       WHERE n.nspname = $1
         AND t.relname = 'app_users'
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) ILIKE '%role%'`,
      [this.schema]
    );
    if (rows.length === 1) {
      const definition = rows[0].definition;
      const hasAllRoles =
        definition.includes("'ADMIN'") &&
        definition.includes("'HALL_OPERATOR'") &&
        definition.includes("'SUPPORT'") &&
        definition.includes("'PLAYER'");
      if (hasAllRoles) {
        return;
      }
    }

    for (const row of rows) {
      const constraintName = row.constraint_name.replaceAll(`"`, `""`);
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         DROP CONSTRAINT IF EXISTS "${constraintName}"`
      );
    }

    await client.query(
      `ALTER TABLE ${this.usersTable()}
       ADD CONSTRAINT app_users_role_check
       CHECK (role IN ('ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER'))`
    );
  }

  private wrapError(error: unknown): Error {
    if (error instanceof DomainError) {
      return error;
    }
    if (error instanceof WalletError) {
      return error;
    }
    console.error("[PlatformService] DB error:", error);
    return new DomainError("PLATFORM_DB_ERROR", "Feil i plattform-databasen.");
  }
}
