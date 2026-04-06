/**
 * Integration types for third-party provider embedding.
 *
 * These types define the contract between CandyWeb backend and an external
 * provider who embeds the game in an iframe and owns the player wallet.
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/** Identifies the external provider for multi-tenant support. */
export interface IntegrationProvider {
  /** Unique slug, e.g. "acme-bingo". Used in config keys and DB columns. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Base URL for the provider's wallet API. */
  walletApiBaseUrl: string;
  /** Domains allowed to embed CandyWeb (used for CSP / X-Frame-Options). */
  allowedOrigins: string[];
  /** Webhook URL for game result callbacks. */
  webhookUrl?: string;
  /** Shared HMAC secret for webhook signatures. */
  webhookSecret?: string;
}

// ---------------------------------------------------------------------------
// External player
// ---------------------------------------------------------------------------

/** Player identity as received from the provider during launch. */
export interface ExternalPlayer {
  /** The provider's unique player ID. */
  externalPlayerId: string;
  /** Session token from the provider (validated during launch). */
  externalSessionToken: string;
  /** Provider slug (matches IntegrationProvider.id). */
  provider: string;
}

/** Mapping stored in the database linking provider player to internal user. */
export interface ExternalPlayerMapping {
  /** Provider slug. */
  provider: string;
  /** The provider's player ID. */
  externalPlayerId: string;
  /** Our internal player ID (used everywhere in BingoEngine). */
  internalPlayerId: string;
  /** Our internal wallet account ID. */
  internalWalletId: string;
  /** ISO-8601 timestamp of first mapping. */
  createdAt: string;
  /** ISO-8601 timestamp of last launch. */
  lastSeenAt: string;
}

// ---------------------------------------------------------------------------
// Integration launch flow
// ---------------------------------------------------------------------------

/** POST /api/integration/launch — request body from the provider. */
export interface IntegrationLaunchRequest {
  /** Provider's session token proving the player is authenticated. */
  sessionToken: string;
  /** Provider's player ID. */
  playerId: string;
  /** ISO 4217 currency code (e.g. "NOK"). */
  currency?: string;
  /** UI language (BCP-47, e.g. "nb-NO"). */
  language?: string;
  /** URL to redirect to when the player exits the game. */
  returnUrl?: string;
}

/** POST /api/integration/launch — response body. */
export interface IntegrationLaunchResponse {
  /** Full URL to load in the iframe, includes launch token. */
  embedUrl: string;
  /** One-time launch token (consumed by frontend on load). */
  launchToken: string;
  /** ISO-8601 expiry for the launch token. */
  expiresAt: string;
  /** Internal player ID (for provider wallet mapping). */
  internalPlayerId?: string;
  /** Internal wallet account ID (for provider wallet mapping). */
  internalWalletId?: string;
}

// ---------------------------------------------------------------------------
// External wallet operations
// ---------------------------------------------------------------------------

/**
 * Request payload for debit/credit against the provider's wallet API.
 * Sent FROM our backend TO the provider.
 */
export interface ExternalWalletTransactionRequest {
  /** Provider's player ID. */
  playerId: string;
  /** Amount in the agreed currency unit. */
  amount: number;
  /** Unique transaction ID (for idempotency). */
  transactionId: string;
  /** Game round ID grouping related transactions. */
  roundId: string;
  /** ISO 4217 currency code. */
  currency: string;
}

/** Response from the provider's wallet API after debit/credit. */
export interface ExternalWalletTransactionResponse {
  /** Whether the operation succeeded. */
  success: boolean;
  /** Player's new balance after the operation. */
  balance: number;
  /** The transaction ID echoed back (must match request). */
  transactionId: string;
  /** Error code when success=false (e.g. "INSUFFICIENT_FUNDS"). */
  errorCode?: string;
  /** Human-readable error message. */
  errorMessage?: string;
}

/** Response from the provider's balance endpoint. */
export interface ExternalWalletBalanceResponse {
  /** Player's current balance. */
  balance: number;
  /** ISO 4217 currency code. */
  currency: string;
}

// ---------------------------------------------------------------------------
// Game result webhook (our backend → provider)
// ---------------------------------------------------------------------------

/** Webhook event types. */
export type GameWebhookEventType =
  | "game.completed"
  | "game.cancelled";

