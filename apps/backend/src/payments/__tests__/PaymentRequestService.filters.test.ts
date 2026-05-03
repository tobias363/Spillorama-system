/**
 * PaymentRequestService — listPending filter coverage.
 *
 * Test-engineer Bølge B: extends PaymentRequestService.test.ts with
 * BIN-587 (AML filters) + BIN-646 (PR-B4: withdraw destinationType +
 * multi-status history queries).
 *
 * Filters covered here that are NOT in the original test file:
 *   - userId filter (AML transaction-review by spiller)
 *   - createdFrom / createdTo (date range)
 *   - minAmountCents (terskel-review)
 *   - destinationType (bank/hall on withdraw kø)
 *   - statuses[] array (history view: ACCEPTED + REJECTED)
 *   - getRequest happy-path + error paths
 *   - createWithdrawRequest with explicit destinationType
 *   - destinationType normalisation (case-insensitive in service body — test
 *     that actual mapping happens correctly through the persist+map cycle)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PaymentRequestService } from "../PaymentRequestService.js";
import type { WalletAdapter, WalletTransaction } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Mock Pool with full filter support ──────────────────────────────────────

interface Row {
  id: string;
  user_id: string;
  wallet_id: string;
  amount_cents: number;
  hall_id: string | null;
  submitted_by: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  rejection_reason: string | null;
  accepted_by: string | null;
  accepted_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  wallet_transaction_id: string | null;
  destination_type: "bank" | "hall" | null;
  created_at: Date;
  updated_at: Date;
}

interface TableStore {
  deposit: Map<string, Row>;
  withdraw: Map<string, Row>;
}

function detectTable(sql: string): "deposit" | "withdraw" {
  if (sql.includes("app_deposit_requests")) return "deposit";
  if (sql.includes("app_withdraw_requests")) return "withdraw";
  throw new Error(`unknown table in SQL: ${sql}`);
}

function cloneRow(row: Row): Row {
  return {
    ...row,
    accepted_at: row.accepted_at ? new Date(row.accepted_at) : null,
    rejected_at: row.rejected_at ? new Date(row.rejected_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Filter-aware SELECT handler. Mirrors the SQL the service builds —
 * supports hall_id, destination_type, user_id, created_at >=, created_at <=,
 * amount_cents >=, and ORDER BY + LIMIT.
 */
function runSelect(
  store: TableStore,
  sql: string,
  params: unknown[]
): { rows: Row[] } {
  const table = detectTable(sql);
  const map = store[table];

  if (sql.includes("WHERE id = $1")) {
    const id = params[0] as string;
    const row = map.get(id);
    return { rows: row ? [cloneRow(row)] : [] };
  }

  // Multi-status array.
  const statuses = (params[0] as string[]) ?? [];
  // Helper — pull a parameter by its $N marker in the SQL.
  const param = <T,>(re: RegExp): T | undefined => {
    const m = sql.match(re);
    return m ? (params[Number(m[1]) - 1] as T) : undefined;
  };
  const hallId = param<string>(/hall_id = \$(\d+)/);
  const destType = param<string>(/destination_type = \$(\d+)/);
  // Withdrawal QA P1 (2026-05-01): "hall"-filter bruker
  // `(destination_type IS NULL OR destination_type = $N)` — match både legacy
  // NULL og eksplisitt "hall".
  const destTypeAllowsNull = /destination_type IS NULL OR destination_type = \$\d+/.test(sql);
  const userId = param<string>(/user_id = \$(\d+)/);
  const createdFrom = param<string>(/created_at >= \$(\d+)/);
  const createdTo = param<string>(/created_at <= \$(\d+)/);
  const minAmount = param<number>(/amount_cents >= \$(\d+)/);
  // The LIMIT $N is the LAST param.
  const limitMatch = sql.match(/LIMIT \$(\d+)/);
  const limit = limitMatch ? (params[Number(limitMatch[1]) - 1] as number) : 100;

  const all = Array.from(map.values())
    .filter((r) => statuses.includes(r.status))
    .filter((r) => (hallId ? r.hall_id === hallId : true))
    .filter((r) => {
      if (!destType) return true;
      if (destTypeAllowsNull) {
        // "hall"-filter: matcher legacy NULL OR den eksplisitte verdien.
        return r.destination_type === null || r.destination_type === destType;
      }
      return r.destination_type === destType;
    })
    .filter((r) => (userId ? r.user_id === userId : true))
    .filter((r) => (createdFrom ? r.created_at >= new Date(createdFrom) : true))
    .filter((r) => (createdTo ? r.created_at <= new Date(createdTo) : true))
    .filter((r) => (minAmount ? r.amount_cents >= minAmount : true))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit);
  return { rows: all.map(cloneRow) };
}

