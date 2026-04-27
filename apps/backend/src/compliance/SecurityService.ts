/**
 * BIN-587 B3-security: sikkerhets-admin (withdraw-email-allowlist,
 * risk-countries, blocked-IPs).
 *
 * Blocked-IPs har en in-memory cache med 5-min TTL. Cache lastes ved
 * service-start og refreshes lazily — når `isIpBlocked()` kalles og
 * cachen er utløpt, re-fetches listen fra DB. Dette balanserer ferskhet
 * mot performance (middleware'en spørrer på hver request).
 *
 * Utløpte blocked-IP-rader (`expires_at <= now()`) filtreres ut både i
 * DB-query og i cache-lookup, så en bevisst tidsbestemt blokkering
 * frigjøres automatisk.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "security-service" });

const BLOCKED_IP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min per PM-avklaring

export interface WithdrawEmail {
  id: string;
  email: string;
  label: string | null;
  addedBy: string | null;
  createdAt: string;
}

export interface RiskCountry {
  countryCode: string;
  label: string;
  reason: string | null;
  addedBy: string | null;
  createdAt: string;
}

export interface BlockedIp {
  id: string;
  ipAddress: string;
  reason: string | null;
  blockedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface SecurityServiceOptions {
  connectionString: string;
  schema?: string;
  /** Overstyres i tester. */
  nowMs?: () => number;
  /** Overstyres i tester for å kontrollere cache-alder. */
  cacheTtlMs?: number;
  /**
   * PR #513 §2.5: Pilot-mode fail-fast.
   * Når `true` kaster `initializeSchema`-feil videre til caller (så server-
   * boot crasher med tydelig stack-trace) i stedet for å la
   * IP-blocking være no-op stille. I prod-pilot vil vi ha dette på.
   *
   * Default `false` for å ikke knekke eksisterende test-harnesses som
   * ikke har en ekte DB tilgjengelig.
   */
  pilotMode?: boolean;
  /**
   * PR #513 §2.5: Hook for at en helse-overvåker (Sentry / health-endpoint /
   * pager) skal få beskjed når sikkerhets-init feiler. Når den returnerer
   * (eller throwes), fortsetter SecurityService som før — caller bestemmer
   * om feil skal bobbles videre.
   *
   * Default: en CRITICAL-log via pino + ingen videre side-effekter.
   */
  onCriticalFailure?: (event: { code: string; err: unknown; context: string }) => void;
}

interface WithdrawEmailRow {
  id: string;
  email: string;
  label: string | null;
  added_by: string | null;
  created_at: Date | string;
}

interface RiskCountryRow {
  country_code: string;
  label: string;
  reason: string | null;
  added_by: string | null;
  created_at: Date | string;
}

interface BlockedIpRow {
  id: string;
  ip_address: string;
  reason: string | null;
  blocked_by: string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function normalizeEmail(input: unknown): string {
  if (typeof input !== "string") {
    throw new DomainError("INVALID_INPUT", "email må være en streng.");
  }
  const email = input.trim().toLowerCase();
  if (!email) {
    throw new DomainError("INVALID_INPUT", "email er påkrevd.");
  }
  if (email.length > 254) {
    throw new DomainError("INVALID_INPUT", "email er for lang (maks 254 tegn).");
  }
  // Enkel validering: må inneholde én @ med ting på begge sider.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DomainError("INVALID_INPUT", "email har ugyldig format.");
  }
  return email;
}

function normalizeCountryCode(input: unknown): string {
  if (typeof input !== "string") {
    throw new DomainError("INVALID_INPUT", "countryCode må være en streng.");
  }
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new DomainError("INVALID_INPUT", "countryCode må være en ISO-3166 alpha-2 kode (2 bokstaver).");
  }
  return code;
}

/**
 * PR #513 §2.5: default-handler for kritiske sikkerhets-init-feil.
 * Logger på `fatal`-nivå med en standard event-shape som ops/Sentry kan
 * grep-e etter (`event=security_service_init_failed`).
 *
 * Egne handlere (eks. Sentry-capture, Slack-poster) kan injiseres via
 * `onCriticalFailure` i constructor.
 */
