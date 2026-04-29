/**
 * BIN-587 B3-aml: AML red-flag service.
 *
 * Forenklet første-versjon: manuell flagging + en "scan now"-stub. Rule-
 * engine som automatisk genererer flagginger når en terskel overskrides
 * legges som follow-up under BIN-582 (crons-epic har allerede JobScheduler-
 * infrastruktur).
 *
 * Flaggene lever i egen tabell (`app_aml_red_flags`) med kopi av rule-slug
 * — det gjør at historikk bevares selv om en regel slettes/inaktiveres.
 *
 * AuditLogService brukes for alle mutasjoner (create/review). Audit-calls
 * gjøres av kaller (router-laget) med `actor + reason` — vi stoler på at
 * routeren allerede har autentisert brukeren og legger ikke inn redundant
 * logging her.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type { PaymentRequestService, PaymentRequest } from "../payments/PaymentRequestService.js";

const logger = rootLogger.child({ module: "aml-service" });

export type AmlSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AmlFlagStatus = "OPEN" | "REVIEWED" | "DISMISSED" | "ESCALATED";
export type AmlReviewOutcome = "REVIEWED" | "DISMISSED" | "ESCALATED";

const VALID_SEVERITIES: AmlSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const VALID_STATUSES: AmlFlagStatus[] = ["OPEN", "REVIEWED", "DISMISSED", "ESCALATED"];
const VALID_OUTCOMES: AmlReviewOutcome[] = ["REVIEWED", "DISMISSED", "ESCALATED"];

/** Fast slug for manuell flagging — ikke knyttet til en konkret regel. */
export const MANUAL_FLAG_SLUG = "manual";

export interface AmlRule {
  id: string;
  slug: string;
  label: string;
  severity: AmlSeverity;
  thresholdAmountCents: number | null;
  windowDays: number | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AmlRuleInput {
  slug: string;
  label: string;
  severity: AmlSeverity;
  thresholdAmountCents?: number | null;
  windowDays?: number | null;
  description?: string | null;
  isActive?: boolean;
}

export interface AmlRedFlag {
  id: string;
  userId: string;
  ruleSlug: string;
  severity: AmlSeverity;
  status: AmlFlagStatus;
  reason: string;
  transactionId: string | null;
  details: Record<string, unknown> | null;
  openedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewOutcome: AmlReviewOutcome | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRedFlagInput {
  userId: string;
  ruleSlug?: string;
  severity: AmlSeverity;
  reason: string;
  transactionId?: string | null;
  details?: Record<string, unknown> | null;
  openedBy: string | null;
}

export interface ListRedFlagsFilter {
  status?: AmlFlagStatus;
  severity?: AmlSeverity;
  userId?: string;
  limit?: number;
}

export interface ReviewRedFlagInput {
  flagId: string;
  reviewerId: string;
  outcome: AmlReviewOutcome;
  note: string;
}

export interface ListTransactionsForReviewInput {
  userId: string;
  from?: string;
  to?: string;
  minAmountCents?: number;
  limit?: number;
}

export interface ScanResult {
  scanned: number;
  flagsCreated: number;
  ruleSlugsEvaluated: string[];
}

/**
 * BIN-650: aggregerings-resultat per AML rule-kategori. Én rad per `rule_slug`
 * som ENTEN har en rule-rad i `app_aml_rules` ELLER har minst én red-flag
 * opprettet i `[from, to]`-vinduet. Slug-er som finnes i rules-katalogen uten
 * flag-rader i vinduet returneres med `count=0`/`openCount=0` slik at UI-en
 * kan vise kategori-listen konsistent.
 */
export interface AmlCategoryCountRow {
  slug: string;
  label: string;
  severity: AmlSeverity;
  description: string | null;
  count: number;
  openCount: number;
}

export interface AggregateCategoryCountsInput {
  from?: string;
  to?: string;
}

export interface AmlServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
  paymentRequestService: PaymentRequestService;
}

interface RuleRow {
  id: string;
  slug: string;
  label: string;
  severity: AmlSeverity;
  threshold_amount_cents: string | number | null;
  window_days: number | null;
  description: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RedFlagRow {
  id: string;
  user_id: string;
  rule_slug: string;
  severity: AmlSeverity;
  status: AmlFlagStatus;
  reason: string;
  transaction_id: string | null;
  details: Record<string, unknown> | null;
  opened_by: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  review_outcome: AmlReviewOutcome | null;
  review_note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
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

function assertSeverity(value: unknown): AmlSeverity {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "severity må være en streng.");
  }
  const upper = value.trim().toUpperCase() as AmlSeverity;
  if (!VALID_SEVERITIES.includes(upper)) {
    throw new DomainError("INVALID_INPUT", `severity må være én av ${VALID_SEVERITIES.join(", ")}.`);
  }
  return upper;
}

function assertReason(value: unknown, field = "reason"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 1000) {
    throw new DomainError("INVALID_INPUT", `${field} er for lang (maks 1000 tegn).`);
  }
  return trimmed;
}

