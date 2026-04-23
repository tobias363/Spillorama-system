/**
 * Admin "Add Money"-endpointet: POST /api/admin/halls/:hallId/add-money
 *
 * Dekker:
 *   - 2xx ved gyldig positivt beløp → hall.balance.add audit-hendelse +
 *     HallCashLedger.applyCashTx med MANUAL_ADJUSTMENT/CREDIT
 *   - 4xx ved amount <= 0 eller ikke-endelige tall
 *   - Atomicitet: cash_balance + app_hall_cash_transactions skrives sammen
 *     (her gjennom InMemoryHallCashLedger som etterligner transactional
 *     flow; Postgres-varianten har egen BEGIN/COMMIT-test via ledger-
 *     modulen).
 *   - GET /balance-transactions returnerer ledger-historikk + running
 *     balances.
 *
 * Bruker samme harness-stil som adminAuditEmail.test.ts (Express-router
 * med in-memory audit + email + cash-ledger).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminRouter, type AdminRouterDeps } from "../admin.js";
import { EmailService } from "../../integration/EmailService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import { InMemoryHallCashLedger } from "../../agent/HallCashLedger.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
  HallDefinition,
} from "../../platform/PlatformService.js";

function makeAdmin(id = "admin-1"): AppUser & PublicAppUser {
  return {
    id,
    email: "admin@spillorama.no",
    displayName: "Admin One",
    walletId: `wallet-${id}`,
    role: "ADMIN",
    hallId: null,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as AppUser & PublicAppUser;
}

interface HarnessContext {
  baseUrl: string;
  audit: AuditLogService;
  ledger: InMemoryHallCashLedger;
  admin: AppUser & PublicAppUser;
  close: () => Promise<void>;
}

async function startServer(opts: {
  admin: AppUser & PublicAppUser;
  hall: HallDefinition;
  seedBalance?: number;
}): Promise<HarnessContext> {
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const ledger = new InMemoryHallCashLedger();
  if (opts.seedBalance !== undefined) {
    ledger.seedHallBalance(opts.hall.id, opts.seedBalance);
  }

  const emailService = new EmailService({
    transporter: {
      async sendMail() { return { messageId: "fake" }; },
    },
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token === opts.admin.id) return opts.admin;
      throw Object.assign(new Error("bad token"), { code: "UNAUTHORIZED" });
    },
    async getHall(reference: string): Promise<HallDefinition> {
      if (reference === opts.hall.id || reference === opts.hall.slug) {
        return opts.hall;
      }
      throw Object.assign(new Error("HALL_NOT_FOUND"), { code: "HALL_NOT_FOUND" });
    },
    async listHalls() {
      return [opts.hall];
    },
  } as unknown as PlatformService;

  const engine = {
    listRoomSummaries() { return []; },
  } as unknown as AdminRouterDeps["engine"];

  const noop = () => undefined;
  const noopAsync = async () => undefined;
  const emptyMap = new Map<string, number>();

  const deps: AdminRouterDeps = {
    platformService,
    engine,
    io: {} as AdminRouterDeps["io"],
    drawScheduler: { releaseRoom: noop } as unknown as AdminRouterDeps["drawScheduler"],
    bingoSettingsState: {
      runtimeBingoSettings: {
        autoRoundStartEnabled: false,
        autoRoundStartIntervalMs: 60_000,
        autoRoundMinPlayers: 1,
        autoRoundTicketsPerPlayer: 1,
        autoRoundEntryFee: 0,
        payoutPercent: 80,
        autoDrawEnabled: false,
        autoDrawIntervalMs: 2000,
      },
      effectiveFromMs: Date.now(),
      pendingUpdate: null,
    },
    responsibleGamingStore: undefined,
    localBingoAdapter: null,
    usePostgresBingoAdapter: false,
    enforceSingleRoomPerHall: false,
    bingoMinRoundIntervalMs: 30_000,
    bingoMinPlayersToStart: 1,
    bingoMaxDrawsPerRound: 75,
    fixedAutoDrawIntervalMs: 2000,
    forceAutoStart: false,
    forceAutoDraw: false,
    isProductionRuntime: false,
    autoplayAllowed: true,
    allowAutoplayInProduction: false,
    schedulerTickMs: 250,
    emitRoomUpdate: (async () => ({
      code: "ROOM", hallId: opts.hall.id, gameStatus: "WAITING", playerCount: 0,
    })) as unknown as AdminRouterDeps["emitRoomUpdate"],
    emitManyRoomUpdates: noopAsync as unknown as AdminRouterDeps["emitManyRoomUpdates"],
    emitWalletRoomUpdates: noopAsync as unknown as AdminRouterDeps["emitWalletRoomUpdates"],
    buildRoomUpdatePayload: ((s: unknown) => s) as unknown as AdminRouterDeps["buildRoomUpdatePayload"],
    persistBingoSettingsToCatalog: noopAsync as unknown as AdminRouterDeps["persistBingoSettingsToCatalog"],
    normalizeBingoSchedulerSettings: ((current: unknown) => current) as unknown as AdminRouterDeps["normalizeBingoSchedulerSettings"],
    parseBingoSettingsPatch: (() => ({})) as unknown as AdminRouterDeps["parseBingoSettingsPatch"],
    getRoomConfiguredEntryFee: () => 0,
    getArmedPlayerIds: () => [],
    disarmAllPlayers: noop,
    clearDisplayTicketCache: noop,
    roomConfiguredEntryFeeByRoom: emptyMap,
    getPrimaryRoomForHall: () => null,
    resolveBingoHallGameConfigForRoom: (async () => ({ hallId: opts.hall.id, maxTicketsPerPlayer: 30 })) as unknown as AdminRouterDeps["resolveBingoHallGameConfigForRoom"],
    auditLogService: audit,
    emailService,
    supportEmail: "support@spillorama.no",
    hallCashLedger: ledger,
  };

  const app = express();
  app.use(express.json());
  app.use(createAdminRouter(deps));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    audit,
    ledger,
    admin: opts.admin,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function call(
  method: "POST" | "GET",
  url: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: { ok: boolean; data?: unknown; error?: { message?: string } } | null }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null) as { ok: boolean; data?: unknown; error?: { message?: string } } | null;
  return { status: res.status, json };
}

async function waitForAudit(audit: AuditLogService, action: string, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evts = await audit.list({ limit: 50 });
    if (evts.some((e) => e.action === action)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timeout waiting for audit action ${action}`);
}

function makeHall(id = "hall-1"): HallDefinition {
  return {
    id,
    slug: id,
    name: "Test Hall",
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    hallNumber: 101,
    cashBalance: 0,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("POST /halls/:id/add-money credits hall balance + writes audit", async () => {
  const admin = makeAdmin();
  const hall = makeHall();
  const ctx = await startServer({ admin, hall, seedBalance: 3000 });
  try {
    const res = await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, {
      amount: 500,
      reason: "Shift-start påfylling",
    });
    assert.equal(res.status, 200, `unexpected status: ${JSON.stringify(res.json)}`);
    const data = res.json?.data as { balanceAfter: number; previousBalance: number; transaction: { txType: string; direction: string; notes: string | null } };
    assert.equal(data.previousBalance, 3000);
    assert.equal(data.balanceAfter, 3500);
    assert.equal(data.transaction.txType, "MANUAL_ADJUSTMENT");
    assert.equal(data.transaction.direction, "CREDIT");
    assert.equal(data.transaction.notes, "Shift-start påfylling");

    // Audit side-effect
    await waitForAudit(ctx.audit, "hall.balance.add");
    const evt = (await ctx.audit.list()).find((e) => e.action === "hall.balance.add")!;
    assert.equal(evt.resource, "hall");
    assert.equal(evt.resourceId, hall.id);
    assert.equal(evt.details.amount, 500);
    assert.equal(evt.details.balanceAfter, 3500);

    // Ledger state
    const balances = await ctx.ledger.getHallBalances(hall.id);
    assert.equal(balances.cashBalance, 3500);
  } finally {
    await ctx.close();
  }
});

test("POST /halls/:id/add-money rejects amount <= 0", async () => {
  const admin = makeAdmin();
  const hall = makeHall();
  const ctx = await startServer({ admin, hall, seedBalance: 0 });
  try {
    // 0
    const zero = await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, {
      amount: 0,
    });
    assert.equal(zero.status, 400);

    // negativ
    const neg = await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, {
      amount: -50,
    });
    assert.equal(neg.status, 400);

    // NaN
    const nan = await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, {
      amount: "not-a-number",
    });
    assert.equal(nan.status, 400);

    // Balansen er fortsatt 0 — ingen tx på feilende kall.
    const balances = await ctx.ledger.getHallBalances(hall.id);
    assert.equal(balances.cashBalance, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /halls/:id/add-money accepts amount as string (form-input)", async () => {
  const admin = makeAdmin();
  const hall = makeHall();
  const ctx = await startServer({ admin, hall, seedBalance: 100 });
  try {
    const res = await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, {
      amount: "250.5",
    });
    assert.equal(res.status, 200);
    const data = res.json?.data as { balanceAfter: number };
    assert.equal(data.balanceAfter, 350.5);
  } finally {
    await ctx.close();
  }
});

test("GET /halls/:id/balance-transactions returns running totals + history", async () => {
  const admin = makeAdmin();
  const hall = makeHall();
  const ctx = await startServer({ admin, hall, seedBalance: 1000 });
  try {
    // To kreditteringer
    await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, { amount: 200 });
    await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.id}/add-money`, admin.id, { amount: 300, reason: "test" });

    const res = await call("GET", `${ctx.baseUrl}/api/admin/halls/${hall.id}/balance-transactions`, admin.id);
    assert.equal(res.status, 200);
    const data = res.json?.data as {
      cashBalance: number;
      transactions: Array<{ amount: number; direction: string; notes: string | null }>;
    };
    assert.equal(data.cashBalance, 1500);
    assert.equal(data.transactions.length, 2);
    // Nyeste først
    assert.equal(data.transactions[0]!.amount, 300);
    assert.equal(data.transactions[0]!.notes, "test");
    assert.equal(data.transactions[1]!.amount, 200);
  } finally {
    await ctx.close();
  }
});

test("POST /halls/:id/add-money also accepts hall by slug (not just uuid)", async () => {
  const admin = makeAdmin();
  const hall = makeHall("hall-oslo-sentrum");
  const ctx = await startServer({ admin, hall, seedBalance: 0 });
  try {
    // Bruker slug i URL (getHall normaliserer til id)
    const res = await call("POST", `${ctx.baseUrl}/api/admin/halls/${hall.slug}/add-money`, admin.id, {
      amount: 100,
    });
    assert.equal(res.status, 200);
    const balances = await ctx.ledger.getHallBalances(hall.id);
    assert.equal(balances.cashBalance, 100);
  } finally {
    await ctx.close();
  }
});
