import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Pool } from "pg";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { CandyLaunchTokenStore } from "../launch/CandyLaunchTokenStore.js";
import { DomainError } from "../game/BingoEngine.js";
import type {
  IntegrationLaunchRequest,
  IntegrationLaunchResponse,
  ExternalPlayerMapping
} from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IntegrationLaunchHandlerOptions {
  /** PostgreSQL connection pool (same as PlatformService uses). */
  pool: Pool;
  /** DB schema. */
  schema?: string;
  /** Wallet adapter for creating player wallet accounts. */
  walletAdapter: WalletAdapter;
  /** Existing launch token store. */
  launchTokenStore: CandyLaunchTokenStore;
  /** API key that the provider must send in X-API-Key header. */
  providerApiKey: string;
  /** Default hall ID for integration players. */
  defaultHallId: string;
  /** Base URL for the CandyWeb frontend (used to build embed URL). */
  candyFrontendBaseUrl: string;
  /** Base URL for the CandyWeb backend API (passed to the frontend via launch token). */
  candyApiBaseUrl: string;
  /** Default initial balance for external wallet accounts. */
  defaultInitialBalance?: number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class IntegrationLaunchHandler {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly walletAdapter: WalletAdapter;
  private readonly launchTokenStore: CandyLaunchTokenStore;
  private readonly providerApiKey: string;
  private readonly defaultHallId: string;
  private readonly candyFrontendBaseUrl: string;
  private readonly candyApiBaseUrl: string;
  private readonly defaultInitialBalance: number;
  private initialized = false;

  constructor(options: IntegrationLaunchHandlerOptions) {
    this.pool = options.pool;
    this.schema = options.schema ?? "public";
    this.walletAdapter = options.walletAdapter;
    this.launchTokenStore = options.launchTokenStore;
    this.providerApiKey = options.providerApiKey;
    this.defaultHallId = options.defaultHallId;
    this.candyFrontendBaseUrl = options.candyFrontendBaseUrl.replace(/\/+$/, "");
    this.candyApiBaseUrl = options.candyApiBaseUrl.replace(/\/+$/, "");
    this.defaultInitialBalance = options.defaultInitialBalance ?? 0;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Validate the provider API key from the request header.
   * Call this before `launch()`.
   */
  validateApiKey(apiKey: string | undefined): void {
    if (!apiKey || apiKey !== this.providerApiKey) {
      throw new DomainError("UNAUTHORIZED", "Ugyldig eller manglende API-nøkkel.");
    }
  }

  /**
   * Handle a launch request from the provider.
   *
   * 1. Validates input
   * 2. Finds or creates the internal player mapping
   * 3. Creates an internal access token (session)
   * 4. Issues a launch token
   * 5. Returns the embed URL
   */
  async launch(request: IntegrationLaunchRequest): Promise<IntegrationLaunchResponse> {
    await this.ensureInitialized();

    const sessionToken = this.mustBeNonEmpty(request.sessionToken, "sessionToken");
    const externalPlayerId = this.mustBeNonEmpty(request.playerId, "playerId");
    const provider = "default"; // Multi-tenant: could come from request or API key lookup

    // Find or create the internal player mapping.
    const mapping = await this.findOrCreateMapping(provider, externalPlayerId, sessionToken);

    // Ensure the wallet account exists.
    await this.walletAdapter.ensureAccount(mapping.internalWalletId);

    // Create an internal access token (session).
    const accessToken = await this.createInternalSession(mapping.internalPlayerId);

    // Issue a launch token.
    const issued = this.launchTokenStore.issue({
      accessToken,
      hallId: this.defaultHallId,
      playerName: `Player-${externalPlayerId.slice(0, 8)}`,
      walletId: mapping.internalWalletId,
      apiBaseUrl: this.candyApiBaseUrl
    });

    // Build the embed URL.
    const embedUrl = `${this.candyFrontendBaseUrl}?lt=${encodeURIComponent(issued.launchToken)}&embed=true`;

    return {
      embedUrl,
      launchToken: issued.launchToken,
      expiresAt: issued.expiresAt
    };
  }

  // -----------------------------------------------------------------------
  // Session lifecycle (BIN-29)
  // -----------------------------------------------------------------------

  /**
   * Kill an integration session by revoking it. Called by the provider
   * when they want to force-end a player's session.
   */
  async killSession(externalPlayerId: string, provider: string = "default"): Promise<{ revoked: number }> {
    await this.ensureInitialized();

    // Find internal player ID from mapping.
    const { rows } = await this.pool.query<{ internal_player_id: string }>(
      `SELECT internal_player_id FROM ${this.mappingTable()}
       WHERE provider = $1 AND external_player_id = $2`,
      [provider, externalPlayerId]
    );
    if (!rows[0]) {
      throw new DomainError("NOT_FOUND", "Ingen spillerkobling funnet for denne spilleren.");
    }

    // Revoke all active sessions for this internal player.
    const result = await this.pool.query(
      `UPDATE ${this.sessionsTable()}
       SET revoked_at = now()
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [rows[0].internal_player_id]
    );

    return { revoked: result.rowCount ?? 0 };
  }

  /**
   * Refresh/extend a session for an integration player.
   * Provider calls this to keep the session alive.
   */
  async refreshSession(
    externalPlayerId: string,
    extensionMinutes: number = 60,
    provider: string = "default"
  ): Promise<{ expiresAt: string }> {
    await this.ensureInitialized();

    const { rows } = await this.pool.query<{ internal_player_id: string }>(
      `SELECT internal_player_id FROM ${this.mappingTable()}
       WHERE provider = $1 AND external_player_id = $2`,
      [provider, externalPlayerId]
    );
    if (!rows[0]) {
      throw new DomainError("NOT_FOUND", "Ingen spillerkobling funnet for denne spilleren.");
    }

    const newExpiry = new Date(Date.now() + extensionMinutes * 60 * 1000).toISOString();

    const result = await this.pool.query(
      `UPDATE ${this.sessionsTable()}
       SET expires_at = $1
       WHERE user_id = $2
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [newExpiry, rows[0].internal_player_id]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new DomainError("NOT_FOUND", "Ingen aktiv sesjon funnet for denne spilleren.");
    }

    return { expiresAt: newExpiry };
  }

  /**
   * List active integration sessions (admin).
   */
  async listActiveSessions(options?: { limit?: number; offset?: number }): Promise<{
    sessions: IntegrationSessionInfo[];
    total: number;
  }> {
    await this.ensureInitialized();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const { rows: countRows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM ${this.sessionsTable()} s
       JOIN ${this.mappingTable()} m ON m.internal_player_id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > now()`
    );
    const total = parseInt(countRows[0]?.count ?? "0", 10);

    const { rows } = await this.pool.query<IntegrationSessionRow>(
      `SELECT m.provider, m.external_player_id, m.internal_player_id,
              s.id AS session_id, s.created_at AS session_created_at, s.expires_at
       FROM ${this.sessionsTable()} s
       JOIN ${this.mappingTable()} m ON m.internal_player_id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > now()
       ORDER BY s.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      sessions: rows.map((r) => ({
        provider: r.provider,
        externalPlayerId: r.external_player_id,
        internalPlayerId: r.internal_player_id,
        sessionId: r.session_id,
        sessionCreatedAt: r.session_created_at,
        expiresAt: r.expires_at
      })),
      total
    };
  }

  // -----------------------------------------------------------------------
  // Admin queries
  // -----------------------------------------------------------------------

  /**
   * List all external player mappings, newest first.
   */
  async listMappings(options?: { limit?: number; offset?: number; provider?: string }): Promise<{
    mappings: ExternalPlayerMapping[];
    total: number;
  }> {
    await this.ensureInitialized();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const provider = options?.provider;

    const whereClause = provider ? "WHERE provider = $1" : "";
    const countParams = provider ? [provider] : [];
    const listParams: (string | number)[] = provider
      ? [provider, limit, offset]
      : [limit, offset];

    const { rows: countRows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${this.mappingTable()} ${whereClause}`,
      countParams
    );
    const total = parseInt(countRows[0]?.count ?? "0", 10);

    const paramOffset = provider ? 1 : 0;
    const { rows } = await this.pool.query<ExternalPlayerMappingRow>(
      `SELECT provider, external_player_id, internal_player_id, internal_wallet_id, created_at, last_seen_at
       FROM ${this.mappingTable()}
       ${whereClause}
       ORDER BY last_seen_at DESC
       LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`,
      listParams
    );

    return {
      mappings: rows.map((r) => this.mapRow(r)),
      total
    };
  }

  /**
   * Get a single mapping by provider + external player ID.
   */
  async getMapping(provider: string, externalPlayerId: string): Promise<ExternalPlayerMapping | null> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<ExternalPlayerMappingRow>(
      `SELECT provider, external_player_id, internal_player_id, internal_wallet_id, created_at, last_seen_at
       FROM ${this.mappingTable()}
       WHERE provider = $1 AND external_player_id = $2`,
      [provider, externalPlayerId]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  // -----------------------------------------------------------------------
  // Player mapping
  // -----------------------------------------------------------------------

  private async findOrCreateMapping(
    provider: string,
    externalPlayerId: string,
    sessionToken: string
  ): Promise<ExternalPlayerMapping> {
    const now = new Date().toISOString();

    // Try to find existing mapping.
    const { rows: existingRows } = await this.pool.query<ExternalPlayerMappingRow>(
      `SELECT provider, external_player_id, internal_player_id, internal_wallet_id, created_at, last_seen_at
       FROM ${this.mappingTable()}
       WHERE provider = $1 AND external_player_id = $2`,
      [provider, externalPlayerId]
    );

    if (existingRows[0]) {
      // Update last_seen_at.
      await this.pool.query(
        `UPDATE ${this.mappingTable()}
         SET last_seen_at = $1
         WHERE provider = $2 AND external_player_id = $3`,
        [now, provider, externalPlayerId]
      );
      return this.mapRow(existingRows[0], now);
    }

    // Create new internal player + mapping.
    const internalPlayerId = randomUUID();
    const internalWalletId = `wallet-ext-${provider}-${internalPlayerId}`;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Create user in the platform users table.
      const email = `ext-${provider}-${externalPlayerId}@integration.local`;
      const placeholderHash = `integration-no-password-${randomBytes(16).toString("hex")}`;
      await client.query(
        `INSERT INTO ${this.usersTable()}
          (id, email, display_name, password_hash, wallet_id, role)
         VALUES ($1, $2, $3, $4, $5, 'PLAYER')
         ON CONFLICT (email) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [internalPlayerId, email, `Player-${externalPlayerId.slice(0, 8)}`, placeholderHash, internalWalletId]
      );

      // Create the mapping.
      await client.query(
        `INSERT INTO ${this.mappingTable()}
          (provider, external_player_id, internal_player_id, internal_wallet_id, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [provider, externalPlayerId, internalPlayerId, internalWalletId, now]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      provider,
      externalPlayerId,
      internalPlayerId,
      internalWalletId,
      createdAt: now,
      lastSeenAt: now
    };
  }

  // -----------------------------------------------------------------------
  // Internal session
  // -----------------------------------------------------------------------

  private async createInternalSession(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
    await this.pool.query(
      `INSERT INTO ${this.sessionsTable()} (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, tokenHash, expiresAt]
    );
    return rawToken;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  // -----------------------------------------------------------------------
  // DB initialization
  // -----------------------------------------------------------------------

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // BIN-125: Create integration tables idempotently
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${this.schema}".integration_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        wallet_api_base_url TEXT,
        wallet_api_key_encrypted TEXT,
        allowed_origins TEXT[] DEFAULT '{}',
        webhook_url TEXT,
        webhook_secret_encrypted TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.mappingTable()} (
        provider TEXT NOT NULL,
        external_player_id TEXT NOT NULL,
        internal_player_id TEXT NOT NULL,
        internal_wallet_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, external_player_id)
      )`
    );

    // BIN-125: Wallet transaction audit log for integration providers
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${this.schema}".integration_wallet_tx_log (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        transaction_id TEXT NOT NULL UNIQUE,
        external_player_id TEXT NOT NULL,
        round_id TEXT,
        tx_type TEXT NOT NULL CHECK (tx_type IN ('debit', 'credit', 'balance')),
        amount NUMERIC(12,2),
        currency TEXT NOT NULL DEFAULT 'NOK',
        status TEXT NOT NULL,
        response_time_ms INTEGER,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_iwtl_provider_player
        ON "${this.schema}".integration_wallet_tx_log (provider, external_player_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_iwtl_created_at
        ON "${this.schema}".integration_wallet_tx_log (created_at)
    `);

    this.initialized = true;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private mustBeNonEmpty(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
    }
    return value.trim();
  }

  private mapRow(row: ExternalPlayerMappingRow, lastSeenAt?: string): ExternalPlayerMapping {
    return {
      provider: row.provider,
      externalPlayerId: row.external_player_id,
      internalPlayerId: row.internal_player_id,
      internalWalletId: row.internal_wallet_id,
      createdAt: row.created_at,
      lastSeenAt: lastSeenAt ?? row.last_seen_at
    };
  }

  private mappingTable(): string {
    return `"${this.schema}".external_player_mapping`;
  }

  private usersTable(): string {
    return `"${this.schema}"."app_users"`;
  }

  private sessionsTable(): string {
    return `"${this.schema}"."app_sessions"`;
  }
}

// ---------------------------------------------------------------------------
// Internal DB row type
// ---------------------------------------------------------------------------

interface ExternalPlayerMappingRow {
  provider: string;
  external_player_id: string;
  internal_player_id: string;
  internal_wallet_id: string;
  created_at: string;
  last_seen_at: string;
}

interface IntegrationSessionRow {
  provider: string;
  external_player_id: string;
  internal_player_id: string;
  session_id: string;
  session_created_at: string;
  expires_at: string;
}

export interface IntegrationSessionInfo {
  provider: string;
  externalPlayerId: string;
  internalPlayerId: string;
  sessionId: string;
  sessionCreatedAt: string;
  expiresAt: string;
}
