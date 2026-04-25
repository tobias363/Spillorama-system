/**
 * GAP #35 — Pre-action password-verify-token (legacy `common.js:408`
 * `VerifyPassword`-socket-event-paritet).
 *
 * Sensitive handlinger (self-exclusion, withdraw-request, senking av
 * loss-limits, m.fl.) skal kreve at brukeren bekrefter passordet sitt rett
 * før handlingen utføres — ikke bare et gyldig session-token.
 *
 * Flyt:
 *   1. Klient kaller `POST /api/auth/verify-password { password }`.
 *   2. Backend validerer passord; ved suksess utstedes et kort-levd token
 *      (default 5 min TTL) bundet til bruker-id-en.
 *   3. Klient inkluderer tokenet i header `X-Verify-Token` på neste sensitive
 *      POST/PUT.
 *   4. `requireVerifyToken`-middleware konsumerer tokenet (single-use →
 *      replay-protected) før handler kjører. Hvis tokenet mangler/ugyldig,
 *      returneres 403 `VERIFY_TOKEN_REQUIRED`.
 *
 * In-memory by design:
 *   Tokenet har 5-min TTL og skal ikke overleve server-restart (force re-
 *   prompt er trygt). Ingen DB-tabell — vi unngår skriv-belastning på en
 *   handling som er hyppig i UI-flyt. Multi-instans deployments deler ikke
 *   token-cache — hver instans har sitt eget store. Sticky-session via
 *   eksisterende access-token-distribusjon er nok for prod (samme bruker
 *   havner typisk på samme instans innenfor ett 5-min-vindu); hvis ikke
 *   fail-closed → klient re-promter om passord.
 *
 * Sikkerhet:
 *   - Klartekst-token returneres KUN ved create. Lagres aldri (sha256-hash
 *     i memory).
 *   - Single-use: consume() flagger row.usedAt; replay → 401 TOKEN_ALREADY_USED.
 *   - Auto-GC av utløpte rows for å unngå minnelekkasje.
 */

import { randomBytes, createHash } from "node:crypto";
import { DomainError } from "../game/BingoEngine.js";

export const DEFAULT_VERIFY_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 min
const GC_INTERVAL_MS = 60_000; // 1 min — sjelden nok, billig nok

interface VerifyTokenRow {
  userId: string;
  expiresAtMs: number;
  usedAt: number | null;
}

export interface VerifyTokenServiceOptions {
  /** TTL for verify-tokens. Default 5 min. */
  ttlMs?: number;
  /** Override for tester (deterministisk now()). */
  now?: () => number;
}

export interface CreateVerifyTokenResult {
  /** Klartekst-tokenet — skal kun videreformidles via secure response til klient. */
  token: string;
  expiresAt: string;
  expiresAtMs: number;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class VerifyTokenService {
  private readonly store = new Map<string, VerifyTokenRow>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: VerifyTokenServiceOptions = {}) {
    const ttl = options.ttlMs ?? DEFAULT_VERIFY_TOKEN_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new DomainError("INVALID_CONFIG", "ttlMs må være et positivt tall.");
    }
    this.ttlMs = ttl;
    this.now = options.now ?? Date.now;
  }

  /**
   * Start periodisk GC av utløpte tokens. Idempotent — ingen GC starter
   * hvis allerede aktiv. Bruk `stop()` ved test-tear-down for å unngå
   * lekket timer.
   */
  start(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    if (this.gcTimer.unref) this.gcTimer.unref();
  }

  stop(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /** Eksponert for tester — kjør GC manuelt. */
  gc(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [hash, row] of this.store) {
      if (row.expiresAtMs <= nowMs || row.usedAt !== null) {
        this.store.delete(hash);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Opprett nytt verify-token for `userId`. Tidligere aktive tokens for
   * samme userId invalideres (én verify-flyt om gangen per bruker).
   */
  create(userId: string): CreateVerifyTokenResult {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new DomainError("INVALID_INPUT", "userId mangler.");
    }
    // Invalidér eksisterende aktive tokens for samme bruker — ny verify-
    // flyt overrider gammel (samme mønster som AuthTokenService.createToken).
    for (const [hash, row] of this.store) {
      if (row.userId === userId && row.usedAt === null) {
        this.store.delete(hash);
      }
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(token);
    const nowMs = this.now();
    const expiresAtMs = nowMs + this.ttlMs;
    this.store.set(tokenHash, {
      userId: userId.trim(),
      expiresAtMs,
      usedAt: null,
    });
    return {
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
  }

  /**
   * Validér tokenet uten å konsumere det. Throws DomainError ved
   * ukjent/utløpt/brukt token. Returnerer userId.
   */
  validate(token: string): { userId: string } {
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new DomainError("VERIFY_TOKEN_REQUIRED", "Mangler verify-token.");
    }
    const hash = sha256Hex(token);
    const row = this.store.get(hash);
    if (!row) {
      throw new DomainError("VERIFY_TOKEN_INVALID", "Ukjent eller ugyldig verify-token.");
    }
    if (row.usedAt !== null) {
      throw new DomainError("VERIFY_TOKEN_ALREADY_USED", "Verify-token er allerede brukt.");
    }
    if (row.expiresAtMs <= this.now()) {
      // Rydd opp samtidig — utløpt token bør forsvinne.
      this.store.delete(hash);
      throw new DomainError("VERIFY_TOKEN_EXPIRED", "Verify-token er utløpt.");
    }
    return { userId: row.userId };
  }

  /**
   * Validér + konsumer atomisk. Single-use: token er ugyldig etter dette
   * kallet (replay-protected). Returnerer userId for autorisasjons-sjekk.
   */
  consume(token: string): { userId: string } {
    const { userId } = this.validate(token);
    const hash = sha256Hex(token);
    const row = this.store.get(hash);
    if (!row || row.usedAt !== null) {
      // Race-vinduet er smalt (single-threaded JS), men vær defensiv.
      throw new DomainError("VERIFY_TOKEN_ALREADY_USED", "Verify-token er allerede brukt.");
    }
    row.usedAt = this.now();
    // Token slettes ved neste GC; vi beholder rad'en så replay-forsøk får
    // riktig feilmelding (ALREADY_USED i stedet for INVALID).
    return { userId };
  }

  /** Test-hjelper — antall aktive (ubrukte + ikke-utløpte) tokens. */
  size(): number {
    const nowMs = this.now();
    let active = 0;
    for (const row of this.store.values()) {
      if (row.usedAt === null && row.expiresAtMs > nowMs) {
        active++;
      }
    }
    return active;
  }
}
