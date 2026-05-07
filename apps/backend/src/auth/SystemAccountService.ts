/**
 * PR-B (2026-05-07): SystemAccountService — langlevende API-keys for
 * ops/automation/CI som kan kalle admin-endpoints uten passord-flow.
 *
 * Bruksflyt:
 *   1. ADMIN kaller `POST /api/admin/system-accounts` med navn + permissions
 *      + valgfri hallScope. Tjenesten genererer `sa_<32hex>`-key, hash-er den
 *      med scrypt og lagrer hash + metadata. Klartekst-keyen returneres ÉN
 *      gang i opprettelses-svaret og kan aldri hentes igjen.
 *   2. Klient (CI, AI-agent, ops-script) sender `Authorization: Bearer sa_xxx`.
 *      Auth-middleware sjekker prefix `sa_` og ruter til `verify(apiKey)`.
 *      Klikk-fri ekvivalent til JWT (men uten hver-time-refresh-flow).
 *   3. Hver autentisert request skriver `system_account.use` til AuditLog
 *      og oppdaterer `last_used_at` + `last_used_ip` fire-and-forget.
 *
 * Sikkerhet:
 *   - 32 hex-tegn = 128 bits entropy. Klartekst lagres aldri etter
 *     opprettelse. Hash er scrypt med 16-byte salt (samme oppskrift som
 *     PlatformService.hashPassword).
 *   - timingSafeEqual for hash-verify motstandsdyktig mot timing-angrep.
 *   - revoked_at + is_active sjekkes i samme query som hash-lookup
 *     (partial index `idx_app_system_accounts_active`).
 *   - permissions er en whitelist (subset av AdminPermission). Operasjonen
 *     blokkeres hvis ønsket permission ikke er i whitelist, selv om syntetisk
 *     role i actor-objektet ville passert ADMIN_ACCESS_POLICY.
 *
 * Audit:
 *   - `system_account.create` ved opprettelse (med permissions + hallScope).
 *   - `system_account.use` per autentisert request (fire-and-forget i
 *     middleware, ikke i denne servicen — for å holde verify() rask).
 *   - `system_account.revoke` ved revoke.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AdminPermission } from "../platform/AdminAccessPolicy.js";

const scrypt = promisify(scryptCallback);

const logger = rootLogger.child({ module: "system-account-service" });

const API_KEY_PREFIX = "sa_";
const API_KEY_HEX_LENGTH = 32; // 32 hex chars = 128 bits entropy
const ID_PREFIX = "sa-";

export interface SystemAccountServiceOptions {
  /**
   * Foretrukket: shared pool injection. Bruker ikke egen pool da.
   */
  pool?: Pool;
  /** Fallback for tester/legacy — kun brukt hvis `pool` ikke er satt. */
  connectionString?: string;
  schema?: string;
}