function defaultCriticalFailureLogger(event: { code: string; err: unknown; context: string }): void {
  logger.fatal(
    {
      event: "security_service_init_failed",
      code: event.code,
      context: event.context,
      err: event.err,
    },
    `[CRITICAL] SecurityService.${event.context} feilet (${event.code}) — IP-block-sjekk fail-open uten alarm-aksjon`,
  );
}

function normalizeIpAddress(input: unknown): string {
  if (typeof input !== "string") {
    throw new DomainError("INVALID_INPUT", "ipAddress må være en streng.");
  }
  const ip = input.trim();
  if (!ip) {
    throw new DomainError("INVALID_INPUT", "ipAddress er påkrevd.");
  }
  // IPv4 eller IPv6 — enkel form-validering (stramt format-sjekk gjøres av Postgres).
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  if (!ipv4.test(ip) && !ipv6.test(ip)) {
    throw new DomainError("INVALID_INPUT", "ipAddress har ugyldig format.");
  }
  if (ip.length > 45) {
    throw new DomainError("INVALID_INPUT", "ipAddress er for lang.");
  }
  return ip;
}

export class SecurityService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly cacheTtlMs: number;
  private readonly nowMs: () => number;
  private readonly pilotMode: boolean;
  private readonly onCriticalFailure: (event: { code: string; err: unknown; context: string }) => void;
  private initPromise: Promise<void> | null = null;
  /**
   * PR #513 §2.5: Sett til `true` permanent når `initializeSchema()` har feilet.
   * Brukes av `isIpBlocked()` for å logge CRITICAL hver gang en request
   * passerer gjennom et fail-open IP-block-sjekk — slik at en stille
   * "alle slipper inn" ikke kan skjule seg i prod uten at noen merker det.
   */
  private initFailed = false;

  // Blocked-IP in-memory cache
  private blockedIpCache: Set<string> | null = null;
  private blockedIpCacheLoadedAt = 0;

  constructor(options: SecurityServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError("INVALID_CONFIG", "Mangler connection string for SecurityService.");
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.cacheTtlMs = options.cacheTtlMs ?? BLOCKED_IP_CACHE_TTL_MS;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.pilotMode = options.pilotMode === true;
    this.onCriticalFailure = options.onCriticalFailure ?? defaultCriticalFailureLogger;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, opts?: {
    schema?: string;
    cacheTtlMs?: number;
    nowMs?: () => number;
    pilotMode?: boolean;
    onCriticalFailure?: (event: { code: string; err: unknown; context: string }) => void;
  }): SecurityService {
    const svc = Object.create(SecurityService.prototype) as SecurityService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(opts?.schema ?? "public");
    (svc as unknown as { cacheTtlMs: number }).cacheTtlMs = opts?.cacheTtlMs ?? BLOCKED_IP_CACHE_TTL_MS;
    (svc as unknown as { nowMs: () => number }).nowMs = opts?.nowMs ?? (() => Date.now());
    (svc as unknown as { pilotMode: boolean }).pilotMode = opts?.pilotMode === true;
    (svc as unknown as { onCriticalFailure: (e: { code: string; err: unknown; context: string }) => void }).onCriticalFailure =
      opts?.onCriticalFailure ?? defaultCriticalFailureLogger;
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    (svc as unknown as { initFailed: boolean }).initFailed = false;
    (svc as unknown as { blockedIpCache: Set<string> | null }).blockedIpCache = null;
    (svc as unknown as { blockedIpCacheLoadedAt: number }).blockedIpCacheLoadedAt = 0;
    return svc;
  }

  private emailTable(): string { return `"${this.schema}"."app_withdraw_email_allowlist"`; }
  private countriesTable(): string { return `"${this.schema}"."app_risk_countries"`; }
  private ipsTable(): string { return `"${this.schema}"."app_blocked_ips"`; }

  // ── Withdraw email allowlist ────────────────────────────────────────────

  async listWithdrawEmails(): Promise<WithdrawEmail[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<WithdrawEmailRow>(
      `SELECT id, email, label, added_by, created_at
       FROM ${this.emailTable()}
       ORDER BY email ASC`
    );
    return rows.map((r) => ({
      id: r.id, email: r.email, label: r.label,
      addedBy: r.added_by, createdAt: asIso(r.created_at),
    }));
  }

  async addWithdrawEmail(input: { email: string; label?: string | null; addedBy: string }): Promise<WithdrawEmail> {
    await this.ensureInitialized();
    const email = normalizeEmail(input.email);
    const label = input.label ? input.label.trim().slice(0, 200) : null;
    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<WithdrawEmailRow>(
        `INSERT INTO ${this.emailTable()} (id, email, label, added_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, label, added_by, created_at`,
        [id, email, label, input.addedBy]
      );
      const r = rows[0]!;
      return { id: r.id, email: r.email, label: r.label, addedBy: r.added_by, createdAt: asIso(r.created_at) };
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg)) {
        throw new DomainError("WITHDRAW_EMAIL_EXISTS", "E-post finnes allerede i allowlist.");
      }
      throw err;
    }
  }

  async deleteWithdrawEmail(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!id || typeof id !== "string") throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${this.emailTable()} WHERE id = $1`,
      [id]
    );
    if (!rowCount) throw new DomainError("WITHDRAW_EMAIL_NOT_FOUND", "E-post finnes ikke.");
  }

  /**
   * GAP #21: Edit eksisterende withdraw-email (regnskaps-mottakere).
   *
   * Legacy: GET /withdraw/edit/emails/:id + POST. Vi tilbyr en idiomatisk
   * PUT-endepunkt som oppdaterer email og/eller label. Begge er valgfrie,
   * men minst én må være angitt.
   *
   * Returnerer den oppdaterte raden så kalleren kan reflektere endringen
   * tilbake i UI uten ekstra GET.
   */
  async updateWithdrawEmail(
    id: string,
    input: { email?: string | null; label?: string | null }
  ): Promise<WithdrawEmail> {
    await this.ensureInitialized();
    if (!id || typeof id !== "string") {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (input.email !== undefined && input.email !== null) {
      const normalizedEmail = normalizeEmail(input.email);
      values.push(normalizedEmail);
      updates.push(`email = $${values.length}`);
    }
    if (input.label !== undefined) {
      const label =
        input.label === null
          ? null
          : typeof input.label === "string"
          ? input.label.trim().slice(0, 200) || null
          : null;
      values.push(label);
      updates.push(`label = $${values.length}`);
    }
    if (updates.length === 0) {
      throw new DomainError("INVALID_INPUT", "Minst én av email eller label må angis.");
    }
    values.push(id);
    try {
      const { rows } = await this.pool.query<WithdrawEmailRow>(
        `UPDATE ${this.emailTable()}
         SET ${updates.join(", ")}
         WHERE id = $${values.length}
         RETURNING id, email, label, added_by, created_at`,
        values
      );
      const r = rows[0];
      if (!r) {
        throw new DomainError("WITHDRAW_EMAIL_NOT_FOUND", "E-post finnes ikke.");
      }
      return {
        id: r.id,
        email: r.email,
        label: r.label,
        addedBy: r.added_by,
        createdAt: asIso(r.created_at),
      };
    } catch (err) {
      if (err instanceof DomainError) throw err;
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg)) {
        throw new DomainError("WITHDRAW_EMAIL_EXISTS", "E-post finnes allerede i allowlist.");
      }
      throw err;
    }
  }

  // ── Risk countries ──────────────────────────────────────────────────────

  async listRiskCountries(): Promise<RiskCountry[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<RiskCountryRow>(
      `SELECT country_code, label, reason, added_by, created_at
       FROM ${this.countriesTable()}
       ORDER BY country_code ASC`
    );
    return rows.map((r) => ({
      countryCode: r.country_code, label: r.label, reason: r.reason,
      addedBy: r.added_by, createdAt: asIso(r.created_at),
    }));
  }

  async addRiskCountry(input: { countryCode: string; label: string; reason?: string | null; addedBy: string }): Promise<RiskCountry> {
    await this.ensureInitialized();
    const code = normalizeCountryCode(input.countryCode);
    const label = typeof input.label === "string" ? input.label.trim() : "";
    if (!label || label.length > 200) {
      throw new DomainError("INVALID_INPUT", "label er påkrevd (maks 200 tegn).");
    }
    const reason = input.reason ? input.reason.trim().slice(0, 500) : null;
    try {
      const { rows } = await this.pool.query<RiskCountryRow>(
        `INSERT INTO ${this.countriesTable()} (country_code, label, reason, added_by)
         VALUES ($1, $2, $3, $4)
         RETURNING country_code, label, reason, added_by, created_at`,
        [code, label, reason, input.addedBy]
      );
      const r = rows[0]!;
      return { countryCode: r.country_code, label: r.label, reason: r.reason, addedBy: r.added_by, createdAt: asIso(r.created_at) };
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique|primary/i.test(msg)) {
        throw new DomainError("RISK_COUNTRY_EXISTS", "Landekoden finnes allerede i risk-list.");
      }
      throw err;
    }
  }

  async removeRiskCountry(countryCode: string): Promise<void> {
    await this.ensureInitialized();
    const code = normalizeCountryCode(countryCode);
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${this.countriesTable()} WHERE country_code = $1`,
      [code]
    );
    if (!rowCount) throw new DomainError("RISK_COUNTRY_NOT_FOUND", "Landekoden finnes ikke i risk-list.");
  }

  // ── Blocked IPs ─────────────────────────────────────────────────────────

  async listBlockedIps(): Promise<BlockedIp[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<BlockedIpRow>(
      `SELECT id, ip_address, reason, blocked_by, expires_at, created_at
       FROM ${this.ipsTable()}
       ORDER BY created_at DESC`
    );
    return rows.map((r) => ({
      id: r.id, ipAddress: r.ip_address, reason: r.reason,
      blockedBy: r.blocked_by, expiresAt: asIsoOrNull(r.expires_at),
      createdAt: asIso(r.created_at),
    }));
  }

  async addBlockedIp(input: { ipAddress: string; reason?: string | null; expiresAt?: string | null; blockedBy: string }): Promise<BlockedIp> {
    await this.ensureInitialized();
    const ip = normalizeIpAddress(input.ipAddress);
    const reason = input.reason ? input.reason.trim().slice(0, 500) : null;
    const expiresAt = input.expiresAt?.trim() || null;
    if (expiresAt && isNaN(Date.parse(expiresAt))) {
      throw new DomainError("INVALID_INPUT", "expiresAt må være en ISO-timestamp.");
    }
    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<BlockedIpRow>(
        `INSERT INTO ${this.ipsTable()} (id, ip_address, reason, blocked_by, expires_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         RETURNING id, ip_address, reason, blocked_by, expires_at, created_at`,
        [id, ip, reason, input.blockedBy, expiresAt]
      );
      const r = rows[0]!;
      // Invalider cachen så neste sjekk ser den nye IP-en umiddelbart.
      this.invalidateBlockedIpCache();
      return {
        id: r.id, ipAddress: r.ip_address, reason: r.reason,
        blockedBy: r.blocked_by, expiresAt: asIsoOrNull(r.expires_at),
        createdAt: asIso(r.created_at),
      };
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg)) {
        throw new DomainError("BLOCKED_IP_EXISTS", "IP-adressen er allerede blokkert.");
      }
      throw err;
    }
  }

  async removeBlockedIp(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!id || typeof id !== "string") throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${this.ipsTable()} WHERE id = $1`,
      [id]
    );
    if (!rowCount) throw new DomainError("BLOCKED_IP_NOT_FOUND", "Blokkert IP finnes ikke.");
    this.invalidateBlockedIpCache();
  }

  /**
   * Sjekker om en IP-adresse er blokkert. Bruker in-memory cache med
   * 5-min TTL. Middleware må kalle denne på hver request, så cache er
   * kritisk for performance.
   *
   * PR #513 §2.5: hvis init-en har feilet (sjeldne pilot-edge-cases) emit-er
   * vi en CRITICAL-log per request slik at en stille fail-open ikke kan
   * skjule seg over tid. Throttling er bevisst utelatt — samples fanges av
   * pino-aggregator og vi vil heller ha bråk enn en silent "alle slipper inn".
   */
  async isIpBlocked(ipAddress: string): Promise<boolean> {
    if (!ipAddress) return false;
    const normalized = ipAddress.trim();
    if (!normalized) return false;
    await this.refreshBlockedIpCacheIfNeeded();
    if (this.initFailed) {
      this.onCriticalFailure({
        code: "IP_BLOCK_FAIL_OPEN",
        err: new Error("SecurityService init failed — IP-block sjekk har returnert false uten data"),
        context: "isIpBlocked",
      });
    }
    return this.blockedIpCache?.has(normalized) ?? false;
  }

  /**
   * Eksponert for boot-laster. Kalles eksplisitt av `index.ts` så cachen
   * er varm før første request treffer.
   */
  async warmBlockedIpCache(): Promise<void> {
    await this.refreshBlockedIpCache();
  }

  private invalidateBlockedIpCache(): void {
    this.blockedIpCache = null;
    this.blockedIpCacheLoadedAt = 0;
  }

  private async refreshBlockedIpCacheIfNeeded(): Promise<void> {
    const now = this.nowMs();
    if (this.blockedIpCache && now - this.blockedIpCacheLoadedAt < this.cacheTtlMs) {
      return;
    }
    await this.refreshBlockedIpCache();
  }

  private async refreshBlockedIpCache(): Promise<void> {
    try {
      await this.ensureInitialized();
      const { rows } = await this.pool.query<{ ip_address: string }>(
        `SELECT ip_address
         FROM ${this.ipsTable()}
         WHERE expires_at IS NULL OR expires_at > now()`
      );
      this.blockedIpCache = new Set(rows.map((r) => r.ip_address));
      this.blockedIpCacheLoadedAt = this.nowMs();
    } catch (err) {
      // Fail-open: ved DB-feil beholder vi gammel cache (om noe) og
      // logger. Å svare "blokkert" på alt ved DB-utfall ville stoppe
      // all trafikk.
      logger.warn({ err }, "[BIN-587 B3-security] blocked-IP cache refresh failed — using stale cache");
      if (!this.blockedIpCache) {
        this.blockedIpCache = new Set();
      }
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────

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
        `CREATE TABLE IF NOT EXISTS ${this.emailTable()} (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          label TEXT NULL,
          added_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.countriesTable()} (
          country_code TEXT PRIMARY KEY CHECK (char_length(country_code) = 2),
          label TEXT NOT NULL,
          reason TEXT NULL,
          added_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.ipsTable()} (
          id TEXT PRIMARY KEY,
          ip_address TEXT UNIQUE NOT NULL,
          reason TEXT NULL,
          blocked_by TEXT NULL,
          expires_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_blocked_ips_active
         ON ${this.ipsTable()}(ip_address)
         WHERE expires_at IS NULL OR expires_at > now()`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      // PR #513 §2.5: KRITISK — IP-blocking blir no-op uten denne tabellen.
      // Tidligere ble feilen wrappet som DomainError og kastet stille videre,
      // men `refreshBlockedIpCache` swallow-er DB-feil med en `warn`-logg
      // (fail-open). Resultat: server kjørte med tom blocked-IP-cache og
      // en advarsel som lett kunne forsvinne i logger.
      //
      // Fix:
      //   1. Marker `initFailed = true` så `isIpBlocked` emit-er CRITICAL
      //      per request. Pager går.
      //   2. Kall `onCriticalFailure`-hook (default: pino fatal-log).
      //   3. Hvis pilot-mode er på → re-throw så server-boot crasher med
      //      tydelig stack-trace i stedet for å starte med fail-open
      //      sikkerhets-stack.
      //   4. Ellers: fortsett oppstart — caller (warmBlockedIpCache) catch-er
      //      og service forblir lese-only (ikke en regresjon).
      this.initFailed = true;
      this.onCriticalFailure({ code: "SECURITY_INIT_FAILED", err, context: "initializeSchema" });

      if (this.pilotMode) {
        // Fail-fast: server skal IKKE starte i pilot uten fungerende sikkerhets-stack.
        if (err instanceof DomainError) throw err;
        throw new DomainError(
          "SECURITY_INIT_FAILED",
          "Kunne ikke initialisere sikkerhets-tabeller (pilot-mode fail-fast).",
        );
      }

      // Non-pilot: bevar bakoverkompatibilitet — caller bestemmer om det er fatalt.
      if (err instanceof DomainError) throw err;
      throw new DomainError("SECURITY_INIT_FAILED", "Kunne ikke initialisere sikkerhets-tabeller.");
    } finally {
      client.release();
    }
  }
}
