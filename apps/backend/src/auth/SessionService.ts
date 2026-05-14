/**
 * REQ-132: Session-håndtering — list aktive, logout-all, logout-spesifikk,
 * 30-min inactivity-timeout og last_activity-tracking.
 *
 * Designvalg:
 *   - Sesjons-radens token_hash lagres allerede i `app_sessions`. Vi
 *     legger til kolonner `device_user_agent`, `ip_address`, `last_activity_at`
 *     i samme migrasjon (20260910000000).
 *   - PlatformService eier opprettelse av sesjoner (createSession), og vi
 *     lar opprettelse forbli der — men `recordLogin` tilbyr et enkelt
 *     UPDATE-hook for å sette user_agent + ip_address etter at sesjonen
 *     er opprettet via `login()`. Dette unngår å endre `createSession`-
 *     signatur (som er privat).
 *   - 30-min timeout sjekkes i `touchActivity()` — hvis siste aktivitet
 *     er > 30 min siden revoker vi sesjonen og kaster SESSION_TIMED_OUT.
 *     Ellers oppdaterer vi last_activity_at.
 *   - touch er throttled (oppdaterer kun hvis > 60s siden forrige
 *     aktivitet) for å unngå unødig DB-skriving på hver request.
 *
 * Sesjons-rader regnes som "aktive" når revoked_at IS NULL og
 * expires_at > now(). Inactivity-timeout flagger sesjoner som blir
 * revoked når de neste gang røres.
 */

import { Pool } from "pg";
import { createHash } from "node:crypto";
import { DomainError } from "../errors/DomainError.js";
import { getPoolTuning } from "../util/pgPool.js";
import { attachPoolErrorHandler } from "../util/pgPoolErrorHandler.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "session-service" });

const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const TOUCH_THROTTLE_MS = 60 * 1000; // 60s

export interface SessionServiceOptions {
  connectionString?: string;
  pool?: Pool;
  schema?: string;
  /** Default 30 min. */
  inactivityTimeoutMs?: number;
}

export interface ActiveSession {
  id: string;
  userId: string;
  deviceUserAgent: string | null;
  ipAddress: string | null;
  lastActivityAt: string;
  createdAt: string;
  expiresAt: string;
  /** Sant hvis denne sesjonen er den som gjorde requesten ("current"). */
  isCurrent: boolean;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

export class SessionService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly inactivityTimeoutMs: number;
  private readonly ownsPool: boolean;

  constructor(options: SessionServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;

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
      attachPoolErrorHandler(this.pool, { poolName: "session-service-pool" });
      this.ownsPool = true;
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "SessionService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public", inactivityTimeoutMs?: number): SessionService {
    return new SessionService({ pool, schema, inactivityTimeoutMs });
  }

