/**
 * BIN-676 + BIN-680: CMS admin-service.
 *
 * Tekst-CRUD for fem statiske sider (aboutus, terms, support, links,
 * responsible-gaming) + full FAQ-CRUD. Service-laget eier slug-whitelist,
 * input-validering, og (BIN-680 Lag 1) regulatorisk versjonering for
 * `responsible-gaming` og andre slugs i `CMS_VERSION_HISTORY_REQUIRED`.
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
 * BIN-680 Lag 1 — versjons-historikk (pengespillforskriften §11):
 *   Regulatoriske slugs krever versjonert redigerings-flyt:
 *     draft → review → approved → live → retired
 *   4-øyne: approve kastes FOUR_EYES_VIOLATION hvis approver === creator.
 *   Publiser promoterer approved → live og retirer forrige live-versjon i
 *   samme transaksjon. Tabellen er append-only bortsett fra status-metadata.
 *
 *   `updateContent()` for regulatoriske slugs oppretter nå en ny draft-
 *   versjon (tidligere FEATURE_DISABLED-gate). For ikke-regulatoriske slugs
 *   beholdes den opprinnelige upsert-semantikken for bakoverkompatibilitet.
 *
 *   `getContent()` for regulatoriske slugs returnerer gjeldende LIVE-versjons
 *   innhold — ikke noe av draft/review/approved. Hvis ingen live eksisterer,
 *   returneres tom streng.
 *
 *   Lag 2 (player-facing GET /api/spillvett/text) og Lag 3 (consent-sporing)
 *   er IKKE i scope for Lag 1.
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

// ── BIN-680 Lag 1: versjons-typer ──────────────────────────────────────────

export type CmsVersionStatus =
  | "draft"
  | "review"
  | "approved"
  | "live"
  | "retired";

export const CMS_VERSION_STATUSES: readonly CmsVersionStatus[] = [
  "draft",
  "review",
  "approved",
  "live",
  "retired",
] as const;

/**
 * Persistent versjon-post fra `app_cms_content_versions`.
 * Immutable bortsett fra status-metadata (approvedBy/publishedBy/retiredAt).
 */
export interface CmsContentVersion {
  id: string;
  slug: CmsSlug;
  versionNumber: number;
  content: string;
  status: CmsVersionStatus;
  createdByUserId: string;
  createdAt: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  publishedByUserId: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
}

export interface CreateVersionInput {
  slug: string;
  content: unknown;
  createdByUserId: string;
}

export interface VersionTransitionInput {
  versionId: string;
  userId: string;
}

export interface ApproveVersionInput {
  versionId: string;
  approvedByUserId: string;
}

export interface PublishVersionInput {
  versionId: string;
  publishedByUserId: string;
}

/**
 * Resultat av publish: returnerer både den nye live-versjonen og evt.
 * den forrige live-versjonen som ble retirert. Lar route-laget audit-logge
 * `previousLiveVersionId` uten å måtte gjøre en ekstra query.
 */
export interface PublishVersionResult {
  live: CmsContentVersion;
  previousLiveVersionId: string | null;
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
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
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

interface CmsContentVersionRow {
  id: string;
  slug: string;
  version_number: number;
  content: string;
  status: CmsVersionStatus;
  created_by_user_id: string;
  created_at: Date | string;
  approved_by_user_id: string | null;
  approved_at: Date | string | null;
  published_by_user_id: string | null;
  published_at: Date | string | null;
  retired_at: Date | string | null;
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

function assertUserId(value: unknown, field = "userId"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  return value.trim();
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return asIso(value);
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
        "CmsService krever pool eller connectionString."
      );
    }
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

  private contentVersionsTable(): string {
    return `"${this.schema}"."app_cms_content_versions"`;
  }

  /**
   * BIN-680 Lag 1: identifiser om en slug krever versjonert flyt.
   * Bevart som public getter slik at route-laget kan velge ulike audit-
   * actions per slug uten å hardkode listen to steder.
   */
  static requiresVersionHistory(slug: CmsSlug): boolean {
    return CMS_VERSION_HISTORY_REQUIRED.includes(slug);
  }

  // ── CMS content (tekst-sider) ─────────────────────────────────────────

  /**
   * Hent tekst-side. For regulatoriske slugs returneres live-versjonens
   * innhold (eller tom streng hvis ingen live eksisterer). For ikke-
   * regulatoriske slugs returneres den tradisjonelle `app_cms_content`-raden.
   */
  async getContent(slug: string): Promise<CmsContent> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(slug);