export interface SystemAccount {
  id: string;
  name: string;
  description: string | null;
  permissions: AdminPermission[];
  hallScope: string[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdByUserId: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
}

export interface CreateSystemAccountInput {
  name: string;
  description?: string;
  permissions: AdminPermission[];
  hallScope?: string[] | null;
  createdByUserId: string;
}

export interface CreateSystemAccountResult {
  /** Full SystemAccount-snapshot UTEN api_key_hash. */
  account: SystemAccount;
  /**
   * Klartekst-keyen. Vises ÉN gang ved opprettelse — kalleren har ansvar for
   * å overlevere den til mottaker (typisk via admin-UI som dekrypter-popup).
   * Format: `sa_<32hex>`.
   */
  apiKey: string;
}

export interface VerifiedSystemAccountActor {
  type: "SYSTEM_ACCOUNT";
  id: string;
  name: string;
  permissions: AdminPermission[];
  hallScope: string[] | null;
}

export interface ListSystemAccountsOptions {
  includeRevoked?: boolean;
}

interface SystemAccountRow {
  id: string;
  name: string;
  description: string | null;
  api_key_hash: string;
  permissions_json: unknown;
  hall_scope_json: unknown;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_used_at: Date | string | null;
  last_used_ip: string | null;
  created_by_user_id: string | null;
  revoked_at: Date | string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parsePermissions(raw: unknown): AdminPermission[] {
  if (!isStringArray(raw)) return [];
  // Trust på write-time-validering — runtime-cast er nok.
  return raw as AdminPermission[];
}

function parseHallScope(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  if (!isStringArray(raw)) return null;
  return raw;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} mangler.`);
  }
  return value.trim();
}

/**
 * Generer en ny API-key. Format: `sa_` + 32 hex-tegn (128 bits entropy).
 */
function generateApiKey(): string {
  const random = randomBytes(16); // 16 bytes = 32 hex chars
  return `${API_KEY_PREFIX}${random.toString("hex")}`;
}

function generateAccountId(): string {
  // 12 hex-tegn er nok for unik ID + ID_PREFIX.
  return `${ID_PREFIX}${randomBytes(6).toString("hex")}`;
}

/**
 * scrypt-hash av API-keyen. Samme oppskrift som
 * PlatformService.hashPassword: 16-byte salt + 64-byte digest, lagret som
 * `scrypt:<saltHex>:<digestHex>`.
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(apiKey, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

/**
 * Constant-time hash-verify. Returnerer false ved hvilket som helst format-
 * problem i stedet for å kaste — sikkerhetsmessig samme som mismatch.
 */
async function verifyApiKey(apiKey: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const saltHex = parts[1];
  const digestHex = parts[2];
  if (!saltHex || !digestHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(digestHex, "hex");
  } catch {
    return false;
  }
  const actual = (await scrypt(apiKey, salt, expected.length)) as Buffer;
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Identifiser at et token har system-account-prefix. Brukes fra auth-flyt
 * for å rute mellom SystemAccountService.verify() og PlatformService.
 * getUserFromAccessToken().
 */
export function isSystemAccountKey(token: string): boolean {
  return typeof token === "string" && token.startsWith(API_KEY_PREFIX);
}

/**
 * Logger-vennlig prefix av API-keyen. Bruker første 8 tegn etter `sa_` —
 * gir ops nok til å identifisere keyen i logger uten å lekke nok til at
 * den kan brute-forces.
 */
export function apiKeyPrefix(apiKey: string): string {
  if (!isSystemAccountKey(apiKey)) return "";
  return apiKey.slice(0, API_KEY_PREFIX.length + 8);
}

export class SystemAccountService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly ownsPool: boolean;

  constructor(options: SystemAccountServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
      this.ownsPool = true;
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "SystemAccountService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): SystemAccountService {
    return new SystemAccountService({ pool, schema });
  }

  private table(): string {
    return `"${this.schema}"."app_system_accounts"`;
  }

  private mapRow(row: SystemAccountRow): SystemAccount {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      permissions: parsePermissions(row.permissions_json),
      hallScope: parseHallScope(row.hall_scope_json),
      isActive: row.is_active,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      lastUsedAt: asIsoOrNull(row.last_used_at),
      lastUsedIp: row.last_used_ip,
      createdByUserId: row.created_by_user_id,
      revokedAt: asIsoOrNull(row.revoked_at),
      revokedByUserId: row.revoked_by_user_id,
      revokeReason: row.revoke_reason,
    };
  }

  /**
   * Opprett en ny system-account. Returnerer både snapshot og klartekst-key.
   * Klartekst-keyen vises ÉN gang og kan ikke hentes igjen — kalleren må
   * formidle den umiddelbart.
   *
   * Validering:
   *   - name må være unikt (UNIQUE-constraint).
   *   - permissions må være ikke-tom.
   *   - createdByUserId må være satt (audit-krav).
   *
   * Permission-strings er ikke validert mot AdminPermission-katalogen her —
   * det skjer på input-siden av admin-routen via type-narrowing. Service-laget
   * tar dem som-er og lagrer dem.
   */
  async create(input: CreateSystemAccountInput): Promise<CreateSystemAccountResult> {
    const name = assertNonEmptyString(input.name, "name");
    const createdByUserId = assertNonEmptyString(input.createdByUserId, "createdByUserId");
    if (!Array.isArray(input.permissions) || input.permissions.length === 0) {
      throw new DomainError("INVALID_INPUT", "permissions må inneholde minst én permission.");
    }
    const description = typeof input.description === "string" && input.description.trim()
      ? input.description.trim()
      : null;
    const hallScope = input.hallScope === null || input.hallScope === undefined
      ? null
      : Array.isArray(input.hallScope)
        ? input.hallScope.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : null;

    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const id = generateAccountId();

    try {
      const { rows } = await this.pool.query<SystemAccountRow>(
        `INSERT INTO ${this.table()}
           (id, name, description, api_key_hash, permissions_json, hall_scope_json, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
         RETURNING id, name, description, api_key_hash, permissions_json, hall_scope_json,
                   is_active, created_at, updated_at, last_used_at, last_used_ip,
                   created_by_user_id, revoked_at, revoked_by_user_id, revoke_reason`,
        [
          id,
          name,
          description,
          apiKeyHash,
          JSON.stringify(input.permissions),
          hallScope === null ? null : JSON.stringify(hallScope),
          createdByUserId,
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError("PLATFORM_DB_ERROR", "Kunne ikke opprette system-account.");
      }
      return { account: this.mapRow(row), apiKey };
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // pg unique_violation = 23505
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        throw new DomainError(
          "SYSTEM_ACCOUNT_NAME_EXISTS",
          "En system-account med dette navnet finnes allerede."
        );
      }
      logger.error({ err, name }, "[PR-B] Kunne ikke opprette system-account");
      throw new DomainError("PLATFORM_DB_ERROR", "Kunne ikke opprette system-account.");
    }
  }

  /**
   * Verifiser en API-key og returner et SYSTEM_ACCOUNT-actor-objekt hvis
   * keyen er gyldig (aktiv, ikke revoked, hash-match). Returnerer `null`
   * for hvilken som helst feil — kalleren skal ikke skille mellom "ukjent
   * key" og "feil hash" (lekkasje-resistant).
   *
   * Performance: `verify()` skal være rask (kalles på hver autentisert
   * request). Vi gjør én DB-spørring filtrert via partial-index
   * `idx_app_system_accounts_active`, og scrypt-verify er ~100ms i prod.
   * `recordUsage` er fire-and-forget for å unngå å blokkere request.
   */
  async verify(apiKey: string): Promise<VerifiedSystemAccountActor | null> {
    if (!isSystemAccountKey(apiKey)) return null;
    const trimmed = apiKey.trim();
    if (trimmed.length < API_KEY_PREFIX.length + API_KEY_HEX_LENGTH) {
      return null;
    }

    let rows: SystemAccountRow[];
    try {
      const result = await this.pool.query<SystemAccountRow>(
        // Henter alle aktive (ikke-revoked, is_active=TRUE)-rader. Det
        // forventes typisk å være < 50 keys totalt, så full scan er
        // akseptabelt — alternativet er å lagre en deterministisk
        // prefix-hash og indeksere den, men det kompliserer skjemaet
        // uten reell gevinst.
        `SELECT id, name, description, api_key_hash, permissions_json, hall_scope_json,
                is_active, created_at, updated_at, last_used_at, last_used_ip,
                created_by_user_id, revoked_at, revoked_by_user_id, revoke_reason
         FROM ${this.table()}
         WHERE revoked_at IS NULL AND is_active = TRUE`
      );
      rows = result.rows;
    } catch (err) {
      logger.error({ err }, "[PR-B] verify() DB-feil");
      return null;
    }

    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop -- scrypt er CPU-bundet, små N
      const matches = await verifyApiKey(trimmed, row.api_key_hash);
      if (matches) {
        return {
          type: "SYSTEM_ACCOUNT",
          id: row.id,
          name: row.name,
          permissions: parsePermissions(row.permissions_json),
          hallScope: parseHallScope(row.hall_scope_json),
        };
      }
    }
    return null;
  }

  /**
   * Fire-and-forget update av last_used_at + last_used_ip. Kalles fra
   * auth-middleware etter vellykket verify(). Failure er bevisst silent —
   * vi vil ikke blokkere request hvis tracking feiler.
   *
   * `ip` trimmes til 64 tegn for å matche columntype-grensen i andre
   * services (SessionService bruker samme begrensning).
   */
  async recordUsage(id: string, ip: string | null): Promise<void> {
    try {
      const trimmedIp = typeof ip === "string" && ip.trim() ? ip.slice(0, 64) : null;
      await this.pool.query(
        `UPDATE ${this.table()}
         SET last_used_at = now(), last_used_ip = $2
         WHERE id = $1`,
        [id, trimmedIp]
      );
    } catch (err) {
      // Bevisst silent — recordUsage er fire-and-forget.
      logger.warn({ err, id }, "[PR-B] recordUsage feilet (ignorert)");
    }
  }

  /**
   * Soft-delete en system-account. Etterpå avvises den av verify(). reason
   * er påkrevd for audit (matches PLAYER_KYC_OVERRIDE-mønsteret).
   *
   * Idempotent: revoke av allerede revoked account returnerer SYSTEM_
   * ACCOUNT_NOT_FOUND (samme som ukjent ID — vi vil ikke lekke at
   * accounten finnes men er revoked).
   */
  async revoke(id: string, byUserId: string, reason: string): Promise<void> {
    const accountId = assertNonEmptyString(id, "id");
    const revokedBy = assertNonEmptyString(byUserId, "byUserId");
    const trimmedReason = assertNonEmptyString(reason, "reason");

    const result = await this.pool.query(
      `UPDATE ${this.table()}
       SET revoked_at = now(),
           revoked_by_user_id = $2,
           revoke_reason = $3,
           updated_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [accountId, revokedBy, trimmedReason]
    );
    if (!result.rowCount) {
      throw new DomainError(
        "SYSTEM_ACCOUNT_NOT_FOUND",
        "System-accounten finnes ikke eller er allerede revoked."
      );
    }
  }

