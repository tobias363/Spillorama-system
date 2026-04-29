/**
 * BIN-677: SystemSettings admin-service.
 *
 * Key-value store for system-wide config. Hver nøkkel er registrert i et
 * typesjekk-registry (SYSTEM_SETTING_REGISTRY) — ukjente nøkler avvises.
 * Admin henter hele settings-katalogen via GET og PATCH-er én eller flere
 * nøkler om gangen.
 *
 * Legacy-opphav:
 *
 * Avgrensning (BIN-677):
 *   - IKKE per-hall Spillvett-tak (det lever i apps/backend/src/routes/adminHalls.ts).
 *   - IKKE maintenance (det er egen tabell — se MaintenanceService).
 *   - Nøkler speiler legacy-feltene som faktisk brukes på frontend/admin;
 *     legacy-felter som var død kode (BackupDetails, commission, rakePercenage)
 *     er utelatt — kan legges til senere via registry-utvidelse.
 */

import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "settings-service" });

export type SystemSettingType = "string" | "number" | "boolean" | "object";

export interface SystemSettingDefinition {
  key: string;
  category: string;
  description: string;
  type: SystemSettingType;
  /** Default-verdi som brukes hvis key ikke finnes i DB. Må matche `type`. */
  defaultValue: unknown;
}

/**
 * Katalog av kjente system-settings. Hver nøkkel er en stabil slug
 * (<category>.<name>). Legg til nye nøkler her — ikke i DB direkte.
 */
export const SYSTEM_SETTING_REGISTRY: readonly SystemSettingDefinition[] = [
  // ── general ────────────────────────────────────────────────────────────
  {
    key: "system.timezone",
    category: "general",
    description: "Standard tidssone for visning i admin-UI og rapporter.",
    type: "string",
    defaultValue: "Europe/Oslo",
  },
  {
    key: "system.currency",
    category: "general",
    description: "Valuta-kode (ISO 4217) for pengebeløp.",
    type: "string",
    defaultValue: "NOK",
  },
  {
    key: "system.locale",
    category: "general",
    description: "Standard språk-locale (BCP 47) for admin-UI.",
    type: "string",
    defaultValue: "nb-NO",
  },
  {
    key: "system.information",
    category: "general",
    description:
      "System-informasjon HTML-blob (vises til spillere). Speiler legacy systemInformationData.",
    type: "string",
    defaultValue: "",
  },
  // ── app_versions (klient-oppgraderinger) ───────────────────────────────
  {
    key: "app.android_version",
    category: "app_versions",
    description: "Siste Android-klient-versjon. Speiler legacy android_version.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.android_store_link",
    category: "app_versions",
    description: "URL til Android-klient i Play Store.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.ios_version",
    category: "app_versions",
    description: "Siste iOS-klient-versjon. Speiler legacy ios_version.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.ios_store_link",
    category: "app_versions",
    description: "URL til iOS-klient i App Store.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.windows_version",
    category: "app_versions",
    description: "Siste Windows/Linux-klient-versjon. Speiler legacy wind_linux_version.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.windows_store_link",
    category: "app_versions",
    description: "URL til Windows-klient-nedlasting.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.webgl_version",
    category: "app_versions",
    description: "Siste WebGL-klient-versjon. Speiler legacy webgl_version.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.webgl_store_link",
    category: "app_versions",
    description: "URL til WebGL-klient.",
    type: "string",
    defaultValue: "",
  },
  {
    key: "app.disable_store_link",
    category: "app_versions",
    description: "Flagg for å skjule butikk-lenker i klient. Speiler legacy disable_store_link.",
    type: "string",
    defaultValue: "",
  },
  // ── compliance (regulatoriske tak) ─────────────────────────────────────
  // NB: per-hall-tak ligger i adminHalls.ts — disse er system-wide defaults.
  {
    key: "compliance.daily_spending_default",
    category: "compliance",
    description:
      "Standard daglig tapsgrense (NOK) brukt som default når en hall ikke har egen verdi. Speiler legacy daily_spending.",
    type: "number",
    defaultValue: 0,
  },
  {
    key: "compliance.monthly_spending_default",
    category: "compliance",
    description:
      "Standard månedlig tapsgrense (NOK) brukt som default når en hall ikke har egen verdi. Speiler legacy monthly_spending.",
    type: "number",
    defaultValue: 0,
  },
  // ── branding (logo/screenSaver-refs) ───────────────────────────────────
  {
    key: "branding.logo_url",
    category: "branding",
    description: "URL til hovedlogo (admin + operatør-UI).",
    type: "string",
    defaultValue: "",
  },
  {
    key: "branding.screen_saver_enabled",
    category: "branding",
    description: "Aktiverer screensaver i operatør-UI. Speiler legacy screenSaver.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "branding.screen_saver_timeout_minutes",
    category: "branding",
    description: "Minutter før screensaver starter (string i legacy — vi lagrer som number).",
    type: "number",
    defaultValue: 5,
  },
  // ── feature_flags (fri-form registry) ──────────────────────────────────
  {
    key: "features.flags",
    category: "feature_flags",
    description:
      "Feature-flag-objekt (key → boolean). Service-laget validerer at alle verdier er boolean.",
    type: "object",
    defaultValue: {},
  },
] as const;

