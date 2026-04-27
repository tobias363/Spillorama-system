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
    // BIN-646: withdraw har 7 params (+destinationType), deposit har 6.
    const [id, userId, walletId, amount, hallId, submittedBy, destinationType] = params as [
      string,
      string,
      string,
      number,
      string | null,
      string | null,
      ("bank" | "hall" | null) | undefined,
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
      destination_type: destinationType ?? null,
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
    // `FOR UPDATE` and single-row lookup both use WHERE id = $1.
    if (sql.includes("WHERE id = $1")) {
      const requestId = params[0] as string;
      const row = map.get(requestId);
      return { rows: row ? [cloneRow(row)] : [] };
    }
    // BIN-646 (PR-B4): listPending bruker nå `status = ANY($1::text[])` med
    // statuser-array, og dynamiske filtre på hall_id / destination_type / user_id.
    // GAP #10/#12: listHistory gjenbruker samme query-builder, men med
    // tillegg for created_at/user_id/min_amount/cursor (created_at, id)
    // og DESC LIMIT — så mock-en må kjenne disse mønstrene.
    const statusArr = params[0] as string[] | string;
    const statuses = Array.isArray(statusArr) ? statusArr : [statusArr];
    const hallMatch = sql.match(/hall_id = \$(\d+)/);
    const hallIdFilter = hallMatch ? (params[Number(hallMatch[1]) - 1] as string) : undefined;
    const destMatch = sql.match(/destination_type = \$(\d+)/);
    const destFilter = destMatch ? (params[Number(destMatch[1]) - 1] as string) : undefined;
    const userMatch = sql.match(/user_id = \$(\d+)/);
    const userFilter = userMatch ? (params[Number(userMatch[1]) - 1] as string) : undefined;
    const fromMatch = sql.match(/created_at >= \$(\d+)::timestamptz/);
    const fromFilter = fromMatch
      ? new Date(params[Number(fromMatch[1]) - 1] as string)
      : undefined;
    const toMatch = sql.match(/created_at <= \$(\d+)::timestamptz/);
    const toFilter = toMatch
      ? new Date(params[Number(toMatch[1]) - 1] as string)
      : undefined;
    const amountMatch = sql.match(/amount_cents >= \$(\d+)/);
    const amountFilter = amountMatch
      ? (params[Number(amountMatch[1]) - 1] as number)
      : undefined;
    // Cursor: `(created_at, id) < ($N::timestamptz, $M)`.
    const cursorMatch = sql.match(/\(created_at, id\) < \(\$(\d+)::timestamptz, \$(\d+)\)/);
    const cursorAt = cursorMatch
      ? new Date(params[Number(cursorMatch[1]) - 1] as string)
      : undefined;
    const cursorId = cursorMatch ? (params[Number(cursorMatch[2]) - 1] as string) : undefined;
    // LIMIT er alltid siste param.
    const limitMatch = sql.match(/LIMIT \$(\d+)/);
    const limitVal = limitMatch ? (params[Number(limitMatch[1]) - 1] as number) : undefined;
    const all = Array.from(map.values())
      .filter((r) => statuses.includes(r.status))
      .filter((r) => (hallIdFilter ? r.hall_id === hallIdFilter : true))
      .filter((r) => (destFilter ? r.destination_type === destFilter : true))
      .filter((r) => (userFilter ? r.user_id === userFilter : true))
      .filter((r) => (fromFilter ? r.created_at.getTime() >= fromFilter.getTime() : true))
      .filter((r) => (toFilter ? r.created_at.getTime() <= toFilter.getTime() : true))
      .filter((r) => (amountFilter ? r.amount_cents >= amountFilter : true))
      .filter((r) => {
        if (!cursorAt || !cursorId) return true;
        const cmpTime = r.created_at.getTime() - cursorAt.getTime();
        if (cmpTime < 0) return true;
        if (cmpTime > 0) return false;
        return r.id < cursorId;
      })
      .sort((a, b) => {
        const t = b.created_at.getTime() - a.created_at.getTime();
        if (t !== 0) return t;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });
    const limited = limitVal !== undefined ? all.slice(0, limitVal) : all;
    return { rows: limited.map(cloneRow) };
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
      return { id: "x", balance: 0, depositBalance: 0, winningsBalance: 0, createdAt: "", updatedAt: "" };
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
    async getDepositBalance() {
      return 0;
    },
    async getWinningsBalance() {
      return 0;
    },
    async getBothBalances() {
      return { deposit: 0, winnings: 0, total: 0 };
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

// ── GAP #10 / #12: listHistory ──────────────────────────────────────────────

/** Helper: opprett N deposit/withdraw-requests med ulike tidsstempler. */
async function seedHistory(
  service: PaymentRequestService,
  spec: Array<{
    kind: "deposit" | "withdraw";
    userId: string;
    hallId?: string;
    amountCents?: number;
    destinationType?: "bank" | "hall";
  }>
): Promise<Awaited<ReturnType<PaymentRequestService["createDepositRequest"]>>[]> {
  const out: Awaited<ReturnType<PaymentRequestService["createDepositRequest"]>>[] = [];
  for (const s of spec) {
    // Sleep 2ms slik at created_at er strict-monotont stigende.
    await new Promise((r) => setTimeout(r, 2));
    if (s.kind === "deposit") {
      out.push(
        await service.createDepositRequest({
          userId: s.userId,
          walletId: `w-${s.userId}`,
          amountCents: s.amountCents ?? 1000,
          hallId: s.hallId,
        })
      );
    } else {
      out.push(
        await service.createWithdrawRequest({
          userId: s.userId,
          walletId: `w-${s.userId}`,
          amountCents: s.amountCents ?? 1000,
          hallId: s.hallId,
          destinationType: s.destinationType,
        })
      );
    }
  }
  return out;
}

test("GAP #10: listHistory default returns ALL statuses (PENDING+ACCEPTED+REJECTED), newest first", async () => {
  const { service } = makeService();
  const seeded = await seedHistory(service, [
    { kind: "deposit", userId: "u-1" },
    { kind: "deposit", userId: "u-2" },
    { kind: "deposit", userId: "u-3" },
  ]);
  // Accept en, reject en, la den siste være PENDING.
  await service.acceptDeposit({ requestId: seeded[0]!.id, acceptedBy: "admin" });
  await service.rejectDeposit({
    requestId: seeded[1]!.id,
    rejectedBy: "admin",
    reason: "test",
  });
  const { items, nextCursor } = await service.listHistory({ kind: "deposit" });
  assert.equal(items.length, 3);
  // Default-statuser er alle tre — sjekk at vi ser én av hver.
  const statuses = items.map((i) => i.status).sort();
  assert.deepEqual(statuses, ["ACCEPTED", "PENDING", "REJECTED"]);
  // Nyeste først (seeded[2] var sist).
  assert.equal(items[0]!.id, seeded[2]!.id);
  assert.equal(nextCursor, null);
});

test("GAP #10: listHistory filtrerer på hallId", async () => {
  const { service } = makeService();
  await seedHistory(service, [
    { kind: "deposit", userId: "u-1", hallId: "hall-A" },
    { kind: "deposit", userId: "u-2", hallId: "hall-B" },
    { kind: "deposit", userId: "u-3", hallId: "hall-A" },
  ]);
  const { items } = await service.listHistory({
    kind: "deposit",
    hallId: "hall-A",
  });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.hallId, "hall-A");
  }
});

