/**
 * BIN-587 B2.1: single-use token-service for password-reset og e-post-verify.
 *
 * Bruker sha256-hash av tokenet som kolonne. Klartekst genereres kun én
 * gang — ved createPasswordResetToken / createEmailVerifyToken — og
 * returneres til kalleren, som videreformidler den via e-post.
 *
 * validate() returnerer userId hvis tokenet er aktivt og ikke utløpt.
 * consume() markerer det som brukt i samme transaksjon som kalleren bør
 * utføre sine sideeffekter. For enkelhet her gjør consume() bare
 * `used_at = now()`; kalleren må koordinere atomicity selv (typisk via
 * å kalle consume() først og så utføre sin operasjon; hvis operasjonen
 * feiler kan tokenet ikke brukes igjen — akseptert trade-off).
 */

import { randomUUID, randomBytes, createHash } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "auth-token-service" });

export type AuthTokenKind = "password-reset" | "email-verify";

export interface AuthTokenServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  /** Fallback for tests / legacy callers — only used if `pool` is not set. */
  connectionString?: string;
  schema?: string;
  /** TTL for password-reset tokens. Default 1 time. */
  passwordResetTtlMs?: number;
  /** TTL for e-mail-verify tokens. Default 48 timer. */
  emailVerifyTtlMs?: number;
}

export interface CreateTokenResult {
  /** Klartekst-tokenet — skal ikke lagres i databasen eller logges. */
  token: string;
  expiresAt: string;
}

export interface PersistedTokenRow {
  id: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
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

function tableFor(kind: AuthTokenKind, schema: string): string {
  const name = kind === "password-reset" ? "app_password_reset_tokens" : "app_email_verify_tokens";
  return `"${schema}"."${name}"`;
}

export class AuthTokenService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly passwordResetTtlMs: number;
  private readonly emailVerifyTtlMs: number;
  private initPromise: Promise<void> | null = null;

  constructor(options: AuthTokenServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    this.passwordResetTtlMs = options.passwordResetTtlMs ?? 60 * 60 * 1000; // 1t
    this.emailVerifyTtlMs = options.emailVerifyTtlMs ?? 48 * 60 * 60 * 1000; // 48t
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "AuthTokenService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public", ttlMs?: { passwordReset?: number; emailVerify?: number }): AuthTokenService {
    const svc = Object.create(AuthTokenService.prototype) as AuthTokenService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { passwordResetTtlMs: number }).passwordResetTtlMs =
      ttlMs?.passwordReset ?? 60 * 60 * 1000;
    (svc as unknown as { emailVerifyTtlMs: number }).emailVerifyTtlMs =
      ttlMs?.emailVerify ?? 48 * 60 * 60 * 1000;
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private ttlFor(kind: AuthTokenKind): number {
    return kind === "password-reset" ? this.passwordResetTtlMs : this.emailVerifyTtlMs;
  }

  async createToken(
    kind: AuthTokenKind,
    userId: string,
    options?: { ttlMs?: number }
  ): Promise<CreateTokenResult> {
    await this.ensureInitialized();
    if (!userId || typeof userId !== "string") {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    if (options?.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0)) {
      throw new DomainError("INVALID_INPUT", "ttlMs må være et positivt tall.");
    }
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(token);
    // Per-call TTL-override brukes f.eks. for Excel-import-velkomstmail
    // hvor lenken må vare 7 dager (vs. standard 1 time for forgot-password).
    const ttlMs = options?.ttlMs ?? this.ttlFor(kind);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Invaliderer eventuelle tidligere aktive tokens for samme user +
      // kind (forhindrer at gamle reset-lenker forblir gyldige etter at
      // ny er sendt).
      await client.query(
        `UPDATE ${tableFor(kind, this.schema)}
         SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
      );
      await client.query(
        `INSERT INTO ${tableFor(kind, this.schema)}
         (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [id, userId, tokenHash, expiresAt]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err, kind, userId }, "[BIN-587 B2.1] Kunne ikke opprette token");
      throw new DomainError("TOKEN_CREATE_FAILED", "Kunne ikke opprette token.");
    } finally {
      client.release();
    }

    return { token, expiresAt };
  }

  /**
   * Valider tokenet (uten å forbruke det). Kaster DomainError ved
   * ukjent/utløpt/brukt token.
   */
  async validate(kind: AuthTokenKind, token: string): Promise<{ userId: string; tokenId: string }> {
    await this.ensureInitialized();
    if (!token || typeof token !== "string") {
      throw new DomainError("INVALID_TOKEN", "Ugyldig token.");
    }
    const tokenHash = sha256Hex(token);
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      expires_at: Date | string;
      used_at: Date | string | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
       FROM ${tableFor(kind, this.schema)}
       WHERE token_hash = $1`,
      [tokenHash]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("INVALID_TOKEN", "Ukjent eller ugyldig token.");
    }
    if (row.used_at) {
      throw new DomainError("TOKEN_ALREADY_USED", "Tokenet er allerede brukt.");
    }
    const expiresAt = typeof row.expires_at === "string" ? new Date(row.expires_at) : row.expires_at;
    if (expiresAt.getTime() <= Date.now()) {
      throw new DomainError("TOKEN_EXPIRED", "Tokenet er utløpt.");
    }
    return { userId: row.user_id, tokenId: row.id };
  }

  /**
   * Marker tokenet som brukt. Idempotent: kaller som treffer et allerede
   * forbrukt token vil kaste TOKEN_ALREADY_USED. Skal ikke kalles for
   * ukjent token (bruk validate først).
   */
  async consume(kind: AuthTokenKind, tokenId: string): Promise<void> {
    await this.ensureInitialized();
    const { rowCount } = await this.pool.query(
      `UPDATE ${tableFor(kind, this.schema)}
       SET used_at = now()
       WHERE id = $1 AND used_at IS NULL`,
      [tokenId]
    );
    if (!rowCount) {
      throw new DomainError("TOKEN_ALREADY_USED", "Tokenet er allerede brukt.");
    }
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
      for (const table of ["app_password_reset_tokens", "app_email_verify_tokens"]) {
        const qualified = `"${this.schema}"."${table}"`;
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${qualified} (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_user
           ON ${qualified}(user_id) WHERE used_at IS NULL`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_expires
           ON ${qualified}(expires_at) WHERE used_at IS NULL`
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      throw new DomainError(
        "PLATFORM_DB_ERROR",
        "Kunne ikke initialisere auth-token-tabeller."
      );
    } finally {
      client.release();
    }
  }
}