  /**
   * Liste system-accounts. UTEN api_key_hash i svaret — det skal aldri
   * eksponeres etter opprettelse. Default skjuler revoked.
   */
  async list(options: ListSystemAccountsOptions = {}): Promise<SystemAccount[]> {
    const where = options.includeRevoked ? "" : "WHERE revoked_at IS NULL";
    const { rows } = await this.pool.query<SystemAccountRow>(
      `SELECT id, name, description, api_key_hash, permissions_json, hall_scope_json,
              is_active, created_at, updated_at, last_used_at, last_used_ip,
              created_by_user_id, revoked_at, revoked_by_user_id, revoke_reason
       FROM ${this.table()}
       ${where}
       ORDER BY created_at DESC`
    );
    return rows.map((row) => this.mapRow(row));
  }

  /** Lukk pool hvis vi eier den. Brukes i test-tear-down. */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}

/**
 * Helper: sjekk om en SystemAccount-actor har lov til en gitt permission.
 * Brukes fra auth-middleware/route-laget. Returnerer false hvis permission
 * ikke er i whitelist, true ellers.
 */
export function systemAccountHasPermission(
  actor: VerifiedSystemAccountActor,
  permission: AdminPermission
): boolean {
  return actor.permissions.includes(permission);
}

/**
 * Helper: sjekk om en SystemAccount-actor har lov til å opere mot en gitt
 * hall. `null` hallScope = global (alle haller). Liste = må være med.
 */
export function systemAccountHasHallAccess(
  actor: VerifiedSystemAccountActor,
  hallId: string
): boolean {
  if (actor.hallScope === null) return true;
  return actor.hallScope.includes(hallId);
}
