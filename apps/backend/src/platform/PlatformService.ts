import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type { KycAdapter } from "../adapters/KycAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import { DomainError } from "../game/BingoEngine.js";
import { SubGameManager, type PlannedChildGame, type SubGameInput } from "../game/SubGameManager.js";

const scrypt = promisify(scryptCallback);

export const APP_USER_ROLES = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "PLAYER", "AGENT"] as const;
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
  /**
   * BIN-591: hall scope for HALL_OPERATOR. `null` for ADMIN/SUPPORT/PLAYER
   * og for en HALL_OPERATOR som ennå ikke er tildelt en hall (fail closed
   * for hall-scoped write-operasjoner).
   */
  hallId: string | null;
  kycStatus: KycStatus;
  birthDate?: string;
  kycVerifiedAt?: string;
  kycProviderRef?: string;
  /**
   * GAP #5: profile/BankID image-URLs. Settes via
   * `POST /api/players/me/profile/image?category=...`. `null` når ingen
   * upload har skjedd. Verdien kan være en relativ sti (lokal storage)
   * eller absolutt URL (Cloudinary).
   */
  profileImageUrl?: string | null;
  bankidSelfieUrl?: string | null;
  bankidDocumentUrl?: string | null;
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

/**
 * Per-hall klient-variant. Kun "web" er gyldig nå — det finnes bare én
 * klient-stack. Type + endpoint + DB-kolonne beholdes som navngitte
 * shape-kompatibilitets-felter så eldre admin-UI ikke krasjer på
 * field-presence; settere er no-ops og GET returnerer alltid "web".
 */
export type HallClientVariant = "web";
export const HALL_CLIENT_VARIANTS: readonly HallClientVariant[] = ["web"] as const;

/**
 * TV-kiosk voice-pack-valg. Hver hall kan velge mellom 3 voice-packs for
 * ball-utrop på TV-skjermen. Default er `voice1`. Audio-filene lastes av
 * TV-klienten fra `/assets/tv-voices/<voice>/<ball>.mp3`.
 *
 * Wireframe PDF 14 (TV Screen + Winners) + 2026-04-24 PM-beslutning.
 */
export type HallTvVoice = "voice1" | "voice2" | "voice3";
export const HALL_TV_VOICES: readonly HallTvVoice[] = ["voice1", "voice2", "voice3"] as const;

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
  /**
   * Klient-variant. Bare "web" er gyldig. DB-kolonnen er droppet
   * (migrasjon 20260429000000); feltet beholdes i API-shapen slik at
   * eksisterende admin-UI ikke krasjer ved deploy, men verdien er alltid
   * "web" og settere er no-ops.
   */
  clientVariant: HallClientVariant;
  /** BIN-498: optional embed URL shown on the hall TV-display between rounds. */
  tvUrl?: string;
  /**
   * Legacy Hall Number (101, 102, ...). Brukes for IP→hall-mapping og for
   * Import Player Excel-mapping. Migrasjon 20260701000000: unique-per-hall
   * når ikke null.
   */
  hallNumber?: number | null;
  /**
   * BIN-583: nåværende cash-balanse hallen selv disponerer ("Available
   * Balance"). Muteres atomisk via HallCashLedger.applyCashTx — direkte
   * skriving utenfor ledger er ikke tillatt.
   */
  cashBalance?: number;
  /**
   * TV Screen public token (URL-embedded) — auto-generert pr. hall, unik.
   * Brukes av `/api/tv/:hallId/:tvToken/state` + `/api/tv/:hallId/:tvToken/winners`
   * for å autentisere TV-kiosk-skjermer uten login.
   * Separat fra BIN-503 display-tokens (som er socket-handshake, hash-lagret).
   * Optional i type-hierarkiet for bakoverkompatibilitet med eldre test-fixtures;
   * alltid satt av `mapHall()` (DB-kolonnen har NOT NULL DEFAULT gen_random_uuid()).
   */
  tvToken?: string;
  /**
   * TV-kiosk voice-pack for ball-utrop (wireframe PDF 14, 2026-04-24).
   * NOT NULL DEFAULT 'voice1' i DB; optional i typen for bakoverkompat
   * med eldre fixtures som ikke setter feltet.
   */
  tvVoiceSelection?: HallTvVoice;
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
  hallNumber?: number | null;
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
  /**
   * Legacy BIN-540 felt. Aksepteres for shape-compat men ignoreres —
   * verdien er alltid "web".
   */
  clientVariant?: HallClientVariant;
  hallNumber?: number | null;
}

/** BIN-503: DB-backed TV-display tokens. Plaintext never stored or read back. */
export interface HallDisplayToken {
  id: string;
  hallId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  createdByUserId?: string;
}

/** Shape returned from createHallDisplayToken. Plaintext token is the only
 *  time the raw secret is ever available — caller is responsible for
 *  showing it to the operator once and never logging it. */
