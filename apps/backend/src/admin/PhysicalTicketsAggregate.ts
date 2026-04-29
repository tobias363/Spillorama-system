/**
 * BIN-648: physical-tickets aggregate-rapport (admin).
 * `physicalTicketReport` aggregerer sum ticketPrice per playerTicketType.
 * Det vi leverer her er et strammere aggregat tilpasset vårt datamodell
 * (BIN-587 B4a `app_physical_tickets` + BIN-583 B3.2 `app_agent_transactions`):
 *
 *   - Grupperer på (gameId, hallId) slik BIN-648-kontrakten krever.
 *   - Tre tellere per rad:
 *       - `sold`     = billetter med status='SOLD' OG ingen korresponderende
 *                       `app_agent_transactions.action_type='CASH_OUT'`-rad
 *                       (matchet på ticket_unique_id). Også kjent som "pending".
 *       - `pending`  = alias for `sold` i denne kontrakten. Begge holdes i
 *                       responsen eksplisitt så admin-UI kan mappe 1:1.
 *       - `cashedOut`= billetter som ble SOLD og senere utbetalt (agent-tx
 *                       med action_type='CASH_OUT' + matchende unique-id).
 *
 * Tidsvinduet (`from` / `to`) filtrerer på `app_physical_tickets.sold_at` —
 * dvs. når billetten ble solgt. Rationale: legacy-rapporten er salgs-
 * orientert. Cashout-telleren bruker samme (gameId, hallId, sold_at)-
 * vindu — vi teller cashouts for billetter SOLGT i vinduet, uavhengig
 * av når selve cashout-tx skjedde. Det gjør "sold + cashedOut ≤ totalt"
 * invarianten eksakt per rad.
 *
 * Read-only: ingen mutasjon, ingen AuditLog her (router kan logge visning
 * selv hvis det trengs; BIN-648-scope har ingen audit-krav).
 *
 * Fail-closed-strategi: hvis DB-kallet kaster, bobler feilen opp til route-
 * laget som returnerer 5xx via `apiFailure`. Aldri returner tom data som om
 * alt var fint.
 */

import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";

/** Én aggregat-rad per (gameId, hallId). */
export interface PhysicalTicketsAggregateRow {
  gameId: string | null;
  hallId: string;
  sold: number;
  /** Alias for `sold` — BIN-648-kontrakten krever begge eksplisitt. */
  pending: number;
  cashedOut: number;
  totalRevenueCents: number;
}

export interface PhysicalTicketsAggregateTotals {
  sold: number;
  pending: number;
  cashedOut: number;
  totalRevenueCents: number;
  rowCount: number;
}

export interface PhysicalTicketsAggregateResult {
  generatedAt: string;
  from: string | null;
  to: string | null;
  hallId: string | null;
  rows: PhysicalTicketsAggregateRow[];
  totals: PhysicalTicketsAggregateTotals;
}

export interface PhysicalTicketsAggregateFilter {
  /** ISO-8601 dato/tid — filtrerer på `sold_at`. Inklusiv. */
  from?: string | null;
  /** ISO-8601 dato/tid — filtrerer på `sold_at`. Inklusiv. */
  to?: string | null;
  /** Hall-scope. Hvis satt, kun den hallen rapporteres. */
  hallId?: string | null;
  /** Row-cap for defense-in-depth. Default 1000, maks 10 000. */
  limit?: number;
  /** Deterministisk tid for test. */
  now?: Date;
}

export interface PhysicalTicketsAggregateServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function parseIsoOrNull(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new DomainError("INVALID_INPUT", `${field} må være en ISO-8601 dato/tid.`);
  }
  return new Date(ms).toISOString();
}

interface AggregateRow {
  assigned_game_id: string | null;
  hall_id: string;
  sold: string | number;
  cashed_out: string | number;
  total_revenue_cents: string | number | null;
}

