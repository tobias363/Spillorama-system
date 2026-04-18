/**
 * BIN-586: PaymentRequestService unit tests.
 *
 * Bruker en mock pg.Pool som oppfører seg som en in-memory-butikk for
 * `app_deposit_requests` og `app_withdraw_requests`. WalletAdapter er
 * også mocket — tester verifiserer at credit/debit kalles med riktige
 * argumenter, og at failed wallet-operasjoner ruller tilbake statusen.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PaymentRequestService } from "../PaymentRequestService.js";
import type { WalletAdapter, WalletTransaction } from "../../adapters/WalletAdapter.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Mock Pool ──────────────────────────────────────────────────────────────

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
  throw new Error(`cannot detect table in SQL: ${sql}`);
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

function runQuery(
  store: TableStore,
  sql: string,
  params: unknown[]
): { rows: Row[] } {
  const trimmed = sql.trim();
  const upper = trimmed.slice(0, 16).toUpperCase();

  if (upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
    return { rows: [] };
  }
  if (upper.startsWith("CREATE ") || upper.startsWith("ALTER ")) {
    return { rows: [] };
  }

  if (upper.startsWith("INSERT")) {
    const [id, userId, walletId, amount, hallId, submittedBy] = params as [
      string,
      string,
      string,
      number,
      string | null,
      string | null,
    ];
    const row: Row = {
      id,
      user_id: userId,
      wallet_id: walletId,
      amount_cents: amount,
      hall_id: hallId,
      submitted_by: submittedBy,
      status: "PENDING",
      rejection_reason: null,
      accepted_by: null,
      accepted_at: null,
      rejected_by: null,
      rejected_at: null,
      wallet_transaction_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const table = detectTable(sql);
    store[table].set(id, row);
    return { rows: [cloneRow(row)] };
  }

  if (upper.startsWith("SELECT")) {
    const table = detectTable(sql);
    const map = store[table];
    const requestId = params[0] as string;
    // `FOR UPDATE` and single-row lookup both use WHERE id = $1.
    if (sql.includes("WHERE id = $1")) {
      const row = map.get(requestId);
      return { rows: row ? [cloneRow(row)] : [] };
    }
    // listPending: WHERE status = $1 [AND hall_id = $2] ORDER BY created_at DESC LIMIT $N
    const status = params[0] as string;
    const hallIdFilter = sql.includes("hall_id = $2") ? (params[1] as string) : undefined;
    const all = Array.from(map.values())
      .filter((r) => r.status === status)
      .filter((r) => (hallIdFilter ? r.hall_id === hallIdFilter : true))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { rows: all.map(cloneRow) };
  }

  if (upper.startsWith("UPDATE")) {
    const table = detectTable(sql);
    const map = store[table];
    const requestId = params[0] as string;
    const row = map.get(requestId);
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

// ── Mock WalletAdapter ─────────────────────────────────────────────────────

function makeMockWallet(options: { failNextOp?: WalletError } = {}): {
  adapter: WalletAdapter;
  credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }>;
  debits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }>;
} {
  const credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }> = [];
  const debits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }> = [];
  let nextTxId = 1;
  const makeTx = (accountId: string, amount: number, type: "CREDIT" | "DEBIT"): WalletTransaction => ({
    id: `wtx-${nextTxId++}`,
    accountId,
    type,
    amount,
    reason: "",
    createdAt: new Date().toISOString(),
  });

  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("not implemented");
    },
    async ensureAccount() {
      return { id: "x", balance: 0, createdAt: "", updatedAt: "" };
    },
    async getAccount() {
      throw new Error("not implemented");
    },
    async listAccounts() {
      return [];
    },
    async getBalance() {
      return 0;
    },
    async debit(accountId, amount, reason, opts) {
      if (options.failNextOp) {
        const err = options.failNextOp;
        options.failNextOp = undefined;
        throw err;
      }
      debits.push({ accountId, amount, reason, idempotencyKey: opts?.idempotencyKey });
      return makeTx(accountId, amount, "DEBIT");
    },
    async credit(accountId, amount, reason, opts) {
      if (options.failNextOp) {
        const err = options.failNextOp;
        options.failNextOp = undefined;
        throw err;
      }
      credits.push({ accountId, amount, reason, idempotencyKey: opts?.idempotencyKey });
      return makeTx(accountId, amount, "CREDIT");
    },
    async topUp(accountId, amount) {
      return makeTx(accountId, amount, "CREDIT");
    },
    async withdraw(accountId, amount) {
      return makeTx(accountId, amount, "DEBIT");
    },
    async transfer() {
      throw new Error("not implemented");
    },
    async listTransactions() {
      return [];
    },
  };
  return { adapter, credits, debits };
}

function makeService(failWallet?: WalletError): {
  service: PaymentRequestService;
  store: TableStore;
  credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }>;
  debits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }>;
} {
  const { pool, store } = makeMockPool();
  const { adapter, credits, debits } = makeMockWallet({ failNextOp: failWallet });
  const service = PaymentRequestService.forTesting(adapter, pool);
  return { service, store, credits, debits };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("BIN-586: createDepositRequest persists a PENDING row", async () => {
  const { service, store } = makeService();
  const req = await service.createDepositRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 50000,
    hallId: "hall-1",
    submittedBy: "u-1",
  });
  assert.equal(req.kind, "deposit");
  assert.equal(req.status, "PENDING");
  assert.equal(req.amountCents, 50000);
  assert.equal(req.hallId, "hall-1");
  assert.equal(store.deposit.size, 1);
  assert.equal(store.withdraw.size, 0);
});

test("BIN-586: accept deposit credits wallet and sets ACCEPTED", async () => {
  const { service, credits, debits } = makeService();
  const req = await service.createDepositRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 12345,
  });
  const accepted = await service.acceptDeposit({
    requestId: req.id,
    acceptedBy: "admin-1",
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.acceptedBy, "admin-1");
  assert.ok(accepted.acceptedAt, "acceptedAt set");
  assert.equal(accepted.walletTransactionId, "wtx-1");
  assert.equal(credits.length, 1, "wallet credited exactly once");
  assert.equal(credits[0].accountId, "wallet-1");
  assert.equal(credits[0].amount, 123.45, "amount converted from cents to major");
  assert.equal(debits.length, 0, "no debit on deposit");
  assert.ok(credits[0].idempotencyKey?.includes(req.id), "idempotency key includes request id");
});

test("BIN-586: accept withdraw debits wallet and sets ACCEPTED", async () => {
  const { service, credits, debits } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 20000,
  });
  const accepted = await service.acceptWithdraw({
    requestId: req.id,
    acceptedBy: "admin-1",
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(debits.length, 1);
  assert.equal(debits[0].amount, 200);
  assert.equal(credits.length, 0);
});

test("BIN-586: reject deposit does NOT touch wallet and stores reason", async () => {
  const { service, credits, debits } = makeService();
  const req = await service.createDepositRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 50000,
  });
  const rejected = await service.rejectDeposit({
    requestId: req.id,
    rejectedBy: "admin-1",
    reason: "Bilag mangler",
  });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.rejectionReason, "Bilag mangler");
  assert.equal(rejected.rejectedBy, "admin-1");
  assert.equal(credits.length, 0, "no wallet credit on reject");
  assert.equal(debits.length, 0, "no wallet debit on reject");
});

test("BIN-586: reject withdraw does NOT touch wallet", async () => {
  const { service, credits, debits } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 20000,
  });
  await service.rejectWithdraw({
    requestId: req.id,
    rejectedBy: "admin-1",
    reason: "Mistanke om svindel",
  });
  assert.equal(credits.length, 0);
  assert.equal(debits.length, 0);
});

test("BIN-586: double-accept fails with PAYMENT_REQUEST_NOT_PENDING", async () => {
  const { service } = makeService();
  const req = await service.createDepositRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 10000,
  });
  await service.acceptDeposit({ requestId: req.id, acceptedBy: "admin-1" });
  await assert.rejects(
    () => service.acceptDeposit({ requestId: req.id, acceptedBy: "admin-1" }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "PAYMENT_REQUEST_NOT_PENDING"
  );
});

test("BIN-586: reject after accept fails — only pending requests can transition", async () => {
  const { service } = makeService();
  const req = await service.createWithdrawRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 10000,
  });
  await service.acceptWithdraw({ requestId: req.id, acceptedBy: "admin-1" });
  await assert.rejects(
    () =>
      service.rejectWithdraw({
        requestId: req.id,
        rejectedBy: "admin-1",
        reason: "too late",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "PAYMENT_REQUEST_NOT_PENDING"
  );
});

test("BIN-586: accept unknown id fails with PAYMENT_REQUEST_NOT_FOUND", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.acceptDeposit({ requestId: "00000000-0000-0000-0000-000000000000", acceptedBy: "admin-1" }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "PAYMENT_REQUEST_NOT_FOUND"
  );
});

test("BIN-586: wallet failure during accept does NOT mark row ACCEPTED", async () => {
  const walletErr = new WalletError("INSUFFICIENT_FUNDS", "Saldo for lav");
  const { service } = makeService(walletErr);
  const req = await service.createWithdrawRequest({
    userId: "u-1",
    walletId: "wallet-1",
    amountCents: 99999,
  });
  await assert.rejects(
    () => service.acceptWithdraw({ requestId: req.id, acceptedBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "INSUFFICIENT_FUNDS"
  );
  // Row skal fortsatt være PENDING etter wallet-failure.
  const fresh = await service.getRequest("withdraw", req.id);
  assert.equal(fresh.status, "PENDING");
});

test("BIN-586: listPending returns PENDING across both kinds, newest first", async () => {
  const { service } = makeService();
  const d1 = await service.createDepositRequest({
    userId: "u-1",
    walletId: "w-1",
    amountCents: 100,
  });
  await new Promise((r) => setTimeout(r, 5));
  const w1 = await service.createWithdrawRequest({
    userId: "u-1",
    walletId: "w-1",
    amountCents: 200,
  });
  const pending = await service.listPending();
  assert.equal(pending.length, 2);
  // Nyeste først — w1 ble opprettet etter d1.
  assert.equal(pending[0].id, w1.id);
  assert.equal(pending[1].id, d1.id);
});

test("BIN-586: listPending filters by kind=deposit", async () => {
  const { service } = makeService();
  await service.createDepositRequest({ userId: "u-1", walletId: "w-1", amountCents: 100 });
  await service.createWithdrawRequest({ userId: "u-1", walletId: "w-1", amountCents: 200 });
  const depositsOnly = await service.listPending({ kind: "deposit" });
  assert.equal(depositsOnly.length, 1);
  assert.equal(depositsOnly[0].kind, "deposit");
});

test("BIN-586: listPending filters by hallId", async () => {
  const { service } = makeService();
  await service.createDepositRequest({
    userId: "u-1",
    walletId: "w-1",
    amountCents: 100,
    hallId: "hall-A",
  });
  await service.createDepositRequest({
    userId: "u-2",
    walletId: "w-2",
    amountCents: 200,
    hallId: "hall-B",
  });
  const onlyA = await service.listPending({ hallId: "hall-A" });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].hallId, "hall-A");
});

test("BIN-586: createDepositRequest rejects non-positive amount", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.createDepositRequest({
        userId: "u-1",
        walletId: "w-1",
        amountCents: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () =>
      service.createDepositRequest({
        userId: "u-1",
        walletId: "w-1",
        amountCents: -100,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-586: reject requires a non-empty reason", async () => {
  const { service } = makeService();
  const req = await service.createDepositRequest({
    userId: "u-1",
    walletId: "w-1",
    amountCents: 100,
  });
  await assert.rejects(
    () =>
      service.rejectDeposit({
        requestId: req.id,
        rejectedBy: "admin-1",
        reason: "   ",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});
