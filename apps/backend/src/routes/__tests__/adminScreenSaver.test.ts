/**
 * GAP #23: integrasjonstester for admin-screen-saver-router.
 *
 * Full Express round-trip med stub av ScreenSaverService, PlatformService
 * og ekte InMemoryAuditLogStore. Dekker:
 *   - RBAC (ADMIN/SUPPORT/HALL_OPERATOR/PLAYER)
 *   - GET list + filter (hallId, activeOnly)
 *   - POST/PUT/DELETE + audit-events
 *   - Reorder (single + batch)
 *   - Validation-error-paths (ugyldig URL, ugyldig sec, ukjent id)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminScreenSaverRouter } from "../adminScreenSaver.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  ScreenSaverService,
  ScreenSaverImage,
  CreateScreenSaverImageInput,
  UpdateScreenSaverImageInput,
  ReorderEntry,
} from "../../admin/ScreenSaverService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

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

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    createCalls: CreateScreenSaverImageInput[];
    updateCalls: Array<{ id: string; update: UpdateScreenSaverImageInput }>;
    deleteCalls: string[];
    reorderCalls: ReorderEntry[][];
  };
  store: Map<string, ScreenSaverImage>;
  close: () => Promise<void>;
}

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: ScreenSaverImage[] = []
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const store = new Map<string, ScreenSaverImage>();
  for (const img of seed) store.set(img.id, img);
  const createCalls: CreateScreenSaverImageInput[] = [];
  const updateCalls: Array<{ id: string; update: UpdateScreenSaverImageInput }> = [];
  const deleteCalls: string[] = [];
  const reorderCalls: ReorderEntry[][] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  let nextId = seed.length + 1;

  const screenSaverService = {
    async list(filter?: { hallId?: string | null; activeOnly?: boolean; includeDeleted?: boolean }) {
      const all = [...store.values()];
      return all
        .filter((img) => (filter?.includeDeleted ? true : img.deletedAt === null))
        .filter((img) => {
          if (filter?.hallId === null) return img.hallId === null;
          if (typeof filter?.hallId === "string") return img.hallId === filter.hallId;
          return true;
        })
        .filter((img) => (filter?.activeOnly ? img.isActive : true))
        .sort((a, b) => a.displayOrder - b.displayOrder);
    },
    async get(id: string) {
      const img = store.get(id);
      if (!img) throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", "not found");
      return img;
    },
    async create(input: CreateScreenSaverImageInput) {
      // Match service-validation
      if (!input.imageUrl || !isValidHttpUrl(input.imageUrl)) {
        throw new DomainError("INVALID_IMAGE_URL", "bad url");
      }
      if (input.displaySeconds !== undefined) {
        if (!Number.isInteger(input.displaySeconds) || input.displaySeconds < 1 || input.displaySeconds > 300) {
          throw new DomainError("INVALID_INPUT", "bad sec");
        }
      }
      createCalls.push(input);
      const id = `ss-${nextId}`;
      nextId += 1;
      const img: ScreenSaverImage = {
        id,
        hallId: input.hallId ?? null,
        imageUrl: input.imageUrl,
        displayOrder: input.displayOrder ?? 0,
        displaySeconds: input.displaySeconds ?? 10,
        isActive: input.isActive ?? true,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      store.set(id, img);
      return img;
    },
    async update(id: string, update: UpdateScreenSaverImageInput) {
      const img = store.get(id);
      if (!img) throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", "not found");
      if (img.deletedAt) {
        throw new DomainError("SCREEN_SAVER_IMAGE_DELETED", "deleted");
      }
      if (update.imageUrl !== undefined && !isValidHttpUrl(update.imageUrl)) {
        throw new DomainError("INVALID_IMAGE_URL", "bad url");
      }
      if (update.displaySeconds !== undefined) {
        if (!Number.isInteger(update.displaySeconds) || update.displaySeconds < 1 || update.displaySeconds > 300) {
          throw new DomainError("INVALID_INPUT", "bad sec");
        }
      }
      updateCalls.push({ id, update });
      const next: ScreenSaverImage = {
        ...img,
        ...(update.imageUrl !== undefined ? { imageUrl: update.imageUrl } : {}),
        ...(update.displayOrder !== undefined ? { displayOrder: update.displayOrder } : {}),
        ...(update.displaySeconds !== undefined ? { displaySeconds: update.displaySeconds } : {}),
        ...(update.isActive !== undefined ? { isActive: update.isActive } : {}),
        updatedAt: new Date().toISOString(),
      };
      store.set(id, next);
      return next;
    },
    async remove(id: string) {
      const img = store.get(id);
      if (!img) throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", "not found");
      if (img.deletedAt) {
        // Already deleted — re-find returns NOT_FOUND per service contract.
        throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", "not found");
      }
      deleteCalls.push(id);
      store.set(id, { ...img, deletedAt: new Date().toISOString(), isActive: false });
    },
    async reorder(entries: ReorderEntry[]) {
      // Match validation
      const seen = new Set<string>();
      for (const e of entries) {
        if (!e.id || seen.has(e.id)) {
          throw new DomainError("INVALID_INPUT", "bad");
        }
        seen.add(e.id);
        if (!Number.isInteger(e.displayOrder) || e.displayOrder < 0) {
          throw new DomainError("INVALID_INPUT", "bad order");
        }
      }
      // Validate existence
      for (const e of entries) {
        const img = store.get(e.id);
        if (!img || img.deletedAt) {
          throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", `${e.id}`);
        }
      }
      reorderCalls.push(entries);
      const updated: ScreenSaverImage[] = [];
      for (const e of entries) {
        const img = store.get(e.id)!;
        const next = { ...img, displayOrder: e.displayOrder, updatedAt: new Date().toISOString() };
        store.set(e.id, next);
        updated.push(next);
      }
      return updated.sort((a, b) => a.displayOrder - b.displayOrder);
    },
    async getCarouselForHall() {
      return [];
    },
  } as unknown as ScreenSaverService;

  const app = express();
  app.use(express.json());
  app.use(createAdminScreenSaverRouter({ platformService, auditLogService, screenSaverService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, createCalls, updateCalls, deleteCalls, reorderCalls },
    store,
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

function makeImage(overrides: Partial<ScreenSaverImage> = {}): ScreenSaverImage {
  return {
    id: "ss-1",
    hallId: null,
    imageUrl: "https://cdn.example.com/screen1.png",
    displayOrder: 0,
    displaySeconds: 10,
    isActive: true,
    createdBy: "admin-1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

// ── RBAC ────────────────────────────────────────────────────────────────

test("GAP-23 route: PLAYER blokkert fra alle endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/settings/screen-saver", "pl-tok");
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const post = await req(ctx.baseUrl, "POST", "/api/admin/settings/screen-saver", "pl-tok", {
      imageUrl: "https://cdn.example.com/x.png",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/settings/screen-saver", "sup-tok");
    assert.equal(get.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/settings/screen-saver", "sup-tok", {
      imageUrl: "https://cdn.example.com/x.png",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: HALL_OPERATOR kan READ men ikke WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const get = await req(ctx.baseUrl, "GET", "/api/admin/settings/screen-saver", "op-tok");
    assert.equal(get.status, 200);

    const post = await req(ctx.baseUrl, "POST", "/api/admin/settings/screen-saver", "op-tok", {
      imageUrl: "https://cdn.example.com/x.png",
    });
    assert.equal(post.status, 400);
    assert.equal(post.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/settings/screen-saver");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET list ────────────────────────────────────────────────────────────

test("GAP-23 route: GET liste returnerer alle bilder for ADMIN", async () => {
  const seed = [
    makeImage({ id: "ss-1", displayOrder: 0 }),
    makeImage({ id: "ss-2", displayOrder: 1, hallId: "hall-a" }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, seed);
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/settings/screen-saver", "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.images.length, 2);
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: GET med ?hallId=hall-a returnerer kun den hall'en", async () => {
  const seed = [
    makeImage({ id: "ss-1", hallId: null }),
    makeImage({ id: "ss-2", hallId: "hall-a" }),
    makeImage({ id: "ss-3", hallId: "hall-b" }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, seed);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings/screen-saver?hallId=hall-a",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.images[0].id, "ss-2");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: GET med ?hallId=null returnerer kun globale", async () => {
  const seed = [
    makeImage({ id: "ss-1", hallId: null }),
    makeImage({ id: "ss-2", hallId: "hall-a" }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, seed);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings/screen-saver?hallId=null",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.images[0].hallId, null);
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: GET ?activeOnly=true filtrerer bort inaktive", async () => {
  const seed = [
    makeImage({ id: "ss-1", isActive: true }),
    makeImage({ id: "ss-2", isActive: false }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, seed);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings/screen-saver?activeOnly=true",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.count, 1);
    assert.equal(res.json.data.images[0].id, "ss-1");
  } finally {
    await ctx.close();
  }
});

// ── GET one ────────────────────────────────────────────────────────────

test("GAP-23 route: GET /:id returnerer bilde", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeImage()]);
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings/screen-saver/ss-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "ss-1");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: GET /:id ukjent gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/settings/screen-saver/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SCREEN_SAVER_IMAGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── POST ────────────────────────────────────────────────────────────────

test("GAP-23 route: POST oppretter bilde + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/settings/screen-saver",
      "admin-tok",
      {
        imageUrl: "https://cdn.example.com/screen1.png",
        displaySeconds: 15,
        displayOrder: 0,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.imageUrl, "https://cdn.example.com/screen1.png");
    assert.equal(res.json.data.displaySeconds, 15);
    assert.equal(ctx.spies.createCalls.length, 1);
    assert.equal(ctx.spies.createCalls[0]!.createdBy, "admin-1");

    const event = await waitForAudit(ctx.spies.auditStore, "admin.screen_saver.create");
    assert.ok(event, "audit-event må logges");
    assert.equal(event!.actorType, "ADMIN");
    assert.equal(event!.resource, "screen_saver_image");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: POST avviser ugyldig URL (ftp)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/settings/screen-saver",
      "admin-tok",
      { imageUrl: "ftp://example.com/x.png" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_IMAGE_URL");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: POST avviser displaySeconds=0", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/settings/screen-saver",
      "admin-tok",
      {
        imageUrl: "https://cdn.example.com/x.png",
        displaySeconds: 0,
      }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: POST avviser tom imageUrl", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/settings/screen-saver",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: POST hallId=null eksplisitt blir lagret som global", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/settings/screen-saver",
      "admin-tok",
      {
        imageUrl: "https://cdn.example.com/x.png",
        hallId: null,
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallId, null);
  } finally {
    await ctx.close();
  }
});

// ── PUT (update) ────────────────────────────────────────────────────────

test("GAP-23 route: PUT /:id oppdaterer felter + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeImage()]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/ss-1",
      "admin-tok",
      { displaySeconds: 25, isActive: false }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.displaySeconds, 25);
    assert.equal(res.json.data.isActive, false);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.screen_saver.update");
    assert.ok(event);
    assert.deepEqual(
      ((event!.details as { changedFields: string[] }).changedFields).sort(),
      ["displaySeconds", "isActive"].sort()
    );
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: PUT /:id avviser ugyldig displaySeconds", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeImage()]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/ss-1",
      "admin-tok",
      { displaySeconds: 999 }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── DELETE ──────────────────────────────────────────────────────────────

test("GAP-23 route: DELETE /:id soft-deleter + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeImage()]);
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/settings/screen-saver/ss-1",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.deleted, true);
    assert.equal(ctx.spies.deleteCalls.length, 1);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.screen_saver.delete");
    assert.ok(event);
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: DELETE ukjent gir NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/settings/screen-saver/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SCREEN_SAVER_IMAGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── Reorder ─────────────────────────────────────────────────────────────

test("GAP-23 route: PUT /:id/order endrer display_order + audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeImage({ displayOrder: 0 })]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/ss-1/order",
      "admin-tok",
      { displayOrder: 5 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.images.length, 1);
    assert.equal(res.json.data.images[0].displayOrder, 5);

    const event = await waitForAudit(ctx.spies.auditStore, "admin.screen_saver.reorder");
    assert.ok(event);
    assert.equal((event!.details as { batch: boolean }).batch, false);
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: PUT /order batch reorder", async () => {
  const seed = [
    makeImage({ id: "ss-1", displayOrder: 0 }),
    makeImage({ id: "ss-2", displayOrder: 1 }),
    makeImage({ id: "ss-3", displayOrder: 2 }),
  ];
  const ctx = await startServer({ "admin-tok": adminUser }, seed);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/order",
      "admin-tok",
      {
        entries: [
          { id: "ss-1", displayOrder: 2 },
          { id: "ss-2", displayOrder: 0 },
          { id: "ss-3", displayOrder: 1 },
        ],
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.images.length, 3);
    // Sortert etter display_order
    assert.equal(res.json.data.images[0].id, "ss-2");
    assert.equal(res.json.data.images[1].id, "ss-3");
    assert.equal(res.json.data.images[2].id, "ss-1");

    const event = await waitForAudit(ctx.spies.auditStore, "admin.screen_saver.reorder");
    assert.ok(event);
    assert.equal((event!.details as { batch: boolean }).batch, true);
    assert.equal((event!.details as { count: number }).count, 3);
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: PUT /order avviser tom entries", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/order",
      "admin-tok",
      { entries: [] }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: PUT /order avviser duplikat-id", async () => {
  const seed = [makeImage({ id: "ss-1" })];
  const ctx = await startServer({ "admin-tok": adminUser }, seed);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/order",
      "admin-tok",
      {
        entries: [
          { id: "ss-1", displayOrder: 0 },
          { id: "ss-1", displayOrder: 1 },
        ],
      }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP-23 route: PUT /:id/order avviser uten displayOrder", async () => {
  const ctx = await startServer({ "admin-tok": adminUser }, [makeImage()]);
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/settings/screen-saver/ss-1/order",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