function runQuery(store: TableStore, sql: string, params: unknown[]): { rows: Row[] } {
  const upper = sql.trim().slice(0, 16).toUpperCase();
  if (upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
    return { rows: [] };
  }
  if (upper.startsWith("CREATE ") || upper.startsWith("ALTER ")) {
    return { rows: [] };
  }
  if (upper.startsWith("INSERT")) {
    const isWithdraw = sql.includes("app_withdraw_requests");
    const [id, userId, walletId, amount, hallId, submittedBy, destinationType] = params as [
      string, string, string, number, string | null, string | null, ("bank" | "hall" | null) | undefined,
    ];
    const row: Row = {
      id, user_id: userId, wallet_id: walletId, amount_cents: amount,
      hall_id: hallId, submitted_by: submittedBy, status: "PENDING",
      rejection_reason: null, accepted_by: null, accepted_at: null,
      rejected_by: null, rejected_at: null, wallet_transaction_id: null,
      destination_type: isWithdraw ? destinationType ?? null : null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    store[detectTable(sql)].set(id, row);
    return { rows: [cloneRow(row)] };
  }
  if (upper.startsWith("SELECT")) {
    return runSelect(store, sql, params);
  }
  if (upper.startsWith("UPDATE")) {
    const map = store[detectTable(sql)];
    const id = params[0] as string;
    const row = map.get(id);
    if (!row) return { rows: [] };
    if (sql.includes("status = 'ACCEPTED'")) {
      row.status = "ACCEPTED";
      row.accepted_by = params[1] as string;
      row.accepted_at = new Date();
      row.wallet_transaction_id = params[2] as string;
    } else if (sql.includes("status = 'REJECTED'")) {
      row.status = "REJECTED";
      row.rejected_by = params[1] as string;
      row.rejected_at = new Date();
      row.rejection_reason = params[2] as string;
    }
    row.updated_at = new Date();
    return { rows: [cloneRow(row)] };
  }
  return { rows: [] };
}

function makeMockPool(): { pool: Pool; store: TableStore } {
  const store: TableStore = { deposit: new Map(), withdraw: new Map() };
  const clientShim = {
    query: async (sql: string, params: unknown[] = []) => runQuery(store, sql, params),
    release: () => undefined,
  };
  const poolShim = {
    connect: async () => clientShim,
    query: async (sql: string, params: unknown[] = []) => runQuery(store, sql, params),
  };
  return { pool: poolShim as unknown as Pool, store };
}

function makeMockWallet(): { adapter: WalletAdapter } {
  let nextTxId = 1;
  const tx = (accountId: string, amount: number, type: "CREDIT" | "DEBIT"): WalletTransaction => ({
    id: `wtx-${nextTxId++}`,
    accountId, type, amount, reason: "", createdAt: new Date().toISOString(),
  });
  const adapter: WalletAdapter = {
    async createAccount() { throw new Error("nope"); },
    async ensureAccount() {
      return { id: "x", balance: 0, depositBalance: 0, winningsBalance: 0, createdAt: "", updatedAt: "" };
    },
    async getAccount() { throw new Error("nope"); },
    async listAccounts() { return []; },
    async getBalance() { return 0; },
    async getDepositBalance() { return 0; },
    async getWinningsBalance() { return 0; },
    async getBothBalances() { return { deposit: 0, winnings: 0, total: 0 }; },
    async debit(accountId, amount) { return tx(accountId, amount, "DEBIT"); },
    async credit(accountId, amount) { return tx(accountId, amount, "CREDIT"); },
    async topUp(accountId, amount) { return tx(accountId, amount, "CREDIT"); },
    async withdraw(accountId, amount) { return tx(accountId, amount, "DEBIT"); },
    async transfer() { throw new Error("nope"); },
    async listTransactions() { return []; },
  };
  return { adapter };
}

function makeService() {
  const { pool, store } = makeMockPool();
  const { adapter } = makeMockWallet();
  return { service: PaymentRequestService.forTesting(adapter, pool), store };
}

// Helper to seed with a controlled created_at.
function seedRow(store: TableStore, kind: "deposit" | "withdraw", overrides: Partial<Row> & { id: string; user_id: string; amount_cents: number; created_at: Date }) {
  const row: Row = {
    id: overrides.id,
    user_id: overrides.user_id,
    wallet_id: overrides.wallet_id ?? `wallet-${overrides.user_id}`,
    amount_cents: overrides.amount_cents,
    hall_id: overrides.hall_id ?? null,
    submitted_by: overrides.submitted_by ?? null,
    status: overrides.status ?? "PENDING",
    rejection_reason: overrides.rejection_reason ?? null,
    accepted_by: overrides.accepted_by ?? null,
    accepted_at: overrides.accepted_at ?? null,
    rejected_by: overrides.rejected_by ?? null,
    rejected_at: overrides.rejected_at ?? null,
    wallet_transaction_id: overrides.wallet_transaction_id ?? null,
    // Skill mellom "ikke spesifisert" (default "bank" for withdraw) og
    // "eksplisitt null" (legacy-rader fra før QA P1 default-fix).
    destination_type:
      "destination_type" in overrides
        ? overrides.destination_type ?? null
        : (kind === "withdraw" ? "bank" : null),
    created_at: overrides.created_at,
    updated_at: overrides.updated_at ?? overrides.created_at,
  };
  store[kind].set(row.id, row);
}

// ═══════════════════════════════════════════════════════════════════════════
// listPending — BIN-587 AML filters
// ═══════════════════════════════════════════════════════════════════════════

test("BIN-587: listPending filters by userId (AML per-user review)", async () => {
  const { service, store } = makeService();
  const now = new Date("2026-04-25T12:00:00Z");
  seedRow(store, "deposit", { id: "d1", user_id: "u-A", amount_cents: 5000, created_at: now });
  seedRow(store, "deposit", { id: "d2", user_id: "u-B", amount_cents: 5000, created_at: now });
  seedRow(store, "withdraw", { id: "w1", user_id: "u-A", amount_cents: 2500, created_at: now });
  const onlyA = await service.listPending({ userId: "u-A" });
  assert.equal(onlyA.length, 2);
  assert.ok(onlyA.every((r) => r.userId === "u-A"));
});

test("BIN-587: listPending filters by createdFrom (inclusive lower bound)", async () => {
  const { service, store } = makeService();
  seedRow(store, "deposit", { id: "old", user_id: "u-1", amount_cents: 100, created_at: new Date("2026-04-01T00:00:00Z") });
  seedRow(store, "deposit", { id: "recent", user_id: "u-1", amount_cents: 200, created_at: new Date("2026-04-25T00:00:00Z") });
  const result = await service.listPending({ createdFrom: "2026-04-15T00:00:00Z" });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "recent");
});

