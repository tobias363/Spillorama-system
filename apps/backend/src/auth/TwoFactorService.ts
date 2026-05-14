/**
 * REQ-129: Two-factor (TOTP) service.
 *
 * Eier livssyklusen til 2FA per bruker:
 *   - setup() — genererer pending_secret og otpauth-URI til klienten.
 *   - verifyAndEnable() — sjekker første TOTP-kode mot pending_secret,
 *     promoterer den til enabled_secret og genererer 10 backup-codes.
 *   - isEnabled() / getStatus() — read-helpers brukt av login-flyt og
 *     profile-page.
 *   - verifyTotpForLogin() — sjekker TOTP-kode under login. Tillater
 *     også backup-code (single-use) som fall-back.
 *   - disable() — krever TOTP-kode (eller passord-verifisering på rute-
 *     nivå); fjerner enabled_secret + backup-codes.
 *   - challenge-tabellen leves med createChallenge / consumeChallenge
 *     for å holde tilstand mellom passord-verifisering og TOTP-input.
 *
 * Ingen ekstern krypto: bruker eksisterende node:crypto + Totp.ts.
 */

import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { getPoolTuning } from "../util/pgPool.js";
import { attachPoolErrorHandler } from "../util/pgPoolErrorHandler.js";
import { logger as rootLogger } from "../util/logger.js";
import {
  buildOtpauthUri,
  generateTotpSecret,
  verifyTotpCode,
} from "./Totp.js";

const logger = rootLogger.child({ module: "two-factor-service" });

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min
const BACKUP_CODE_COUNT = 10;
/** Backup-koder er 10 sifre formatert "XXXXX-XXXXX" — brukervennlig, men nok entropi (10^10 = ~33 bit). */
const BACKUP_CODE_DIGITS = 10;

export interface TwoFactorServiceOptions {
  connectionString?: string;
  pool?: Pool;
  schema?: string;
  /** Issuer-navn for otpauth-URI (vises i Authenticator-appen). Default "Spillorama". */
  issuer?: string;
  /** Når sant: anti-debug — utgir secrets i log. Skal aldri være sant i prod. */
  debugLogSecrets?: boolean;
}

export interface TwoFactorSetupResult {
  secret: string;
  otpauthUri: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  /** Antall ubrukte backup-codes. Brukes til "regenerate"-prompt i UI. */
  backupCodesRemaining: number;
  /** Sant hvis pending_secret er satt (klient har ikke fullført setup ennå). */
  hasPendingSetup: boolean;
}

export interface BackupCodeEntry {
  /** SHA-256 hex av koden. */
  h: string;
  /** ISO-timestamp når koden ble brukt, eller null hvis ubrukt. */
  u: string | null;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Generer en 10-sifret backup-kode formatert "XXXXX-XXXXX" for lesbarhet.
 * Bruker `randomBytes` + modulo for å få en jevn fordeling — vi tåler
 * marginal bias (ikke krypto-kritisk, brukes som éngangs-kode).
 */
function generateBackupCode(): string {
  const buf = randomBytes(8);
  // 8 bytes = 64 bit; vi konverterer til 10-sifret tall via BigInt.
  const value = buf.readBigUInt64BE();
  const truncated = value % 10n ** BigInt(BACKUP_CODE_DIGITS);
  const padded = truncated.toString().padStart(BACKUP_CODE_DIGITS, "0");
  return `${padded.slice(0, 5)}-${padded.slice(5)}`;
}

function constantTimeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class TwoFactorService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly issuer: string;
  private readonly debugLogSecrets: boolean;
  private initPromise: Promise<void> | null = null;
  private readonly ownsPool: boolean;

  constructor(options: TwoFactorServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    this.issuer = options.issuer ?? "Spillorama";
    this.debugLogSecrets = options.debugLogSecrets ?? false;

    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
      // Agent T (2026-05-14): attach error-handler så pg-errors (57P01 etc) ikke
      // propagerer som uncaughtException og dreper backend. Se Sentry-issue
      // SPILLORAMA-BACKEND-5 (2026-05-14) for root cause.
      attachPoolErrorHandler(this.pool, { poolName: "two-factor-service-pool" });
      this.ownsPool = true;
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "TwoFactorService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): TwoFactorService {
    return new TwoFactorService({ pool, schema });
  }

