/**
 * BIN-665: integrasjonstester for admin-hall-groups-router.
 *
 * Dekker alle 5 endepunkter:
 *   GET    /api/admin/hall-groups
 *   GET    /api/admin/hall-groups/:id
 *   POST   /api/admin/hall-groups
 *   PATCH  /api/admin/hall-groups/:id
 *   DELETE /api/admin/hall-groups/:id
 *
 * Testene bygger en stub-HallGroupService rundt et in-memory Map — samme
 * mønster som adminPatterns.test.ts (BIN-627) + adminGameManagement.test.ts
 * (BIN-622).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminHallGroupsRouter } from "../adminHallGroups.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  HallGroupService,
  HallGroup,
  HallGroupMember,
  CreateHallGroupInput,
  UpdateHallGroupInput,
  ListHallGroupFilter,
} from "../../admin/HallGroupService.js";
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
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    creates: HallGroup[];
    updates: Array<{ id: string; changed: string[] }>;
    removes: Array<{ id: string; hard: boolean }>;
  };
  groups: Map<string, HallGroup>;
  halls: Map<string, { id: string; name: string; status: string }>;
  close: () => Promise<void>;
}

function makeMember(hallId: string, name = `Hall ${hallId}`): HallGroupMember {
  return {
    hallId,
    hallName: name,
    hallStatus: "active",
    addedAt: "2026-04-15T10:00:00Z",
  };
}

function makeGroup(
  overrides: Partial<HallGroup> & { id: string; name: string }
): HallGroup {
  return {
    id: overrides.id,
    legacyGroupHallId: overrides.legacyGroupHallId ?? `GH_${overrides.id}`,
    name: overrides.name,
    status: overrides.status ?? "active",
    tvId: overrides.tvId ?? null,
    productIds: overrides.productIds ?? [],
    members: overrides.members ?? [],
    extra: overrides.extra ?? {},
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: HallGroup[] = [],
  seedHalls: Array<{ id: string; name: string; status?: string }> = [
    { id: "hall-1", name: "Hall 1" },
    { id: "hall-2", name: "Hall 2" },
    { id: "hall-3", name: "Hall 3" },
  ]
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const groups = new Map<string, HallGroup>();
  for (const g of seed) groups.set(g.id, g);
  const halls = new Map<string, { id: string; name: string; status: string }>();
  for (const h of seedHalls) halls.set(h.id, { id: h.id, name: h.name, status: h.status ?? "active" });

  const creates: HallGroup[] = [];
  const updates: Ctx["spies"]["updates"] = [];
  const removes: Ctx["spies"]["removes"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  function checkHalls(hallIds: string[]): void {
    const missing = hallIds.filter((id) => !halls.has(id));
    if (missing.length > 0) {
      throw new DomainError(
        "HALL_NOT_FOUND",
        `Hall-id(s) finnes ikke: ${missing.join(", ")}`
      );
    }
  }

  function toMembers(hallIds: string[]): HallGroupMember[] {
    return hallIds.map((id) => {
      const h = halls.get(id)!;
      return {
        hallId: h.id,
        hallName: h.name,
        hallStatus: h.status,
        addedAt: new Date().toISOString(),
      };
    });
  }

  let idCounter = groups.size;
  const hallGroupService = {
    async list(filter: ListHallGroupFilter = {}) {
      let list = [...groups.values()].filter((g) => !g.deletedAt);
      if (filter.status) list = list.filter((g) => g.status === filter.status);
      if (filter.hallId)
        list = list.filter((g) => g.members.some((m) => m.hallId === filter.hallId));
      if (filter.limit) list = list.slice(0, filter.limit);
      return list;
    },
    async get(id: string) {
      const g = groups.get(id);
      if (!g) throw new DomainError("HALL_GROUP_NOT_FOUND", "not found");
      return g;
    },
    async create(input: CreateHallGroupInput) {
      for (const g of groups.values()) {
        if (!g.deletedAt && g.name === input.name) {
          throw new DomainError(
            "HALL_GROUP_DUPLICATE_NAME",
            `duplicate name ${input.name}`
          );
        }
      }
      if (input.hallIds && input.hallIds.length > 0) {
        checkHalls(input.hallIds);
      }
      idCounter += 1;
      const id = `hg-${idCounter}`;
      const next = makeGroup({
        id,
        name: input.name,
        status: input.status ?? "active",
        tvId: input.tvId ?? null,
        productIds: input.productIds ?? [],
        members: toMembers(input.hallIds ?? []),
        extra: input.extra ?? {},
        createdBy: input.createdBy,
        legacyGroupHallId: input.legacyGroupHallId ?? `GH_${id}`,
      });
      groups.set(id, next);
      creates.push(next);
      return next;
    },
    async update(id: string, update: UpdateHallGroupInput) {
      const g = groups.get(id);
      if (!g) throw new DomainError("HALL_GROUP_NOT_FOUND", "not found");
      if (g.deletedAt) throw new DomainError("HALL_GROUP_DELETED", "deleted");
      if (update.hallIds !== undefined && update.hallIds.length > 0) {
        checkHalls(update.hallIds);
      }
      updates.push({ id, changed: Object.keys(update) });
      const next: HallGroup = { ...g };
      if (update.name !== undefined) {
        for (const other of groups.values()) {
          if (
            other.id !== id &&
            !other.deletedAt &&
            other.name === update.name
          ) {
            throw new DomainError(
              "HALL_GROUP_DUPLICATE_NAME",
              `duplicate name ${update.name}`
            );
          }
        }
        next.name = update.name;
      }
      if (update.status !== undefined) next.status = update.status;
      if (update.tvId !== undefined) next.tvId = update.tvId;
      if (update.productIds !== undefined) next.productIds = update.productIds;
      if (update.extra !== undefined) next.extra = update.extra;
      if (update.hallIds !== undefined) next.members = toMembers(update.hallIds);
      next.updatedAt = new Date().toISOString();
      groups.set(id, next);
      return next;
    },
    async remove(id: string, options: { hard?: boolean } = {}) {
      const g = groups.get(id);
      if (!g) throw new DomainError("HALL_GROUP_NOT_FOUND", "not found");
      if (g.deletedAt) throw new DomainError("HALL_GROUP_DELETED", "already deleted");
      removes.push({ id, hard: Boolean(options.hard) });
      if (options.hard) {
        groups.delete(id);
        return { softDeleted: false };
      }
      groups.set(id, {
        ...g,
        deletedAt: new Date().toISOString(),
        status: "inactive",
      });
      return { softDeleted: true };
    },
    async count(): Promise<number> {
      return [...groups.values()].filter((g) => !g.deletedAt).length;
    },
  } as unknown as HallGroupService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminHallGroupsRouter({
      platformService,
      auditLogService,
      hallGroupService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, creates, updates, removes },
    groups,
    halls,
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

// ── RBAC ─────────────────────────────────────────────────────────────────────

test("BIN-665: PLAYER blokkert fra alle hall-group-endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/hall-groups", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "pl-tok", {
      name: "Test",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser }, [
    makeGroup({ id: "hg-1", name: "Østlandet" }),
  ]);
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/hall-groups", "sup-tok");
    assert.equal(list.status, 200);

    const detail = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/hall-groups/hg-1",
      "sup-tok"
    );
    assert.equal(detail.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "sup-tok", {
      name: "Nope",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "sup-tok",
      { name: "Blocked" }
    );
    assert.equal(patch.status, 400);
    assert.equal(patch.json.error.code, "FORBIDDEN");

    const del = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/hall-groups/hg-1",
      "sup-tok"
    );
    assert.equal(del.status, 400);
    assert.equal(del.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: HALL_OPERATOR kan både READ og WRITE", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const list = await req(ctx.baseUrl, "GET", "/api/admin/hall-groups", "op-tok");
    assert.equal(list.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "op-tok", {
      name: "Hall-operator-grupp",
      hallIds: ["hall-1"],
    });
    assert.equal(post.status, 200);
    assert.equal(post.json.data.name, "Hall-operator-grupp");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/hall-groups");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET list ─────────────────────────────────────────────────────────────────

test("BIN-665: GET list returnerer alle grupper uten filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A" }),
    makeGroup({ id: "hg-2", name: "B" }),
    makeGroup({ id: "hg-3", name: "C", status: "inactive" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/hall-groups", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 3);
    assert.equal(res.json.data.groups.length, 3);
  } finally {
    await ctx.close();
  }
});

test("BIN-665: GET list med status-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A", status: "active" }),
    makeGroup({ id: "hg-2", name: "B", status: "inactive" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/hall-groups?status=active",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.groups[0].id, "hg-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: GET list med hallId-filter", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({
      id: "hg-1",
      name: "With hall-1",
      members: [makeMember("hall-1")],
    }),
    makeGroup({
      id: "hg-2",
      name: "With hall-2",
      members: [makeMember("hall-2")],
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/hall-groups?hallId=hall-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.groups[0].id, "hg-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: GET list avviser ugyldig status", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/hall-groups?status=deleted",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: GET list skjuler deletedAt fra wire-shape", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/hall-groups", "admin-tok");
    assert.equal(res.status, 200);
    for (const g of res.json.data.groups) {
      assert.equal("deletedAt" in g, false, "deletedAt skal ikke eksponeres");
    }
  } finally {
    await ctx.close();
  }
});

// ── GET detail ───────────────────────────────────────────────────────────────

test("BIN-665: GET detail returnerer enkelt gruppe", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({
      id: "hg-1",
      name: "Østlandet",
      members: [makeMember("hall-1"), makeMember("hall-2")],
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/hall-groups/hg-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Østlandet");
    assert.equal(res.json.data.members.length, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-665: GET detail 404 for ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/hall-groups/unknown",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_GROUP_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── POST create ──────────────────────────────────────────────────────────────

test("BIN-665: POST oppretter ny gruppe + emitter audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "admin-tok", {
      name: "Sørlandet",
      hallIds: ["hall-1", "hall-2"],
      tvId: 7,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "Sørlandet");
    assert.equal(res.json.data.members.length, 2);
    assert.equal(res.json.data.tvId, 7);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.hall_group.created"
    );
    assert.ok(evt, "created-audit skal finnes");
    assert.equal(evt!.resource, "hall_group");
    assert.equal(evt!.resourceId, res.json.data.id);
    assert.equal((evt!.details as { memberCount: number }).memberCount, 2);
  } finally {
    await ctx.close();
  }
});

test("BIN-665: POST avviser duplikat navn", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "Duplicate" }),
  ]);
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "admin-tok", {
      name: "Duplicate",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_GROUP_DUPLICATE_NAME");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: POST avviser ukjent hallId", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "admin-tok", {
      name: "Bad halls",
      hallIds: ["hall-1", "hall-999"],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: POST avviser tom navn", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "admin-tok", {
      name: "",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: POST uten payload-objekt avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/admin/hall-groups", "admin-tok", [
      "not",
      "an",
      "object",
    ]);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── PATCH update ─────────────────────────────────────────────────────────────

test("BIN-665: PATCH oppdaterer navn + emitter updated-audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "Old name" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { name: "New name" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.name, "New name");

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.hall_group.updated"
    );
    assert.ok(evt, "updated-audit skal finnes");
    assert.deepEqual(
      (evt!.details as { changed: string[] }).changed,
      ["name"]
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH med hallIds emitter members_changed-audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({
      id: "hg-1",
      name: "Østlandet",
      members: [makeMember("hall-1")],
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { hallIds: ["hall-2", "hall-3"] }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.members.length, 2);
    assert.deepEqual(
      res.json.data.members.map((m: { hallId: string }) => m.hallId).sort(),
      ["hall-2", "hall-3"]
    );

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.hall_group.members_changed"
    );
    assert.ok(evt, "members_changed-audit skal finnes");
    const details = evt!.details as {
      previousMemberCount: number;
      memberCount: number;
      previousHallIds: string[];
      hallIds: string[];
    };
    assert.equal(details.previousMemberCount, 1);
    assert.equal(details.memberCount, 2);
    assert.deepEqual(details.previousHallIds, ["hall-1"]);
    assert.deepEqual(details.hallIds.sort(), ["hall-2", "hall-3"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH med tomt hallIds[] fjerner alle medlemmer", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({
      id: "hg-1",
      name: "Will be empty",
      members: [makeMember("hall-1"), makeMember("hall-2")],
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { hallIds: [] }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.members.length, 0);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.hall_group.members_changed"
    );
    assert.ok(evt, "members_changed-audit skal finnes også ved tømming");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH avviser ukjent hallId", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { hallIds: ["hall-doesnt-exist"] }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH 404 for ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/unknown",
      "admin-tok",
      { name: "X" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_GROUP_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH av navn til duplikat avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A" }),
    makeGroup({ id: "hg-2", name: "B" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { name: "B" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_GROUP_DUPLICATE_NAME");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH av status til inactive går greit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A", status: "active" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { status: "inactive" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "inactive");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: PATCH av tvId til null tilbakestiller TV-id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "A", tvId: 7 }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/hall-groups/hg-1",
      "admin-tok",
      { tvId: null }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tvId, null);
  } finally {
    await ctx.close();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test("BIN-665: DELETE default = soft-delete + emitter soft_deleted-audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "Gone" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/hall-groups/hg-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, true);

    const evt = await waitForAudit(
      ctx.spies.auditStore,
      "admin.hall_group.soft_deleted"
    );
    assert.ok(evt, "soft_deleted-audit skal finnes");
    const details = evt!.details as { softDeleted: boolean; name: string };
    assert.equal(details.softDeleted, true);
    assert.equal(details.name, "Gone");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: DELETE ?hard=true hard-sletter + emitter deleted-audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({ id: "hg-1", name: "Hard delete" }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/hall-groups/hg-1?hard=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.softDeleted, false);
    assert.equal(ctx.groups.size, 0, "gruppen skal være fjernet fra store");

    const evt = await waitForAudit(ctx.spies.auditStore, "admin.hall_group.deleted");
    assert.ok(evt, "deleted-audit skal finnes");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: DELETE 404 for ukjent id", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/hall-groups/unknown",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_GROUP_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: DELETE av allerede soft-slettet avvises", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [
    makeGroup({
      id: "hg-1",
      name: "Already gone",
      deletedAt: "2026-04-01T00:00:00Z",
    }),
  ]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/hall-groups/hg-1",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_GROUP_DELETED");
  } finally {
    await ctx.close();
  }
});

test("BIN-665: POST + PATCH-members + DELETE round-trip emitter 3 audit-events", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const create = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/hall-groups",
      "admin-tok",
      { name: "Round trip", hallIds: ["hall-1"] }
    );
    assert.equal(create.status, 200);
    const id = create.json.data.id as string;

    const patch = await req(
      ctx.baseUrl,
      "PATCH",
      `/api/admin/hall-groups/${id}`,
      "admin-tok",
      { hallIds: ["hall-1", "hall-2"] }
    );
    assert.equal(patch.status, 200);

    const del = await req(
      ctx.baseUrl,
      "DELETE",
      `/api/admin/hall-groups/${id}`,
      "admin-tok"
    );
    assert.equal(del.status, 200);

    // Vent til alle tre audit-events er skrevet.
    await waitForAudit(ctx.spies.auditStore, "admin.hall_group.soft_deleted");
    const events = await ctx.spies.auditStore.list();
    const actions = events.map((e) => e.action).sort();
    assert.deepEqual(
      actions,
      [
        "admin.hall_group.created",
        "admin.hall_group.members_changed",
        "admin.hall_group.soft_deleted",
      ].sort()
    );
  } finally {
    await ctx.close();
  }
});
