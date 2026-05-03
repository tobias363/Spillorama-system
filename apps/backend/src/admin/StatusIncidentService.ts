/**
 * BIN-791: Public Status Page — admin-managed incidents.
 *
 * Tjenesten lar admin manuelt publisere/oppdatere/lukke "incidents" som
 * vises på offentlig status-side. Dette er separat fra automatiske
 * komponent-helsesjekker (`StatusService`) — incidents er fortellingen
 * rundt en hendelse mens de skjer (eks. "Spill 1 har redusert kapasitet
 * — vi jobber med saken").
 *
 * Design:
 *   - Persistert i `app_status_incidents`-tabellen.
 *   - "Active" incidents (status != `resolved`) vises på status-siden.
 *   - "Resolved" incidents vises i historikk-listen med tidspunkt for
 *     når det ble løst.
 *   - Status-overganger: investigating → identified → monitoring → resolved.
 *     Klassisk Atlassian-style state machine (samme som statuspage.io
 *     bruker), så det er lett å bytte til en SaaS-leverandør senere.
 *
 * Service-laget eier validering, status-machine og audit-loggi via
 * `auditLogService` (samme mønster som CmsService og adminOpsService).
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "status-incident-service" });

const SCHEMA_RX = /^[a-z_][a-z0-9_]*$/i;

function assertSchemaName(schema: string): string {
  if (!SCHEMA_RX.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn for StatusIncidentService.");
  }
  return schema;
}

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Status av en incident. Klassisk lifecycle:
 *   - `investigating`: Vi har oppdaget problemet og undersøker.
 *   - `identified`   : Rotårsak funnet, jobber med å løse.
 *   - `monitoring`   : Fix er deployet, observerer at det fungerer.
 *   - `resolved`     : Ferdig løst.
 */
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

/**
 * Påvirkningsnivå på en incident. Mapped til UI-fargekoder.
 *   - `none`   : Informasjon (planlagt vedlikehold osv.) — grønn.
 *   - `minor`  : Liten påvirkning — gul.
 *   - `major`  : Stor påvirkning — oransje.
 *   - `critical`: Kritisk påvirkning — rød.
 */
export type IncidentImpact = "none" | "minor" | "major" | "critical";

export interface StatusIncident {
  id: string;
  /** Kort overskrift, vises som tittel på status-siden. */
  title: string;
  /** Body-tekst (markdown tillatt). Vises under tittelen. */
  description: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  /**
   * Hvilke komponenter er berørt — array av component-id'er (samme som i
   * `StatusService.checks`). Brukes for å markere riktige rader i
   * status-tabellen.
   */
  affectedComponents: string[];
  /** Hvem opprettet (audit). */
  createdByUserId: string | null;
  /** Sist oppdatert av. */
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Settet ved overgang til `resolved`. */
  resolvedAt: string | null;
}

export interface CreateIncidentInput {
  title: string;
  description: string;
  status?: IncidentStatus;
  impact?: IncidentImpact;
  affectedComponents?: string[];
  createdByUserId?: string | null;
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  status?: IncidentStatus;
  impact?: IncidentImpact;
  affectedComponents?: string[];
  updatedByUserId?: string | null;
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface StatusIncidentServiceDeps {
  pool: Pool;
  schema?: string;
  /** Klokke (test-injekteres). */
  now?: () => Date;
}

export class StatusIncidentService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly now: () => Date;

  constructor(deps: StatusIncidentServiceDeps) {
    this.pool = deps.pool;
    this.schema = assertSchemaName(deps.schema ?? "public");
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Returnerer alle ikke-løste incidents (synlige på offentlig status-side).
   */
  async listActive(): Promise<StatusIncident[]> {
    const sql = `
      SELECT * FROM ${this.schema}.app_status_incidents
      WHERE status != 'resolved'
      ORDER BY created_at DESC
    `;
    const result = await this.pool.query(sql);
    return result.rows.map(rowToIncident);
  }

  /**
   * Returnerer nylig løste + alle aktive — typisk siste 30 dager.
   * Bruk i historikk-tabellen på status-siden.
   */
  async listRecent(limit = 50): Promise<StatusIncident[]> {
    const sql = `
      SELECT * FROM ${this.schema}.app_status_incidents
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const result = await this.pool.query(sql, [Math.min(500, Math.max(1, limit))]);
    return result.rows.map(rowToIncident);
  }

  async getById(id: string): Promise<StatusIncident | null> {
    const sql = `
      SELECT * FROM ${this.schema}.app_status_incidents
      WHERE id = $1
    `;
    const result = await this.pool.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return rowToIncident(result.rows[0]);
  }

  async create(input: CreateIncidentInput): Promise<StatusIncident> {
    const validated = validateCreate(input);
    const id = randomUUID();
    const now = this.now();
    const status: IncidentStatus = validated.status ?? "investigating";
    const impact: IncidentImpact = validated.impact ?? "minor";

    const sql = `
      INSERT INTO ${this.schema}.app_status_incidents (
        id, title, description, status, impact, affected_components,
        created_by_user_id, updated_by_user_id, created_at, updated_at, resolved_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const resolvedAt = status === "resolved" ? now : null;
    const params = [
      id,
      validated.title,
      validated.description,
      status,
      impact,
      JSON.stringify(validated.affectedComponents ?? []),
      validated.createdByUserId ?? null,
      validated.createdByUserId ?? null,
      now,
      now,
      resolvedAt,
    ];
    const result = await this.pool.query(sql, params);
    log.info({ incidentId: id, status, impact }, "[status-incident] created");
    return rowToIncident(result.rows[0]);
  }

  async update(id: string, input: UpdateIncidentInput): Promise<StatusIncident> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new DomainError("INCIDENT_NOT_FOUND", `Hendelsen finnes ikke (id=${id}).`);
    }
    const validated = validateUpdate(input);

    const newStatus = validated.status ?? existing.status;
    const newImpact = validated.impact ?? existing.impact;
    const newTitle = validated.title ?? existing.title;
    const newDescription = validated.description ?? existing.description;
    const newAffected = validated.affectedComponents ?? existing.affectedComponents;
    const now = this.now();

    // Hvis status går FRA non-resolved TIL resolved → sett resolvedAt.
    // Hvis FRA resolved TIL non-resolved (re-åpning) → clear resolvedAt.
    let resolvedAt: Date | null = existing.resolvedAt ? new Date(existing.resolvedAt) : null;
    if (newStatus === "resolved" && existing.status !== "resolved") {
      resolvedAt = now;
    } else if (newStatus !== "resolved" && existing.status === "resolved") {
      resolvedAt = null;
    }

    const sql = `
      UPDATE ${this.schema}.app_status_incidents
      SET title = $1, description = $2, status = $3, impact = $4,
          affected_components = $5, updated_by_user_id = $6,
          updated_at = $7, resolved_at = $8
      WHERE id = $9
      RETURNING *
    `;
    const params = [
      newTitle,
      newDescription,
      newStatus,
      newImpact,
      JSON.stringify(newAffected),
      validated.updatedByUserId ?? existing.updatedByUserId,
      now,
      resolvedAt,
      id,
    ];
    const result = await this.pool.query(sql, params);
    log.info(
      { incidentId: id, status: newStatus, impact: newImpact },
      "[status-incident] updated",
    );
    return rowToIncident(result.rows[0]);
  }

