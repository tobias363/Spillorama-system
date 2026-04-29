/**
 * BIN-638: physical-tickets games-in-hall aggregate (admin).
 *
 * Legacy-opphav: `legacy/unity-backend/App/Views/physicalTickets/
 * physicalGameTicketList.html` + `agentcashinoutController.js` viser agenten
 * en liste over completed games i hallen med pending-cashout-tellere før hen
 * dykker inn i enkelt-billettene. BIN-638 leverer den aggregaten som canonical
 * JSON-API så admin-web PR-B3 kan rive den siste legacy-siden.
 *
 * Relatert: BIN-648 `PhysicalTicketsAggregateService` gir per-(gameId, hallId)
 * aggregat med samme SOLD/pending/CASH_OUT-telling. BIN-638 strammer
 * kontrakten til én hall, dropper revenue-totalen på respons-nivå, og beriker
 * hver rad med `name` + `status` fra `hall_game_schedules` via LEFT JOIN så
 * admin-UI kan rendre tabellen uten en ekstra lookup per rad.
 *
 * Datakilder (read-only):
 *   - `app_physical_tickets` t  — billetter med `assigned_game_id` + status.
 *   - `app_physical_ticket_batches` b  — default_price_cents fallback.
 *   - `app_agent_transactions` tx  — EXISTS-subquery for action_type='CASH_OUT'.
 *   - `hall_game_schedules` s  — LEFT JOIN for display_name + is_active.
 *
 * Tidsvinduet (`from` / `to`) filtrerer på `sold_at` (salgs-orientert, samme
 * valg som BIN-648). Cashout-tellinga bruker samme vindu — teller CASH_OUTs
 * for billetter SOLGT i vinduet, uavhengig av når selve CASH_OUT-tx skjedde.
 *
 * Read-only: ingen mutasjon, ingen AuditLog (router kan logge visning selv).
 * Fail-closed: DB-feil bobler opp via `apiFailure` (ingen tom-data-fallback).
 */

import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";

/** Én aggregat-rad per `assigned_game_id` (inkl. `null`). */
export interface GameInHallRow {
  gameId: string | null;
  name: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
  sold: number;
  /** sold - cashedOut. "Tickets that haven't been cashed out yet." */
  pendingCashoutCount: number;
  /** Alias for `pendingCashoutCount`. BIN-638-kontrakten krever begge. */
  ticketsInPlay: number;
  cashedOut: number;
  totalRevenueCents: number;
}

export interface GamesInHallTotals {
  sold: number;
  pendingCashoutCount: number;
  ticketsInPlay: number;
  cashedOut: number;
  totalRevenueCents: number;
  rowCount: number;
}

export interface GamesInHallResult {
  generatedAt: string;
  hallId: string;
  from: string | null;
  to: string | null;
  rows: GameInHallRow[];
  totals: GamesInHallTotals;
}

export interface GamesInHallFilter {
  /** Påkrevd hall-scope. BIN-638 er per-hall-aggregat. */
  hallId: string;
  /** ISO-8601 dato/tid — filtrerer på `sold_at`. Inklusiv. */
  from?: string | null;
  /** ISO-8601 dato/tid — filtrerer på `sold_at`. Inklusiv. */
  to?: string | null;
  /** Row-cap for defense-in-depth. Default 500, maks 5000. */
  limit?: number;
  /** Deterministisk tid for test. */
  now?: Date;
}

export interface PhysicalTicketsGamesInHallServiceOptions {
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

interface GamesInHallDbRow {
  assigned_game_id: string | null;
  display_name: string | null;
  is_active: boolean | null;
  sold: string | number;
  cashed_out: string | number;
  total_revenue_cents: string | number | null;
}

export class PhysicalTicketsGamesInHallService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: PhysicalTicketsGamesInHallServiceOptions) {
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
        "PhysicalTicketsGamesInHallService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): PhysicalTicketsGamesInHallService {
    const svc = Object.create(
      PhysicalTicketsGamesInHallService.prototype,
    ) as PhysicalTicketsGamesInHallService;
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
  private schedulesTable(): string {
    return `"${this.schema}"."hall_game_schedules"`;
  }

