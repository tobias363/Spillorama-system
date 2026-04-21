/**
 * BIN-655: tests for adminTransactions (generisk transaksjons-logg).
 *
 * Dekker:
 *   - ADMIN + SUPPORT får tilgang; HALL_OPERATOR og PLAYER får FORBIDDEN.
 *   - Tomme resultater: items=[] + nextCursor=null.
 *   - Filtrering passert gjennom til service (from/to/type/userId/hallId).
 *   - Cursor-paginering: encode + decode er invers, og over-fetch-strategi
 *     ved limit+1 røntgener nextCursor.
 *
 * Tester bruker en in-memory `AdminTransactionsService`-stub — Postgres-
 * SQL er verifisert per øvelse i PostgresAdminTransactionsService-modulen
 * (structurell, ingen DB spinnes opp i unit-test).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  createAdminTransactionsRouter,
  decodeTransactionsCursor,
  encodeTransactionsCursor,
  type AdminTransactionRow,
  type AdminTransactionsFilter,
  type AdminTransactionsService,
} from "../adminTransactions.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

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
  };
}

function makeRow(overrides: Partial<AdminTransactionRow> & { id: string }): AdminTransactionRow {
  return {
    source: "wallet",
    type: "wallet.debit",
    amountCents: -100,
    timestamp: "2026-04-20T10:00:00.000Z",
    userId: "u-1",
    hallId: null,
    description: "stake",
    ...overrides,
  };
}

class StubService implements AdminTransactionsService {
  public lastFilter: AdminTransactionsFilter | null = null;
  constructor(private readonly rows: AdminTransactionRow[]) {}
  async list(filter: AdminTransactionsFilter): Promise<AdminTransactionRow[]> {
    this.lastFilter = filter;
    // Apply basic client-side filtering for the service-stub so the
    // integration test can verify wiring end-to-end.
    let rows = [...this.rows];
    if (filter.source) rows = rows.filter((r) => r.source === filter.source);
    if (filter.userId) rows = rows.filter((r) => r.userId === filter.userId);
    if (filter.hallId) rows = rows.filter((r) => r.hallId === filter.hallId);
    if (filter.from) rows = rows.filter((r) => r.timestamp >= filter.from!);
    if (filter.to) rows = rows.filter((r) => r.timestamp <= filter.to!);
    return rows.slice(filter.offset, filter.offset + filter.limit);
  }
}

interface Ctx {
  baseUrl: string;
  stub: StubService;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  rows: AdminTransactionRow[] = []
): Promise<Ctx> {
  const stub = new StubService(rows);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const router = createAdminTransactionsRouter({ platformService, service: stub });
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    stub,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function call(
  ctx: Ctx,
  token: string,
  query = ""
): Promise<{
  status: number;
  body: {
    ok: boolean;
    data?: { items: AdminTransactionRow[]; nextCursor: string | null };
    error?: { code: string };
  };
}> {
  const res = await fetch(`${ctx.baseUrl}/api/admin/transactions${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return { status: res.status, body: body as never };
}

test("adminTransactions: ADMIN får tilgang; PLAYER får FORBIDDEN", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
    "t-pl": makeUser("PLAYER", "pl"),
  });
  try {
    const res = await call(ctx, "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const forbidden = await call(ctx, "t-pl");
    assert.equal(forbidden.status, 400);
    assert.equal(forbidden.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: HALL_OPERATOR får FORBIDDEN (PLAYER_KYC_READ-gate)", async () => {
  const ctx = await startServer({
    "t-op": { ...makeUser("HALL_OPERATOR", "op"), hallId: "h1" },
  });
  try {
    const res = await call(ctx, "t-op");
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: SUPPORT får tilgang", async () => {
  const ctx = await startServer({ "t-sup": makeUser("SUPPORT", "sup") });
  try {
    const res = await call(ctx, "t-sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: tom respons gir items=[] + nextCursor=null", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") }, []);
  try {
    const res = await call(ctx, "t-admin");
    assert.deepEqual(res.body.data, { items: [], nextCursor: null });
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: cursor-paginering med over-fetch", async () => {
  const rows: AdminTransactionRow[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push(
      makeRow({ id: `wallet:tx-${i}`, timestamp: `2026-04-20T${10 - i}:00:00.000Z` })
    );
  }
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") }, rows);
  try {
    const p1 = await call(ctx, "t-admin", "?limit=2");
    assert.equal(p1.body.data!.items.length, 2);
    assert.notEqual(p1.body.data!.nextCursor, null);

    const p2 = await call(
      ctx,
      "t-admin",
      `?limit=2&cursor=${encodeURIComponent(p1.body.data!.nextCursor!)}`
    );
    assert.equal(p2.body.data!.items.length, 2);

    const p3 = await call(
      ctx,
      "t-admin",
      `?limit=2&cursor=${encodeURIComponent(p2.body.data!.nextCursor!)}`
    );
    assert.equal(p3.body.data!.items.length, 1);
    assert.equal(p3.body.data!.nextCursor, null);
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: filter passes through userId/hallId/type", async () => {
  const rows: AdminTransactionRow[] = [
    makeRow({ id: "w:1", userId: "u-alice", hallId: "h-a", source: "wallet" }),
    makeRow({ id: "a:1", userId: "u-bob", hallId: "h-a", source: "agent" }),
    makeRow({ id: "a:2", userId: "u-alice", hallId: "h-b", source: "agent" }),
  ];
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") }, rows);
  try {
    const res = await call(ctx, "t-admin", "?type=agent&hallId=h-a");
    assert.equal(res.body.data!.items.length, 1);
    assert.equal(res.body.data!.items[0]!.id, "a:1");

    const res2 = await call(ctx, "t-admin", "?userId=u-alice");
    assert.equal(res2.body.data!.items.length, 2);

    assert.equal(ctx.stub.lastFilter?.userId, "u-alice");
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: ugyldig type gir 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    const res = await call(ctx, "t-admin", "?type=invalid_source");
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: ugyldig from gir 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    const res = await call(ctx, "t-admin", "?from=not-iso");
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("adminTransactions: cursor encode/decode er invers", () => {
  for (const offset of [0, 1, 100, 5000]) {
    const c = encodeTransactionsCursor(offset);
    assert.equal(decodeTransactionsCursor(c), offset);
  }
});
