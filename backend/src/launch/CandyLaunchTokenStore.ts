import { randomBytes } from "node:crypto";

export interface CandyLaunchIssueInput {
  accessToken: string;
  hallId: string;
  playerName: string;
  walletId: string;
  apiBaseUrl: string;
}

export interface CandyLaunchIssueResult {
  launchToken: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CandyLaunchResolvePayload {
  accessToken: string;
  hallId: string;
  playerName: string;
  walletId: string;
  apiBaseUrl: string;
  issuedAt: string;
  expiresAt: string;
}

interface StoredLaunchToken extends CandyLaunchResolvePayload {
  expiresAtMs: number;
}

interface CandyLaunchTokenStoreOptions {
  ttlMs: number;
  now?: () => number;
}

export class CandyLaunchTokenStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly tokens = new Map<string, StoredLaunchToken>();

  constructor(options: CandyLaunchTokenStoreOptions) {
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs));
    this.now = options.now ?? Date.now;
  }

  issue(input: CandyLaunchIssueInput): CandyLaunchIssueResult {
    const nowMs = this.now();
    this.cleanupExpired(nowMs);

    let launchToken = "";
    do {
      launchToken = randomBytes(24).toString("base64url");
    } while (this.tokens.has(launchToken));

    const issuedAtMs = nowMs;
    const expiresAtMs = issuedAtMs + this.ttlMs;
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();

    this.tokens.set(launchToken, {
      accessToken: input.accessToken,
      hallId: input.hallId,
      playerName: input.playerName,
      walletId: input.walletId,
      apiBaseUrl: input.apiBaseUrl,
      issuedAt,
      expiresAt,
      expiresAtMs
    });

    return {
      launchToken,
      issuedAt,
      expiresAt
    };
  }

  consume(rawLaunchToken: string): CandyLaunchResolvePayload | null {
    const launchToken = (rawLaunchToken ?? "").trim();
    if (!launchToken) {
      return null;
    }

    const nowMs = this.now();
    this.cleanupExpired(nowMs);

    const stored = this.tokens.get(launchToken);
    if (!stored) {
      return null;
    }

    this.tokens.delete(launchToken);
    if (stored.expiresAtMs <= nowMs) {
      return null;
    }

    return {
      accessToken: stored.accessToken,
      hallId: stored.hallId,
      playerName: stored.playerName,
      walletId: stored.walletId,
      apiBaseUrl: stored.apiBaseUrl,
      issuedAt: stored.issuedAt,
      expiresAt: stored.expiresAt
    };
  }

  private cleanupExpired(nowMs: number): void {
    for (const [token, stored] of this.tokens.entries()) {
      if (stored.expiresAtMs <= nowMs) {
        this.tokens.delete(token);
      }
    }
  }
}
