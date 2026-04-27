/**
 * REQ-130 (PDF 9 Frontend CR): Phone+PIN-login.
 *
 * Tilbyr setup, verifisering og deaktivering av en kort numerisk PIN
 * (4-6 siffer) som alternativ innlogging til Email+Password. PIN-er
 * lagres scrypt-hashet i `app_user_pins`. Gir også lockout-håndtering
 * (5 feilede forsøk innen 15 min → låst).
 *
 * Hashing-algoritmen er scrypt (Node-built-in) — konsistent med
 * `PlatformService.hashPassword`. Brifen ba om bcrypt, men repoet bruker
 * scrypt som standard for å unngå ny dependency, så denne tjenesten
 * følger eksisterende konvensjon.
 *
 * Lockout-policy:
 *   - Hver feilende `verifyPin` inkrementerer `failed_attempts`.
 *   - Når `failed_attempts >= MAX_ATTEMPTS` settes `locked_until` til
 *     `now() + LOCK_FAR_FUTURE_MS` (lang varighet — admin/reset kreves).
 *   - Vellykket `verifyPin` nullstiller failed_attempts og locked_until.
 *
 * Phone-validering (norsk) gjøres i route-laget (auth.ts) før vi i det
 * hele tatt slår opp brukeren — service-en tar kun userId/pin.
 */