export class AmlService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly paymentRequestService: PaymentRequestService;
  private initPromise: Promise<void> | null = null;

  constructor(options: AmlServiceOptions) {
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
        "AmlService krever pool eller connectionString."
      );
    }
    this.paymentRequestService = options.paymentRequestService;
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    paymentRequestService: PaymentRequestService,
    schema = "public"
  ): AmlService {
    const svc = Object.create(AmlService.prototype) as AmlService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { paymentRequestService: PaymentRequestService }).paymentRequestService =
      paymentRequestService;
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private rulesTable(): string {
    return `"${this.schema}"."app_aml_rules"`;
  }

  private flagsTable(): string {
    return `"${this.schema}"."app_aml_red_flags"`;
  }

  // ── Rules ───────────────────────────────────────────────────────────────

  async listRules(): Promise<AmlRule[]> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<RuleRow>(
      `SELECT id, slug, label, severity, threshold_amount_cents, window_days, description, is_active, created_at, updated_at
       FROM ${this.rulesTable()}
       ORDER BY slug ASC`
    );
    return rows.map((r) => this.mapRule(r));
  }

  /**
   * Bulk-upsert av regler. Eksisterende regler med samme slug oppdateres;
   * nye opprettes. Regler som finnes i DB men IKKE i input markeres som
   * is_active = false (soft-disable) — vi sletter ikke rader for å bevare
   * historikken på eksisterende flag som peker på slug-en.
   */
  async upsertRules(input: AmlRuleInput[]): Promise<AmlRule[]> {
    await this.ensureInitialized();
    if (!Array.isArray(input)) {
      throw new DomainError("INVALID_INPUT", "rules må være en array.");
    }
    if (input.length > 200) {
      throw new DomainError("INVALID_INPUT", "Maks 200 regler per oppdatering.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const receivedSlugs: string[] = [];
      for (const raw of input) {
        const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
        if (!slug || !/^[a-z0-9_\-]+$/i.test(slug) || slug.length > 64) {
          throw new DomainError("INVALID_INPUT", `Ugyldig rule-slug: ${slug || "(tom)"}`);
        }
        if (slug === MANUAL_FLAG_SLUG) {
          throw new DomainError("INVALID_INPUT", `Slug "${MANUAL_FLAG_SLUG}" er reservert for manuell flagging.`);
        }
        const label = typeof raw.label === "string" ? raw.label.trim() : "";
        if (!label || label.length > 200) {
          throw new DomainError("INVALID_INPUT", "label er påkrevd (maks 200 tegn).");
        }
        const severity = assertSeverity(raw.severity);
        const threshold =
          raw.thresholdAmountCents === null || raw.thresholdAmountCents === undefined
            ? null
            : Number(raw.thresholdAmountCents);
        if (threshold !== null && (!Number.isFinite(threshold) || !Number.isInteger(threshold) || threshold < 0)) {
          throw new DomainError("INVALID_INPUT", "thresholdAmountCents må være et ikke-negativt heltall eller null.");
        }
        const windowDays =
          raw.windowDays === null || raw.windowDays === undefined ? null : Number(raw.windowDays);
        if (windowDays !== null && (!Number.isFinite(windowDays) || !Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 3650)) {
          throw new DomainError("INVALID_INPUT", "windowDays må være et positivt heltall (eller null).");
        }
        const description =
          raw.description === null || raw.description === undefined
            ? null
            : typeof raw.description === "string" && raw.description.trim()
              ? raw.description.trim().slice(0, 1000)
              : null;
        const isActive = typeof raw.isActive === "boolean" ? raw.isActive : true;

        receivedSlugs.push(slug);
        await client.query(
          `INSERT INTO ${this.rulesTable()} (id, slug, label, severity, threshold_amount_cents, window_days, description, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (slug) DO UPDATE SET
             label = EXCLUDED.label,
             severity = EXCLUDED.severity,
             threshold_amount_cents = EXCLUDED.threshold_amount_cents,
             window_days = EXCLUDED.window_days,
             description = EXCLUDED.description,
             is_active = EXCLUDED.is_active,
             updated_at = now()`,
          [randomUUID(), slug, label, severity, threshold, windowDays, description, isActive]
        );
      }
      // Soft-disable regler som ikke var i input.
      if (receivedSlugs.length > 0) {
        await client.query(
          `UPDATE ${this.rulesTable()}
           SET is_active = false, updated_at = now()
           WHERE slug <> ALL($1::text[]) AND is_active = true`,
          [receivedSlugs]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-587 B3-aml] upsertRules failed");
      throw new DomainError("AML_RULES_UPSERT_FAILED", "Kunne ikke oppdatere AML-regler.");
    } finally {
      client.release();
    }
    return this.listRules();
  }

  // ── Red-flags ───────────────────────────────────────────────────────────

  async listRedFlags(filter: ListRedFlagsFilter = {}): Promise<AmlRedFlag[]> {
    await this.ensureInitialized();
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filter.status) {
      if (!VALID_STATUSES.includes(filter.status)) {
        throw new DomainError("INVALID_INPUT", "Ugyldig status.");
      }
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.severity) {
      params.push(assertSeverity(filter.severity));
      conditions.push(`severity = $${params.length}`);
    }
    if (filter.userId) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<RedFlagRow>(
      `SELECT id, user_id, rule_slug, severity, status, reason, transaction_id, details,
              opened_by, reviewed_by, reviewed_at, review_outcome, review_note, created_at, updated_at
       FROM ${this.flagsTable()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapRedFlag(r));
  }

  async getRedFlag(id: string): Promise<AmlRedFlag> {
    await this.ensureInitialized();
    if (!id || typeof id !== "string") {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<RedFlagRow>(
      `SELECT id, user_id, rule_slug, severity, status, reason, transaction_id, details,
              opened_by, reviewed_by, reviewed_at, review_outcome, review_note, created_at, updated_at
       FROM ${this.flagsTable()}
       WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("AML_FLAG_NOT_FOUND", "Red-flag finnes ikke.");
    }
    return this.mapRedFlag(row);
  }

  async listFlagsForUser(userId: string, limit = 100): Promise<AmlRedFlag[]> {
    return this.listRedFlags({ userId, limit });
  }

  /**
   * BIN-650: teller red-flag-rader per `rule_slug` (= kategori) innenfor et
   * valgfritt `[from, to]`-vindu (filtreres på `created_at`). Alle aktive
   * rules i `app_aml_rules` returneres alltid — også de med null flag i
   * vinduet — slik at admin-UI kan vise full katalog.
   *
   * Pengespillforskriften §11: admin trenger en oversikt over hvor mange
   * spillere som har truffet hver red-flag-kategori for å vurdere
   * forebyggende tiltak. `count` er totalen; `openCount` er subsettet som
   * fortsatt er uløst (status='OPEN').
   */
  async aggregateCategoryCounts(
    input: AggregateCategoryCountsInput = {}
  ): Promise<AmlCategoryCountRow[]> {
    await this.ensureInitialized();
    const params: unknown[] = [];
    const flagConditions: string[] = [];
    if (input.from) {
      const fromMs = Date.parse(input.from);
      if (!Number.isFinite(fromMs)) {
        throw new DomainError("INVALID_INPUT", "'from' må være en ISO-8601 dato/tid.");
      }
      params.push(new Date(fromMs).toISOString());
      flagConditions.push(`created_at >= $${params.length}`);
    }
    if (input.to) {
      const toMs = Date.parse(input.to);
      if (!Number.isFinite(toMs)) {
        throw new DomainError("INVALID_INPUT", "'to' må være en ISO-8601 dato/tid.");
      }
      params.push(new Date(toMs).toISOString());
      flagConditions.push(`created_at <= $${params.length}`);
    }
    if (input.from && input.to && Date.parse(input.from) > Date.parse(input.to)) {
      throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
    }
    const flagWhere = flagConditions.length ? `WHERE ${flagConditions.join(" AND ")}` : "";

    // FULL OUTER JOIN: hver aktiv rule OG hver slug som faktisk har flagg
    // i vinduet. Rules som ikke har flagg i vinduet gir count=0. Flagg
    // med slug som ikke lenger finnes i rules-katalogen (f.eks. soft-
    // disabled eller `manual`) returneres også slik at tellingen blir
    // fullstendig.
    const sql = `
      WITH flag_counts AS (
        SELECT rule_slug,
               COUNT(*)::bigint AS cnt,
               COUNT(*) FILTER (WHERE status = 'OPEN')::bigint AS open_cnt,
               MAX(severity) AS observed_severity
          FROM ${this.flagsTable()}
          ${flagWhere}
         GROUP BY rule_slug
      )
      SELECT COALESCE(r.slug, f.rule_slug)                 AS slug,
             COALESCE(r.label, f.rule_slug)                AS label,
             COALESCE(r.severity, f.observed_severity, 'LOW') AS severity,
             r.description                                  AS description,
             COALESCE(f.cnt, 0)::bigint                     AS cnt,
             COALESCE(f.open_cnt, 0)::bigint                AS open_cnt
        FROM ${this.rulesTable()} r
        FULL OUTER JOIN flag_counts f ON f.rule_slug = r.slug
       WHERE (r.slug IS NOT NULL AND r.is_active = true) OR f.rule_slug IS NOT NULL
       ORDER BY slug ASC
    `;
    const { rows } = await this.pool.query<{
      slug: string;
      label: string;
      severity: AmlSeverity;
      description: string | null;
      cnt: string | number;
      open_cnt: string | number;
    }>(sql, params);

    return rows.map((r) => ({
      slug: r.slug,
      label: r.label,
      severity: r.severity,
      description: r.description,
      count: Number(r.cnt),
      openCount: Number(r.open_cnt),
    }));
  }

  async createRedFlag(input: CreateRedFlagInput): Promise<AmlRedFlag> {
    await this.ensureInitialized();
    if (!input.userId || typeof input.userId !== "string") {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const severity = assertSeverity(input.severity);
    const reason = assertReason(input.reason);
    const ruleSlug = (input.ruleSlug?.trim() || MANUAL_FLAG_SLUG).slice(0, 64);
    const transactionId = input.transactionId?.trim() || null;
    const details = input.details && typeof input.details === "object" ? input.details : null;
    const id = randomUUID();
    const { rows } = await this.pool.query<RedFlagRow>(
      `INSERT INTO ${this.flagsTable()}
         (id, user_id, rule_slug, severity, status, reason, transaction_id, details, opened_by)
       VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7::jsonb, $8)
       RETURNING id, user_id, rule_slug, severity, status, reason, transaction_id, details,
                 opened_by, reviewed_by, reviewed_at, review_outcome, review_note, created_at, updated_at`,
      [id, input.userId, ruleSlug, severity, reason, transactionId, details ? JSON.stringify(details) : null, input.openedBy]
    );
    return this.mapRedFlag(rows[0]!);
  }

  async reviewRedFlag(input: ReviewRedFlagInput): Promise<AmlRedFlag> {
    await this.ensureInitialized();
    const flagId = input.flagId?.trim();
    if (!flagId) throw new DomainError("INVALID_INPUT", "flagId er påkrevd.");
    const reviewerId = input.reviewerId?.trim();
    if (!reviewerId) throw new DomainError("INVALID_INPUT", "reviewerId er påkrevd.");
    if (!VALID_OUTCOMES.includes(input.outcome)) {
      throw new DomainError("INVALID_INPUT", `outcome må være én av ${VALID_OUTCOMES.join(", ")}.`);
    }
    const note = assertReason(input.note, "note");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock raden og verifiser at den er OPEN før oppdatering.
      const { rows: existingRows } = await client.query<{ status: AmlFlagStatus }>(
        `SELECT status FROM ${this.flagsTable()} WHERE id = $1 FOR UPDATE`,
        [flagId]
      );
      const existing = existingRows[0];
      if (!existing) {
        throw new DomainError("AML_FLAG_NOT_FOUND", "Red-flag finnes ikke.");
      }
      if (existing.status !== "OPEN") {
        throw new DomainError(
          "AML_FLAG_ALREADY_REVIEWED",
          `Red-flag er allerede ${existing.status.toLowerCase()} — re-review ikke tillatt.`
        );
      }
      const { rows } = await client.query<RedFlagRow>(
        `UPDATE ${this.flagsTable()}
         SET status = $2, review_outcome = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, rule_slug, severity, status, reason, transaction_id, details,
                   opened_by, reviewed_by, reviewed_at, review_outcome, review_note, created_at, updated_at`,
        [flagId, input.outcome, reviewerId, note]
      );
      await client.query("COMMIT");
      return this.mapRedFlag(rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err, flagId }, "[BIN-587 B3-aml] reviewRedFlag failed");
      throw new DomainError("AML_REVIEW_FAILED", "Kunne ikke oppdatere review-status.");
    } finally {
      client.release();
    }
  }

  // ── Transactions for review (fra PaymentRequestService) ────────────────

  async listTransactionsForReview(
    input: ListTransactionsForReviewInput
  ): Promise<PaymentRequest[]> {
    await this.ensureInitialized();
    if (!input.userId || typeof input.userId !== "string") {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const limit = input.limit && input.limit > 0 ? Math.min(Math.floor(input.limit), 500) : 100;
    // Hent både accepted og pending på tvers av deposit+withdraw — to kall
    // fordi PaymentRequestService.listPending filtrerer per status.
    const results: PaymentRequest[] = [];
    for (const status of ["PENDING", "ACCEPTED", "REJECTED"] as const) {
      const batch = await this.paymentRequestService.listPending({
        status,
        userId: input.userId,
        createdFrom: input.from,
        createdTo: input.to,
        minAmountCents: input.minAmountCents,
        limit,
      });
      results.push(...batch);
    }
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return results.slice(0, limit);
  }

  // ── Scan-stub (BIN-582 follow-up: rule-engine) ─────────────────────────

  /**
   * "Scan now" — placeholder. Første versjon er en no-op som returnerer
   * null-teller. Rule-engine som går gjennom ledger + wallet-historikk
   * og oppretter flag-rader automatisk kommer som egen cron-job under
   * BIN-582. Denne endpoint-en finnes så UI-en kan kalle "skanne nå"
   * senere uten å vente på flere API-endringer.
   */
  async scanNow(_actorId: string): Promise<ScanResult> {
    await this.ensureInitialized();
    const activeRules = await this.listRules();
    const slugs = activeRules.filter((r) => r.isActive && r.slug !== MANUAL_FLAG_SLUG).map((r) => r.slug);
    logger.info(
      { activeRules: slugs.length, actor: _actorId },
      "[BIN-587 B3-aml] scanNow invoked — rule-engine er stubbed til BIN-582 follow-up"
    );
    return {
      scanned: 0,
      flagsCreated: 0,
      ruleSlugsEvaluated: slugs,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private mapRule(row: RuleRow): AmlRule {
    return {
      id: row.id,
      slug: row.slug,
      label: row.label,
      severity: row.severity,
      thresholdAmountCents:
        row.threshold_amount_cents === null ? null : Number(row.threshold_amount_cents),
      windowDays: row.window_days,
      description: row.description,
      isActive: row.is_active,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }

  private mapRedFlag(row: RedFlagRow): AmlRedFlag {
    return {
      id: row.id,
      userId: row.user_id,
      ruleSlug: row.rule_slug,
      severity: row.severity,
      status: row.status,
      reason: row.reason,
      transactionId: row.transaction_id,
      details: row.details ?? null,
      openedBy: row.opened_by,
      reviewedBy: row.reviewed_by,
      reviewedAt: asIsoOrNull(row.reviewed_at),
      reviewOutcome: row.review_outcome,
      reviewNote: row.review_note,
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
        `CREATE TABLE IF NOT EXISTS ${this.rulesTable()} (
          id TEXT PRIMARY KEY,
          slug TEXT UNIQUE NOT NULL,
          label TEXT NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
          threshold_amount_cents BIGINT NULL,
          window_days INTEGER NULL,
          description TEXT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.flagsTable()} (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          rule_slug TEXT NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
          status TEXT NOT NULL DEFAULT 'OPEN'
            CHECK (status IN ('OPEN','REVIEWED','DISMISSED','ESCALATED')),
          reason TEXT NOT NULL,
          transaction_id TEXT NULL,
          details JSONB NULL,
          opened_by TEXT NULL,
          reviewed_by TEXT NULL,
          reviewed_at TIMESTAMPTZ NULL,
          review_outcome TEXT NULL CHECK (review_outcome IN ('REVIEWED','DISMISSED','ESCALATED')),
          review_note TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_aml_red_flags_user
         ON ${this.flagsTable()}(user_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_aml_red_flags_status_open
         ON ${this.flagsTable()}(status, created_at DESC) WHERE status = 'OPEN'`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      throw new DomainError("AML_INIT_FAILED", "Kunne ikke initialisere AML-tabeller.");
    } finally {
      client.release();
    }
  }
}
