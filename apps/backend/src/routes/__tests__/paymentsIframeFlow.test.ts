/**
 * BIN-GAP-#7/#8/#9: Integration tests for the player-app payment glue:
 *
 *   GET  /api/payments/swedbank/iframe/:intentId        — iframe-host wrap
 *   GET  /api/payments/swedbank/deposit/response        — Swedbank → user redirect
 *   POST /api/payments/swedbank/goback                  — native-app deeplink
 *
 * These three endpoints close the legacy `payment/iframe`,
 * `payment/deposit/response`, and `payment/goback` gaps from
 * `BACKEND_1TO1_GAP_AUDIT_2026-04-24.md` §1.4.
 *
 * SwedbankPayService is fully mocked — the live API is never touched. We
 * assert on:
 *   - HTTP status codes
 *   - Content-Security-Policy headers
 *   - HTML body shape (no full DOM-parser; substring + regex)
 *   - post-message envelope embedded in the inline `<script>`
 *   - audit-log writes
 *   - wallet-room broadcasts (deposit/response only)
 */

import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { createPaymentsRouter, type PaymentsRouterDeps } from "../payments.js";
import type {
  SwedbankReconcileResult,
  SwedbankTopupIntent,
} from "../../payments/SwedbankPayService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface AuditCall {
  actorId: string | null;
  actorType: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details?: Record<string, unknown>;
}

interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
  emittedWalletIds: string[];
  auditCalls: AuditCall[];
  iframeSetIntents: SwedbankTopupIntent[];
  setIntentForUser: (intent: SwedbankTopupIntent) => void;
  setIntentById: (intent: SwedbankTopupIntent) => void;
  setReconcileResult: (intentId: string, result: SwedbankReconcileResult) => void;
  setUser: (token: string, user: { id: string; walletId: string }) => void;
}

function buildIntent(overrides: Partial<SwedbankTopupIntent> = {}): SwedbankTopupIntent {
  return {
    id: overrides.id ?? "intent-uuid-1",
    provider: "swedbankpay",
    userId: overrides.userId ?? "user-alice",
    walletId: overrides.walletId ?? "wallet-alice",
    orderReference: overrides.orderReference ?? "TOPUP-ORDER-1",
    payeeReference: overrides.payeeReference ?? "TP-1",
    paymentOrderId: overrides.paymentOrderId ?? "/psp/paymentorders/abc",
    amountMajor: overrides.amountMajor ?? 250,
    amountMinor: overrides.amountMinor ?? 25_000,
    currency: overrides.currency ?? "NOK",
    status: overrides.status ?? "PAID",
    redirectUrl: overrides.redirectUrl ?? "https://api.externalintegration.payex.com/checkout/redirect/abc",
    viewUrl: overrides.viewUrl ?? "https://api.externalintegration.payex.com/checkout/view/abc",
    creditedTransactionId: overrides.creditedTransactionId,
    creditedAt: overrides.creditedAt,
    lastError: overrides.lastError,
    createdAt: overrides.createdAt ?? "2026-04-25T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-25T10:00:01.000Z",
  };
}