import {
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const logger = rootLogger.child({ module: "user-pin-service" });

/** PIN-lengde-grenser. */
const PIN_MIN_DIGITS = 4;
const PIN_MAX_DIGITS = 6;

/** Lockout: 5 feil innen window → lås. */
export const PIN_MAX_FAILED_ATTEMPTS = 5;
/** Window for at telleren skal "telle" — etter dette nullstilles ved neste
 *  verify som ikke selv treffer lockout-barrieren. Ikke en hard reset i DB,
 *  men en logisk grense for hva en streak betyr. 15 min per spec. */
export const PIN_FAILED_WINDOW_MS = 15 * 60 * 1000;
/** Hvor lenge PIN er låst etter at lockout er trigget. Lang nok at admin
 *  må reset-e (alternativt brukeren disabler + setup på nytt med passord). */
const PIN_LOCK_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export interface UserPinServiceOptions {
  schema?: string;
  /** Override scrypt-keylen for tester. Default 64. */
  keyLen?: number;
}

export interface PinStatus {
  /** Om brukeren har en PIN aktivert. */
  enabled: boolean;
  /** Hvis enabled: er PIN låst på grunn av for mange feil-forsøk? */
  locked: boolean;
  /** Hvis locked: ISO timestamp for når låsen utløper (kan være langt fram). */
  lockedUntil: string | null;
  /** Antall feilede forsøk siste streak. */
  failedAttempts: number;
  /** ISO timestamp for siste vellykkede PIN-login. */
  lastUsedAt: string | null;
}

interface UserPinRow {
  user_id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function asIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Verifiserer at en streng er en gyldig PIN: 4-6 siffer, kun tall.
 * Kaster DomainError ved feil — kalles av setup og verify.
 */
export function assertValidPin(pin: unknown): string {
  if (typeof pin !== "string") {
    throw new DomainError("INVALID_PIN", `PIN må være en tall-streng.`);
  }
  const trimmed = pin.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new DomainError("INVALID_PIN", "PIN må kun inneholde siffer.");
  }
  if (trimmed.length < PIN_MIN_DIGITS || trimmed.length > PIN_MAX_DIGITS) {
    throw new DomainError(
      "INVALID_PIN",
      `PIN må være ${PIN_MIN_DIGITS}-${PIN_MAX_DIGITS} siffer.`
    );
  }
  return trimmed;
}

export class UserPinService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly keyLen: number;
  private initPromise: Promise<void> | null = null;

  constructor(pool: Pool, options: UserPinServiceOptions = {}) {
    this.pool = pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.keyLen = options.keyLen ?? 64;
  }

  private table(): string {
    return `"${this.schema}"."app_user_pins"`;
  }

  /**
   * Lazy schema-init. Kalles fra hver public metode for å være konsistent
   * med AuthTokenService. Idempotent — `CREATE TABLE IF NOT EXISTS`.
   */
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
          user_id TEXT PRIMARY KEY,
          pin_hash TEXT NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
          locked_until TIMESTAMPTZ NULL,
          last_used_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_user_pins_locked
         ON ${this.table()}(locked_until)
         WHERE locked_until IS NOT NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      throw new DomainError(
        "PLATFORM_DB_ERROR",
        "Kunne ikke initialisere user-pin-tabell."
      );
    } finally {
      client.release();
    }
  }

  // ── Hashing ──────────────────────────────────────────────────────────

  private async hashPin(pin: string): Promise<string> {
    const salt = randomBytes(16);
    const digest = await scrypt(pin, salt, this.keyLen);
    return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
  }

  private async verifyHash(pin: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") {
      logger.warn("[REQ-130] Ugyldig pin-hash format på rad — avviser");
      return false;
    }
    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");
    const actual = await scrypt(pin, salt, expected.length);
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Sett opp eller oppdater PIN for en bruker. Hvis brukeren allerede har
   * en PIN, overskrives den (idempotent). Lockout-state og failed_attempts
   * nullstilles slik at gammel mislykket streak ikke videreføres.
   */
  async setupPin(userId: string, pinRaw: string): Promise<void> {
    await this.ensureInitialized();
    if (!userId.trim()) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const pin = assertValidPin(pinRaw);
    const pinHash = await this.hashPin(pin);
    await this.pool.query(
      `INSERT INTO ${this.table()}
         (user_id, pin_hash, failed_attempts, locked_until, last_used_at, created_at, updated_at)
       VALUES ($1, $2, 0, NULL, NULL, now(), now())
       ON CONFLICT (user_id) DO UPDATE
         SET pin_hash = EXCLUDED.pin_hash,
             failed_attempts = 0,
             locked_until = NULL,
             updated_at = now()`,
      [userId, pinHash]
    );
  }

  /**
   * Slett PIN for brukeren (idempotent — null-effekt hvis ikke satt).
   * Bruker kaller dette via /api/auth/pin/disable etter passord-verifisering
   * (det er routens ansvar å verifisere passord før denne metoden kalles).
   */
  async disablePin(userId: string): Promise<void> {
    await this.ensureInitialized();
    if (!userId.trim()) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    await this.pool.query(
      `DELETE FROM ${this.table()} WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Hent PIN-status for en bruker (UI-visning og admin).
   */
  async getStatus(userId: string): Promise<PinStatus> {
    await this.ensureInitialized();
    if (!userId.trim()) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const { rows } = await this.pool.query<UserPinRow>(
      `SELECT user_id, pin_hash, failed_attempts, locked_until, last_used_at, created_at, updated_at
         FROM ${this.table()}
        WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) {
      return {
        enabled: false,
        locked: false,
        lockedUntil: null,
        failedAttempts: 0,
        lastUsedAt: null,
      };
    }
    const lockedUntilIso = asIso(row.locked_until);
    const locked = lockedUntilIso !== null && new Date(lockedUntilIso).getTime() > Date.now();
    return {
      enabled: true,
      locked,
      lockedUntil: lockedUntilIso,
      failedAttempts: row.failed_attempts,
      lastUsedAt: asIso(row.last_used_at),
    };
  }

  /**
   * Verifiser en PIN. Returnerer true ved match. Ved mismatch oppdateres
   * failed_attempts + ev. lockout. Ved match nullstilles tellerne.
   *
   * Ved lockout kastes DomainError("PIN_LOCKED").
   * Ved ukjent bruker / ingen PIN kastes DomainError("INVALID_CREDENTIALS").
   * Ved feil PIN kastes DomainError("INVALID_CREDENTIALS") — samme kode som
   * ved ukjent bruker for å hindre user-enumeration.
   */
  async verifyPin(userId: string, pinRaw: string): Promise<void> {
    await this.ensureInitialized();
    const pin = assertValidPin(pinRaw);
    const { rows } = await this.pool.query<UserPinRow>(
      `SELECT user_id, pin_hash, failed_attempts, locked_until, last_used_at, created_at, updated_at
         FROM ${this.table()}
        WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) {
      // Skil ut: ikke kjent som "PIN_NOT_SET" mot eksterne kallere — vi
      // returnerer INVALID_CREDENTIALS for å hindre å skille mellom
      // "ingen pin" og "feil pin". Internt logges det.
      logger.warn({ userId }, "[REQ-130] verifyPin på bruker uten PIN");
      throw new DomainError("INVALID_CREDENTIALS", "Ugyldig PIN.");
    }

    const lockedUntilMs = row.locked_until
      ? new Date(asIso(row.locked_until) ?? 0).getTime()
      : 0;
    if (lockedUntilMs > Date.now()) {
      throw new DomainError(
        "PIN_LOCKED",
        "PIN-en er låst på grunn av for mange feilede forsøk. Kontakt support."
      );
    }

    const ok = await this.verifyHash(pin, row.pin_hash);
    if (ok) {
      // Nullstill streak + oppdater last_used_at.
      await this.pool.query(
        `UPDATE ${this.table()}
            SET failed_attempts = 0,
                locked_until = NULL,
                last_used_at = now(),
                updated_at = now()
          WHERE user_id = $1`,
        [userId]
      );
      return;
    }

    // Mismatch: inkrementer + ev. lås.
    const nextAttempts = row.failed_attempts + 1;
    if (nextAttempts >= PIN_MAX_FAILED_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS).toISOString();
      await this.pool.query(
        `UPDATE ${this.table()}
            SET failed_attempts = $2,
                locked_until = $3,
                updated_at = now()
          WHERE user_id = $1`,
        [userId, nextAttempts, lockUntil]
      );
      logger.warn(
        { userId, attempts: nextAttempts },
        "[REQ-130] PIN låst etter for mange feilede forsøk"
      );
      throw new DomainError(
        "PIN_LOCKED",
        "PIN-en er låst på grunn av for mange feilede forsøk. Kontakt support."
      );
    }

    await this.pool.query(
      `UPDATE ${this.table()}
          SET failed_attempts = $2,
              updated_at = now()
        WHERE user_id = $1`,
      [userId, nextAttempts]
    );
    throw new DomainError("INVALID_CREDENTIALS", "Ugyldig PIN.");
  }
}
