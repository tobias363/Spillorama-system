/**
 * BIN-583 B3.8: per-hall daily/monthly revenue + account-balance-rapport.
 *
 * Port of legacy `hallController.{gethallAccountReportData,
 * hallAccountReportsView}`. Skiller seg fra B3-report `/api/admin/reports/*`
 * ved å være hall-scoped og dag-for-dag per gametype, med inkludering av
 * manuelle justeringer fra `app_hall_manual_adjustments`.
 *
 * Aggregerings-kilder:
 *   - `app_agent_transactions` — cash/card cash-flow per shift
 *   - `app_hall_cash_transactions` — hall cash-balance-mutasjoner
 *   - `engine.listComplianceLedgerEntries` — stake/prize ledger (omsetning)
 *   - `app_physical_ticket_cashouts` (virtual via payment_method='WALLET' tx)
 *   - `app_hall_manual_adjustments` — manuelle admin-korreksjoner
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "hall-account-report-service" });

export type ManualAdjustmentCategory =
  | "BANK_DEPOSIT" | "BANK_WITHDRAWAL" | "CORRECTION" | "REFUND" | "OTHER";

export interface ManualAdjustment {
  id: string;
  hallId: string;
  amountCents: number;
  category: ManualAdjustmentCategory;
  businessDate: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface DailyHallReportRow {
  date: string;                     // YYYY-MM-DD
  gameType: string | null;
  ticketsSoldCents: number;         // omsetning (stake)
  winningsPaidCents: number;        // utbetalt (prize)
  netRevenueCents: number;          // omsetning - utbetalt
  cashInCents: number;              // fra agent-tx
  cashOutCents: number;
  cardInCents: number;
  cardOutCents: number;
}

export interface MonthlyHallReportRow {
  month: string;                    // YYYY-MM
  ticketsSoldCents: number;
  winningsPaidCents: number;
  netRevenueCents: number;
  cashInCents: number;
  cashOutCents: number;
  cardInCents: number;
  cardOutCents: number;
  manualAdjustmentCents: number;
}

export interface HallAccountBalance {
  hallId: string;
  hallCashBalance: number;          // nåværende cash_balance fra app_halls
  dropsafeBalance: number;
  periodTotalCashInCents: number;
  periodTotalCashOutCents: number;
  periodTotalCardInCents: number;
  periodTotalCardOutCents: number;
  periodSellingByCustomerNumberCents: number;
  periodManualAdjustmentCents: number;
  periodNetCashFlowCents: number;   // cash-in - cash-out + manual-adj
}

export interface PhysicalCashoutRow {
  agentTxId: string;
  shiftId: string;
  agentUserId: string;
  playerUserId: string | null;
  hallId: string;
  ticketUniqueId: string | null;
  amountCents: number;
  paymentMethod: "CASH" | "CARD" | "WALLET";
  createdAt: string;
}

export interface HallAccountReportServiceOptions {
  connectionString: string;
  schema?: string;
  engine: BingoEngine;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function nokToCents(value: number): number {
  return Math.round(Number(value) * 100);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asDateString(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function assertValidDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være YYYY-MM-DD.`);
  }
  return value;
}

function assertCategory(value: unknown): ManualAdjustmentCategory {
  const allowed: ManualAdjustmentCategory[] = [
    "BANK_DEPOSIT", "BANK_WITHDRAWAL", "CORRECTION", "REFUND", "OTHER",
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as ManualAdjustmentCategory;
  }
  throw new DomainError(
    "INVALID_INPUT",
    `category må være én av: ${allowed.join(", ")}.`
  );
}

export class HallAccountReportService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly engine: BingoEngine;

  constructor(opts: HallAccountReportServiceOptions) {
    if (!opts.connectionString.trim()) {
      throw new DomainError("INVALID_CONFIG", "Mangler connection string.");
    }
    this.schema = assertSchemaName(opts.schema ?? "public");
    this.pool = new Pool({
      connectionString: opts.connectionString,
      ...getPoolTuning(),
    });
    this.engine = opts.engine;
  }

  /** @internal */
  static forTesting(pool: Pool, engine: BingoEngine, schema = "public"): HallAccountReportService {
    const svc = Object.create(HallAccountReportService.prototype) as HallAccountReportService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { engine: BingoEngine }).engine = engine;
    return svc;
  }

  private agentTxTable(): string { return `"${this.schema}"."app_agent_transactions"`; }
  private hallCashTable(): string { return `"${this.schema}"."app_hall_cash_transactions"`; }
  private manualAdjTable(): string { return `"${this.schema}"."app_hall_manual_adjustments"`; }

  // ── Daily per-hall per-game revenue ─────────────────────────────────────

  async getDailyReport(input: {
    hallId: string;
    dateFrom: string;
    dateTo: string;
    gameType?: string;
  }): Promise<DailyHallReportRow[]> {
    const hallId = input.hallId?.trim();
    if (!hallId) throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    assertValidDate(input.dateFrom, "dateFrom");
    assertValidDate(input.dateTo, "dateTo");

    // Ledger gir oss stake/prize per dag per gametype.
    const entries = this.engine.listComplianceLedgerEntries({
      hallId,
      dateFrom: `${input.dateFrom}T00:00:00Z`,
      dateTo: `${input.dateTo}T23:59:59Z`,
      limit: 10_000,
    });

    // Aggregér stake/prize per date×gameType.
    const ledgerByKey = new Map<string, { stake: number; prize: number }>();
    for (const e of entries) {
      const date = e.createdAt.slice(0, 10);
      if (input.gameType && e.gameType !== input.gameType) continue;
      const key = `${date}::${e.gameType ?? "UNKNOWN"}`;
      const agg = ledgerByKey.get(key) ?? { stake: 0, prize: 0 };
      if (e.eventType === "STAKE") agg.stake += nokToCents(e.amount);
      else if (e.eventType === "PRIZE") agg.prize += nokToCents(e.amount);
      ledgerByKey.set(key, agg);
    }

    // Agent-tx cash-flow per dag (ikke per-gametype siden den ikke er merket
    // med gametype). Vi grupper per dato og assigner til "ALL" gametype.
    const { rows: agentRows } = await this.pool.query<{
      date: string;
      cash_in: string | number;
      cash_out: string | number;
      card_in: string | number;
      card_out: string | number;
    }>(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(CASE WHEN wallet_direction='CREDIT' AND payment_method='CASH' THEN amount ELSE 0 END), 0) AS cash_in,
              COALESCE(SUM(CASE WHEN wallet_direction='DEBIT'  AND payment_method='CASH' THEN amount ELSE 0 END), 0) AS cash_out,
              COALESCE(SUM(CASE WHEN wallet_direction='CREDIT' AND payment_method='CARD' THEN amount ELSE 0 END), 0) AS card_in,
              COALESCE(SUM(CASE WHEN wallet_direction='DEBIT'  AND payment_method='CARD' THEN amount ELSE 0 END), 0) AS card_out
       FROM ${this.agentTxTable()}
       WHERE hall_id = $1 AND created_at::date BETWEEN $2::date AND $3::date
       GROUP BY created_at::date
       ORDER BY created_at::date ASC`,
      [hallId, input.dateFrom, input.dateTo]
    );
    const cashByDate = new Map<string, {
      cash_in: number; cash_out: number; card_in: number; card_out: number;
    }>();
    for (const r of agentRows) {
      cashByDate.set(r.date, {
        cash_in: nokToCents(Number(r.cash_in)),
        cash_out: nokToCents(Number(r.cash_out)),
        card_in: nokToCents(Number(r.card_in)),
        card_out: nokToCents(Number(r.card_out)),
      });
    }

    const allKeys = new Set<string>([...ledgerByKey.keys()]);
    for (const date of cashByDate.keys()) {
      allKeys.add(`${date}::ALL`);
    }

    const result: DailyHallReportRow[] = [];
    for (const key of allKeys) {
      const [date, gameType] = key.split("::");
      const ledger = ledgerByKey.get(key) ?? { stake: 0, prize: 0 };
      const cash = gameType === "ALL" ? cashByDate.get(date!) : undefined;
      result.push({
        date: date!,
        gameType: gameType === "UNKNOWN" ? null : gameType ?? null,
        ticketsSoldCents: ledger.stake,
        winningsPaidCents: ledger.prize,
        netRevenueCents: ledger.stake - ledger.prize,
        cashInCents: cash?.cash_in ?? 0,
        cashOutCents: cash?.cash_out ?? 0,
        cardInCents: cash?.card_in ?? 0,
        cardOutCents: cash?.card_out ?? 0,
      });
    }
    result.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return result;
  }

  // ── Monthly rollup ──────────────────────────────────────────────────────

  async getMonthlyReport(input: {
    hallId: string;
    year: number;
    month: number;  // 1-12
  }): Promise<MonthlyHallReportRow> {
    const hallId = input.hallId?.trim();
    if (!hallId) throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
      throw new DomainError("INVALID_INPUT", "year må være 2020-2100.");
    }
    if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
      throw new DomainError("INVALID_INPUT", "month må være 1-12.");
    }
    const monthStr = String(input.month).padStart(2, "0");
    const firstDay = `${input.year}-${monthStr}-01`;
    const lastDay = new Date(Date.UTC(input.year, input.month, 0))
      .toISOString().slice(0, 10);

    const daily = await this.getDailyReport({
      hallId, dateFrom: firstDay, dateTo: lastDay,
    });

    const totals = daily.reduce(
      (acc, row) => {
        acc.tickets += row.ticketsSoldCents;
        acc.winnings += row.winningsPaidCents;
        acc.cashIn += row.cashInCents;
        acc.cashOut += row.cashOutCents;
        acc.cardIn += row.cardInCents;
        acc.cardOut += row.cardOutCents;
        return acc;
      },
      { tickets: 0, winnings: 0, cashIn: 0, cashOut: 0, cardIn: 0, cardOut: 0 }
    );

    const { rows: adjRows } = await this.pool.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM ${this.manualAdjTable()}
       WHERE hall_id = $1 AND business_date BETWEEN $2::date AND $3::date`,
      [hallId, firstDay, lastDay]
    );
    const manualAdj = Number(adjRows[0]?.total ?? 0);

    return {
      month: `${input.year}-${monthStr}`,
      ticketsSoldCents: totals.tickets,
      winningsPaidCents: totals.winnings,
      netRevenueCents: totals.tickets - totals.winnings,
      cashInCents: totals.cashIn,
      cashOutCents: totals.cashOut,
      cardInCents: totals.cardIn,
      cardOutCents: totals.cardOut,
      manualAdjustmentCents: manualAdj,
    };
  }

  // ── Account balance + period aggregate ──────────────────────────────────

  async getAccountBalance(input: {
    hallId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<HallAccountBalance> {
    const hallId = input.hallId?.trim();
    if (!hallId) throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = input.dateFrom
      ? assertValidDate(input.dateFrom, "dateFrom")
      : today;
    const dateTo = input.dateTo ? assertValidDate(input.dateTo, "dateTo") : today;

    // Current hall balances.
    const { rows: hallRows } = await this.pool.query<{
      cash_balance: string | number;
      dropsafe_balance: string | number;
    }>(
      `SELECT cash_balance, COALESCE(dropsafe_balance, 0) AS dropsafe_balance
       FROM "${this.schema}"."app_halls" WHERE id = $1`,
      [hallId]
    );
    const balances = hallRows[0];
    if (!balances) throw new DomainError("NOT_FOUND", "Hall finnes ikke.");

    // Period cash/card + sellingByCustomerNumber from agent-tx.
    const { rows: txRows } = await this.pool.query<{
      cash_in: string | number;
      cash_out: string | number;
      card_in: string | number;
      card_out: string | number;
      customer_num: string | number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN wallet_direction='CREDIT' AND payment_method='CASH' THEN amount ELSE 0 END),0) AS cash_in,
         COALESCE(SUM(CASE WHEN wallet_direction='DEBIT'  AND payment_method='CASH' THEN amount ELSE 0 END),0) AS cash_out,
         COALESCE(SUM(CASE WHEN wallet_direction='CREDIT' AND payment_method='CARD' THEN amount ELSE 0 END),0) AS card_in,
         COALESCE(SUM(CASE WHEN wallet_direction='DEBIT'  AND payment_method='CARD' THEN amount ELSE 0 END),0) AS card_out,
         COALESCE(SUM(CASE WHEN payment_method='WALLET' AND action_type='PRODUCT_SALE' THEN amount ELSE 0 END),0) AS customer_num
       FROM ${this.agentTxTable()}
       WHERE hall_id = $1 AND created_at::date BETWEEN $2::date AND $3::date`,
      [hallId, dateFrom, dateTo]
    );
    const tx = txRows[0]!;

    const { rows: adjRows } = await this.pool.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS total
       FROM ${this.manualAdjTable()}
       WHERE hall_id = $1 AND business_date BETWEEN $2::date AND $3::date`,
      [hallId, dateFrom, dateTo]
    );
    const manualAdj = Number(adjRows[0]?.total ?? 0);

    const cashInCents = nokToCents(Number(tx.cash_in));
    const cashOutCents = nokToCents(Number(tx.cash_out));
    const cardInCents = nokToCents(Number(tx.card_in));
    const cardOutCents = nokToCents(Number(tx.card_out));
    const customerNumCents = nokToCents(Number(tx.customer_num));

    return {
      hallId,
      hallCashBalance: Number(balances.cash_balance),
      dropsafeBalance: Number(balances.dropsafe_balance),
      periodTotalCashInCents: cashInCents,
      periodTotalCashOutCents: cashOutCents,
      periodTotalCardInCents: cardInCents,
      periodTotalCardOutCents: cardOutCents,
      periodSellingByCustomerNumberCents: customerNumCents,
      periodManualAdjustmentCents: manualAdj,
      periodNetCashFlowCents: cashInCents - cashOutCents + manualAdj,
    };
  }

  // ── Manual adjustments ──────────────────────────────────────────────────

  async addManualAdjustment(input: {
    hallId: string;
    amountCents: number;  // signed — positive=credit, negative=debit
    category: ManualAdjustmentCategory;
    businessDate: string;
    note: string;
    createdBy: string;
  }): Promise<ManualAdjustment> {
    const hallId = input.hallId?.trim();
    if (!hallId) throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
      throw new DomainError("INVALID_INPUT", "amountCents må være et ikke-null heltall.");
    }
    const category = assertCategory(input.category);
    const businessDate = assertValidDate(input.businessDate, "businessDate");
    const note = input.note?.trim();
    if (!note || note.length > 500) {
      throw new DomainError("INVALID_INPUT", "note er påkrevd (maks 500 tegn).");
    }
    const createdBy = input.createdBy?.trim();
    if (!createdBy) throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");

    const id = randomUUID();
    const { rows } = await this.pool.query<{
      id: string; hall_id: string; amount_cents: string | number;
      category: ManualAdjustmentCategory; business_date: Date | string;
      note: string; created_by: string; created_at: Date | string;
    }>(
      `INSERT INTO ${this.manualAdjTable()}
        (id, hall_id, amount_cents, category, business_date, note, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7)
       RETURNING id, hall_id, amount_cents, category, business_date, note, created_by, created_at`,
      [id, hallId, input.amountCents, category, businessDate, note, createdBy]
    );
    const r = rows[0]!;
    return {
      id: r.id,
      hallId: r.hall_id,
      amountCents: Number(r.amount_cents),
      category: r.category,
      businessDate: asDateString(r.business_date),
      note: r.note,
      createdBy: r.created_by,
      createdAt: asIso(r.created_at),
    };
  }

  async listManualAdjustments(input: {
    hallId: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): Promise<ManualAdjustment[]> {
    const hallId = input.hallId?.trim();
    if (!hallId) throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    const limit = input.limit && input.limit > 0 ? Math.min(Math.floor(input.limit), 500) : 100;
    const conditions: string[] = ["hall_id = $1"];
    const params: unknown[] = [hallId];
    if (input.dateFrom) {
      params.push(assertValidDate(input.dateFrom, "dateFrom"));
      conditions.push(`business_date >= $${params.length}::date`);
    }
    if (input.dateTo) {
      params.push(assertValidDate(input.dateTo, "dateTo"));
      conditions.push(`business_date <= $${params.length}::date`);
    }
    params.push(limit);
    const { rows } = await this.pool.query<{
      id: string; hall_id: string; amount_cents: string | number;
      category: ManualAdjustmentCategory; business_date: Date | string;
      note: string; created_by: string; created_at: Date | string;
    }>(
      `SELECT id, hall_id, amount_cents, category, business_date, note, created_by, created_at
       FROM ${this.manualAdjTable()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => ({
      id: r.id,
      hallId: r.hall_id,
      amountCents: Number(r.amount_cents),
      category: r.category,
      businessDate: asDateString(r.business_date),
      note: r.note,
      createdBy: r.created_by,
      createdAt: asIso(r.created_at),
    }));
  }

  // ── Physical cashouts for a shift ───────────────────────────────────────

  async listPhysicalCashoutsForShift(input: {
    shiftId: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: PhysicalCashoutRow[]; total: number; totalAmountCents: number }> {
    const shiftId = input.shiftId?.trim();
    if (!shiftId) throw new DomainError("INVALID_INPUT", "shiftId er påkrevd.");
    const limit = input.limit && input.limit > 0 ? Math.min(Math.floor(input.limit), 500) : 100;
    const offset = input.offset && input.offset > 0 ? Math.floor(input.offset) : 0;

    // Cashout = CASH_OUT eller TICKET_CANCEL med CREDIT retning, eller
    // physical-ticket winning payout. For simplicity: alle rader med
    // wallet_direction=DEBIT på wallet (hvis vi tracker winning på cash-out)
    // ...men siden winning-payouts i vårt system går via PRIZE-ledger ikke
    // agent-tx, tracker vi her "cash-out" = agent-initierte debit-ops som er
    // kun CASH_OUT action-type (penge ut til spiller som cashout).
    // Legacy-konseptet "physical cashout" = utbetaling til spiller etter
    // bingogevinst — i vår arkitektur skjer dette via PRIZE-ledger men
    // manifesterer også som CASH_OUT hvis agent utbetaler kontant.
    const { rows } = await this.pool.query<{
      id: string; shift_id: string; agent_user_id: string; player_user_id: string;
      hall_id: string; ticket_unique_id: string | null; amount: string | number;
      payment_method: "CASH" | "CARD" | "WALLET"; created_at: Date | string;
    }>(
      `SELECT id, shift_id, agent_user_id, player_user_id, hall_id,
              ticket_unique_id, amount, payment_method, created_at
       FROM ${this.agentTxTable()}
       WHERE shift_id = $1 AND action_type = 'CASH_OUT'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [shiftId, limit, offset]
    );
    const mapped: PhysicalCashoutRow[] = rows.map((r) => ({
      agentTxId: r.id,
      shiftId: r.shift_id,
      agentUserId: r.agent_user_id,
      playerUserId: r.player_user_id ?? null,
      hallId: r.hall_id,
      ticketUniqueId: r.ticket_unique_id,
      amountCents: nokToCents(Number(r.amount)),
      paymentMethod: r.payment_method,
      createdAt: asIso(r.created_at),
    }));
    const { rows: countRows } = await this.pool.query<{ total: string; total_amount: string | number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(amount),0) AS total_amount
       FROM ${this.agentTxTable()}
       WHERE shift_id = $1 AND action_type = 'CASH_OUT'`,
      [shiftId]
    );
    const total = Number(countRows[0]?.total ?? 0);
    const totalAmountCents = nokToCents(Number(countRows[0]?.total_amount ?? 0));
    return { rows: mapped, total, totalAmountCents };
  }

  async getPhysicalCashoutSummaryForShift(shiftId: string): Promise<{
    shiftId: string; winCount: number; totalAmountCents: number;
    byPaymentMethod: Record<string, number>;
  }> {
    if (!shiftId?.trim()) throw new DomainError("INVALID_INPUT", "shiftId er påkrevd.");
    const { rows } = await this.pool.query<{
      payment_method: "CASH" | "CARD" | "WALLET";
      count: string; total: string | number;
    }>(
      `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
       FROM ${this.agentTxTable()}
       WHERE shift_id = $1 AND action_type = 'CASH_OUT'
       GROUP BY payment_method`,
      [shiftId]
    );
    let winCount = 0;
    let totalAmountCents = 0;
    const byPaymentMethod: Record<string, number> = {};
    for (const r of rows) {
      const c = Number(r.count);
      const tc = nokToCents(Number(r.total));
      winCount += c;
      totalAmountCents += tc;
      byPaymentMethod[r.payment_method] = tc;
    }
    return { shiftId, winCount, totalAmountCents, byPaymentMethod };
  }
}