/** Webhook payload sent to provider after each completed game round. */
export interface GameResultWebhookPayload {
  /** Event type. */
  event: GameWebhookEventType;
  /** Our internal game ID. */
  gameId: string;
  /** Integration session ID (from launch). */
  sessionId: string;
  /** Provider's player ID. */
  playerId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Game result details. */
  result: GameResultDetails;
  /** HMAC-SHA256 signature of the payload (hex). */
  signature?: string;
}

export interface GameResultDetails {
  /** Entry fee charged (single debit amount). */
  entryFee: number;
  /** Total payout credited to the player. */
  totalPayout: number;
  /** Net result from the player's perspective (totalPayout - entryFee). */
  netResult: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Number of tickets played. */
  ticketsPlayed: number;
  /** Total numbers drawn in the round. */
  numbersDrawn: number;
  /** Won pattern names, if any. */
  patterns: string[];
}

// ---------------------------------------------------------------------------
// Compliance callbacks (our backend → provider)
// ---------------------------------------------------------------------------

export type ComplianceEventType =
  | "compliance.lossLimitReached"
  | "compliance.sessionLimitReached"
  | "compliance.selfExclusion"
  | "compliance.timedPause"
  | "compliance.breakEnded";

/** Compliance event sent to provider when responsible-gaming triggers fire. */
export interface ComplianceCallbackPayload {
  event: ComplianceEventType;
  /** Provider's player ID. */
  playerId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Event-specific details. */
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PostMessage protocol (iframe ↔ parent)
// ---------------------------------------------------------------------------

/** Messages from CandyWeb iframe → provider parent window. */
export type CandyToHostMessageType =
  | "candy:ready"
  | "candy:balanceChanged"
  | "candy:gameStarted"
  | "candy:gameEnded"
  | "candy:error"
  | "candy:resize";

export interface CandyToHostMessage {
  type: CandyToHostMessageType;
  payload: Record<string, unknown>;
}

/** Messages from provider parent window → CandyWeb iframe. */
export type HostToCandyMessageType =
  | "host:sessionExpiring"
  | "host:closeGame";

export interface HostToCandyMessage {
  type: HostToCandyMessageType;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Integration session
// ---------------------------------------------------------------------------

/** Tracks an active integration session on the backend. */
export interface IntegrationSession {
  /** Internal session ID. */
  id: string;
  /** Provider slug. */
  provider: string;
  /** Provider's player ID. */
  externalPlayerId: string;
  /** Our internal player ID. */
  internalPlayerId: string;
  /** Our internal wallet account ID. */
  internalWalletId: string;
  /** Provider's session token (for wallet API calls). */
  providerSessionToken: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** ISO-8601 session start. */
  createdAt: string;
  /** ISO-8601 last activity. */
  lastActivityAt: string;
  /** Whether the session is still active. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Standardised error codes for the integration API. */
export const IntegrationErrorCode = {
  INVALID_SESSION_TOKEN: "INVALID_SESSION_TOKEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
  PLAYER_NOT_FOUND: "PLAYER_NOT_FOUND",
  WALLET_UNAVAILABLE: "WALLET_UNAVAILABLE",
  WALLET_TIMEOUT: "WALLET_TIMEOUT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  INVALID_CURRENCY: "INVALID_CURRENCY",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  LAUNCH_TOKEN_INVALID: "LAUNCH_TOKEN_INVALID",
  LAUNCH_TOKEN_EXPIRED: "LAUNCH_TOKEN_EXPIRED",
  WEBHOOK_DELIVERY_FAILED: "WEBHOOK_DELIVERY_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type IntegrationErrorCode =
  (typeof IntegrationErrorCode)[keyof typeof IntegrationErrorCode];

// ---------------------------------------------------------------------------
// Environment configuration shape
// ---------------------------------------------------------------------------

/** Expected env vars when INTEGRATION_ENABLED=true + WALLET_PROVIDER=external. */
export interface IntegrationEnvConfig {
  INTEGRATION_ENABLED: boolean;
  WALLET_PROVIDER: "external";
  WALLET_API_BASE_URL: string;
  WALLET_API_KEY?: string;
  WALLET_API_TIMEOUT_MS: number;
  ALLOWED_EMBED_ORIGINS: string[];
  CORS_ALLOWED_ORIGINS: string[];
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
  LAUNCH_TOKEN_SECRET?: string;
  LAUNCH_TOKEN_EXPIRY_SECONDS: number;
}