    // BIN-680: regulatoriske slugs henter live-versjonen i stedet for
    // `app_cms_content`-raden. Ingen live = tom streng (admin-UI viser
    // tom textarea + lager første draft på neste save).
    if (CmsService.requiresVersionHistory(validSlug)) {
      const live = await this.getLiveVersion(validSlug);
      if (live) {
        return {
          slug: validSlug,
          content: live.content,
          updatedByUserId: live.publishedByUserId ?? live.createdByUserId,
          createdAt: live.createdAt,
          updatedAt: live.publishedAt ?? live.createdAt,
        };
      }
      const nowIso = new Date().toISOString();
      return {
        slug: validSlug,
        content: "",
        updatedByUserId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

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
   * Oppdater tekst-side.
   *
   * Ikke-regulatoriske slugs: tradisjonell upsert (bakoverkompatibel).
   *
   * Regulatoriske slugs (BIN-680 Lag 1): oppretter en ny DRAFT-versjon
   * automatisk. PUT /api/admin/cms/:slug blir ekvivalent med POST
   * /api/admin/cms/:slug/versions for disse. Returnerer den syntetiske
   * CmsContent-visningen av den nyopprettede draften slik at eksisterende
   * admin-klient fortsatt fungerer — men gjeldende live-versjon forblir
   * uendret inntil draft er sendt til review → approved → published.
   */
  async updateContent(
    slug: string,
    content: unknown,
    actorUserId: string | null
  ): Promise<CmsContent> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(slug);

    if (CmsService.requiresVersionHistory(validSlug)) {
      if (!actorUserId || !actorUserId.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          "actorUserId er påkrevd for regulatorisk slug (versjons-historikk)."
        );
      }
      const draft = await this.createVersion({
        slug: validSlug,
        content,
        createdByUserId: actorUserId,
      });
      return {
        slug: validSlug,
        content: draft.content,
        updatedByUserId: draft.createdByUserId,
        createdAt: draft.createdAt,
        updatedAt: draft.createdAt,
      };
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

  // ── BIN-680 Lag 1: versjons-API ────────────────────────────────────────

  /**
   * Opprett en ny draft-versjon for en regulatorisk slug.
   * Tildeler version_number = (max_for_slug + 1) i samme transaksjon som
   * INSERT for å unngå race (to samtidige draft-opprettelser).
   */
  async createVersion(input: CreateVersionInput): Promise<CmsContentVersion> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(input.slug);
    if (!CmsService.requiresVersionHistory(validSlug)) {
      throw new DomainError(
        "CMS_SLUG_NOT_VERSIONED",
        `Slug '${validSlug}' krever ikke versjons-historikk. Bruk updateContent() i stedet.`
      );
    }
    const validContent = assertContentString(input.content);
    const createdBy = assertUserId(input.createdByUserId, "createdByUserId");
    const id = randomUUID();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: maxRows } = await client.query<{ max: number | null }>(
        `SELECT MAX(version_number) AS max
         FROM ${this.contentVersionsTable()}
         WHERE slug = $1`,
        [validSlug]
      );
      const nextVersion = (maxRows[0]?.max ?? 0) + 1;
      await client.query(
        `INSERT INTO ${this.contentVersionsTable()}
           (id, slug, version_number, content, status, created_by_user_id)
         VALUES ($1, $2, $3, $4, 'draft', $5)`,
        [id, validSlug, nextVersion, validContent, createdBy]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (err instanceof DomainError) throw err;
      logger.error(
        { err, slug: validSlug },
        "[BIN-680] createVersion failed"
      );
      throw new DomainError(
        "CMS_VERSION_CREATE_FAILED",
        "Kunne ikke opprette ny versjon."
      );
    } finally {
      client.release();
    }
    return this.getVersionById(id);
  }

  /**
   * draft → review. Samme admin kan sende til review (første trinn av 4-øyne
   * er at en annen admin approver).
   */
  async submitForReview(
    input: VersionTransitionInput
  ): Promise<CmsContentVersion> {
    await this.ensureInitialized();
    const versionId = assertUserId(input.versionId, "versionId");
    assertUserId(input.userId, "userId");

    const version = await this.getVersionById(versionId);
    if (version.status !== "draft") {
      throw new DomainError(
        "CMS_VERSION_INVALID_TRANSITION",
        `Kan ikke sende versjon i status '${version.status}' til review; kun 'draft' er tillatt.`
      );
    }
    await this.pool.query(
      `UPDATE ${this.contentVersionsTable()}
         SET status = 'review'
       WHERE id = $1 AND status = 'draft'`,
      [versionId]
    );
    return this.getVersionById(versionId);
  }

