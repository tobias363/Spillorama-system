/**
 * SwedbankPayService unit tests.
 *
 * Test-engineer Bølge B: tests cover the iframe-flow (createTopupIntent),
 * the polling reconcile path (reconcileIntentForUser), and the webhook
 * callback path (processCallback). All external dependencies are stubbed:
 *   - pg.Pool → in-memory map keyed on intent id / order_reference / paymentOrderId
 *   - fetch    → captured-call recorder that returns canned payloads
 *   - WalletAdapter → captures topUp() arguments
 *
 * Critical paths tested:
 *   - Idempotency: reconcile twice does NOT credit twice (creditedAt freeze)
 *   - Amount mismatch fail-closed (regulatory: never credit on tampered tx)
 *   - Currency mismatch fail-closed
 *   - Webhook routes via orderReference fallback to paymentOrderId
 *   - Pending status (Initialized) → no wallet credit
 *   - Bypass attempts (bypass user-id, missing intent) reject with NOT_FOUND
 *   - HTTP timeout / unavailable surface DomainError, not raw fetch errors
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { SwedbankPayService, type SwedbankPayServiceOptions } from "../SwedbankPayService.js";
import type { WalletAdapter, WalletTransaction } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Mock Pool ──────────────────────────────────────────────────────────────

interface IntentRow {
  id: string;
  provider: string;
  user_id: string;
  wallet_id: string;
  order_reference: string;
  payee_reference: string;
  swedbank_payment_order_id: string;
  amount_minor: string;
  amount_major: string;
  currency: string;
  status: string;
  checkout_redirect_url: string | null;
  checkout_view_url: string | null;
  credited_transaction_id: string | null;
  credited_at: Date | null;
  last_error: string | null;
  raw_create_response: string | null;
  raw_latest_status: string | null;
  created_at: Date;
  updated_at: Date;
}

function runQuery(
  intents: Map<string, IntentRow>,
  sql: string,
  params: unknown[]
): { rows: IntentRow[] } {
  const upper = sql.trim().slice(0, 16).toUpperCase();
  if (upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
    return { rows: [] };
  }
  if (upper.startsWith("CREATE ") || upper.startsWith("ALTER ")) {
    return { rows: [] };
  }

  if (upper.startsWith("INSERT")) {
    const [
      id,
      userId,
      walletId,
      orderReference,
      payeeReference,
      paymentOrderId,
      amountMinor,
      amountMajor,
      currency,
      status,
      redirectUrl,
      viewUrl,
      rawCreate,
    ] = params as [
      string, string, string, string, string, string, number, string, string, string, string | null, string | null, string,
    ];
    const now = new Date();
    const row: IntentRow = {
      id,
      provider: "swedbankpay",
      user_id: userId,
      wallet_id: walletId,
      order_reference: orderReference,
      payee_reference: payeeReference,
      swedbank_payment_order_id: paymentOrderId,
      amount_minor: String(amountMinor),
      amount_major: amountMajor,
      currency,
      status,
      checkout_redirect_url: redirectUrl,
      checkout_view_url: viewUrl,
      credited_transaction_id: null,
      credited_at: null,
      last_error: null,
      raw_create_response: rawCreate,
      raw_latest_status: null,
      created_at: now,
      updated_at: now,
    };
    intents.set(id, row);
    return { rows: [{ ...row }] };
  }

  if (upper.startsWith("UPDATE")) {
    // Both ID-keyed and orderReference-keyed updates use $1 = id (as service writes it).
    const [id, ...rest] = params as [string, ...unknown[]];
    const row = intents.get(id);
    if (!row) return { rows: [] };
    if (sql.includes("status = 'CREDITED'")) {
      row.status = "CREDITED";
      row.raw_latest_status = rest[0] as string;
      row.credited_transaction_id = rest[1] as string;
      row.credited_at = new Date();
      row.last_error = null;
    } else if (sql.includes("last_error = $3")) {
      row.status = rest[0] as string;
      row.last_error = rest[1] as string;
      row.raw_latest_status = rest[2] as string;
    } else if (sql.includes("swedbank_payment_order_id = $2")) {
      row.swedbank_payment_order_id = rest[0] as string;
    } else {
      // updateIntentStatus
      row.status = rest[0] as string;
      row.raw_latest_status = rest[1] as string;
      row.last_error = null;
    }
    row.updated_at = new Date();
    return { rows: [{ ...row }] };
  }

  if (upper.startsWith("SELECT")) {
    if (sql.includes("WHERE id = $1\n         AND user_id = $2")) {
      const [id, userId] = params as [string, string];
      const row = intents.get(id);
      return { rows: row && row.user_id === userId ? [{ ...row }] : [] };
    }
    if (sql.includes("WHERE order_reference = $1")) {
      const [ref] = params as [string];
      for (const row of intents.values()) {
        if (row.order_reference === ref) return { rows: [{ ...row }] };
      }
      return { rows: [] };
    }
    if (sql.includes("WHERE swedbank_payment_order_id = $1")) {
      const [pid] = params as [string];
      for (const row of intents.values()) {
        if (row.swedbank_payment_order_id === pid) return { rows: [{ ...row }] };
      }
      return { rows: [] };
    }
    if (sql.includes("WHERE id = $1\n       FOR UPDATE")) {
      const [id] = params as [string];
      const row = intents.get(id);
      return { rows: row ? [{ ...row }] : [] };
    }
    return { rows: [] };
  }

  return { rows: [] };
}

function makeMockPool(): { pool: Pool; intents: Map<string, IntentRow> } {
  const intents = new Map<string, IntentRow>();
  const clientShim = {
    query: async (sql: string, params: unknown[] = []) => runQuery(intents, sql, params),
    release: () => undefined,
  };
  const poolShim = {
    connect: async (): Promise<PoolClient> => clientShim as unknown as PoolClient,
    query: async (sql: string, params: unknown[] = []) => runQuery(intents, sql, params),
  };
  return { pool: poolShim as unknown as Pool, intents };
}

// ── Mock WalletAdapter ─────────────────────────────────────────────────────

interface TopupCall {
  accountId: string;
  amount: number;
  reason?: string;
}

function makeMockWallet(): { adapter: WalletAdapter; topUps: TopupCall[] } {
  const topUps: TopupCall[] = [];
  let nextTxId = 1;
  const adapter: WalletAdapter = {
    async createAccount() { throw new Error("nope"); },
    async ensureAccount() {
      return { id: "x", balance: 0, depositBalance: 0, winningsBalance: 0, createdAt: "", updatedAt: "" };
    },
    async getAccount() { throw new Error("nope"); },
    async listAccounts() { return []; },
    async getBalance() { return 0; },
    async getDepositBalance() { return 0; },
    async getWinningsBalance() { return 0; },
    async getBothBalances() { return { deposit: 0, winnings: 0, total: 0 }; },
    async debit(): Promise<WalletTransaction> { throw new Error("nope"); },
    async credit(): Promise<WalletTransaction> { throw new Error("nope"); },
    async topUp(accountId, amount, reason) {
      topUps.push({ accountId, amount, reason });
      return {
        id: `wtx-${nextTxId++}`,
        accountId,
        type: "TOPUP",
        amount,
        reason: reason ?? "",
        createdAt: new Date().toISOString(),
      };
    },
    async withdraw(): Promise<WalletTransaction> { throw new Error("nope"); },
    async transfer() { throw new Error("nope"); },
    async listTransactions() { return []; },
  };
  return { adapter, topUps };
}

// ── Mock fetch ─────────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface FetchResponseSpec {
  status?: number;
  jsonBody?: unknown;
  textBody?: string;
  delayMs?: number;
}

function installMockFetch(queue: FetchResponseSpec[]): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (globalThis as any).fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}
  ): Promise<Response> => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
    });
    const spec = queue.shift();
    if (!spec) {
      throw new Error(`MockFetch: no canned response for ${init.method ?? "GET"} ${url}`);
    }
    if (spec.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, spec.delayMs);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const abortErr = new Error("aborted");
          (abortErr as { name: string }).name = "AbortError";
          reject(abortErr);
        });
      });
    }
    const status = spec.status ?? 200;
    const text = spec.textBody ?? (spec.jsonBody !== undefined ? JSON.stringify(spec.jsonBody) : "");
    const responseShim: Pick<Response, "ok" | "status" | "text"> = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
    return responseShim as Response;
  };
  return {
    calls,
    restore: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = original;
    },
  };
}

// ── Service factory ────────────────────────────────────────────────────────

function makeService(opts: Partial<SwedbankPayServiceOptions> = {}): {
  service: SwedbankPayService;
  intents: Map<string, IntentRow>;
  topUps: TopupCall[];
} {
  const { pool, intents } = makeMockPool();
  const { adapter, topUps } = makeMockWallet();

  // Build options with defaults that pass isConfigured().
  const options: SwedbankPayServiceOptions = {
    connectionString: "postgres://test/test",
    schema: "public",
    apiBaseUrl: "https://api.test.payex.example/",
    accessToken: "tok-test",
    payeeId: "payee-test",
    payeeName: "Bingo",
    productName: "Checkout3",
    currency: "NOK",
    language: "nb-NO",
    merchantBaseUrl: "https://merchant.test.example/",
    callbackUrl: "https://merchant.test.example/api/payments/swedbank/callback",
    completeUrl: "https://merchant.test.example/wallet?topup=ok",
    cancelUrl: "https://merchant.test.example/wallet?topup=cancel",
    requestTimeoutMs: 1000,
    ...opts,
  };

  // Construct without actually creating a Pool that opens connections.
  // Object.create lets us bypass the constructor entirely (pg.Pool would
  // otherwise sit unused but holding a connection placeholder).
  const svc = Object.create(SwedbankPayService.prototype) as SwedbankPayService;
  Object.assign(svc, {
    walletAdapter: adapter,
    pool,
    schema: options.schema,
    apiBaseUrl: options.apiBaseUrl!.endsWith("/") ? options.apiBaseUrl : `${options.apiBaseUrl}/`,
    accessToken: options.accessToken,
    payeeId: options.payeeId,
    payeeName: options.payeeName,
    productName: options.productName,
    currency: options.currency,
    language: options.language,
    merchantBaseUrl: options.merchantBaseUrl!.endsWith("/")
      ? options.merchantBaseUrl
      : `${options.merchantBaseUrl}/`,
    callbackUrl: options.callbackUrl,
    completeUrl: options.completeUrl,
    cancelUrl: options.cancelUrl,
    termsOfServiceUrl: options.termsOfServiceUrl ?? "",
    requestTimeoutMs: options.requestTimeoutMs ?? 10000,
    initPromise: Promise.resolve(),
  });
  return { service: svc, intents, topUps };
}

// Canned Swedbank API payloads
function paymentOrderCreateResponse(opts: {
  paymentOrderId?: string;
  status?: string;
  redirectHref?: string;
  viewHref?: string;
} = {}) {
  return {
    paymentOrder: {
      id: opts.paymentOrderId ?? "/psp/paymentorders/po-1",
      status: opts.status ?? "Initialized",
    },
    operations: [
      { rel: "redirect-checkout", href: opts.redirectHref ?? "https://payex.test/redirect/po-1" },
      { rel: "view-checkout", href: opts.viewHref ?? "https://payex.test/view/po-1" },
    ],
  };
}

function paymentOrderFetchResponse(opts: {
  status?: string;
  amount?: number;
  currency?: string;
  paymentOrderId?: string;
} = {}) {
  return {
    paymentOrder: {
      id: opts.paymentOrderId ?? "/psp/paymentorders/po-1",
      status: opts.status ?? "Paid",
      amount: opts.amount ?? 50000,
      currency: opts.currency ?? "NOK",
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("isConfigured: true when all required fields are set", () => {
  const { service } = makeService();
  assert.equal(service.isConfigured(), true);
});

test("isConfigured: false when accessToken missing", () => {
  const { service } = makeService({ accessToken: "" });
  assert.equal(service.isConfigured(), false);
});

test("isConfigured: false when payeeId missing", () => {
  const { service } = makeService({ payeeId: "" });
  assert.equal(service.isConfigured(), false);
});

test("isConfigured: true when only merchantBaseUrl provided (URL fallback path)", () => {
  const { service } = makeService({
    callbackUrl: "",
    completeUrl: "",
    cancelUrl: "",
    merchantBaseUrl: "https://merchant.example.com/",
  });
  assert.equal(service.isConfigured(), true);
});

test("createTopupIntent: SWEDBANK_NOT_CONFIGURED when accessToken empty", async () => {
  const { service } = makeService({ accessToken: "" });
  await assert.rejects(
    () => service.createTopupIntent({ userId: "u1", walletId: "w1", amountMajor: 100 }),
    (err: unknown) => err instanceof DomainError && err.code === "SWEDBANK_NOT_CONFIGURED"
  );
});

test("createTopupIntent: rejects amountMajor <= 0", async () => {
  const { service } = makeService();
  const f = installMockFetch([]);
  try {
    await assert.rejects(
      () => service.createTopupIntent({ userId: "u1", walletId: "w1", amountMajor: 0 }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
    );
    await assert.rejects(
      () => service.createTopupIntent({ userId: "u1", walletId: "w1", amountMajor: -50 }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
    );
  } finally {
    f.restore();
  }
});

test("createTopupIntent: rejects empty userId/walletId", async () => {
  const { service } = makeService();
  const f = installMockFetch([]);
  try {
    await assert.rejects(
      () => service.createTopupIntent({ userId: "  ", walletId: "w1", amountMajor: 100 }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
    );
    await assert.rejects(
      () => service.createTopupIntent({ userId: "u1", walletId: "  ", amountMajor: 100 }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
    );
  } finally {
    f.restore();
  }
});

test("createTopupIntent: persists row + returns redirect/view urls", async () => {
  const { service, intents } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse({ paymentOrderId: "/psp/paymentorders/po-1" }) },
  ]);
  try {
    const intent = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 250,
    });
    assert.equal(intent.amountMinor, 25000);
    assert.equal(intent.amountMajor, 250);
    assert.equal(intent.currency, "NOK");
    assert.equal(intent.status, "INITIALIZED");
    assert.equal(intent.redirectUrl, "https://payex.test/redirect/po-1");
    assert.equal(intent.viewUrl, "https://payex.test/view/po-1");
    assert.equal(intent.paymentOrderId, "/psp/paymentorders/po-1");
    assert.equal(intents.size, 1);
    // Bearer token present in Authorization header.
    assert.equal(f.calls[0]!.headers.Authorization, "Bearer tok-test");
    assert.equal(f.calls[0]!.method, "POST");
  } finally {
    f.restore();
  }
});

test("createTopupIntent: payload contains correct amount + metadata + completeUrl with intent param", async () => {
  const { service } = makeService();
  const f = installMockFetch([{ jsonBody: paymentOrderCreateResponse() }]);
  try {
    const intent = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100.5,
    });
    const body = JSON.parse(f.calls[0]!.body!);
    assert.equal(body.paymentorder.amount, 10050, "amount in minor units");
    assert.equal(body.paymentorder.currency, "NOK");
    assert.equal(body.paymentorder.metadata.intentId, intent.id);
    assert.equal(body.paymentorder.metadata.userId, "u-1");
    assert.equal(body.paymentorder.metadata.walletId, "wallet-1");
    // completeUrl should embed the intent id as query string.
    assert.match(body.paymentorder.urls.completeUrl, /swedbank_intent=/);
    assert.match(body.paymentorder.urls.completeUrl, /swedbank_result=complete/);
    assert.match(body.paymentorder.urls.cancelUrl, /swedbank_result=cancel/);
  } finally {
    f.restore();
  }
});

test("createTopupIntent: SWEDBANK_API_ERROR includes problems summary on 4xx", async () => {
  const { service } = makeService();
  const f = installMockFetch([
    {
      status: 400,
      jsonBody: {
        title: "InputError",
        problems: [
          { name: "amount.invalid", description: "Amount must be positive" },
        ],
      },
    },
  ]);
  try {
    await assert.rejects(
      () => service.createTopupIntent({ userId: "u-1", walletId: "wallet-1", amountMajor: 100 }),
      (err: unknown) =>
        err instanceof DomainError &&
        err.code === "SWEDBANK_API_ERROR" &&
        /Problems: amount\.invalid: Amount must be positive/.test(err.message)
    );
  } finally {
    f.restore();
  }
});

test("createTopupIntent: SWEDBANK_INVALID_RESPONSE when paymentOrder.id is missing", async () => {
  const { service } = makeService();
  const f = installMockFetch([{ jsonBody: { paymentOrder: { status: "Initialized" } } }]);
  try {
    await assert.rejects(
      () => service.createTopupIntent({ userId: "u-1", walletId: "wallet-1", amountMajor: 100 }),
      (err: unknown) => err instanceof DomainError && err.code === "SWEDBANK_INVALID_RESPONSE"
    );
  } finally {
    f.restore();
  }
});

test("createTopupIntent: SWEDBANK_API_TIMEOUT when fetch aborts via signal", async () => {
  const { service } = makeService({ requestTimeoutMs: 50 });
  const f = installMockFetch([{ delayMs: 500, jsonBody: paymentOrderCreateResponse() }]);
  try {
    await assert.rejects(
      () => service.createTopupIntent({ userId: "u-1", walletId: "wallet-1", amountMajor: 100 }),
      (err: unknown) => err instanceof DomainError && err.code === "SWEDBANK_API_TIMEOUT"
    );
  } finally {
    f.restore();
  }
});

test("getIntentForUser: returns intent when user matches", async () => {
  const { service } = makeService();
  const f = installMockFetch([{ jsonBody: paymentOrderCreateResponse() }]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const fetched = await service.getIntentForUser(created.id, "u-1");
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.userId, "u-1");
  } finally {
    f.restore();
  }
});

test("getIntentForUser: PAYMENT_INTENT_NOT_FOUND when user mismatch (cross-user lookup blocked)", async () => {
  const { service } = makeService();
  const f = installMockFetch([{ jsonBody: paymentOrderCreateResponse() }]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    // CRITICAL — security boundary: another user must not be able to read another user's intent.
    await assert.rejects(
      () => service.getIntentForUser(created.id, "u-2"),
      (err: unknown) => err instanceof DomainError && err.code === "PAYMENT_INTENT_NOT_FOUND"
    );
  } finally {
    f.restore();
  }
});

test("getIntentForUser: PAYMENT_INTENT_NOT_FOUND when intent id is unknown", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.getIntentForUser("doesnt-exist", "u-1"),
    (err: unknown) => err instanceof DomainError && err.code === "PAYMENT_INTENT_NOT_FOUND"
  );
});

test("reconcileIntentForUser: credits wallet when remote status is Paid + amounts match", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 10000 }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const result = await service.reconcileIntentForUser(created.id, "u-1");
    assert.equal(result.walletCreditedNow, true);
    assert.equal(result.intent.status, "CREDITED");
    assert.ok(result.intent.creditedAt, "creditedAt is set");
    assert.equal(result.intent.creditedTransactionId, "wtx-1");
    assert.equal(topUps.length, 1, "wallet topUp called exactly once");
    assert.equal(topUps[0]!.accountId, "wallet-1");
    assert.equal(topUps[0]!.amount, 100);
    assert.match(topUps[0]!.reason ?? "", /Swedbank top-up TOPUP/);
  } finally {
    f.restore();
  }
});

test("reconcileIntentForUser: idempotent — second reconcile does NOT credit wallet again", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 50000 }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 500,
    });
    const first = await service.reconcileIntentForUser(created.id, "u-1");
    assert.equal(first.walletCreditedNow, true);
    // Second call should short-circuit on creditedAt without calling fetch or topUp again.
    const second = await service.reconcileIntentForUser(created.id, "u-1");
    assert.equal(second.walletCreditedNow, false);
    assert.equal(topUps.length, 1, "topUp called only once across two reconciles");
  } finally {
    f.restore();
  }
});

test("reconcileIntentForUser: fail-closed on SWEDBANK_AMOUNT_MISMATCH (wallet NOT credited)", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 99999 /* wrong */ }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100, // 10000 minor expected
    });
    await assert.rejects(
      () => service.reconcileIntentForUser(created.id, "u-1"),
      (err: unknown) => err instanceof DomainError && err.code === "SWEDBANK_AMOUNT_MISMATCH"
    );
    assert.equal(topUps.length, 0, "wallet must NOT be credited on amount mismatch (regulatory)");
    // After mismatch the intent should be marked FAILED with last_error set.
    const fresh = await service.getIntentForUser(created.id, "u-1");
    assert.equal(fresh.status, "FAILED");
    assert.match(fresh.lastError ?? "", /amount/i);
  } finally {
    f.restore();
  }
});