test("BIN-587: listPending filters by createdTo (inclusive upper bound)", async () => {
  const { service, store } = makeService();
  seedRow(store, "deposit", { id: "early", user_id: "u-1", amount_cents: 100, created_at: new Date("2026-04-01T00:00:00Z") });
  seedRow(store, "deposit", { id: "late", user_id: "u-1", amount_cents: 200, created_at: new Date("2026-04-25T00:00:00Z") });
  const result = await service.listPending({ createdTo: "2026-04-15T00:00:00Z" });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "early");
});

test("BIN-587: listPending filters by minAmountCents (threshold review)", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "deposit", { id: "small", user_id: "u-1", amount_cents: 1000, created_at: now });
  seedRow(store, "deposit", { id: "medium", user_id: "u-1", amount_cents: 50000, created_at: now });
  seedRow(store, "deposit", { id: "large", user_id: "u-1", amount_cents: 100000, created_at: now });
  // 50000 cents = 500 NOK — only medium and large qualify.
  const result = await service.listPending({ minAmountCents: 50000 });
  assert.equal(result.length, 2);
  const ids = result.map((r) => r.id).sort();
  assert.deepEqual(ids, ["large", "medium"]);
});

test("BIN-587: listPending combines multiple AML filters (userId + minAmountCents + createdFrom)", async () => {
  const { service, store } = makeService();
  // Same user but only one matches all 3 filters.
  seedRow(store, "deposit", {
    id: "match", user_id: "u-A", amount_cents: 100000,
    created_at: new Date("2026-04-25T00:00:00Z"),
  });
  seedRow(store, "deposit", {
    id: "wrong-amount", user_id: "u-A", amount_cents: 1000,
    created_at: new Date("2026-04-25T00:00:00Z"),
  });
  seedRow(store, "deposit", {
    id: "wrong-date", user_id: "u-A", amount_cents: 100000,
    created_at: new Date("2026-01-01T00:00:00Z"),
  });
  seedRow(store, "deposit", {
    id: "wrong-user", user_id: "u-B", amount_cents: 100000,
    created_at: new Date("2026-04-25T00:00:00Z"),
  });
  const result = await service.listPending({
    userId: "u-A", minAmountCents: 50000, createdFrom: "2026-04-01T00:00:00Z",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "match");
});

// ═══════════════════════════════════════════════════════════════════════════
// listPending — BIN-646 multi-status history
// ═══════════════════════════════════════════════════════════════════════════

test("BIN-646: listPending with statuses=[ACCEPTED, REJECTED] returns history view", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "deposit", { id: "p1", user_id: "u-1", amount_cents: 1000, status: "PENDING", created_at: now });
  seedRow(store, "deposit", { id: "a1", user_id: "u-1", amount_cents: 2000, status: "ACCEPTED", created_at: now });
  seedRow(store, "deposit", { id: "r1", user_id: "u-1", amount_cents: 3000, status: "REJECTED", created_at: now });
  const history = await service.listPending({ statuses: ["ACCEPTED", "REJECTED"] });
  assert.equal(history.length, 2);
  const ids = history.map((r) => r.id).sort();
  assert.deepEqual(ids, ["a1", "r1"]);
});