export class PhysicalTicketsAggregateService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: PhysicalTicketsAggregateServiceOptions) {
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
        "PhysicalTicketsAggregateService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): PhysicalTicketsAggregateService {
    const svc = Object.create(PhysicalTicketsAggregateService.prototype) as PhysicalTicketsAggregateService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    return svc;
  }

  private ticketsTable(): string {
    return `"${this.schema}"."app_physical_tickets"`;
  }
  private batchesTable(): string {
    return `"${this.schema}"."app_physical_ticket_batches"`;
  }
  private agentTxTable(): string {
    return `"${this.schema}"."app_agent_transactions"`;
  }

  async aggregate(filter: PhysicalTicketsAggregateFilter = {}): Promise<PhysicalTicketsAggregateResult> {
    const now = filter.now ?? new Date();
    const fromIso = parseIsoOrNull(filter.from, "from");
    const toIso = parseIsoOrNull(filter.to, "to");
    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
      throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
    }
    const hallId = filter.hallId?.trim() || null;
    const limit = Math.max(1, Math.min(10_000, Math.floor(filter.limit ?? 1000)));

    const conditions: string[] = ["t.status = 'SOLD'"];
    const params: unknown[] = [];
    if (hallId) {
      params.push(hallId);
      conditions.push(`t.hall_id = $${params.length}`);
    }
    if (fromIso) {
      params.push(fromIso);
      conditions.push(`t.sold_at >= $${params.length}::timestamptz`);
    }
    if (toIso) {
      params.push(toIso);
      conditions.push(`t.sold_at <= $${params.length}::timestamptz`);
    }
    params.push(limit);

    // LEFT JOIN mot agent_transactions CASH_OUT matchet på ticket_unique_id.
    // cashed_out = COUNT(DISTINCT unique_id) som har minst én matching CASH_OUT-rad.
    // pending/sold = COUNT(DISTINCT unique_id) uten matching CASH_OUT.
    // Revenue = SUM(COALESCE(t.price_cents, b.default_price_cents)) for alle
    //   SOLD-billetter i scope.
    //
    // NB: EXISTS-subquery holder kompleksitet nede sammenlignet med aggregate
    // over join. Defense-in-depth: LIMIT på output-rader (ikke input) fordi
    // group-by-kardinaliteten (gameId × hallId) er begrenset i praksis.
    const sql = `
      SELECT
        t.assigned_game_id,
        t.hall_id,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM ${this.agentTxTable()} tx
            WHERE tx.ticket_unique_id = t.unique_id
              AND tx.action_type = 'CASH_OUT'
          )
        )::bigint AS sold,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM ${this.agentTxTable()} tx
            WHERE tx.ticket_unique_id = t.unique_id
              AND tx.action_type = 'CASH_OUT'
          )
        )::bigint AS cashed_out,
        COALESCE(SUM(COALESCE(t.price_cents, b.default_price_cents)), 0)::bigint AS total_revenue_cents
      FROM ${this.ticketsTable()} t
      JOIN ${this.batchesTable()} b ON b.id = t.batch_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY t.assigned_game_id, t.hall_id
      ORDER BY t.hall_id ASC, t.assigned_game_id ASC NULLS FIRST
      LIMIT $${params.length}
    `;

    const { rows } = await this.pool.query<AggregateRow>(sql, params);

    const mapped: PhysicalTicketsAggregateRow[] = rows.map((r) => {
      const sold = Number(r.sold);
      const cashedOut = Number(r.cashed_out);
      return {
        gameId: r.assigned_game_id,
        hallId: r.hall_id,
        sold,
        pending: sold,
        cashedOut,
        totalRevenueCents: Number(r.total_revenue_cents ?? 0),
      };
    });

    const totals: PhysicalTicketsAggregateTotals = mapped.reduce<PhysicalTicketsAggregateTotals>(
      (acc, row) => {
        acc.sold += row.sold;
        acc.pending += row.pending;
        acc.cashedOut += row.cashedOut;
        acc.totalRevenueCents += row.totalRevenueCents;
        acc.rowCount += 1;
        return acc;
      },
      { sold: 0, pending: 0, cashedOut: 0, totalRevenueCents: 0, rowCount: 0 },
    );

    return {
      generatedAt: now.toISOString(),
      from: fromIso,
      to: toIso,
      hallId,
      rows: mapped,
      totals,
    };
  }
}