test("GAP #10: listHistory filtrerer på userId (playerId)", async () => {
  const { service } = makeService();
  await seedHistory(service, [
    { kind: "deposit", userId: "u-target" },
    { kind: "deposit", userId: "u-other" },
    { kind: "deposit", userId: "u-target" },
  ]);
  const { items } = await service.listHistory({
    kind: "deposit",
    userId: "u-target",
  });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.userId, "u-target");
  }
});

test("GAP #10: listHistory filtrerer på createdFrom + createdTo", async () => {
  const { service } = makeService();
  const seeded = await seedHistory(service, [
    { kind: "deposit", userId: "u-1" },
    { kind: "deposit", userId: "u-2" },
    { kind: "deposit", userId: "u-3" },
  ]);
  // Filter til kun den midterste.
  const middleCreatedAt = seeded[1]!.createdAt;
  const { items } = await service.listHistory({
    kind: "deposit",
    createdFrom: middleCreatedAt,
    createdTo: middleCreatedAt,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, seeded[1]!.id);
});

test("GAP #10: listHistory filtrerer på spesifikke statuser", async () => {
  const { service } = makeService();
  const seeded = await seedHistory(service, [
    { kind: "deposit", userId: "u-1" },
    { kind: "deposit", userId: "u-2" },
    { kind: "deposit", userId: "u-3" },
  ]);
  await service.acceptDeposit({ requestId: seeded[0]!.id, acceptedBy: "admin" });
  await service.rejectDeposit({
    requestId: seeded[1]!.id,
    rejectedBy: "admin",
    reason: "test",
  });
  const { items } = await service.listHistory({
    kind: "deposit",
    statuses: ["ACCEPTED"],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.status, "ACCEPTED");
});

test("GAP #12: listHistory withdraw filtrerer på destinationType=bank", async () => {
  const { service } = makeService();
  await seedHistory(service, [
    { kind: "withdraw", userId: "u-1", destinationType: "bank" },
    { kind: "withdraw", userId: "u-2", destinationType: "hall" },
    { kind: "withdraw", userId: "u-3", destinationType: "bank" },
  ]);
  const { items } = await service.listHistory({
    kind: "withdraw",
    destinationType: "bank",
  });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.destinationType, "bank");
  }
});