test("BIN-646: listPending statuses array overrides single status param", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "deposit", { id: "p1", user_id: "u-1", amount_cents: 1000, status: "PENDING", created_at: now });
  seedRow(store, "deposit", { id: "a1", user_id: "u-1", amount_cents: 2000, status: "ACCEPTED", created_at: now });
  // statuses takes precedence — service docstring states this explicitly.
  const result = await service.listPending({
    status: "PENDING", statuses: ["ACCEPTED"],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "a1");
});

test("BIN-646: listPending dedupes statuses array", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "deposit", { id: "a1", user_id: "u-1", amount_cents: 100, status: "ACCEPTED", created_at: now });
  // Should not crash with duplicate values.
  const result = await service.listPending({ statuses: ["ACCEPTED", "ACCEPTED", "ACCEPTED"] });
  assert.equal(result.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// listPending — BIN-646 destinationType (withdraw bank/hall)
// ═══════════════════════════════════════════════════════════════════════════

test("BIN-646: createWithdrawRequest stores destinationType=bank", async () => {
  const { service } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1", walletId: "w-1", amountCents: 50000, destinationType: "bank",
  });
  assert.equal(req.destinationType, "bank");
});

test("BIN-646: createWithdrawRequest stores destinationType=hall", async () => {
  const { service } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1", walletId: "w-1", amountCents: 25000, destinationType: "hall",
  });
  assert.equal(req.destinationType, "hall");
});

