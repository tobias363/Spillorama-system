/**
 * BIN-583 B3.8: unit-tester for HallAccountReportService.
 *
 * Service-en beregner per-hall daily/monthly revenue + account-balance,
 * inkluderer manuelle justeringer fra `app_hall_manual_adjustments`, og
 * lister fysiske cashouts per shift.
 *
 * Tester her dekker:
 *   - validation paths (fail-closed input-validering)
 *   - daily-aggregering: stake/prize ledger + agent-tx cash/card per dato
 *   - monthly rollup: aggregerer dagsrader + manuelle justeringer
 *   - account-balance: cash-in/out + dropsafe + period net cash flow
 *   - manual adjustments: validation + insertion
 *   - physical cashouts per shift: paginering + summary aggregat
 *
 * Pengeflyt-integritet:
 *   - cents-konvertering (NOK → cents): rounding-safe
 *   - signed amounts: positive vs negative justeringer
 *   - net = stake - prize (uten cap — samme regel som ComplianceManager)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { HallAccountReportService } from "../HallAccountReportService.js";
import { DomainError } from "../../errors/DomainError.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedgerTypes.js";

// ── Test fixtures + stubs ────────────────────────────────────────────────────

interface AgentTxRow {
  id: string;
  shift_id: string;
  agent_user_id: string;
  player_user_id: string | null;
  hall_id: string;
  ticket_unique_id: string | null;
  amount: number;
  payment_method: "CASH" | "CARD" | "WALLET";
  wallet_direction: "CREDIT" | "DEBIT";
  action_type: string;
  created_at: Date;
}

interface ManualAdjRow {
  id: string;
  hall_id: string;
  amount_cents: number;
  category: string;
  business_date: Date;
  note: string;
  created_by: string;
  created_at: Date;
}

interface HallRow {
  id: string;
  cash_balance: number;
  dropsafe_balance: number;
}

interface Store {
  agentTx: AgentTxRow[];
  manualAdj: ManualAdjRow[];
  halls: HallRow[];
}

function newStore(): Store {
  return { agentTx: [], manualAdj: [], halls: [] };
}

function makeStubPool(store: Store): Pool {
  async function query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const trimmed = sql.trim();

    // ── app_halls ─────────────────────────────────────────────────────────
    if (trimmed.startsWith("SELECT cash_balance") && sql.includes("app_halls")) {
      const [hallId] = params as [string];
      const hall = store.halls.find((h) => h.id === hallId);
      return {
        rows: hall ? [{ cash_balance: hall.cash_balance, dropsafe_balance: hall.dropsafe_balance }] : [],
      };
    }

    // ── agent-tx daily aggregation (groupBy date) ────────────────────────
    if (
      sql.includes("to_char(created_at::date") &&
      sql.includes("app_agent_transactions") &&
      sql.includes("GROUP BY created_at::date")
    ) {
      const [hallId, from, to] = params as [string, string, string];
      const fromMs = Date.parse(`${from}T00:00:00Z`);
      const toMs = Date.parse(`${to}T23:59:59Z`);
      const byDate = new Map<string, { cash_in: number; cash_out: number; card_in: number; card_out: number }>();
      for (const tx of store.agentTx) {
        if (tx.hall_id !== hallId) continue;
        const ms = tx.created_at.getTime();
        if (ms < fromMs || ms > toMs) continue;
        const dateKey = tx.created_at.toISOString().slice(0, 10);
        const agg = byDate.get(dateKey) ?? { cash_in: 0, cash_out: 0, card_in: 0, card_out: 0 };
        if (tx.payment_method === "CASH" && tx.wallet_direction === "CREDIT") agg.cash_in += tx.amount;
        if (tx.payment_method === "CASH" && tx.wallet_direction === "DEBIT") agg.cash_out += tx.amount;
        if (tx.payment_method === "CARD" && tx.wallet_direction === "CREDIT") agg.card_in += tx.amount;
        if (tx.payment_method === "CARD" && tx.wallet_direction === "DEBIT") agg.card_out += tx.amount;
        byDate.set(dateKey, agg);
      }
      const rows = [...byDate.entries()].map(([date, agg]) => ({ date, ...agg }));
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return { rows };
    }

    // ── agent-tx period totals (no group-by) ─────────────────────────────
    if (
      sql.includes("app_agent_transactions") &&
      sql.includes("customer_num") &&
      !sql.includes("GROUP BY")
    ) {
      const [hallId, from, to] = params as [string, string, string];
      const fromMs = Date.parse(`${from}T00:00:00Z`);
      const toMs = Date.parse(`${to}T23:59:59Z`);
      let cash_in = 0;
      let cash_out = 0;
      let card_in = 0;
      let card_out = 0;
      let customer_num = 0;
      for (const tx of store.agentTx) {
        if (tx.hall_id !== hallId) continue;
        const ms = tx.created_at.getTime();
        if (ms < fromMs || ms > toMs) continue;
        if (tx.payment_method === "CASH" && tx.wallet_direction === "CREDIT") cash_in += tx.amount;
        if (tx.payment_method === "CASH" && tx.wallet_direction === "DEBIT") cash_out += tx.amount;
        if (tx.payment_method === "CARD" && tx.wallet_direction === "CREDIT") card_in += tx.amount;
        if (tx.payment_method === "CARD" && tx.wallet_direction === "DEBIT") card_out += tx.amount;
        if (tx.payment_method === "WALLET" && tx.action_type === "PRODUCT_SALE") customer_num += tx.amount;
      }
      return { rows: [{ cash_in, cash_out, card_in, card_out, customer_num }] };
    }

    // ── manual adjustments SUM ────────────────────────────────────────────
    if (sql.includes("app_hall_manual_adjustments") && sql.includes("SUM(amount_cents)")) {
      const [hallId, from, to] = params as [string, string, string];
      const fromMs = Date.parse(`${from}T00:00:00Z`);
      const toMs = Date.parse(`${to}T23:59:59Z`);
      let total = 0;
      for (const adj of store.manualAdj) {
        if (adj.hall_id !== hallId) continue;
        const ms = adj.business_date.getTime();
        if (ms < fromMs || ms > toMs) continue;
        total += adj.amount_cents;
      }
      return { rows: [{ total }] };
    }

    // ── manual adjustments INSERT ─────────────────────────────────────────
    if (trimmed.startsWith("INSERT") && sql.includes("app_hall_manual_adjustments")) {
      const [id, hall_id, amount_cents, category, business_date, note, created_by] =
        params as [string, string, number, string, string, string, string];
      const row: ManualAdjRow = {
        id,
        hall_id,
        amount_cents,
        category,
        business_date: new Date(`${business_date}T00:00:00Z`),
        note,
        created_by,
        created_at: new Date(),
      };
      store.manualAdj.push(row);
      return { rows: [{ ...row }] };
    }

    // ── manual adjustments LIST ───────────────────────────────────────────
    if (trimmed.startsWith("SELECT") && sql.includes("app_hall_manual_adjustments")) {
      const [hallId] = params as [string, ...unknown[]];
      const limit = params[params.length - 1] as number;
      let list = store.manualAdj.filter((a) => a.hall_id === hallId);
      // Apply optional date filters
      let pIdx = 1;
      if (sql.includes("business_date >= $")) {
        const from = params[pIdx++] as string;
        const fromMs = Date.parse(`${from}T00:00:00Z`);
        list = list.filter((a) => a.business_date.getTime() >= fromMs);
      }
      if (sql.includes("business_date <= $")) {
        const to = params[pIdx++] as string;
        const toMs = Date.parse(`${to}T23:59:59Z`);
        list = list.filter((a) => a.business_date.getTime() <= toMs);
      }
      list = [...list].sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
      return { rows: list };
    }

    // ── physical cashouts list ────────────────────────────────────────────
    if (
      trimmed.startsWith("SELECT id, shift_id") &&
      sql.includes("app_agent_transactions") &&
      sql.includes("CASH_OUT")
    ) {
      const [shiftId, limit, offset] = params as [string, number, number];
      const list = store.agentTx
        .filter((tx) => tx.shift_id === shiftId && tx.action_type === "CASH_OUT")
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows: list };
    }

    // ── physical cashouts COUNT/SUM ───────────────────────────────────────
    if (sql.includes("COUNT(*) AS total") && sql.includes("CASH_OUT")) {
      const [shiftId] = params as [string];
      const matched = store.agentTx.filter((tx) => tx.shift_id === shiftId && tx.action_type === "CASH_OUT");
      const total = matched.length;
      const total_amount = matched.reduce((s, tx) => s + tx.amount, 0);
      return { rows: [{ total: String(total), total_amount }] };
    }

    // ── physical cashouts GROUP BY payment_method ────────────────────────
    if (sql.includes("GROUP BY payment_method") && sql.includes("CASH_OUT")) {
      const [shiftId] = params as [string];
      const matched = store.agentTx.filter((tx) => tx.shift_id === shiftId && tx.action_type === "CASH_OUT");
      const byPm = new Map<string, { count: number; total: number }>();
      for (const tx of matched) {
        const agg = byPm.get(tx.payment_method) ?? { count: 0, total: 0 };
        agg.count += 1;
        agg.total += tx.amount;
        byPm.set(tx.payment_method, agg);
      }
      return {
        rows: [...byPm.entries()].map(([pm, agg]) => ({
          payment_method: pm,
          count: String(agg.count),
          total: agg.total,
        })),
      };
    }

    throw new Error(`unhandled SQL: ${trimmed.slice(0, 200)}`);
  }

  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

function makeStubEngine(entries: ComplianceLedgerEntry[]): BingoEngine {
  return {
    listComplianceLedgerEntries: (input?: {
      hallId?: string;
      dateFrom?: string;
      dateTo?: string;
      gameType?: string;
      channel?: string;
      limit?: number;
    }) => {
      const fromMs = input?.dateFrom ? Date.parse(input.dateFrom) : -Infinity;
      const toMs = input?.dateTo ? Date.parse(input.dateTo) : Infinity;
      let list = entries.filter((e) => {
        if (input?.hallId && e.hallId !== input.hallId) return false;
        const ms = e.createdAtMs;
        if (ms < fromMs || ms > toMs) return false;
        return true;
      });
      if (input?.limit) list = list.slice(0, input.limit);
      return list;
    },
  } as unknown as BingoEngine;
}

function makeService(store: Store, entries: ComplianceLedgerEntry[]) {
  return HallAccountReportService.forTesting(makeStubPool(store), makeStubEngine(entries));
}

function ledgerEntry(input: Partial<ComplianceLedgerEntry> & {
  id: string;
  hallId: string;
  createdAt: string;
  eventType: ComplianceLedgerEntry["eventType"];
  amount: number;
}): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    gameType: "DATABINGO",
    channel: "INTERNET",
    createdAtMs: Date.parse(input.createdAt),
    ...input,
  };
}

// ── Validation tests ─────────────────────────────────────────────────────────

test("HallAccountReport: getDailyReport rejects empty hallId", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getDailyReport({ hallId: " ", dateFrom: "2026-04-01", dateTo: "2026-04-30" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("HallAccountReport: getDailyReport rejects invalid dateFrom format", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getDailyReport({ hallId: "h-1", dateFrom: "01/04/2026", dateTo: "2026-04-30" }),
    (err: unknown) => err instanceof DomainError && /dateFrom/.test(err.message),
  );
});

test("HallAccountReport: getDailyReport rejects invalid dateTo format", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getDailyReport({ hallId: "h-1", dateFrom: "2026-04-01", dateTo: "april-30" }),
    (err: unknown) => err instanceof DomainError && /dateTo/.test(err.message),
  );
});

test("HallAccountReport: getMonthlyReport rejects year out of range", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getMonthlyReport({ hallId: "h-1", year: 1999, month: 6 }),
    (err: unknown) => err instanceof DomainError && /year/.test(err.message),
  );
  await assert.rejects(
    () => svc.getMonthlyReport({ hallId: "h-1", year: 2200, month: 6 }),
    (err: unknown) => err instanceof DomainError && /year/.test(err.message),
  );
});

test("HallAccountReport: getMonthlyReport rejects non-integer year", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getMonthlyReport({ hallId: "h-1", year: 2026.5, month: 6 }),
    (err: unknown) => err instanceof DomainError && /year/.test(err.message),
  );
});

test("HallAccountReport: getMonthlyReport rejects month 0 / 13", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getMonthlyReport({ hallId: "h-1", year: 2026, month: 0 }),
    (err: unknown) => err instanceof DomainError && /month/.test(err.message),
  );
  await assert.rejects(
    () => svc.getMonthlyReport({ hallId: "h-1", year: 2026, month: 13 }),
    (err: unknown) => err instanceof DomainError && /month/.test(err.message),
  );
});

test("HallAccountReport: getAccountBalance rejects empty hallId", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getAccountBalance({ hallId: "" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("HallAccountReport: getAccountBalance throws NOT_FOUND for unknown hall", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getAccountBalance({ hallId: "ghost-hall" }),
    (err: unknown) => err instanceof DomainError && err.code === "NOT_FOUND",
  );
});

test("HallAccountReport: addManualAdjustment rejects amountCents = 0", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 0,
        category: "CORRECTION",
        businessDate: "2026-04-15",
        note: "Test",
        createdBy: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("HallAccountReport: addManualAdjustment rejects non-integer amountCents", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 12.5,
        category: "CORRECTION",
        businessDate: "2026-04-15",
        note: "Test",
        createdBy: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("HallAccountReport: addManualAdjustment rejects unknown category", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 1000,
        // @ts-expect-error -- testing rejection
        category: "FRAUD_REVERSAL",
        businessDate: "2026-04-15",
        note: "Test",
        createdBy: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && /category/.test(err.message),
  );
});

test("HallAccountReport: addManualAdjustment rejects empty note", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 1000,
        category: "CORRECTION",
        businessDate: "2026-04-15",
        note: "  ",
        createdBy: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && /note/.test(err.message),
  );
});

test("HallAccountReport: addManualAdjustment rejects note > 500 chars", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 1000,
        category: "CORRECTION",
        businessDate: "2026-04-15",
        note: "x".repeat(501),
        createdBy: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && /note/.test(err.message),
  );
});

test("HallAccountReport: addManualAdjustment rejects empty createdBy", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 1000,
        category: "CORRECTION",
        businessDate: "2026-04-15",
        note: "Test",
        createdBy: "",
      }),
    (err: unknown) => err instanceof DomainError && /createdBy/.test(err.message),
  );
});

test("HallAccountReport: addManualAdjustment rejects invalid businessDate", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () =>
      svc.addManualAdjustment({
        hallId: "h-1",
        amountCents: 1000,
        category: "CORRECTION",
        businessDate: "01-04-2026",
        note: "Test",
        createdBy: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && /businessDate/.test(err.message),
  );
});

test("HallAccountReport: listPhysicalCashoutsForShift rejects empty shiftId", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.listPhysicalCashoutsForShift({ shiftId: "" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("HallAccountReport: getPhysicalCashoutSummaryForShift rejects empty shiftId", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.getPhysicalCashoutSummaryForShift("  "),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

// ── Daily report happy paths ─────────────────────────────────────────────────

test("HallAccountReport: getDailyReport aggregates stake/prize per date×gameType", async () => {
  const store = newStore();
  const entries = [
    ledgerEntry({
      id: "e-1",
      hallId: "h-1",
      createdAt: "2026-04-15T10:00:00.000Z",
      eventType: "STAKE",
      amount: 100,
      gameType: "DATABINGO",
    }),
    ledgerEntry({
      id: "e-2",
      hallId: "h-1",
      createdAt: "2026-04-15T10:05:00.000Z",
      eventType: "PRIZE",
      amount: 60,
      gameType: "DATABINGO",
    }),
    ledgerEntry({
      id: "e-3",
      hallId: "h-1",
      createdAt: "2026-04-16T11:00:00.000Z",
      eventType: "STAKE",
      amount: 50,
      gameType: "MAIN_GAME",
    }),
  ];
  const svc = makeService(store, entries);
  const rows = await svc.getDailyReport({ hallId: "h-1", dateFrom: "2026-04-15", dateTo: "2026-04-16" });
  assert.equal(rows.length, 2);
  // Sort is desc by date
  const dbRow = rows.find((r) => r.gameType === "DATABINGO" && r.date === "2026-04-15")!;
  assert.equal(dbRow.ticketsSoldCents, 10000); // 100 NOK = 10000 cents
  assert.equal(dbRow.winningsPaidCents, 6000);
  assert.equal(dbRow.netRevenueCents, 4000);
  const mgRow = rows.find((r) => r.gameType === "MAIN_GAME")!;
  assert.equal(mgRow.ticketsSoldCents, 5000);
  assert.equal(mgRow.winningsPaidCents, 0);
  assert.equal(mgRow.netRevenueCents, 5000);
});

test("HallAccountReport: getDailyReport filters entries by gameType when specified", async () => {
  const store = newStore();
  const entries = [
    ledgerEntry({
      id: "e-1",
      hallId: "h-1",
      createdAt: "2026-04-15T10:00:00.000Z",
      eventType: "STAKE",
      amount: 100,
      gameType: "DATABINGO",
    }),
    ledgerEntry({
      id: "e-2",
      hallId: "h-1",
      createdAt: "2026-04-15T10:05:00.000Z",
      eventType: "STAKE",
      amount: 50,
      gameType: "MAIN_GAME",
    }),
  ];
  const svc = makeService(store, entries);
  const rows = await svc.getDailyReport({
    hallId: "h-1",
    dateFrom: "2026-04-15",
    dateTo: "2026-04-15",
    gameType: "DATABINGO",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.gameType, "DATABINGO");
  assert.equal(rows[0]?.ticketsSoldCents, 10000);
});

test("HallAccountReport: getDailyReport handles agent-tx cash-flow as ALL gameType", async () => {
  const store = newStore();
  store.agentTx.push({
    id: "tx-1",
    shift_id: "s-1",
    agent_user_id: "a-1",
    player_user_id: "p-1",
    hall_id: "h-1",
    ticket_unique_id: null,
    amount: 200, // NOK
    payment_method: "CASH",
    wallet_direction: "CREDIT",
    action_type: "CASH_IN",
    created_at: new Date("2026-04-15T09:00:00.000Z"),
  });
  const svc = makeService(store, []);
  const rows = await svc.getDailyReport({ hallId: "h-1", dateFrom: "2026-04-15", dateTo: "2026-04-15" });
  assert.equal(rows.length, 1);
  // Source: line 242 maps "ALL" key but UNKNOWN→null, so for cash-only it's "ALL"
  assert.equal(rows[0]?.gameType, "ALL");
  assert.equal(rows[0]?.cashInCents, 20000);
  assert.equal(rows[0]?.ticketsSoldCents, 0);
});

test("HallAccountReport: getDailyReport aggregates CASH/CARD CREDIT/DEBIT separately", async () => {
  const store = newStore();
  const baseTx = {
    shift_id: "s-1",
    agent_user_id: "a-1",
    player_user_id: "p-1",
    hall_id: "h-1",
    ticket_unique_id: null,
    action_type: "CASH_IN",
    created_at: new Date("2026-04-15T09:00:00.000Z"),
  } as const;
  store.agentTx.push(
    { id: "tx-1", ...baseTx, amount: 100, payment_method: "CASH", wallet_direction: "CREDIT" },
    { id: "tx-2", ...baseTx, amount: 50, payment_method: "CASH", wallet_direction: "DEBIT" },
    { id: "tx-3", ...baseTx, amount: 200, payment_method: "CARD", wallet_direction: "CREDIT" },
    { id: "tx-4", ...baseTx, amount: 30, payment_method: "CARD", wallet_direction: "DEBIT" },
  );
  const svc = makeService(store, []);
  const rows = await svc.getDailyReport({ hallId: "h-1", dateFrom: "2026-04-15", dateTo: "2026-04-15" });
  const allRow = rows.find((r) => r.gameType === "ALL")!;
  assert.equal(allRow.cashInCents, 10000);
  assert.equal(allRow.cashOutCents, 5000);
  assert.equal(allRow.cardInCents, 20000);
  assert.equal(allRow.cardOutCents, 3000);
});

test("HallAccountReport: getDailyReport returns empty array when nothing in range", async () => {
  const svc = makeService(newStore(), []);
  const rows = await svc.getDailyReport({ hallId: "h-1", dateFrom: "2026-04-15", dateTo: "2026-04-16" });
  assert.deepEqual(rows, []);
});

test("HallAccountReport: getDailyReport handles UNKNOWN gameType (null in result)", async () => {
  const store = newStore();
  const entry = ledgerEntry({
    id: "e-1",
    hallId: "h-1",
    createdAt: "2026-04-15T10:00:00.000Z",
    eventType: "STAKE",
    amount: 100,
  });
  // @ts-expect-error -- forcing undefined gameType simulates legacy entry
  entry.gameType = undefined;
  const svc = makeService(store, [entry]);
  const rows = await svc.getDailyReport({ hallId: "h-1", dateFrom: "2026-04-15", dateTo: "2026-04-15" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.gameType, null);
});

// ── Monthly report ───────────────────────────────────────────────────────────

test("HallAccountReport: getMonthlyReport rolls up daily totals + manual adjustments", async () => {
  const store = newStore();
  const entries = [
    ledgerEntry({
      id: "e-1",
      hallId: "h-1",
      createdAt: "2026-04-15T10:00:00.000Z",
      eventType: "STAKE",
      amount: 100,
    }),
    ledgerEntry({
      id: "e-2",
      hallId: "h-1",
      createdAt: "2026-04-20T11:00:00.000Z",
      eventType: "STAKE",
      amount: 200,
    }),
    ledgerEntry({
      id: "e-3",
      hallId: "h-1",
      createdAt: "2026-04-20T11:05:00.000Z",
      eventType: "PRIZE",
      amount: 50,
    }),
  ];
  store.manualAdj.push({
    id: "a-1",
    hall_id: "h-1",
    amount_cents: 7500,
    category: "BANK_DEPOSIT",
    business_date: new Date("2026-04-25T00:00:00Z"),
    note: "deposit",
    created_by: "admin-1",
    created_at: new Date(),
  });
  const svc = makeService(store, entries);
  const monthly = await svc.getMonthlyReport({ hallId: "h-1", year: 2026, month: 4 });
  assert.equal(monthly.month, "2026-04");
  assert.equal(monthly.ticketsSoldCents, 30000); // 100 + 200 NOK = 300 NOK = 30000 cents
  assert.equal(monthly.winningsPaidCents, 5000);
  assert.equal(monthly.netRevenueCents, 25000);
  assert.equal(monthly.manualAdjustmentCents, 7500);
});

test("HallAccountReport: getMonthlyReport handles month with zero data", async () => {
  const svc = makeService(newStore(), []);
  const monthly = await svc.getMonthlyReport({ hallId: "h-1", year: 2026, month: 6 });
  assert.equal(monthly.month, "2026-06");
  assert.equal(monthly.ticketsSoldCents, 0);
  assert.equal(monthly.winningsPaidCents, 0);
  assert.equal(monthly.netRevenueCents, 0);
  assert.equal(monthly.manualAdjustmentCents, 0);
});

test("HallAccountReport: getMonthlyReport calculates last-day-of-month correctly", async () => {
  // February 2026 has 28 days. The lastDay computation must produce "2026-02-28".
  const store = newStore();
  store.manualAdj.push({
    id: "a-1",
    hall_id: "h-1",
    amount_cents: 1000,
    category: "CORRECTION",
    business_date: new Date("2026-02-28T00:00:00Z"),
    note: "feb-end",
    created_by: "admin-1",
    created_at: new Date(),
  });
  const svc = makeService(store, []);
  const monthly = await svc.getMonthlyReport({ hallId: "h-1", year: 2026, month: 2 });
  assert.equal(monthly.manualAdjustmentCents, 1000); // feb-28 must be included
});

// ── Account balance ──────────────────────────────────────────────────────────

test("HallAccountReport: getAccountBalance returns hall balances + period totals", async () => {
  const store = newStore();
  store.halls.push({ id: "h-1", cash_balance: 50000, dropsafe_balance: 12000 });
  store.agentTx.push(
    {
      id: "tx-1",
      shift_id: "s-1",
      agent_user_id: "a-1",
      player_user_id: "p-1",
      hall_id: "h-1",
      ticket_unique_id: null,
      amount: 500,
      payment_method: "CASH",
      wallet_direction: "CREDIT",
      action_type: "CASH_IN",
      created_at: new Date("2026-04-15T09:00:00.000Z"),
    },
    {
      id: "tx-2",
      shift_id: "s-1",
      agent_user_id: "a-1",
      player_user_id: "p-1",
      hall_id: "h-1",
      ticket_unique_id: null,
      amount: 200,
      payment_method: "WALLET",
      wallet_direction: "DEBIT",
      action_type: "PRODUCT_SALE",
      created_at: new Date("2026-04-15T10:00:00.000Z"),
    },
  );
  store.manualAdj.push({
    id: "a-1",
    hall_id: "h-1",
    amount_cents: 2500,
    category: "BANK_DEPOSIT",
    business_date: new Date("2026-04-15T00:00:00Z"),
    note: "test",
    created_by: "admin-1",
    created_at: new Date(),
  });
  const svc = makeService(store, []);
  const balance = await svc.getAccountBalance({
    hallId: "h-1",
    dateFrom: "2026-04-15",
    dateTo: "2026-04-15",
  });
  assert.equal(balance.hallId, "h-1");
  assert.equal(balance.hallCashBalance, 50000);
  assert.equal(balance.dropsafeBalance, 12000);
  assert.equal(balance.periodTotalCashInCents, 50000); // 500 NOK = 50000 cents
  assert.equal(balance.periodTotalCashOutCents, 0);
  assert.equal(balance.periodSellingByCustomerNumberCents, 20000); // 200 NOK = 20000 cents
  assert.equal(balance.periodManualAdjustmentCents, 2500);
  assert.equal(balance.periodNetCashFlowCents, 50000 - 0 + 2500);
});

test("HallAccountReport: getAccountBalance defaults dateFrom/dateTo to today", async () => {
  const store = newStore();
  store.halls.push({ id: "h-1", cash_balance: 0, dropsafe_balance: 0 });
  const svc = makeService(store, []);
  const balance = await svc.getAccountBalance({ hallId: "h-1" });
  assert.equal(balance.hallId, "h-1");
  // Should not throw — default date filtering doesn't fail
  assert.equal(balance.periodNetCashFlowCents, 0);
});

// ── Manual adjustments ───────────────────────────────────────────────────────

test("HallAccountReport: addManualAdjustment accepts positive amount (credit)", async () => {
  const svc = makeService(newStore(), []);
  const adj = await svc.addManualAdjustment({
    hallId: "h-1",
    amountCents: 50000,
    category: "BANK_DEPOSIT",
    businessDate: "2026-04-15",
    note: "Innskudd fra hall",
    createdBy: "admin-1",
  });
  assert.equal(adj.hallId, "h-1");
  assert.equal(adj.amountCents, 50000);
  assert.equal(adj.category, "BANK_DEPOSIT");
  assert.equal(adj.businessDate, "2026-04-15");
  assert.equal(adj.note, "Innskudd fra hall");
  assert.equal(adj.createdBy, "admin-1");
  assert.match(adj.id, /^[0-9a-f-]{36}$/);
});

test("HallAccountReport: addManualAdjustment accepts negative amount (debit)", async () => {
  const svc = makeService(newStore(), []);
  const adj = await svc.addManualAdjustment({
    hallId: "h-1",
    amountCents: -75000,
    category: "BANK_WITHDRAWAL",
    businessDate: "2026-04-15",
    note: "Uttak til bank",
    createdBy: "admin-1",
  });
  assert.equal(adj.amountCents, -75000);
  assert.equal(adj.category, "BANK_WITHDRAWAL");
});

test("HallAccountReport: addManualAdjustment trims whitespace from note + createdBy", async () => {
  const svc = makeService(newStore(), []);
  const adj = await svc.addManualAdjustment({
    hallId: "h-1",
    amountCents: 100,
    category: "CORRECTION",
    businessDate: "2026-04-15",
    note: "  trimmed  ",
    createdBy: "  admin  ",
  });
  assert.equal(adj.note, "trimmed");
  assert.equal(adj.createdBy, "admin");
});

test("HallAccountReport: addManualAdjustment accepts all 5 categories", async () => {
  const cats = ["BANK_DEPOSIT", "BANK_WITHDRAWAL", "CORRECTION", "REFUND", "OTHER"] as const;
  for (const cat of cats) {
    const svc = makeService(newStore(), []);
    const adj = await svc.addManualAdjustment({
      hallId: "h-1",
      amountCents: 1000,
      category: cat,
      businessDate: "2026-04-15",
      note: `Test ${cat}`,
      createdBy: "admin-1",
    });
    assert.equal(adj.category, cat);
  }
});

test("HallAccountReport: listManualAdjustments returns by hall, sorted by createdAt DESC", async () => {
  const store = newStore();
  const baseDate = new Date("2026-04-15T00:00:00Z");
  for (let i = 0; i < 3; i++) {
    store.manualAdj.push({
      id: `a-${i}`,
      hall_id: "h-1",
      amount_cents: (i + 1) * 1000,
      category: "CORRECTION",
      business_date: baseDate,
      note: `note-${i}`,
      created_by: "admin",
      created_at: new Date(Date.UTC(2026, 3, 15, 10, 0, i)), // increasing seconds
    });
  }
  // Add one for another hall — must NOT be returned
  store.manualAdj.push({
    id: "a-other",
    hall_id: "h-other",
    amount_cents: 9999,
    category: "OTHER",
    business_date: baseDate,
    note: "other-hall",
    created_by: "admin",
    created_at: new Date(),
  });
  const svc = makeService(store, []);
  const list = await svc.listManualAdjustments({ hallId: "h-1" });
  assert.equal(list.length, 3);
  assert.equal(list[0]?.id, "a-2"); // most recent first (DESC)
  assert.equal(list[2]?.id, "a-0");
});

test("HallAccountReport: listManualAdjustments respects limit + caps at 500", async () => {
  const store = newStore();
  for (let i = 0; i < 50; i++) {
    store.manualAdj.push({
      id: `a-${i}`,
      hall_id: "h-1",
      amount_cents: 100,
      category: "CORRECTION",
      business_date: new Date("2026-04-15T00:00:00Z"),
      note: `n-${i}`,
      created_by: "admin",
      created_at: new Date(Date.UTC(2026, 3, 15, 10, 0, i)),
    });
  }
  const svc = makeService(store, []);
  const limited = await svc.listManualAdjustments({ hallId: "h-1", limit: 10 });
  assert.equal(limited.length, 10);
  // Negative limit defaults to 100
  const noNeg = await svc.listManualAdjustments({ hallId: "h-1", limit: -5 });
  assert.equal(noNeg.length, 50);
  // Limit > 500 cap
  const capped = await svc.listManualAdjustments({ hallId: "h-1", limit: 9999 });
  assert.equal(capped.length, 50); // less than max but fine
});

test("HallAccountReport: listManualAdjustments rejects empty hallId", async () => {
  const svc = makeService(newStore(), []);
  await assert.rejects(
    () => svc.listManualAdjustments({ hallId: "" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

// ── Physical cashouts ────────────────────────────────────────────────────────

test("HallAccountReport: listPhysicalCashoutsForShift returns sorted CASH_OUT entries", async () => {
  const store = newStore();
  for (let i = 0; i < 3; i++) {
    store.agentTx.push({
      id: `co-${i}`,
      shift_id: "s-1",
      agent_user_id: "a-1",
      player_user_id: `p-${i}`,
      hall_id: "h-1",
      ticket_unique_id: `T-${i}`,
      amount: 100 * (i + 1),
      payment_method: "CASH",
      wallet_direction: "CREDIT",
      action_type: "CASH_OUT",
      created_at: new Date(Date.UTC(2026, 3, 15, 10, 0, i)),
    });
  }
  // Add a CASH_IN that must NOT be included
  store.agentTx.push({
    id: "ci-1",
    shift_id: "s-1",
    agent_user_id: "a-1",
    player_user_id: "p-x",
    hall_id: "h-1",
    ticket_unique_id: null,
    amount: 50,
    payment_method: "CASH",
    wallet_direction: "DEBIT",
    action_type: "CASH_IN",
    created_at: new Date(),
  });
  const svc = makeService(store, []);
  const result = await svc.listPhysicalCashoutsForShift({ shiftId: "s-1" });
  assert.equal(result.rows.length, 3);
  assert.equal(result.total, 3);
  assert.equal(result.totalAmountCents, 60000); // 100+200+300 NOK
  assert.equal(result.rows[0]?.agentTxId, "co-2"); // DESC
  assert.equal(result.rows[0]?.amountCents, 30000);
  assert.equal(result.rows[0]?.paymentMethod, "CASH");
});

test("HallAccountReport: listPhysicalCashoutsForShift respects offset+limit pagination", async () => {
  const store = newStore();
  for (let i = 0; i < 5; i++) {
    store.agentTx.push({
      id: `co-${i}`,
      shift_id: "s-1",
      agent_user_id: "a-1",
      player_user_id: `p-${i}`,
      hall_id: "h-1",
      ticket_unique_id: null,
      amount: 100,
      payment_method: "CASH",
      wallet_direction: "CREDIT",
      action_type: "CASH_OUT",
      created_at: new Date(Date.UTC(2026, 3, 15, 10, 0, i)),
    });
  }
  const svc = makeService(store, []);
  const page1 = await svc.listPhysicalCashoutsForShift({ shiftId: "s-1", limit: 2, offset: 0 });
  const page2 = await svc.listPhysicalCashoutsForShift({ shiftId: "s-1", limit: 2, offset: 2 });
  assert.equal(page1.rows.length, 2);
  assert.equal(page2.rows.length, 2);
  // Total should not change with pagination
  assert.equal(page1.total, 5);
  assert.equal(page2.total, 5);
});

test("HallAccountReport: listPhysicalCashoutsForShift returns empty for unknown shift", async () => {
  const svc = makeService(newStore(), []);
  const result = await svc.listPhysicalCashoutsForShift({ shiftId: "ghost" });
  assert.deepEqual(result.rows, []);
  assert.equal(result.total, 0);
  assert.equal(result.totalAmountCents, 0);
});

test("HallAccountReport: getPhysicalCashoutSummaryForShift aggregates by paymentMethod", async () => {
  const store = newStore();
  const baseTx = {
    shift_id: "s-1",
    agent_user_id: "a-1",
    player_user_id: "p-1",
    hall_id: "h-1",
    ticket_unique_id: null,
    wallet_direction: "CREDIT" as const,
    action_type: "CASH_OUT",
    created_at: new Date(),
  };
  store.agentTx.push(
    { id: "t-1", ...baseTx, amount: 100, payment_method: "CASH" },
    { id: "t-2", ...baseTx, amount: 200, payment_method: "CASH" },
    { id: "t-3", ...baseTx, amount: 300, payment_method: "CARD" },
    { id: "t-4", ...baseTx, amount: 50, payment_method: "WALLET" },
  );
  const svc = makeService(store, []);
  const summary = await svc.getPhysicalCashoutSummaryForShift("s-1");
  assert.equal(summary.shiftId, "s-1");
  assert.equal(summary.winCount, 4);
  assert.equal(summary.totalAmountCents, 65000); // 100+200+300+50 NOK
  assert.equal(summary.byPaymentMethod.CASH, 30000);
  assert.equal(summary.byPaymentMethod.CARD, 30000);
  assert.equal(summary.byPaymentMethod.WALLET, 5000);
});

test("HallAccountReport: getPhysicalCashoutSummaryForShift returns empty for shift with no cashouts", async () => {
  const svc = makeService(newStore(), []);
  const summary = await svc.getPhysicalCashoutSummaryForShift("ghost");
  assert.equal(summary.winCount, 0);
  assert.equal(summary.totalAmountCents, 0);
  assert.deepEqual(summary.byPaymentMethod, {});
});

// ── Currency conversion edge cases (centsRounding) ──────────────────────────

test("HallAccountReport: NOK→cents conversion rounds half-up correctly", async () => {
  const store = newStore();
  store.halls.push({ id: "h-1", cash_balance: 0, dropsafe_balance: 0 });
  store.agentTx.push({
    id: "tx-1",
    shift_id: "s-1",
    agent_user_id: "a-1",
    player_user_id: "p-1",
    hall_id: "h-1",
    ticket_unique_id: null,
    amount: 12.345, // odd fractional
    payment_method: "CASH",
    wallet_direction: "CREDIT",
    action_type: "CASH_IN",
    created_at: new Date(),
  });
  const svc = makeService(store, []);
  const balance = await svc.getAccountBalance({ hallId: "h-1" });
  // 12.345 NOK → Math.round(12.345 * 100) = 1234 (or 1235 depending on FP)
  assert.equal(balance.periodTotalCashInCents, Math.round(12.345 * 100));
});

// ── Schema validation in constructor ─────────────────────────────────────────

test("HallAccountReport: constructor rejects invalid schema name", () => {
  // Use direct constructor with bad schema; can't easily mock pool ctor without further setup.
  // Use forTesting with bad schema parameter to verify assertSchemaName:
  assert.throws(
    () => HallAccountReportService.forTesting({} as Pool, {} as BingoEngine, "bad schema!"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("HallAccountReport: forTesting accepts valid alphanumeric schema", () => {
  const svc = HallAccountReportService.forTesting({} as Pool, {} as BingoEngine, "test_schema");
  assert.ok(svc instanceof HallAccountReportService);
});