export interface HallDisplayTokenWithPlaintext extends HallDisplayToken {
  plaintextToken: string;
  /** Composite "<hallSlug>:<plaintextToken>" used in admin-display:login. */
  compositeToken: string;
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
  /** BIN-615 / PR-C1: Parent schedule id — set on child rows spawned by SubGameManager. */
  parentScheduleId?: string | null;
  /** BIN-615 / PR-C1: 1-based sequence within parent (null on parent rows). */
  subGameSequence?: number | null;
  /** BIN-615 / PR-C1: Legacy-compatible gameNumber "CH_<seq>_<ts>_G2|G3" (null on parent rows). */
  subGameNumber?: string | null;
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
  hall_id: string | null;
  kyc_status: KycStatus;
  birth_date: Date | string | null;
  kyc_verified_at: Date | string | null;
  kyc_provider_ref: string | null;
  compliance_data: Record<string, unknown> | null;
  /** GAP #5: profile/BankID image storage URLs. Optional på alle queries
   *  så eksisterende SELECT-er som ikke ber om kolonnene fortsetter å virke. */
  profile_image_url?: string | null;
  bankid_selfie_url?: string | null;
  bankid_document_url?: string | null;
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
  /** BIN-498. */
  tv_url: string | null;
  /** Migrasjon 20260701000000: legacy Hall Number (101, 102, ...). */
  hall_number: number | null;
  /** BIN-583 B3.3: running cash-balanse (tilgjengelig saldo). */
  cash_balance: string | number | null;
  /** TV Screen public token — backfilt til uuid i migration 20260423000100. */
  tv_token: string;
  /** TV-kiosk voice-pack — migration 20260811000000. NOT NULL DEFAULT 'voice1'. */
  tv_voice_selection: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface HallDisplayTokenRow {
  id: string;
  hall_id: string;
  label: string;
  token_hash: string;
  created_by: string | null;
  created_at: Date | string;
  revoked_at: Date | string | null;
  last_used_at: Date | string | null;
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
  parent_schedule_id?: string | null;
  sub_game_sequence?: number | null;
  sub_game_number?: string | null;
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

  /**
   * BIN-720 follow-up: optional gate for time-based block-myself
   * (1d/7d/30d via app_user_profile_settings.blocked_until). Wired
   * after both PlatformService and ProfileSettingsService are
   * constructed (chicken-and-egg: ProfileSettingsService needs
   * BingoEngine which needs PlatformService for some test paths).
   * When undefined the gate is a no-op — keeps test harnesses and
   * deployments without RG-persistence working.
   */
  private profileSettingsService?: {
    assertUserNotBlocked(userId: string): Promise<void>;
  };

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

  /**
   * BIN-516: expose the underlying pg Pool so other stores (e.g.
   * ChatMessageStore) can share the same connection pool instead of
   * spinning up a parallel one. Read-only — callers must NOT close it.
   */
  getPool(): Pool {
    return this.pool;
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
         RETURNING id, email, display_name, surname, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, phone`,
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
      // BIN-587 B2.3: filter soft-deleted users — behandles som ukjent konto
      `SELECT id, email, display_name, surname, phone, password_hash, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at
       FROM ${this.usersTable()}
       WHERE email = $1 AND deleted_at IS NULL`,
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
      // BIN-587 B2.3: deleted_at IS NULL — soft-deleted users kan ikke re-
      // bruke eksisterende access-tokens etter at soft-delete revoker
      // sesjoner (belt-and-suspenders mot race mellom revoker og bruk)
      // GAP #5: profile_image_url + bankid_*_url er med i SELECT så
      // /api/players/me/profile kan returnere image-URL-ene direkte uten
      // ekstra round-trip.
      `SELECT u.id, u.email, u.display_name, u.surname, u.wallet_id, u.role, u.kyc_status, u.birth_date, u.kyc_verified_at, u.kyc_provider_ref, u.hall_id, u.created_at, u.updated_at,
              u.profile_image_url, u.bankid_selfie_url, u.bankid_document_url
       FROM ${this.sessionsTable()} s
       JOIN ${this.usersTable()} u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.deleted_at IS NULL
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

  /**
   * BIN-583 B3.1: admin-provisioned user creation.
   *
   * Used when an admin/hall-operator opprett-er en AGENT via
   * /api/admin/agents. Skiller seg fra `register`:
   *   - Ingen session lages (agenten må logge inn selv)
   *   - Caller styrer role (må være gyldig UserRole)
   *   - birthDate er valgfritt (AGENT skal ikke trenge fødselsdato
   *     slik en spiller gjør — compliance-data er admin-data i stedet)
   */
  async createAdminProvisionedUser(input: {
    email: string;
    password: string;
    displayName: string;
    surname: string;
    role: UserRole;
    phone?: string;
    birthDate?: string;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    const surname = input.surname.trim();
    this.assertEmail(email);
    this.assertDisplayName(displayName);
    this.assertSurname(surname);
    this.assertPassword(input.password);
    const birthDate = input.birthDate ? this.assertBirthDate(input.birthDate) : null;
    if (!APP_USER_ROLES.includes(input.role)) {
      throw new DomainError("INVALID_ROLE", "Ukjent rolle.");
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
      const userId = randomUUID();
      const walletId = `wallet-user-${userId}`;
      const phone = input.phone?.trim() || null;
      const { rows: createdRows } = await client.query<UserRow>(
        `INSERT INTO ${this.usersTable()}
          (id, email, display_name, surname, password_hash, wallet_id, role, phone, birth_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)
         RETURNING id, email, display_name, surname, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, phone`,
        [userId, email, displayName, surname, passwordHash, walletId, input.role, phone, birthDate]
      );
      await client.query("COMMIT");
      await this.walletAdapter.ensureAccount(walletId);
      return this.mapUser(createdRows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-633: admin oppretter en spiller manuelt (ingen self-service
   * register-flow). Brukes av admin-UI når en spiller trenger konto
   * opprettet av support/admin (f.eks. kontant-kunde som aldri registrerte
   * seg selv, eller migrasjon fra legacy).
   *
   * Skiller seg fra `register`:
   *   - Ingen session lages — spilleren må senere sette eget passord via
   *     forgot-password-flow eller logge inn med generert temp-passord
   *     som admin videreformidler. Passordet genereres her (ikke tatt
   *     fra admin) for å unngå at admin kan logge inn som spilleren.
   *   - Rollen er alltid PLAYER (skiller seg fra `createAdminProvisionedUser`
   *     som brukes til AGENT/SUPPORT/HALL_OPERATOR).
   *   - `hallId` kan settes direkte ved opprettelse (hall-scope for
   *     spilleren) — ellers null.
   *   - `bankIdStatus`: stub/manual-opprettet spiller får `kycStatus=UNVERIFIED`
   *     som default; admin kan senere trigge BankID-reverify eller
   *     overstyre KYC via eksisterende endepunkter.
   *   - `complianceData.createdBy = "ADMIN"` for audit-traceability.
   *
   * Duplikat-e-post kaster DomainError("EMAIL_EXISTS") — kaller mapper
   * dette til HTTP 400 + error.code="EMAIL_EXISTS".
   *
   * Returnerer den nye spilleren samt det genererte temp-passordet — kaller
   * må formidle dette ut-of-band (ikke over audit-logg).
   */
  async createPlayerByAdmin(input: {
    email: string;
    displayName: string;
    surname: string;
    birthDate: string;
    phone?: string;
    hallId?: string | null;
  }): Promise<{ user: AppUser; temporaryPassword: string }> {
    await this.ensureInitialized();
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    const surname = input.surname.trim();
    const birthDate = this.assertBirthDate(input.birthDate);
    this.assertEmail(email);
    this.assertDisplayName(displayName);
    this.assertSurname(surname);

    const ageYears = calculateAgeYears(new Date(birthDate), new Date());
    if (ageYears < this.minAgeYears) {
      throw new DomainError("AGE_RESTRICTED", `Spilleren må være minst ${this.minAgeYears} år.`);
    }

    const hallId = input.hallId?.trim() || null;
    const phone = input.phone?.trim() || null;
    // Generer et URL-safe 128-bit temp-passord. Lengden tilfredsstiller
    // assertPassword og tvinger forgot-password ved første innlogging.
    const temporaryPassword = randomBytes(16).toString("base64url");
    this.assertPassword(temporaryPassword);
    const passwordHash = await this.hashPassword(temporaryPassword);

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

      if (hallId) {
        // Fail-fast hvis hallId ikke eksisterer — fremfor FK-feil lenger ned.
        const { rows: hallRows } = await client.query<{ id: string }>(
          `SELECT id FROM ${this.hallsTable()} WHERE id = $1`,
          [hallId]
        );
        if (!hallRows[0]) {
          throw new DomainError("HALL_NOT_FOUND", "Ukjent hallId.");
        }
      }

      const userId = randomUUID();
      const walletId = `wallet-user-${userId}`;
      const complianceData = { createdBy: "ADMIN" };
      const { rows: createdRows } = await client.query<UserRow>(
        `INSERT INTO ${this.usersTable()}
          (id, email, display_name, surname, password_hash, wallet_id, role, phone, birth_date, hall_id, compliance_data)
         VALUES ($1, $2, $3, $4, $5, $6, 'PLAYER', $7, $8::date, $9, $10::jsonb)
         RETURNING id, email, display_name, surname, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, phone`,
        [userId, email, displayName, surname, passwordHash, walletId, phone, birthDate, hallId, JSON.stringify(complianceData)]
      );
      await client.query("COMMIT");
      await this.walletAdapter.ensureAccount(walletId);
      return {
        user: this.mapUser(createdRows[0]!),
        temporaryPassword,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-583 B3.1: admin-side password-reset for AGENT (and future roles).
   * Skiller seg fra brukerens egen change-password — ingen verifikasjon
   * av gammelt passord, kun admin-RBAC-sjekk hos kaller.
   */
  async setUserPassword(userId: string, newPassword: string): Promise<void> {
    await this.ensureInitialized();
    this.assertPassword(newPassword);
    const passwordHash = await this.hashPassword(newPassword);
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.usersTable()}
       SET password_hash = $2, updated_at = now()
       WHERE id = $1`,
      [userId, passwordHash]
    );
    if (rowCount === 0) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
  }

  /**
   * BIN-583 B3.2: sjekk at en spiller har ACTIVE-registrering i angitt hall.
   *
   * Kjernepremiss for agent-cash-ops: agenten kan kun transakte for
   * spillere som er godkjent i hallen. Matcher legacy `approvedHalls: {
   * $elemMatch: { id: hallId } }`-regelen.
   */
  async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "${this.schema}"."app_hall_registrations"
         WHERE user_id = $1 AND hall_id = $2 AND status = 'ACTIVE'
       ) AS exists`,
      [userId, hallId]
    );
    return Boolean(rows[0]?.exists);
  }

  /**
   * BIN-583 B3.2: paginert player-søk for agent-kassa.
   *
   * Matcher legacy checkForValidAgentPlayer — søker på customerNumber
   * (som parses som tall hvis mulig), display_name, phone. Begrenset
   * til spillere som er ACTIVE i angitt hall.
   */
  async searchPlayersInHall(input: {
    query: string;
    hallId: string;
    limit?: number;
  }): Promise<AppUser[]> {
    await this.ensureInitialized();
    const query = input.query.trim();
    if (!query) {
      throw new DomainError("INVALID_INPUT", "query er påkrevd.");
    }
    if (query.length < 2) {
      throw new DomainError("INVALID_INPUT", "query må være minst 2 tegn.");
    }
    const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `${escaped}%`; // Prefix-match (matcher legacy "starts with")
    const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 50) : 20;
    const { rows } = await this.pool.query<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.surname, u.phone, u.wallet_id, u.role,
              u.kyc_status, u.birth_date, u.kyc_verified_at, u.kyc_provider_ref,
              u.hall_id, u.created_at, u.updated_at, u.compliance_data
       FROM ${this.usersTable()} u
       JOIN "${this.schema}"."app_hall_registrations" r ON r.user_id = u.id
       WHERE u.role = 'PLAYER'
         AND u.deleted_at IS NULL
         AND r.hall_id = $2
         AND r.status = 'ACTIVE'
         AND (u.display_name ILIKE $1 ESCAPE '\\'
           OR u.email ILIKE $1 ESCAPE '\\'
           OR u.phone ILIKE $1 ESCAPE '\\')
       ORDER BY u.display_name ASC
       LIMIT $3`,
      [pattern, input.hallId, limit]
    );
    return rows.map((r) => this.mapUser(r));
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
      `SELECT id, slug, name, region, address,
              organization_number, settlement_account, invoice_method,
              is_active, tv_url, hall_number, cash_balance, tv_token,
              tv_voice_selection, created_at, updated_at
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

  /**
   * TV Screen: valider (hallId, tvToken) fra public URL. Throws
   * TV_TOKEN_INVALID ved mismatch — caller (route-handler) mapper dette
   * til 404 slik at angripere ikke kan probe gyldige hall-IDer.
   */
  async verifyHallTvToken(hallReference: string, tvToken: string): Promise<HallDefinition> {
    const normalizedToken = (tvToken ?? "").trim();
    if (!normalizedToken) {
      throw new DomainError("TV_TOKEN_INVALID", "TV-token ugyldig.");
    }
    let hall: HallDefinition;
    try {
      hall = await this.getHall(hallReference);
    } catch {
      // Uniform 404 ved både ukjent hall og gal token — ingen hall-enumeration.
      throw new DomainError("TV_TOKEN_INVALID", "TV-token ugyldig.");
    }
    // Constant-time-ish compare: length-mismatch shortcut + Buffer-compare.
    // tvToken er optional i typen for bakoverkompatibilitet, men alltid satt fra DB.
    if (!hall.tvToken) {
      throw new DomainError("TV_TOKEN_INVALID", "TV-token ugyldig.");
    }
    const expected = Buffer.from(hall.tvToken);
    const got = Buffer.from(normalizedToken);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      throw new DomainError("TV_TOKEN_INVALID", "TV-token ugyldig.");
    }
    if (!hall.isActive) {
      throw new DomainError("TV_TOKEN_INVALID", "TV-token ugyldig.");
    }
    return hall;
  }

  // ── Hall client-variant ─────────────────────────────────────────────────
  // Returnerer alltid "web" — det finnes bare én klient-stack. Metoden
  // beholdes som shape-compat for admin-web og
  // `/api/halls/:slug/client-variant`-endepunktet.
  async getHallClientVariant(_hallReference: string): Promise<HallClientVariant> {
    return "web";
  }

  // ── TV-kiosk voice-pack ─────────────────────────────────────────────────
  //
  // Wireframe PDF 14 (TV Screen + Winners): hver hall velger hvilken av 3
  // voice-packs som brukes ved ball-utrop på TV-skjermen. Default `voice1`.
  // Audio-filer lastes av TV-klienten fra `/assets/tv-voices/<voice>/<ball>.mp3`.
  //
  // Vi slår ikke audit-log her (det skjer i route-laget) slik at service-
  // lagene kan komposeres uten å slepe AuditLogService rundt.

  async getTvVoice(hallReference: string): Promise<HallTvVoice> {
    const hall = await this.getHall(hallReference);
    return this.normalizeTvVoice(hall.tvVoiceSelection);
  }

  /**
   * Oppdater voice-pack for en hall. Validerer at voice er én av
   * ('voice1', 'voice2', 'voice3'); kaster INVALID_INPUT ellers.
   * Returnerer den oppdaterte HallDefinition så routen kan returnere
   * full entity (ikke bare voice-feltet) for enklere caching i admin-UI.
   */
  async setTvVoice(hallReference: string, voice: string): Promise<HallDefinition> {
    await this.ensureInitialized();
    if (voice !== "voice1" && voice !== "voice2" && voice !== "voice3") {
      throw new DomainError("INVALID_INPUT", "voice må være en av: voice1, voice2, voice3.");
    }
    const hallRow = await this.resolveHallRowByReference(hallReference);
    if (!hallRow) {
      throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
    }
    const { rows } = await this.pool.query<HallRow>(
      `UPDATE ${this.hallsTable()}
       SET tv_voice_selection = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING id, slug, name, region, address,
                 organization_number, settlement_account, invoice_method,
                 is_active, tv_url, hall_number, cash_balance, tv_token,
                 tv_voice_selection, created_at, updated_at`,
      [hallRow.id, voice]
    );
    if (!rows[0]) {
      throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
    }
    return this.mapHall(rows[0]);
  }

  /** Test-only: no-op retained for backwards source-compat (cache is gone). */
  clearClientVariantCache(): void {
    // Intentionally empty — BIN-540 read-through-cachen er fjernet; metoden
    // beholdes så tester som fortsatt kaller den ikke feiler.
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
    const hallNumber = this.normalizeHallNumber(input.hallNumber);
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
      if (hallNumber !== null) {
        const { rows: numberConflict } = await client.query<{ id: string }>(
          `SELECT id FROM ${this.hallsTable()} WHERE hall_number = $1`,
          [hallNumber]
        );
        if (numberConflict[0]) {
          throw new DomainError("HALL_NUMBER_EXISTS", "Hall-nummer er allerede i bruk.");
        }
      }

      const { rows } = await client.query<HallRow>(
        `INSERT INTO ${this.hallsTable()} (id, slug, name, region, address, organization_number, settlement_account, invoice_method, is_active, hall_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, slug, name, region, address,
                   organization_number, settlement_account, invoice_method,
                   is_active, tv_url, hall_number, cash_balance, tv_token,
                   tv_voice_selection, created_at, updated_at`,
        [hallId, slug, name, region, address, organizationNumber, settlementAccount, invoiceMethod, isActive, hallNumber]
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
    const nextHallNumber = update.hallNumber !== undefined
      ? this.normalizeHallNumber(update.hallNumber)
      : (current.hallNumber ?? null);

    if (nextSlug !== current.slug) {
      const { rows: conflictRows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM ${this.hallsTable()} WHERE slug = $1 AND id <> $2`,
        [nextSlug, current.id]
      );
      if (conflictRows[0]) {
        throw new DomainError("HALL_SLUG_EXISTS", "Hall med samme slug finnes allerede.");
      }
    }

    if (nextHallNumber !== null && nextHallNumber !== (current.hallNumber ?? null)) {
      const { rows: numberConflict } = await this.pool.query<{ id: string }>(
        `SELECT id FROM ${this.hallsTable()} WHERE hall_number = $1 AND id <> $2`,
        [nextHallNumber, current.id]
      );
      if (numberConflict[0]) {
        throw new DomainError("HALL_NUMBER_EXISTS", "Hall-nummer er allerede i bruk.");
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
           hall_number = $10,
           updated_at = now()
       WHERE id = $1
       RETURNING id, slug, name, region, address,
                 organization_number, settlement_account, invoice_method,
                 is_active, tv_url, hall_number, cash_balance, tv_token,
                 tv_voice_selection, created_at, updated_at`,
      [current.id, nextSlug, nextName, nextRegion, nextAddress, nextOrgNumber, nextSettlementAccount, nextInvoiceMethod, nextIsActive, nextHallNumber]
    );

    return this.mapHall(rows[0]);
  }

  /**
   * Legacy Hall Number-felt: heltall > 0 eller null (ikke satt).
   * Tom-streng / undefined / null → null. Ugyldige verdier gir DomainError.
   */
  private normalizeHallNumber(raw: number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new DomainError("INVALID_INPUT", "Hall-nummer må være et positivt heltall.");
    }
    const integer = Math.trunc(raw);
    if (integer !== raw || integer <= 0) {
      throw new DomainError("INVALID_INPUT", "Hall-nummer må være et positivt heltall.");
    }
    return integer;
  }

  // ── BIN-503: TV-display tokens ──────────────────────────────────────────
  //
  // Tokens are per-hall secrets used by the public TV-kiosk page
  // (`/web/tv/?hall=<slug>&token=<plaintext>`). Storage is hash-only so a
  // leaked DB dump can't be replayed. The socket handler
  // (`admin-display:login`) calls `verifyHallDisplayToken` on every
  // connect.

  async listHallDisplayTokens(hallReference: string): Promise<HallDisplayToken[]> {
    await this.ensureInitialized();
    const hall = await this.getHall(hallReference);
    const { rows } = await this.pool.query<HallDisplayTokenRow>(
      `SELECT id, hall_id, label, token_hash, created_by, created_at, revoked_at, last_used_at
       FROM ${this.hallDisplayTokensTable()}
       WHERE hall_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [hall.id]
    );
    return rows.map((r) => this.mapHallDisplayToken(r));
  }

  async createHallDisplayToken(
    hallReference: string,
    options?: { label?: string; createdByUserId?: string }
  ): Promise<HallDisplayTokenWithPlaintext> {
    await this.ensureInitialized();
    const hall = await this.getHall(hallReference);
    const label = (options?.label ?? "").trim().slice(0, 80);
    const plaintext = randomBytes(24).toString("base64url");
    const tokenHash = hashToken(plaintext);
    const id = randomUUID();
    const { rows } = await this.pool.query<HallDisplayTokenRow>(
      `INSERT INTO ${this.hallDisplayTokensTable()} (id, hall_id, label, token_hash, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, hall_id, label, token_hash, created_by, created_at, revoked_at, last_used_at`,
      [id, hall.id, label, tokenHash, options?.createdByUserId ?? null]
    );
    const base = this.mapHallDisplayToken(rows[0]);
    return {
      ...base,
      plaintextToken: plaintext,
      compositeToken: `${hall.slug}:${plaintext}`,
    };
  }

  async revokeHallDisplayToken(tokenId: string, hallReference?: string): Promise<void> {
    await this.ensureInitialized();
    if (hallReference) {
      // Scope the revoke to the caller's hall so a sloppy UI can't nuke
      // another hall's token by ID.
      const hall = await this.getHall(hallReference);
      const { rowCount } = await this.pool.query(
        `UPDATE ${this.hallDisplayTokensTable()}
         SET revoked_at = now()
         WHERE id = $1 AND hall_id = $2 AND revoked_at IS NULL`,
        [tokenId, hall.id]
      );
      if (!rowCount) {
        throw new DomainError("DISPLAY_TOKEN_NOT_FOUND", "Display-token finnes ikke for denne hallen.");
      }
      return;
    }
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.hallDisplayTokensTable()}
       SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [tokenId]
    );
    if (!rowCount) {
      throw new DomainError("DISPLAY_TOKEN_NOT_FOUND", "Display-token finnes ikke.");
    }
  }

  /**
   * Socket-handler path: given the composite "<hallSlug>:<plaintext>" that
   * the TV-kiosk sent in `admin-display:login`, resolve to a hallId if the
   * token is active. Bumps `last_used_at` (best-effort, non-blocking).
   *
   * Throws DomainError on any mismatch so the socket handler can ack
   * failure uniformly.
   */
  async verifyHallDisplayToken(compositeToken: string): Promise<{ hallId: string; tokenId: string }> {
    await this.ensureInitialized();
    const colon = compositeToken.indexOf(":");
    if (colon <= 0) {
      throw new DomainError("DISPLAY_TOKEN_FORMAT", "Token-format ugyldig.");
    }
    const hallSlug = compositeToken.slice(0, colon).trim().toLowerCase();
    const secret = compositeToken.slice(colon + 1).trim();
    if (!hallSlug || !secret) {
      throw new DomainError("DISPLAY_TOKEN_FORMAT", "Token-format ugyldig.");
    }
    const tokenHash = hashToken(secret);
    const { rows } = await this.pool.query<{ id: string; hall_id: string; hall_slug: string }>(
      `SELECT t.id, t.hall_id, h.slug AS hall_slug
       FROM ${this.hallDisplayTokensTable()} t
       JOIN ${this.hallsTable()} h ON h.id = t.hall_id
       WHERE t.token_hash = $1
         AND t.revoked_at IS NULL
         AND h.is_active = true
       LIMIT 1`,
      [tokenHash]
    );
    const hit = rows[0];
    if (!hit) {
      throw new DomainError("DISPLAY_TOKEN_INVALID", "Ugyldig display-token.");
    }
    // The slug in the composite must match the hall the hash belongs to.
    // This stops a token from one hall being replayed against another
    // hall's TV-page.
    if (hit.hall_slug.toLowerCase() !== hallSlug) {
      throw new DomainError("DISPLAY_TOKEN_HALL_MISMATCH", "Token hører ikke til oppgitt hall.");
    }
    // Fire-and-forget last_used_at bump. Failures here are diagnostic-only.
    this.pool
      .query(
        `UPDATE ${this.hallDisplayTokensTable()} SET last_used_at = now() WHERE id = $1`,
        [hit.id]
      )
      .catch((err) => console.warn("[BIN-503] last_used_at bump failed", err));
    return { hallId: hit.hall_id, tokenId: hit.id };
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

  /**
   * BIN-615 / PR-C1: Create N child sub-game rows under an existing parent
   * schedule (Game 2 / Game 3). Matches legacy eager-creation semantics
   * (Common/Controllers/GameController.js:334-521 — all children are written
   * up front when the parent is created).
   *
   * Steps:
   *   1. SubGameManager.planChildren builds specs (sequence, subGameNumber, sorted patterns).
   *   2. One transactional INSERT per child row, sharing parent's hallId/startTime defaults.
   *   3. Returns the planned specs (callers can fetch rows separately via listSubGameChildren).
   *
   * Throws:
   *   - SCHEDULE_SLOT_NOT_FOUND if parentScheduleId is unknown
   *   - INVALID_GAME_TYPE if parent.gameType is not game_2 or game_3
   */
  async createSubGameChildren(
    parentScheduleId: string,
    subGames: SubGameInput[]
  ): Promise<PlannedChildGame[]> {
    await this.ensureInitialized();
    if (!subGames || subGames.length === 0) {
      throw new DomainError("INVALID_SUB_GAMES", "subGames må være ikke-tom.");
    }
    const { rows: parentRows } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, variant_config,
              parent_schedule_id, sub_game_sequence, sub_game_number,
              created_at, updated_at
       FROM ${this.scheduleTable()} WHERE id = $1`,
      [parentScheduleId]
    );
    if (!parentRows[0]) {
      throw new DomainError("SCHEDULE_SLOT_NOT_FOUND", "Parent-spilleplansslot finnes ikke.");
    }
    const parent = this.mapScheduleSlot(parentRows[0]);
    if (parent.gameType !== "game_2" && parent.gameType !== "game_3") {
      throw new DomainError(
        "INVALID_GAME_TYPE",
        `Sub-games støttes kun for game_2 og game_3 (fikk ${parent.gameType}).`
      );
    }
    if (parent.parentScheduleId) {
      throw new DomainError(
        "INVALID_PARENT",
        "Kan ikke opprette sub-games under en sub-game (nestede parents er ikke tillatt)."
      );
    }

    const planner = new SubGameManager();
    const plan = planner.planChildren({
      parentScheduleId: parent.id,
      gameType: parent.gameType as "game_2" | "game_3",
      subGames
    });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const child of plan) {
        await client.query(
          `INSERT INTO ${this.scheduleTable()}
            (id, hall_id, game_type, display_name, day_of_week, start_time,
             prize_description, max_tickets, is_active, sort_order,
             variant_config, parent_schedule_id, sub_game_sequence, sub_game_number)
           VALUES ($1,$2,$3,$4,$5,$6::time,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
          [
            randomUUID(),
            parent.hallId,
            parent.gameType,
            child.displayName,
            parent.dayOfWeek,
            parent.startTime,
            parent.prizeDescription,
            parent.maxTickets,
            parent.isActive,
            parent.sortOrder + child.sequence, // keep children ordered after parent
            JSON.stringify(child.variantConfig),
            parent.id,
            child.sequence,
            child.subGameNumber
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return plan;
  }

  /**
   * BIN-615 / PR-C1: List all child sub-games for a parent schedule,
   * ordered by sub_game_sequence ascending.
   */
  async listSubGameChildren(parentScheduleId: string): Promise<ScheduleSlot[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, variant_config,
              parent_schedule_id, sub_game_sequence, sub_game_number,
              created_at, updated_at
       FROM ${this.scheduleTable()}
       WHERE parent_schedule_id = $1
       ORDER BY sub_game_sequence ASC`,
      [parentScheduleId]
    );
    return rows.map((r) => this.mapScheduleSlot(r));
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

  /**
   * BIN-647: List schedule-log rows for a given set of schedule-slot ids in
   * an inclusive ISO window. Used by the subgame-drill-down report to map
   * sub-game schedule rows → game_session ids for ledger aggregation.
   *
   * Returns at most 5_000 rows — a hard ceiling that covers several months of
   * even the busiest hall; the drill-down is per-parent so this is plenty.
   */
  async listScheduleLogForSlots(input: {
    scheduleSlotIds: string[];
    from?: string;
    to?: string;
  }): Promise<ScheduleLogEntry[]> {
    await this.ensureInitialized();
    if (!input.scheduleSlotIds.length) return [];
    const params: unknown[] = [input.scheduleSlotIds];
    const conditions: string[] = ["schedule_slot_id = ANY($1::text[])"];
    if (input.from) {
      params.push(input.from);
      conditions.push(`started_at >= $${params.length}`);
    }
    if (input.to) {
      params.push(input.to);
      conditions.push(`started_at <= $${params.length}`);
    }
    const { rows } = await this.pool.query<ScheduleLogRow>(
      `SELECT * FROM ${this.scheduleLogTable()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT 5000`,
      params
    );
    return rows.map((r) => this.mapScheduleLog(r));
  }

  /**
   * BIN-BOT-01: List every sub-game child row (parent_schedule_id NOT NULL)
   * across all parents, optionally filtered by hall. Used by the
   * "Report Management Game 1" aggregate to find every candidate sub-game
   * in the requested window — the route itself filters by schedule-log
   * started_at, so this returns a superset.
   *
   * Hard cap at 10_000 rows — the admin UI paginates to 10 per page, and
   * even a busy pilot hall has <500 sub-games configured per month. The
   * cap prevents pathological growth from hanging the aggregator.
   */
  async listAllSubGameChildren(options?: { hallId?: string }): Promise<ScheduleSlot[]> {
    await this.ensureInitialized();
    const conditions: string[] = ["parent_schedule_id IS NOT NULL"];
    const params: unknown[] = [];
    if (options?.hallId) {
      params.push(options.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, variant_config,
              parent_schedule_id, sub_game_sequence, sub_game_number,
              created_at, updated_at
       FROM ${this.scheduleTable()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY hall_id ASC, sub_game_sequence ASC, id ASC
       LIMIT 10000`,
      params
    );
    return rows.map((r) => this.mapScheduleSlot(r));
  }

  /**
   * BIN-17.36 Hall Specific Report: list ALLE schedule-slots (parent + child)
   * på tvers av haller. Brukes av hall-specific-rapporten for å kategorisere
   * ledger-entries per game-slot (Game 1-5). Max 20_000 rader — systemet har
   * typisk <10_000 aktive + inaktive slots.
   */
  async listAllScheduleSlots(options?: { hallIds?: string[] }): Promise<ScheduleSlot[]> {
    await this.ensureInitialized();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (options?.hallIds && options.hallIds.length > 0) {
      params.push(options.hallIds);
      conditions.push(`hall_id = ANY($${params.length}::text[])`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, variant_config,
              parent_schedule_id, sub_game_sequence, sub_game_number,
              created_at, updated_at
       FROM ${this.scheduleTable()}
       ${where}
       ORDER BY hall_id ASC, sort_order ASC, id ASC
       LIMIT 20000`,
      params
    );
    return rows.map((r) => this.mapScheduleSlot(r));
  }

  /**
   * BIN-BOT-01: Query schedule-log rows by date-window + optional hall.
   * Complements listScheduleLogForSlots (which takes a slot-id list) —
   * this one is used by the Game1 management report where we don't know
   * the slot-ids up-front.
   */
  async listScheduleLogInRange(input: {
    from: string;
    to: string;
    hallId?: string;
  }): Promise<ScheduleLogEntry[]> {
    await this.ensureInitialized();
    const conditions: string[] = ["started_at >= $1", "started_at <= $2"];
    const params: unknown[] = [input.from, input.to];
    if (input.hallId) {
      params.push(input.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    const { rows } = await this.pool.query<ScheduleLogRow>(
      `SELECT * FROM ${this.scheduleLogTable()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT 10000`,
      params
    );
    return rows.map((r) => this.mapScheduleLog(r));
  }

  /**
   * BIN-647: Fetch a single schedule-slot by id (parent or child). Returns
   * null if the row doesn't exist. Lean accessor used by the drill-down
   * route to resolve `parentId` → hallId for hall-scope enforcement.
   */
  async getScheduleSlotById(id: string): Promise<ScheduleSlot | null> {
    await this.ensureInitialized();
    if (!id.trim()) return null;
    const { rows } = await this.pool.query<ScheduleSlotRow>(
      `SELECT id, hall_id, game_type, display_name, day_of_week, start_time::text,
              prize_description, max_tickets, is_active, sort_order, variant_config,
              parent_schedule_id, sub_game_sequence, sub_game_number,
              created_at, updated_at
       FROM ${this.scheduleTable()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) return null;
    return this.mapScheduleSlot(row);
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

  /**
   * BIN-591: used by route handlers to enforce hall-scope on a terminal
   * before mutating it.
   */
  async getTerminal(terminalIdInput: string): Promise<TerminalDefinition> {
    await this.ensureInitialized();
    const terminalId = this.assertEntityReference(terminalIdInput, "terminalId");
    const { rows } = await this.pool.query<TerminalRow>(
      `SELECT id, hall_id, terminal_code, display_name, is_active, last_seen_at, created_at, updated_at
       FROM ${this.terminalsTable()}
       WHERE id = $1`,
      [terminalId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("TERMINAL_NOT_FOUND", "Terminalen finnes ikke.");
    }
    return this.mapTerminal(row);
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
      `SELECT id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data
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
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at`,
      values
    );
    if (!rows[0]) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.withBalance(this.mapUser(rows[0]));
  }

  /**
   * GAP #5: persist en profil/BankID-image-URL til riktig kolonne.
   *
   * `category`-mapping:
   *   - `profile` → app_users.profile_image_url
   *   - `bankid_selfie` → app_users.bankid_selfie_url
   *   - `bankid_document` → app_users.bankid_document_url
   *
   * `imageUrl = null` rydder kolonnen (brukes når spilleren fjerner
   * profilbildet sitt). Service-laget validerer URL-formatet før kall —
   * her gjør vi kun en idempotent UPDATE og returnerer den nye user-raden.
   */
  async updateProfileImage(input: {
    userId: string;
    category: "profile" | "bankid_selfie" | "bankid_document";
    imageUrl: string | null;
  }): Promise<PublicAppUser> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(input.userId, "userId");
    const columnByCategory: Record<typeof input.category, string> = {
      profile: "profile_image_url",
      bankid_selfie: "bankid_selfie_url",
      bankid_document: "bankid_document_url",
    };
    const column = columnByCategory[input.category];
    if (!column) {
      throw new DomainError(
        "INVALID_INPUT",
        "category må være profile, bankid_selfie eller bankid_document."
      );
    }
    const url =
      typeof input.imageUrl === "string" ? input.imageUrl.trim() : null;
    if (url !== null && url.length === 0) {
      throw new DomainError("INVALID_INPUT", "imageUrl mangler.");
    }
    if (url !== null && url.length > 2048) {
      throw new DomainError("INVALID_INPUT", "imageUrl er for lang (maks 2048 tegn).");
    }
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET ${column} = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at,
                 profile_image_url, bankid_selfie_url, bankid_document_url`,
      [url, id]
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

  /**
   * BIN-587 B2.1: sett nytt passord uten å kreve currentPassword. Brukes
   * av reset-password-flow etter at AuthTokenService har validert tokenet.
   * Revoker alle aktive sesjoner som side-effekt så tyveri via gammel
   * cookie ikke overlever passord-bytte.
   */
  async setPassword(userIdInput: string, newPassword: string): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userIdInput, "userId");
    this.assertPassword(newPassword);
    const newHash = await this.hashPassword(newPassword);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE ${this.usersTable()}
         SET password_hash = $2, updated_at = now()
         WHERE id = $1`,
        [id, newHash]
      );
      if (!rowCount) {
        throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
      }
      await client.query(
        `UPDATE ${this.sessionsTable()}
         SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw this.wrapError(err);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-587 B2.1: marker brukerens e-post som verifisert. Ingen egen
   * kolonne finnes — bruker compliance_data.email_verified_at som flagg.
   */
  async markEmailVerified(userIdInput: string): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userIdInput, "userId");
    await this.pool.query(
      `UPDATE ${this.usersTable()}
       SET compliance_data = COALESCE(compliance_data, '{}'::jsonb)
         || jsonb_build_object('emailVerifiedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         updated_at = now()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * BIN-587 B2.2: list spillere filtrert på KYC-status. Brukes av
   * KYC-moderasjons-kø. Kun PLAYER-rollen returneres — admin/support/
   * hall-operator er aldri i moderasjons-kø.
   */
  async listUsersByKycStatus(
    status: KycStatus,
    options?: { limit?: number }
  ): Promise<AppUser[]> {
    await this.ensureInitialized();
    const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 500) : 100;
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data
       FROM ${this.usersTable()}
       WHERE kyc_status = $1 AND role = 'PLAYER'
       ORDER BY created_at ASC
       LIMIT $2`,
      [status, limit]
    );
    return rows.map((r) => this.mapUser(r));
  }

  /**
   * BIN-587 B6: list admin-brukere (ADMIN | SUPPORT | HALL_OPERATOR).
   * PLAYER ekskluderes — spillere håndteres via listUsersByKycStatus
   * og player-search-endepunktene.
   */
  async listAdminUsers(options?: {
    role?: UserRole;
    includeDeleted?: boolean;
    limit?: number;
  }): Promise<AppUser[]> {
    await this.ensureInitialized();
    const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 500) : 100;
    const conditions: string[] = ["role IN ('ADMIN', 'SUPPORT', 'HALL_OPERATOR')"];
    const params: unknown[] = [];
    if (options?.role) {
      if (options.role === "PLAYER") {
        throw new DomainError("INVALID_INPUT", "PLAYER er ikke en admin-rolle.");
      }
      params.push(options.role);
      conditions.push(`role = $${params.length}`);
    }
    if (!options?.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    params.push(limit);
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data
       FROM ${this.usersTable()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapUser(r));
  }

  /**
   * BIN-587 B6: opprett admin-bruker (ADMIN/SUPPORT/HALL_OPERATOR).
   * Setter KYC VERIFIED automatisk (admin-brukere trenger ikke KYC-flow
   * som spillere). Auto-genererer wallet for konsistens med
   * app_users-skjema, men wallet vil ikke brukes.
   */
  async createAdminUser(input: {
    email: string;
    password: string;
    displayName: string;
    surname: string;
    role: UserRole;
    phone?: string;
    hallId?: string | null;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    if (input.role === "PLAYER") {
      throw new DomainError("INVALID_INPUT", "Bruk /api/auth/register for spiller-opprettelse.");
    }
    const role = this.assertUserRole(input.role);
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    const surname = input.surname.trim();
    this.assertEmail(email);
    this.assertDisplayName(displayName);
    this.assertSurname(surname);
    this.assertPassword(input.password);
    const phone = input.phone?.trim() || null;
    const hallId = input.hallId?.trim() || null;
    if (role === "HALL_OPERATOR" && hallId !== null) {
      const { rows: hallRows } = await this.pool.query(
        `SELECT id FROM ${this.hallsTable()} WHERE id = $1`,
        [hallId]
      );
      if (!hallRows[0]) throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
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
      const userId = randomUUID();
      const walletId = `wallet-admin-${userId}`;
      const { rows } = await client.query<UserRow>(
        `INSERT INTO ${this.usersTable()}
          (id, email, display_name, surname, password_hash, wallet_id, role, phone, hall_id, kyc_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VERIFIED')
         RETURNING id, email, display_name, surname, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, phone`,
        [userId, email, displayName, surname, passwordHash, walletId, role, phone, hallId]
      );
      await client.query("COMMIT");
      return this.mapUser(rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK");
      throw this.wrapError(err);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-587 B6: soft-delete admin-bruker. Setter deleted_at + revoker
   * sesjoner. Samme guard som softDeletePlayer: siste ADMIN kan ikke
   * slettes. Ulikt softDeletePlayer fordi vi ikke aksepterer PLAYER her.
   */
  async softDeleteAdminUser(userIdInput: string): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userIdInput, "userId");
    const user = await this.getUserById(id);
    if (user.role === "PLAYER") {
      throw new DomainError(
        "INVALID_INPUT",
        "Bruk /api/admin/players/:id/soft-delete for spiller-sletting."
      );
    }
    if (user.role === "ADMIN") {
      const { rows } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.usersTable()}
         WHERE role = 'ADMIN' AND deleted_at IS NULL`
      );
      if (Number(rows[0]?.count ?? "0") <= 1) {
        throw new DomainError("LAST_ADMIN_REQUIRED", "Kan ikke soft-delete siste aktive admin.");
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE ${this.usersTable()}
         SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!rowCount) {
        throw new DomainError("USER_ALREADY_DELETED", "Brukeren er allerede soft-deleted.");
      }
      await client.query(
        `UPDATE ${this.sessionsTable()}
         SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw this.wrapError(err);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-587 B2.2: admin approve av KYC. Setter VERIFIED og stempler
   * providerRef = "admin-override:<actorId>" så historikken er synlig.
   */
  async approveKycAsAdmin(input: {
    userId: string;
    actorId: string;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const actorId = this.assertEntityReference(input.actorId, "actorId");
    const current = await this.getUserById(userId);
    if (!current.birthDate) {
      throw new DomainError(
        "KYC_BIRTHDATE_MISSING",
        "Spiller har ikke oppgitt fødselsdato — KYC kan ikke godkjennes uten denne."
      );
    }
    return this.updateKycStatus({
      userId: current.id,
      status: "VERIFIED",
      birthDate: current.birthDate,
      providerRef: `admin-override:${actorId}`,
      verifiedAt: new Date().toISOString(),
    });
  }

  /**
   * BIN-587 B2.2: admin reject av KYC. `reason` lagres i compliance_data.
   */
  async rejectKycAsAdmin(input: {
    userId: string;
    actorId: string;
    reason: string;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const actorId = this.assertEntityReference(input.actorId, "actorId");
    const reason = input.reason.trim();
    if (!reason) {
      throw new DomainError("INVALID_INPUT", "reason er påkrevd ved avvisning.");
    }
    if (reason.length > 500) {
      throw new DomainError("INVALID_INPUT", "reason er for lang (maks 500 tegn).");
    }
    const current = await this.getUserById(userId);
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET kyc_status = 'REJECTED',
           kyc_provider_ref = $2,
           kyc_verified_at = now(),
           compliance_data = COALESCE(compliance_data, '{}'::jsonb)
             || jsonb_build_object(
                  'kycRejectionReason', $3::text,
                  'kycRejectedBy', $4::text,
                  'kycRejectedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                ),
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data`,
      [current.id, `admin-override:${actorId}`, reason, actorId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.mapUser(row);
  }

  /**
   * BIN-587 B2.2: resubmit — åpner KYC på nytt. Setter UNVERIFIED og
   * nullstiller provider-ref + verifiedAt. compliance_data får et
   * `kycResubmitLog`-entry (liste over resubmits for auditspor).
   */
  async resubmitKycAsAdmin(input: {
    userId: string;
    actorId: string;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const actorId = this.assertEntityReference(input.actorId, "actorId");
    const current = await this.getUserById(userId);
    if (current.kycStatus !== "REJECTED") {
      throw new DomainError(
        "KYC_NOT_REJECTED",
        "Resubmit er kun tillatt for spillere med kyc_status = REJECTED."
      );
    }
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET kyc_status = 'UNVERIFIED',
           kyc_provider_ref = NULL,
           kyc_verified_at = NULL,
           compliance_data = COALESCE(compliance_data, '{}'::jsonb)
             || jsonb_build_object(
                  'kycResubmittedBy', $2::text,
                  'kycResubmittedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                ),
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data`,
      [current.id, actorId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.mapUser(row);
  }

  /**
   * BIN-587 B2.2: admin kan overstyre kyc_status manuelt (PLAYER_KYC_OVERRIDE
   * — ADMIN only). Bruker samme log-struktur som reject. Status må være
   * en gyldig KycStatus.
   */
  async overrideKycStatusAsAdmin(input: {
    userId: string;
    actorId: string;
    status: KycStatus;
    reason: string;
  }): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const actorId = this.assertEntityReference(input.actorId, "actorId");
    const reason = input.reason.trim();
    if (!reason) {
      throw new DomainError("INVALID_INPUT", "reason er påkrevd for override.");
    }
    if (!["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"].includes(input.status)) {
      throw new DomainError("INVALID_INPUT", "Ugyldig kyc_status.");
    }
    const current = await this.getUserById(userId);
    const verifiedAtSql =
      input.status === "VERIFIED" ? "now()" : "NULL";
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET kyc_status = $2,
           kyc_provider_ref = $3,
           kyc_verified_at = ${verifiedAtSql},
           compliance_data = COALESCE(compliance_data, '{}'::jsonb)
             || jsonb_build_object(
                  'kycOverrideReason', $4::text,
                  'kycOverriddenBy', $5::text,
                  'kycOverriddenAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'kycOverrideStatus', $2::text
                ),
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data`,
      [current.id, input.status, `admin-override:${actorId}`, reason, actorId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.mapUser(row);
  }

  /**
   * BIN-587 B2.1: slå opp bruker på e-post uten å kaste for unknown.
   * Brukes av forgot-password som må være enumeration-safe.
   */
  async findUserByEmail(email: string): Promise<AppUser | null> {
    await this.ensureInitialized();
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data
       FROM ${this.usersTable()}
       WHERE email = $1`,
      [normalized]
    );
    const row = rows[0];
    return row ? this.mapUser(row) : null;
  }

  /**
   * BIN-587 B2.3: per-hall-status read. Returnerer én rad per hall der
   * spilleren eksplisitt har en status (aktiv eller inaktiv). Haller
   * uten eksplisitt rad er implisitt aktive.
   */
  async listPlayerHallStatus(userIdInput: string): Promise<
    Array<{
      hallId: string;
      isActive: boolean;
      reason: string | null;
      updatedBy: string | null;
      updatedAt: string;
      createdAt: string;
    }>
  > {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(userIdInput, "userId");
    const { rows } = await this.pool.query<{
      hall_id: string;
      is_active: boolean;
      reason: string | null;
      updated_by: string | null;
      updated_at: Date | string;
      created_at: Date | string;
    }>(
      `SELECT hall_id, is_active, reason, updated_by, updated_at, created_at
       FROM "${this.schema}"."app_player_hall_status"
       WHERE user_id = $1
       ORDER BY hall_id ASC`,
      [userId]
    );
    return rows.map((r) => ({
      hallId: r.hall_id,
      isActive: r.is_active,
      reason: r.reason,
      updatedBy: r.updated_by,
      updatedAt: asIso(r.updated_at),
      createdAt: asIso(r.created_at),
    }));
  }

  /**
   * BIN-587 B2.3: set per-hall-status via upsert. Valide at hallen
   * eksisterer før insert.
   */
  async setPlayerHallStatus(input: {
    userId: string;
    hallId: string;
    isActive: boolean;
    reason: string | null;
    actorId: string;
  }): Promise<{
    hallId: string;
    isActive: boolean;
    reason: string | null;
    updatedBy: string | null;
    updatedAt: string;
  }> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const hallId = this.assertEntityReference(input.hallId, "hallId");
    const actorId = this.assertEntityReference(input.actorId, "actorId");
    const reason = input.reason?.trim() || null;
    if (reason && reason.length > 500) {
      throw new DomainError("INVALID_INPUT", "reason er for lang (maks 500 tegn).");
    }
    // Verifiser at spilleren finnes (og ikke er soft-deleted).
    const user = await this.getUserById(userId);
    if ((user as unknown as { deletedAt?: string | null }).deletedAt) {
      // mapUser returnerer ikke deletedAt i dag — sjekker via raw query:
    }
    const { rows: hallRows } = await this.pool.query(
      `SELECT id FROM ${this.hallsTable()} WHERE id = $1`,
      [hallId]
    );
    if (!hallRows[0]) {
      throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
    }
    const { rows } = await this.pool.query<{
      hall_id: string;
      is_active: boolean;
      reason: string | null;
      updated_by: string | null;
      updated_at: Date | string;
    }>(
      `INSERT INTO "${this.schema}"."app_player_hall_status"
         (user_id, hall_id, is_active, reason, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, hall_id) DO UPDATE
         SET is_active = EXCLUDED.is_active,
             reason = EXCLUDED.reason,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING hall_id, is_active, reason, updated_by, updated_at`,
      [user.id, hallId, input.isActive, reason, actorId]
    );
    const row = rows[0]!;
    return {
      hallId: row.hall_id,
      isActive: row.is_active,
      reason: row.reason,
      updatedBy: row.updated_by,
      updatedAt: asIso(row.updated_at),
    };
  }

  /**
   * BIN-587 B2.3: soft-delete. Ikke anonymiser — bare merk `deleted_at`.
   * Revoker alle aktive sesjoner som side-effekt. Avviser siste admin.
   */
  async softDeletePlayer(userIdInput: string): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userIdInput, "userId");
    const user = await this.getUserById(id);
    if (user.role === "ADMIN") {
      const { rows } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.usersTable()} WHERE role = 'ADMIN' AND deleted_at IS NULL`
      );
      if (Number(rows[0]?.count ?? "0") <= 1) {
        throw new DomainError("LAST_ADMIN_REQUIRED", "Kan ikke soft-delete siste aktive admin.");
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE ${this.usersTable()}
         SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!rowCount) {
        throw new DomainError("USER_ALREADY_DELETED", "Brukeren er allerede soft-deleted.");
      }
      await client.query(
        `UPDATE ${this.sessionsTable()}
         SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw this.wrapError(err);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-587 B2.3: restore — fjern `deleted_at`. Sesjoner må opprettes på
   * nytt (spiller må logge inn igjen), vi gjenoppretter ikke revoked
   * sessions.
   */
  async restorePlayer(userIdInput: string): Promise<void> {
    await this.ensureInitialized();
    const id = this.assertEntityReference(userIdInput, "userId");
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.usersTable()}
       SET deleted_at = NULL, updated_at = now()
       WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id]
    );
    if (!rowCount) {
      throw new DomainError(
        "USER_NOT_SOFT_DELETED",
        "Brukeren er ikke soft-deleted — restore er ikke nødvendig."
      );
    }
  }

  /**
   * BIN-587 B2.3: sett status til UNVERIFIED + revoker sesjoner slik at
   * spilleren tvinges gjennom BankID-flow ved neste innlogging. Admin-
   * rutinen returnerer info om hvorvidt en ny BankID-sesjon kan genereres
   * nå (om bankIdAdapter er konfigurert) — selve `createAuthSession`-
   * kallet gjøres av router-laget som har tilgang til adapteret.
   */
  async resetKycForReverify(input: { userId: string; actorId: string }): Promise<AppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const actorId = this.assertEntityReference(input.actorId, "actorId");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<UserRow>(
        `UPDATE ${this.usersTable()}
         SET kyc_status = 'UNVERIFIED',
             kyc_provider_ref = NULL,
             kyc_verified_at = NULL,
             compliance_data = COALESCE(compliance_data, '{}'::jsonb)
               || jsonb_build_object(
                    'bankidReverifyRequestedBy', $2::text,
                    'bankidReverifyRequestedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                  ),
             updated_at = now()
         WHERE id = $1
         RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data`,
        [userId, actorId]
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
      }
      await client.query(
        `UPDATE ${this.sessionsTable()}
         SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      );
      await client.query("COMMIT");
      return this.mapUser(row);
    } catch (err) {
      await client.query("ROLLBACK");
      throw this.wrapError(err);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-587 B2.3: bulk-import av spillere fra en allerede-parset CSV-liste.
   * Hver rad valideres per-felt. Importen er best-effort: rader som
   * feiler (ugyldig e-post, duplikat, manglende navn) hoppes over og
   * samles i `errors`. Successfully importerte rader får tilfeldig
   * passord — spiller bruker forgot-password for å sette eget passord
   * før første innlogging.
   *
   * BIN-702 follow-up: returnerer også `importedUsers` (id + email +
   * displayName) slik at kalleren kan generere password-reset-token og
   * sende velkomst-mail per spiller via EmailQueue.
   *
   * Merk: kaller `register`-flyten én rad av gangen — ikke batch-
   * optimalisert, men trygt og enklet auditlogg pr. rad. For pilot-
   * migrasjonsstørrelser (noen hundre spillere) er det akseptabelt.
   */
  async bulkImportPlayers(rows: Array<{
    email?: string;
    displayName?: string;
    surname?: string;
    phone?: string;
    birthDate?: string;
  }>): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; email: string | null; error: string }>;
    importedEmails: string[];
    importedUsers: Array<{ userId: string; email: string; displayName: string; hallId: string | null }>;
  }> {
    await this.ensureInitialized();
    const errors: Array<{ row: number; email: string | null; error: string }> = [];
    const importedEmails: string[] = [];
    const importedUsers: Array<{ userId: string; email: string; displayName: string; hallId: string | null }> = [];
    let imported = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const rowNum = i + 1;
      const raw = rows[i] ?? {};
      const email = typeof raw.email === "string" ? raw.email.trim() : "";
      try {
        if (!email) {
          throw new DomainError("INVALID_INPUT", "email er påkrevd.");
        }
        if (!raw.displayName || typeof raw.displayName !== "string" || !raw.displayName.trim()) {
          throw new DomainError("INVALID_INPUT", "displayName er påkrevd.");
        }
        if (!raw.surname || typeof raw.surname !== "string" || !raw.surname.trim()) {
          throw new DomainError("INVALID_INPUT", "surname er påkrevd.");
        }
        if (!raw.birthDate || typeof raw.birthDate !== "string" || !raw.birthDate.trim()) {
          throw new DomainError("INVALID_INPUT", "birthDate er påkrevd.");
        }
        // Sjekk for eksisterende e-post først så vi returnerer en ryddig
        // duplicate-feil i stedet for en generisk DB-uniqueness-error.
        const existing = await this.findUserByEmail(email);
        if (existing) {
          skipped += 1;
          errors.push({ row: rowNum, email, error: "email-exists" });
          continue;
        }
        const generatedPassword = randomBytes(16).toString("base64url");
        const session = await this.register({
          email,
          password: generatedPassword,
          displayName: raw.displayName.trim(),
          surname: raw.surname.trim(),
          birthDate: raw.birthDate.trim(),
          phone: raw.phone?.trim() || undefined,
        });
        imported += 1;
        importedEmails.push(email);
        importedUsers.push({
          userId: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
          hallId: session.user.hallId ?? null,
        });
      } catch (err) {
        skipped += 1;
        const message = err instanceof DomainError ? err.message : (err instanceof Error ? err.message : "unknown error");
        errors.push({ row: rowNum, email: email || null, error: message });
      }
    }
    return { imported, skipped, errors, importedEmails, importedUsers };
  }

  /**
   * BIN-587 B2.3: list spillere for CSV-eksport / admin-søk.
   * Filter-parametere er alle valgfrie. Begrenser til PLAYER-rollen som
   * default for å holde ADMIN/SUPPORT ut av eksport-dumps.
   */
  async listPlayersForExport(filter: {
    kycStatus?: KycStatus;
    includeDeleted?: boolean;
    hallId?: string;
    limit?: number;
  }): Promise<AppUser[]> {
    await this.ensureInitialized();
    const conditions: string[] = ["u.role = 'PLAYER'"];
    const params: unknown[] = [];
    if (filter.kycStatus) {
      params.push(filter.kycStatus);
      conditions.push(`u.kyc_status = $${params.length}`);
    }
    if (!filter.includeDeleted) {
      conditions.push(`u.deleted_at IS NULL`);
    }
    let join = "";
    if (filter.hallId) {
      params.push(filter.hallId);
      // Include spillere som enten har hall_id direkte (hall-operator-tildelt)
      // ELLER har en aktiv status-rad i den hallen.
      join = `LEFT JOIN "${this.schema}"."app_player_hall_status" hs
              ON hs.user_id = u.id AND hs.hall_id = $${params.length}`;
      conditions.push(`(u.hall_id = $${params.length} OR hs.hall_id = $${params.length})`);
    }
    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 5000) : 500;
    params.push(limit);
    const { rows } = await this.pool.query<UserRow>(
      `SELECT DISTINCT u.id, u.email, u.display_name, u.surname, u.phone, u.wallet_id, u.role, u.kyc_status, u.birth_date, u.kyc_verified_at, u.kyc_provider_ref, u.hall_id, u.created_at, u.updated_at, u.compliance_data
       FROM ${this.usersTable()} u
       ${join}
       WHERE ${conditions.join(" AND ")}
       ORDER BY u.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapUser(r));
  }

  /**
   * BIN-587 B2.3: fritekst-søk. ILIKE mot email/display_name/phone. Kun
   * PLAYER-rollen. Soft-deleted inkluderes som default ikke — admin kan
   * ekplisitt be om det for restore-flyt.
   */
  async searchPlayers(input: {
    query: string;
    limit?: number;
    includeDeleted?: boolean;
  }): Promise<AppUser[]> {
    await this.ensureInitialized();
    const query = input.query.trim();
    if (!query) {
      throw new DomainError("INVALID_INPUT", "query er påkrevd.");
    }
    if (query.length < 2) {
      throw new DomainError("INVALID_INPUT", "query må være minst 2 tegn.");
    }
    // Escape ILIKE wildcards for user input (forhindre at `%` / `_` i
    // input gir rare treff).
    const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;
    const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 200) : 50;
    const deletedFilter = input.includeDeleted ? "" : "AND deleted_at IS NULL";
    const { rows } = await this.pool.query<UserRow>(
      `SELECT id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at, compliance_data
       FROM ${this.usersTable()}
       WHERE role = 'PLAYER'
         AND (email ILIKE $1 ESCAPE '\\'
           OR display_name ILIKE $1 ESCAPE '\\'
           OR surname ILIKE $1 ESCAPE '\\'
           OR phone ILIKE $1 ESCAPE '\\')
         ${deletedFilter}
       ORDER BY created_at DESC
       LIMIT $2`,
      [pattern, limit]
    );
    return rows.map((r) => this.mapUser(r));
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
        `SELECT id, email, display_name, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at
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
         RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at`,
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

  /**
   * BIN-591: tildel (eller fjern) en hall til en bruker. Kun meningsfylt
   * for HALL_OPERATOR; validerer at hallen finnes hvis ikke null.
   */
  async updateUserHallAssignment(
    userIdInput: string,
    hallIdInput: string | null
  ): Promise<PublicAppUser> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(userIdInput, "userId");
    const nextHallId =
      hallIdInput === null || hallIdInput === undefined
        ? null
        : this.assertEntityReference(hallIdInput, "hallId");

    if (nextHallId !== null) {
      const { rows: hallRows } = await this.pool.query(
        `SELECT id FROM ${this.hallsTable()} WHERE id = $1`,
        [nextHallId]
      );
      if (!hallRows[0]) {
        throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
      }
    }

    const { rows } = await this.pool.query<UserRow>(
      `UPDATE ${this.usersTable()}
       SET hall_id = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at`,
      [userId, nextHallId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return this.withBalance(this.mapUser(row));
  }

  /**
   * BIN-634: admin-redigering av eksisterende spiller.
   *
   * Tillatte felter: `displayName`, `surname`, `phone`, `hallId`.
   * `email` er IKKE tillatt her — identitetsbevarende endring; e-post-bytte
   * må eventuelt gå via egen endpoint (reset-flyt, KYC-re-verify).
   *
   * Returnerer både tidligere og oppdatert versjon slik at route-laget kan
   * logge et fullt diff til AuditLog (regulatorisk krav — se
   * pengespillforskriften §13 om sporbarhet).
   */
  async updatePlayerAsAdmin(input: {
    userId: string;
    updates: {
      displayName?: string;
      surname?: string | null;
      phone?: string | null;
      hallId?: string | null;
    };
  }): Promise<{
    previous: PublicAppUser;
    updated: PublicAppUser;
    changedFields: Array<"displayName" | "surname" | "phone" | "hallId">;
  }> {
    await this.ensureInitialized();
    const userId = this.assertEntityReference(input.userId, "userId");
    const updates = input.updates ?? {};

    // Validér + normaliser per felt før vi åpner transaksjon.
    const normalized: {
      displayName?: string;
      surname?: string | null;
      phone?: string | null;
      hallId?: string | null;
    } = {};

    if (updates.displayName !== undefined) {
      const name = updates.displayName.trim();
      this.assertDisplayName(name);
      normalized.displayName = name;
    }
    if (updates.surname !== undefined) {
      if (updates.surname === null) {
        normalized.surname = null;
      } else {
        const s = updates.surname.trim();
        this.assertSurname(s);
        normalized.surname = s;
      }
    }
    if (updates.phone !== undefined) {
      if (updates.phone === null) {
        normalized.phone = null;
      } else {
        const p = updates.phone.trim();
        if (p.length > 40) {
          throw new DomainError("INVALID_INPUT", "phone er for lang (maks 40 tegn).");
        }
        normalized.phone = p.length ? p : null;
      }
    }
    if (updates.hallId !== undefined) {
      normalized.hallId =
        updates.hallId === null || updates.hallId === ""
          ? null
          : this.assertEntityReference(updates.hallId, "hallId");
    }

    const hasAnyField =
      normalized.displayName !== undefined ||
      normalized.surname !== undefined ||
      normalized.phone !== undefined ||
      normalized.hallId !== undefined;
    if (!hasAnyField) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existingRows } = await client.query<UserRow>(
        `SELECT id, email, display_name, surname, phone, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at
         FROM ${this.usersTable()}
         WHERE id = $1
         FOR UPDATE`,
        [userId]
      );
      const existingRow = existingRows[0];
      if (!existingRow) {
        throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
      }
      const previous = this.mapUser(existingRow);

      // Valider hall-eksistens om den endres og ikke er null.
      if (normalized.hallId !== undefined && normalized.hallId !== null) {
        const { rows: hallRows } = await client.query(
          `SELECT id FROM ${this.hallsTable()} WHERE id = $1`,
          [normalized.hallId]
        );
        if (!hallRows[0]) {
          throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      const changedFields: Array<"displayName" | "surname" | "phone" | "hallId"> = [];

      if (
        normalized.displayName !== undefined &&
        normalized.displayName !== previous.displayName
      ) {
        sets.push(`display_name = $${idx++}`);
        values.push(normalized.displayName);
        changedFields.push("displayName");
      }
      if (normalized.surname !== undefined && (normalized.surname ?? null) !== (previous.surname ?? null)) {
        sets.push(`surname = $${idx++}`);
        values.push(normalized.surname);
        changedFields.push("surname");
      }
      if (normalized.phone !== undefined && (normalized.phone ?? null) !== (previous.phone ?? null)) {
        sets.push(`phone = $${idx++}`);
        values.push(normalized.phone);
        changedFields.push("phone");
      }
      if (
        normalized.hallId !== undefined &&
        (normalized.hallId ?? null) !== (previous.hallId ?? null)
      ) {
        sets.push(`hall_id = $${idx++}`);
        values.push(normalized.hallId);
        changedFields.push("hallId");
      }

      if (sets.length === 0) {
        // No-op: ingen faktisk endring. Returner uendret bruker, tom diff.
        await client.query("COMMIT");
        const unchanged = await this.withBalance(previous);
        return { previous: unchanged, updated: unchanged, changedFields: [] };
      }

      sets.push(`updated_at = now()`);
      values.push(userId);

      const { rows: updatedRows } = await client.query<UserRow>(
        `UPDATE ${this.usersTable()}
         SET ${sets.join(", ")}
         WHERE id = $${idx}
         RETURNING id, email, display_name, surname, phone, compliance_data, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at`,
        values
      );
      await client.query("COMMIT");
      const updated = await this.withBalance(this.mapUser(updatedRows[0]!));
      const previousWithBalance = await this.withBalance(previous);
      return { previous: previousWithBalance, updated, changedFields };
    } catch (error) {
      await client.query("ROLLBACK");
      throw this.wrapError(error);
    } finally {
      client.release();
    }
  }

  /**
   * BIN-720 follow-up: wire ProfileSettingsService into PlatformService
   * after both are constructed. Lets `assertUserEligibleForGameplay`
   * gate gameplay on time-based block-myself (1d/7d/30d). Idempotent —
   * later calls overwrite the previous reference.
   */
  setProfileSettingsService(service: { assertUserNotBlocked(userId: string): Promise<void> }): void {
    this.profileSettingsService = service;
  }

  /**
   * Pre-gameplay eligibility check — KYC + age + (BIN-720 follow-up)
   * time-based block-myself.
   *
   * The block-myself check is enforced even in non-production builds,
   * because dev-flows still need a working block UI; only KYC/age are
   * dev-skipped. 1y/permanent self-exclusion is enforced separately by
   * `BingoEngine.assertWalletAllowedForGameplay` (ComplianceManager-
   * scoped, wallet-keyed).
   */
  async assertUserEligibleForGameplay(user: PublicAppUser): Promise<void> {
    // BIN-720 follow-up: time-based block-myself runs first so that
    // a blocked player gets the same "PLAYER_BLOCKED" message in dev
    // and prod. Skipped silently when the service hasn't been wired.
    if (this.profileSettingsService) {
      await this.profileSettingsService.assertUserNotBlocked(user.id);
    }

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

    // Validate old token and get user (BIN-587 B2.3: soft-deleted users kan
    // ikke refreshe sesjoner).
    const { rows } = await this.pool.query<UserRow & { session_id: string }>(
      `SELECT s.id AS session_id, u.id, u.email, u.display_name, u.surname, u.wallet_id, u.role, u.kyc_status,
              u.birth_date, u.kyc_verified_at, u.kyc_provider_ref, u.hall_id, u.created_at, u.updated_at
       FROM ${this.sessionsTable()} s
       JOIN ${this.usersTable()} u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.deleted_at IS NULL
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
    // BIN-693 Option B: returner available_balance (total − active reservations)
    // så klient-visning matcher "det som er tilgjengelig å bruke". Fallback til
    // getBalance for adaptere som ikke har implementert reservation-flyten.
    const balance = this.walletAdapter.getAvailableBalance
      ? await this.walletAdapter.getAvailableBalance(user.walletId)
      : await this.walletAdapter.getBalance(user.walletId);
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
      hallId: row.hall_id ?? null,
      kycStatus: row.kyc_status,
      birthDate,
      kycVerifiedAt: row.kyc_verified_at ? asIso(row.kyc_verified_at) : undefined,
      kycProviderRef: row.kyc_provider_ref ?? undefined,
      // GAP #5: image-kolonnene er optional i UserRow så ikke alle queries
      // selecter dem. Bevarer null for kjente queries og undefined for
      // call-sites som ikke har spurt om kolonnen — kallere bruker
      // `?? null` ved API-mapping uansett.
      profileImageUrl: row.profile_image_url ?? null,
      bankidSelfieUrl: row.bankid_selfie_url ?? null,
      bankidDocumentUrl: row.bankid_document_url ?? null,
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
    const cashBalance =
      row.cash_balance === null || row.cash_balance === undefined
        ? 0
        : typeof row.cash_balance === "number"
          ? row.cash_balance
          : Number(row.cash_balance);
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
      // DB-kolonnen er droppet (migrasjon 20260429000000). Feltet beholdes
      // i API-shapen (alltid "web") så eksisterende admin-UI ikke krasjer.
      clientVariant: "web",
      tvUrl: row.tv_url ?? undefined,
      hallNumber: row.hall_number ?? null,
      cashBalance: Number.isFinite(cashBalance) ? cashBalance : 0,
      tvToken: row.tv_token,
      tvVoiceSelection: this.normalizeTvVoice(row.tv_voice_selection),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at)
    };
  }

  /**
   * Normaliser DB-verdi til `HallTvVoice`. Fail-safe: ukjente verdier
   * (null, eldre fixtures uten kolonnen) faller tilbake til `voice1`
   * slik at TV-klienten alltid har en gyldig pack å laste.
   */
  private normalizeTvVoice(raw: string | null | undefined): HallTvVoice {
    if (raw === "voice1" || raw === "voice2" || raw === "voice3") return raw;
    return "voice1";
  }

  private mapHallDisplayToken(row: HallDisplayTokenRow): HallDisplayToken {
    return {
      id: row.id,
      hallId: row.hall_id,
      label: row.label ?? "",
      createdAt: asIso(row.created_at),
      lastUsedAt: row.last_used_at ? asIso(row.last_used_at) : undefined,
      createdByUserId: row.created_by ?? undefined,
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
      parentScheduleId: row.parent_schedule_id ?? null,
      subGameSequence: row.sub_game_sequence != null ? Number(row.sub_game_sequence) : null,
      subGameNumber: row.sub_game_number ?? null,
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
      `SELECT id, slug, name, region, address,
              organization_number, settlement_account, invoice_method,
              is_active, tv_url, hall_number, cash_balance, tv_token,
              tv_voice_selection, created_at, updated_at
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
       RETURNING id, email, display_name, surname, phone, wallet_id, role, kyc_status, birth_date, kyc_verified_at, kyc_provider_ref, hall_id, created_at, updated_at`,
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
          role TEXT NOT NULL CHECK (role IN ('ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER', 'AGENT')),
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
      for (const col of [
        "organization_number TEXT",
        "settlement_account TEXT",
        "invoice_method TEXT",
        // Migrasjon 20260701000000 (Hall Number): legacy heltall (101, 102, ...).
        "hall_number INT",
        // BIN-583 migrasjon 20260418250200: running cash-balanse per hall.
        "cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "dropsafe_balance NUMERIC(14, 2) NOT NULL DEFAULT 0",
        // BIN-498 migrasjon 20260418140000: TV-display embed URL.
        "tv_url TEXT",
      ]) {
        await client.query(
          `ALTER TABLE ${this.hallsTable()} ADD COLUMN IF NOT EXISTS ${col}`
        ).catch(() => {});
      }
      // TV Screen public token (migrasjon 20260423000100). Idempotent fallback
      // for test-schema boot + fresh installs: sikrer at default + UNIQUE-
      // indeks også er på plass uten at migrations har kjørt.
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`).catch(() => {});
      await client.query(
        `ALTER TABLE ${this.hallsTable()} ADD COLUMN IF NOT EXISTS tv_token TEXT`
      ).catch(() => {});
      await client.query(
        `UPDATE ${this.hallsTable()} SET tv_token = gen_random_uuid()::text WHERE tv_token IS NULL`
      ).catch(() => {});
      await client.query(
        `ALTER TABLE ${this.hallsTable()} ALTER COLUMN tv_token SET DEFAULT gen_random_uuid()::text`
      ).catch(() => {});
      await client.query(
        `ALTER TABLE ${this.hallsTable()} ALTER COLUMN tv_token SET NOT NULL`
      ).catch(() => {});
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ix_${this.schema}_app_halls_tv_token
         ON ${this.hallsTable()} (tv_token)`
      ).catch(() => {});

      // TV-kiosk voice-pack (migrasjon 20260811000000). Idempotent fallback
      // så test-schema boot + fresh installs får default + CHECK-constraint
      // på plass uten å avhenge av at migrations har kjørt.
      await client.query(
        `ALTER TABLE ${this.hallsTable()} ADD COLUMN IF NOT EXISTS tv_voice_selection TEXT`
      ).catch(() => {});
      await client.query(
        `UPDATE ${this.hallsTable()} SET tv_voice_selection = 'voice1' WHERE tv_voice_selection IS NULL`
      ).catch(() => {});
      await client.query(
        `ALTER TABLE ${this.hallsTable()} ALTER COLUMN tv_voice_selection SET DEFAULT 'voice1'`
      ).catch(() => {});
      await client.query(
        `ALTER TABLE ${this.hallsTable()} ALTER COLUMN tv_voice_selection SET NOT NULL`
      ).catch(() => {});
      // CHECK-constraint: idempotent via ADD/DROP-mønster er risky, bruker
      // en navngitt constraint + DROP-before-ADD med EXCEPTION-tolerant wrapper.
      await client.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM information_schema.constraint_column_usage
              WHERE table_schema = '${this.schema}'
                AND table_name = 'app_halls'
                AND constraint_name = 'ck_app_halls_tv_voice_selection'
           ) THEN
             ALTER TABLE ${this.hallsTable()}
               ADD CONSTRAINT ck_app_halls_tv_voice_selection
               CHECK (tv_voice_selection IN ('voice1', 'voice2', 'voice3'));
           END IF;
         END$$`
      ).catch(() => {});

      // BIN-591: HALL_OPERATOR hall-scope. Added AFTER halls table exists
      // so the FK target is valid on a fresh schema.
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS hall_id TEXT NULL REFERENCES ${this.hallsTable()}(id) ON DELETE SET NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_app_users_hall_id
         ON ${this.usersTable()}(hall_id) WHERE hall_id IS NOT NULL`
      );

      // BIN-587 B2.3: soft-delete + per-hall-status
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_app_users_deleted_at
         ON ${this.usersTable()}(deleted_at) WHERE deleted_at IS NOT NULL`
      );

      // GAP #5: profile/BankID image columns. Migration 20260825000000
      // skriver de samme kolonnene på fresh schemas; ALTER TABLE ... IF
      // NOT EXISTS er idempotent og dekker både ny init og oppgradering.
      await client.query(
        `ALTER TABLE ${this.usersTable()}
         ADD COLUMN IF NOT EXISTS profile_image_url   TEXT NULL,
         ADD COLUMN IF NOT EXISTS bankid_selfie_url   TEXT NULL,
         ADD COLUMN IF NOT EXISTS bankid_document_url TEXT NULL`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "${this.schema}"."app_player_hall_status" (
          user_id TEXT NOT NULL REFERENCES ${this.usersTable()}(id) ON DELETE CASCADE,
          hall_id TEXT NOT NULL REFERENCES ${this.hallsTable()}(id) ON DELETE CASCADE,
          is_active BOOLEAN NOT NULL DEFAULT true,
          reason TEXT NULL,
          updated_by TEXT NULL REFERENCES ${this.usersTable()}(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, hall_id)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_app_player_hall_status_hall
         ON "${this.schema}"."app_player_hall_status"(hall_id) WHERE is_active = false`
      );

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
        // BIN shell-routing: clientEngine="web" ruter bingo gjennom PixiJS
        // game-client. Se migration 20260421000100_set_bingo_client_engine_web.sql
        // og apps/backend/public/web/lobby.js `shouldUseWebClient`.
        ["bingo",        "Bingo",        "75-kulsbingo med flere spillvarianter",    "/bingo",        true, 1, { gameNumber: 1, clientEngine: "web" }],
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

  private hallDisplayTokensTable(): string {
    return `"${this.schema}"."app_hall_display_tokens"`;
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
        definition.includes("'PLAYER'") &&
        definition.includes("'AGENT'");
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
       CHECK (role IN ('ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER', 'AGENT'))`
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
