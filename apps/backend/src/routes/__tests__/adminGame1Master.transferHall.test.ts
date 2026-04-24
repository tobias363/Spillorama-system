/**
 * Task 1.6: integrasjonstester for adminGame1MasterTransfer-router.
 *
 * Dekker:
 *   POST /api/admin/game1/games/:gameId/transfer-master/request
 *   POST /api/admin/game1/master-transfers/:requestId/approve
 *   POST /api/admin/game1/master-transfers/:requestId/reject
 *   GET  /api/admin/game1/games/:gameId/transfer-request
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGame1MasterTransferRouter } from "../adminGame1MasterTransfer.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  Game1TransferHallService,
  TransferRequest,
} from "../../game/Game1TransferHallService.js";
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
const agentAtMaster: PublicAppUser = {
  ...adminUser,
  id: "ag-a",
  role: "AGENT",
  hallId: "hall-a",
};
const agentAtTarget: PublicAppUser = {
  ...adminUser,
  id: "ag-b",
  role: "AGENT",
  hallId: "hall-b",
};
const agentAtOther: PublicAppUser = {
  ...adminUser,
  id: "ag-c",
  role: "AGENT",
  hallId: "hall-c",
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  requestImpl?: Game1TransferHallService["requestTransfer"];
  approveImpl?: Game1TransferHallService["approveTransfer"];
  rejectImpl?: Game1TransferHallService["rejectTransfer"];
  getActiveImpl?: Game1TransferHallService["getActiveRequestForGame"];
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  hooks: {
    requestCreated: TransferRequest[];
    approved: Array<{ request: TransferRequest; previousMasterHallId: string; newMasterHallId: string }>;
    rejected: TransferRequest[];
  };
  serviceCalls: {
    request: Array<Parameters<Game1TransferHallService["requestTransfer"]>[0]>;
    approve: Array<Parameters<Game1TransferHallService["approveTransfer"]>[0]>;
    reject: Array<Parameters<Game1TransferHallService["rejectTransfer"]>[0]>;
    getActive: string[];
  };
}

function sampleRequest(
  overrides: Partial<TransferRequest> = {}
): TransferRequest {
  const now = Date.now();
  return {
    id: "req-1",
    gameId: "g1",
    fromHallId: "hall-a",
    toHallId: "hall-b",
    initiatedByUserId: "ag-a",
    initiatedAt: new Date(now).toISOString(),
    validTill: new Date(now + 60_000).toISOString(),
    status: "pending",
    respondedByUserId: null,
    respondedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };

  const serviceCalls: Ctx["serviceCalls"] = {
    request: [],
    approve: [],
    reject: [],
    getActive: [],
  };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const transferService = {
    async requestTransfer(
      input: Parameters<Game1TransferHallService["requestTransfer"]>[0]
    ) {
      serviceCalls.request.push(input);
      if (opts.requestImpl) return opts.requestImpl(input);
      return sampleRequest({
        fromHallId: input.fromHallId,
        toHallId: input.toHallId,
        initiatedByUserId: input.initiatedByUserId,
      });
    },
    async approveTransfer(
      input: Parameters<Game1TransferHallService["approveTransfer"]>[0]
    ) {
      serviceCalls.approve.push(input);
      if (opts.approveImpl) return opts.approveImpl(input);
      return {
        request: sampleRequest({ id: input.requestId, status: "approved" }),
        previousMasterHallId: "hall-a",
        newMasterHallId: "hall-b",
      };
    },
    async rejectTransfer(
      input: Parameters<Game1TransferHallService["rejectTransfer"]>[0]
    ) {
      serviceCalls.reject.push(input);
      if (opts.rejectImpl) return opts.rejectImpl(input);
      return sampleRequest({
        id: input.requestId,
        status: "rejected",
        rejectReason: input.reason ?? null,
      });
    },
    async getActiveRequestForGame(gameId: string) {
      serviceCalls.getActive.push(gameId);
      if (opts.getActiveImpl) return opts.getActiveImpl(gameId);
      return sampleRequest({ gameId });
    },
  } as unknown as Game1TransferHallService;

  const hooks: Ctx["hooks"] = {
    requestCreated: [],
    approved: [],
    rejected: [],
  };

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGame1MasterTransferRouter({
      platformService,
      transferService,
      broadcastHooks: {
        onRequestCreated: (req) => hooks.requestCreated.push(req),
        onApproved: (p) => hooks.approved.push(p),
        onRejected: (req) => hooks.rejected.push(req),
      },
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    hooks,
    serviceCalls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(
  ctx: Ctx,
  path: string,
  token: string,
  body: unknown
): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function get(ctx: Ctx, path: string, token: string): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── POST /transfer-master/request ───────────────────────────────────────────

test("POST /transfer-master/request — agent ved master-hall → 200 + hook-emit", async () => {
  const ctx = await startServer({ users: { "t-a": agentAtMaster } });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/games/g1/transfer-master/request",
      "t-a",
      { toHallId: "hall-b" }
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: { request: TransferRequest };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.request.toHallId, "hall-b");
    assert.equal(ctx.serviceCalls.request.length, 1);
    assert.equal(ctx.serviceCalls.request[0]!.fromHallId, "hall-a");
    assert.equal(ctx.serviceCalls.request[0]!.initiatedByUserId, "ag-a");
    assert.equal(ctx.hooks.requestCreated.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST /transfer-master/request — SUPPORT → 400 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-s": supportUser } });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/games/g1/transfer-master/request",
      "t-s",
      { toHallId: "hall-b" }
    );
    assert.equal(res.status, 400);
    assert.equal(ctx.serviceCalls.request.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /transfer-master/request — manglende toHallId → 400 INVALID_INPUT", async () => {
  const ctx = await startServer({ users: { "t-a": agentAtMaster } });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/games/g1/transfer-master/request",
      "t-a",
      {}
    );
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("POST /transfer-master/request — service-feil NOT_CURRENT_MASTER → 400 med error.code", async () => {
  const ctx = await startServer({
    users: { "t-a": agentAtOther },
    requestImpl: async () => {
      throw new DomainError("NOT_CURRENT_MASTER", "ikke master");
    },
  });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/games/g1/transfer-master/request",
      "t-a",
      { toHallId: "hall-b" }
    );
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "NOT_CURRENT_MASTER");
  } finally {
    await ctx.close();
  }
});

// ── POST /master-transfers/:requestId/approve ──────────────────────────────

test("POST /master-transfers/:id/approve — agent ved target-hall → 200 + hook", async () => {
  const ctx = await startServer({ users: { "t-b": agentAtTarget } });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/master-transfers/req-1/approve",
      "t-b",
      {}
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: {
        request: TransferRequest;
        previousMasterHallId: string;
        newMasterHallId: string;
      };
    };
    assert.equal(payload.data.newMasterHallId, "hall-b");
    assert.equal(ctx.serviceCalls.approve.length, 1);
    assert.equal(ctx.serviceCalls.approve[0]!.respondedByHallId, "hall-b");
    assert.equal(ctx.hooks.approved.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST /master-transfers/:id/approve — utløpt request propagerer TRANSFER_EXPIRED", async () => {
  const ctx = await startServer({
    users: { "t-b": agentAtTarget },
    approveImpl: async () => {
      throw new DomainError("TRANSFER_EXPIRED", "utløpt");
    },
  });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/master-transfers/req-1/approve",
      "t-b",
      {}
    );
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "TRANSFER_EXPIRED");
  } finally {
    await ctx.close();
  }
});

// ── POST /master-transfers/:requestId/reject ───────────────────────────────

test("POST /master-transfers/:id/reject — med reason → 200", async () => {
  const ctx = await startServer({ users: { "t-b": agentAtTarget } });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/master-transfers/req-1/reject",
      "t-b",
      { reason: "opptatt" }
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { request: TransferRequest };
    };
    assert.equal(payload.data.request.status, "rejected");
    assert.equal(payload.data.request.rejectReason, "opptatt");
    assert.equal(ctx.serviceCalls.reject[0]!.reason, "opptatt");
    assert.equal(ctx.hooks.rejected.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST /master-transfers/:id/reject — uten reason → 200 (reason valgfri)", async () => {
  const ctx = await startServer({ users: { "t-b": agentAtTarget } });
  try {
    const res = await post(
      ctx,
      "/api/admin/game1/master-transfers/req-1/reject",
      "t-b",
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.serviceCalls.reject[0]!.reason, undefined);
  } finally {
    await ctx.close();
  }
});

// ── GET /games/:gameId/transfer-request ────────────────────────────────────

test("GET /games/:gameId/transfer-request — returnerer pending request", async () => {
  const ctx = await startServer({ users: { "t-a": agentAtMaster } });
  try {
    const res = await get(
      ctx,
      "/api/admin/game1/games/g1/transfer-request",
      "t-a"
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: { request: TransferRequest | null };
    };
    assert.equal(payload.ok, true);
    assert.ok(payload.data.request);
    assert.equal(payload.data.request!.gameId, "g1");
  } finally {
    await ctx.close();
  }
});

test("GET /games/:gameId/transfer-request — null når ingen pending", async () => {
  const ctx = await startServer({
    users: { "t-a": agentAtMaster },
    getActiveImpl: async () => null,
  });
  try {
    const res = await get(
      ctx,
      "/api/admin/game1/games/g1/transfer-request",
      "t-a"
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { request: TransferRequest | null };
    };
    assert.equal(payload.data.request, null);
  } finally {
    await ctx.close();
  }
});

test("GET /games/:gameId/transfer-request — PLAYER-rolle → 400 FORBIDDEN", async () => {
  const ctx = await startServer({
    users: {
      "t-p": { ...adminUser, id: "p-1", role: "PLAYER", hallId: null },
    },
  });
  try {
    const res = await get(
      ctx,
      "/api/admin/game1/games/g1/transfer-request",
      "t-p"
    );
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});