  /**
   * Persister metadata på en eksisterende sesjon (etter at PlatformService
   * har opprettet den). user_agent trimmes til 500 tegn.
   */
  async recordLogin(input: {
    accessToken: string;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<void> {
    const tokenHash = hashToken(input.accessToken.trim());
    const trimmedUa =
      typeof input.userAgent === "string" && input.userAgent.trim()
        ? input.userAgent.slice(0, 500)
        : null;
    const trimmedIp =
      typeof input.ipAddress === "string" && input.ipAddress.trim()
        ? input.ipAddress.slice(0, 64)
        : null;
    await this.pool.query(
      `UPDATE "${this.schema}"."app_sessions"
       SET device_user_agent = $2,
           ip_address = $3,
           last_activity_at = now()
       WHERE token_hash = $1`,
      [tokenHash, trimmedUa, trimmedIp]
    );
  }

  /**
   * Oppdater last_activity_at hvis det er > TOUCH_THROTTLE_MS siden
   * forrige update. Sjekker også 30-min inactivity-timeout: hvis
   * grensen er overskredet revoker vi sesjonen og kaster SESSION_TIMED_OUT.
   *
   * Skal kalles fra auth-middleware på alle autentiserte routes.
   *
   * BIN-824 (2026-05-08): Soft-fail på DB-feil. `/api/auth/me` skal være
   * lese-orientert, og en touchActivity-feil må aldri blokkere svaret. Vi
   * fanger alle DB-feil (missing column under DDL-drift, midlertidig
   * connection-tap, etc.) og logger som warn. Den eneste throw-pathen som
   * fortsatt slipper igjennom er SESSION_TIMED_OUT — det er den korrekte
   * feilkoden klienten skal se ved 30-min inactivity-timeout.
   */
  async touchActivity(accessToken: string): Promise<void> {
    const token = accessToken.trim();
    if (!token) return;
    const tokenHash = hashToken(token);

    let result;
    try {
      result = await this.pool.query<{
        id: string;
        last_activity_at: Date | string;
        revoked_at: Date | string | null;
      }>(
        `SELECT id, last_activity_at, revoked_at
         FROM "${this.schema}"."app_sessions"
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
    } catch (err) {
      // BIN-824: SELECT kan feile hvis schema mangler kolonner som
      // last_activity_at (eks. fresh test-schema som kun har kjørt
      // ensureInitialized og ikke pg-migrations). Soft-fail — log warn og
      // la getUserFromAccessToken senere validere tokenet.
      logger.warn(
        { err, tokenPrefix: token.slice(0, 8) },
        "[BIN-824] session.touchActivity SELECT failed — soft-fail"
      );
      return;
    }

    const row = result.rows[0];
    if (!row || row.revoked_at) {
      // Sesjonen finnes ikke eller er allerede revoked — gå videre.
      // getUserFromAccessToken vil uansett kaste UNAUTHORIZED.
      return;
    }

    const lastActivityMs =
      typeof row.last_activity_at === "string"
        ? new Date(row.last_activity_at).getTime()
        : row.last_activity_at.getTime();
    const now = Date.now();
    const idleMs = now - lastActivityMs;

    if (idleMs >= this.inactivityTimeoutMs) {
      // Inactivity-timeout — revoker. SESSION_TIMED_OUT propageres med
      // vilje (klient må logge inn på nytt).
      try {
        await this.pool.query(
          `UPDATE "${this.schema}"."app_sessions"
           SET revoked_at = now()
           WHERE id = $1 AND revoked_at IS NULL`,
          [row.id]
        );
      } catch (err) {
        logger.warn(
          { err, sessionId: row.id },
          "[BIN-824] session.touchActivity revoke-update failed — propagating SESSION_TIMED_OUT anyway"
        );
      }
      logger.info(
        { sessionId: row.id, idleMs },
        "[REQ-132] session revoked due to inactivity timeout"
      );
      throw new DomainError(
        "SESSION_TIMED_OUT",
        "Sesjonen utløp pga. inaktivitet. Logg inn på nytt."
      );
    }

    if (idleMs >= TOUCH_THROTTLE_MS) {
      try {
        await this.pool.query(
          `UPDATE "${this.schema}"."app_sessions"
           SET last_activity_at = now()
           WHERE id = $1`,
          [row.id]
        );
      } catch (err) {
        // BIN-824: throttle-update er beste-effort. Hvis den feiler får
        // tokenet bare tikke fortere senere — ingen funksjonell impact.
        logger.warn(
          { err, sessionId: row.id },
          "[BIN-824] session.touchActivity throttle-update failed — soft-fail"
        );
      }
    }
  }

  /**
   * List alle aktive sesjoner for en bruker (revoked_at IS NULL og
   * expires_at > now()). Den nåværende sesjonen markeres med isCurrent.
   */
  async listActiveSessions(input: {
    userId: string;
    currentAccessToken?: string | null;
  }): Promise<ActiveSession[]> {
    const userId = input.userId.trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const currentTokenHash = input.currentAccessToken
      ? hashToken(input.currentAccessToken.trim())
      : null;

    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      device_user_agent: string | null;
      ip_address: string | null;
      last_activity_at: Date | string;
      created_at: Date | string;
      expires_at: Date | string;
      token_hash: string;
    }>(
      `SELECT id, user_id, device_user_agent, ip_address, last_activity_at,
              created_at, expires_at, token_hash
       FROM "${this.schema}"."app_sessions"
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND expires_at > now()
       ORDER BY last_activity_at DESC`,
      [userId]
    );

    return rows.map<ActiveSession>((row) => ({
      id: row.id,
      userId: row.user_id,
      deviceUserAgent: row.device_user_agent,
      ipAddress: row.ip_address,
      lastActivityAt: asIso(row.last_activity_at),
      createdAt: asIso(row.created_at),
      expiresAt: asIso(row.expires_at),
      isCurrent: currentTokenHash !== null && row.token_hash === currentTokenHash,
    }));
  }

  /**
   * Logg ut en spesifikk sesjon. Bruker må eie sesjonen — kaster
   * SESSION_NOT_FOUND hvis ikke.
   */
  async logoutSession(input: { userId: string; sessionId: string }): Promise<void> {
    const userId = input.userId.trim();
    const sessionId = input.sessionId.trim();
    if (!userId || !sessionId) {
      throw new DomainError("INVALID_INPUT", "userId og sessionId er påkrevd.");
    }
    const result = await this.pool.query(
      `UPDATE "${this.schema}"."app_sessions"
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId]
    );
    if (!result.rowCount) {
      throw new DomainError("SESSION_NOT_FOUND", "Sesjonen finnes ikke eller er allerede logget ut.");
    }
  }

  /**
   * Logg ut alle sesjoner for en bruker. Returnerer antall som ble
   * revoked. Hvis exceptAccessToken er satt, beholdes den sesjonen
   * (vanlig pattern: "log me out everywhere except here").
   */
  async logoutAll(input: { userId: string; exceptAccessToken?: string | null }): Promise<{ count: number }> {
    const userId = input.userId.trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    if (input.exceptAccessToken) {
      const exceptHash = hashToken(input.exceptAccessToken.trim());
      const result = await this.pool.query(
        `UPDATE "${this.schema}"."app_sessions"
         SET revoked_at = now()
         WHERE user_id = $1
           AND revoked_at IS NULL
           AND token_hash <> $2`,
        [userId, exceptHash]
      );
      return { count: result.rowCount ?? 0 };
    }
    const result = await this.pool.query(
      `UPDATE "${this.schema}"."app_sessions"
       SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    return { count: result.rowCount ?? 0 };
  }

  /** Lukk pool hvis vi eier den. Brukes i test-tear-down. */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
