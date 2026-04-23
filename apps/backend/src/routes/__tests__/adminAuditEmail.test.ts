/**
 * BIN-588 wire-up: integration tests for admin-route audit + email hooks.
 *
 * Builds a live express router with narrow stubs for PlatformService,
 * BingoEngine, etc., and exercises four representative endpoints:
 *
 *   PUT    /api/admin/users/:userId/role     → audit + email
 *   POST   /api/admin/halls                  → audit (hall.create)
 *   POST   /api/admin/rooms                  → audit (room.create)
 *   PUT    /api/admin/wallets/:id/loss-limits → audit (wallet.loss_limits.update)
 *
 * Each test asserts:
 *   - the underlying domain call happened,
 *   - an audit event was recorded with the right action/actor/details,
 *   - (role-change) an e-mail was sent via EmailService.
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
} from "../../platform/PlatformService.js";

// ── Stub platform service ─────────────────────────────────────────────────

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

function makePlayer(id: string, email: string): AppUser & PublicAppUser {
  return {
    id,
    email,
    displayName: `Player ${id}`,
    walletId: `wallet-${id}`,
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as AppUser & PublicAppUser;
}

// ── Test harness ──────────────────────────────────────────────────────────

interface HarnessContext {
  baseUrl: string;
  sentEmails: Array<{ to: string; template: string; context: Record<string, unknown> }>;
  audit: AuditLogService;
  auditStore: InMemoryAuditLogStore;
  admin: AppUser & PublicAppUser;
  close: () => Promise<void>;
}

async function startAdminServer(options: {
  admin: AppUser & PublicAppUser;
  users?: Record<string, AppUser & PublicAppUser>;
  onCreateRoom?: (input: unknown) => { roomCode: string; playerId: string };
  onSetLossLimits?: (input: unknown) => Record<string, unknown>;
}): Promise<HarnessContext> {
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);

  const sentEmails: HarnessContext["sentEmails"] = [];
  const emailService = new EmailService({
    transporter: {
      async sendMail() { return { messageId: "fake" }; },
    },
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });
  const origSendTemplate = emailService.sendTemplate.bind(emailService);
  emailService.sendTemplate = async (input) => {
    sentEmails.push({
      to: input.to,
      template: input.template,
      context: input.context as Record<string, unknown>,
    });
    return origSendTemplate(input);
  };

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token === options.admin.id) return options.admin;
      throw Object.assign(new Error("bad token"), { code: "UNAUTHORIZED" });
    },
    async getUserById(userId: string): Promise<AppUser> {
      return options.users?.[userId] ?? options.admin;
    },
    async updateUserRole(userId: string, role: string): Promise<PublicAppUser> {
      const u = options.users?.[userId];
      if (!u) throw new Error("not found");
      u.role = role as PublicAppUser["role"];
      return u;
    },
    async createHall(input: { slug: string; name: string; region?: string; address?: string; isActive?: boolean }) {
      return {
        id: `hall-${input.slug}`,
        slug: input.slug,
        name: input.name,
        region: input.region ?? "NO",
        address: input.address ?? "",
        isActive: input.isActive ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async requireActiveHall(reference: string) {
      return { id: reference, slug: reference, name: reference, region: "NO", address: "", isActive: true, createdAt: "", updatedAt: "" };
    },
  } as unknown as PlatformService;

  // Minimal BingoEngine stub — only the methods the tested endpoints hit.
  const engine = {
    async createRoom(input: { hallId: string; playerName: string; walletId: string; roomCode?: string }) {
      return options.onCreateRoom
        ? options.onCreateRoom(input)
        : { roomCode: input.roomCode ?? "ROOM-A", playerId: "host-1" };
    },
    listRoomSummaries() { return [] as Array<{ code: string; hallId: string; gameStatus: string; playerCount: number }>; },
    async setPlayerLossLimits(input: unknown) {
      return options.onSetLossLimits
        ? options.onSetLossLimits(input)
        : { walletId: (input as { walletId: string }).walletId, dailyLossLimit: 500, monthlyLossLimit: null };
    },
  } as unknown as AdminRouterDeps["engine"];

  const noop = () => undefined;
  const noopAsync = async () => undefined;
  const emptyMap = new Map<string, number>();

  const deps: AdminRouterDeps = {
    platformService,
    engine,
    io: {} as AdminRouterDeps["io"],
    drawScheduler: {
      releaseRoom: noop,
    } as unknown as AdminRouterDeps["drawScheduler"],
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
    emitRoomUpdate: (async (code: string) => ({
      code,
      hallId: "hall-1",
      gameStatus: "WAITING",
      playerCount: 1,
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
    resolveBingoHallGameConfigForRoom: (async () => ({ hallId: "hall-1", maxTicketsPerPlayer: 30 })) as unknown as AdminRouterDeps["resolveBingoHallGameConfigForRoom"],
    auditLogService: audit,
    emailService,
    supportEmail: "support@spillorama.no",
    hallCashLedger: new InMemoryHallCashLedger(),
  };

  const app = express();
  app.use(express.json());
  app.use(createAdminRouter(deps));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sentEmails,
    audit,
    auditStore,
    admin: options.admin,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function call(
  method: "POST" | "PUT" | "DELETE",
  url: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Wait for the fire-and-forget audit write to land. ─────────────────────

async function waitForAuditEntries(audit: AuditLogService, n: number, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await audit.list({ limit: 100 });
    if (events.length >= n) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${n} audit entries`);
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("BIN-588 wire-up: PUT /users/:id/role writes audit entry + sends e-mail", async () => {
  const admin = makeAdmin();
  const player = makePlayer("player-42", "player@test.no");
  const users = { [admin.id]: admin, [player.id]: player };
  const ctx = await startAdminServer({ admin, users });
  try {
    const res = await call("PUT", `${ctx.baseUrl}/api/admin/users/${player.id}/role`, admin.id, {
      role: "SUPPORT",
    });
    assert.equal(res.status, 200);

    await waitForAuditEntries(ctx.audit, 1);
    const [evt] = await ctx.audit.list();
    assert.equal(evt.action, "user.role.change");
    assert.equal(evt.resource, "user");
    assert.equal(evt.resourceId, player.id);
    assert.equal(evt.actorId, admin.id);
    assert.equal(evt.actorType, "ADMIN");
    assert.deepEqual(evt.details, { previousRole: "PLAYER", newRole: "SUPPORT" });

    // E-mail side-effect (fire-and-forget → wait a moment)
    for (let i = 0; i < 50 && ctx.sentEmails.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(ctx.sentEmails.length, 1);
    const mail = ctx.sentEmails[0]!;
    assert.equal(mail.template, "role-changed");
    assert.equal(mail.to, "player@test.no");
    assert.equal(mail.context.previousRole, "PLAYER");
    assert.equal(mail.context.newRole, "SUPPORT");
    assert.ok(typeof mail.context.changedAt === "string");
  } finally {
    await ctx.close();
  }
});

test("BIN-588 wire-up: POST /halls writes audit entry (hall.create)", async () => {
  const admin = makeAdmin();
  const ctx = await startAdminServer({ admin });
  try {
    const res = await call("POST", `${ctx.baseUrl}/api/admin/halls`, admin.id, {
      slug: "oslo-sentrum",
      name: "Oslo Sentrum",
    });
    assert.equal(res.status, 200);

    await waitForAuditEntries(ctx.audit, 1);
    const [evt] = await ctx.audit.list();
    assert.equal(evt.action, "hall.create");
    assert.equal(evt.resource, "hall");
    assert.equal(evt.resourceId, "hall-oslo-sentrum");
    assert.equal(evt.actorId, admin.id);
    assert.equal(evt.details.slug, "oslo-sentrum");
    assert.equal(evt.details.name, "Oslo Sentrum");
  } finally {
    await ctx.close();
  }
});

test("BIN-588 wire-up: POST /rooms writes audit entry (room.create) with hallId", async () => {
  const admin = makeAdmin();
  const ctx = await startAdminServer({
    admin,
    onCreateRoom: (input) => ({
      roomCode: "ROOM-OSLO-1",
      playerId: (input as { walletId: string }).walletId,
    }),
  });
  try {
    const res = await call("POST", `${ctx.baseUrl}/api/admin/rooms`, admin.id, {
      hallId: "hall-oslo",
      hostName: "Operator",
      hostWalletId: "host-1",
    });
    assert.equal(res.status, 200);

    await waitForAuditEntries(ctx.audit, 1);
    const [evt] = await ctx.audit.list();
    assert.equal(evt.action, "room.create");
    assert.equal(evt.resource, "room");
    assert.equal(evt.resourceId, "ROOM-OSLO-1");
    assert.equal(evt.details.hallId, "hall-oslo");
  } finally {
    await ctx.close();
  }
});

test("BIN-588 wire-up: PUT /wallets/:id/loss-limits writes audit with nullable fields", async () => {
  const admin = makeAdmin();
  const ctx = await startAdminServer({
    admin,
    onSetLossLimits: () => ({ walletId: "w-1", dailyLossLimit: 800, monthlyLossLimit: null }),
  });
  try {
    const res = await call(
      "PUT",
      `${ctx.baseUrl}/api/admin/wallets/w-1/loss-limits`,
      admin.id,
      { hallId: "hall-1", dailyLossLimit: 800 },
    );
    assert.equal(res.status, 200);

    await waitForAuditEntries(ctx.audit, 1);
    const [evt] = await ctx.audit.list();
    assert.equal(evt.action, "wallet.loss_limits.update");
    assert.equal(evt.resource, "wallet");
    assert.equal(evt.resourceId, "w-1");
    assert.equal(evt.details.dailyLossLimit, 800);
    assert.equal(evt.details.monthlyLossLimit, null);
    assert.equal(evt.details.hallId, "hall-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-588 wire-up: role change with SAME role does not trigger e-mail", async () => {
  const admin = makeAdmin();
  const player = makePlayer("player-99", "player@test.no");
  const users = { [admin.id]: admin, [player.id]: player };
  const ctx = await startAdminServer({ admin, users });
  try {
    const res = await call("PUT", `${ctx.baseUrl}/api/admin/users/${player.id}/role`, admin.id, {
      role: "PLAYER",
    });
    assert.equal(res.status, 200);

    // Audit entry still written (any role PUT is audit-worthy).
    await waitForAuditEntries(ctx.audit, 1);
    const [evt] = await ctx.audit.list();
    assert.equal(evt.details.previousRole, "PLAYER");
    assert.equal(evt.details.newRole, "PLAYER");

    // But no e-mail — previousRole === newRole.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ctx.sentEmails.length, 0);
  } finally {
    await ctx.close();
  }
});
