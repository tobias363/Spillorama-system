/**
 * BIN-586: Manuell deposit/withdraw-kø.
 *
 * Port fra legacy:
 *   - App/Controllers/transactionController.js → acceptDepositRequest / rejectDepositRequest
 *   - App/Controllers/WithdrawController.js    → acceptWithdrawRequest / rejectWithdrawRequest
 *
 * Bruksmønster:
 *   - Spiller (eller hall-kasse på vegne av spiller) oppretter en pending
 *     `deposit_request` når de betaler kontant i hall, eller en
 *     `withdraw_request` når de ber om uttak over terskelverdi.
 *   - Hall-operator eller admin godkjenner/avslår via admin-UI. Ved
 *     godkjenning krediterer/debiterer tjenesten wallet via eksisterende
 *     `WalletAdapter`.
 *   - Avslag krever en fritekst-grunn (min 1 tegn) og rører ikke wallet.
 *
 * Audit: hvert accept/reject logges via pino. TODO BIN-588: sentralisert
 * audit-log når den porten er ferdig.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import { DomainError } from "../errors/DomainError.js";
import { IdempotencyKeys } from "../game/idempotency.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "payment-request-service" });

export type PaymentRequestKind = "deposit" | "withdraw";
export type PaymentRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED";
/**
 * BIN-646 (PR-B4): skiller bank-overføring fra hall-kontant-utbetaling på
 * withdraw-requests. NULL for legacy-rows (ukjent destinasjon) eller for
 * deposit-kind.
 */
export type PaymentRequestDestinationType = "bank" | "hall";

export interface PaymentRequest {
  id: string;
  kind: PaymentRequestKind;
  userId: string;
  walletId: string;
  amountCents: number;
  hallId: string | null;
  submittedBy: string | null;
  status: PaymentRequestStatus;
  rejectionReason: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  walletTransactionId: string | null;
  /** BIN-646 (PR-B4): kun relevant for kind=withdraw, null ellers. */
  destinationType: PaymentRequestDestinationType | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentRequestInput {
  userId: string;
  walletId: string;
  amountCents: number;
  hallId?: string | null;
  submittedBy?: string | null;
  /** BIN-646: kun brukt for kind=withdraw. */
  destinationType?: PaymentRequestDestinationType | null;
}

export interface ListPendingOptions {
  kind?: PaymentRequestKind;
  status?: PaymentRequestStatus;
  /**
   * BIN-646 (PR-B4): alternativ til `status` — tillat flere statuser
   * (f.eks. historikk-visning som viser ACCEPTED + REJECTED). Når både
   * `status` og `statuses` er satt, brukes `statuses`.
   */
  statuses?: PaymentRequestStatus[];
  hallId?: string;
  /** BIN-587 B3-aml: filter til én spiller (for AML transaksjons-review). */
  userId?: string;
  /** BIN-587 B3-aml: ISO-date (inclusive). */
  createdFrom?: string;
  /** BIN-587 B3-aml: ISO-date (inclusive). */
  createdTo?: string;
  /** BIN-587 B3-aml: minimum beløp i cents (for terskel-review). */
  minAmountCents?: number;
  /** BIN-646 (PR-B4): bank/hall-filter for withdraw-kø. */
  destinationType?: PaymentRequestDestinationType;
  limit?: number;
}

/**
 * GAP #10/#12 (BACKEND_1TO1_GAP_AUDIT_2026-04-24 §1.5): admin-history
 * for innskudd og uttak (legacy `/deposit/history` + `/withdraw/history/{hall,bank}`).
 *
 * Forskjell fra ListPendingOptions:
 *   - Default-status er ALLE (PENDING + ACCEPTED + REJECTED), ikke bare PENDING.
 *   - Cursor-basert pagination via (created_at, id) — stabilt selv med samtidige
 *     INSERTs på toppen av lista.
 *   - kind kan være "deposit", "withdraw" eller undefined (begge — returnerer
 *     blandet liste sortert nyeste først).
 */
export interface ListHistoryOptions {
  kind?: PaymentRequestKind;
  /**
   * Begrenser til én eller flere statuser. Tom liste eller `undefined`
   * betyr «alle statuser».
   */
  statuses?: PaymentRequestStatus[];
  hallId?: string;
  userId?: string;
  /** ISO-date (inclusive). */
  createdFrom?: string;
  /** ISO-date (inclusive). */
  createdTo?: string;
  minAmountCents?: number;
  /** Kun relevant for kind=withdraw (eller mixed). Filtrerer bort deposits. */
  destinationType?: PaymentRequestDestinationType;
  limit?: number;
  /**
   * Opaque cursor fra forrige svar (`nextCursor`). Format:
   *   base64("{createdAtIso}|{id}|{kind}").
   * Tjenesten returnerer kun rader med
   *   (created_at, id) < (cursor.createdAt, cursor.id) i deskriptiv sortering.
   */
  cursor?: string;
}

export interface ListHistoryResult {
  items: PaymentRequest[];
  /** `null` betyr at det ikke finnes flere rader. */
  nextCursor: string | null;
}

export interface AcceptRequestInput {
  requestId: string;
  acceptedBy: string;
}

export interface RejectRequestInput {
  requestId: string;
  rejectedBy: string;
  reason: string;
}

export interface PaymentRequestServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface PaymentRequestRow {
  id: string;
  user_id: string;
  wallet_id: string;
  amount_cents: string | number;
  hall_id: string | null;
  submitted_by: string | null;
  status: PaymentRequestStatus;
  rejection_reason: string | null;
  accepted_by: string | null;
  accepted_at: Date | string | null;
  rejected_by: string | null;
  rejected_at: Date | string | null;
  wallet_transaction_id: string | null;
  /** BIN-646: bare kolonne på withdraw-tabellen — undefined når kind=deposit. */
  destination_type?: PaymentRequestDestinationType | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new DomainError(
      "INVALID_CONFIG",
      "APP_PG_SCHEMA er ugyldig. Bruk kun bokstaver, tall og underscore."
    );
  }
  return trimmed;
}

function asIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function asIsoRequired(value: Date | string): string {
  return asIso(value) ?? new Date().toISOString();
}

function toAmountNumber(value: string | number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) {
    throw new DomainError("PLATFORM_DB_ERROR", "Ugyldig beløp i payment request row.");
  }
  return Math.floor(n);
}

function mapRow(row: PaymentRequestRow, kind: PaymentRequestKind): PaymentRequest {
  return {
    id: row.id,
    kind,
    userId: row.user_id,
    walletId: row.wallet_id,
    amountCents: toAmountNumber(row.amount_cents),
    hallId: row.hall_id,
    submittedBy: row.submitted_by,
    status: row.status,
    rejectionReason: row.rejection_reason,
    acceptedBy: row.accepted_by,
    acceptedAt: asIso(row.accepted_at),
    rejectedBy: row.rejected_by,
    rejectedAt: asIso(row.rejected_at),
    walletTransactionId: row.wallet_transaction_id,
    // BIN-646 (PR-B4): bank/hall kun på withdraw-tabell.
    destinationType:
      kind === "withdraw" ? (row.destination_type ?? null) : null,
    createdAt: asIsoRequired(row.created_at),
    updatedAt: asIsoRequired(row.updated_at),
  };
}

function parseDestinationType(
  value: unknown,
  fieldName = "destinationType"
): PaymentRequestDestinationType {
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være 'bank' eller 'hall'.`
    );
  }
  const raw = value.trim().toLowerCase();
  if (raw !== "bank" && raw !== "hall") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være 'bank' eller 'hall'.`
    );
  }
  return raw;
}

function assertPositiveAmountCents(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new DomainError("INVALID_INPUT", "amountCents må være et positivt heltall.");
  }
  return value;
}

function assertNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
  }
  return trimmed;
}

