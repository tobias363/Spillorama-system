/**
 * BIN-806 A13: integrasjonstester for admin-anti-fraud-router.
 *
 * Full express round-trip + AntiFraudService-stub. Verifiserer:
 *   - RBAC: ADMIN + SUPPORT slipper inn; HALL_OPERATOR + PLAYER blokkeres
 *   - Filtrering på hallId / userId / riskLevel / actionTaken / dato
 *   - Limit-håndtering (max 500)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminAntiFraudRouter } from "../adminAntiFraud.js";
import type {
  AntiFraudListFilter,
  AntiFraudService,
  PersistedAntiFraudSignal,
} from "../../security/AntiFraudService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "admin@test.no", displayName: "Admin",
  walletId: "w-admin", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  filterReceived: AntiFraudListFilter[];
  close: () => Promise<void>;
}

function fakeSignal(overrides: Partial<PersistedAntiFraudSignal>): PersistedAntiFraudSignal {
  return {
    id: overrides.id ?? "sig-1",
    userId: overrides.userId ?? "u1",
    hallId: overrides.hallId ?? null,
    transactionId: overrides.transactionId ?? null,
    riskLevel: overrides.riskLevel ?? "low",
    signals: overrides.signals ?? [],
    actionTaken: overrides.actionTaken ?? "logged",
    ipAddress: overrides.ipAddress ?? null,
    amountCents: overrides.amountCents ?? null,
    operationType: overrides.operationType ?? "DEBIT",
    assessedAt: overrides.assessedAt ?? new Date().toISOString(),
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seedSignals: PersistedAntiFraudSignal[] = [],
): Promise<Ctx> {
  const filterReceived: AntiFraudListFilter[] = [];
  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const antiFraudService = {
    async listSignals(filter: AntiFraudListFilter) {
      filterReceived.push(filter);
      return seedSignals;
    },
  } as unknown as AntiFraudService;

  const app = express();
  app.use(express.json());
  app.use(createAdminAntiFraudRouter({ platformService, antiFraudService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    filterReceived,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, path: string, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("admin-anti-fraud: ADMIN får tilgang", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [fakeSignal({})]);
  try {
    const { status, json } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals",
      "admin-tok",
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(Array.isArray(json.data.signals), true);
    assert.equal(json.data.count, 1);
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: SUPPORT får tilgang", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const { status } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals",
      "sup-tok",
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: HALL_OPERATOR blokkert (FORBIDDEN)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const { status, json } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals",
      "op-tok",
    );
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.ok(json.error.code === "FORBIDDEN" || json.error.code === "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const { status } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals",
      "pl-tok",
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: ingen token → UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const { status, json } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals",
    );
    assert.equal(status, 400);
    assert.equal(json.ok, false);
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: filter-parametre proxies til service", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals?hallId=hall-a&userId=u1&riskLevel=high&actionTaken=flagged_for_review&limit=50",
      "admin-tok",
    );
    assert.equal(ctx.filterReceived.length, 1);
    const f = ctx.filterReceived[0]!;
    assert.equal(f.hallId, "hall-a");
    assert.equal(f.userId, "u1");
    assert.equal(f.riskLevel, "high");
    assert.equal(f.actionTaken, "flagged_for_review");
    assert.equal(f.limit, 50);
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: ugyldig riskLevel → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const { status, json } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals?riskLevel=megacritical",
      "admin-tok",
    );
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: ugyldig actionTaken → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const { status, json } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals?actionTaken=hacked",
      "admin-tok",
    );
    assert.equal(status, 400);
    assert.equal(json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: ugyldig fromDate → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const { status, json } = await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals?fromDate=not-a-date",
      "admin-tok",
    );
    assert.equal(status, 400);
    assert.equal(json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("admin-anti-fraud: gyldig fromDate ISO-8601 propageres", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    await req(
      ctx.baseUrl,
      "/api/admin/anti-fraud/signals?fromDate=2026-05-01T00:00:00Z",
      "admin-tok",
    );
    const f = ctx.filterReceived[0]!;
    assert.equal(f.fromIso, "2026-05-01T00:00:00.000Z");
  } finally {
    await ctx.close();
  }
});