test("reconcileIntentForUser: fail-closed on SWEDBANK_CURRENCY_MISMATCH", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 10000, currency: "USD" }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    await assert.rejects(
      () => service.reconcileIntentForUser(created.id, "u-1"),
      (err: unknown) => err instanceof DomainError && err.code === "SWEDBANK_CURRENCY_MISMATCH"
    );
    assert.equal(topUps.length, 0);
  } finally {
    f.restore();
  }
});

test("reconcileIntentForUser: pending status (Initialized) → no credit, no error", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Initialized", amount: 10000 }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const result = await service.reconcileIntentForUser(created.id, "u-1");
    assert.equal(result.walletCreditedNow, false);
    assert.equal(result.intent.status, "INITIALIZED");
    assert.equal(topUps.length, 0);
  } finally {
    f.restore();
  }
});

test("reconcileIntentForUser: cross-user reconcile blocked (security)", async () => {
  const { service } = makeService();
  const f = installMockFetch([{ jsonBody: paymentOrderCreateResponse() }]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    await assert.rejects(
      () => service.reconcileIntentForUser(created.id, "u-attacker"),
      (err: unknown) => err instanceof DomainError && err.code === "PAYMENT_INTENT_NOT_FOUND"
    );
  } finally {
    f.restore();
  }
});