test("GAP #12: listHistory withdraw filtrerer på destinationType=hall", async () => {
  const { service } = makeService();
  await seedHistory(service, [
    { kind: "withdraw", userId: "u-1", destinationType: "bank" },
    { kind: "withdraw", userId: "u-2", destinationType: "hall" },
    { kind: "withdraw", userId: "u-3", destinationType: "hall" },
  ]);
  const { items } = await service.listHistory({
    kind: "withdraw",
    destinationType: "hall",
  });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.destinationType, "hall");
  }
});

test("GAP #10/#12: listHistory cursor-pagination returnerer alle rader uten duplikater", async () => {
  const { service } = makeService();
  await seedHistory(
    service,
    Array.from({ length: 7 }, (_, i) => ({
      kind: "deposit" as const,
      userId: `u-${i}`,
    }))
  );
  // Side 1: limit=3 → 3 items + nextCursor.
  const page1 = await service.listHistory({ kind: "deposit", limit: 3 });
  assert.equal(page1.items.length, 3);
  assert.ok(page1.nextCursor, "nextCursor må finnes når det er flere rader");
  // Side 2: bruk cursor fra side 1.
  const page2 = await service.listHistory({
    kind: "deposit",
    limit: 3,
    cursor: page1.nextCursor!,
  });
  assert.equal(page2.items.length, 3);
  assert.ok(page2.nextCursor, "nextCursor må finnes — det er fortsatt 1 rad igjen");
  // Side 3: skal returnere siste rad og nextCursor=null.
  const page3 = await service.listHistory({
    kind: "deposit",
    limit: 3,
    cursor: page2.nextCursor!,
  });
  assert.equal(page3.items.length, 1);
  assert.equal(page3.nextCursor, null);
  // Verifiser at alle id-er er unike på tvers av sider.
  const allIds = new Set([...page1.items, ...page2.items, ...page3.items].map((i) => i.id));
  assert.equal(allIds.size, 7, "ingen duplikater på tvers av sider");
});

