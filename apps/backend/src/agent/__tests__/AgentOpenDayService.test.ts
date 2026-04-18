/**
 * BIN-583 B3.8: unit-tester for AgentOpenDayService.
 *
 * Fokus på business-invariantene:
 *   - Rejecterer dobbelt-open for samme shift
 *   - Rejecterer pending settlement fra forrige dag
 *   - Rejecterer insufficient hall-cash
 *   - Atomic to-stegs-flyt (hall-debit, så shift-credit)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentOpenDayService } from "../AgentOpenDayService.js";
import type { AgentService } from "../AgentService.js";
import type { AgentShiftService } from "../AgentShiftService.js";
import type { AgentStore, ShiftCashDelta } from "../AgentStore.js";
import type { HallCashLedger, HallCashTransaction } from "../HallCashLedger.js";
import type { AgentSettlementStore, AgentSettlement } from "../AgentSettlementStore.js";
import { DomainError } from "../../game/BingoEngine.js";

interface TestCtx {
  service: AgentOpenDayService;
  spies: {
    ledgerTxs: HallCashTransaction[];
    shiftDeltas: Array<{ shiftId: string; delta: ShiftCashDelta }>;
  };
  state: {
    hallCashBalance: number;
    shiftDailyBalance: number;
  };
}

function makeCtx(opts: {
  currentShift?: { id: string; hallId: string; dailyBalance: number } | null;
  existingTxs?: HallCashTransaction[];
  settlementByShift?: Record<string, AgentSettlement | null>;
  shiftHistory?: Array<{ id: string; hallId: string; endedAt: string | null; dailyBalance: number }>;
  hallCashBalance?: number;
  shiftDeltaFails?: boolean;
}): TestCtx {
  const state = {
    hallCashBalance: opts.hallCashBalance ?? 10000,
    shiftDailyBalance: opts.currentShift?.dailyBalance ?? 0,
  };
  const spies = {
    ledgerTxs: [...(opts.existingTxs ?? [])],
    shiftDeltas: [] as Array<{ shiftId: string; delta: ShiftCashDelta }>,
  };

  const agents = { async requireActiveAgent() { /* ok */ } } as unknown as AgentService;
  const shifts = {
    async getCurrentShift() {
      if (opts.currentShift === null) return null;
      return opts.currentShift ?? { id: "shift-1", hallId: "hall-a", dailyBalance: state.shiftDailyBalance };
    },
    async getHistory() {
      return opts.shiftHistory ?? [];
    },
  } as unknown as AgentShiftService;

  const agentStore = {
    async applyShiftCashDelta(shiftId: string, delta: ShiftCashDelta) {
      if (opts.shiftDeltaFails) throw new Error("simulated shift-delta failure");
      spies.shiftDeltas.push({ shiftId, delta });
      state.shiftDailyBalance += delta.dailyBalance ?? 0;
      return {
        id: shiftId,
        userId: "ag-1",
        hallId: "hall-a",
        startedAt: "2026-04-21T08:00:00Z",
        endedAt: null,
        isActive: true,
        isLoggedOut: false,
        dailyBalance: state.shiftDailyBalance,
        totalCashIn: 0, totalCashOut: 0, totalCardIn: 0, totalCardOut: 0,
        sellingByCustomerNumber: 0,
        otherData: {},
        previousSettlement: {},
        createdAt: "2026-04-21T08:00:00Z",
        updatedAt: new Date().toISOString(),
      };
    },
  } as unknown as AgentStore;

  const ledger: HallCashLedger = {
    async applyCashTx(input) {
      const prev = state.hallCashBalance;
      const delta = input.direction === "CREDIT" ? input.amount : -input.amount;
      state.hallCashBalance += delta;
      const tx: HallCashTransaction = {
        id: `tx-${spies.ledgerTxs.length + 1}`,
        hallId: input.hallId,
        agentUserId: input.agentUserId ?? null,
        shiftId: input.shiftId ?? null,
        settlementId: input.settlementId ?? null,
        txType: input.txType,
        direction: input.direction,
        amount: input.amount,
        previousBalance: prev,
        afterBalance: state.hallCashBalance,
        notes: input.notes ?? null,
        otherData: input.otherData ?? {},
        createdAt: new Date().toISOString(),
      };
      spies.ledgerTxs.push(tx);
      return tx;
    },
    async getHallBalances() {
      return { cashBalance: state.hallCashBalance, dropsafeBalance: 0 };
    },
    async listForHall() {
      return spies.ledgerTxs;
    },
    async listForSettlement() { return []; },
  };

  const settlementStore: AgentSettlementStore = {
    async insert() { throw new Error("not used"); },
    async getById() { return null; },
    async getByShiftId(shiftId: string) {
      if (opts.settlementByShift && shiftId in opts.settlementByShift) {
        return opts.settlementByShift[shiftId] ?? null;
      }
      return null;
    },
    async list() { return []; },
    async applyEdit() { throw new Error("not used"); },
  };

  const service = new AgentOpenDayService({
    agentService: agents,
    agentShiftService: shifts,
    agentStore,
    hallCashLedger: ledger,
    settlementStore,
  });

  return { service, spies, state };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("AgentOpenDayService: openDay lykkes — hall debit + shift credit", async () => {
  const ctx = makeCtx({ hallCashBalance: 10000 });
  const result = await ctx.service.openDay({
    agentUserId: "ag-1", amount: 500,
  });
  assert.equal(result.amount, 500);
  assert.equal(result.dailyBalance, 500);
  assert.equal(result.hallCashBalanceAfter, 9500);
  assert.equal(ctx.spies.ledgerTxs.length, 1);
  assert.equal(ctx.spies.ledgerTxs[0]!.direction, "DEBIT");
  assert.equal(ctx.spies.ledgerTxs[0]!.txType, "DAILY_BALANCE_TRANSFER");
  assert.equal(ctx.spies.shiftDeltas.length, 1);
  assert.equal(ctx.spies.shiftDeltas[0]!.delta.dailyBalance, 500);
});