test("processCallback: routes via orderReference and credits when paid", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 10000 }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const result = await service.processCallback({
      paymentOrder: { id: "/psp/paymentorders/po-1" },
      orderReference: created.orderReference,
    });
    assert.equal(result.walletCreditedNow, true);
    assert.equal(topUps.length, 1);
  } finally {
    f.restore();
  }
});

test("processCallback: falls back to paymentOrder.id when orderReference missing", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse({ paymentOrderId: "/psp/paymentorders/po-7" }) },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 10000, paymentOrderId: "/psp/paymentorders/po-7" }) },
  ]);
  try {
    await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const result = await service.processCallback({
      paymentOrder: { id: "/psp/paymentorders/po-7" },
      // orderReference omitted intentionally
    });
    assert.equal(result.walletCreditedNow, true);
    assert.equal(topUps.length, 1);
  } finally {
    f.restore();
  }
});

test("processCallback: PAYMENT_INTENT_NOT_FOUND when neither orderReference nor paymentOrderId match", async () => {
  const { service } = makeService();
  const f = installMockFetch([]);
  try {
    await assert.rejects(
      () => service.processCallback({
        paymentOrder: { id: "/psp/paymentorders/unknown" },
        orderReference: "TOPUP-MISSING-XYZ",
      }),
      (err: unknown) => err instanceof DomainError && err.code === "PAYMENT_INTENT_NOT_FOUND"
    );
  } finally {
    f.restore();
  }
});

