/**
 * BIN-625: integrasjonstester for admin-schedules-router.
 *
 * Dekker alle 4 CRUD-endepunktene + detail-GET:
 *   GET    /api/admin/schedules
 *   GET    /api/admin/schedules/:id
 *   POST   /api/admin/schedules
 *   PATCH  /api/admin/schedules/:id
 *   DELETE /api/admin/schedules/:id
 *
 * Testene bygger en stub-ScheduleService rundt et in-memory Map — samme
 * pattern som adminCloseDay.test.ts / adminDailySchedules.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSchedulesRouter } from "../adminSchedules.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  ScheduleService,
  Schedule,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListScheduleFilter,
} from "../../admin/ScheduleService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

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
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    lists: ListScheduleFilter[];
    creates: CreateScheduleInput[];
    updates: Array<{ id: string; update: UpdateScheduleInput }>;
    removes: Array<{ id: string; options: { hard?: boolean } }>;
  };
  entries: Map<string, Schedule>;
  close: () => Promise<void>;
}

function makeSchedule(
  overrides: Partial<Schedule> = {}
): Schedule {
  return {
    id: overrides.id ?? "sch-1",
    scheduleName: overrides.scheduleName ?? "Test mal",
    scheduleNumber: overrides.scheduleNumber ?? "SID_test_1",
    scheduleType: overrides.scheduleType ?? "Manual",
    luckyNumberPrize: overrides.luckyNumberPrize ?? 0,
    status: overrides.status ?? "active",
    isAdminSchedule:
      overrides.isAdminSchedule === undefined ? true : overrides.isAdminSchedule,
    manualStartTime: overrides.manualStartTime ?? "",
    manualEndTime: overrides.manualEndTime ?? "",
    subGames: overrides.subGames ?? [],
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T10:00:00.000Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: Schedule[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const entries = new Map<string, Schedule>();
  for (const s of seed) entries.set(s.id, s);

  const lists: ListScheduleFilter[] = [];
  const creates: CreateScheduleInput[] = [];
  const updates: Array<{ id: string; update: UpdateScheduleInput }> = [];
  const removes: Array<{ id: string; options: { hard?: boolean } }> = [];
  let idCounter = entries.size;

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const scheduleService = {
    async list(filter: ListScheduleFilter) {
      lists.push(filter);
      let rows = Array.from(entries.values()).filter((r) => !r.deletedAt);
      if (filter.scheduleType) {
        rows = rows.filter((r) => r.scheduleType === filter.scheduleType);
      }
      if (filter.status) rows = rows.filter((r) => r.status === filter.status);
      if (filter.search) {
        const s = filter.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.scheduleName.toLowerCase().includes(s) ||
            r.scheduleNumber.toLowerCase().includes(s)
        );
      }
      if (filter.createdBy) {
        if (filter.includeAdminForOwner !== false) {
          rows = rows.filter(
            (r) => r.createdBy === filter.createdBy || r.isAdminSchedule
          );
        } else {
          rows = rows.filter((r) => r.createdBy === filter.createdBy);
        }
      }
      return rows;
    },
    async get(id: string) {
      const row = entries.get(id);
      if (!row) throw new DomainError("SCHEDULE_NOT_FOUND", "not found");
      return row;
    },
    async create(input: CreateScheduleInput) {
      creates.push(input);
      idCounter += 1;
      const id = `sch-${idCounter}`;
      const row: Schedule = makeSchedule({
        id,
        scheduleName: input.scheduleName,
        scheduleNumber: input.scheduleNumber ?? `SID_auto_${idCounter}`,
        scheduleType: input.scheduleType ?? "Manual",
        luckyNumberPrize: input.luckyNumberPrize ?? 0,
        status: input.status ?? "active",
        isAdminSchedule: input.isAdminSchedule ?? true,
        manualStartTime: input.manualStartTime ?? "",
        manualEndTime: input.manualEndTime ?? "",
        subGames: input.subGames ?? [],
        createdBy: input.createdBy,
      });
      entries.set(id, row);
      return row;
    },
    async update(id: string, update: UpdateScheduleInput) {
      updates.push({ id, update });
      const existing = entries.get(id);
      if (!existing) throw new DomainError("SCHEDULE_NOT_FOUND", "not found");
      if (existing.deletedAt)
        throw new DomainError("SCHEDULE_DELETED", "deleted");
      if (update && Object.keys(update).length === 0) {
        throw new DomainError("INVALID_INPUT", "tom");
      }
      const row: Schedule = {
        ...existing,
        ...(update.scheduleName !== undefined && {
          scheduleName: update.scheduleName,
        }),
        ...(update.scheduleType !== undefined && {
          scheduleType: update.scheduleType,
        }),
        ...(update.luckyNumberPrize !== undefined && {
          luckyNumberPrize: update.luckyNumberPrize,
        }),
        ...(update.status !== undefined && { status: update.status }),
        ...(update.manualStartTime !== undefined && {
          manualStartTime: update.manualStartTime,
        }),
        ...(update.manualEndTime !== undefined && {
          manualEndTime: update.manualEndTime,
        }),
        ...(update.subGames !== undefined && { subGames: update.subGames }),
        updatedAt: "2026-04-20T11:00:00.000Z",
      };
      entries.set(id, row);
      return row;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      removes.push({ id, options });
      const existing = entries.get(id);
      if (!existing) throw new DomainError("SCHEDULE_NOT_FOUND", "not found");
      if (existing.deletedAt)
        throw new DomainError("SCHEDULE_DELETED", "deleted");
      if (options.hard && existing.status !== "inactive") {
        throw new DomainError(
          "SCHEDULE_HARD_DELETE_BLOCKED",
          "need inactive"
        );
      }
      if (options.hard) {
        entries.delete(id);
        return { softDeleted: false };
      }
      entries.set(id, {
        ...existing,
        deletedAt: "2026-04-20T12:00:00.000Z",
        status: "inactive",
      });
      return { softDeleted: true };
    },
  } as unknown as ScheduleService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSchedulesRouter({
      platformService,
      auditLogService,
      scheduleService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    spies: { auditStore, lists, creates, updates, removes },
    entries,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function req(
  ctx: Ctx,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── GET /api/admin/schedules (list) ───────────────────────────────────────

test("BIN-625 router: GET list uten token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules");
    // apiFailure mapper alle DomainError → 400 (samme konvensjon som
    // BIN-626 adminDailySchedules). Sjekk error.code for auth-detalj.
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET list som PLAYER → FORBIDDEN", async () => {
  const ctx = await startServer({ "t-pl": playerUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules", "t-pl");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET list som ADMIN returnerer alle", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1" }), makeSchedule({ id: "s2" })]
  );
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules", "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.count, 2);
    assert.equal(res.body.data.schedules.length, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET list som HALL_OPERATOR tillatt", async () => {
  const ctx = await startServer({ "t-op": operatorUser }, [makeSchedule()]);
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules", "t-op");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET list som SUPPORT tillatt", async () => {
  const ctx = await startServer({ "t-sup": supportUser }, [makeSchedule()]);
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules", "t-sup");
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET list med type-filter forwarded", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [
      makeSchedule({ id: "s1", scheduleType: "Auto" }),
      makeSchedule({ id: "s2", scheduleType: "Manual" }),
    ]
  );
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/schedules?type=Auto&search=Test",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.lists.length, 1);
    assert.equal(ctx.spies.lists[0]!.scheduleType, "Auto");
    assert.equal(ctx.spies.lists[0]!.search, "Test");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET list avviser ugyldig scheduleType", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "GET",
      "/api/admin/schedules?type=Hybrid",
      "t-admin"
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── GET /api/admin/schedules/:id ──────────────────────────────────────────

test("BIN-625 router: GET detail finner rad", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1" })]
  );
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules/s1", "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, "s1");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: GET detail ukjent id → 400 (SCHEDULE_NOT_FOUND)", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "GET", "/api/admin/schedules/nope", "t-admin");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "SCHEDULE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── POST /api/admin/schedules ─────────────────────────────────────────────

test("BIN-625 router: POST create krever SCHEDULE_WRITE (PLAYER → FORBIDDEN)", async () => {
  const ctx = await startServer({ "t-pl": playerUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/schedules", "t-pl", {
      scheduleName: "x",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: POST create krever SCHEDULE_WRITE (SUPPORT → FORBIDDEN)", async () => {
  const ctx = await startServer({ "t-sup": supportUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/schedules", "t-sup", {
      scheduleName: "x",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: POST create som ADMIN ok + audit", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/schedules", "t-admin", {
      scheduleName: "Kveldens mal",
      scheduleType: "Manual",
      manualStartTime: "18:00",
      manualEndTime: "20:00",
      luckyNumberPrize: 5000,
      subGames: [{ name: "Elvis", startTime: "18:00", endTime: "18:30" }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.scheduleName, "Kveldens mal");
    assert.equal(res.body.data.scheduleType, "Manual");
    // Admin ordinær flyt setter isAdminSchedule = true
    assert.equal(res.body.data.isAdminSchedule, true);
    // deletedAt er ikke i wire-shape
    assert.equal("deletedAt" in res.body.data, false);
    assert.equal(ctx.spies.creates.length, 1);
    assert.equal(ctx.spies.creates[0]!.createdBy, "admin-1");
    // audit-event skrevet
    const events = await ctx.spies.auditStore.list({});
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.schedule.create");
    assert.equal(events[0]!.actorId, "admin-1");
    assert.equal(events[0]!.resource, "schedule");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: POST create som HALL_OPERATOR ok", async () => {
  const ctx = await startServer({ "t-op": operatorUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/schedules", "t-op", {
      scheduleName: "Operatormal",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isAdminSchedule, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: POST create uten navn → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/schedules", "t-admin", {
      scheduleName: "",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: POST create med ugyldig scheduleType → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "POST", "/api/admin/schedules", "t-admin", {
      scheduleName: "x",
      scheduleType: "Hybrid",
    });
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: POST create med array body → 400", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "POST",
      "/api/admin/schedules",
      "t-admin",
      [1, 2, 3] as unknown as Record<string, unknown>
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// ── PATCH /api/admin/schedules/:id ────────────────────────────────────────

test("BIN-625 router: PATCH oppdaterer felter + audit", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1", scheduleName: "Gammelt" })]
  );
  try {
    const res = await req(ctx, "PATCH", "/api/admin/schedules/s1", "t-admin", {
      scheduleName: "Nytt navn",
      luckyNumberPrize: 1000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.scheduleName, "Nytt navn");
    assert.equal(res.body.data.luckyNumberPrize, 1000);
    assert.equal(ctx.spies.updates.length, 1);
    assert.deepEqual(ctx.spies.updates[0]!.update, {
      scheduleName: "Nytt navn",
      luckyNumberPrize: 1000,
    });
    const events = await ctx.spies.auditStore.list({});
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.schedule.update");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: PATCH krever SCHEDULE_WRITE (SUPPORT → FORBIDDEN)", async () => {
  const ctx = await startServer(
    { "t-sup": supportUser },
    [makeSchedule({ id: "s1" })]
  );
  try {
    const res = await req(ctx, "PATCH", "/api/admin/schedules/s1", "t-sup", {
      scheduleName: "x",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: PATCH med tom body → 400 (ingen endringer)", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1" })]
  );
  try {
    const res = await req(ctx, "PATCH", "/api/admin/schedules/s1", "t-admin", {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: PATCH ukjent id → SCHEDULE_NOT_FOUND", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(
      ctx,
      "PATCH",
      "/api/admin/schedules/nope",
      "t-admin",
      { scheduleName: "x" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "SCHEDULE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── DELETE /api/admin/schedules/:id ───────────────────────────────────────

test("BIN-625 router: DELETE soft-delete default + audit", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1" })]
  );
  try {
    const res = await req(ctx, "DELETE", "/api/admin/schedules/s1", "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.softDeleted, true);
    assert.equal(ctx.spies.removes.length, 1);
    assert.deepEqual(ctx.spies.removes[0]!.options, { hard: false });
    const events = await ctx.spies.auditStore.list({});
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.schedule.delete");
    assert.equal(events[0]!.resourceId, "s1");
    const details = events[0]!.details as Record<string, unknown>;
    assert.equal(details.softDeleted, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: DELETE ?hard=true på inactive gir hard-delete-audit", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1", status: "inactive" })]
  );
  try {
    const res = await req(
      ctx,
      "DELETE",
      "/api/admin/schedules/s1?hard=true",
      "t-admin"
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.softDeleted, false);
    const events = await ctx.spies.auditStore.list({});
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.schedule.hard_delete");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: DELETE ?hard=true på active → 400 BLOCKED", async () => {
  const ctx = await startServer(
    { "t-admin": adminUser },
    [makeSchedule({ id: "s1", status: "active" })]
  );
  try {
    const res = await req(
      ctx,
      "DELETE",
      "/api/admin/schedules/s1?hard=true",
      "t-admin"
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "SCHEDULE_HARD_DELETE_BLOCKED");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: DELETE krever SCHEDULE_WRITE (PLAYER → FORBIDDEN)", async () => {
  const ctx = await startServer(
    { "t-pl": playerUser },
    [makeSchedule({ id: "s1" })]
  );
  try {
    const res = await req(ctx, "DELETE", "/api/admin/schedules/s1", "t-pl");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-625 router: DELETE ukjent id → SCHEDULE_NOT_FOUND", async () => {
  const ctx = await startServer({ "t-admin": adminUser });
  try {
    const res = await req(ctx, "DELETE", "/api/admin/schedules/nope", "t-admin");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "SCHEDULE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