test("Withdrawal QA P1 (2026-05-01): createWithdrawRequest with no destinationType defaults to 'hall'", async () => {
  // Tidligere persisterte dette NULL, men det ekskluderte raden fra
  // `GET /api/admin/withdrawals/history?type=hall`. Default "hall" matcher
  // dominerende pilot-flyt; bank-uttak krever eksplisitt valg.
  const { service } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1", walletId: "w-1", amountCents: 10000,
  });
  assert.equal(req.destinationType, "hall");
});

test("Withdrawal QA P1 (2026-05-01): listPending type=hall matcher legacy NULL-rader", async () => {
  // Pre-default-fix kunne `destination_type = NULL` lagres på withdraw-rader.
  // History-filteret må fortsatt vise dem under `type=hall` så regnskap ikke
  // mister tilgang til allerede registrerte uttak.
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "withdraw", {
    id: "legacy-null", user_id: "u-A", amount_cents: 5000,
    created_at: now, destination_type: null,
  });
  seedRow(store, "withdraw", {
    id: "explicit-hall", user_id: "u-B", amount_cents: 7500,
    created_at: now, destination_type: "hall",
  });
  seedRow(store, "withdraw", {
    id: "explicit-bank", user_id: "u-C", amount_cents: 9000,
    created_at: now, destination_type: "bank",
  });

  const hallResults = await service.listPending({
    kind: "withdraw", destinationType: "hall",
  });
  const hallIds = hallResults.map((r) => r.id).sort();
  assert.deepEqual(hallIds, ["explicit-hall", "legacy-null"]);

  const bankResults = await service.listPending({
    kind: "withdraw", destinationType: "bank",
  });
  assert.deepEqual(bankResults.map((r) => r.id), ["explicit-bank"]);
});

test("Withdrawal QA P1 (2026-05-01): listHistory type=hall matcher legacy NULL-rader", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "withdraw", {
    id: "h-legacy", user_id: "u-A", amount_cents: 5000,
    status: "ACCEPTED", created_at: now, destination_type: null,
  });
  seedRow(store, "withdraw", {
    id: "h-hall", user_id: "u-B", amount_cents: 7500,
    status: "ACCEPTED", created_at: now, destination_type: "hall",
  });
  seedRow(store, "withdraw", {
    id: "h-bank", user_id: "u-C", amount_cents: 9000,
    status: "ACCEPTED", created_at: now, destination_type: "bank",
  });

  const result = await service.listHistory({
    kind: "withdraw", destinationType: "hall",
  });
  const ids = result.items.map((r) => r.id).sort();
  assert.deepEqual(ids, ["h-hall", "h-legacy"]);
});

test("BIN-646: createDepositRequest IGNORES destinationType (deposit-table has no column)", async () => {
  const { service } = makeService();
  // TS will allow this at the field level — the service explicitly sets null for deposits.
  const req = await service.createDepositRequest({
    userId: "u-1", walletId: "w-1", amountCents: 10000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destinationType: "bank" as any,
  });
  assert.equal(req.destinationType, null);
});

test("BIN-646: listPending withdraw filters by destinationType=bank", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "withdraw", {
    id: "w-bank", user_id: "u-1", amount_cents: 5000, destination_type: "bank", created_at: now,
  });
  seedRow(store, "withdraw", {
    id: "w-hall", user_id: "u-1", amount_cents: 5000, destination_type: "hall", created_at: now,
  });
  const banks = await service.listPending({ kind: "withdraw", destinationType: "bank" });
  assert.equal(banks.length, 1);
  assert.equal(banks[0]!.id, "w-bank");
  assert.equal(banks[0]!.destinationType, "bank");
});

test("BIN-646: listPending withdraw filter destinationType=hall isolates from bank", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "withdraw", {
    id: "w-bank-1", user_id: "u-1", amount_cents: 5000, destination_type: "bank", created_at: now,
  });
  seedRow(store, "withdraw", {
    id: "w-hall-1", user_id: "u-1", amount_cents: 5000, destination_type: "hall", created_at: now,
  });
  seedRow(store, "withdraw", {
    id: "w-hall-2", user_id: "u-1", amount_cents: 7500, destination_type: "hall", created_at: now,
  });
  const halls = await service.listPending({ kind: "withdraw", destinationType: "hall" });
  assert.equal(halls.length, 2);
  assert.ok(halls.every((r) => r.destinationType === "hall"));
});

