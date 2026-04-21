/**
 * BIN-655: generisk admin-transaksjons-logg.
 *
 * Endepunkt:
 *   GET /api/admin/transactions?from&to&type&userId&hallId&cursor&limit
 *
 * Kilder som unioneres:
 *   - public."wallet_transactions"           (BingoSystemAdapter, wallet-domenet)
 *   - public."app_agent_transactions"        (BIN-583 B3.2, cash-inout + ticket-salg)
 *   - public."app_deposit_requests"          (BIN-646, deposit-kø)
 *   - public."app_withdraw_requests"         (BIN-646, uttak-kø)
 *
 * Normaliseringen:
 *   - amountCents er alltid heltall. wallet_transactions.amount er i kroner
 *     (NUMERIC) så vi multipliserer med 100. agent_transactions.amount er i
 *     øre allerede (bigint). payment_requests.amount_cents er allerede øre.
 *   - `type` er en diskriminerende string: "wallet.debit", "wallet.credit",
 *     "wallet.topup", "wallet.withdrawal", "wallet.transfer_in",
 *     "wallet.transfer_out", "agent.cash_in", "agent.cash_out", ...,
 *     "deposit_request.{pending|accepted|rejected}", tilsvarende withdraw.
 *   - `userId` er best-effort: for wallet-transaksjoner mappes accountId til
 *     user via en sub-join (wallet_id som brukernøkkel — samme som resten
 *     av platformen). Ved manglende kobling returneres null.
 *   - `description` er menneskelesbar (bruker `reason`-felt, action_type +
 *     notes, eller auto-generert ut fra payment-request-status).
 *
 * Rolle-krav: PLAYER_KYC_READ (ADMIN + SUPPORT) — samme bredde som
 * player-transactions-viewer (BIN-587 B5).
 *
 * Cursor-paginering: opaque base64url-offset. Samme mønster som BIN-647.
 *
 * STOPP-vurdering (spec): disparate tabeller — dette endepunktet løser det
 * ved å UNION-e normaliserte kolonner i SQL. Ingen discriminated-union-
 * refactor av de underliggende lagrings-tabellene. Aksepterer at dette
 * er en ren "read-only view" og at service-laget kan bygges ut senere
 * hvis typing-behovet vokser.
 */

import express from "express";
import type { Pool, QueryResult } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  parseLimit,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-transactions" });

// ── Wire-types ───────────────────────────────────────────────────────────────

export type AdminTransactionSource =
  | "wallet"
  | "agent"
  | "deposit_request"
  | "withdraw_request";

export interface AdminTransactionRow {
  /** Unik id — prefikset med kilde for å unngå kollisjon. */
  id: string;
  source: AdminTransactionSource;
  /** Diskriminerende event-type, f.eks. "wallet.debit", "agent.cash_in". */
  type: string;
  /** Alltid i øre (minste valutaenhet). Heltall. Signed: positive = innkommende. */
  amountCents: number;
  /** ISO-8601 UTC. */
  timestamp: string;
  /** Fra wallet-account / agent-player / request-user — best effort. */
  userId: string | null;
  /** Fra agent/payment-tabellene. null for wallet-transaksjoner. */
  hallId: string | null;
  /** Kort beskrivelse — reason/notes/status. */
  description: string;
}

export interface AdminTransactionsListResponse {
  items: AdminTransactionRow[];
  nextCursor: string | null;
}

// ── Cursor helpers ───────────────────────────────────────────────────────────

export function encodeTransactionsCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeTransactionsCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

// ── Filter parsing ───────────────────────────────────────────────────────────

export interface AdminTransactionsFilter {
  from?: string;
  to?: string;
  source?: AdminTransactionSource;
  userId?: string;
  hallId?: string;
  limit: number;
  offset: number;
}

const VALID_SOURCES: readonly AdminTransactionSource[] = [
  "wallet",
  "agent",
  "deposit_request",
  "withdraw_request",
];

function parseOptionalIso(
  value: unknown,
  fieldName: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være ISO-8601 dato/tid.`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være ISO-8601 dato/tid.`
    );
  }
  return new Date(ms).toISOString();
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSource(value: unknown): AdminTransactionSource | undefined {
  const s = parseOptionalString(value);
  if (s === undefined) return undefined;
  if (!VALID_SOURCES.includes(s as AdminTransactionSource)) {
    throw new DomainError(
      "INVALID_INPUT",
      `type må være en av: ${VALID_SOURCES.join(", ")}.`
    );
  }
  return s as AdminTransactionSource;
}

// ── Service ──────────────────────────────────────────────────────────────────
//
// Injectable — tests kan stubbes ved å passere en egen implementasjon.