const REGISTRY_BY_KEY = new Map<string, SystemSettingDefinition>(
  SYSTEM_SETTING_REGISTRY.map((d) => [d.key, d])
);

export interface SystemSetting {
  key: string;
  value: unknown;
  category: string;
  description: string;
  type: SystemSettingType;
  /** Hvorvidt verdien er eksplisitt lagret (true) eller tatt fra registry-default (false). */
  isDefault: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface UpdateSystemSettingPatch {
  key: string;
  value: unknown;
}

export interface SettingsServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface SystemSettingRow {
  key: string;
  value_json: unknown;
  category: string;
  description: string;
  updated_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function validateValue(
  def: SystemSettingDefinition,
  value: unknown
): unknown {
  switch (def.type) {
    case "string":
      if (typeof value !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `Setting '${def.key}' må være en streng.`
        );
      }
      if (value.length > 10_000) {
        throw new DomainError(
          "INVALID_INPUT",
          `Setting '${def.key}' kan maksimalt være 10000 tegn.`
        );
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(
          "INVALID_INPUT",
          `Setting '${def.key}' må være et endelig tall.`
        );
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new DomainError(
          "INVALID_INPUT",
          `Setting '${def.key}' må være boolean.`
        );
      }
      return value;
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new DomainError(
          "INVALID_INPUT",
          `Setting '${def.key}' må være et objekt (ikke null/array).`
        );
      }
      // For features.flags: håndhev at alle verdier er boolean.
      if (def.key === "features.flags") {
        for (const [flagKey, flagValue] of Object.entries(
          value as Record<string, unknown>
        )) {
          if (typeof flagValue !== "boolean") {
            throw new DomainError(
              "INVALID_INPUT",
              `features.flags[${flagKey}] må være boolean.`
            );
          }
        }
      }
      return value;
    default: {
      const _exhaustive: never = def.type;
      throw new DomainError(
        "INVALID_CONFIG",
        `Ukjent setting-type for '${def.key}': ${_exhaustive}`
      );
    }
  }
}