function centsToMajor(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

/**
 * GAP #10/#12: cursor-helpers for `listHistory`. Cursoren kombinerer
 * (createdAt, id) slik at pagination er stabil selv ved samtidige
 * INSERTs. Format: base64url("{createdAtIso}|{id}").
 *
 * Når kallere sender en ugyldig cursor (manipulert/forfalt), feiler vi
 * med INVALID_INPUT i stedet for å silently fall back — dette gjør debug
 * enklere og hindrer at en korrupt cursor skjuler rader.
 */
function buildHistoryCursor(item: PaymentRequest): string {
  const raw = `${item.createdAt}|${item.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

function parseHistoryCursor(
  cursor: string | undefined
): { createdAt: string; id: string } | undefined {
  if (cursor === undefined || cursor === null || cursor === "") return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new DomainError("INVALID_INPUT", "cursor er ugyldig.");
  }
  const idx = decoded.indexOf("|");
  if (idx <= 0 || idx === decoded.length - 1) {
    throw new DomainError("INVALID_INPUT", "cursor er ugyldig.");
  }
  const createdAt = decoded.slice(0, idx);
  const id = decoded.slice(idx + 1);
  // Valider at createdAt er en gyldig ISO-timestamp.
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new DomainError("INVALID_INPUT", "cursor er ugyldig.");
  }
  if (!id.trim()) {
    throw new DomainError("INVALID_INPUT", "cursor er ugyldig.");
  }
  return { createdAt, id };
}

export class PaymentRequestService {
  private readonly pool: Pool;

  private readonly schema: string;

  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly walletAdapter: WalletAdapter,
    options: PaymentRequestServiceOptions
  ) {
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
        "PaymentRequestService krever pool eller connectionString."
      );
    }
  }

  /**
   * Test-hook: lar enhetstester injisere en mock-pool uten å gå via
   * connectionString. Ikke bruk i prod-kode.
   * @internal
   */
  static forTesting(walletAdapter: WalletAdapter, pool: Pool, schema = "public"): PaymentRequestService {
    const svc = Object.create(PaymentRequestService.prototype) as PaymentRequestService;
    (svc as unknown as { walletAdapter: WalletAdapter }).walletAdapter = walletAdapter;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    // Allerede initialisert — skipp DDL.
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async createDepositRequest(input: CreatePaymentRequestInput): Promise<PaymentRequest> {
    return this.createRequest("deposit", input);
  }

  async createWithdrawRequest(input: CreatePaymentRequestInput): Promise<PaymentRequest> {
    return this.createRequest("withdraw", input);
  }

  async listPending(options: ListPendingOptions = {}): Promise<PaymentRequest[]> {
    await this.ensureInitialized();
    // BIN-646 (PR-B4): støtt multi-status (historikk viser accepted+rejected).
    const statuses =
      options.statuses && options.statuses.length
        ? Array.from(new Set(options.statuses))
        : [options.status ?? "PENDING"];
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

    const kinds: PaymentRequestKind[] =
      options.kind ? [options.kind] : ["deposit", "withdraw"];

    const results: PaymentRequest[] = [];
    for (const kind of kinds) {
      const table = this.tableFor(kind);
      const destCol = kind === "withdraw" ? ", destination_type" : "";
      const params: unknown[] = [statuses];
      let sql = `SELECT id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
                        rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
                        wallet_transaction_id${destCol}, created_at, updated_at
                 FROM ${table}
                 WHERE status = ANY($1::text[])`;
      if (options.hallId) {
        params.push(options.hallId);
        sql += ` AND hall_id = $${params.length}`;
      }
      // BIN-646 (PR-B4): bank/hall-filter på withdraw-kø.
      // Withdrawal QA P1 (2026-05-01): "hall"-filter inkluderer legacy NULL
      // rader så pre-default-fix-rader fortsatt vises. "bank" treffer kun
      // eksplisitte bank-uttak.
      if (kind === "withdraw" && options.destinationType) {
        params.push(options.destinationType);
        if (options.destinationType === "hall") {
          sql += ` AND (destination_type IS NULL OR destination_type = $${params.length})`;
        } else {
          sql += ` AND destination_type = $${params.length}`;
        }
      }
      // BIN-587 B3-aml filters
      if (options.userId) {
        params.push(options.userId);
        sql += ` AND user_id = $${params.length}`;
      }
      if (options.createdFrom) {
        params.push(options.createdFrom);
        sql += ` AND created_at >= $${params.length}::timestamptz`;
      }
      if (options.createdTo) {
        params.push(options.createdTo);
        sql += ` AND created_at <= $${params.length}::timestamptz`;
      }
      if (options.minAmountCents && options.minAmountCents > 0) {
        params.push(options.minAmountCents);
        sql += ` AND amount_cents >= $${params.length}`;
      }
      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const { rows } = await this.pool.query<PaymentRequestRow>(sql, params);
      for (const row of rows) {
        results.push(mapRow(row, kind));
      }
    }

    // Blandet kind: sorter på tvers slik at nyeste kommer først.
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return results.slice(0, limit);
  }

  /**
   * GAP #10/#12: admin-history for innskudd/uttak. Returnerer alle rader
   * (default uten status-filter) med cursor-pagination. Brukes av
   * `GET /api/admin/deposits/history` og `/api/admin/withdrawals/history`.
   */
  async listHistory(options: ListHistoryOptions = {}): Promise<ListHistoryResult> {
    await this.ensureInitialized();
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

    // Default: alle statuser (history-view skal vise PENDING + ACCEPTED + REJECTED).
    const statuses =
      options.statuses && options.statuses.length
        ? Array.from(new Set(options.statuses))
        : (["PENDING", "ACCEPTED", "REJECTED"] satisfies PaymentRequestStatus[]).slice();

    // Cursor: hent én ekstra rad for å avgjøre om det finnes flere.
    const fetchLimit = limit + 1;
    const cursor = parseHistoryCursor(options.cursor);

    const kinds: PaymentRequestKind[] =
      options.kind ? [options.kind] : ["deposit", "withdraw"];

    const aggregated: PaymentRequest[] = [];
    for (const kind of kinds) {
      // BIN-646 (PR-B4): destination_type kun på withdraw-tabellen. Hvis
      // brukeren ber om destinationType-filter, drop deposit-kind helt
      // (filtreringen ville uansett gitt 0 rader).
      if (kind === "deposit" && options.destinationType) continue;
      const table = this.tableFor(kind);
      const destCol = kind === "withdraw" ? ", destination_type" : "";
      const params: unknown[] = [statuses];
      let sql = `SELECT id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
                        rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
                        wallet_transaction_id${destCol}, created_at, updated_at
                 FROM ${table}
                 WHERE status = ANY($1::text[])`;
      if (options.hallId) {
        params.push(options.hallId);
        sql += ` AND hall_id = $${params.length}`;
      }
      // Withdrawal QA P1 (2026-05-01): "hall"-filter inkluderer legacy NULL
      // rader (history-view samme-semantikk som listPending).
      if (kind === "withdraw" && options.destinationType) {
        params.push(options.destinationType);
        if (options.destinationType === "hall") {
          sql += ` AND (destination_type IS NULL OR destination_type = $${params.length})`;
        } else {
          sql += ` AND destination_type = $${params.length}`;
        }
      }
      if (options.userId) {
        params.push(options.userId);
        sql += ` AND user_id = $${params.length}`;
      }
      if (options.createdFrom) {
        params.push(options.createdFrom);
        sql += ` AND created_at >= $${params.length}::timestamptz`;
      }
      if (options.createdTo) {
        params.push(options.createdTo);
        sql += ` AND created_at <= $${params.length}::timestamptz`;
      }
      if (options.minAmountCents && options.minAmountCents > 0) {
        params.push(options.minAmountCents);
        sql += ` AND amount_cents >= $${params.length}`;
      }
      if (cursor) {
        // Stabil keyset-pagination: sorter DESC på (created_at, id),
        // hent rader strengt mindre enn cursor-paret.
        params.push(cursor.createdAt);
        const cAtIdx = params.length;
        params.push(cursor.id);
        const cIdIdx = params.length;
        sql += ` AND (created_at, id) < ($${cAtIdx}::timestamptz, $${cIdIdx})`;
      }
      params.push(fetchLimit);
      sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
      const { rows } = await this.pool.query<PaymentRequestRow>(sql, params);
      for (const row of rows) {
        aggregated.push(mapRow(row, kind));
      }
    }

    // Når begge kinds blandes må vi sortere på tvers og truncere.
    aggregated.sort((a, b) => {
      if (a.createdAt < b.createdAt) return 1;
      if (a.createdAt > b.createdAt) return -1;
      // Tie-break på id desc for å få deterministisk pagination.
      if (a.id < b.id) return 1;
      if (a.id > b.id) return -1;
      return 0;
    });

    const hasMore = aggregated.length > limit;
    const items = hasMore ? aggregated.slice(0, limit) : aggregated;
    const nextCursor =
      hasMore && items.length > 0
        ? buildHistoryCursor(items[items.length - 1]!)
        : null;
    return { items, nextCursor };
  }

  async getRequest(kind: PaymentRequestKind, requestId: string): Promise<PaymentRequest> {
    await this.ensureInitialized();
    const id = assertNonEmpty(requestId, "requestId");
    const destCol = kind === "withdraw" ? ", destination_type" : "";
    const { rows } = await this.pool.query<PaymentRequestRow>(
      `SELECT id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
              rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
              wallet_transaction_id${destCol}, created_at, updated_at
       FROM ${this.tableFor(kind)}
       WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("PAYMENT_REQUEST_NOT_FOUND", "Payment request finnes ikke.");
    }
    return mapRow(row, kind);
  }

  async acceptDeposit(input: AcceptRequestInput): Promise<PaymentRequest> {
    return this.acceptRequest("deposit", input);
  }

  async rejectDeposit(input: RejectRequestInput): Promise<PaymentRequest> {
    return this.rejectRequest("deposit", input);
  }

  async acceptWithdraw(input: AcceptRequestInput): Promise<PaymentRequest> {
    return this.acceptRequest("withdraw", input);
  }

  async rejectWithdraw(input: RejectRequestInput): Promise<PaymentRequest> {
    return this.rejectRequest("withdraw", input);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async createRequest(
    kind: PaymentRequestKind,
    input: CreatePaymentRequestInput
  ): Promise<PaymentRequest> {
    await this.ensureInitialized();
    const userId = assertNonEmpty(input.userId, "userId");
    const walletId = assertNonEmpty(input.walletId, "walletId");
    const amountCents = assertPositiveAmountCents(input.amountCents);
    const hallId = input.hallId?.trim() || null;
    const submittedBy = input.submittedBy?.trim() || null;
    // BIN-646 (PR-B4): bank/hall for withdraw. Deposit ignorerer feltet.
    //
    // Withdrawal QA P1 (2026-05-01): default `destinationType = "hall"` når
    // klient ikke spesifiserer. Tidligere persisterte vi NULL for slike
    // requests, som førte til at `GET /api/admin/withdrawals/history?type=hall`
    // ekskluderte dem. "Pay-in-hall" er den dominerende uttaks-flyten i pilot
    // og skal være default; bank-uttak krever eksplisitt valg fra spilleren.
    let destinationType: PaymentRequestDestinationType | null = null;
    if (kind === "withdraw") {
      if (input.destinationType === "bank" || input.destinationType === "hall") {
        destinationType = input.destinationType;
      } else {
        destinationType = "hall";
      }
    }

    const id = randomUUID();
    let rows: PaymentRequestRow[];
    if (kind === "withdraw") {
      const res = await this.pool.query<PaymentRequestRow>(
        `INSERT INTO ${this.tableFor(kind)}
           (id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status, destination_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
         RETURNING id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
                   rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
                   wallet_transaction_id, destination_type, created_at, updated_at`,
        [id, userId, walletId, amountCents, hallId, submittedBy, destinationType]
      );
      rows = res.rows;
    } else {
      const res = await this.pool.query<PaymentRequestRow>(
        `INSERT INTO ${this.tableFor(kind)}
           (id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
         RETURNING id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
                   rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
                   wallet_transaction_id, created_at, updated_at`,
        [id, userId, walletId, amountCents, hallId, submittedBy]
      );
      rows = res.rows;
    }
    const row = rows[0];
    if (!row) {
      throw new DomainError("PLATFORM_DB_ERROR", "Kunne ikke opprette payment request.");
    }
    const mapped = mapRow(row, kind);
    log.info(
      { kind, requestId: mapped.id, userId, hallId, amountCents, destinationType },
      "[BIN-586] payment request created"
    );
    return mapped;
  }

  private async acceptRequest(
    kind: PaymentRequestKind,
    input: AcceptRequestInput
  ): Promise<PaymentRequest> {
    await this.ensureInitialized();
    const requestId = assertNonEmpty(input.requestId, "requestId");
    const acceptedBy = assertNonEmpty(input.acceptedBy, "acceptedBy");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.lockPendingRow(client, kind, requestId);

      const amountMajor = centsToMajor(current.amountCents);
      const reason =
        kind === "deposit"
          ? `Manuell innskudd #${current.id}`
          : `Manuelt uttak #${current.id}`;
      const idempotencyKey = IdempotencyKeys.paymentRequest({
        kind,
        requestId: current.id,
      });

      let walletTransactionId: string;
      try {
        const tx =
          kind === "deposit"
            ? // PR-W2 wallet-split: manuell innskudd (BIN-586 deposit-kø)
              // er brukerens egne penger → lander alltid på deposit-siden.
              // Matcher topUp()-oppførsel (som er hardkodet til deposit i
              // adapteret). Se WALLET_SPLIT_DESIGN_2026-04-22.md §3.2.
              await this.walletAdapter.credit(current.walletId, amountMajor, reason, {
                idempotencyKey,
                to: "deposit",
              })
            : await this.walletAdapter.debit(current.walletId, amountMajor, reason, {
                idempotencyKey,
              });
        walletTransactionId = tx.id;
      } catch (err) {
        await client.query("ROLLBACK");
        if (err instanceof WalletError) {
          log.warn(
            { kind, requestId, err: err.message, code: err.code },
            "[BIN-586] wallet operation failed during accept"
          );
          throw new DomainError(err.code, err.message);
        }
        throw err;
      }

      const destCol = kind === "withdraw" ? ", destination_type" : "";
      const { rows } = await client.query<PaymentRequestRow>(
        `UPDATE ${this.tableFor(kind)}
         SET status = 'ACCEPTED',
             accepted_by = $2,
             accepted_at = now(),
             wallet_transaction_id = $3,
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
                   rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
                   wallet_transaction_id${destCol}, created_at, updated_at`,
        [requestId, acceptedBy, walletTransactionId]
      );
      await client.query("COMMIT");
      const row = rows[0];
      if (!row) {
        throw new DomainError("PLATFORM_DB_ERROR", "Payment request forsvant under accept.");
      }
      const mapped = mapRow(row, kind);
      // TODO (BIN-588): sentralisert audit-log når port er ferdig.
      log.info(
        {
          kind,
          requestId,
          acceptedBy,
          walletId: mapped.walletId,
          amountCents: mapped.amountCents,
          walletTransactionId,
        },
        "[BIN-586] payment request accepted"
      );
      return mapped;
    } catch (err) {
      // Fall-back rollback hvis ikke allerede committed/rollbacket.
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore — transaction kan være avsluttet allerede
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async rejectRequest(
    kind: PaymentRequestKind,
    input: RejectRequestInput
  ): Promise<PaymentRequest> {
    await this.ensureInitialized();
    const requestId = assertNonEmpty(input.requestId, "requestId");
    const rejectedBy = assertNonEmpty(input.rejectedBy, "rejectedBy");
    const reason = assertNonEmpty(input.reason, "reason");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockPendingRow(client, kind, requestId);

      const destCol = kind === "withdraw" ? ", destination_type" : "";
      const { rows } = await client.query<PaymentRequestRow>(
        `UPDATE ${this.tableFor(kind)}
         SET status = 'REJECTED',
             rejected_by = $2,
             rejected_at = now(),
             rejection_reason = $3,
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
                   rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
                   wallet_transaction_id${destCol}, created_at, updated_at`,
        [requestId, rejectedBy, reason]
      );
      await client.query("COMMIT");
      const row = rows[0];
      if (!row) {
        throw new DomainError("PLATFORM_DB_ERROR", "Payment request forsvant under reject.");
      }
      const mapped = mapRow(row, kind);
      // TODO (BIN-588): sentralisert audit-log når port er ferdig.
      log.info(
        { kind, requestId, rejectedBy, reason },
        "[BIN-586] payment request rejected"
      );
      return mapped;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async lockPendingRow(
    client: PoolClient,
    kind: PaymentRequestKind,
    requestId: string
  ): Promise<PaymentRequest> {
    const destCol = kind === "withdraw" ? ", destination_type" : "";
    const { rows } = await client.query<PaymentRequestRow>(
      `SELECT id, user_id, wallet_id, amount_cents, hall_id, submitted_by, status,
              rejection_reason, accepted_by, accepted_at, rejected_by, rejected_at,
              wallet_transaction_id${destCol}, created_at, updated_at
       FROM ${this.tableFor(kind)}
       WHERE id = $1
       FOR UPDATE`,
      [requestId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("PAYMENT_REQUEST_NOT_FOUND", "Payment request finnes ikke.");
    }
    if (row.status !== "PENDING") {
      throw new DomainError(
        "PAYMENT_REQUEST_NOT_PENDING",
        `Payment request er allerede ${row.status}.`
      );
    }
    return mapRow(row, kind);
  }

  private tableFor(kind: PaymentRequestKind): string {
    const name = kind === "deposit" ? "app_deposit_requests" : "app_withdraw_requests";
    return `"${this.schema}"."${name}"`;
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
      for (const table of ["app_deposit_requests", "app_withdraw_requests"] as const) {
        const qualified = `"${this.schema}"."${table}"`;
        // BIN-646 (PR-B4): destination_type kun på withdraw.
        const extraCol =
          table === "app_withdraw_requests"
            ? `destination_type TEXT NULL CHECK (destination_type IS NULL OR destination_type IN ('bank', 'hall')),`
            : "";
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${qualified} (
            id UUID PRIMARY KEY,
            user_id TEXT NOT NULL,
            wallet_id TEXT NOT NULL,
            amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
            hall_id TEXT NULL,
            submitted_by TEXT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
            rejection_reason TEXT NULL,
            accepted_by TEXT NULL,
            accepted_at TIMESTAMPTZ NULL,
            rejected_by TEXT NULL,
            rejected_at TIMESTAMPTZ NULL,
            wallet_transaction_id TEXT NULL,
            ${extraCol}
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_status_created_at
           ON ${qualified} (status, created_at DESC)`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_user_id
           ON ${qualified} (user_id, created_at DESC)`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_hall_id
           ON ${qualified} (hall_id, created_at DESC)`
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) {
        throw err;
      }
      throw new DomainError(
        "PLATFORM_DB_ERROR",
        "Kunne ikke initialisere payment request-tabeller."
      );
    } finally {
      client.release();
    }
  }
}