test("AgentOpenDayService: openDay avviser amount ≤ 0", async () => {
  const ctx = makeCtx({});
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: 0 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: -100 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("AgentOpenDayService: openDay avviser uten aktiv shift", async () => {
  const ctx = makeCtx({ currentShift: null });
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: 500 }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_ACTIVE_SHIFT"
  );
});

test("AgentOpenDayService: openDay avviser dobbelt-open for samme shift", async () => {
  const existingTx: HallCashTransaction = {
    id: "tx-0", hallId: "hall-a", agentUserId: "ag-1", shiftId: "shift-1",
    settlementId: null, txType: "DAILY_BALANCE_TRANSFER", direction: "DEBIT",
    amount: 500, previousBalance: 10000, afterBalance: 9500,
    notes: null, otherData: {}, createdAt: "2026-04-21T08:00:00Z",
  };
  const ctx = makeCtx({ existingTxs: [existingTx] });
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: 500 }),
    (err: unknown) => err instanceof DomainError && err.code === "DAY_ALREADY_OPENED"
  );
});

test("AgentOpenDayService: openDay avviser pending settlement fra forrige shift", async () => {
  const ctx = makeCtx({
    shiftHistory: [
      { id: "shift-1", hallId: "hall-a", endedAt: null, dailyBalance: 0 },
      { id: "shift-0", hallId: "hall-a", endedAt: "2026-04-20T23:00:00Z", dailyBalance: 0 },
    ],
    settlementByShift: { "shift-0": null },
  });
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: 500 }),
    (err: unknown) => err instanceof DomainError && err.code === "PREVIOUS_SETTLEMENT_PENDING"
  );
});

test("AgentOpenDayService: openDay avviser insufficient hall-cash", async () => {
  const ctx = makeCtx({ hallCashBalance: 100 });
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: 500 }),
    (err: unknown) => err instanceof DomainError && err.code === "INSUFFICIENT_HALL_CASH"
  );
});

test("AgentOpenDayService: shift-delta-feil etter hall-debit gir OPEN_DAY_PARTIAL_FAILURE", async () => {
  const ctx = makeCtx({ shiftDeltaFails: true });
  await assert.rejects(
    () => ctx.service.openDay({ agentUserId: "ag-1", amount: 500 }),
    (err: unknown) => err instanceof DomainError && err.code === "OPEN_DAY_PARTIAL_FAILURE"
  );
  // Hall-debit ble utført — det er akkurat dét feilen varsler om
  assert.equal(ctx.spies.ledgerTxs.length, 1);
});

test("AgentOpenDayService: getDailyBalance uten shift returnerer tom snapshot", async () => {
  const ctx = makeCtx({ currentShift: null });
  const snapshot = await ctx.service.getDailyBalance("ag-1");
  assert.equal(snapshot.shiftId, null);
  assert.equal(snapshot.dayOpened, false);
});

test("AgentOpenDayService: getDailyBalance med åpnet dag returnerer dayOpened=true", async () => {
  const existingTx: HallCashTransaction = {
    id: "tx-0", hallId: "hall-a", agentUserId: "ag-1", shiftId: "shift-1",
    settlementId: null, txType: "DAILY_BALANCE_TRANSFER", direction: "DEBIT",
    amount: 500, previousBalance: 10000, afterBalance: 9500,
    notes: null, otherData: {}, createdAt: "2026-04-21T08:00:00Z",
  };
  const ctx = makeCtx({
    existingTxs: [existingTx],
    currentShift: { id: "shift-1", hallId: "hall-a", dailyBalance: 500 },
  });
  const snapshot = await ctx.service.getDailyBalance("ag-1");
  assert.equal(snapshot.dayOpened, true);
  assert.equal(snapshot.dailyBalance, 500);
  assert.equal(snapshot.hallCashBalance, 10000);
});
