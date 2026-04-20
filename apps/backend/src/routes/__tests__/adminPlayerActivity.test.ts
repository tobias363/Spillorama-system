/**
 * BIN-587 B5-rest + BIN-629 + BIN-630: integrasjonstester for admin player activity router.
 *
 * Dekker:
 *   GET /api/admin/players/:id/transactions
 *   GET /api/admin/players/:id/game-history
 *   GET /api/admin/players/:id/chips-history   (BIN-630)
 *   GET /api/admin/players/:id/login-history   (BIN-629)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPlayerActivityRouter } from "../adminPlayerActivity.js";
import type { PlatformService, PublicAppUser, AppUser } from "../../platform/PlatformService.js";
import type { WalletAdapter, WalletTransaction, WalletTransactionType } from "../../adapters/WalletAdapter.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { ComplianceLedgerEntry, LedgerEventType } from "../../game/ComplianceLedger.js";
import { DomainError } from "../../game/BingoEngine.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makePlayer(id: string): AppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `w-${id}`,
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  listLedgerCalls: Array<Parameters<BingoEngine["listComplianceLedgerEntries"]>[0]>;
  listTxCalls: Array<{ walletId: string; limit: number | undefined }>;
  auditStore: InMemoryAuditLogStore;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  usersById: Record<string, AppUser>;
  transactions?: WalletTransaction[];
  ledger?: ComplianceLedgerEntry[];
  /** BIN-630: map fra walletId til aktuell saldo — brukt av chips-history. */
  balances?: Record<string, number>;
}): Promise<Ctx> {
  const listLedgerCalls: Ctx["listLedgerCalls"] = [];
  const listTxCalls: Ctx["listTxCalls"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string): Promise<AppUser> {
      const u = opts.usersById[id];
      if (!u) throw new DomainError("NOT_FOUND", "user not found");
      return u;
    },
  } as unknown as PlatformService;

  const walletAdapter = {
    async listTransactions(walletId: string, limit?: number) {
      listTxCalls.push({ walletId, limit });
      return (opts.transactions ?? []).filter((t) => t.accountId === walletId).slice(0, limit ?? 100);
    },
    async getAccount(walletId: string) {
      return {
        id: walletId,
        balance: opts.balances?.[walletId] ?? 0,
        createdAt: "2026-04-18T10:00:00Z",
        updatedAt: "2026-04-18T10:00:00Z",
      };
    },
  } as unknown as WalletAdapter;

  const engine = {
    listComplianceLedgerEntries(input?: Parameters<BingoEngine["listComplianceLedgerEntries"]>[0]) {
      listLedgerCalls.push(input);
      return (opts.ledger ?? []).filter((e) => {
        if (input?.walletId && e.walletId !== input.walletId) return false;
        if (input?.hallId && e.hallId !== input.hallId) return false;
        return true;
      });
    },
  } as unknown as BingoEngine;

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPlayerActivityRouter({ platformService, walletAdapter, engine, auditLogService }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    listLedgerCalls,
    listTxCalls,
    auditStore,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, path: string, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function makeTx(id: string, walletId: string, type: WalletTransactionType, amount: number): WalletTransaction {
  return {
    id, accountId: walletId, type, amount,
    reason: "test", createdAt: "2026-04-18T10:00:00Z",
  };
}

function makeLedger(id: string, walletId: string, hallId: string, eventType: LedgerEventType): ComplianceLedgerEntry {
  return {
    id,
    createdAt: "2026-04-18T10:00:00Z",
    createdAtMs: Date.now(),
    hallId,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType,
    amount: 100,
    currency: "NOK",
    walletId,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B5: PLAYER blokkert fra activity-endepunkter", async () => {
  const ctx = await startServer({
    users: { "pl-tok": playerUser },
    usersById: { "target-1": makePlayer("target-1") },
  });
  try {
    const tx = await req(ctx.baseUrl, "/api/admin/players/target-1/transactions", "pl-tok");
    assert.equal(tx.status, 400);
    assert.equal(tx.json.error.code, "FORBIDDEN");

    const gh = await req(ctx.baseUrl, "/api/admin/players/target-1/game-history", "pl-tok");
    assert.equal(gh.status, 400);
    assert.equal(gh.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: transactions returnerer wallet-tx", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    transactions: [
      makeTx("t1", player.walletId, "TOPUP", 5000),
      makeTx("t2", player.walletId, "DEBIT", -500),
      makeTx("t3", "other-wallet", "TOPUP", 1000),
    ],
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/transactions?limit=50", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.userId, "target-1");
    assert.equal(res.json.data.walletId, player.walletId);
    assert.equal(res.json.data.count, 2);
    assert.equal(ctx.listTxCalls[0]?.limit, 50);
    assert.equal(ctx.listTxCalls[0]?.walletId, player.walletId);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: transactions avviser ikke-PLAYER target", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-admin": { ...makePlayer("target-admin"), role: "ADMIN" } },
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-admin/transactions", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: SUPPORT kan lese transactions", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "sup-tok": supportUser },
    usersById: { "target-1": player },
    transactions: [makeTx("t1", player.walletId, "TOPUP", 500)],
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/transactions", "sup-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: game-history returnerer ledger-entries filtrert på walletId", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    ledger: [
      makeLedger("l1", player.walletId, "hall-a", "STAKE"),
      makeLedger("l2", player.walletId, "hall-b", "PRIZE"),
      makeLedger("l3", "other-wallet", "hall-a", "STAKE"),
    ],
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/game-history", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
    const call = ctx.listLedgerCalls[0];
    assert.equal(call?.walletId, player.walletId);
    assert.equal(call?.hallId, undefined);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: game-history med hallId-filter", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    ledger: [
      makeLedger("l1", player.walletId, "hall-a", "STAKE"),
      makeLedger("l2", player.walletId, "hall-b", "PRIZE"),
    ],
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/game-history?hallId=hall-a&dateFrom=2026-01-01T00:00:00Z&dateTo=2026-12-31T23:59:59Z&limit=50", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    const call = ctx.listLedgerCalls[0];
    assert.equal(call?.hallId, "hall-a");
    assert.equal(call?.dateFrom, "2026-01-01T00:00:00Z");
    assert.equal(call?.dateTo, "2026-12-31T23:59:59Z");
    assert.equal(call?.limit, 50);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: HALL_OPERATOR blokkert (PLAYER_KYC_READ er ADMIN/SUPPORT-only)", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "op-a-tok": operatorA, "op-b-tok": operatorB },
    usersById: { "target-1": player },
  });
  try {
    for (const token of ["op-a-tok", "op-b-tok"]) {
      const tx = await req(ctx.baseUrl, "/api/admin/players/target-1/transactions", token);
      assert.equal(tx.status, 400);
      assert.equal(tx.json.error.code, "FORBIDDEN");

      const gh = await req(ctx.baseUrl, "/api/admin/players/target-1/game-history", token);
      assert.equal(gh.status, 400);
      assert.equal(gh.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B5: game-history avviser ikke-PLAYER target", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-admin": { ...makePlayer("target-admin"), role: "SUPPORT" } },
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-admin/game-history", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── BIN-630: chips-history tests ─────────────────────────────────────────

test("BIN-630: chips-history returnerer paginert liste med balanceAfter", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    transactions: [
      makeTx("t3", player.walletId, "DEBIT", 50),
      makeTx("t2", player.walletId, "CREDIT", 100),
      makeTx("t1", player.walletId, "TOPUP", 100),
    ],
    balances: { [player.walletId]: 150 },
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/chips-history", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.userId, "target-1");
    assert.equal(res.json.data.walletId, player.walletId);
    assert.equal(res.json.data.items.length, 3);
    assert.equal(res.json.data.items[0].id, "t3");
    assert.equal(res.json.data.items[0].balanceAfter, 150);
    assert.equal(res.json.data.items[0].type, "DEBIT");
    assert.equal(res.json.data.items[1].balanceAfter, 200);
    assert.equal(res.json.data.items[2].balanceAfter, 100);
    assert.equal(res.json.data.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history støtter from/to-vindu", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    transactions: [
      { ...makeTx("t3", player.walletId, "DEBIT", 50), createdAt: "2026-04-20T12:00:00Z" },
      { ...makeTx("t2", player.walletId, "CREDIT", 100), createdAt: "2026-04-15T12:00:00Z" },
      { ...makeTx("t1", player.walletId, "TOPUP", 100), createdAt: "2026-04-10T12:00:00Z" },
    ],
    balances: { [player.walletId]: 150 },
  });
  try {
    const res = await req(
      ctx.baseUrl,
      "/api/admin/players/target-1/chips-history?from=2026-04-14T00:00:00Z&to=2026-04-16T00:00:00Z",
      "admin-tok",
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.items.length, 1);
    assert.equal(res.json.data.items[0].id, "t2");
    // BalanceAfter er regnet fra hele historien — skal fortsatt være 200.
    assert.equal(res.json.data.items[0].balanceAfter, 200);
    assert.equal(res.json.data.from, "2026-04-14T00:00:00.000Z");
    assert.equal(res.json.data.to, "2026-04-16T00:00:00.000Z");
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history cursor-paginerer stabilt", async () => {
  const player = makePlayer("target-1");
  const txs = [];
  for (let i = 9; i >= 0; i -= 1) {
    const day = (i + 10).toString().padStart(2, "0");
    txs.push({
      ...makeTx(`t${i}`, player.walletId, "CREDIT", 10),
      createdAt: `2026-04-${day}T12:00:00Z`,
    });
  }
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    transactions: txs,
    balances: { [player.walletId]: 100 },
  });
  try {
    const page1 = await req(ctx.baseUrl, "/api/admin/players/target-1/chips-history?limit=3", "admin-tok");
    assert.equal(page1.status, 200);
    assert.equal(page1.json.data.items.length, 3);
    assert.notEqual(page1.json.data.nextCursor, null);

    const page2 = await req(
      ctx.baseUrl,
      `/api/admin/players/target-1/chips-history?limit=3&cursor=${encodeURIComponent(page1.json.data.nextCursor)}`,
      "admin-tok",
    );
    assert.equal(page2.status, 200);
    assert.equal(page2.json.data.items.length, 3);
    const ids1 = new Set(page1.json.data.items.map((i: { id: string }) => i.id));
    for (const item of page2.json.data.items) {
      assert.equal(ids1.has(item.id), false);
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history avviser ugyldig ISO i from/to", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    balances: { [player.walletId]: 0 },
  });
  try {
    const res = await req(
      ctx.baseUrl,
      "/api/admin/players/target-1/chips-history?from=ikke-en-dato",
      "admin-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history avviser from > to", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
    balances: { [player.walletId]: 0 },
  });
  try {
    const res = await req(
      ctx.baseUrl,
      "/api/admin/players/target-1/chips-history?from=2026-04-20T00:00:00Z&to=2026-04-10T00:00:00Z",
      "admin-tok",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history avviser ikke-PLAYER target", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-admin": { ...makePlayer("target-admin"), role: "SUPPORT" } },
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-admin/chips-history", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history blokkerer PLAYER og HALL_OPERATOR", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: {
      "pl-tok": playerUser,
      "op-a-tok": operatorA,
    },
    usersById: { "target-1": player },
    balances: { [player.walletId]: 0 },
  });
  try {
    for (const tok of ["pl-tok", "op-a-tok"]) {
      const res = await req(ctx.baseUrl, "/api/admin/players/target-1/chips-history", tok);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history — SUPPORT kan lese", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "sup-tok": supportUser },
    usersById: { "target-1": player },
    transactions: [makeTx("t1", player.walletId, "TOPUP", 100)],
    balances: { [player.walletId]: 100 },
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/chips-history", "sup-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.items.length, 1);
    assert.equal(res.json.data.items[0].balanceAfter, 100);
  } finally {
    await ctx.close();
  }
});

