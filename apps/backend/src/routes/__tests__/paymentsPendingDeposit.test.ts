/**
 * REQ-137 — Pending-deposit reminder endpoint tester.
 *
 * Verifiserer:
 *   - GET /api/payments/pending-deposit returnerer åpne intents for innlogget bruker
 *   - POST /api/payments/pending-deposit/:intentId/reminded stamper last_reminded_at
 *   - Endepunktene krever Bearer-auth (UNAUTHORIZED hvis token mangler)
 */

import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { createPaymentsRouter } from "../payments.js";
import type { SwedbankTopupIntent } from "../../payments/SwedbankPayService.js";
import { DomainError } from "../../game/BingoEngine.js";

// platformService-mock kaster DomainError så toPublicError mapper koden
// til UNAUTHORIZED (samme oppførsel som ekte PlatformService).

const FAKE_TOKEN = "test-token-alice";
const ALICE_USER_ID = "user-alice";
const ALICE_WALLET_ID = "wallet-alice";

interface ListCall {
  userId: string;
}

interface RemindCall {
  intentId: string;
  userId: string;
}

interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
  pendingByUser: Map<string, SwedbankTopupIntent[]>;
  remindCalls: RemindCall[];
  listCalls: ListCall[];
  remindedReturn: boolean;
}

function makeIntent(overrides: Partial<SwedbankTopupIntent> = {}): SwedbankTopupIntent {
  return {
    id: "intent-1",
    provider: "swedbankpay",
    userId: ALICE_USER_ID,
    walletId: ALICE_WALLET_ID,
    orderReference: "TOPUP-ABC",
    payeeReference: "TP-XYZ",
    paymentOrderId: "/psp/paymentorders/abc",
    amountMajor: 250,
    amountMinor: 25000,
    currency: "NOK",
    status: "INITIALIZED",
    redirectUrl: "https://swedbank.example/checkout/abc",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildHarness(): Promise<TestHarness> {
  const pendingByUser = new Map<string, SwedbankTopupIntent[]>();
  const remindCalls: RemindCall[] = [];
  const listCalls: ListCall[] = [];
  const harness: Partial<TestHarness> = {
    pendingByUser,
    remindCalls,
    listCalls,
    remindedReturn: true,
  };

  const swedbankPayService = {
    listPendingIntentsForUser: async (userId: string) => {
      listCalls.push({ userId });
      return pendingByUser.get(userId) ?? [];
    },
    markIntentReminded: async (intentId: string, userId: string) => {
      remindCalls.push({ intentId, userId });
      return harness.remindedReturn ?? true;
    },
  };

  // Minimal platformService som validerer Bearer-token mot FAKE_TOKEN.
  const platformService = {
    getUserFromAccessToken: async (token: string) => {
      if (token !== FAKE_TOKEN) {
        throw new DomainError("UNAUTHORIZED", "Ugyldig token.");
      }
      return {
        id: ALICE_USER_ID,
        walletId: ALICE_WALLET_ID,
        email: "alice@example.com",
        displayName: "Alice",
        role: "PLAYER",
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentsRouter({
      platformService: platformService as never,
      swedbankPayService: swedbankPayService as never,
      emitWalletRoomUpdates: async () => {},
      swedbankWebhookSecret: "unused-here",
    }),
  );

  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      Object.assign(harness, {
        baseUrl: `http://localhost:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
      resolve(harness as TestHarness);
    });
  });
}

async function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function postJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { method: "POST", headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe("REQ-137 GET /api/payments/pending-deposit", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("returnerer åpne intents for innlogget bruker", async () => {
    const a = makeIntent({ id: "intent-A", amountMajor: 100, amountMinor: 10000 });
    const b = makeIntent({ id: "intent-B", amountMajor: 250, amountMinor: 25000 });
    harness.pendingByUser.set(ALICE_USER_ID, [b, a]);

    const res = await getJson(`${harness.baseUrl}/api/payments/pending-deposit`, {
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });

    assert.equal(res.status, 200);
    const payload = res.body as { ok: boolean; data: { intents: SwedbankTopupIntent[] } };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.intents.length, 2);
    assert.equal(payload.data.intents[0].id, "intent-B");
    assert.equal(payload.data.intents[1].id, "intent-A");
    assert.equal(harness.listCalls.length, 1);
    assert.equal(harness.listCalls[0].userId, ALICE_USER_ID);
  });

  test("tom liste når ingen pending intents finnes", async () => {
    const res = await getJson(`${harness.baseUrl}/api/payments/pending-deposit`, {
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });

    assert.equal(res.status, 200);
    const payload = res.body as { ok: boolean; data: { intents: unknown[] } };
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data.intents, []);
  });

  test("krever Bearer-auth — uten Authorization-header gir 400 UNAUTHORIZED", async () => {
    const res = await getJson(`${harness.baseUrl}/api/payments/pending-deposit`);

    assert.equal(res.status, 400);
    const payload = res.body as { ok: boolean; error: { code: string } };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "UNAUTHORIZED");
    // listPendingIntentsForUser skal ikke kalles uten gyldig auth
    assert.equal(harness.listCalls.length, 0);
  });
});

describe("REQ-137 POST /api/payments/pending-deposit/:intentId/reminded", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("stamper last_reminded_at og returnerer reminded:true", async () => {
    const res = await postJson(
      `${harness.baseUrl}/api/payments/pending-deposit/intent-XYZ/reminded`,
      { Authorization: `Bearer ${FAKE_TOKEN}` },
    );

    assert.equal(res.status, 200);
    const payload = res.body as { ok: boolean; data: { reminded: boolean } };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.reminded, true);
    assert.equal(harness.remindCalls.length, 1);
    assert.equal(harness.remindCalls[0].intentId, "intent-XYZ");
    assert.equal(harness.remindCalls[0].userId, ALICE_USER_ID);
  });
});
