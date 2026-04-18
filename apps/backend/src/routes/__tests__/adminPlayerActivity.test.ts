/**
 * BIN-587 B5-rest: integrasjonstester for admin player activity router.
 *
 * Dekker:
 *   GET /api/admin/players/:id/transactions
 *   GET /api/admin/players/:id/game-history
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
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  usersById: Record<string, AppUser>;
  transactions?: WalletTransaction[];
  ledger?: ComplianceLedgerEntry[];
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

  const app = express();
  app.use(express.json());
  app.use(createAdminPlayerActivityRouter({ platformService, walletAdapter, engine }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    listLedgerCalls,
    listTxCalls,
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