function buildHarness(): Promise<TestHarness> {
  const emittedWalletIds: string[] = [];
  const auditCalls: AuditCall[] = [];
  const iframeSetIntents: SwedbankTopupIntent[] = [];
  const intentsByUser: Map<string, SwedbankTopupIntent> = new Map();
  const intentsById: Map<string, SwedbankTopupIntent> = new Map();
  const reconcileMap: Map<string, SwedbankReconcileResult> = new Map();
  const userByToken: Map<string, { id: string; walletId: string }> = new Map();

  // Default user for ergonomic tests
  userByToken.set("user-alice-token", { id: "user-alice", walletId: "wallet-alice" });
  userByToken.set("user-mallory-token", { id: "user-mallory", walletId: "wallet-mallory" });

  const swedbankPayService = {
    async getIntentForUser(intentId: string, userId: string): Promise<SwedbankTopupIntent> {
      const key = `${intentId}::${userId}`;
      const intent = intentsByUser.get(key);
      if (!intent) {
        throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke Swedbank intent for bruker.");
      }
      return intent;
    },
    async getIntentById(intentId: string): Promise<SwedbankTopupIntent> {
      const intent = intentsById.get(intentId);
      if (!intent) {
        throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke Swedbank intent.");
      }
      return intent;
    },
    async reconcileIntentById(intentId: string): Promise<SwedbankReconcileResult> {
      const result = reconcileMap.get(intentId);
      if (!result) {
        throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke Swedbank intent.");
      }
      return result;
    },
    // never used in these tests
    createTopupIntent: async () => {
      throw new Error("not used");
    },
    reconcileIntentForUser: async () => {
      throw new Error("not used");
    },
    processCallback: async () => {
      throw new Error("not used");
    },
    isConfigured: () => true,
  };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const user = userByToken.get(token);
      if (!user) {
        throw new DomainError("UNAUTHORIZED", "Ugyldig token.");
      }
      return { ...user, role: "user", username: "alice", nickname: "alice" };
    },
  } as never;

  const auditLogService = {
    async record(input: AuditCall) {
      auditCalls.push(input);
    },
    async list() {
      return [];
    },
    async listLoginHistory() {
      return [];
    },
  } as never;

  const deps: PaymentsRouterDeps = {
    platformService,
    swedbankPayService: swedbankPayService as never,
    emitWalletRoomUpdates: async (ids) => {
      emittedWalletIds.push(...ids);
    },
    swedbankWebhookSecret: "test-secret",
    auditLogService,
    nativeAppDeeplinkScheme: "spillorama",
    webGobackBaseUrl: "https://app.spillorama.no/wallet",
  };

  const app = express();
  app.use(express.json());
  app.use(createPaymentsRouter(deps));

  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://localhost:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
        emittedWalletIds,
        auditCalls,
        iframeSetIntents,
        setIntentForUser: (intent) => {
          intentsByUser.set(`${intent.id}::${intent.userId}`, intent);
          intentsById.set(intent.id, intent);
          iframeSetIntents.push(intent);
        },
        setIntentById: (intent) => {
          intentsById.set(intent.id, intent);
        },
        setReconcileResult: (intentId, result) => {
          reconcileMap.set(intentId, result);
        },
        setUser: (token, user) => {
          userByToken.set(token, user);
        },
      });
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// GAP #7 — GET /api/payments/swedbank/iframe/:intentId
// ──────────────────────────────────────────────────────────────────────────