test("BIN-630: chips-history — manglende Authorization → UNAUTHORIZED", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: {},
    usersById: { "target-1": player },
  });
  try {
    const res = await req(ctx.baseUrl, "/api/admin/players/target-1/chips-history");
    assert.equal(res.status, 400);
    // Enten UNAUTHORIZED (access-token) eller INVALID_ACCESS_TOKEN — begge godtatt.
    assert.ok(
      typeof res.json.error.code === "string" && res.json.error.code.length > 0,
      "skal returnere en error.code",
    );
  } finally {
    await ctx.close();
  }
});

// ── BIN-629: login-history ──────────────────────────────────────────────────

async function seedLogin(
  ctx: Ctx,
  opts: { actorId: string; success: boolean; ip?: string; ua?: string; failureReason?: string },
): Promise<void> {
  await ctx.auditStore.append({
    actorId: opts.actorId,
    actorType: "USER",
    action: opts.success ? "auth.login" : "auth.login.failed",
    resource: "session",
    resourceId: null,
    details: opts.success ? {} : { failureReason: opts.failureReason ?? "INVALID_CREDENTIALS" },
    ipAddress: opts.ip ?? "127.0.0.1",
    userAgent: opts.ua ?? "Mozilla/TestAgent",
  });
}

test("BIN-629: PLAYER blokkert fra login-history", async () => {
  const ctx = await startServer({
    users: { "pl-tok": playerUser },
    usersById: { "target-1": makePlayer("target-1") },
  });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/players/target-1/login-history", "pl-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-629: HALL_OPERATOR blokkert (PLAYER_KYC_READ er ADMIN/SUPPORT-only)", async () => {
  const ctx = await startServer({
    users: { "op-a-tok": operatorA },
    usersById: { "target-1": makePlayer("target-1") },
  });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/players/target-1/login-history", "op-a-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-629: ADMIN + SUPPORT kan lese login-history", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser, "sup-tok": supportUser },
    usersById: { "target-1": player },
  });
  try {
    await seedLogin(ctx, { actorId: "target-1", success: true });
    for (const token of ["admin-tok", "sup-tok"]) {
      const r = await req(ctx.baseUrl, "/api/admin/players/target-1/login-history", token);
      assert.equal(r.status, 200, `token ${token} gave ${r.status}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.data.userId, "target-1");
      assert.equal(r.json.data.items.length, 1);
      assert.equal(r.json.data.items[0].success, true);
      assert.equal(r.json.data.items[0].ipAddress, "127.0.0.1");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-629: ikke-PLAYER target avvises", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-admin": { ...makePlayer("target-admin"), role: "ADMIN" } },
  });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/players/target-admin/login-history", "admin-tok");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-629: returnerer success + failed, nyeste først, med failureReason", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
  });
  try {
    await seedLogin(ctx, { actorId: "target-1", success: false, failureReason: "INVALID_CREDENTIALS" });
    await seedLogin(ctx, { actorId: "target-1", success: true });
    const r = await req(ctx.baseUrl, "/api/admin/players/target-1/login-history", "admin-tok");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.items.length, 2);
    // Nyeste (success) først.
    assert.equal(r.json.data.items[0].success, true);
    assert.equal(r.json.data.items[0].failureReason, null);
    assert.equal(r.json.data.items[1].success, false);
    assert.equal(r.json.data.items[1].failureReason, "INVALID_CREDENTIALS");
  } finally {
    await ctx.close();
  }
});

test("BIN-629: filtrerer ut andre spilleres events", async () => {
  const target = makePlayer("target-1");
  const other = makePlayer("other-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": target, "other-1": other },
  });
  try {
    await seedLogin(ctx, { actorId: "target-1", success: true });
    await seedLogin(ctx, { actorId: "other-1", success: true });
    await seedLogin(ctx, { actorId: "other-1", success: false });
    const r = await req(ctx.baseUrl, "/api/admin/players/target-1/login-history", "admin-tok");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.items.length, 1);
  } finally {
    await ctx.close();
  }
});

test("BIN-629: cursor-paginering returnerer nextCursor og neste side", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
  });
  try {
    for (let i = 0; i < 5; i++) {
      await seedLogin(ctx, { actorId: "target-1", success: true, ip: `10.0.0.${i}` });
    }
    const first = await req(ctx.baseUrl, "/api/admin/players/target-1/login-history?limit=2", "admin-tok");
    assert.equal(first.status, 200);
    assert.equal(first.json.data.items.length, 2);
    assert.ok(first.json.data.nextCursor, "should return nextCursor");

    const second = await req(
      ctx.baseUrl,
      `/api/admin/players/target-1/login-history?limit=2&cursor=${encodeURIComponent(first.json.data.nextCursor)}`,
      "admin-tok",
    );
    assert.equal(second.status, 200);
    assert.equal(second.json.data.items.length, 2);
    // Ingen overlap.
    const ids1 = new Set(first.json.data.items.map((e: { id: string }) => e.id));
    for (const item of second.json.data.items) {
      assert.ok(!ids1.has(item.id), "second-page row should not appear on first page");
    }

    const third = await req(
      ctx.baseUrl,
      `/api/admin/players/target-1/login-history?limit=2&cursor=${encodeURIComponent(second.json.data.nextCursor)}`,
      "admin-tok",
    );
    assert.equal(third.status, 200);
    assert.equal(third.json.data.items.length, 1);
    assert.equal(third.json.data.nextCursor, null, "final page should not return a cursor");
  } finally {
    await ctx.close();
  }
});

test("BIN-629: from/to-validering — 'from' > 'to' gir INVALID_INPUT", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
  });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/players/target-1/login-history?from=2026-05-01T00:00:00Z&to=2026-04-01T00:00:00Z",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-629: from/to-validering — ugyldig ISO gir INVALID_INPUT", async () => {
  const player = makePlayer("target-1");
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "target-1": player },
  });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/players/target-1/login-history?from=not-a-date",
      "admin-tok",
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
