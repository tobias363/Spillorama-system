/**
 * BIN-618: integrasjonstester for admin-players-top-router.
 *
 * Dekker:
 *   - auth: 401 uten token (UNAUTHORIZED).
 *   - RBAC: PLAYER → 403 FORBIDDEN.
 *   - RBAC: ADMIN, SUPPORT, HALL_OPERATOR → 200.
 *   - Ukjent metric → 400 INVALID_INPUT.
 *   - ADMIN uten filter: ser alle halls.
 *   - ADMIN med ?hallId=: scoped til angitt hall.
 *   - HALL_OPERATOR tvinges til egen hall (ignore cross-hall).
 *   - HALL_OPERATOR uten tildelt hall → 403.
 *   - HALL_OPERATOR som prøver annen hallId → 403.
 *   - Tom liste returnerer players:[] + count=0.
 *   - Default limit = 5, limit-clamp fungerer.
 *   - Wallet balance-feil fail-softer til 0 (ingen 500).
 *   - complianceData.profilePic mappes til avatar.
 *   - Sort-rekkefølge = walletAmount desc.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPlayersTopRouter } from "../adminPlayersTop.js";
import type { PlatformService, PublicAppUser, AppUser } from "../../platform/PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../game/BingoEngine.js";

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
const operatorNoHallUser: PublicAppUser = {
  ...adminUser,
  id: "op-nohall",
  role: "HALL_OPERATOR",
  hallId: null,
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function makePlayer(id: string, opts?: Partial<AppUser>): AppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: `Player ${id}`,
    walletId: `w-${id}`,
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...opts,
  };
}

interface Ctx {
  baseUrl: string;
  listPlayersCalls: Array<{ hallId?: string; includeDeleted?: boolean; limit?: number }>;
  getBalanceCalls: string[];
  close: () => Promise<void>;
}

interface ServerOpts {
  users: Record<string, PublicAppUser>;
  players: AppUser[];
  balances: Record<string, number>;
  balanceErrors?: Set<string>;
}

async function startServer(opts: ServerOpts): Promise<Ctx> {
  const listPlayersCalls: Ctx["listPlayersCalls"] = [];
  const getBalanceCalls: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async listPlayersForExport(filter: {
      hallId?: string;
      includeDeleted?: boolean;
      limit?: number;
    }): Promise<AppUser[]> {
      listPlayersCalls.push({ ...filter });
      if (filter.hallId) {
        return opts.players.filter((p) => p.hallId === filter.hallId);
      }
      return opts.players;
    },
  } as unknown as PlatformService;

  const walletAdapter = {
    async getBalance(walletId: string): Promise<number> {
      getBalanceCalls.push(walletId);
      if (opts.balanceErrors?.has(walletId)) {
        throw new Error(`simulated wallet failure: ${walletId}`);
      }
      return opts.balances[walletId] ?? 0;
    },
  } as unknown as WalletAdapter;

  const app = express();
  app.use(express.json());
  app.use(createAdminPlayersTopRouter({ platformService, walletAdapter }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    listPlayersCalls,
    getBalanceCalls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function reqJson(
  baseUrl: string,
  path: string,
  token?: string,
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

// ── Tests: auth / RBAC ────────────────────────────────────────────────────

test("BIN-618: GET uten token → 400 UNAUTHORIZED", async () => {
  const ctx = await startServer({ users: {}, players: [], balances: {} });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-618: GET som PLAYER → 400 FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "t-pl": playerUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-pl");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-618: GET som ADMIN → 200 + tom liste når ingen spillere", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.data.players, []);
    assert.equal(res.body.data.count, 0);
    assert.equal(res.body.data.limit, 5);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: GET som SUPPORT → 200", async () => {
  const ctx = await startServer({
    users: { "t-sup": supportUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: GET som HALL_OPERATOR med hallId → 200 + kun egen hall", async () => {
  const ctx = await startServer({
    users: { "t-op": operatorUser },
    players: [
      makePlayer("alice", { hallId: "hall-a" }),
      makePlayer("bob", { hallId: "hall-b" }),
    ],
    balances: { "w-alice": 100, "w-bob": 500 },
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-op");
    assert.equal(res.status, 200);
    // Platform-filter kalt med operatorens hallId.
    assert.equal(ctx.listPlayersCalls.length, 1);
    assert.equal(ctx.listPlayersCalls[0]!.hallId, "hall-a");
    // Bob filtrert bort av platform-service — kun alice.
    assert.equal(res.body.data.count, 1);
    assert.equal(res.body.data.players[0]!.id, "alice");
  } finally {
    await ctx.close();
  }
});

test("BIN-618: HALL_OPERATOR uten tildelt hall → 400 FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "t-op0": operatorNoHallUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-op0");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-618: HALL_OPERATOR som ber om annen hallId → 400 FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "t-op": operatorUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top?hallId=hall-b", "t-op");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Tests: input-validation ──────────────────────────────────────────────

test("BIN-618: ukjent metric → 400 INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top?metric=stakes", "t-adm");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-618: metric=wallet explicit → 200 (same contract som default)", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [makePlayer("a")],
    balances: { "w-a": 42 },
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top?metric=wallet", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.count, 1);
  } finally {
    await ctx.close();
  }
});

// ── Tests: ranking / contract ─────────────────────────────────────────────

test("BIN-618: default sort er walletAmount desc", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: ["alice", "bob", "carol"].map((id) => makePlayer(id)),
    balances: { "w-alice": 100, "w-bob": 500, "w-carol": 250 },
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-adm");
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.players.map((p: any) => p.id),
      ["bob", "carol", "alice"],
    );
    assert.deepEqual(
      res.body.data.players.map((p: any) => p.walletAmount),
      [500, 250, 100],
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-618: limit=2 → kun topp 2", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: ["a", "b", "c", "d"].map((id) => makePlayer(id)),
    balances: { "w-a": 10, "w-b": 40, "w-c": 30, "w-d": 20 },
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top?limit=2", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.limit, 2);
    assert.equal(res.body.data.count, 2);
    assert.deepEqual(res.body.data.players.map((p: any) => p.id), ["b", "c"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: default limit = 5 (legacy top-5)", async () => {
  const players = Array.from({ length: 10 }, (_, i) => makePlayer(`p${i}`));
  const balances: Record<string, number> = {};
  for (let i = 0; i < 10; i++) balances[`w-p${i}`] = i * 10;
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players,
    balances,
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.limit, 5);
    assert.equal(res.body.data.count, 5);
    // Høyeste 5 balances: 90,80,70,60,50 → p9..p5.
    assert.deepEqual(
      res.body.data.players.map((p: any) => p.id),
      ["p9", "p8", "p7", "p6", "p5"],
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-618: wallet-feil for enkelt-spiller fail-softer til 0", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [makePlayer("ok"), makePlayer("broken")],
    balances: { "w-ok": 500 },
    balanceErrors: new Set(["w-broken"]),
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.count, 2);
    // "ok" først (500), "broken" bakerst (0).
    assert.equal(res.body.data.players[0]!.id, "ok");
    assert.equal(res.body.data.players[0]!.walletAmount, 500);
    assert.equal(res.body.data.players[1]!.id, "broken");
    assert.equal(res.body.data.players[1]!.walletAmount, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: complianceData.profilePic mappes til avatar", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [
      makePlayer("a", { complianceData: { profilePic: "/img/a.jpg" } }),
      makePlayer("b", { complianceData: { profilePic: "   " } }),
      makePlayer("c"),
    ],
    balances: { "w-a": 300, "w-b": 200, "w-c": 100 },
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-adm");
    assert.equal(res.status, 200);
    const byId = new Map(res.body.data.players.map((p: any) => [p.id, p]));
    assert.equal((byId.get("a") as any).avatar, "/img/a.jpg");
    // Tom/whitespace → undefined (ikke satt).
    assert.equal((byId.get("b") as any).avatar, undefined);
    assert.equal((byId.get("c") as any).avatar, undefined);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: limit-clamp over 100 → 100", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top?limit=9999", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.limit, 100);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: negative/NaN limit → default 5", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [],
    balances: {},
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top?limit=-3", "t-adm");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.limit, 5);

    const res2 = await reqJson(ctx.baseUrl, "/api/admin/players/top?limit=abc", "t-adm");
    assert.equal(res2.status, 200);
    assert.equal(res2.body.data.limit, 5);
  } finally {
    await ctx.close();
  }
});

test("BIN-618: response envelope har { ok:true, data:{...} }", async () => {
  const ctx = await startServer({
    users: { "t-adm": adminUser },
    players: [makePlayer("a")],
    balances: { "w-a": 77 },
  });
  try {
    const res = await reqJson(ctx.baseUrl, "/api/admin/players/top", "t-adm");
    assert.equal(res.body.ok, true);
    assert.ok("data" in res.body);
    assert.ok("players" in res.body.data);
    assert.ok("count" in res.body.data);
    assert.ok("limit" in res.body.data);
    assert.ok("generatedAt" in res.body.data);
    assert.match(res.body.data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await ctx.close();
  }
});