export class SettingsService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: SettingsServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
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
        "SettingsService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): SettingsService {
    const svc = Object.create(SettingsService.prototype) as SettingsService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_system_settings"`;
  }

  /**
   * Listing av alle settings — registry-nøkler som mangler i DB returneres
   * med `defaultValue` + `isDefault=true`. Ukjente nøkler fra DB filtreres
   * bort (fail-closed hvis noe har sneket seg inn).
   */
  async list(): Promise<SystemSetting[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<SystemSettingRow>(
      `SELECT key, value_json, category, description,
              updated_by_user_id, created_at, updated_at
       FROM ${this.table()}`
    );
    const byKey = new Map<string, SystemSettingRow>(rows.map((r) => [r.key, r]));
    return SYSTEM_SETTING_REGISTRY.map((def) => {
      const row = byKey.get(def.key);
      if (row) {
        return {
          key: def.key,
          value: row.value_json,
          category: def.category,
          description: def.description,
          type: def.type,
          isDefault: false,
          updatedByUserId: row.updated_by_user_id,
          updatedAt: asIso(row.updated_at),
        };
      }
      return {
        key: def.key,
        value: def.defaultValue,
        category: def.category,
        description: def.description,
        type: def.type,
        isDefault: true,
        updatedByUserId: null,
        updatedAt: null,
      };
    });
  }

  /**
   * Henter én setting (alltid en verdi — registry-default hvis uskrevet).
   * Kastes DomainError("SETTING_UNKNOWN") hvis key ikke er registrert.
   */
  async get(key: string): Promise<SystemSetting> {
    await this.ensureInitialized();
    if (!key?.trim()) {
      throw new DomainError("INVALID_INPUT", "key er påkrevd.");
    }
    const def = REGISTRY_BY_KEY.get(key.trim());
    if (!def) {
      throw new DomainError(
        "SETTING_UNKNOWN",
        `Ukjent setting-key: ${key.trim()}`
      );
    }
    const { rows } = await this.pool.query<SystemSettingRow>(
      `SELECT key, value_json, category, description,
              updated_by_user_id, created_at, updated_at
       FROM ${this.table()}
       WHERE key = $1`,
      [def.key]
    );
    const row = rows[0];
    if (row) {
      return {
        key: def.key,
        value: row.value_json,
        category: def.category,
        description: def.description,
        type: def.type,
        isDefault: false,
        updatedByUserId: row.updated_by_user_id,
        updatedAt: asIso(row.updated_at),
      };
    }
    return {
      key: def.key,
      value: def.defaultValue,
      category: def.category,
      description: def.description,
      type: def.type,
      isDefault: true,
      updatedByUserId: null,
      updatedAt: null,
    };
  }

  /**
   * PATCH av én eller flere settings. Returnerer den oppdaterte listen etter
   * skrivingen. Ukjente nøkler avvises. Transaksjonell — alle-eller-ingen.
   */
  async patch(
    patches: UpdateSystemSettingPatch[],
    actorUserId: string | null
  ): Promise<SystemSetting[]> {
    await this.ensureInitialized();
    if (!Array.isArray(patches) || patches.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    // Validér alle først (fail-fast før DB-write).
    const validated: Array<{ def: SystemSettingDefinition; value: unknown }> = [];
    const seenKeys = new Set<string>();
    for (const patch of patches) {
      if (!patch || typeof patch !== "object") {
        throw new DomainError("INVALID_INPUT", "Hver patch må være et objekt.");
      }
      if (typeof patch.key !== "string" || !patch.key.trim()) {
        throw new DomainError("INVALID_INPUT", "patch.key er påkrevd.");
      }
      const def = REGISTRY_BY_KEY.get(patch.key.trim());
      if (!def) {
        throw new DomainError(
          "SETTING_UNKNOWN",
          `Ukjent setting-key: ${patch.key.trim()}`
        );
      }
      if (seenKeys.has(def.key)) {
        throw new DomainError(
          "INVALID_INPUT",
          `Duplikat key i patch-batch: ${def.key}`
        );
      }
      seenKeys.add(def.key);
      const value = validateValue(def, patch.value);
      validated.push({ def, value });
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const { def, value } of validated) {
        await client.query(
          `INSERT INTO ${this.table()}
             (key, value_json, category, description, updated_by_user_id)
           VALUES ($1, $2::jsonb, $3, $4, $5)
           ON CONFLICT (key) DO UPDATE SET
             value_json = EXCLUDED.value_json,
             category = EXCLUDED.category,
             description = EXCLUDED.description,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_at = now()`,
          [
            def.key,
            JSON.stringify(value),
            def.category,
            def.description,
            actorUserId,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-677] settings patch failed");
      throw new DomainError(
        "SETTING_PATCH_FAILED",
        "Kunne ikke oppdatere settings."
      );
    } finally {
      client.release();
    }
    return this.list();
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
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          key TEXT PRIMARY KEY,
          value_json JSONB NOT NULL DEFAULT 'null'::jsonb,
          category TEXT NOT NULL DEFAULT 'general',
          description TEXT NOT NULL DEFAULT '',
          updated_by_user_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_system_settings_category
         ON ${this.table()}(category)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-677] system_settings schema init failed");
      throw new DomainError(
        "SETTING_INIT_FAILED",
        "Kunne ikke initialisere system_settings-tabell."
      );
    } finally {
      client.release();
    }
  }
}
