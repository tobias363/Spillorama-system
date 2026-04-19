/**
 * BIN-591: integration-tester som verifiserer at hall-scope enforcement
 * faktisk er koblet til i paymentRequests-routeren. RBAC-testen i
 * adminPaymentRequests.test.ts dekker roller; denne dekker hall-dimensjonen
 * (HALL_OPERATOR i Hall A kan ikke approve/reject en request i Hall B).
 *
 * Testen starter en ekte express-server lokalt på en tilfeldig port og
 * bruker fetch (Node 18+) mot den.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPaymentRequestsRouter } from "../paymentRequests.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  PaymentRequestService,
  PaymentRequest,
  PaymentRequestKind,
} from "../../payments/PaymentRequestService.js";

function makeUser(
  id: string,
  role: PublicAppUser["role"],
  hallId: string | null
): PublicAppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `wallet-${id}`,
    role,
    hallId,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

function makeRequest(
  id: string,
  hallId: string | null,
  kind: PaymentRequestKind = "deposit"
): PaymentRequest {
  return {
    id,
    kind,
    userId: "player-1",
    walletId: "wallet-player-1",
    amountCents: 1000,
    hallId,
    submittedBy: "player-1",
    status: "PENDING",
    rejectionReason: null,
    acceptedBy: null,
    acceptedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    walletTransactionId: null,
    destinationType: null,
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
  };
}

async function withServer(
  users: Record<string, PublicAppUser>,
  requests: Record<string, PaymentRequest>,
  run: (baseUrl: string, spies: { accepted: string[]; rejected: string[] }) => Promise<void>
): Promise<void> {
  const accepted: string[] = [];
  const rejected: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const user = users[token];
      if (!user) throw new Error("UNAUTHORIZED");
      return user;
    },
  } as unknown as PlatformService;

  const paymentRequestService = {
    async getRequest(_kind: PaymentRequestKind, id: string): Promise<PaymentRequest> {
      const r = requests[id];
      if (!r) throw new Error("NOT_FOUND");
      return r;
    },
    async listPending(options: {
      hallId?: string;
      kind?: PaymentRequestKind;
      status?: string;
      limit?: number;
    }): Promise<PaymentRequest[]> {
      let list = Object.values(requests);
      if (options.hallId) list = list.filter((r) => r.hallId === options.hallId);
      return list;
    },
    async acceptDeposit({ requestId }: { requestId: string }): Promise<PaymentRequest> {
      accepted.push(requestId);
      const r = { ...requests[requestId], status: "ACCEPTED" as const };
      return r;
    },
    async acceptWithdraw({ requestId }: { requestId: string }): Promise<PaymentRequest> {
      accepted.push(requestId);
      return { ...requests[requestId], status: "ACCEPTED" as const };
    },
    async rejectDeposit({ requestId }: { requestId: string }): Promise<PaymentRequest> {
      rejected.push(requestId);
      return { ...requests[requestId], status: "REJECTED" as const };
    },
    async rejectWithdraw({ requestId }: { requestId: string }): Promise<PaymentRequest> {
      rejected.push(requestId);
      return { ...requests[requestId], status: "REJECTED" as const };
    },
  } as unknown as PaymentRequestService;

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentRequestsRouter({
      platformService,
      paymentRequestService,
      emitWalletRoomUpdates: async () => {},
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl, { accepted, rejected });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("BIN-591: HALL_OPERATOR (Hall A) kan approve request i Hall A", async () => {
  const users = {
    "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
  };
  const requests = { "req-1": makeRequest("req-1", "hall-a") };
  await withServer(users, requests, async (baseUrl, spies) => {
    const res = await request(baseUrl, "POST", "/api/admin/payments/requests/req-1/accept", "op-a", {
      type: "deposit",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(spies.accepted, ["req-1"]);
  });
});

test("BIN-591: HALL_OPERATOR (Hall A) kan IKKE approve request i Hall B", async () => {
  const users = {
    "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
  };
  const requests = { "req-2": makeRequest("req-2", "hall-b") };
  await withServer(users, requests, async (baseUrl, spies) => {
    const res = await request(baseUrl, "POST", "/api/admin/payments/requests/req-2/accept", "op-a", {
      type: "deposit",
    });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } })?.error?.code, "FORBIDDEN");
    assert.deepEqual(spies.accepted, []);
  });
});

test("BIN-591: HALL_OPERATOR (Hall A) kan IKKE reject request i Hall B", async () => {
  const users = {
    "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
  };
  const requests = { "req-3": makeRequest("req-3", "hall-b", "withdraw") };
  await withServer(users, requests, async (baseUrl, spies) => {
    const res = await request(baseUrl, "POST", "/api/admin/payments/requests/req-3/reject", "op-a", {
      type: "withdraw",
      reason: "test",
    });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } })?.error?.code, "FORBIDDEN");
    assert.deepEqual(spies.rejected, []);
  });
});

test("BIN-591: ADMIN kan approve på tvers av haller", async () => {
  const users = {
    "admin-1": makeUser("admin-1", "ADMIN", null),
  };
  const requests = {
    "req-4": makeRequest("req-4", "hall-a"),
    "req-5": makeRequest("req-5", "hall-b"),
  };
  await withServer(users, requests, async (baseUrl, spies) => {
    const r4 = await request(baseUrl, "POST", "/api/admin/payments/requests/req-4/accept", "admin-1", {
      type: "deposit",
    });
    const r5 = await request(baseUrl, "POST", "/api/admin/payments/requests/req-5/accept", "admin-1", {
      type: "deposit",
    });
    assert.equal(r4.status, 200);
    assert.equal(r5.status, 200);
    assert.deepEqual(spies.accepted.sort(), ["req-4", "req-5"]);
  });
});

test("BIN-591: HALL_OPERATOR uten tildelt hall får FORBIDDEN (fail closed)", async () => {
  const users = {
    "op-unassigned": makeUser("op-unassigned", "HALL_OPERATOR", null),
  };
  const requests = { "req-6": makeRequest("req-6", "hall-a") };
  await withServer(users, requests, async (baseUrl, spies) => {
    const res = await request(baseUrl, "POST", "/api/admin/payments/requests/req-6/accept", "op-unassigned", {
      type: "deposit",
    });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } })?.error?.code, "FORBIDDEN");
    assert.deepEqual(spies.accepted, []);
  });
});

test("BIN-591: HALL_OPERATOR får FORBIDDEN på request uten hall-binding (fail closed)", async () => {
  const users = {
    "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
  };
  const requests = { "req-7": makeRequest("req-7", null) }; // request uten hallId
  await withServer(users, requests, async (baseUrl, spies) => {
    const res = await request(baseUrl, "POST", "/api/admin/payments/requests/req-7/accept", "op-a", {
      type: "deposit",
    });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } })?.error?.code, "FORBIDDEN");
    assert.deepEqual(spies.accepted, []);
  });
});

test("BIN-591: GET /api/admin/payments/requests filtrerer liste for HALL_OPERATOR", async () => {
  const users = {
    "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
    "admin-1": makeUser("admin-1", "ADMIN", null),
  };
  const requests = {
    "req-a1": makeRequest("req-a1", "hall-a"),
    "req-a2": makeRequest("req-a2", "hall-a"),
    "req-b1": makeRequest("req-b1", "hall-b"),
  };
  await withServer(users, requests, async (baseUrl) => {
    const asOp = await request(baseUrl, "GET", "/api/admin/payments/requests", "op-a");
    assert.equal(asOp.status, 200);
    const opData = (asOp.json as { data: { requests: PaymentRequest[] } }).data;
    assert.equal(opData.requests.length, 2);
    assert.ok(opData.requests.every((r) => r.hallId === "hall-a"));

    const asAdmin = await request(baseUrl, "GET", "/api/admin/payments/requests", "admin-1");
    assert.equal(asAdmin.status, 200);
    const adminData = (asAdmin.json as { data: { requests: PaymentRequest[] } }).data;
    assert.equal(adminData.requests.length, 3);
  });
});

test("BIN-591: HALL_OPERATOR kan IKKE spørre etter en annen halls requests via query-param", async () => {
  const users = {
    "op-a": makeUser("op-a", "HALL_OPERATOR", "hall-a"),
  };
  await withServer(users, {}, async (baseUrl) => {
    const res = await request(
      baseUrl,
      "GET",
      "/api/admin/payments/requests?hallId=hall-b",
      "op-a"
    );
    assert.equal(res.status, 400);
    assert.equal((res.json as { error?: { code?: string } })?.error?.code, "FORBIDDEN");
  });
});