  // ── Setup-flyt ──────────────────────────────────────────────────────────

  /**
   * Initier 2FA-setup. Genererer ny pending_secret og returnerer
   * otpauth-URI som klient kan rendere som QR-kode. Hvis bruker allerede
   * har 2FA aktivert, kaster TWO_FA_ALREADY_ENABLED.
   */
  async setup(input: { userId: string; accountLabel: string }): Promise<TwoFactorSetupResult> {
    await this.ensureInitialized();
    const userId = input.userId.trim();
    const accountLabel = input.accountLabel.trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    if (!accountLabel) {
      throw new DomainError("INVALID_INPUT", "accountLabel er påkrevd.");
    }

    const existing = await this.pool.query<{
      enabled_secret: string | null;
    }>(
      `SELECT enabled_secret FROM "${this.schema}"."app_user_2fa" WHERE user_id = $1`,
      [userId]
    );
    if (existing.rows[0]?.enabled_secret) {
      throw new DomainError("TWO_FA_ALREADY_ENABLED", "2FA er allerede aktivert. Deaktiver først.");
    }

    const secret = generateTotpSecret();
    const otpauthUri = buildOtpauthUri({
      secret,
      accountLabel,
      issuer: this.issuer,
    });

    await this.pool.query(
      `INSERT INTO "${this.schema}"."app_user_2fa" (user_id, pending_secret)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET pending_secret = EXCLUDED.pending_secret, updated_at = now()`,
      [userId, secret]
    );

    if (this.debugLogSecrets) {
      logger.warn({ userId, secret }, "[REQ-129] DEBUG: 2FA secret generated (debugLogSecrets=true)");
    }

    return { secret, otpauthUri };
  }

  /**
   * Verifiser første TOTP-kode mot pending_secret og aktiver 2FA. Genererer
   * 10 backup-codes som returneres i klartekst (kun denne ene gangen).
   */
  async verifyAndEnable(input: { userId: string; code: string }): Promise<{ backupCodes: string[] }> {
    await this.ensureInitialized();
    const userId = input.userId.trim();
    const code = (input.code ?? "").trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    if (!/^\d{6}$/.test(code)) {
      throw new DomainError("INVALID_INPUT", "TOTP-koden må være 6 sifre.");
    }

    const { rows } = await this.pool.query<{
      pending_secret: string | null;
      enabled_secret: string | null;
    }>(
      `SELECT pending_secret, enabled_secret
       FROM "${this.schema}"."app_user_2fa"
       WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !row.pending_secret) {
      throw new DomainError("TWO_FA_NO_PENDING_SETUP", "Ingen pending 2FA-setup. Initier på nytt.");
    }
    if (row.enabled_secret) {
      throw new DomainError("TWO_FA_ALREADY_ENABLED", "2FA er allerede aktivert.");
    }
    if (!verifyTotpCode(row.pending_secret, code)) {
      throw new DomainError("INVALID_TOTP_CODE", "Ugyldig TOTP-kode.");
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
    const backupCodeRows: BackupCodeEntry[] = backupCodes.map((c) => ({
      h: sha256Hex(c.replace("-", "")),
      u: null,
    }));

    await this.pool.query(
      `UPDATE "${this.schema}"."app_user_2fa"
       SET enabled_secret = pending_secret,
           pending_secret = NULL,
           enabled_at = now(),
           backup_codes = $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, JSON.stringify(backupCodeRows)]
    );

