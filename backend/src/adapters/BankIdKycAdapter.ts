/**
 * BIN-274: BankID KYC adapter using OpenID Connect (OIDC) flow.
 *
 * Works with providers that expose a standard OIDC interface for Norwegian BankID:
 *   - Criipto (https://criipto.com)
 *   - Signicat (https://signicat.com)
 *   - BankID BankAxept (https://bankid.no)
 *
 * Flow:
 *   1. Frontend calls POST /api/auth/bankid/init → returns authUrl
 *   2. User authenticates via BankID in browser
 *   3. BankID provider redirects to BANKID_REDIRECT_URI with ?code=...
 *   4. Backend exchanges code for ID token → extracts birthdate + PID
 *   5. verify() is called with the extracted data → returns VERIFIED/REJECTED
 */

import { randomUUID } from "node:crypto";
import type { KycAdapter, VerifyKycInput, VerifyKycResult } from "./KycAdapter.js";

export interface BankIdConfig {
  /** OIDC client ID from provider */
  clientId: string;
  /** OIDC client secret from provider */
  clientSecret: string;
  /** OIDC authority/issuer URL (e.g. https://login.bankid.no or https://your-tenant.criipto.id) */
  authority: string;
  /** Redirect URI registered with provider */
  redirectUri: string;
  /** Minimum age in years (default 18) */
  minAgeYears?: number;
}

interface OidcTokenResponse {
  id_token: string;
  access_token?: string;
  token_type: string;
  expires_in?: number;
}

interface BankIdClaims {
  sub: string;
  /** Norwegian national identity number (11 digits) */
  pid?: string;
  /** Birth date in ISO format */
  birthdate?: string;
  /** Full name from BankID certificate */
  name?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

// In-memory pending sessions (production: use Redis via session store)
const pendingSessions = new Map<string, { userId: string; state: string; nonce: string; createdAt: number }>();

export class BankIdKycAdapter implements KycAdapter {
  private readonly config: BankIdConfig;
  private readonly minAgeYears: number;

  constructor(config: BankIdConfig) {
    if (!config.clientId || !config.clientSecret || !config.authority || !config.redirectUri) {
      throw new Error("BankID adapter requires clientId, clientSecret, authority, and redirectUri");
    }
    this.config = config;
    this.minAgeYears = Math.max(18, config.minAgeYears ?? 18);
  }

  /**
   * Create an authorization URL for the user to authenticate via BankID.
   * Returns the URL and a session ID to track the flow.
   */
  createAuthSession(userId: string): { sessionId: string; authUrl: string } {
    const sessionId = `bankid-${randomUUID()}`;
    const state = randomUUID();
    const nonce = randomUUID();

    pendingSessions.set(sessionId, { userId, state, nonce, createdAt: Date.now() });

    // Cleanup old sessions (>15 min)
    const cutoff = Date.now() - 15 * 60_000;
    for (const [id, session] of pendingSessions) {
      if (session.createdAt < cutoff) pendingSessions.delete(id);
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: "openid",
      state,
      nonce,
      // BankID-specific: request Norwegian BankID
      acr_values: "urn:grn:authn:no:bankid",
    });

    const authUrl = `${this.config.authority}/authorize?${params.toString()}`;
    return { sessionId, authUrl };
  }

  /**
   * Exchange the authorization code from the callback for an ID token.
   * Validates the session state and extracts identity claims.
   */
  async handleCallback(sessionId: string, code: string, returnedState: string): Promise<{
    userId: string;
    birthDate: string | null;
    nationalId: string | null;
    name: string | null;
  }> {
    const session = pendingSessions.get(sessionId);
    if (!session) throw new Error("Ukjent BankID-sesjon");
    if (session.state !== returnedState) throw new Error("BankID state mismatch — mulig CSRF");

    pendingSessions.delete(sessionId);

    // Exchange code for tokens
    const tokenResponse = await fetch(`${this.config.authority}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`BankID token exchange feilet: ${tokenResponse.status} ${body}`);
    }

    const tokens: OidcTokenResponse = await tokenResponse.json() as OidcTokenResponse;

    // Decode ID token (provider-signed — in production, verify signature against JWKS)
    const claims = this.decodeIdToken(tokens.id_token);

    return {
      userId: session.userId,
      birthDate: claims.birthdate ?? null,
      nationalId: claims.pid ?? null,
      name: claims.name ?? null,
    };
  }

  /**
   * Verify KYC based on BankID-extracted data.
   * Called by PlatformService.submitKycVerification() after callback processing.
   */
  async verify(input: VerifyKycInput): Promise<VerifyKycResult> {
    const now = new Date();
    const providerRef = `bankid-${randomUUID()}`;

    if (!input.birthDate) {
      return {
        decision: "REJECTED",
        providerReference: providerRef,
        checkedAt: now.toISOString(),
        reason: "MISSING_BIRTH_DATE",
      };
    }

    const birthDate = new Date(input.birthDate);
    if (Number.isNaN(birthDate.getTime())) {
      return {
        decision: "REJECTED",
        providerReference: providerRef,
        checkedAt: now.toISOString(),
        reason: "INVALID_BIRTH_DATE",
      };
    }

    const age = this.calculateAge(birthDate, now);
    if (age < this.minAgeYears) {
      return {
        decision: "REJECTED",
        providerReference: providerRef,
        checkedAt: now.toISOString(),
        reason: "UNDERAGE",
      };
    }

    return {
      decision: "VERIFIED",
      providerReference: providerRef,
      checkedAt: now.toISOString(),
    };
  }

  private calculateAge(birthDate: Date, now: Date): number {
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
    const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
    return age;
  }

  private decodeIdToken(idToken: string): BankIdClaims {
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("Ugyldig ID-token format");
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as BankIdClaims;
  }
}