export interface AdminTransactionsService {
  list(filter: AdminTransactionsFilter): Promise<AdminTransactionRow[]>;
}

/** Postgres-implementasjon. Bruker SQL UNION ALL over de fire kilde-tabellene. */
export class PostgresAdminTransactionsService
  implements AdminTransactionsService
{
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: { pool: Pool; schema?: string }) {
    this.pool = options.pool;
    this.schema = (options.schema ?? "public").replace(/[^a-zA-Z0-9_]/g, "");
  }

  async list(filter: AdminTransactionsFilter): Promise<AdminTransactionRow[]> {
    const { params, sql } = this.buildQuery(filter);
    try {
      const result: QueryResult<Row> = await this.pool.query<Row>(sql, params);
      return result.rows.map(toWireRow);
    } catch (err) {
      logger.warn(
        { err },
        "[BIN-655] admin-transactions list failed (returning empty)"
      );
      return [];
    }
  }

  private q(name: string): string {
    return `"${this.schema}"."${name}"`;
  }

  private buildQuery(filter: AdminTransactionsFilter): {
    sql: string;
    params: unknown[];
  } {
    // Shared parameter placeholders. pg uses $1, $2, etc. — we build a
    // flat params-array and refer to the same bound values across all four
    // union branches via the same $n indexes (since pg allows reuse of the
    // same placeholder multiple times in a single statement).
    const params: unknown[] = [];
    // $1 = source-filter (nullable), $2 = userId (nullable), $3 = hallId (nullable),
    // $4 = from (nullable), $5 = to (nullable), $6 = limit, $7 = offset.
    params.push(filter.source ?? null);
    params.push(filter.userId ?? null);
    params.push(filter.hallId ?? null);
    params.push(filter.from ?? null);
    params.push(filter.to ?? null);
    params.push(filter.limit);
    params.push(filter.offset);

    // Wallet-branch: wallet_transactions.
    //   - userId-filter: wallet_accounts.id peker ikke direkte på user, men
    //     users.wallet_id peker på account. Vi joiner inn users for å få
    //     user_id og for å filtrere.
    //   - hallId-filter: wallet_transactions har ingen hall-kontekst, så vi
    //     slipper rader igjennom uten filter (ikke ekskluderer dem basert
    //     på hallId) — men hvis filter er satt, ekskluderer vi dem.
    const walletSql = `
      SELECT
        ('wallet:' || wt.id) AS id,
        'wallet'::text AS source,
        ('wallet.' || lower(wt.transaction_type)) AS type,
        (wt.amount * 100)::bigint AS amount_cents,
        wt.created_at AS timestamp,
        u.id AS user_id,
        NULL::text AS hall_id,
        wt.reason AS description
      FROM ${this.q("wallet_transactions")} wt
      LEFT JOIN ${this.q("users")} u ON u.wallet_id = wt.account_id
      WHERE ($1::text IS NULL OR $1 = 'wallet')
        AND ($2::text IS NULL OR u.id = $2)
        AND ($3::text IS NULL OR FALSE)
        AND ($4::timestamptz IS NULL OR wt.created_at >= $4)
        AND ($5::timestamptz IS NULL OR wt.created_at <= $5)
    `;

    // Agent-branch: app_agent_transactions.
    //   - direction: CREDIT vs DEBIT spillerens wallet — for ops-visning
    //     viser vi absolutt beløp med fortegn basert på direction.
    const agentSql = `
      SELECT
        ('agent:' || at.id) AS id,
        'agent'::text AS source,
        ('agent.' || lower(at.action_type)) AS type,
        CASE WHEN at.wallet_direction = 'CREDIT' THEN at.amount
             ELSE -at.amount END AS amount_cents,
        at.created_at AS timestamp,
        at.player_user_id AS user_id,
        at.hall_id AS hall_id,
        COALESCE(
          NULLIF(at.notes, ''),
          at.action_type || ' (' || at.payment_method || ')'
        ) AS description
      FROM ${this.q("app_agent_transactions")} at
      WHERE ($1::text IS NULL OR $1 = 'agent')
        AND ($2::text IS NULL OR at.player_user_id = $2)
        AND ($3::text IS NULL OR at.hall_id = $3)
        AND ($4::timestamptz IS NULL OR at.created_at >= $4)
        AND ($5::timestamptz IS NULL OR at.created_at <= $5)
    `;

    // Deposit-request-branch: app_deposit_requests.
    //   - positive amount (inngående).
    const depositSql = `
      SELECT
        ('deposit:' || dr.id) AS id,
        'deposit_request'::text AS source,
        ('deposit_request.' || lower(dr.status)) AS type,
        dr.amount_cents::bigint AS amount_cents,
        dr.created_at AS timestamp,
        dr.user_id AS user_id,
        dr.hall_id AS hall_id,
        ('Deposit-forespørsel ' || dr.status) AS description
      FROM ${this.q("app_deposit_requests")} dr
      WHERE ($1::text IS NULL OR $1 = 'deposit_request')
        AND ($2::text IS NULL OR dr.user_id = $2)
        AND ($3::text IS NULL OR dr.hall_id = $3)
        AND ($4::timestamptz IS NULL OR dr.created_at >= $4)
        AND ($5::timestamptz IS NULL OR dr.created_at <= $5)
    `;

    // Withdraw-request-branch: app_withdraw_requests.
    //   - negative amount (utgående).
    const withdrawSql = `
      SELECT
        ('withdraw:' || wr.id) AS id,
        'withdraw_request'::text AS source,
        ('withdraw_request.' || lower(wr.status)) AS type,
        (-1 * wr.amount_cents)::bigint AS amount_cents,
        wr.created_at AS timestamp,
        wr.user_id AS user_id,
        wr.hall_id AS hall_id,
        ('Uttak-forespørsel ' || wr.status) AS description
      FROM ${this.q("app_withdraw_requests")} wr
      WHERE ($1::text IS NULL OR $1 = 'withdraw_request')
        AND ($2::text IS NULL OR wr.user_id = $2)
        AND ($3::text IS NULL OR wr.hall_id = $3)
        AND ($4::timestamptz IS NULL OR wr.created_at >= $4)
        AND ($5::timestamptz IS NULL OR wr.created_at <= $5)
    `;

    const sql = `
      SELECT * FROM (
        ${walletSql}
        UNION ALL
        ${agentSql}
        UNION ALL
        ${depositSql}
        UNION ALL
        ${withdrawSql}
      ) AS combined
      ORDER BY timestamp DESC, id DESC
      LIMIT $6 OFFSET $7
    `;

    return { sql, params };
  }
}

