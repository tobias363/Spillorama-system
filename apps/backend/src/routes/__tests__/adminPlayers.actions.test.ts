/**
 * REQ-097/98 + NEW-004 (wireframe PDF 17 §17.20-§17.21): admin/agent player-
 * row action-menu — block, unblock, add-balance.
 *
 * Tester:
 *   - block: krever PLAYER_LIFECYCLE_WRITE, kaller engine.setSelfExclusion,
 *     audit-logger handlingen.
 *   - unblock: krever PLAYER_LIFECYCLE_WRITE, kaller engine.clearSelfExclusion,
 *     audit-logger.
 *   - add-balance: krever PLAYER_LIFECYCLE_WRITE, går gjennom walletAdapter.credit
 *     med to=deposit, og fail-closed mot to=winnings (ADMIN_WINNINGS_CREDIT_FORBIDDEN).
 *   - non-admin (PLAYER) → 400 FORBIDDEN.
 *   - audit-rader inneholder korrekt actor + target + reason.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPlayersRouter } from "../adminPlayers.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import { DomainError } from "../../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type {
  WalletAdapter,
  WalletTransaction,
  WalletAccountSide,
} from "../../adapters/WalletAdapter.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { EmailService } from "../../integration/EmailService.js";

function makeUser(role: PublicAppUser["role"], id = "u-1"): PublicAppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `w-${id}`,
    role,
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  } as PublicAppUser;
}

interface EngineMock {
  setSelfExclusionCalls: string[];
  clearSelfExclusionCalls: string[];
  setSelfExclusion: (walletId: string) => Promise<unknown>;
  clearSelfExclusion: (walletId: string) => Promise<unknown>;
}

function makeEngineMock(): EngineMock {
  const setCalls: string[] = [];
  const clearCalls: string[] = [];
  return {
    setSelfExclusionCalls: setCalls,
    clearSelfExclusionCalls: clearCalls,
    async setSelfExclusion(walletId: string) {
      setCalls.push(walletId);
      return { walletId, restrictions: { selfExclusion: { isActive: true } } };
    },
    async clearSelfExclusion(walletId: string) {
      clearCalls.push(walletId);
      return { walletId, restrictions: { selfExclusion: { isActive: false } } };
    },
  };
}

interface CreditCall {
  walletId: string;
  amount: number;
  reason: string;
  to: WalletAccountSide;
  idempotencyKey?: string;
}

interface WalletMock {
  creditCalls: CreditCall[];
  credit: WalletAdapter["credit"];
}

function makeWalletMock(): WalletMock {
  const calls: CreditCall[] = [];
  return {
    creditCalls: calls,
    async credit(walletId, amount, reason, opts) {
      calls.push({
        walletId,
        amount,
        reason,
        to: opts?.to ?? "deposit",
        idempotencyKey: opts?.idempotencyKey,
      });
      const tx: WalletTransaction = {
        id: `tx-${calls.length}`,
        accountId: walletId,
        type: "TOPUP",
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
      return tx;
    },
  } as WalletMock;
}

interface Ctx {
  baseUrl: string;
  engine: EngineMock;
  wallet: WalletMock;
  audit: AuditLogService;
  auditStore: InMemoryAuditLogStore;
  close: () => Promise<void>;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  // userId → mock-player-record.
  players?: Record<string, PublicAppUser>;
}): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const engine = makeEngineMock();
  const wallet = makeWalletMock();

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string) {
      const p = opts.players?.[id];
      if (!p) throw new DomainError("USER_NOT_FOUND", "ukjent bruker");
      return p;
    },
  } as unknown as PlatformService;

  const emailServiceStub = {
    async sendTemplate() {
      // no-op
    },
  } as unknown as EmailService;

  const router = createAdminPlayersRouter({
    platformService,
    auditLogService: audit,
    emailService: emailServiceStub,
    bankIdAdapter: null,
    webBaseUrl: "http://localhost",
    supportEmail: "support@test.no",
    engine: engine as unknown as BingoEngine,
    walletAdapter: wallet as unknown as WalletAdapter,
  });

  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    engine,
    wallet,
    audit,
    auditStore,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

async function postJson(
  url: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: { code: string } } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json as never };
}

// ── Block tests ──────────────────────────────────────────────────────────────

test("REQ-097: ADMIN block setter self-exclusion + audit-logger", async () => {
  const adminUser = makeUser("ADMIN", "admin-1");
  const targetPlayer = makeUser("PLAYER", "target-1");
  const ctx = await startServer({
    users: { "tok-admin": adminUser },
    players: { "target-1": targetPlayer },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/block`,
      "tok-admin",
      { reason: "Bekymret bruker", durationDays: 365 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const data = res.body.data as { blocked: boolean };
    assert.equal(data.blocked, true);
    assert.deepEqual(ctx.engine.setSelfExclusionCalls, [targetPlayer.walletId]);

    // Audit-spor.
    const events = await ctx.audit.list({ resource: "user", resourceId: "target-1" });
    const blockEvent = events.find((e) => e.action === "admin.player.block");
    assert.ok(blockEvent, "block-event er logget");
    assert.equal(blockEvent.actorId, "admin-1");
    assert.equal((blockEvent.details as { reason: string }).reason, "Bekymret bruker");
    assert.equal((blockEvent.details as { durationDays: number }).durationDays, 365);
  } finally {
    await ctx.close();
  }
});

test("REQ-097: PLAYER kan ikke kalle block (FORBIDDEN)", async () => {
  const ctx = await startServer({
    users: { "tok-player": makeUser("PLAYER", "u-2") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/block`,
      "tok-player",
      { reason: "tester" }
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("REQ-097: kort reason → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/block`,
      "tok-admin",
      { reason: "kort" }
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("REQ-097: ugyldig durationDays → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/block`,
      "tok-admin",
      { reason: "Bekymret bruker", durationDays: -10 }
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── Unblock tests ────────────────────────────────────────────────────────────

test("REQ-098: ADMIN unblock kaller clearSelfExclusion + audit-logger", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/unblock`,
      "tok-admin",
      { reason: "Spilleren har dokumentert behandling" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(ctx.engine.clearSelfExclusionCalls, ["w-target-1"]);

    const events = await ctx.audit.list({ resource: "user", resourceId: "target-1" });
    const unblockEvent = events.find((e) => e.action === "admin.player.unblock");
    assert.ok(unblockEvent, "unblock-event er logget");
    assert.equal(unblockEvent.actorId, "admin-1");
  } finally {
    await ctx.close();
  }
});

// ── Add-balance tests ────────────────────────────────────────────────────────

test("NEW-004: ADMIN add-balance → walletAdapter.credit kalt med to=deposit", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/add-balance`,
      "tok-admin",
      { amount: 200, paymentType: "cash", reason: "Hall-cash-deposit nr 12345" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(ctx.wallet.creditCalls.length, 1);
    assert.equal(ctx.wallet.creditCalls[0]!.walletId, "w-target-1");
    assert.equal(ctx.wallet.creditCalls[0]!.amount, 200);
    assert.equal(ctx.wallet.creditCalls[0]!.to, "deposit");

    // Audit
    const events = await ctx.audit.list({ resource: "user", resourceId: "target-1" });
    const addEvent = events.find((e) => e.action === "admin.player.add_balance");
    assert.ok(addEvent, "add-balance-event er logget");
    assert.equal((addEvent.details as { paymentType: string }).paymentType, "cash");
    assert.equal((addEvent.details as { amount: number }).amount, 200);
    assert.equal((addEvent.details as { to: string }).to, "deposit");
  } finally {
    await ctx.close();
  }
});

test("NEW-004 fail-closed: to=winnings → 403 ADMIN_WINNINGS_CREDIT_FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/add-balance`,
      "tok-admin",
      {
        amount: 200,
        paymentType: "cash",
        reason: "Manuell bonus utdeling",
        to: "winnings",
      }
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "ADMIN_WINNINGS_CREDIT_FORBIDDEN");
    // Wallet aldri kreditert.
    assert.equal(ctx.wallet.creditCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("NEW-004: ugyldig amount → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/add-balance`,
      "tok-admin",
      { amount: -50, paymentType: "cash", reason: "Hall-cash-deposit nr 12345" }
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
    assert.equal(ctx.wallet.creditCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("NEW-004: PLAYER kan ikke kalle add-balance (FORBIDDEN)", async () => {
  const ctx = await startServer({
    users: { "tok-player": makeUser("PLAYER", "u-2") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/add-balance`,
      "tok-player",
      { amount: 100, paymentType: "cash", reason: "Ikke autorisert" }
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "FORBIDDEN");
    assert.equal(ctx.wallet.creditCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("NEW-004: ukjent player → USER_NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: {},
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/missing/add-balance`,
      "tok-admin",
      { amount: 100, paymentType: "cash", reason: "Hall-cash-deposit nr 12345" }
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "USER_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("NEW-004: idempotencyKey videresendes til walletAdapter", async () => {
  const ctx = await startServer({
    users: { "tok-admin": makeUser("ADMIN", "admin-1") },
    players: { "target-1": makeUser("PLAYER", "target-1") },
  });
  try {
    const res = await postJson(
      `${ctx.baseUrl}/api/admin/players/target-1/add-balance`,
      "tok-admin",
      {
        amount: 100,
        paymentType: "cash",
        reason: "Hall-cash-deposit nr 12345",
        idempotencyKey: "idem-1",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.wallet.creditCalls[0]!.idempotencyKey, "idem-1");
  } finally {
    await ctx.close();
  }
});