    return { backupCodes };
  }

  /**
   * Deaktiver 2FA. Krever korrekt TOTP-kode (eller backup-code) — kalleren
   * skal i tillegg ha verifisert passord på rute-nivå (defense-in-depth).
   * Sletter enabled_secret + backup-codes så bruker må sette opp på nytt.
   */
  async disable(input: { userId: string; code: string }): Promise<void> {
    await this.ensureInitialized();
    const userId = input.userId.trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const status = await this.getStatus(userId);
    if (!status.enabled) {
      throw new DomainError("TWO_FA_NOT_ENABLED", "2FA er ikke aktivert.");
    }
    // Verify TOTP eller backup — same som login.
    await this.verifyTotpForLogin({ userId, code: input.code });

    await this.pool.query(
      `DELETE FROM "${this.schema}"."app_user_2fa" WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Regenerer backup-codes. Krever at 2FA allerede er aktivert. Returnerer
   * 10 nye koder; gamle blir overskrevet.
   */
  async regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
    await this.ensureInitialized();
    const status = await this.getStatus(userId);
    if (!status.enabled) {
      throw new DomainError("TWO_FA_NOT_ENABLED", "2FA er ikke aktivert.");
    }
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
    const backupCodeRows: BackupCodeEntry[] = backupCodes.map((c) => ({
      h: sha256Hex(c.replace("-", "")),
      u: null,
    }));
    await this.pool.query(
      `UPDATE "${this.schema}"."app_user_2fa"
       SET backup_codes = $2::jsonb, updated_at = now()
       WHERE user_id = $1`,
      [userId, JSON.stringify(backupCodeRows)]
    );
    return { backupCodes };
  }

  // ── Read-helpers ─────────────────────────────────────────────────────────

  async isEnabled(userId: string): Promise<boolean> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{ enabled_secret: string | null }>(
      `SELECT enabled_secret FROM "${this.schema}"."app_user_2fa" WHERE user_id = $1`,
      [userId]
    );
    return Boolean(rows[0]?.enabled_secret);
  }

  async getStatus(userId: string): Promise<TwoFactorStatus> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{
      pending_secret: string | null;
      enabled_secret: string | null;
      enabled_at: Date | string | null;
      backup_codes: BackupCodeEntry[] | string | null;
    }>(
      `SELECT pending_secret, enabled_secret, enabled_at, backup_codes
       FROM "${this.schema}"."app_user_2fa"
       WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) {
      return {
        enabled: false,
        enabledAt: null,
        backupCodesRemaining: 0,
        hasPendingSetup: false,
      };
    }
    const backupCodes: BackupCodeEntry[] = Array.isArray(row.backup_codes)
      ? row.backup_codes
      : typeof row.backup_codes === "string"
        ? (JSON.parse(row.backup_codes) as BackupCodeEntry[])
        : [];
    return {
      enabled: Boolean(row.enabled_secret),
      enabledAt: row.enabled_at
        ? typeof row.enabled_at === "string"
          ? row.enabled_at
          : row.enabled_at.toISOString()
        : null,
      backupCodesRemaining: backupCodes.filter((c) => c.u === null).length,
      hasPendingSetup: Boolean(row.pending_secret) && !row.enabled_secret,
    };
  }

  // ── Login-flyt ──────────────────────────────────────────────────────────

  /**
   * Verifiser TOTP-kode (eller backup-code) under login-flyten.
   * Aksepterer:
   *   - 6-sifret TOTP-kode mot enabled_secret (±1 step skew).
   *   - 10-sifret backup-kode "XXXXX-XXXXX" (single-use; markeres brukt).
   *
   * Kaster INVALID_TOTP_CODE hvis ingen match.
   */
  async verifyTotpForLogin(input: { userId: string; code: string }): Promise<void> {
    await this.ensureInitialized();
    const userId = input.userId.trim();
    const code = (input.code ?? "").trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    if (!code) {
      throw new DomainError("INVALID_INPUT", "TOTP-koden er påkrevd.");
    }

    const { rows } = await this.pool.query<{
      enabled_secret: string | null;
      backup_codes: BackupCodeEntry[] | string | null;
    }>(
      `SELECT enabled_secret, backup_codes
       FROM "${this.schema}"."app_user_2fa"
       WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !row.enabled_secret) {
      throw new DomainError("TWO_FA_NOT_ENABLED", "2FA er ikke aktivert.");
    }

    // 6-sifret TOTP-kode: TOTP.
    const cleanedCode = code.replace(/\s+/g, "");
    if (/^\d{6}$/.test(cleanedCode)) {
      if (verifyTotpCode(row.enabled_secret, cleanedCode)) {
        return;
      }
      // Fall-through til backup hvis TOTP feilet (lite sannsynlig at en 6-
      // sifret streng er backup-kode siden de er 10 sifre).
    }

    // Backup-code: "XXXXX-XXXXX" eller 10 sifre uten bindestrek.
    const normalizedBackup = cleanedCode.replace(/-/g, "");
    if (/^\d{10}$/.test(normalizedBackup)) {
      const backupCodes: BackupCodeEntry[] = Array.isArray(row.backup_codes)
        ? row.backup_codes
        : typeof row.backup_codes === "string"
          ? (JSON.parse(row.backup_codes) as BackupCodeEntry[])
          : [];
      const candidateHash = sha256Hex(normalizedBackup);
      const hit = backupCodes.find(
        (entry) => entry.u === null && constantTimeStringEquals(entry.h, candidateHash)
      );
      if (hit) {
        // Marker som brukt — atomisk update av JSONB.
        const updated = backupCodes.map((entry) =>
          entry === hit ? { ...entry, u: new Date().toISOString() } : entry
        );
        await this.pool.query(
          `UPDATE "${this.schema}"."app_user_2fa"
           SET backup_codes = $2::jsonb, updated_at = now()
           WHERE user_id = $1`,
          [userId, JSON.stringify(updated)]
        );
        logger.info({ userId }, "[REQ-129] backup-code consumed during login");
        return;
      }
    }

    throw new DomainError("INVALID_TOTP_CODE", "Ugyldig TOTP-kode.");
  }

  // ── Challenge-flyt ──────────────────────────────────────────────────────

  /**
   * Lag en 2FA-challenge når email+password verifiserer men 2FA er
   * aktivert. Returnerer challenge_id som klient sender med TOTP-kode.
   */
  async createChallenge(userId: string): Promise<{ challengeId: string; expiresAt: string }> {
    await this.ensureInitialized();
    if (!userId.trim()) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    await this.pool.query(
      `INSERT INTO "${this.schema}"."app_user_2fa_challenges"
        (id, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [challengeId, userId, expiresAt]
    );
    return { challengeId, expiresAt };
  }

  /**
   * Konsumer en 2FA-challenge atomisk. Returnerer userId hvis challenge er
   * gyldig og ikke utløpt; kaster ellers.
   */
  async consumeChallenge(challengeId: string): Promise<{ userId: string }> {
    await this.ensureInitialized();
    if (!challengeId.trim()) {
      throw new DomainError("INVALID_TWO_FA_CHALLENGE", "Ugyldig 2FA-challenge.");
    }
    const result = await this.pool.query<{ user_id: string }>(
      `UPDATE "${this.schema}"."app_user_2fa_challenges"
       SET consumed_at = now()
       WHERE id = $1
         AND consumed_at IS NULL
         AND expires_at > now()
       RETURNING user_id`,
      [challengeId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new DomainError("INVALID_TWO_FA_CHALLENGE", "2FA-challenge er ukjent, brukt eller utløpt.");
    }
    return { userId: row.user_id };
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  /**
   * Idempotent table-creation som backup hvis migrations ikke har kjørt
   * (brukes i test-harness og fresh installs). Matcher
   * 20260910000000_user_2fa_and_session_metadata.sql.
   */
  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE TABLE IF NOT EXISTS "${this.schema}"."app_user_2fa" (
          user_id TEXT PRIMARY KEY,
          pending_secret TEXT NULL,
          enabled_secret TEXT NULL,
          enabled_at TIMESTAMPTZ NULL,
          backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "${this.schema}"."app_user_2fa_challenges" (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error({ err }, "[REQ-129] kunne ikke initialisere 2FA-tabeller");
      throw new DomainError(
        "PLATFORM_DB_ERROR",
        "Kunne ikke initialisere 2FA-tabeller."
      );
    } finally {
      client.release();
    }
  }

  /** Lukk pool hvis vi eier den. Brukes i test-tear-down. */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