test("GAP #10/#12: listHistory cursor er stabil mot insert mellom sider", async () => {
  const { service } = makeService();
  // Seed 4 rader.
  await seedHistory(service, [
    { kind: "deposit", userId: "u-1" },
    { kind: "deposit", userId: "u-2" },
    { kind: "deposit", userId: "u-3" },
    { kind: "deposit", userId: "u-4" },
  ]);
  const page1 = await service.listHistory({ kind: "deposit", limit: 2 });
  assert.equal(page1.items.length, 2);
  // Seed 1 ny etter å ha hentet side 1 — simulerer en samtidig INSERT.
  await new Promise((r) => setTimeout(r, 5));
  await service.createDepositRequest({
    userId: "u-new",
    walletId: "w-new",
    amountCents: 999,
  });
  const page2 = await service.listHistory({
    kind: "deposit",
    limit: 2,
    cursor: page1.nextCursor!,
  });
  // Cursor sikrer at vi får de gjenværende «opprinnelige» radene, ikke
  // den nye som dukket opp før dem i sortering. Page 2 inneholder altså
  // de eldste 2 av de 4 opprinnelige radene.
  const page2Ids = page2.items.map((i) => i.userId);
  assert.deepEqual(page2Ids.sort(), ["u-1", "u-2"]);
});

test("GAP #10/#12: listHistory ugyldig cursor → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.listHistory({ kind: "deposit", cursor: "definitely-not-base64-url-pipe" }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  // Cursor uten pipe-separator.
  await assert.rejects(
    () =>
      service.listHistory({
        kind: "deposit",
        cursor: Buffer.from("noseparator").toString("base64url"),
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  // Cursor med ugyldig timestamp.
  await assert.rejects(
    () =>
      service.listHistory({
        kind: "deposit",
        cursor: Buffer.from("not-a-date|some-id").toString("base64url"),
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("GAP #10/#12: listHistory tom-resultat → nextCursor=null", async () => {
  const { service } = makeService();
  const { items, nextCursor } = await service.listHistory({ kind: "deposit" });
  assert.equal(items.length, 0);
  assert.equal(nextCursor, null);
});

test("GAP #10/#12: listHistory minAmountCents filter", async () => {
  const { service } = makeService();
  await seedHistory(service, [
    { kind: "deposit", userId: "u-1", amountCents: 100 },
    { kind: "deposit", userId: "u-2", amountCents: 5000 },
    { kind: "deposit", userId: "u-3", amountCents: 10000 },
  ]);
  const { items } = await service.listHistory({
    kind: "deposit",
    minAmountCents: 5000,
  });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.ok(item.amountCents >= 5000);
  }
});

test("GAP #10/#12: listHistory limit clamp — 0 → 1, 1000 → 500", async () => {
  const { service } = makeService();
  // Seed 6 rader.
  await seedHistory(service, [
    { kind: "deposit", userId: "u-1" },
    { kind: "deposit", userId: "u-2" },
    { kind: "deposit", userId: "u-3" },
    { kind: "deposit", userId: "u-4" },
    { kind: "deposit", userId: "u-5" },
    { kind: "deposit", userId: "u-6" },
  ]);
  // limit=0 clampes opp til 1.
  const small = await service.listHistory({ kind: "deposit", limit: 0 });
  assert.equal(small.items.length, 1);
  // limit=1000 clampes ned til 500 (men vi har bare 6 rader, så vi får 6).
  const large = await service.listHistory({ kind: "deposit", limit: 1000 });
  assert.equal(large.items.length, 6);
});

test("GAP #10/#12: listHistory uten kind blander deposit + withdraw, sortert nyeste først", async () => {
  const { service } = makeService();
  await seedHistory(service, [
    { kind: "deposit", userId: "u-1" },
    { kind: "withdraw", userId: "u-1", destinationType: "bank" },
    { kind: "deposit", userId: "u-2" },
  ]);
  const { items } = await service.listHistory({});
  assert.equal(items.length, 3);
  // De skal være sortert nyeste først, så index 0 = u-2 deposit (sist seeded).
  assert.equal(items[0]!.userId, "u-2");
  // Bekreft at både kind=deposit og kind=withdraw er representert.
  const kinds = new Set(items.map((i) => i.kind));
  assert.ok(kinds.has("deposit"));
  assert.ok(kinds.has("withdraw"));
});
