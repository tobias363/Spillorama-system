/**
 * Role Management — per-agent permission-matrix service.
 *
 * Dekker legacy Admin CR 21.02.2024 side 5 + Agent V1.0 permissions. Én rad
 * per (agent_user_id, module) holder hvilke actions (Create/Edit/View/Delete
 * + Block/Unblock for Player Management) agenten har.
 *
 * Finnes ikke rad for en (agent, module)-kombo → ingen tilgang (fail closed).
 *
 * "By default"-regler (fra wireframe, ikke lagret i DB):
 *   - Player Management (alle actions): alle agenter har dette by default.
 *   - Cash In/Out Management: alle agenter har dette by default.
 *   Disse håndheves i service via `hasPermission(...)` og kan IKKE endres av
 *   admin. Hvis module === 'player' spør vi DB først, men faller tilbake til
 *   true for alle actions hvis ingen rad eksisterer.
 *
 * Mønster: samme struktur som SavedGameService / LeaderboardTierService —
 * Object.create test-hook, idempotent ensureInitialized.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-permission-service" });

/**
 * 15 moduler fra Admin CR 21.02.2024 side 5.
 * Matches CHECK-constraint i migration 20260705000000_agent_permissions.sql.
 */
export const AGENT_PERMISSION_MODULES = [
  "player",
  "schedule",
  "game_creation",
  "saved_game",
  "physical_ticket",
  "unique_id",
  "report",
  "wallet",
  "transaction",
  "withdraw",
  "product",
  "hall_account",
  "hall_specific_report",
  "payout",
  "accounting",
] as const;

export type AgentPermissionModule = (typeof AGENT_PERMISSION_MODULES)[number];

export type AgentPermissionAction =
  | "create"
  | "edit"
  | "view"
  | "delete"
  | "block_unblock";

export interface ModulePermission {
  module: AgentPermissionModule;
  canCreate: boolean;
  canEdit: boolean;
  canView: boolean;
  canDelete: boolean;
  /** Kun relevant for Player Management — lagres alltid false for andre moduler. */
  canBlockUnblock: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SetModulePermissionInput {
  module: AgentPermissionModule;
  canCreate?: boolean;
  canEdit?: boolean;
  canView?: boolean;
  canDelete?: boolean;
  canBlockUnblock?: boolean;
}

export interface AgentPermissionServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface AgentPermissionRow {
  id: string;
  agent_user_id: string;
  module: AgentPermissionModule;
  can_create: boolean;
  can_edit: boolean;
  can_view: boolean;
  can_delete: boolean;
  can_block_unblock: boolean;
  updated_at: Date | string;
  updated_by: string | null;
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertAgentId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "agentId er påkrevd.");
  }
  return value.trim();
}

function assertModule(value: unknown): AgentPermissionModule {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "module må være en streng.");
  }
  const v = value.trim() as AgentPermissionModule;
  if (!AGENT_PERMISSION_MODULES.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `module må være én av: ${AGENT_PERMISSION_MODULES.join(", ")}.`
    );
  }
  return v;
}

function toBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new DomainError("INVALID_INPUT", `${field} må være en boolean.`);
  }
  return value;
}

function emptyPermission(module: AgentPermissionModule): ModulePermission {
  return {
    module,
    canCreate: false,
    canEdit: false,
    canView: false,
    canDelete: false,
    canBlockUnblock: false,
    updatedAt: null,
    updatedBy: null,
  };
}

/**
 * "By default"-regel for Player Management: alle agenter har alle actions
 * som default når ingen rad eksisterer.
 */
function defaultPlayerPermission(): ModulePermission {
  return {
    module: "player",
    canCreate: true,
    canEdit: true,
    canView: true,
    canDelete: true,
    canBlockUnblock: true,
    updatedAt: null,
    updatedBy: null,
  };
}