test("processCallback: handles full https URL paymentOrder.id (normalises to path)", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse({ paymentOrderId: "/psp/paymentorders/po-9" }) },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 10000, paymentOrderId: "/psp/paymentorders/po-9" }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const result = await service.processCallback({
      // Intentionally send full URL — service must normalize.
      paymentOrder: { id: "https://api.test.payex.example/psp/paymentorders/po-9?$expand=paid" },
      orderReference: created.orderReference,
    });
    assert.equal(result.walletCreditedNow, true);
    assert.equal(topUps.length, 1);
  } finally {
    f.restore();
  }
});

test("processCallback: idempotent — second callback for already-credited intent is no-op", async () => {
  const { service, topUps } = makeService();
  const f = installMockFetch([
    { jsonBody: paymentOrderCreateResponse() },
    { jsonBody: paymentOrderFetchResponse({ status: "Paid", amount: 10000 }) },
  ]);
  try {
    const created = await service.createTopupIntent({
      userId: "u-1",
      walletId: "wallet-1",
      amountMajor: 100,
    });
    const first = await service.processCallback({
      paymentOrder: { id: "/psp/paymentorders/po-1" },
      orderReference: created.orderReference,
    });
    assert.equal(first.walletCreditedNow, true);
    // Second callback (Swedbank retries on timeout) — must NOT re-credit.
    const second = await service.processCallback({
      paymentOrder: { id: "/psp/paymentorders/po-1" },
      orderReference: created.orderReference,
    });
    assert.equal(second.walletCreditedNow, false);
    assert.equal(topUps.length, 1, "topUp called only once across both callbacks");
  } finally {
    f.restore();
  }
});
