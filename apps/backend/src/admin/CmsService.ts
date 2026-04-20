/**
 * BIN-676: CMS admin-service.
 *
 * Tekst-CRUD for fem statiske sider (aboutus, terms, support, links,
 * responsible-gaming) + full FAQ-CRUD. Service-laget eier slug-whitelist,
 * FEATURE_DISABLED-gate for `responsible-gaming` PUT (regulatorisk —
 * versjons-historikk kreves av BIN-680), og input-validering.
 *
 * Legacy-opphav:
 *   legacy/unity-backend/App/Models/cms.js (singleton-dokument med 5 felter)
 *   legacy/unity-backend/App/Models/faq.js
 *   legacy/unity-backend/App/Services/cmsServices.js
 *   legacy/unity-backend/App/Controllers/cmsController.js
 *
 * Mønster: samme struktur som SettingsService (BIN-677) og SavedGameService
 * (BIN-624). Object.create test-hook, idempotent ensureInitialized.
 *
 * FEATURE_DISABLED-gate:
 *   `responsible-gaming` er en regulatorisk-sensitiv side (pengespill-
 *   forskriften §11 krever versjons-historikk + diff-logging). BIN-680 vil
 *   implementere `app_cms_content_versions`-tabell og versjoneringsflyt.
 *   Inntil da: `updateContent(slug="responsible-gaming", ...)` kaster
 *   DomainError("FEATURE_DISABLED"). GET er ikke gated — admin må kunne
 *   lese gjeldende tekst for feilsøking selv uten edit.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "cms-service" });

/**
 * Gyldige CMS-slugs. Whitelist — ukjente slugs avvises. Matches legacy
 * `cmsModel` sine fem felter (terms, support, aboutus, responsible_gameing,
 * links), men normalisert til slug-form som brukes av frontend-URL-er.
 */
export const CMS_SLUGS = [
  "aboutus",
  "terms",
  "support",
  "links",
  "responsible-gaming",
] as const;
export type CmsSlug = (typeof CMS_SLUGS)[number];

/**
 * Slugs som krever versjons-historikk (pengespillforskriften §11). Inntil
 * BIN-680 lander, er PUT for disse gated av FEATURE_DISABLED. Listen er
 * eksplisitt slik at vi enkelt kan fjerne gaten når BIN-680 merges.
 */
export const CMS_VERSION_HISTORY_REQUIRED: readonly CmsSlug[] = [
  "responsible-gaming",
] as const;

export interface CmsContent {
  slug: CmsSlug;
  content: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaqInput {
  question: string;
  answer: string;
  sortOrder?: number;
  createdBy: string;
}

export interface UpdateFaqInput {
  question?: string;
  answer?: string;
  sortOrder?: number;
}

export interface CmsServiceOptions {
  connectionString: string;
  schema?: string;
}

interface CmsContentRow {
  slug: string;
  content: string;
  updated_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_by_user_id: string | null;
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

function assertValidSlug(value: unknown): CmsSlug {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "slug er påkrevd.");
  }
  const trimmed = value.trim() as CmsSlug;
  if (!CMS_SLUGS.includes(trimmed)) {
    throw new DomainError(
      "CMS_SLUG_UNKNOWN",
      `Ukjent CMS-slug: ${trimmed}. Gyldige: ${CMS_SLUGS.join(", ")}.`
    );
  }
  return trimmed;
}

function assertContentString(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "content må være en streng.");
  }
  // Maks 200 KB — gir romslig plass for HTML uten å åpne for misbruk.
  if (value.length > 200_000) {
    throw new DomainError(
      "INVALID_INPUT",
      "content kan maksimalt være 200000 tegn."
    );
  }
  return value;
}

