/**
 * HIGH-11: tests for /api/admin/chat/messages*.
 *
 * Dekker:
 *   - GET liste returnerer meldinger (ADMIN)
 *   - GET hall-scope: HALL_OPERATOR ser kun egen hall (forced filter)
 *   - GET filter på roomCode + search ILIKE
 *   - POST delete soft-deletes + audit-log entry
 *   - POST delete: HALL_OPERATOR fra annen hall får FORBIDDEN
 *   - POST delete: PLAYER får FORBIDDEN (mangler CHAT_MODERATION_WRITE)
 *   - POST delete: tom reason → INVALID_INPUT
 *   - POST delete: ukjent id → CHAT_MESSAGE_NOT_FOUND
 *   - Sletting maskerer melding for andre spillere (`listRecent`)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminChatModerationRouter } from "../adminChatModeration.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import {
  InMemoryChatMessageStore,
  CHAT_MESSAGE_DELETED_PLACEHOLDER,
} from "../../store/ChatMessageStore.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(
  role: PublicAppUser["role"],
  opts: { id?: string; hallId?: string | null } = {}
): PublicAppUser {
  const id = opts.id ?? `u-${role.toLowerCase()}`;
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `w-${id}`,
    role,
    hallId: opts.hallId ?? null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

interface Ctx {
  baseUrl: string;
  chatStore: InMemoryChatMessageStore;
  auditStore: InMemoryAuditLogStore;
  close: () => Promise<void>;
}

async function startServer(users: Record<string, PublicAppUser>): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const chatStore = new InMemoryChatMessageStore();

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const router = createAdminChatModerationRouter({
    platformService,
    auditLogService,
    chatMessageStore: chatStore,
  });
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    chatStore,
    auditStore,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface ApiResponse<T = unknown> {
  status: number;
  body: { ok: boolean; data?: T; error?: { code: string; message: string } };
}

async function getList(
  ctx: Ctx,
  token: string,
  query = ""
): Promise<
  ApiResponse<{
    messages: Array<{
      id: string;
      hallId: string;
      roomCode: string;
      message: string;
      deletedAt: string | null;
    }>;
    total: number;
  }>
> {
  const res = await fetch(`${ctx.baseUrl}/api/admin/chat/messages${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as never };
}

async function postDelete(
  ctx: Ctx,
  token: string,
  id: string,
  reason: unknown
): Promise<
  ApiResponse<{
    message: { id: string; deletedAt: string | null; deleteReason: string | null };
    wasAlreadyDeleted: boolean;
  }>
> {
  const res = await fetch(
    `${ctx.baseUrl}/api/admin/chat/messages/${encodeURIComponent(id)}/delete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    }
  );
  return { status: res.status, body: (await res.json()) as never };
}

async function seedMessages(ctx: Ctx): Promise<void> {
  await ctx.chatStore.insert({
    hallId: "hall-1",
    roomCode: "ROOM-A",
    playerId: "p-alice",
    playerName: "Alice",
    message: "hei alle sammen",
    emojiId: 0,
  });
  await ctx.chatStore.insert({
    hallId: "hall-1",
    roomCode: "ROOM-A",
    playerId: "p-bob",
    playerName: "Bob",
    message: "send penger til min konto 123",
    emojiId: 0,
  });
  await ctx.chatStore.insert({
    hallId: "hall-2",
    roomCode: "ROOM-B",
    playerId: "p-carol",
    playerName: "Carol",
    message: "lykke til!",
    emojiId: 0,
  });
}

// ── GET-tester ──────────────────────────────────────────────────────────────

test("HIGH-11: ADMIN lister alle meldinger på tvers av haller", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    await seedMessages(ctx);
    const res = await getList(ctx, "t-admin");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data!.messages.length, 3);
    assert.equal(res.body.data!.total, 3);
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: HALL_OPERATOR ser kun egen hall (hall-scope force-filter)", async () => {
  const ctx = await startServer({
    "t-op-h1": makeUser("HALL_OPERATOR", { id: "op1", hallId: "hall-1" }),
  });
  try {
    await seedMessages(ctx);
    // Forsøk å filtrere på hall-2 — skal gi FORBIDDEN.
    const cross = await getList(ctx, "t-op-h1", "?hallId=hall-2");
    assert.equal(cross.status, 400);
    assert.equal(cross.body.error?.code, "FORBIDDEN");

    // Uten eksplisitt filter → tvinges til egen hall.
    const own = await getList(ctx, "t-op-h1");
    assert.equal(own.status, 200);
    assert.equal(own.body.data!.messages.length, 2);
    for (const m of own.body.data!.messages) {
      assert.equal(m.hallId, "hall-1");
    }
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: GET med roomCode + search ILIKE", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    await seedMessages(ctx);
    const byRoom = await getList(ctx, "t-admin", "?roomCode=ROOM-A");
    assert.equal(byRoom.status, 200);
    assert.equal(byRoom.body.data!.messages.length, 2);
    for (const m of byRoom.body.data!.messages) {
      assert.equal(m.roomCode, "ROOM-A");
    }

    // Søke etter "konto" → kun Bob's hvitvasking-melding.
    const bySearch = await getList(ctx, "t-admin", "?search=konto");
    assert.equal(bySearch.body.data!.messages.length, 1);
    assert.match(bySearch.body.data!.messages[0]!.message, /konto/);
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: SUPPORT har read-tilgang men PLAYER får FORBIDDEN", async () => {
  const ctx = await startServer({
    "t-sup": makeUser("SUPPORT", { id: "s1" }),
    "t-player": makeUser("PLAYER", { id: "pl1" }),
  });
  try {
    const sup = await getList(ctx, "t-sup");
    assert.equal(sup.status, 200);
    assert.equal(sup.body.ok, true);

    const pl = await getList(ctx, "t-player");
    assert.equal(pl.status, 400);
    assert.equal(pl.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── DELETE-tester ───────────────────────────────────────────────────────────

test("HIGH-11: ADMIN soft-deletes + skriver audit + maskerer for andre spillere", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN", { id: "admin-1" }) });
  try {
    await seedMessages(ctx);
    // Find Bob's message (ROOM-A).
    const list = await getList(ctx, "t-admin", "?roomCode=ROOM-A");
    const target = list.body.data!.messages.find((m) =>
      m.message.includes("konto")
    )!;

    const del = await postDelete(
      ctx,
      "t-admin",
      target.id,
      "Mistanke om hvitvasking — konto-deling"
    );
    assert.equal(del.status, 200);
    assert.equal(del.body.ok, true);
    assert.notEqual(del.body.data!.message.deletedAt, null);
    assert.equal(
      del.body.data!.message.deleteReason,
      "Mistanke om hvitvasking — konto-deling"
    );
    assert.equal(del.body.data!.wasAlreadyDeleted, false);

    // Audit-log skal ha en `admin.chat.delete` med originalmelding + reason.
    const events = await ctx.auditStore.list({ resource: "chat_message" });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.chat.delete");
    assert.equal(events[0]!.actorId, "admin-1");
    assert.equal(
      (events[0]!.details as Record<string, unknown>).originalMessage,
      "send penger til min konto 123"
    );
    assert.equal(
      (events[0]!.details as Record<string, unknown>).reason,
      "Mistanke om hvitvasking — konto-deling"
    );

    // Andre spillere skal nå se placeholder via listRecent.
    const recent = await ctx.chatStore.listRecent("ROOM-A");
    const masked = recent.find((m) => m.id === target.id)!;
    assert.equal(masked.message, CHAT_MESSAGE_DELETED_PLACEHOLDER);
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: HALL_OPERATOR kan ikke slette i annen hall (FORBIDDEN)", async () => {
  const ctx = await startServer({
    "t-op-h1": makeUser("HALL_OPERATOR", { id: "op1", hallId: "hall-1" }),
    "t-admin": makeUser("ADMIN"),
  });
  try {
    await seedMessages(ctx);
    // Find Carol's hall-2 message via admin.
    const list = await getList(ctx, "t-admin", "?hallId=hall-2");
    const target = list.body.data!.messages[0]!;

    const del = await postDelete(ctx, "t-op-h1", target.id, "ikke OK innhold");
    assert.equal(del.status, 400);
    assert.equal(del.body.error?.code, "FORBIDDEN");

    // Verifiser at meldingen IKKE ble slettet.
    const stillThere = await ctx.chatStore.getById(target.id);
    assert.equal(stillThere?.deletedAt, null);
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: SUPPORT mangler CHAT_MODERATION_WRITE — kan ikke slette", async () => {
  const ctx = await startServer({
    "t-sup": makeUser("SUPPORT", { id: "s1" }),
    "t-admin": makeUser("ADMIN"),
  });
  try {
    await seedMessages(ctx);
    const list = await getList(ctx, "t-admin");
    const target = list.body.data!.messages[0]!;

    const del = await postDelete(ctx, "t-sup", target.id, "test sletting");
    assert.equal(del.status, 400);
    assert.equal(del.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: tom reason → INVALID_INPUT", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    await seedMessages(ctx);
    const list = await getList(ctx, "t-admin");
    const target = list.body.data!.messages[0]!;

    // Tom string.
    const empty = await postDelete(ctx, "t-admin", target.id, "");
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error?.code, "INVALID_INPUT");

    // For kort.
    const tooShort = await postDelete(ctx, "t-admin", target.id, "hi");
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: ukjent id → CHAT_MESSAGE_NOT_FOUND", async () => {
  const ctx = await startServer({ "t-admin": makeUser("ADMIN") });
  try {
    const del = await postDelete(
      ctx,
      "t-admin",
      "999999",
      "test sletting av ukjent id"
    );
    assert.equal(del.status, 400);
    assert.equal(del.body.error?.code, "CHAT_MESSAGE_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("HIGH-11: re-sletting er idempotent + flagger wasAlreadyDeleted", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN", { id: "admin-1" }),
    "t-admin2": makeUser("ADMIN", { id: "admin-2" }),
  });
  try {
    await seedMessages(ctx);
    const list = await getList(ctx, "t-admin");
    const target = list.body.data!.messages[0]!;

    const first = await postDelete(ctx, "t-admin", target.id, "første sletting");
    assert.equal(first.body.data!.wasAlreadyDeleted, false);
    const firstAt = first.body.data!.message.deletedAt;
    assert.notEqual(firstAt, null);

    // Andre admin sletter samme melding.
    const second = await postDelete(ctx, "t-admin2", target.id, "andre forsøk");
    assert.equal(second.status, 200);
    assert.equal(second.body.data!.wasAlreadyDeleted, true);
    // Første moderator beholder eierskapet (deleted_by/reason endres ikke).
    assert.equal(second.body.data!.message.deletedAt, firstAt);
    assert.equal(second.body.data!.message.deleteReason, "første sletting");
  } finally {
    await ctx.close();
  }
});
