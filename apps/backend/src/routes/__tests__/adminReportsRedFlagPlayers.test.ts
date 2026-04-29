/**
 * BIN-651: integrasjonstester for admin-reports-red-flag-players-router.
 *
 * Dekker:
 *   - RBAC (PLAYER_AML_READ): ADMIN + SUPPORT OK; HALL_OPERATOR + PLAYER 403.
 *   - 401 uten token.
 *   - Ugyldig category-slug → 400 INVALID_INPUT.
 *   - Ugyldig ISO from/to → 400.
 *   - from > to → 400.
 *   - Tom liste + flere rader.
 *   - Category-filter propageres.
 *   - Cursor-paginering (nextCursor).
 *   - ⚠️ REGULATORISK: audit-event skrives PÅ VELLYKKET view
 *     (action = admin.report.red_flag_players.viewed) med resultCount +
 *     category + from/to.
 *   - Audit-event skrives IKKE ved 403/400/401 (kun ved 200 OK).
 *   - Actor-type mappes fra rolle.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsRedFlagPlayersRouter } from "../adminReportsRedFlagPlayers.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type { AmlService, AmlRedFlag } from "../../compliance/AmlService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import type { PlatformService, PublicAppUser, AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "admin@test.no",
  displayName: "Admin",
  walletId: "w-admin",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makeFlag(
  id: string,
  userId: string,
  slug: string,
  createdAt: string
): AmlRedFlag {
  return {
    id,
    userId,
    ruleSlug: slug,
    severity: "MEDIUM",
    status: "OPEN",
    reason: "test",
    transactionId: null,
    details: null,
    openedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewOutcome: null,
    reviewNote: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeAppUser(id: string, name: string, email: string): AppUser {
  return {
    id,
    email,
    displayName: name,
    surname: null,
    phone: null,
    walletId: `w-${id}`,
    role: "PLAYER",
    kycStatus: "VERIFIED",
    birthDate: null,
    kycVerifiedAt: null,
    kycProviderRef: null,
    hallId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    complianceData: {},
  } as unknown as AppUser;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  listRedFlagsCalls: Array<{ status?: string; limit?: number }>;
  close: () => Promise<void>;
}

interface ServerOpts {
  users: Record<string, PublicAppUser>;
  flags: AmlRedFlag[];
  appUsers: Map<string, AppUser>;
  ledgerEntries?: ComplianceLedgerEntry[];
}

async function startServer(opts: ServerOpts): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const listRedFlagsCalls: Ctx["listRedFlagsCalls"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string): Promise<AppUser> {
      const u = opts.appUsers.get(id);
      if (!u) throw new DomainError("USER_NOT_FOUND", "missing");
      return u;
    },
  } as unknown as PlatformService;

  const amlService = {
    async listRedFlags(filter: { status?: string; limit?: number }): Promise<AmlRedFlag[]> {
      listRedFlagsCalls.push({ ...filter });
      return opts.flags;
    },
  } as unknown as AmlService;

  const engine = {
    listComplianceLedgerEntries(): ComplianceLedgerEntry[] {
      return opts.ledgerEntries ?? [];
    },
  } as unknown as BingoEngine;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminReportsRedFlagPlayersRouter({
      platformService,
      auditLogService,
      amlService,
      engine,
    })
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore,
    listRedFlagsCalls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function reqJson(
  baseUrl: string,
  path: string,
  token?: string
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Utility: wait for fire-and-forget audit-append to settle.
async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

// ── Tests: auth / RBAC ────────────────────────────────────────────────────

test("BIN-651: GET uten token → 401", async () => {
  const ctx = await startServer({
    users: {},
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: GET som PLAYER → 403 FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "t-pl": playerUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-pl");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: GET som HALL_OPERATOR → 403 (red-flag-data er ikke operatør-scopet)", async () => {
  const ctx = await startServer({
    users: { "t-op": operatorUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-op");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: GET som ADMIN → 200 + tom liste når ingen flagg", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.data.items, []);
    assert.equal(res.body.data.totalCount, 0);
    assert.equal(res.body.data.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-651: GET som SUPPORT → 200", async () => {
  const ctx = await startServer({
    users: { "t-sup": supportUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

// ── Tests: input validation ──────────────────────────────────────────────

test("BIN-651: ukjent category-slug → 400 INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/players?category=nonexistent",
      "t-adm"
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: ugyldig ISO from → 400", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/players?from=not-a-date",
      "t-adm"
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: from > to → 400", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/players?from=2026-05-01&to=2026-04-01",
      "t-adm"
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── Tests: data flow ─────────────────────────────────────────────────────

test("BIN-651: returnerer rader med user-info + categoryId + flaggedAt", async () => {
  const flags = [
    makeFlag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
    makeFlag("f2", "u2", "lost-in-day", "2026-04-11T10:00:00.000Z"),
  ];
  const appUsers = new Map<string, AppUser>([
    ["u1", makeAppUser("u1", "Alice", "alice@test.no")],
    ["u2", makeAppUser("u2", "Bob", "bob@test.no")],
  ]);
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags,
    appUsers,
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.totalCount, 2);
    // Sortert nyeste først → u2 er først.
    assert.equal(res.body.data.items[0].userId, "u2");
    assert.equal(res.body.data.items[0].displayName, "Bob");
    assert.equal(res.body.data.items[0].email, "bob@test.no");
    assert.equal(res.body.data.items[0].categoryId, "lost-in-day");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: category-filter propageres og filtrerer rader", async () => {
  const flags = [
    makeFlag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
    makeFlag("f2", "u2", "lost-in-day", "2026-04-11T10:00:00.000Z"),
  ];
  const appUsers = new Map<string, AppUser>([
    ["u1", makeAppUser("u1", "Alice", "alice@test.no")],
    ["u2", makeAppUser("u2", "Bob", "bob@test.no")],
  ]);
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags,
    appUsers,
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/players?category=used-in-day",
      "t-adm"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].userId, "u1");
    assert.equal(res.body.data.category, "used-in-day");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: cursor-paginering med limit=1 gir nextCursor", async () => {
  const flags: AmlRedFlag[] = [];
  const appUsers = new Map<string, AppUser>();
  for (let i = 1; i <= 3; i++) {
    flags.push(makeFlag(`f${i}`, `u${i}`, "used-in-day", `2026-04-${20 - i}T10:00:00.000Z`));
    appUsers.set(`u${i}`, makeAppUser(`u${i}`, `User ${i}`, `${i}@t.no`));
  }
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags,
    appUsers,
  });
  try {
    const first = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/players?limit=1",
      "t-adm"
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.data.items.length, 1);
    assert.ok(first.body.data.nextCursor, "nextCursor satt");

    const second = await reqJson(
      ctx.baseUrl,
      `/api/admin/reports/red-flag/players?limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
      "t-adm"
    );
    assert.equal(second.status, 200);
    assert.equal(second.body.data.items.length, 1);
    assert.notEqual(
      second.body.data.items[0].userId,
      first.body.data.items[0].userId
    );
  } finally {
    await ctx.close();
  }
});

// ── Tests: AUDIT LOG (REGULATORISK) ──────────────────────────────────────

test(
  "BIN-651 REGULATORISK: vellykket view skriver audit-event admin.report.red_flag_players.viewed",
  async () => {
    const flags = [
      makeFlag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
      makeFlag("f2", "u2", "lost-in-day", "2026-04-11T10:00:00.000Z"),
    ];
    const appUsers = new Map<string, AppUser>([
      ["u1", makeAppUser("u1", "Alice", "alice@test.no")],
      ["u2", makeAppUser("u2", "Bob", "bob@test.no")],
    ]);
    const ctx = await startServer({
      users: { "t-adm": adminUser },
      flags,
      appUsers,
    });
    try {
      const res = await reqJson(
        ctx.baseUrl,
        "/api/admin/reports/red-flag/players?category=used-in-day&from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.999Z",
        "t-adm"
      );
      assert.equal(res.status, 200);

      // Audit er fire-and-forget — gi microtask-tid før vi leser.
      await flushMicrotasks();
      const events: PersistedAuditEvent[] = await ctx.auditStore.list();
      assert.equal(events.length, 1, "ett audit-event per vellykket view");
      const ev = events[0]!;
      assert.equal(ev.action, "admin.report.red_flag_players.viewed");
      assert.equal(ev.resource, "red_flag_players_report");
      assert.equal(ev.resourceId, "used-in-day");
      assert.equal(ev.actorId, "admin-1");
      assert.equal(ev.actorType, "ADMIN");
      const details = ev.details as Record<string, unknown>;
      assert.equal(details.category, "used-in-day");
      assert.equal(typeof details.resultCount, "number");
      assert.equal(details.resultCount, 1);
      assert.equal(details.from, "2026-04-01T00:00:00.000Z");
      assert.equal(details.to, "2026-04-30T23:59:59.999Z");
    } finally {
      await ctx.close();
    }
  }
);

test("BIN-651 REGULATORISK: audit-event er IKKE skrevet ved 403", async () => {
  const ctx = await startServer({
    users: { "t-pl": playerUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-pl");
    assert.equal(res.status, 400);
    await flushMicrotasks();
    const events = await ctx.auditStore.list();
    assert.equal(events.length, 0, "ingen audit ved 403 FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-651 REGULATORISK: audit-event er IKKE skrevet ved 400 INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(
      ctx.baseUrl,
      "/api/admin/reports/red-flag/players?category=bogus",
      "t-adm"
    );
    assert.equal(res.status, 400);
    await flushMicrotasks();
    const events = await ctx.auditStore.list();
    assert.equal(events.length, 0, "ingen audit ved 400");
  } finally {
    await ctx.close();
  }
});

test("BIN-651 REGULATORISK: audit-event er IKKE skrevet ved 401", async () => {
  const ctx = await startServer({
    users: {},
    flags: [],
    appUsers: new Map(),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players");
    assert.equal(res.status, 400);
    await flushMicrotasks();
    const events = await ctx.auditStore.list();
    assert.equal(events.length, 0, "ingen audit ved 401");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: audit-event reflekterer SUPPORT-actor-type", async () => {
  const flags = [makeFlag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z")];
  const appUsers = new Map<string, AppUser>([
    ["u1", makeAppUser("u1", "Alice", "alice@test.no")],
  ]);
  const ctx = await startServer({
    users: { "t-sup": supportUser },
    flags,
    appUsers,
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-sup");
    assert.equal(res.status, 200);
    await flushMicrotasks();
    const events = await ctx.auditStore.list();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.actorType, "SUPPORT");
    assert.equal(events[0]!.actorId, "sup-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-651: slettet user hoppes over i resultat men ikke i audit-teller", async () => {
  const flags = [
    makeFlag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
    makeFlag("f2", "u-gone", "used-in-day", "2026-04-11T10:00:00.000Z"),
  ];
  const appUsers = new Map<string, AppUser>([
    ["u1", makeAppUser("u1", "Alice", "alice@test.no")],
  ]);
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    flags,
    appUsers,
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/reports/red-flag/players", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].userId, "u1");
  } finally {
    await ctx.close();
  }
});
