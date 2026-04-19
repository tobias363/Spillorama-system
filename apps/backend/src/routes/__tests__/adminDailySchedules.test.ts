/**
 * BIN-626: integrasjonstester for admin-daily-schedules-router.
 *
 * Dekker alle 6 endepunkter:
 *   GET    /api/admin/daily-schedules
 *   GET    /api/admin/daily-schedules/:id
 *   GET    /api/admin/daily-schedules/:id/details
 *   POST   /api/admin/daily-schedules
 *   POST   /api/admin/daily-schedules/special
 *   PATCH  /api/admin/daily-schedules/:id
 *   DELETE /api/admin/daily-schedules/:id
 *
 * Testene bygger en stub-DailyScheduleService rundt et in-memory Map, samme
 * pattern som adminGameManagement.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminDailySchedulesRouter } from "../adminDailySchedules.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  DailyScheduleService,
  DailySchedule,
  CreateDailyScheduleInput,
  UpdateDailyScheduleInput,
  ListDailyScheduleFilter,
} from "../../admin/DailyScheduleService.js";
import type {
  GameManagementService,
  GameManagement,
} from "../../admin/GameManagementService.js";
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
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const otherOperatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-2",
  role: "HALL_OPERATOR",
  hallId: "hall-b",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    creates: DailySchedule[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
  };
  rows: Map<string, DailySchedule>;
  gms: Map<string, GameManagement>;
  close: () => Promise<void>;
}

function makeRow(overrides: Partial<DailySchedule> & { id: string }): DailySchedule {
  return {
    id: overrides.id,
    name: overrides.name ?? `Plan ${overrides.id}`,
    gameManagementId: overrides.gameManagementId ?? null,
    hallId: overrides.hallId ?? null,
    hallIds: overrides.hallIds ?? {},
    weekDays: overrides.weekDays ?? 0,
    day: overrides.day ?? null,
    startDate: overrides.startDate ?? "2026-05-01T10:00:00Z",
    endDate: overrides.endDate ?? null,
    startTime: overrides.startTime ?? "",
    endTime: overrides.endTime ?? "",
    status: overrides.status ?? "active",
    stopGame: overrides.stopGame ?? false,
    specialGame: overrides.specialGame ?? false,
    isSavedGame: overrides.isSavedGame ?? false,
    isAdminSavedGame: overrides.isAdminSavedGame ?? false,
    innsatsenSales: overrides.innsatsenSales ?? 0,
    subgames: overrides.subgames ?? [],
    otherData: overrides.otherData ?? {},
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

function makeGm(id: string, overrides: Partial<GameManagement> = {}): GameManagement {
  return {
    id,
    gameTypeId: overrides.gameTypeId ?? "bingo",
    parentId: overrides.parentId ?? null,
    name: overrides.name ?? `GM ${id}`,
    ticketType: overrides.ticketType ?? "Large",
    ticketPrice: overrides.ticketPrice ?? 1000,
    startDate: overrides.startDate ?? "2026-05-01T10:00:00Z",
    endDate: overrides.endDate ?? null,
    status: overrides.status ?? "active",
    totalSold: overrides.totalSold ?? 0,
    totalEarning: overrides.totalEarning ?? 0,
    config: overrides.config ?? {},
    repeatedFromId: overrides.repeatedFromId ?? null,
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: DailySchedule[] = [],
  gmSeed: GameManagement[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const rows = new Map<string, DailySchedule>();
  for (const r of seed) rows.set(r.id, r);
  const gms = new Map<string, GameManagement>();
  for (const g of gmSeed) gms.set(g.id, g);

  const creates: DailySchedule[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let idCounter = rows.size;
  const svcImpl = {
    async list(filter: ListDailyScheduleFilter = {}) {
      let list = [...rows.values()].filter((r) => !r.deletedAt);
      if (filter.gameManagementId)
        list = list.filter((r) => r.gameManagementId === filter.gameManagementId);
      if (filter.hallId) list = list.filter((r) => r.hallId === filter.hallId);
      if (filter.weekDaysMask !== undefined) {
        list = list.filter((r) => (r.weekDays & filter.weekDaysMask!) !== 0);
      }
      if (filter.status) list = list.filter((r) => r.status === filter.status);
      if (filter.specialGame !== undefined)
        list = list.filter((r) => r.specialGame === filter.specialGame);
      if (filter.fromDate) {
        const cutoff = Date.parse(filter.fromDate);
        list = list.filter((r) => Date.parse(r.startDate) >= cutoff);
      }
      if (filter.toDate) {
        const cutoff = Date.parse(filter.toDate);
        list = list.filter((r) => Date.parse(r.startDate) <= cutoff);
      }
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const r = rows.get(id);
      if (!r) throw new DomainError("DAILY_SCHEDULE_NOT_FOUND", "not found");
      return r;
    },
    async create(input: CreateDailyScheduleInput) {
      idCounter += 1;
      const id = `ds-${idCounter}`;
      const row = makeRow({
        id,
        name: input.name,
        gameManagementId: input.gameManagementId ?? null,
        hallId: input.hallId ?? null,
        hallIds: input.hallIds ?? {},
        weekDays: input.weekDays ?? 0,
        day: input.day ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        startTime: input.startTime ?? "",
        endTime: input.endTime ?? "",
        status: input.status ?? "active",
        stopGame: input.stopGame ?? false,
        specialGame: input.specialGame ?? false,
        isSavedGame: input.isSavedGame ?? false,
        isAdminSavedGame: input.isAdminSavedGame ?? false,
        subgames: input.subgames ?? [],
        otherData: input.otherData ?? {},
        createdBy: input.createdBy,
      });
      rows.set(id, row);
      creates.push(row);
      return row;
    },
    async createSpecial(input: CreateDailyScheduleInput) {
      return svcImpl.create({ ...input, specialGame: true });
    },
    async update(id: string, update: UpdateDailyScheduleInput) {
      const r = rows.get(id);
      if (!r) throw new DomainError("DAILY_SCHEDULE_NOT_FOUND", "not found");
      updates.push({ id, changed: Object.keys(update) });
      const next: DailySchedule = { ...r };
      if (update.name !== undefined) next.name = update.name;
      if (update.gameManagementId !== undefined)
        next.gameManagementId = update.gameManagementId;
      if (update.hallId !== undefined) next.hallId = update.hallId;
      if (update.hallIds !== undefined) next.hallIds = update.hallIds;
      if (update.weekDays !== undefined) next.weekDays = update.weekDays;
      if (update.day !== undefined) next.day = update.day;
      if (update.startDate !== undefined) next.startDate = update.startDate;
      if (update.endDate !== undefined) next.endDate = update.endDate;
      if (update.startTime !== undefined) next.startTime = update.startTime;
      if (update.endTime !== undefined) next.endTime = update.endTime;
      if (update.status !== undefined) next.status = update.status;
      if (update.stopGame !== undefined) next.stopGame = update.stopGame;
      if (update.specialGame !== undefined) next.specialGame = update.specialGame;
      if (update.isSavedGame !== undefined) next.isSavedGame = update.isSavedGame;
      if (update.isAdminSavedGame !== undefined)
        next.isAdminSavedGame = update.isAdminSavedGame;
      if (update.innsatsenSales !== undefined)
        next.innsatsenSales = update.innsatsenSales;
      if (update.subgames !== undefined) next.subgames = update.subgames;
      if (update.otherData !== undefined) next.otherData = update.otherData;
      next.updatedAt = new Date().toISOString();
      rows.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const r = rows.get(id);
      if (!r) throw new DomainError("DAILY_SCHEDULE_NOT_FOUND", "not found");
      removes.push({ id, hard: Boolean(options.hard) });
      const canHard =
        options.hard &&
        r.innsatsenSales === 0 &&
        (r.status === "active" || r.status === "inactive");
      if (canHard) {
        rows.delete(id);
        return { softDeleted: false };
      }
      rows.set(id, {
        ...r,
        deletedAt: new Date().toISOString(),
        status: "inactive",
      });
      return { softDeleted: true };
    },
  };
  const dailyScheduleService = svcImpl as unknown as DailyScheduleService;

  const gameManagementService = {
    async get(id: string) {
      const g = gms.get(id);
      if (!g) throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      return g;
    },
  } as unknown as GameManagementService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminDailySchedulesRouter({
      platformService,
      auditLogService,
      dailyScheduleService,
      gameManagementService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    rows,
    gms,
    close: () => new Promise((resolve) => server.close(() => resolve())),
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

// ── RBAC tests ───────────────────────────────────────────────────────────────

test("BIN-626: PLAYER blokkert fra alle daily-schedule-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "pl-tok", {
      name: "Test",
      startDate: "2026-05-01T10:00:00Z",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeRow({ id: "ds-1" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules", "sup-tok");
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules/ds-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "sup-tok", {
      name: "Test",
      startDate: "2026-05-01T10:00:00Z",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const del = await req(ctx.baseUrl, "DELETE", "/api/admin/daily-schedules/ds-1", "sup-tok");
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");

    const special = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/daily-schedules/special",
      "sup-tok",
      { name: "Spesial", startDate: "2026-05-01T10:00:00Z" }
    );
    assert.equal(special.status, 400);
    assert.equal(special.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: HALL_OPERATOR kan både READ og WRITE i egen hall", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "op-tok", {
      name: "Hall-lokal plan",
      startDate: "2026-05-01T10:00:00Z",
      hallId: "hall-a",
    });
    assert.equal(post.status, 200);
    assert.equal(post.json.data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: HALL_OPERATOR kan IKKE opprette plan i annen hall", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "op-tok", {
      name: "X",
      startDate: "2026-05-01T10:00:00Z",
      hallId: "hall-b",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: HALL_OPERATOR uten hallId i body får sin hall automatisk bundet", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "op-tok", {
      name: "Auto-hall plan",
      startDate: "2026-05-01T10:00:00Z",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: HALL_OPERATOR kan ikke se andre hallers detalj", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser },
    [makeRow({ id: "ds-1", hallId: "hall-b" })]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules/ds-1", "op-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: HALL_OPERATOR ser multi-hall-plan når hans hall er i hallIds.hallIds", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser },
    [
      makeRow({
        id: "ds-1",
        hallId: null,
        hallIds: { hallIds: ["hall-a", "hall-c"] },
      }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules/ds-1", "op-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "ds-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: HALL_OPERATOR list filtreres til egen hall også for multi-hall", async () => {
  const ctx = await startServer(
    { "op-tok": operatorUser },
    [
      makeRow({ id: "ds-1", hallId: "hall-a" }),
      makeRow({ id: "ds-2", hallId: "hall-b" }),
      makeRow({
        id: "ds-3",
        hallId: null,
        hallIds: { masterHallId: "hall-c", hallIds: ["hall-a"] },
      }),
      makeRow({
        id: "ds-4",
        hallId: null,
        hallIds: { hallIds: ["hall-b", "hall-c"] },
      }),
    ]
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules", "op-tok");
    assert.equal(res.status, 200);
    const ids = (res.json.data.schedules as Array<{ id: string }>).map((r) => r.id).sort();
    assert.deepEqual(ids, ["ds-1", "ds-3"]);
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-626: GET list returnerer alle planer uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1" }),
    makeRow({ id: "ds-2", status: "finish" }),
    makeRow({ id: "ds-3", specialGame: true }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med gameManagementId-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", gameManagementId: "gm-1" }),
    makeRow({ id: "ds-2", gameManagementId: "gm-2" }),
    makeRow({ id: "ds-3", gameManagementId: "gm-1" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?gameManagementId=gm-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med hallId-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", hallId: "hall-a" }),
    makeRow({ id: "ds-2", hallId: "hall-b" }),
    makeRow({ id: "ds-3", hallId: "hall-a" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?hallId=hall-a",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med weekDays bitmask-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-mon", weekDays: 1 }),
    makeRow({ id: "ds-tue", weekDays: 2 }),
    makeRow({ id: "ds-mon-wed", weekDays: 5 }), // 1|4
  ]);
  try {
    // Spørr etter mon (1): match ds-mon + ds-mon-wed
    const mon = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?weekDays=1",
      "admin-tok"
    );
    assert.equal(mon.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med specialGame=true-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", specialGame: false }),
    makeRow({ id: "ds-2", specialGame: true }),
    makeRow({ id: "ds-3", specialGame: true }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?specialGame=true",
      "admin-tok"
    );
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med dato-range-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", startDate: "2026-05-01T10:00:00Z" }),
    makeRow({ id: "ds-2", startDate: "2026-05-10T10:00:00Z" }),
    makeRow({ id: "ds-3", startDate: "2026-05-20T10:00:00Z" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?fromDate=2026-05-05T00:00:00Z&toDate=2026-05-15T23:59:59Z",
      "admin-tok"
    );
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.schedules[0].id, "ds-2");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med ugyldig status → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?status=banana",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list med ugyldig weekDays → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules?weekDays=999",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET list eksponerer ikke deletedAt i wire-shape", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeRow({ id: "ds-1" })]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules", "admin-tok");
    const row = res.json.data.schedules[0];
    assert.equal(row.deletedAt, undefined);
    assert.equal(row.id, "ds-1");
  } finally {
    await ctx.close();
  }
});

// ── GET detail ──────────────────────────────────────────────────────────────

test("BIN-626: GET detail returnerer full rad", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", name: "Mandag morgen" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules/ds-1", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "ds-1");
    assert.equal(res.json.data.name, "Mandag morgen");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET detail ukjent id → NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/daily-schedules/ds-xx", "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "DAILY_SCHEDULE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── GET /:id/details ────────────────────────────────────────────────────────

test("BIN-626: GET /:id/details returnerer schedule + subgames + embedded GM", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [
      makeRow({
        id: "ds-1",
        gameManagementId: "gm-1",
        subgames: [{ index: 0, ticketPrice: 500 }, { index: 1, ticketPrice: 1000 }],
      }),
    ],
    [makeGm("gm-1", { name: "Morning Bingo", ticketType: "Large", ticketPrice: 1500 })]
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules/ds-1/details",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.schedule.id, "ds-1");
    assert.equal(res.json.data.subgames.length, 2);
    assert.equal(res.json.data.gameManagement.id, "gm-1");
    assert.equal(res.json.data.gameManagement.name, "Morning Bingo");
    assert.equal(res.json.data.gameManagement.ticketPrice, 1500);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET /:id/details med manglende GM soft-failer til null", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeRow({ id: "ds-1", gameManagementId: "gm-dead" })]
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules/ds-1/details",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.schedule.id, "ds-1");
    assert.equal(res.json.data.gameManagement, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: GET /:id/details uten gameManagementId embedder ikke GM", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    [makeRow({ id: "ds-1", gameManagementId: null })]
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/daily-schedules/ds-1/details",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.gameManagement, null);
  } finally {
    await ctx.close();
  }
});

// ── POST create ──────────────────────────────────────────────────────────────

test("BIN-626: POST oppretter rad + audit admin.daily_schedule.created", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "admin-tok", {
      name: "Lørdag kveld",
      gameManagementId: "gm-1",
      hallId: "hall-a",
      weekDays: 32,
      startDate: "2026-05-02T18:00:00Z",
      startTime: "18:00",
      endTime: "22:00",
      status: "active",
      subgames: [{ index: 0, ticketPrice: 500 }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Lørdag kveld");
    assert.equal(res.json.data.weekDays, 32);
    assert.equal(ctx.spies.creates.length, 1);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.daily_schedule.created");
    assert.ok(event);
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "daily_schedule");
    assert.equal(event!.details.hallId, "hall-a");
    assert.equal(event!.details.weekDays, 32);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: POST validerer required fields", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r1 = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "admin-tok", {});
    assert.equal(r1.status, 400);
    assert.equal(r1.json.error.code, "INVALID_INPUT");

    const r2 = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "admin-tok", {
      name: "X",
    });
    assert.equal(r2.status, 400);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: POST avviser hallIds som array", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/daily-schedules", "admin-tok", {
      name: "X",
      startDate: "2026-05-01T10:00:00Z",
      hallIds: ["invalid"],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── POST /special ───────────────────────────────────────────────────────────

test("BIN-626: POST /special setter specialGame=true + audit special_created", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/daily-schedules/special",
      "admin-tok",
      {
        name: "Juleaften",
        startDate: "2026-12-24T10:00:00Z",
        hallId: "hall-a",
        specialGame: false, // skal overstyres av ruten
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.specialGame, true);

    const event = await waitForAudit(
      ctx.spies.auditStore,
      "admin.daily_schedule.special_created"
    );
    assert.ok(event);
    assert.equal(event!.resource, "daily_schedule");
  } finally {
    await ctx.close();
  }
});

// ── PATCH update ────────────────────────────────────────────────────────────

test("BIN-626: PATCH endrer felter + audit changed-liste", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", status: "active", name: "Old" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/daily-schedules/ds-1",
      "admin-tok",
      {
        name: "New name",
        status: "running",
        weekDays: 64,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "New name");
    assert.equal(res.json.data.status, "running");

    assert.deepEqual(
      ctx.spies.updates[0]!.changed.sort(),
      ["name", "status", "weekDays"]
    );

    const event = await waitForAudit(ctx.spies.auditStore, "admin.daily_schedule.updated");
    assert.ok(event);
    assert.equal(event!.details.newStatus, "running");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: PATCH ukjent id → NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/daily-schedules/ds-xx",
      "admin-tok",
      { name: "X" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "DAILY_SCHEDULE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-626: PATCH kan oppdatere subgames-array", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", subgames: [] }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/daily-schedules/ds-1",
      "admin-tok",
      {
        subgames: [
          { index: 0, ticketPrice: 500, prizePool: 5000 },
          { index: 1, ticketPrice: 1000, prizePool: 10000 },
        ],
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.subgames.length, 2);
    assert.equal(res.json.data.subgames[1].ticketPrice, 1000);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: PATCH nekter HALL_OPERATOR i annen hall", async () => {
  const ctx = await startServer(
    { "op-tok": otherOperatorUser },
    [makeRow({ id: "ds-1", hallId: "hall-a" })]
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/daily-schedules/ds-1",
      "op-tok",
      { name: "hack" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-626: DELETE soft-delete default + audit soft_deleted", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", innsatsenSales: 50000, status: "running" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/daily-schedules/ds-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);

    const event = await waitForAudit(
      ctx.spies.auditStore,
      "admin.daily_schedule.soft_deleted"
    );
    assert.ok(event);
    assert.equal(event!.details.softDeleted, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: DELETE ?hard=true for ubrukt rad + audit deleted", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", innsatsenSales: 0, status: "active" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/daily-schedules/ds-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.daily_schedule.deleted");
    assert.ok(event);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: DELETE ?hard=true men har innsatsen → fallback til soft-delete", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeRow({ id: "ds-1", innsatsenSales: 10000, status: "active" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/daily-schedules/ds-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-626: DELETE nekter HALL_OPERATOR i annen hall", async () => {
  const ctx = await startServer(
    { "op-tok": otherOperatorUser },
    [makeRow({ id: "ds-1", hallId: "hall-a" })]
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/daily-schedules/ds-1",
      "op-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});
