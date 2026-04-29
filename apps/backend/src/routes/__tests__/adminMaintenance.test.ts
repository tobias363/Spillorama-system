/**
 * BIN-677: integrasjonstester for admin-maintenance-router.
 *
 * Dekker alle endepunkter:
 *   GET  /api/admin/maintenance
 *   GET  /api/admin/maintenance/:id
 *   POST /api/admin/maintenance
 *   PUT  /api/admin/maintenance/:id
 *
 * Testene bygger en stub-MaintenanceService rundt et in-memory Map.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminMaintenanceRouter } from "../adminMaintenance.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  MaintenanceService,
  MaintenanceWindow,
  CreateMaintenanceInput,
  UpdateMaintenanceInput,
  ListMaintenanceFilter,
  MaintenanceStatus,
} from "../../admin/MaintenanceService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
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

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    creates: MaintenanceWindow[];
    updates: Array<{ id: string; changed: string[] }>;
  };
  windows: Map<string, MaintenanceWindow>;
  close: () => Promise<void>;
}

function makeWindow(
  overrides: Partial<MaintenanceWindow> & { id: string }
): MaintenanceWindow {
  return {
    id: overrides.id,
    maintenanceStart:
      overrides.maintenanceStart ?? "2026-05-01T10:00:00.000Z",
    maintenanceEnd: overrides.maintenanceEnd ?? "2026-05-01T12:00:00.000Z",
    message: overrides.message ?? "Systemet er under vedlikehold.",
    showBeforeMinutes: overrides.showBeforeMinutes ?? 60,
    status: overrides.status ?? "inactive",
    createdByUserId: overrides.createdByUserId ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T10:00:00.000Z",
    activatedAt: overrides.activatedAt ?? null,
    deactivatedAt: overrides.deactivatedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: MaintenanceWindow[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const windows = new Map<string, MaintenanceWindow>();
  for (const w of seed) windows.set(w.id, w);
  const creates: MaintenanceWindow[] = [];
  const updates: Ctx["spies"]["updates"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = windows.size;
  const maintenanceService = {
    async list(filter: ListMaintenanceFilter = {}) {
      let list = [...windows.values()];
      if (filter.status) list = list.filter((w) => w.status === filter.status);
      list.sort((a, b) =>
        a.maintenanceStart < b.maintenanceStart ? 1 : -1
      );
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const w = windows.get(id);
      if (!w) {
        throw new DomainError("MAINTENANCE_NOT_FOUND", "not found");
      }
      return w;
    },
    async getActive(): Promise<MaintenanceWindow | null> {
      return (
        [...windows.values()].find((w) => w.status === "active") ?? null
      );
    },
    async create(input: CreateMaintenanceInput) {
      idCounter += 1;
      const id = `m-${idCounter}`;
      const status: MaintenanceStatus = input.status ?? "inactive";
      // Aktiv-invariant.
      if (status === "active") {
        for (const [wid, w] of windows.entries()) {
          if (w.status === "active") {
            windows.set(wid, {
              ...w,
              status: "inactive",
              deactivatedAt: new Date().toISOString(),
            });
          }
        }
      }
      const start =
        typeof input.maintenanceStart === "string"
          ? input.maintenanceStart
          : input.maintenanceStart.toISOString();
      const end =
        typeof input.maintenanceEnd === "string"
          ? input.maintenanceEnd
          : input.maintenanceEnd.toISOString();
      const w = makeWindow({
        id,
        maintenanceStart: start,
        maintenanceEnd: end,
        message: input.message ?? "Systemet er under vedlikehold.",
        showBeforeMinutes: input.showBeforeMinutes ?? 60,
        status,
        createdByUserId: input.createdByUserId,
        activatedAt: status === "active" ? new Date().toISOString() : null,
      });
      windows.set(id, w);
      creates.push(w);
      return w;
    },
    async update(id: string, update: UpdateMaintenanceInput) {
      const w = windows.get(id);
      if (!w) {
        throw new DomainError("MAINTENANCE_NOT_FOUND", "not found");
      }
      const changed: string[] = [];
      const next: MaintenanceWindow = { ...w };
      if (update.maintenanceStart !== undefined) {
        next.maintenanceStart =
          typeof update.maintenanceStart === "string"
            ? update.maintenanceStart
            : update.maintenanceStart.toISOString();
        changed.push("maintenanceStart");
      }
      if (update.maintenanceEnd !== undefined) {
        next.maintenanceEnd =
          typeof update.maintenanceEnd === "string"
            ? update.maintenanceEnd
            : update.maintenanceEnd.toISOString();
        changed.push("maintenanceEnd");
      }
      if (update.message !== undefined) {
        next.message = update.message;
        changed.push("message");
      }
      if (update.showBeforeMinutes !== undefined) {
        next.showBeforeMinutes = update.showBeforeMinutes;
        changed.push("showBeforeMinutes");
      }
      if (update.status !== undefined && update.status !== w.status) {
        next.status = update.status;
        changed.push("status");
        if (update.status === "active") {
          next.activatedAt = new Date().toISOString();
          // Aktiv-invariant.
          for (const [wid, other] of windows.entries()) {
            if (wid !== id && other.status === "active") {
              windows.set(wid, {
                ...other,
                status: "inactive",
                deactivatedAt: new Date().toISOString(),
              });
            }
          }
        } else {
          next.deactivatedAt = new Date().toISOString();
        }
      }
      if (changed.length === 0) {
        throw new DomainError("INVALID_INPUT", "no changes");
      }
      next.updatedAt = new Date().toISOString();
      windows.set(id, next);
      updates.push({ id, changed });
      return next;
    },
  } as unknown as MaintenanceService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminMaintenanceRouter({
      platformService,
      auditLogService,
      maintenanceService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates },
    windows,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string
): Promise<PersistedAuditEvent | null> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── RBAC ─────────────────────────────────────────────────────────────────────

test("BIN-677 maintenance route: PLAYER blokkert fra alle endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance",
      "pl-tok"
    );
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/maintenance",
      "pl-tok",
      {
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
      }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeWindow({ id: "m-1" }),
  ]);
  try {
    const list = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance",
      "sup-tok"
    );
    assert.equal(list.status, 200);

    const post = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/maintenance",
      "sup-tok",
      {
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
      }
    );
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/maintenance/m-1",
      "sup-tok",
      { status: "active" }
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: HALL_OPERATOR kan READ men ikke WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser }, [
    makeWindow({ id: "m-1" }),
  ]);
  try {
    const list = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance",
      "op-tok"
    );
    assert.equal(list.status, 200);

    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/maintenance/m-1",
      "op-tok",
      { status: "active" }
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── GET list ────────────────────────────────────────────────────────────────

test("BIN-677 maintenance route: GET list returnerer alle vinduer + active-ref", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({ id: "m-1", status: "inactive" }),
    makeWindow({ id: "m-2", status: "active", activatedAt: "2026-04-20T11:00:00Z" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.windows.length, 2);
    assert.equal(res.json.data.count, 2);
    assert.ok(res.json.data.active);
    assert.equal(res.json.data.active.id, "m-2");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: GET list returnerer active=null når ingen aktiv", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({ id: "m-1", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.active, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: GET list filter status=active", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({ id: "m-1", status: "inactive" }),
    makeWindow({ id: "m-2", status: "active" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance?status=active",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.windows.length, 1);
    assert.equal(res.json.data.windows[0].id, "m-2");
  } finally {
    await ctx.close();
  }
});

// ── GET detail ─────────────────────────────────────────────────────────────

test("BIN-677 maintenance route: GET detail returnerer vinduet", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({ id: "m-1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance/m-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "m-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: GET detail 404 på ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/maintenance/does-not-exist",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "MAINTENANCE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── POST create ────────────────────────────────────────────────────────────

test("BIN-677 maintenance route: POST oppretter vindu + skriver AuditLog create", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/maintenance",
      "admin-tok",
      {
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        message: "Planlagt vedlikehold",
        showBeforeMinutes: 30,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "inactive");
    assert.equal(res.json.data.message, "Planlagt vedlikehold");
    assert.equal(res.json.data.showBeforeMinutes, 30);
    const event = await waitForAudit(
      ctx.spies.auditStore,
      "admin.maintenance.create"
    );
    assert.ok(event, "create audit");
    assert.equal(event!.resource, "maintenance_window");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: POST med status=active skriver både create + activate audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/maintenance",
      "admin-tok",
      {
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        status: "active",
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "active");
    const createEvt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.maintenance.create"
    );
    assert.ok(createEvt, "create audit");
    const actEvt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.maintenance.activate"
    );
    assert.ok(actEvt, "activate audit (viaCreate)");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: POST uten maintenanceStart avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/maintenance",
      "admin-tok",
      { maintenanceEnd: "2026-05-01T12:00:00Z" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── PUT update / toggle ────────────────────────────────────────────────────

test("BIN-677 maintenance route: PUT status=active skriver activate audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({ id: "m-1", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/maintenance/m-1",
      "admin-tok",
      { status: "active" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "active");
    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.maintenance.activate"
    );
    assert.ok(evt, "activate audit");
    assert.equal(evt!.resourceId, "m-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: PUT status=inactive skriver deactivate audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({
      id: "m-1",
      status: "active",
      activatedAt: "2026-04-20T11:00:00Z",
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/maintenance/m-1",
      "admin-tok",
      { status: "inactive" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "inactive");
    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.maintenance.deactivate"
    );
    assert.ok(evt, "deactivate audit");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: PUT uten status-skift skriver update audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeWindow({ id: "m-1", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/maintenance/m-1",
      "admin-tok",
      { message: "Ny tekst" }
    );
    assert.equal(res.status, 200);
    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.maintenance.update"
    );
    assert.ok(evt, "update audit");
  } finally {
    await ctx.close();
  }
});

test("BIN-677 maintenance route: PUT på ukjent id returnerer not-found", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/maintenance/nope",
      "admin-tok",
      { status: "active" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "MAINTENANCE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
