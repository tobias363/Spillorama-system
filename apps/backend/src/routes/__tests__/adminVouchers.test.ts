/**
 * BIN-587 B4b: integrasjonstester for admin-vouchers-router.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminVouchersRouter } from "../adminVouchers.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type { VoucherService, Voucher } from "../../compliance/VoucherService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

const adminUser: PublicAppUser = {
  id: "admin-1", email: "a@test.no", displayName: "Admin",
  walletId: "w-a", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    creates: Array<Voucher>;
    updates: Array<{ id: string; changed: string[] }>;
    removes: string[];
  };
  vouchers: Map<string, Voucher>;
  close: () => Promise<void>;
}

function makeVoucher(overrides: Partial<Voucher> & { id: string; code: string }): Voucher {
  return {
    id: overrides.id,
    code: overrides.code,
    type: overrides.type ?? "PERCENTAGE",
    value: overrides.value ?? 10,
    maxUses: overrides.maxUses ?? null,
    usesCount: overrides.usesCount ?? 0,
    validFrom: overrides.validFrom ?? null,
    validTo: overrides.validTo ?? null,
    isActive: overrides.isActive ?? true,
    description: overrides.description ?? null,
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: Voucher[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const vouchers = new Map<string, Voucher>();
  for (const v of seed) vouchers.set(v.id, v);
  const creates: Voucher[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const voucherService = {
    async list(filter: { isActive?: boolean; limit?: number }) {
      let list = [...vouchers.values()];
      if (filter.isActive !== undefined) list = list.filter((v) => v.isActive === filter.isActive);
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const v = vouchers.get(id);
      if (!v) throw new DomainError("VOUCHER_NOT_FOUND", "not found");
      return v;
    },
    async create(input: { code: string; type: "PERCENTAGE" | "FLAT_AMOUNT"; value: number; createdBy: string }) {
      const id = `v-${vouchers.size + 1}`;
      const v = makeVoucher({ id, code: input.code.toUpperCase(), type: input.type, value: input.value, createdBy: input.createdBy });
      vouchers.set(id, v);
      creates.push(v);
      return v;
    },
    async update(id: string, update: Record<string, unknown>) {
      const v = vouchers.get(id);
      if (!v) throw new DomainError("VOUCHER_NOT_FOUND", "not found");
      updates.push({ id, changed: Object.keys(update) });
      const updated = { ...v, ...update };
      vouchers.set(id, updated);
      return updated;
    },
    async remove(id: string) {
      const v = vouchers.get(id);
      if (!v) throw new DomainError("VOUCHER_NOT_FOUND", "not found");
      removes.push(id);
      if (v.usesCount > 0) {
        vouchers.set(id, { ...v, isActive: false });
        return { softDeleted: true };
      }
      vouchers.delete(id);
      return { softDeleted: false };
    },
  } as unknown as VoucherService;

  const app = express();
  app.use(express.json());
  app.use(createAdminVouchersRouter({ platformService, auditLogService, voucherService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    vouchers,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(store: InMemoryAuditLogStore, action: string): Promise<PersistedAuditEvent | null> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B4b: PLAYER blokkert fra alle voucher-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/vouchers", "pl-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: HALL_OPERATOR + SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "op-tok": operatorUser, "sup-tok": supportUser });
  try {
    for (const token of ["op-tok", "sup-tok"]) {
      const read = await req(ctx.baseUrl, "GET", "/api/admin/vouchers", token);
      assert.equal(read.status, 200);
      const write = await req(ctx.baseUrl, "POST", "/api/admin/vouchers", token, {
        code: "X", type: "PERCENTAGE", value: 10,
      });
      assert.equal(write.status, 400);
      assert.equal(write.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: POST voucher — ADMIN oppretter + audit logger code + type", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/vouchers", "admin-tok", {
      code: "welcome25",
      type: "PERCENTAGE",
      value: 25,
      description: "Welcome discount",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.code, "WELCOME25");
    assert.equal(ctx.spies.creates.length, 1);

    const event = await waitForAudit(ctx.spies.auditStore, "voucher.create");
    assert.ok(event);
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.details.code, "WELCOME25");
    assert.equal(event!.details.type, "PERCENTAGE");
    assert.equal(event!.details.value, 25);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: POST voucher validerer required fields", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r1 = await req(ctx.baseUrl, "POST", "/api/admin/vouchers", "admin-tok", {});
    assert.equal(r1.status, 400);
    const r2 = await req(ctx.baseUrl, "POST", "/api/admin/vouchers", "admin-tok", { code: "X" });
    assert.equal(r2.status, 400);
    const r3 = await req(ctx.baseUrl, "POST", "/api/admin/vouchers", "admin-tok", { code: "X", type: "PERCENTAGE" });
    assert.equal(r3.status, 400);
    assert.equal(r3.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET /:id returnerer detalj + PUT endrer + audit", async () => {
  const seed = makeVoucher({ id: "v-1", code: "TEST" });
  const ctx = await startServer({ "admin-tok": adminUser }, [seed]);
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/vouchers/v-1", "admin-tok");
    assert.equal(get.status, 200);
    assert.equal(get.json.data.code, "TEST");

    const put = await req(ctx.baseUrl, "PUT", "/api/admin/vouchers/v-1", "admin-tok", {
      value: 50,
      isActive: false,
    });
    assert.equal(put.status, 200);
    assert.deepEqual(ctx.spies.updates[0]!.changed.sort(), ["isActive", "value"]);

    const event = await waitForAudit(ctx.spies.auditStore, "voucher.update");
    assert.ok(event);
    assert.deepEqual((event!.details.changed as string[]).sort(), ["isActive", "value"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: DELETE hard-delete for ubrukt + audit voucher.delete", async () => {
  const seed = makeVoucher({ id: "v-1", code: "UNUSED", usesCount: 0 });
  const ctx = await startServer({ "admin-tok": adminUser }, [seed]);
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/vouchers/v-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);
    const event = await waitForAudit(ctx.spies.auditStore, "voucher.delete");
    assert.ok(event);
    assert.equal(event!.details.softDeleted, false);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: DELETE soft-delete hvis usesCount > 0 + audit voucher.soft_delete", async () => {
  const seed = makeVoucher({ id: "v-1", code: "USED", usesCount: 5 });
  const ctx = await startServer({ "admin-tok": adminUser }, [seed]);
  try {
    const res = await req(ctx.baseUrl, "DELETE", "/api/admin/vouchers/v-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);
    const event = await waitForAudit(ctx.spies.auditStore, "voucher.soft_delete");
    assert.ok(event);
    assert.equal(event!.details.usesCount, 5);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B4b: GET list med isActive-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeVoucher({ id: "v-1", code: "ACT1", isActive: true }),
    makeVoucher({ id: "v-2", code: "INACT1", isActive: false }),
  ]);
  try {
    const all = await req(ctx.baseUrl, "GET", "/api/admin/vouchers", "admin-tok");
    assert.equal(all.json.data.count, 2);
    const active = await req(ctx.baseUrl, "GET", "/api/admin/vouchers?isActive=true", "admin-tok");
    assert.equal(active.json.data.count, 1);
    const inactive = await req(ctx.baseUrl, "GET", "/api/admin/vouchers?isActive=false", "admin-tok");
    assert.equal(inactive.json.data.count, 1);
  } finally {
    await ctx.close();
  }
});
