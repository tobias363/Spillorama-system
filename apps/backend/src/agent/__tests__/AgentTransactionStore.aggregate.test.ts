/**
 * PILOT-STOP-SHIP regression test (Code Review #1 P0-2):
 *
 * Tidligere `aggregateByShift` brukte `list({ limit: 500 })` og truncerte
 * stille på travle skift. Disse testene verifiserer at:
 *
 *  1. InMemoryAgentTransactionStore.aggregateByShift gir korrekt sum også
 *     med 100, 500, 1000 og 5000 transaksjoner (regression for truncation).
 *
 *  2. PostgresAgentTransactionStore.aggregateByShift bruker SQL `SUM` med
 *     `GROUP BY (action_type, payment_method, wallet_direction)` og
 *     parametrisert `WHERE shift_id = $1` — ingen `LIMIT`, ingen
 *     row-iteration på driver-siden. Verifiseres med en mocked Pool.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryAgentTransactionStore,
  PostgresAgentTransactionStore,
} from "../AgentTransactionStore.js";

// ── Hjelper: bygg et stort sett varierte rader på samme shift ──────────────

async function seedTransactions(
  store: InMemoryAgentTransactionStore,
  shiftId: string,
  count: number
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await store.insert({
      id: `tx-${shiftId}-${i}`,
      shiftId,
      agentUserId: "agent-1",
      playerUserId: `player-${i}`,
      hallId: "hall-1",
      actionType: i % 7 === 0 ? "TICKET_SALE" : i % 11 === 0 ? "TICKET_CANCEL" : "CASH_IN",
      walletDirection: i % 2 === 0 ? "CREDIT" : "DEBIT",
      paymentMethod: i % 3 === 0 ? "CASH" : i % 3 === 1 ? "CARD" : "WALLET",
      amount: 10,
      previousBalance: 0,
      afterBalance: 10,
    });
  }
}

// ── 1. InMemory: regression mot 500-cap ───────────────────────────────────

for (const txCount of [100, 500, 1000, 5000]) {
  test(`InMemory aggregateByShift: ${txCount} tx — totals matcher uten truncation`, async () => {
    const store = new InMemoryAgentTransactionStore();
    await seedTransactions(store, "s1", txCount);

    const agg = await store.aggregateByShift("s1");

    const totalSum =
      agg.cashIn + agg.cashOut +
      agg.cardIn + agg.cardOut +
      agg.walletIn + agg.walletOut;
    assert.equal(
      totalSum,
      txCount * 10,
      `forventet ${txCount * 10}, fikk ${totalSum} — truncation har slått inn`
    );

    let expectedSale = 0;
    let expectedCancel = 0;
    for (let i = 0; i < txCount; i++) {
      if (i % 7 === 0) expectedSale++;
      else if (i % 11 === 0) expectedCancel++;
    }
    assert.equal(agg.ticketSaleCount, expectedSale);
    assert.equal(agg.ticketCancelCount, expectedCancel);
  });
}

// ── 2. Postgres: bekrefter SQL-form og felt-mapping ───────────────────────

interface MockQueryCall {
  text: string;
  values: unknown[];
}

function makeMockPool(rows: unknown[]): {
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
  calls: MockQueryCall[];
} {
  const calls: MockQueryCall[] = [];
  const pool = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return { rows };
    },
  };
  return { pool, calls };
}

test("Postgres aggregateByShift: SQL bruker SUM + GROUP BY uten LIMIT", async () => {
  const { pool, calls } = makeMockPool([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new PostgresAgentTransactionStore({ pool: pool as any, schema: "public" });

  await store.aggregateByShift("shift-xyz");

  assert.equal(calls.length, 1, "skal kjøre nøyaktig én query");
  const sql = calls[0]!.text;

  assert.ok(/SUM\(amount\)/i.test(sql), "skal bruke SUM(amount)");
  assert.ok(/GROUP BY/i.test(sql), "skal ha GROUP BY");
  assert.ok(/COUNT\(\*\)/i.test(sql), "skal telle rader med COUNT(*)");
  assert.ok(/WHERE\s+shift_id\s*=\s*\$1/i.test(sql), "skal filtrere på shift_id parametrisert");
  assert.ok(!/\bLIMIT\b/i.test(sql), "skal ikke ha LIMIT — ble truncert til 500 før fix");

  assert.deepEqual(calls[0]!.values, ["shift-xyz"]);
});

test("Postgres aggregateByShift: mapper grouped SQL-rader til ShiftAggregate", async () => {
  const groupedRows = [
    { action_type: "CASH_IN", payment_method: "CASH", wallet_direction: "CREDIT", tx_count: "10", total_amount: "1000" },
    { action_type: "CASH_OUT", payment_method: "CASH", wallet_direction: "DEBIT", tx_count: "5", total_amount: "250" },
    { action_type: "CASH_IN", payment_method: "CARD", wallet_direction: "CREDIT", tx_count: "2", total_amount: "500" },
    { action_type: "TICKET_SALE", payment_method: "WALLET", wallet_direction: "DEBIT", tx_count: "3", total_amount: "150" },
    { action_type: "TICKET_CANCEL", payment_method: "WALLET", wallet_direction: "CREDIT", tx_count: "1", total_amount: "50" },
  ];
  const { pool } = makeMockPool(groupedRows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new PostgresAgentTransactionStore({ pool: pool as any, schema: "public" });

  const agg = await store.aggregateByShift("shift-1");

  assert.equal(agg.cashIn, 1000);
  assert.equal(agg.cashOut, 250);
  assert.equal(agg.cardIn, 500);
  assert.equal(agg.cardOut, 0);
  assert.equal(agg.walletIn, 50);
  assert.equal(agg.walletOut, 150);
  assert.equal(agg.ticketSaleCount, 3);
  assert.equal(agg.ticketCancelCount, 1);
});

test("Postgres aggregateByShift: tom resultat (ingen tx på shift) gir nuller", async () => {
  const { pool } = makeMockPool([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new PostgresAgentTransactionStore({ pool: pool as any, schema: "public" });

  const agg = await store.aggregateByShift("empty-shift");

  assert.deepEqual(agg, {
    cashIn: 0, cashOut: 0,
    cardIn: 0, cardOut: 0,
    walletIn: 0, walletOut: 0,
    ticketSaleCount: 0, ticketCancelCount: 0,
  });
});