interface Row {
  id: string;
  source: string;
  type: string;
  amount_cents: string | number;
  timestamp: Date | string;
  user_id: string | null;
  hall_id: string | null;
  description: string | null;
}

function toWireRow(row: Row): AdminTransactionRow {
  const amountCents = asInt(row.amount_cents);
  const timestamp =
    row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : new Date(String(row.timestamp)).toISOString();
  return {
    id: row.id,
    source: (row.source as AdminTransactionSource) ?? "wallet",
    type: row.type,
    amountCents,
    timestamp,
    userId: row.user_id ?? null,
    hallId: row.hall_id ?? null,
    description: row.description ?? "",
  };
}

function asInt(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ── Router ───────────────────────────────────────────────────────────────────

export interface AdminTransactionsRouterDeps {
  platformService: PlatformService;
  /**
   * Injectable service — passerer Postgres-basert default hvis kun `pool` +
   * `schema` er oppgitt. Tester passerer egen in-memory stub.
   */
  service?: AdminTransactionsService;
  pool?: Pool;
  schema?: string;
}

export function createAdminTransactionsRouter(
  deps: AdminTransactionsRouterDeps
): express.Router {
  const { platformService } = deps;
  const service: AdminTransactionsService =
    deps.service ??
    new PostgresAdminTransactionsService({
      pool: deps.pool!,
      schema: deps.schema,
    });
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  router.get("/api/admin/transactions", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_KYC_READ");
      const from = parseOptionalIso(req.query.from, "from");
      const to = parseOptionalIso(req.query.to, "to");
      const source = parseSource(req.query.type);
      const userId = parseOptionalString(req.query.userId);
      const hallId = parseOptionalString(req.query.hallId);
      const limit = parseLimit(req.query.limit, 100);
      const cursor = parseOptionalString(req.query.cursor);
      const offset = cursor ? decodeTransactionsCursor(cursor) : 0;

      // Over-fetch by one row to know whether there's a next page.
      const filter: AdminTransactionsFilter = {
        limit: limit + 1,
        offset,
      };
      if (from !== undefined) filter.from = from;
      if (to !== undefined) filter.to = to;
      if (source !== undefined) filter.source = source;
      if (userId !== undefined) filter.userId = userId;
      if (hallId !== undefined) filter.hallId = hallId;

      const rows = await service.list(filter);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeTransactionsCursor(offset + limit)
        : null;

      const response: AdminTransactionsListResponse = {
        items: page,
        nextCursor,
      };
      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