  /**
   * review → approved. 4-øyne: approver må være forskjellig fra creator.
   * Håndheves både i service-lag (tidlig fail) og DB-CHECK (siste forsvars-
   * linje).
   */
  async approveVersion(
    input: ApproveVersionInput
  ): Promise<CmsContentVersion> {
    await this.ensureInitialized();
    const versionId = assertUserId(input.versionId, "versionId");
    const approvedBy = assertUserId(input.approvedByUserId, "approvedByUserId");

    const version = await this.getVersionById(versionId);
    if (version.status !== "review") {
      throw new DomainError(
        "CMS_VERSION_INVALID_TRANSITION",
        `Kan ikke godkjenne versjon i status '${version.status}'; kun 'review' er tillatt.`
      );
    }
    if (approvedBy === version.createdByUserId) {
      throw new DomainError(
        "FOUR_EYES_VIOLATION",
        "Godkjenner må være en annen admin enn skaper (pengespillforskriften §11)."
      );
    }

    try {
      await this.pool.query(
        `UPDATE ${this.contentVersionsTable()}
           SET status = 'approved',
               approved_by_user_id = $2,
               approved_at = now()
         WHERE id = $1 AND status = 'review'`,
        [versionId, approvedBy]
      );
    } catch (err) {
      if (err instanceof DomainError) throw err;
      logger.error(
        { err, versionId },
        "[BIN-680] approveVersion DB-check failed"
      );
      throw new DomainError(
        "CMS_VERSION_APPROVE_FAILED",
        "Kunne ikke godkjenne versjon."
      );
    }
    return this.getVersionById(versionId);
  }