export class AgentPermissionService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: AgentPermissionServiceOptions) {
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
        "AgentPermissionService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): AgentPermissionService {
    const svc = Object.create(
      AgentPermissionService.prototype
    ) as AgentPermissionService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_agent_permissions"`;
  }

  /**
   * Hent full matrix for én agent: alltid 15 rader (én per modul). Moduler
   * uten lagret rad returneres med alle actions = false (fail closed), med
   * unntak av 'player' som faller tilbake til default-ALL=true.
   */
  async getPermissions(agentId: string): Promise<ModulePermission[]> {
    await this.ensureInitialized();
    const id = assertAgentId(agentId);
    const { rows } = await this.pool.query<AgentPermissionRow>(
      `SELECT id, agent_user_id, module, can_create, can_edit, can_view,
              can_delete, can_block_unblock, updated_at, updated_by
       FROM ${this.table()}
       WHERE agent_user_id = $1`,
      [id]
    );
    const byModule = new Map<AgentPermissionModule, ModulePermission>();
    for (const row of rows) {
      byModule.set(row.module, this.mapRow(row));
    }
    return AGENT_PERMISSION_MODULES.map((module) => {
      const existing = byModule.get(module);
      if (existing) return existing;
      if (module === "player") return defaultPlayerPermission();
      return emptyPermission(module);
    });
  }

  /**
   * Upsert matrix for én modul. Replace-semantikk — hele rad erstattes
   * (boolean-felter som ikke er oppgitt defaulter til false).
   */
  async setPermission(
    agentId: string,
    input: SetModulePermissionInput,
    adminUserId: string
  ): Promise<ModulePermission> {
    await this.ensureInitialized();
    const id = assertAgentId(agentId);
    const module = assertModule(input.module);
    if (!adminUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "adminUserId er påkrevd.");
    }
    const canCreate =
      input.canCreate === undefined ? false : toBool(input.canCreate, "canCreate");
    const canEdit =
      input.canEdit === undefined ? false : toBool(input.canEdit, "canEdit");
    const canView =
      input.canView === undefined ? false : toBool(input.canView, "canView");
    const canDelete =
      input.canDelete === undefined ? false : toBool(input.canDelete, "canDelete");
    // Block/Unblock er kun meningsfylt for 'player' — vi lagrer alltid false
    // for andre moduler uavhengig av input (ikke-eksponert i UI for andre).
    const canBlockUnblock =
      module === "player"
        ? input.canBlockUnblock === undefined
          ? false
          : toBool(input.canBlockUnblock, "canBlockUnblock")
        : false;

    const rowId = randomUUID();
    await this.pool.query(
      `INSERT INTO ${this.table()}
         (id, agent_user_id, module, can_create, can_edit, can_view,
          can_delete, can_block_unblock, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
       ON CONFLICT (agent_user_id, module)
       DO UPDATE SET
         can_create        = EXCLUDED.can_create,
         can_edit          = EXCLUDED.can_edit,
         can_view          = EXCLUDED.can_view,
         can_delete        = EXCLUDED.can_delete,
         can_block_unblock = EXCLUDED.can_block_unblock,
         updated_at        = NOW(),
         updated_by        = EXCLUDED.updated_by`,
      [
        rowId,
        id,
        module,
        canCreate,
        canEdit,
        canView,
        canDelete,
        canBlockUnblock,
        adminUserId,
      ]
    );
    return {
      module,
      canCreate,
      canEdit,
      canView,
      canDelete,
      canBlockUnblock,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUserId,
    };
  }

  /**
   * Atomic bulk-update: replace hele matrix i én transaksjon. Brukes av
   * PUT-endepunktet som sender full matrix fra admin-UI.
   */
  async setPermissions(
    agentId: string,
    inputs: SetModulePermissionInput[],
    adminUserId: string
  ): Promise<ModulePermission[]> {
    await this.ensureInitialized();
    const id = assertAgentId(agentId);
    if (!Array.isArray(inputs)) {
      throw new DomainError("INVALID_INPUT", "permissions må være en array.");
    }
    if (!adminUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "adminUserId er påkrevd.");
    }
    // Valider alle input før vi går inn i transaksjon (fail fast).
    const validated = inputs.map((raw) => {
      const module = assertModule(raw.module);
      const canCreate =
        raw.canCreate === undefined ? false : toBool(raw.canCreate, "canCreate");
      const canEdit =
        raw.canEdit === undefined ? false : toBool(raw.canEdit, "canEdit");
      const canView =
        raw.canView === undefined ? false : toBool(raw.canView, "canView");
      const canDelete =
        raw.canDelete === undefined ? false : toBool(raw.canDelete, "canDelete");
      const canBlockUnblock =
        module === "player"
          ? raw.canBlockUnblock === undefined
            ? false
            : toBool(raw.canBlockUnblock, "canBlockUnblock")
          : false;
      return { module, canCreate, canEdit, canView, canDelete, canBlockUnblock };
    });
    // Dupe-sjekk på modul-nøkkel.
    const seen = new Set<AgentPermissionModule>();
    for (const v of validated) {
      if (seen.has(v.module)) {
        throw new DomainError(
          "INVALID_INPUT",
          `module '${v.module}' er oppgitt flere ganger.`
        );
      }
      seen.add(v.module);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const v of validated) {
        const rowId = randomUUID();
        await client.query(
          `INSERT INTO ${this.table()}
             (id, agent_user_id, module, can_create, can_edit, can_view,
              can_delete, can_block_unblock, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
           ON CONFLICT (agent_user_id, module)
           DO UPDATE SET
             can_create        = EXCLUDED.can_create,
             can_edit          = EXCLUDED.can_edit,
             can_view          = EXCLUDED.can_view,
             can_delete        = EXCLUDED.can_delete,
             can_block_unblock = EXCLUDED.can_block_unblock,
             updated_at        = NOW(),
             updated_by        = EXCLUDED.updated_by`,
          [
            rowId,
            id,
            v.module,
            v.canCreate,
            v.canEdit,
            v.canView,
            v.canDelete,
            v.canBlockUnblock,
            adminUserId,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err, agentId: id }, "agent-permissions bulk-update failed");
      throw new DomainError(
        "AGENT_PERMISSION_UPDATE_FAILED",
        "Kunne ikke oppdatere agent-permissions."
      );
    } finally {
      client.release();
    }
    return this.getPermissions(id);
  }

  /**
   * Sjekk om en agent har tilgang til (module, action). Brukes av senere
   * enforcement-lag (agent-routes). Respekterer default-regel: player har
   * alle actions by default, øvrige moduler fail closed.
   */
  async hasPermission(
    agentId: string,
    module: AgentPermissionModule,
    action: AgentPermissionAction
  ): Promise<boolean> {
    await this.ensureInitialized();
    const id = assertAgentId(agentId);
    const mod = assertModule(module);
    const { rows } = await this.pool.query<AgentPermissionRow>(
      `SELECT id, agent_user_id, module, can_create, can_edit, can_view,
              can_delete, can_block_unblock, updated_at, updated_by
       FROM ${this.table()}
       WHERE agent_user_id = $1 AND module = $2`,
      [id, mod]
    );
    const row = rows[0];
    if (!row) {
      if (mod === "player") return true; // by default
      return false;
    }
    const perm = this.mapRow(row);
    switch (action) {
      case "create":
        return perm.canCreate;
      case "edit":
        return perm.canEdit;
      case "view":
        return perm.canView;
      case "delete":
        return perm.canDelete;
      case "block_unblock":
        return perm.canBlockUnblock;
      default:
        return false;
    }
  }

  private mapRow(row: AgentPermissionRow): ModulePermission {
    return {
      module: row.module,
      canCreate: Boolean(row.can_create),
      canEdit: Boolean(row.can_edit),
      canView: Boolean(row.can_view),
      canDelete: Boolean(row.can_delete),
      canBlockUnblock: Boolean(row.can_block_unblock),
      updatedAt: asIso(row.updated_at),
      updatedBy: row.updated_by,
    };
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
      // Match migration 20260705000000_agent_permissions.sql — CREATE IF NOT
      // EXISTS slik at service-laget kan starte mot en fersk DB i tester.
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_user_id UUID NOT NULL,
          module TEXT NOT NULL,
          can_create BOOLEAN NOT NULL DEFAULT false,
          can_edit BOOLEAN NOT NULL DEFAULT false,
          can_view BOOLEAN NOT NULL DEFAULT false,
          can_delete BOOLEAN NOT NULL DEFAULT false,
          can_block_unblock BOOLEAN NOT NULL DEFAULT false,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by UUID NULL
        )`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_agent_permissions_agent_module
         ON ${this.table()}(agent_user_id, module)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_agent_permissions_agent
         ON ${this.table()}(agent_user_id)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "agent_permissions schema init failed");
      throw new DomainError(
        "AGENT_PERMISSION_INIT_FAILED",
        "Kunne ikke initialisere agent_permissions-tabell."
      );
    } finally {
      client.release();
    }
  }
}