describe("BIN-GAP-#7 GET /api/payments/swedbank/iframe/:intentId", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("returns HTML 200 with iframe pointing at Swedbank viewUrl", async () => {
    const intent = buildIntent();
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/iframe/${intent.id}`, {
      headers: { authorization: "Bearer user-alice-token" },
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const body = await res.text();
    assert.ok(body.startsWith("<!doctype html>"), "body must be a complete HTML document");
    assert.ok(body.includes(`src="${intent.viewUrl}"`), "iframe must use Swedbank viewUrl");
    assert.ok(
      /<iframe[^>]*sandbox="[^"]*allow-scripts/.test(body),
      "iframe must be sandboxed"
    );
    assert.ok(body.includes("swedbank:iframe:opened"), "page must signal opened to parent");
    assert.ok(body.includes(intent.id), "intentId must be embedded in the bootstrap script");
  });

  test("sets locked-down CSP and security headers", async () => {
    harness.setIntentForUser(buildIntent({ id: "intent-csp-1" }));
    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/iframe/intent-csp-1`, {
      headers: { authorization: "Bearer user-alice-token" },
    });
    assert.equal(res.status, 200);

    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("default-src 'none'"), "CSP must default-deny");
    assert.ok(csp.includes("frame-src https://*.payex.com"), "CSP must allow Swedbank Pay iframe origin");
    assert.ok(csp.includes("frame-src "), "CSP must include frame-src for the iframe");
    assert.ok(csp.includes("form-action 'none'"), "CSP must block form posts");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("returns 404 plain text when intent does not exist for user", async () => {
    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/iframe/intent-missing`, {
      headers: { authorization: "Bearer user-alice-token" },
    });
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
    const body = await res.text();
    assert.ok(body.length > 0);
    assert.ok(!body.includes("<iframe"), "404 must not leak the iframe template");
  });

  test("ownership-check: another user's intent → 404 (no leak)", async () => {
    // intent owned by alice
    const intent = buildIntent({ id: "alice-intent", userId: "user-alice", walletId: "wallet-alice" });
    harness.setIntentForUser(intent);

    // mallory tries to fetch it
    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/iframe/${intent.id}`, {
      headers: { authorization: "Bearer user-mallory-token" },
    });
    assert.equal(res.status, 404, "must not leak that the intent exists for another user");
  });

  test("missing Authorization → 401", async () => {
    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/iframe/anything`);
    assert.equal(res.status, 401);
  });

  test("renders empty-state when Swedbank returned no viewUrl/redirectUrl", async () => {
    // Override the buildIntent defaults — pass through `as` to bypass the
    // `??` defaulting so the intent really has missing URLs.
    const empty = { ...buildIntent({ id: "intent-empty" }) } as unknown as Record<string, unknown>;
    delete empty.viewUrl;
    delete empty.redirectUrl;
    harness.setIntentForUser(empty as never);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/iframe/intent-empty`, {
      headers: { authorization: "Bearer user-alice-token" },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!body.includes("<iframe"), "must not render iframe when there is no target URL");
    assert.ok(body.includes("Betalingen kan ikke åpnes"), "must show user-facing fallback copy");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GAP #8 — GET /api/payments/swedbank/deposit/response
// ──────────────────────────────────────────────────────────────────────────

describe("BIN-GAP-#8 GET /api/payments/swedbank/deposit/response", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("PAID intent → success page + wallet broadcast + audit log", async () => {
    const intent = buildIntent({ id: "intent-success-1", status: "PAID" });
    harness.setReconcileResult(intent.id, { intent, walletCreditedNow: true });

    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=${intent.id}`,
    );
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.ok(body.includes("Innskuddet er gjennomført"), "must show success headline");
    // The post-message envelope's status is bound to the JS-literal STATUS
    // constant; we only need to assert "success" is the resolved value.
    assert.ok(body.includes(`STATUS = "success"`),
      "post-message envelope must bind STATUS to 'success'");
    assert.ok(body.includes(intent.id), "intentId must be embedded for the parent listener");
    assert.equal(harness.emittedWalletIds[0], "wallet-alice", "wallet-room must be broadcast on credit");
    assert.equal(harness.auditCalls.length, 1, "must audit-log the response");
    assert.equal(harness.auditCalls[0]!.action, "payment.swedbank.response");
    assert.equal(harness.auditCalls[0]!.resourceId, intent.id);
    assert.equal((harness.auditCalls[0]!.details as { status: string }).status, "success");
  });

  test("CANCELLED intent → cancelled page, NO wallet broadcast", async () => {
    const intent = buildIntent({ id: "intent-cancelled-1", status: "CANCELLED" });
    harness.setReconcileResult(intent.id, { intent, walletCreditedNow: false });

    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=${intent.id}`,
    );
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes("avbrutt") || body.includes("Avbrutt"), "must show cancelled copy");
    assert.equal(harness.emittedWalletIds.length, 0, "no wallet broadcast on cancelled");
  });

  test("FAILED intent → failed page", async () => {
    const intent = buildIntent({ id: "intent-failed-1", status: "FAILED" });
    harness.setReconcileResult(intent.id, { intent, walletCreditedNow: false });

    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=${intent.id}`,
    );
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes("feilet") || body.includes("Feilet"), "must show failed copy");
  });

  test("unknown intent id → renders 'unknown' page (not 5xx)", async () => {
    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=does-not-exist`,
    );
    assert.equal(res.status, 200, "post-redirect page must always render");
    const body = await res.text();
    assert.ok(body.includes("ukjent") || body.includes("Ukjent"), "must show unknown-status copy");
    assert.equal(harness.auditCalls.length, 0, "no audit when no intent matched");
  });

  test("no auth required (Swedbank redirect path)", async () => {
    const intent = buildIntent({ id: "intent-no-auth", status: "PAID" });
    harness.setReconcileResult(intent.id, { intent, walletCreditedNow: false });
    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=${intent.id}`,
      // deliberately no Authorization header
    );
    assert.equal(res.status, 200);
  });

  test("CSP and security headers locked down", async () => {
    const intent = buildIntent({ id: "intent-csp-2", status: "PAID" });
    harness.setReconcileResult(intent.id, { intent, walletCreditedNow: false });
    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=${intent.id}`,
    );
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("default-src 'none'"));
    assert.ok(csp.includes("form-action 'none'"));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  test("includes platform-specific deeplink in inline payload", async () => {
    const intent = buildIntent({ id: "intent-deeplink", status: "PAID" });
    harness.setReconcileResult(intent.id, { intent, walletCreditedNow: false });
    const res = await fetch(
      `${harness.baseUrl}/api/payments/swedbank/deposit/response?swedbank_intent=${intent.id}&platform=ios`,
    );
    const body = await res.text();
    assert.ok(
      body.includes("spillorama://payment/result"),
      "ios platform must produce a native deeplink"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GAP #9 — POST /api/payments/swedbank/goback
// ──────────────────────────────────────────────────────────────────────────

describe("BIN-GAP-#9 POST /api/payments/swedbank/goback", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("ios → returns spillorama:// deeplink and audits", async () => {
    const intent = buildIntent({ id: "goback-ios-1", status: "PAID" });
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user-alice-token",
      },
      body: JSON.stringify({ paymentId: intent.id, platform: "ios" }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; data: { url: string; status: string; platform: string } };
    assert.equal(json.ok, true);
    assert.equal(json.data.platform, "ios");
    assert.equal(json.data.status, "success");
    assert.ok(json.data.url.startsWith("spillorama://payment/result?"), `unexpected url: ${json.data.url}`);
    assert.ok(json.data.url.includes(`id=${intent.id}`));
    assert.ok(json.data.url.includes("status=success"));

    assert.equal(harness.auditCalls.length, 1);
    assert.equal(harness.auditCalls[0]!.action, "payment.swedbank.goback");
    assert.equal(harness.auditCalls[0]!.actorType, "PLAYER");
    assert.equal((harness.auditCalls[0]!.details as { platform: string }).platform, "ios");
  });

  test("android → returns spillorama:// deeplink", async () => {
    const intent = buildIntent({ id: "goback-android-1", status: "PAID" });
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-alice-token" },
      body: JSON.stringify({ paymentId: intent.id, platform: "android" }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: { url: string } };
    assert.ok(json.data.url.startsWith("spillorama://payment/result"));
  });

  test("web → returns absolute https deeplink under the configured base", async () => {
    const intent = buildIntent({ id: "goback-web-1", status: "PAID" });
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-alice-token" },
      body: JSON.stringify({ paymentId: intent.id, platform: "web" }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: { url: string } };
    assert.ok(json.data.url.startsWith("https://app.spillorama.no/wallet/payment/result"));
    assert.ok(json.data.url.includes(`id=${intent.id}`));
  });

  test("intentId-alias `intentId` is accepted as well as `paymentId`", async () => {
    const intent = buildIntent({ id: "goback-alias", status: "PAID" });
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-alice-token" },
      body: JSON.stringify({ intentId: intent.id, platform: "ios" }),
    });
    assert.equal(res.status, 200);
  });

  test("invalid platform → 400 INVALID_INPUT, no audit, no deeplink", async () => {
    const intent = buildIntent({ id: "goback-bad-platform" });
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-alice-token" },
      body: JSON.stringify({ paymentId: intent.id, platform: "switch" }),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "INVALID_INPUT");
    assert.equal(harness.auditCalls.length, 0);
  });

  test("foreign intent → 400 PAYMENT_INTENT_NOT_FOUND (no leak)", async () => {
    const intent = buildIntent({ id: "alice-only", userId: "user-alice", walletId: "wallet-alice" });
    harness.setIntentForUser(intent);

    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-mallory-token" },
      body: JSON.stringify({ paymentId: intent.id, platform: "ios" }),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(json.error.code, "PAYMENT_INTENT_NOT_FOUND");
    assert.equal(harness.auditCalls.length, 0);
  });

  test("missing Authorization → 400 UNAUTHORIZED", async () => {
    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentId: "anything", platform: "ios" }),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { error: { code: string } };
    assert.equal(json.error.code, "UNAUTHORIZED");
  });

  test("missing paymentId → 400 INVALID_INPUT", async () => {
    const res = await fetch(`${harness.baseUrl}/api/payments/swedbank/goback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer user-alice-token" },
      body: JSON.stringify({ platform: "ios" }),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { error: { code: string } };
    assert.equal(json.error.code, "INVALID_INPUT");
  });
});