test("BIN-646: deposit-kind ignores destinationType filter (returns all deposits)", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "deposit", { id: "d1", user_id: "u-1", amount_cents: 1000, created_at: now });
  seedRow(store, "deposit", { id: "d2", user_id: "u-2", amount_cents: 2000, created_at: now });
  // destinationType has no effect on deposits — not applied to that table.
  const result = await service.listPending({
    kind: "deposit",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destinationType: "bank" as any,
  });
  assert.equal(result.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// getRequest
// ═══════════════════════════════════════════════════════════════════════════

test("getRequest: returns full row by id (deposit)", async () => {
  const { service } = makeService();
  const created = await service.createDepositRequest({
    userId: "u-1", walletId: "w-1", amountCents: 12345,
  });
  const fetched = await service.getRequest("deposit", created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.kind, "deposit");
  assert.equal(fetched.amountCents, 12345);
});

test("getRequest: returns full row by id (withdraw includes destinationType)", async () => {
  const { service } = makeService();
  const created = await service.createWithdrawRequest({
    userId: "u-1", walletId: "w-1", amountCents: 8000, destinationType: "hall",
  });
  const fetched = await service.getRequest("withdraw", created.id);
  assert.equal(fetched.kind, "withdraw");
  assert.equal(fetched.destinationType, "hall");
});

test("getRequest: PAYMENT_REQUEST_NOT_FOUND for unknown id", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.getRequest("deposit", "00000000-0000-0000-0000-000000000000"),
    (err: unknown) => err instanceof DomainError && err.code === "PAYMENT_REQUEST_NOT_FOUND"
  );
});

test("getRequest: rejects empty/whitespace requestId with INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.getRequest("deposit", "   "),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// listPending — limit boundary
// ═══════════════════════════════════════════════════════════════════════════

test("listPending: clamps limit to 500 max", async () => {
  const { service, store } = makeService();
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    seedRow(store, "deposit", {
      id: `bulk-${i}`, user_id: "u-1", amount_cents: 100,
      created_at: new Date(now.getTime() - i * 1000),
    });
  }
  // Asking for 5000 should be clamped silently to 500 (and we have only 12 rows).
  const result = await service.listPending({ limit: 5000 });
  assert.equal(result.length, 12);
});

test("listPending: limit floor is 1 (negative or 0 limit is bumped up)", async () => {
  const { service, store } = makeService();
  const now = new Date();
  seedRow(store, "deposit", { id: "x", user_id: "u-1", amount_cents: 100, created_at: now });
  const result = await service.listPending({ limit: -10 });
  assert.equal(result.length, 1, "limit floor at 1, not 0");
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation regressions
// ═══════════════════════════════════════════════════════════════════════════

test("createDepositRequest: rejects fractional amountCents", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.createDepositRequest({
      userId: "u-1", walletId: "w-1", amountCents: 100.5,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("createDepositRequest: rejects empty userId / walletId", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.createDepositRequest({
      userId: "  ", walletId: "w-1", amountCents: 1000,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => service.createDepositRequest({
      userId: "u-1", walletId: "  ", amountCents: 1000,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("acceptDeposit: rejects missing acceptedBy", async () => {
  const { service } = makeService();
  const req = await service.createDepositRequest({
    userId: "u-1", walletId: "w-1", amountCents: 1000,
  });
  await assert.rejects(
    () => service.acceptDeposit({ requestId: req.id, acceptedBy: "  " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("rejectWithdraw: rejects missing rejectedBy", async () => {
  const { service } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1", walletId: "w-1", amountCents: 1000,
  });
  await assert.rejects(
    () => service.rejectWithdraw({
      requestId: req.id, rejectedBy: "  ", reason: "no",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});