  async gamesInHall(filter: GamesInHallFilter): Promise<GamesInHallResult> {
    const now = filter.now ?? new Date();
    const hallId = filter.hallId?.trim();
    if (!hallId) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }
    const fromIso = parseIsoOrNull(filter.from, "from");
    const toIso = parseIsoOrNull(filter.to, "to");
    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
      throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
    }
    const limit = Math.max(1, Math.min(5_000, Math.floor(filter.limit ?? 500)));

    // Params: hallId (1), [from (2)], [to (3|2)], limit (last).
    const params: unknown[] = [hallId];
    const conditions: string[] = ["t.status = 'SOLD'", "t.hall_id = $1"];
    if (fromIso) {
      params.push(fromIso);
      conditions.push(`t.sold_at >= $${params.length}::timestamptz`);
    }
    if (toIso) {
      params.push(toIso);
      conditions.push(`t.sold_at <= $${params.length}::timestamptz`);
    }
    params.push(limit);

    // EXISTS-subquery mot agent_transactions CASH_OUT på ticket_unique_id.
    // LEFT JOIN mot hall_game_schedules for display_name + is_active (matchet
    // på assigned_game_id). Merk: assigned_game_id kan referere til både
    // schedule-slots OG game-sessions (legacy har brukt begge). LEFT JOIN
    // betyr at spille-sesjoner uten schedule-slot-rad returnerer `null`
    // for name/status — det er det UI-et trenger for å vise "Ukjent game".
    //
    // GROUP BY inkluderer display_name + is_active siden LEFT JOIN-raden
    // er deterministisk (samme assigned_game_id → samme schedule-rad eller
    // `null`). Det gir stabil telling og stabil metadata per rad.
    const sql = `
      SELECT
        t.assigned_game_id,
        s.display_name,
        s.is_active,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM ${this.agentTxTable()} tx
            WHERE tx.ticket_unique_id = t.unique_id
              AND tx.action_type = 'CASH_OUT'
          )
        )::bigint AS pending,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM ${this.agentTxTable()} tx
            WHERE tx.ticket_unique_id = t.unique_id
              AND tx.action_type = 'CASH_OUT'
          )
        )::bigint AS cashed_out,
        COUNT(*)::bigint AS sold,
        COALESCE(SUM(COALESCE(t.price_cents, b.default_price_cents)), 0)::bigint AS total_revenue_cents
      FROM ${this.ticketsTable()} t
      JOIN ${this.batchesTable()} b ON b.id = t.batch_id
      LEFT JOIN ${this.schedulesTable()} s ON s.id = t.assigned_game_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY t.assigned_game_id, s.display_name, s.is_active
      ORDER BY t.assigned_game_id ASC NULLS FIRST
      LIMIT $${params.length}
    `;

    // Overwrite the pending/sold alias mapping to match the JS column names.
    // (The SQL above uses `pending` for the non-CASH_OUT count; we rename
    // to `sold_pending` in mapping below.)
    const { rows } = await this.pool.query<
      GamesInHallDbRow & { pending: string | number }
    >(sql, params);

    const mapped: GameInHallRow[] = rows.map((r) => {
      const pendingCount = Number((r as { pending: string | number }).pending);
      const cashedOut = Number(r.cashed_out);
      const soldTotal = Number(r.sold);
      const status: "ACTIVE" | "INACTIVE" | null =
        r.is_active === null || r.is_active === undefined
          ? null
          : r.is_active
            ? "ACTIVE"
            : "INACTIVE";
      return {
        gameId: r.assigned_game_id,
        name: r.display_name ?? null,
        status,
        sold: soldTotal,
        pendingCashoutCount: pendingCount,
        ticketsInPlay: pendingCount,
        cashedOut,
        totalRevenueCents: Number(r.total_revenue_cents ?? 0),
      };
    });

    const totals: GamesInHallTotals = mapped.reduce<GamesInHallTotals>(
      (acc, row) => {
        acc.sold += row.sold;
        acc.pendingCashoutCount += row.pendingCashoutCount;
        acc.ticketsInPlay += row.ticketsInPlay;
        acc.cashedOut += row.cashedOut;
        acc.totalRevenueCents += row.totalRevenueCents;
        acc.rowCount += 1;
        return acc;
      },
      {
        sold: 0,
        pendingCashoutCount: 0,
        ticketsInPlay: 0,
        cashedOut: 0,
        totalRevenueCents: 0,
        rowCount: 0,
      },
    );

    return {
      generatedAt: now.toISOString(),
      hallId,
      from: fromIso,
      to: toIso,
      rows: mapped,
      totals,
    };
  }
}