  /**
   * Convenience-metode for å lukke en incident. Setter status til
   * `resolved` og fyller inn `resolvedAt`.
   */
  async resolve(id: string, updatedByUserId?: string | null): Promise<StatusIncident> {
    return this.update(id, { status: "resolved", updatedByUserId });
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_STATUSES: readonly IncidentStatus[] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];
const VALID_IMPACTS: readonly IncidentImpact[] = ["none", "minor", "major", "critical"];

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5_000;

function validateCreate(input: CreateIncidentInput): CreateIncidentInput {
  if (!input.title || !input.title.trim()) {
    throw new DomainError("INVALID_INPUT", "Tittel er påkrevd.");
  }
  if (input.title.trim().length > MAX_TITLE) {
    throw new DomainError("INVALID_INPUT", `Tittel kan ikke være lengre enn ${MAX_TITLE} tegn.`);
  }
  if (!input.description || !input.description.trim()) {
    throw new DomainError("INVALID_INPUT", "Beskrivelse er påkrevd.");
  }
  if (input.description.length > MAX_DESCRIPTION) {
    throw new DomainError(
      "INVALID_INPUT",
      `Beskrivelse kan ikke være lengre enn ${MAX_DESCRIPTION} tegn.`,
    );
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    throw new DomainError("INVALID_INPUT", `Ugyldig status: ${input.status}.`);
  }
  if (input.impact && !VALID_IMPACTS.includes(input.impact)) {
    throw new DomainError("INVALID_INPUT", `Ugyldig impact: ${input.impact}.`);
  }
  if (input.affectedComponents && !Array.isArray(input.affectedComponents)) {
    throw new DomainError("INVALID_INPUT", "affectedComponents må være en liste.");
  }
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
  };
}

function validateUpdate(input: UpdateIncidentInput): UpdateIncidentInput {
  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw new DomainError("INVALID_INPUT", "Tittel kan ikke være tom.");
    }
    if (input.title.trim().length > MAX_TITLE) {
      throw new DomainError("INVALID_INPUT", `Tittel kan ikke være lengre enn ${MAX_TITLE} tegn.`);
    }
  }
  if (input.description !== undefined) {
    if (!input.description.trim()) {
      throw new DomainError("INVALID_INPUT", "Beskrivelse kan ikke være tom.");
    }
    if (input.description.length > MAX_DESCRIPTION) {
      throw new DomainError(
        "INVALID_INPUT",
        `Beskrivelse kan ikke være lengre enn ${MAX_DESCRIPTION} tegn.`,
      );
    }
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    throw new DomainError("INVALID_INPUT", `Ugyldig status: ${input.status}.`);
  }
  if (input.impact && !VALID_IMPACTS.includes(input.impact)) {
    throw new DomainError("INVALID_INPUT", `Ugyldig impact: ${input.impact}.`);
  }
  if (input.affectedComponents !== undefined && !Array.isArray(input.affectedComponents)) {
    throw new DomainError("INVALID_INPUT", "affectedComponents må være en liste.");
  }
  return input;
}

// ── Row-mapping ──────────────────────────────────────────────────────────────

interface StatusIncidentRow {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  affected_components: string[] | string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
}

function rowToIncident(row: StatusIncidentRow): StatusIncident {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    impact: row.impact,
    affectedComponents: parseAffectedComponents(row.affected_components),
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    resolvedAt: asIsoOrNull(row.resolved_at),
  };
}

function parseAffectedComponents(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return asIso(value);
}