function assertFaqText(value: unknown, field: string, max = 10_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${max} tegn.`
    );
  }
  return trimmed;
}

function assertSortOrder(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError("INVALID_INPUT", "sortOrder må være et tall.");
  }
  const int = Math.trunc(value);
  if (int < 0 || int > 100_000) {
    throw new DomainError(
      "INVALID_INPUT",
      "sortOrder må være mellom 0 og 100000."
    );
  }
  return int;
}

export class CmsService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: CmsServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for CmsService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): CmsService {
    const svc = Object.create(CmsService.prototype) as CmsService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private contentTable(): string {
    return `"${this.schema}"."app_cms_content"`;
  }

  private faqTable(): string {
    return `"${this.schema}"."app_cms_faq"`;
  }

  // ── CMS content (tekst-sider) ─────────────────────────────────────────

  /**
   * Hent tekst-side. Returnerer en tom-default hvis slugen ikke har blitt
   * skrevet tidligere — admin-UI kan da redigere og lagre.
   */
  async getContent(slug: string): Promise<CmsContent> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(slug);
    const { rows } = await this.pool.query<CmsContentRow>(
      `SELECT slug, content, updated_by_user_id, created_at, updated_at
       FROM ${this.contentTable()}
       WHERE slug = $1`,
      [validSlug]
    );
    const row = rows[0];
    if (row) {
      return {
        slug: validSlug,
        content: row.content,
        updatedByUserId: row.updated_by_user_id,
        createdAt: asIso(row.created_at),
        updatedAt: asIso(row.updated_at),
      };
    }
    // Returner en syntetisk tom rad — lettere for admin-UI å håndtere enn
    // 404 (slugen ER gyldig, den har bare ikke blitt skrevet).
    const nowIso = new Date().toISOString();
    return {
      slug: validSlug,
      content: "",
      updatedByUserId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  /**
   * Upsert tekst-side. Kaster FEATURE_DISABLED for `responsible-gaming`
   * inntil BIN-680 implementerer versjons-historikk (regulatorisk krav).
   */
  async updateContent(
    slug: string,
    content: unknown,
    actorUserId: string | null
  ): Promise<CmsContent> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(slug);
    if (CMS_VERSION_HISTORY_REQUIRED.includes(validSlug)) {
      throw new DomainError(
        "FEATURE_DISABLED",
        `Redigering av '${validSlug}' krever versjons-historikk (pengespillforskriften §11) og er foreløpig deaktivert. Blokkert av BIN-680.`
      );
    }
    const validContent = assertContentString(content);
    try {
      await this.pool.query(
        `INSERT INTO ${this.contentTable()}
           (slug, content, updated_by_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET
           content = EXCLUDED.content,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
        [validSlug, validContent, actorUserId]
      );
    } catch (err) {
      if (err instanceof DomainError) throw err;
      logger.error({ err, slug: validSlug }, "[BIN-676] content upsert failed");
      throw new DomainError(
        "CMS_UPDATE_FAILED",
        "Kunne ikke oppdatere CMS-innhold."
      );
    }
    return this.getContent(validSlug);
  }

  // ── FAQ CRUD ──────────────────────────────────────────────────────────

  async listFaq(): Promise<FaqEntry[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<FaqRow>(
      `SELECT id, question, answer, sort_order,
              created_by_user_id, updated_by_user_id,
              created_at, updated_at
       FROM ${this.faqTable()}
       ORDER BY sort_order ASC, created_at ASC`
    );
    return rows.map((row) => this.mapFaqRow(row));
  }

  async getFaq(id: string): Promise<FaqEntry> {
    await this.ensureInitialized();
    if (typeof id !== "string" || !id.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<FaqRow>(
      `SELECT id, question, answer, sort_order,
              created_by_user_id, updated_by_user_id,
              created_at, updated_at
       FROM ${this.faqTable()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("FAQ_NOT_FOUND", "FAQ-oppføring finnes ikke.");
    }
    return this.mapFaqRow(row);
  }

  async createFaq(input: CreateFaqInput): Promise<FaqEntry> {
    await this.ensureInitialized();
    const question = assertFaqText(input.question, "question", 1_000);
    const answer = assertFaqText(input.answer, "answer", 10_000);
    const sortOrder =
      input.sortOrder === undefined ? 0 : assertSortOrder(input.sortOrder);
    if (typeof input.createdBy !== "string" || !input.createdBy.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.faqTable()}
           (id, question, answer, sort_order, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [id, question, answer, sortOrder, input.createdBy.trim()]
      );
    } catch (err) {
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-676] faq insert failed");
      throw new DomainError("FAQ_CREATE_FAILED", "Kunne ikke opprette FAQ.");
    }
    return this.getFaq(id);
  }

  async updateFaq(
    id: string,
    update: UpdateFaqInput,
    actorUserId: string | null
  ): Promise<FaqEntry> {
    await this.ensureInitialized();
    const existing = await this.getFaq(id);

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.question !== undefined) {
      sets.push(`question = $${params.length + 1}`);
      params.push(assertFaqText(update.question, "question", 1_000));
    }
    if (update.answer !== undefined) {
      sets.push(`answer = $${params.length + 1}`);
      params.push(assertFaqText(update.answer, "answer", 10_000));
    }
    if (update.sortOrder !== undefined) {
      sets.push(`sort_order = $${params.length + 1}`);
      params.push(assertSortOrder(update.sortOrder));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    sets.push(`updated_by_user_id = $${params.length + 1}`);
    params.push(actorUserId);
    sets.push("updated_at = now()");
    params.push(existing.id);
    try {
      await this.pool.query(
        `UPDATE ${this.faqTable()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}`,
        params
      );
    } catch (err) {
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-676] faq update failed");
      throw new DomainError("FAQ_UPDATE_FAILED", "Kunne ikke oppdatere FAQ.");
    }
    return this.getFaq(existing.id);
  }

  async deleteFaq(id: string): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.getFaq(id);
    await this.pool.query(`DELETE FROM ${this.faqTable()} WHERE id = $1`, [
      existing.id,
    ]);
  }

  private mapFaqRow(row: FaqRow): FaqEntry {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      sortOrder: row.sort_order,
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
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
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.contentTable()} (
          slug TEXT PRIMARY KEY,
          content TEXT NOT NULL DEFAULT '',
          updated_by_user_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.faqTable()} (
          id TEXT PRIMARY KEY,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_by_user_id TEXT NULL,
          updated_by_user_id TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cms_faq_sort_order
         ON ${this.faqTable()}(sort_order ASC, created_at ASC)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-676] cms schema init failed");
      throw new DomainError(
        "CMS_INIT_FAILED",
        "Kunne ikke initialisere cms-tabeller."
      );
    } finally {
      client.release();
    }
  }
}
