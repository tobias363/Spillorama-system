/**
 * BIN-587 B4a: physical ticket (papirbillett) admin-service.
 *
 * En batch er en range av unike IDs (range_start-range_end) tilhørende
 * én hall. Generering oppretter én rad per ID i app_physical_tickets
 * med status=UNSOLD. Agent-POS-salget (BIN-583) oppdaterer til SOLD
 * via denne tabellen — admin eier skjemaet.
 *
 * Prising: `batch.default_price_cents` er standard; `ticket.price_cents`
 * kan overstyre per billett (NULL = bruk batch-default).
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "physical-ticket-service" });

export type PhysicalBatchStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type PhysicalTicketStatus = "UNSOLD" | "SOLD" | "VOIDED";

const VALID_BATCH_STATUSES: PhysicalBatchStatus[] = ["DRAFT", "ACTIVE", "CLOSED"];

/** Max antall billetter som kan genereres i én batch (ops-grense). */
const MAX_BATCH_SIZE = 10_000;

export interface PhysicalTicketBatch {
  id: string;
  hallId: string;
  batchName: string;
  rangeStart: number;
  rangeEnd: number;
  defaultPriceCents: number;
  gameSlug: string | null;
  assignedGameId: string | null;
  status: PhysicalBatchStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhysicalTicket {
  id: string;
  batchId: string;
  uniqueId: string;
  hallId: string;
  status: PhysicalTicketStatus;
  priceCents: number | null;
  assignedGameId: string | null;
  soldAt: string | null;
  soldBy: string | null;
  buyerUserId: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBatchInput {
  hallId: string;
  batchName: string;
  rangeStart: number;
  rangeEnd: number;
  defaultPriceCents: number;
  gameSlug?: string | null;
  assignedGameId?: string | null;
  createdBy: string;
}

export interface UpdateBatchInput {
  batchName?: string;
  defaultPriceCents?: number;
  gameSlug?: string | null;
  assignedGameId?: string | null;
  status?: PhysicalBatchStatus;
}

export interface ListBatchesFilter {
  hallId?: string;
  status?: PhysicalBatchStatus;
  limit?: number;
}

export interface ListSoldTicketsFilter {
  hallId?: string;
  limit?: number;
}

export interface GenerateResult {
  batchId: string;
  generated: number;
  firstUniqueId: string;
  lastUniqueId: string;
}

export interface PhysicalTicketBatchTransfer {
  id: string;
  batchId: string;
  fromHallId: string;
  toHallId: string;
  reason: string;
  transferredBy: string;
  transferredAt: string;
  ticketCountAtTransfer: number;
}

export interface PhysicalTicketServiceOptions {
  connectionString: string;
  schema?: string;
}

interface BatchRow {
  id: string;
  hall_id: string;
  batch_name: string;
  range_start: string | number;
  range_end: string | number;
  default_price_cents: string | number;
  game_slug: string | null;
  assigned_game_id: string | null;
  status: PhysicalBatchStatus;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TicketRow {
  id: string;
  batch_id: string;
  unique_id: string;
  hall_id: string;
  status: PhysicalTicketStatus;
  price_cents: string | number | null;
  assigned_game_id: string | null;
  sold_at: Date | string | null;
  sold_by: string | null;
  buyer_user_id: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  voided_reason: string | null;
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

function assertBatchStatus(value: unknown): PhysicalBatchStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const upper = value.trim().toUpperCase() as PhysicalBatchStatus;
  if (!VALID_BATCH_STATUSES.includes(upper)) {
    throw new DomainError("INVALID_INPUT", `status må være én av ${VALID_BATCH_STATUSES.join(", ")}.`);
  }
  return upper;
}

function assertPositiveInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

function assertBatchName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "batchName er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) {
    throw new DomainError("INVALID_INPUT", "batchName er for lang (maks 120 tegn).");
  }
  return trimmed;
}

export class PhysicalTicketService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: PhysicalTicketServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError("INVALID_CONFIG", "Mangler connection string for PhysicalTicketService.");
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): PhysicalTicketService {
    const svc = Object.create(PhysicalTicketService.prototype) as PhysicalTicketService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private batchesTable(): string { return `"${this.schema}"."app_physical_ticket_batches"`; }
  private ticketsTable(): string { return `"${this.schema}"."app_physical_tickets"`; }

  // ── Batch CRUD ─────────────────────────────────────────────────────────

  async listBatches(filter: ListBatchesFilter = {}): Promise<PhysicalTicketBatch[]> {
    await this.ensureInitialized();
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.hallId) {
      params.push(filter.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(assertBatchStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<BatchRow>(
      `SELECT id, hall_id, batch_name, range_start, range_end, default_price_cents,
              game_slug, assigned_game_id, status, created_by, created_at, updated_at
       FROM ${this.batchesTable()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapBatch(r));
  }

  async getBatch(batchId: string): Promise<PhysicalTicketBatch> {
    await this.ensureInitialized();
    if (!batchId || typeof batchId !== "string") {
      throw new DomainError("INVALID_INPUT", "batchId er påkrevd.");
    }
    const { rows } = await this.pool.query<BatchRow>(
      `SELECT id, hall_id, batch_name, range_start, range_end, default_price_cents,
              game_slug, assigned_game_id, status, created_by, created_at, updated_at
       FROM ${this.batchesTable()}
       WHERE id = $1`,
      [batchId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "Batch finnes ikke.");
    }
    return this.mapBatch(row);
  }

  async createBatch(input: CreateBatchInput): Promise<PhysicalTicketBatch> {
    await this.ensureInitialized();
    const hallId = input.hallId?.trim();
    if (!hallId) throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    const batchName = assertBatchName(input.batchName);
    const rangeStart = assertPositiveInt(input.rangeStart, "rangeStart");
    const rangeEnd = assertPositiveInt(input.rangeEnd, "rangeEnd");
    if (rangeEnd < rangeStart) {
      throw new DomainError("INVALID_INPUT", "rangeEnd må være ≥ rangeStart.");
    }
    const size = rangeEnd - rangeStart + 1;
    if (size > MAX_BATCH_SIZE) {
      throw new DomainError(
        "INVALID_INPUT",
        `Batch-størrelse (${size}) overskrider maks ${MAX_BATCH_SIZE}. Del opp i flere batches.`
      );
    }
    const defaultPriceCents = assertPositiveInt(input.defaultPriceCents, "defaultPriceCents");
    const gameSlug = input.gameSlug?.trim() || null;
    const assignedGameId = input.assignedGameId?.trim() || null;

    // Sjekk at hallen finnes
    const { rows: hallRows } = await this.pool.query(
      `SELECT id FROM "${this.schema}"."app_halls" WHERE id = $1`,
      [hallId]
    );
    if (!hallRows[0]) throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");

    // Sjekk mot overlappende range i samme hall (status IN DRAFT/ACTIVE).
    const { rows: overlap } = await this.pool.query<{ batch_name: string }>(
      `SELECT batch_name FROM ${this.batchesTable()}
       WHERE hall_id = $1
         AND status IN ('DRAFT', 'ACTIVE')
         AND range_start <= $3::bigint
         AND range_end >= $2::bigint
       LIMIT 1`,
      [hallId, rangeStart, rangeEnd]
    );
    if (overlap[0]) {
      throw new DomainError(
        "PHYSICAL_BATCH_RANGE_OVERLAP",
        `Range overlapper med eksisterende batch "${overlap[0].batch_name}" i samme hall.`
      );
    }

    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<BatchRow>(
        `INSERT INTO ${this.batchesTable()}
           (id, hall_id, batch_name, range_start, range_end, default_price_cents,
            game_slug, assigned_game_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9)
         RETURNING id, hall_id, batch_name, range_start, range_end, default_price_cents,
                   game_slug, assigned_game_id, status, created_by, created_at, updated_at`,
        [id, hallId, batchName, rangeStart, rangeEnd, defaultPriceCents, gameSlug, assignedGameId, input.createdBy]
      );
      return this.mapBatch(rows[0]!);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg) && /batch_name/i.test(msg)) {
        throw new DomainError("PHYSICAL_BATCH_NAME_EXISTS", "Batch-navn finnes allerede i hallen.");
      }
      throw err;
    }
  }

  async updateBatch(batchId: string, update: UpdateBatchInput): Promise<PhysicalTicketBatch> {
    await this.ensureInitialized();
    const existing = await this.getBatch(batchId);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (update.batchName !== undefined) {
      sets.push(`batch_name = $${params.length + 1}`);
      params.push(assertBatchName(update.batchName));
    }
    if (update.defaultPriceCents !== undefined) {
      sets.push(`default_price_cents = $${params.length + 1}`);
      params.push(assertPositiveInt(update.defaultPriceCents, "defaultPriceCents"));
    }
    if (update.gameSlug !== undefined) {
      sets.push(`game_slug = $${params.length + 1}`);
      params.push(update.gameSlug?.trim() || null);
    }
    if (update.assignedGameId !== undefined) {
      sets.push(`assigned_game_id = $${params.length + 1}`);
      params.push(update.assignedGameId?.trim() || null);
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertBatchStatus(update.status));
    }
    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push(`updated_at = now()`);
    params.push(existing.id);

    try {
      const { rows } = await this.pool.query<BatchRow>(
        `UPDATE ${this.batchesTable()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}
         RETURNING id, hall_id, batch_name, range_start, range_end, default_price_cents,
                   game_slug, assigned_game_id, status, created_by, created_at, updated_at`,
        params
      );
      const row = rows[0];
      if (!row) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "Batch finnes ikke.");
      return this.mapBatch(row);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg) && /batch_name/i.test(msg)) {
        throw new DomainError("PHYSICAL_BATCH_NAME_EXISTS", "Batch-navn finnes allerede i hallen.");
      }
      throw err;
    }
  }

  async deleteBatch(batchId: string): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.getBatch(batchId);
    // Sjekk at ingen billetter er solgt (VOIDED er OK å beholde? Nei — vi
    // beholder historikk. Men DELETE cascader til tickets. Så vi må avvise
    // hvis noen tickets er SOLD fordi det ville tapt audit-trail.)
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${this.ticketsTable()}
       WHERE batch_id = $1 AND status = 'SOLD'`,
      [existing.id]
    );
    const soldCount = Number(rows[0]?.count ?? "0");
    if (soldCount > 0) {
      throw new DomainError(
        "PHYSICAL_BATCH_HAS_SOLD_TICKETS",
        `Batch har ${soldCount} solgte billetter — kan ikke slettes. Bruk status=CLOSED i stedet.`
      );
    }
    await this.pool.query(
      `DELETE FROM ${this.batchesTable()} WHERE id = $1`,
      [existing.id]
    );
  }

  // ── Ticket generering + assign-game + sold-liste ────────────────────────

  async generateTickets(batchId: string): Promise<GenerateResult> {
    await this.ensureInitialized();
    const batch = await this.getBatch(batchId);
    if (batch.status !== "DRAFT") {
      throw new DomainError(
        "PHYSICAL_BATCH_NOT_DRAFT",
        `Kan kun generere billetter for DRAFT-batches. Nåværende status: ${batch.status}.`
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Sjekk om allerede generert
      const { rows: existing } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.ticketsTable()} WHERE batch_id = $1`,
        [batch.id]
      );
      if (Number(existing[0]?.count ?? "0") > 0) {
        throw new DomainError(
          "PHYSICAL_BATCH_ALREADY_GENERATED",
          "Billetter er allerede generert for denne batchen."
        );
      }

      // Generer i ett batch-INSERT for performance.
      const valueStrings: string[] = [];
      const values: unknown[] = [];
      let firstUid = "";
      let lastUid = "";
      for (let i = batch.rangeStart; i <= batch.rangeEnd; i += 1) {
        const ticketId = randomUUID();
        const uniqueId = String(i);
        if (firstUid === "") firstUid = uniqueId;
        lastUid = uniqueId;
        const idx = values.length;
        valueStrings.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, 'UNSOLD', NULL, $${idx + 5})`);
        values.push(ticketId, batch.id, uniqueId, batch.hallId, batch.assignedGameId);
      }
      await client.query(
        `INSERT INTO ${this.ticketsTable()}
           (id, batch_id, unique_id, hall_id, status, price_cents, assigned_game_id)
         VALUES ${valueStrings.join(", ")}`,
        values
      );

      // Flytt batchen til ACTIVE etter vellykket generering.
      await client.query(
        `UPDATE ${this.batchesTable()} SET status = 'ACTIVE', updated_at = now() WHERE id = $1`,
        [batch.id]
      );

      await client.query("COMMIT");
      return {
        batchId: batch.id,
        generated: batch.rangeEnd - batch.rangeStart + 1,
        firstUniqueId: firstUid,
        lastUniqueId: lastUid,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      const msg = (err as { message?: string })?.message ?? "";
      if (/duplicate key|unique/i.test(msg) && /unique_id/i.test(msg)) {
        throw new DomainError(
          "PHYSICAL_TICKET_UNIQUE_ID_CONFLICT",
          "En eller flere unique-IDs finnes allerede i en annen batch."
        );
      }
      logger.error({ err, batchId }, "[BIN-587 B4a] generateTickets failed");
      throw new DomainError("PHYSICAL_GENERATE_FAILED", "Kunne ikke generere billetter.");
    } finally {
      client.release();
    }
  }

  async assignBatchToGame(batchId: string, gameId: string): Promise<PhysicalTicketBatch> {
    await this.ensureInitialized();
    const trimmed = gameId?.trim();
    if (!trimmed) throw new DomainError("INVALID_INPUT", "gameId er påkrevd.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: batchRows } = await client.query<BatchRow>(
        `UPDATE ${this.batchesTable()}
         SET assigned_game_id = $2, updated_at = now()
         WHERE id = $1
         RETURNING id, hall_id, batch_name, range_start, range_end, default_price_cents,
                   game_slug, assigned_game_id, status, created_by, created_at, updated_at`,
        [batchId, trimmed]
      );
      const batch = batchRows[0];
      if (!batch) throw new DomainError("PHYSICAL_BATCH_NOT_FOUND", "Batch finnes ikke.");
      // Propagér til alle UNSOLD-billetter i batchen (SOLD/VOIDED beholder sin assigned_game_id).
      await client.query(
        `UPDATE ${this.ticketsTable()}
         SET assigned_game_id = $2, updated_at = now()
         WHERE batch_id = $1 AND status = 'UNSOLD'`,
        [batch.id, trimmed]
      );
      await client.query("COMMIT");
      return this.mapBatch(batch);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err, batchId, gameId }, "[BIN-587 B4a] assignBatchToGame failed");
      throw new DomainError("PHYSICAL_ASSIGN_FAILED", "Kunne ikke tildele batch til spill.");
    } finally {
      client.release();
    }
  }

  async listSoldTicketsForGame(gameId: string, filter: ListSoldTicketsFilter = {}): Promise<PhysicalTicket[]> {
    await this.ensureInitialized();
    if (!gameId || typeof gameId !== "string") {
      throw new DomainError("INVALID_INPUT", "gameId er påkrevd.");
    }
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 1000) : 200;
    const conditions = ["assigned_game_id = $1", "status = 'SOLD'"];
    const params: unknown[] = [gameId];
    if (filter.hallId) {
      params.push(filter.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    params.push(limit);
    const { rows } = await this.pool.query<TicketRow>(
      `SELECT id, batch_id, unique_id, hall_id, status, price_cents, assigned_game_id,
              sold_at, sold_by, buyer_user_id, voided_at, voided_by, voided_reason,
              created_at, updated_at
       FROM ${this.ticketsTable()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY sold_at DESC NULLS LAST
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapTicket(r));
  }

  /**
   * Admin-clean: marker alle SOLD-billetter i et game som VOIDED.
   * Brukt for korreksjon (f.eks. når et spill kanselleres).
   */
  async voidAllSoldTicketsForGame(input: { gameId: string; actorId: string; reason: string }): Promise<{ voided: number }> {
    await this.ensureInitialized();
    if (!input.gameId?.trim()) throw new DomainError("INVALID_INPUT", "gameId er påkrevd.");
    const reason = input.reason?.trim();
    if (!reason) throw new DomainError("INVALID_INPUT", "reason er påkrevd.");
    if (reason.length > 500) {
      throw new DomainError("INVALID_INPUT", "reason er for lang (maks 500 tegn).");
    }
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.ticketsTable()}
       SET status = 'VOIDED', voided_at = now(), voided_by = $2, voided_reason = $3, updated_at = now()
       WHERE assigned_game_id = $1 AND status = 'SOLD'`,
      [input.gameId, input.actorId, reason]
    );
    return { voided: rowCount ?? 0 };
  }

  /**
   * BIN-587 B4b: list unique-IDs (admin-view). Filter på hallId + status.
   * Begrenset til 500 rader som default — for større uttrekk brukes
   * CSV-eksport (B2.3-pattern) eller paginering.
   */
  async listUniqueIds(filter: { hallId?: string; status?: PhysicalTicketStatus; limit?: number } = {}): Promise<PhysicalTicket[]> {
    await this.ensureInitialized();
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.hallId) {
      params.push(filter.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<TicketRow>(
      `SELECT id, batch_id, unique_id, hall_id, status, price_cents, assigned_game_id,
              sold_at, sold_by, buyer_user_id, voided_at, voided_by, voided_reason,
              created_at, updated_at
       FROM ${this.ticketsTable()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.mapTicket(r));
  }

  /**
   * BIN-649: list unique-IDs i en numerisk range, valgfritt med
   * hallId / status / oppretted-dato-filter. Brukt av admin-rapporten
   * `GET /api/admin/reports/unique-tickets/range`.
   *
   * `unique_id` er TEXT i schemaet, men innholdet er alltid en numerisk
   * BIGINT (batch-generert fra range_start..range_end). Derfor caster vi
   * til BIGINT i SQL-predikatet — vi forkaster evt. ikke-numeriske ID-er
   * (skal ikke kunne finnes i praksis, men defense-in-depth).
   *
   * Paginering: offset+limit (samme mønster som B4a listUniqueIds). Max-
   * limit 500 — større uttrekk må bruke CSV-eksport (PR-A4a-pattern).
   */
  async listUniqueIdsInRange(filter: {
    hallId?: string;
    uniqueIdStart?: number;
    uniqueIdEnd?: number;
    createdFrom?: string;
    createdTo?: string;
    status?: PhysicalTicketStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<PhysicalTicket[]> {
    await this.ensureInitialized();
    const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const offset = filter.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
    if (
      filter.uniqueIdStart !== undefined &&
      filter.uniqueIdEnd !== undefined &&
      filter.uniqueIdEnd < filter.uniqueIdStart
    ) {
      throw new DomainError("INVALID_INPUT", "uniqueIdEnd må være ≥ uniqueIdStart.");
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.hallId) {
      params.push(filter.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    // Cast unique_id til BIGINT for numerisk range-sammenligning. Vi krever
    // at teksten er heltall (regex) ellers får vi cast-exception — så
    // eksluder dem eksplisitt først.
    if (filter.uniqueIdStart !== undefined || filter.uniqueIdEnd !== undefined) {
      conditions.push(`unique_id ~ '^[0-9]+$'`);
    }
    if (filter.uniqueIdStart !== undefined) {
      params.push(filter.uniqueIdStart);
      conditions.push(`unique_id::bigint >= $${params.length}`);
    }
    if (filter.uniqueIdEnd !== undefined) {
      params.push(filter.uniqueIdEnd);
      conditions.push(`unique_id::bigint <= $${params.length}`);
    }
    if (filter.createdFrom) {
      params.push(filter.createdFrom);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filter.createdTo) {
      params.push(filter.createdTo);
      conditions.push(`created_at <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;
    const { rows } = await this.pool.query<TicketRow>(
      `SELECT id, batch_id, unique_id, hall_id, status, price_cents, assigned_game_id,
              sold_at, sold_by, buyer_user_id, voided_at, voided_by, voided_reason,
              created_at, updated_at
       FROM ${this.ticketsTable()}
       ${where}
       ORDER BY unique_id::bigint ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );
    return rows.map((r) => this.mapTicket(r));
  }

  /**
   * BIN-587 B4b: finn billett via unique-ID. Brukt av admin-search +
   * checkUniqueId-endepunkt for å verifisere billett-eksistens + status.
   */
  async findByUniqueId(uniqueId: string): Promise<PhysicalTicket | null> {
    await this.ensureInitialized();
    if (!uniqueId?.trim()) {
      throw new DomainError("INVALID_INPUT", "uniqueId er påkrevd.");
    }
    const { rows } = await this.pool.query<TicketRow>(
      `SELECT id, batch_id, unique_id, hall_id, status, price_cents, assigned_game_id,
              sold_at, sold_by, buyer_user_id, voided_at, voided_by, voided_reason,
              created_at, updated_at
       FROM ${this.ticketsTable()}
       WHERE unique_id = $1`,
      [uniqueId.trim()]
    );
    return rows[0] ? this.mapTicket(rows[0]) : null;
  }

  async getLastRegisteredUniqueId(hallId: string): Promise<{ hallId: string; lastUniqueId: string | null; maxRangeEnd: number | null }> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{ max_range_end: string | number | null }>(
      `SELECT MAX(range_end) AS max_range_end
       FROM ${this.batchesTable()}
       WHERE hall_id = $1`,
      [hallId]
    );
    const max = rows[0]?.max_range_end;
    const maxNum = max === null || max === undefined ? null : Number(max);
    return {
      hallId,
      lastUniqueId: maxNum === null ? null : String(maxNum),
      maxRangeEnd: maxNum,
    };
  }

  /**
   * BIN-583-koordinering: Agent 4 kaller denne fra sin POS-endepunkt for
   * å markere en billett som SOLD. Admin-siden eier skjemaet — agent-
   * siden har kun endpoint-flyt + auth. Transactional med FOR UPDATE-
   * lock så to samtidige salg av samme unique-ID feiler deterministisk.
   *
   * priceCents er valgfri: null = bruk batch.default_price_cents
   * (konsistent med pricing-modellen; ticket.price_cents settes kun hvis
   * Agent 4 eksplisitt overstyrer).
   *
   * Returnerer den oppdaterte billetten. Kaster:
   *   - PHYSICAL_TICKET_NOT_FOUND hvis unique_id ikke finnes
   *   - PHYSICAL_TICKET_NOT_SELLABLE hvis status != UNSOLD
   */
  async markSold(input: {
    uniqueId: string;
    soldBy: string;
    buyerUserId?: string | null;
    priceCents?: number | null;
  }): Promise<PhysicalTicket> {
    await this.ensureInitialized();
    const uniqueId = input.uniqueId?.trim();
    if (!uniqueId) throw new DomainError("INVALID_INPUT", "uniqueId er påkrevd.");
    const soldBy = input.soldBy?.trim();
    if (!soldBy) throw new DomainError("INVALID_INPUT", "soldBy er påkrevd.");
    const buyerUserId = input.buyerUserId?.trim() || null;
    const priceCents =
      input.priceCents === null || input.priceCents === undefined ? null : Number(input.priceCents);
    if (priceCents !== null && (!Number.isFinite(priceCents) || !Number.isInteger(priceCents) || priceCents < 0)) {
      throw new DomainError("INVALID_INPUT", "priceCents må være ≥ 0 eller null.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existingRows } = await client.query<{ status: PhysicalTicketStatus }>(
        `SELECT status FROM ${this.ticketsTable()} WHERE unique_id = $1 FOR UPDATE`,
        [uniqueId]
      );
      const existing = existingRows[0];
      if (!existing) {
        throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Billetten finnes ikke.");
      }
      if (existing.status !== "UNSOLD") {
        throw new DomainError(
          "PHYSICAL_TICKET_NOT_SELLABLE",
          `Billetten har status ${existing.status} — kan ikke selges på nytt.`
        );
      }
      const { rows } = await client.query<TicketRow>(
        `UPDATE ${this.ticketsTable()}
         SET status = 'SOLD', sold_at = now(), sold_by = $2, buyer_user_id = $3, price_cents = $4, updated_at = now()
         WHERE unique_id = $1
         RETURNING id, batch_id, unique_id, hall_id, status, price_cents, assigned_game_id,
                   sold_at, sold_by, buyer_user_id, voided_at, voided_by, voided_reason,
                   created_at, updated_at`,
        [uniqueId, soldBy, buyerUserId, priceCents]
      );
      await client.query("COMMIT");
      return this.mapTicket(rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err, uniqueId }, "[BIN-587 B4a] markSold failed");
      throw new DomainError("PHYSICAL_MARK_SOLD_FAILED", "Kunne ikke markere billett som solgt.");
    } finally {
      client.release();
    }
  }

  /**
   * BIN-583 B3.7 Alt B: overfør en hel batch fra en hall til en annen.
   * Atomisk — rejecter hvis NOEN billett i batchen er SOLD eller VOIDED
   * (kun UNSOLD kan flyttes). Oppdaterer batch.hall_id + alle
   * tickets.hall_id + logger i app_physical_ticket_transfers.
   *
   * Unique Player-konseptet fra legacy ble droppet som NOT-NEEDED
   * 2026-04-19 (regulatorisk review) — denne metoden er kun batch-
   * overflytting av fysiske papirbilletter (edge-case ops-verktøy for
   * misprinted batches).
   */
  async transferBatchToHall(input: {
    batchId: string;
    toHallId: string;
    reason: string;
    actorUserId: string;
  }): Promise<PhysicalTicketBatchTransfer> {
    await this.ensureInitialized();
    const batchId = input.batchId?.trim();
    const toHallId = input.toHallId?.trim();
    const reason = input.reason?.trim();
    const actorUserId = input.actorUserId?.trim();
    if (!batchId) throw new DomainError("INVALID_INPUT", "batchId er påkrevd.");
    if (!toHallId) throw new DomainError("INVALID_INPUT", "toHallId er påkrevd.");
    if (!reason) throw new DomainError("INVALID_INPUT", "reason er påkrevd.");
    if (!actorUserId) throw new DomainError("INVALID_INPUT", "actorUserId er påkrevd.");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: batchRows } = await client.query<{ hall_id: string }>(
        `SELECT hall_id FROM ${this.batchesTable()} WHERE id = $1 FOR UPDATE`,
        [batchId]
      );
      const batch = batchRows[0];
      if (!batch) throw new DomainError("NOT_FOUND", "Batch finnes ikke.");
      const fromHallId = batch.hall_id;
      if (fromHallId === toHallId) {
        throw new DomainError("INVALID_INPUT", "Kan ikke overføre til samme hall.");
      }

      const { rows: statusRows } = await client.query<{ status: PhysicalTicketStatus; count: string }>(
        `SELECT status, COUNT(*)::text AS count
         FROM ${this.ticketsTable()} WHERE batch_id = $1 GROUP BY status`,
        [batchId]
      );
      let unsoldCount = 0;
      for (const r of statusRows) {
        if (r.status === "SOLD" || r.status === "VOIDED") {
          throw new DomainError(
            "BATCH_NOT_TRANSFERABLE",
            `Batch inneholder billetter med status ${r.status} — kun UNSOLD-batches kan flyttes.`
          );
        }
        if (r.status === "UNSOLD") unsoldCount = Number(r.count);
      }

      await client.query(
        `UPDATE ${this.batchesTable()} SET hall_id = $1, updated_at = NOW() WHERE id = $2`,
        [toHallId, batchId]
      );
      await client.query(
        `UPDATE ${this.ticketsTable()} SET hall_id = $1, updated_at = NOW() WHERE batch_id = $2`,
        [toHallId, batchId]
      );

      const transferId = randomUUID();
      await client.query(
        `INSERT INTO "${this.schema}"."app_physical_ticket_transfers"
           (id, batch_id, from_hall_id, to_hall_id, reason, transferred_by, ticket_count_at_transfer)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [transferId, batchId, fromHallId, toHallId, reason, actorUserId, unsoldCount]
      );

      await client.query("COMMIT");

      return {
        id: transferId,
        batchId,
        fromHallId,
        toHallId,
        reason,
        transferredBy: actorUserId,
        transferredAt: new Date().toISOString(),
        ticketCountAtTransfer: unsoldCount,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err, batchId }, "[BIN-583 B3.7] transferBatchToHall failed");
      throw new DomainError("BATCH_TRANSFER_FAILED", "Kunne ikke overføre batchen.");
    } finally {
      client.release();
    }
  }

  /** BIN-583 B3.7 Alt B: hent transfer-historikk for en batch. */
  async listTransfers(batchId: string): Promise<PhysicalTicketBatchTransfer[]> {
    await this.ensureInitialized();
    if (!batchId?.trim()) throw new DomainError("INVALID_INPUT", "batchId er påkrevd.");
    const { rows } = await this.pool.query<{
      id: string;
      batch_id: string;
      from_hall_id: string;
      to_hall_id: string;
      reason: string;
      transferred_by: string;
      transferred_at: Date | string;
      ticket_count_at_transfer: number;
    }>(
      `SELECT id, batch_id, from_hall_id, to_hall_id, reason, transferred_by, transferred_at,
              ticket_count_at_transfer
       FROM "${this.schema}"."app_physical_ticket_transfers"
       WHERE batch_id = $1 ORDER BY transferred_at DESC`,
      [batchId]
    );
    return rows.map((r) => ({
      id: r.id,
      batchId: r.batch_id,
      fromHallId: r.from_hall_id,
      toHallId: r.to_hall_id,
      reason: r.reason,
      transferredBy: r.transferred_by,
      transferredAt: asIso(r.transferred_at),
      ticketCountAtTransfer: Number(r.ticket_count_at_transfer),
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private mapBatch(row: BatchRow): PhysicalTicketBatch {
    return {
      id: row.id,
      hallId: row.hall_id,
      batchName: row.batch_name,
      rangeStart: Number(row.range_start),
      rangeEnd: Number(row.range_end),
      defaultPriceCents: Number(row.default_price_cents),
      gameSlug: row.game_slug,
      assignedGameId: row.assigned_game_id,
      status: row.status,
      createdBy: row.created_by,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }

  private mapTicket(row: TicketRow): PhysicalTicket {
    return {
      id: row.id,
      batchId: row.batch_id,
      uniqueId: row.unique_id,
      hallId: row.hall_id,
      status: row.status,
      priceCents: row.price_cents === null ? null : Number(row.price_cents),
      assignedGameId: row.assigned_game_id,
      soldAt: asIsoOrNull(row.sold_at),
      soldBy: row.sold_by,
      buyerUserId: row.buyer_user_id,
      voidedAt: asIsoOrNull(row.voided_at),
      voidedBy: row.voided_by,
      voidedReason: row.voided_reason,
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
        `CREATE TABLE IF NOT EXISTS ${this.batchesTable()} (
          id TEXT PRIMARY KEY,
          hall_id TEXT NOT NULL,
          batch_name TEXT NOT NULL,
          range_start BIGINT NOT NULL,
          range_end BIGINT NOT NULL,
          default_price_cents BIGINT NOT NULL CHECK (default_price_cents >= 0),
          game_slug TEXT NULL,
          assigned_game_id TEXT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT'
            CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (range_end >= range_start),
          UNIQUE (hall_id, batch_name)
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.ticketsTable()} (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES ${this.batchesTable()}(id) ON DELETE CASCADE,
          unique_id TEXT UNIQUE NOT NULL,
          hall_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'UNSOLD'
            CHECK (status IN ('UNSOLD', 'SOLD', 'VOIDED')),
          price_cents BIGINT NULL CHECK (price_cents IS NULL OR price_cents >= 0),
          assigned_game_id TEXT NULL,
          sold_at TIMESTAMPTZ NULL,
          sold_by TEXT NULL,
          buyer_user_id TEXT NULL,
          voided_at TIMESTAMPTZ NULL,
          voided_by TEXT NULL,
          voided_reason TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_ptb_hall
         ON ${this.batchesTable()}(hall_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pt_batch
         ON ${this.ticketsTable()}(batch_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pt_game_status
         ON ${this.ticketsTable()}(assigned_game_id, status)
         WHERE assigned_game_id IS NOT NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_pt_hall_status
         ON ${this.ticketsTable()}(hall_id, status)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      throw new DomainError("PHYSICAL_INIT_FAILED", "Kunne ikke initialisere physical-ticket-tabeller.");
    } finally {
      client.release();
    }
  }
}