  /**
   * approved → live. Retirer forrige live-versjon i samme transaksjon, og
   * oppdaterer `app_cms_content.live_version_id` som FK-cache. Returnerer
   * både den nye live-versjonen og ID for den forrige live-versjonen (for
   * audit-detaljer).
   */
  async publishVersion(
    input: PublishVersionInput
  ): Promise<PublishVersionResult> {
    await this.ensureInitialized();
    const versionId = assertUserId(input.versionId, "versionId");
    const publishedBy = assertUserId(
      input.publishedByUserId,
      "publishedByUserId"
    );

    const version = await this.getVersionById(versionId);
    if (version.status !== "approved") {
      throw new DomainError(
        "CMS_VERSION_INVALID_TRANSITION",
        `Kan ikke publisere versjon i status '${version.status}'; kun 'approved' er tillatt.`
      );
    }

    let previousLiveVersionId: string | null = null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Retire gammel live for samme slug (om det finnes).
      const { rows: oldLive } = await client.query<{ id: string }>(
        `SELECT id
         FROM ${this.contentVersionsTable()}
         WHERE slug = $1 AND status = 'live'
         FOR UPDATE`,
        [version.slug]
      );
      if (oldLive[0]) {
        previousLiveVersionId = oldLive[0].id;
        await client.query(
          `UPDATE ${this.contentVersionsTable()}
             SET status = 'retired',
                 retired_at = now()
           WHERE id = $1`,
          [previousLiveVersionId]
        );
      }

      // Promoter approved → live.
      await client.query(
        `UPDATE ${this.contentVersionsTable()}
           SET status = 'live',
               published_by_user_id = $2,
               published_at = now()
         WHERE id = $1 AND status = 'approved'`,
        [versionId, publishedBy]
      );

      // Oppdater app_cms_content med FK-cache. Siden regulatoriske slugs
      // ikke lenger bruker `content`-kolonnen som sannhetskilde, skriver vi
      // en tom streng der — actual content leses alltid via live-versjon i
      // getContent().
      await client.query(
        `INSERT INTO ${this.contentTable()}
           (slug, content, updated_by_user_id, live_version_id, live_version_number, updated_at)
         VALUES ($1, '', $2, $3, $4, now())
         ON CONFLICT (slug) DO UPDATE SET
           live_version_id = EXCLUDED.live_version_id,
           live_version_number = EXCLUDED.live_version_number,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
        [version.slug, publishedBy, versionId, version.versionNumber]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (err instanceof DomainError) throw err;
      logger.error(
        { err, versionId },
        "[BIN-680] publishVersion failed"
      );
      throw new DomainError(
        "CMS_VERSION_PUBLISH_FAILED",
        "Kunne ikke publisere versjon."
      );
    } finally {
      client.release();
    }

    const live = await this.getVersionById(versionId);
    return { live, previousLiveVersionId };
  }

  /**
   * Hent én versjon by id. Kaster CMS_VERSION_NOT_FOUND om ikke finnes.
   */
  async getVersionById(id: string): Promise<CmsContentVersion> {
    await this.ensureInitialized();
    const validId = assertUserId(id, "id");
    const { rows } = await this.pool.query<CmsContentVersionRow>(
      `SELECT id, slug, version_number, content, status,
              created_by_user_id, created_at,
              approved_by_user_id, approved_at,
              published_by_user_id, published_at, retired_at
       FROM ${this.contentVersionsTable()}
       WHERE id = $1`,
      [validId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "CMS_VERSION_NOT_FOUND",
        `Versjon finnes ikke: ${validId}`
      );
    }
    return this.mapVersionRow(row);
  }

  /**
   * Hent gjeldende live-versjon for en slug, eller null hvis ingen.
   */
  async getLiveVersion(slug: string): Promise<CmsContentVersion | null> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(slug);
    const { rows } = await this.pool.query<CmsContentVersionRow>(
      `SELECT id, slug, version_number, content, status,
              created_by_user_id, created_at,
              approved_by_user_id, approved_at,
              published_by_user_id, published_at, retired_at
       FROM ${this.contentVersionsTable()}
       WHERE slug = $1 AND status = 'live'
       ORDER BY version_number DESC
       LIMIT 1`,
      [validSlug]
    );
    const row = rows[0];
    return row ? this.mapVersionRow(row) : null;
  }

  /**
   * Hent full versjons-historikk (alle statuser) sortert nyeste → eldste.
   */
  async getVersionHistory(slug: string): Promise<CmsContentVersion[]> {
    await this.ensureInitialized();
    const validSlug = assertValidSlug(slug);
    const { rows } = await this.pool.query<CmsContentVersionRow>(
      `SELECT id, slug, version_number, content, status,
              created_by_user_id, created_at,
              approved_by_user_id, approved_at,
              published_by_user_id, published_at, retired_at
       FROM ${this.contentVersionsTable()}
       WHERE slug = $1
       ORDER BY version_number DESC`,
      [validSlug]
    );
    return rows.map((row) => this.mapVersionRow(row));
  }

  private mapVersionRow(row: CmsContentVersionRow): CmsContentVersion {
    return {
      id: row.id,
      slug: row.slug as CmsSlug,
      versionNumber: row.version_number,
      content: row.content,
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdAt: asIso(row.created_at),
      approvedByUserId: row.approved_by_user_id,
      approvedAt: asIsoOrNull(row.approved_at),
      publishedByUserId: row.published_by_user_id,
      publishedAt: asIsoOrNull(row.published_at),
      retiredAt: asIsoOrNull(row.retired_at),
    };
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
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          live_version_id TEXT NULL,
          live_version_number INTEGER NULL
        )`
      );
      // BIN-680: legg til live_version-kolonnene hvis tabellen ble opprettet
      // før migration 20260700000000. IF NOT EXISTS-ALTER er idempotent.
      await client.query(
        `ALTER TABLE ${this.contentTable()}
           ADD COLUMN IF NOT EXISTS live_version_id TEXT NULL,
           ADD COLUMN IF NOT EXISTS live_version_number INTEGER NULL`
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
      // BIN-680: regulatorisk versjons-historikk-tabell.
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.contentVersionsTable()} (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'live', 'retired')),
          created_by_user_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          approved_by_user_id TEXT NULL,
          approved_at TIMESTAMPTZ NULL,
          published_by_user_id TEXT NULL,
          published_at TIMESTAMPTZ NULL,
          retired_at TIMESTAMPTZ NULL,
          UNIQUE (slug, version_number),
          CONSTRAINT cms_content_versions_four_eyes_chk
            CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> created_by_user_id)
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cms_content_versions_slug_live
         ON ${this.contentVersionsTable()}(slug) WHERE status = 'live'`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_cms_content_versions_slug_history
         ON ${this.contentVersionsTable()}(slug, version_number DESC)`
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
