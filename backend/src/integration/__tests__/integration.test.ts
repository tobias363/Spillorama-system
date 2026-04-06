import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { describe, it, beforeEach } from "node:test";
import { ExternalWalletAdapter } from "../ExternalWalletAdapter.js";
import { WebhookService } from "../WebhookService.js";
import { ReconciliationService } from "../ReconciliationService.js";
import { CandyLaunchTokenStore } from "../../launch/CandyLaunchTokenStore.js";
import { WalletError } from "../../adapters/WalletAdapter.js";

// ---------------------------------------------------------------------------
// Mock HTTP server for wallet API
// ---------------------------------------------------------------------------

let mockResponses: Map<string, { status: number; body: object }>;
let requestLog: Array<{ method: string; url: string; body?: Record<string, unknown> }>;

function resetMock() {
  mockResponses = new Map();
  requestLog = [];
}

// Patch global fetch for tests.
const originalFetch = globalThis.fetch;

function installMockFetch() {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    requestLog.push({ method, url, body });

    const key = `${method} ${url}`;
    // Try exact match first, then prefix match.
    let mock = mockResponses.get(key);
    if (!mock) {
      for (const [pattern, resp] of mockResponses) {
        if (url.includes(pattern.replace(/^(GET|POST)\s+/, ""))) {
          mock = resp;
          break;
        }
      }
    }

    if (!mock) {
      return new Response(JSON.stringify({ error: "Not mocked" }), { status: 500 });
    }

    return new Response(JSON.stringify(mock.body), {
      status: mock.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// ExternalWalletAdapter tests
// ---------------------------------------------------------------------------

describe("ExternalWalletAdapter", () => {
  let adapter: ExternalWalletAdapter;

  beforeEach(() => {
    resetMock();
    installMockFetch();
    adapter = new ExternalWalletAdapter({
      baseUrl: "https://mock-provider.test/api/wallet",
      apiKey: "test-key-123",
      timeoutMs: 5000,
      currency: "NOK",
    });
  });

  it("fetches player balance from provider", async () => {
    mockResponses.set("balance", {
      status: 200,
      body: { balance: 5000, currency: "NOK" },
    });

    const balance = await adapter.getBalance("player-1");
    assert.equal(balance, 5000);
    assert.equal(requestLog.length, 1);
    assert.ok(requestLog[0].url.includes("balance?playerId=player-1"));
    restoreFetch();
  });

  it("debits player via provider API", async () => {
    mockResponses.set("/debit", {
      status: 200,
      body: { success: true, balance: 4900, transactionId: "tx-1" },
    });

    const tx = await adapter.debit("player-1", 100, "Bingo buy-in ROOM1");
    assert.equal(tx.type, "DEBIT");
    assert.equal(tx.amount, 100);
    assert.equal(tx.accountId, "player-1");
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].body?.amount, 100);
    restoreFetch();
  });

  it("credits player via provider API", async () => {
    mockResponses.set("/credit", {
      status: 200,
      body: { success: true, balance: 5200, transactionId: "tx-2" },
    });

    const tx = await adapter.credit("player-1", 200, "Line prize ROOM1");
    assert.equal(tx.type, "CREDIT");
    assert.equal(tx.amount, 200);
    restoreFetch();
  });

  it("handles INSUFFICIENT_FUNDS from provider", async () => {
    mockResponses.set("/debit", {
      status: 402,
      body: { success: false, errorCode: "INSUFFICIENT_FUNDS", errorMessage: "Not enough funds" },
    });

    await assert.rejects(
      () => adapter.debit("player-1", 10000, "Buy-in ROOM1"),
      (err: WalletError) => {
        assert.equal(err.code, "INSUFFICIENT_FUNDS");
        return true;
      }
    );
    restoreFetch();
  });

  it("transfer player->house calls provider debit", async () => {
    mockResponses.set("/debit", {
      status: 200,
      body: { success: true, balance: 4800, transactionId: "tx-3" },
    });

    const result = await adapter.transfer("player-1", "house-main", 200, "Bingo buy-in ROOM1");
    assert.equal(result.fromTx.type, "TRANSFER_OUT");
    assert.equal(result.toTx.type, "TRANSFER_IN");
    assert.equal(result.fromTx.accountId, "player-1");
    assert.equal(result.toTx.accountId, "house-main");
    restoreFetch();
  });

  it("transfer house->player calls provider credit", async () => {
    mockResponses.set("/credit", {
      status: 200,
      body: { success: true, balance: 5500, transactionId: "tx-4" },
    });

    const result = await adapter.transfer("house-main", "player-1", 500, "Line prize ROOM1");
    assert.equal(result.fromTx.type, "TRANSFER_OUT");
    assert.equal(result.toTx.type, "TRANSFER_IN");
    restoreFetch();
  });

  it("house-to-house transfer is purely virtual", async () => {
    const result = await adapter.transfer("house-main", "house-prize", 100, "Prize pool");
    assert.equal(result.fromTx.accountId, "house-main");
    assert.equal(result.toTx.accountId, "house-prize");
    assert.equal(requestLog.length, 0); // No HTTP calls.
    restoreFetch();
  });

  it("rejects player-to-player transfer", async () => {
    await assert.rejects(
      () => adapter.transfer("player-1", "player-2", 100, "P2P"),
      (err: WalletError) => {
        assert.equal(err.code, "NOT_SUPPORTED");
        return true;
      }
    );
    restoreFetch();
  });
});

// ---------------------------------------------------------------------------
// CandyLaunchTokenStore tests
// ---------------------------------------------------------------------------

describe("CandyLaunchTokenStore", () => {
  it("issues and consumes a launch token", () => {
    const store = new CandyLaunchTokenStore({ ttlMs: 60000 });

    const issued = store.issue({
      accessToken: "access-123",
      hallId: "hall-1",
      playerName: "Test Player",
      walletId: "wallet-1",
      apiBaseUrl: "http://localhost:4000",
    });

    assert.ok(issued.launchToken.length > 0);
    assert.ok(issued.issuedAt);
    assert.ok(issued.expiresAt);

    const resolved = store.consume(issued.launchToken);
    assert.ok(resolved);
    assert.equal(resolved!.accessToken, "access-123");
    assert.equal(resolved!.hallId, "hall-1");
    assert.equal(resolved!.playerName, "Test Player");
    assert.equal(resolved!.walletId, "wallet-1");
  });

  it("returns null for consumed token (one-time use)", () => {
    const store = new CandyLaunchTokenStore({ ttlMs: 60000 });
    const issued = store.issue({
      accessToken: "a", hallId: "h", playerName: "p", walletId: "w", apiBaseUrl: "http://x",
    });

    store.consume(issued.launchToken); // First consume.
    const second = store.consume(issued.launchToken);
    assert.equal(second, null);
  });

  it("returns null for expired token", () => {
    let now = 1000;
    const store = new CandyLaunchTokenStore({ ttlMs: 5000, now: () => now });

    const issued = store.issue({
      accessToken: "a", hallId: "h", playerName: "p", walletId: "w", apiBaseUrl: "http://x",
    });

    now = 7000; // Advance past TTL.
    const resolved = store.consume(issued.launchToken);
    assert.equal(resolved, null);
  });

  it("returns null for invalid token", () => {
    const store = new CandyLaunchTokenStore({ ttlMs: 60000 });
    assert.equal(store.consume("nonexistent-token"), null);
    assert.equal(store.consume(""), null);
  });
});

// ---------------------------------------------------------------------------
// WebhookService tests
// ---------------------------------------------------------------------------

describe("WebhookService", () => {
  let service: WebhookService;
  const webhookSecret = "test-webhook-secret-abc";

  beforeEach(() => {
    resetMock();
    installMockFetch();
    service = new WebhookService({
      gameResultWebhookUrl: "https://provider.test/webhooks/game",
      complianceWebhookUrl: "https://provider.test/webhooks/compliance",
      webhookSecret,
      timeoutMs: 5000,
      maxRetries: 1,
    });
  });

  it("sends game result webhook with HMAC signature", async () => {
    mockResponses.set("/webhooks/game", { status: 200, body: { received: true } });

    const payload = service.buildGameResultPayload({
      gameId: "game-1",
      sessionId: "session-1",
      playerId: "player-ext-1",
      entryFee: 100,
      totalPayout: 2400,
      currency: "NOK",
      ticketsPlayed: 1,
      numbersDrawn: 25,
      patterns: ["Line"],
    });

    const record = await service.sendGameResult(payload);
    assert.equal(record.success, true);
    assert.equal(record.status, 200);

    // Verify signature was sent.
    assert.equal(requestLog.length, 1);
    restoreFetch();
  });

  it("sends compliance event", async () => {
    mockResponses.set("/webhooks/compliance", { status: 200, body: { received: true } });

    const payload = service.buildCompliancePayload(
      "compliance.lossLimitReached",
      "player-1",
      { dailyLoss: 900, limit: 900 }
    );

    const record = await service.sendComplianceEvent(payload);
    assert.equal(record.success, true);
    restoreFetch();
  });

  it("tracks delivery log", async () => {
    mockResponses.set("/webhooks/game", { status: 200, body: { received: true } });

    const payload = service.buildGameResultPayload({
      gameId: "g1", sessionId: "s1", playerId: "p1",
      entryFee: 50, totalPayout: 0, currency: "NOK",
      ticketsPlayed: 1, numbersDrawn: 30, patterns: [],
    });

    await service.sendGameResult(payload);
    const log = service.getRecentDeliveries(10);
    assert.equal(log.length, 1);
    assert.equal(log[0].success, true);
    restoreFetch();
  });
});

// ---------------------------------------------------------------------------
// ReconciliationService tests
// ---------------------------------------------------------------------------

describe("ReconciliationService", () => {
  it("reports ok when local and provider match", async () => {
    resetMock();
    installMockFetch();

    // Create adapter and make some transactions.
    mockResponses.set("/debit", {
      status: 200,
      body: { success: true, balance: 900, transactionId: "tx-r1" },
    });
    mockResponses.set("balance", {
      status: 200,
      body: { balance: 1000, currency: "NOK" },
    });

    const adapter = new ExternalWalletAdapter({
      baseUrl: "https://mock.test/api/wallet",
      currency: "NOK",
    });

    await adapter.debit("player-1", 100, "test");
    const ledger = adapter.getFullLedger();

    const recon = new ReconciliationService({
      walletAdapter: adapter,
      fetchProviderTransactions: async () => {
        return ledger.map((tx) => ({
          transactionId: tx.id,
          playerId: tx.accountId,
          amount: tx.amount,
          type: tx.type === "DEBIT" ? "debit" as const : "credit" as const,
          timestamp: tx.createdAt,
        }));
      },
    });

    const report = await recon.reconcileLastHours(1);
    assert.equal(report.status, "ok");
    assert.equal(report.discrepancies.length, 0);
    restoreFetch();
  });

  it("detects missing transaction on provider side", async () => {
    resetMock();
    installMockFetch();

    mockResponses.set("/debit", {
      status: 200,
      body: { success: true, balance: 900, transactionId: "tx-r2" },
    });
    mockResponses.set("balance", {
      status: 200,
      body: { balance: 1000, currency: "NOK" },
    });

    const adapter = new ExternalWalletAdapter({
      baseUrl: "https://mock.test/api/wallet",
      currency: "NOK",
    });

    await adapter.debit("player-1", 100, "test");

    const recon = new ReconciliationService({
      walletAdapter: adapter,
      fetchProviderTransactions: async () => [], // Provider has no records.
    });

    const report = await recon.reconcileLastHours(1);
    assert.equal(report.status, "discrepancies_found");
    assert.ok(report.discrepancies.length > 0);
    assert.equal(report.discrepancies[0].type, "missing_on_provider");
    restoreFetch();
  });

  it("local-only reconciliation (no provider fetch)", async () => {
    resetMock();
    installMockFetch();

    mockResponses.set("/debit", {
      status: 200,
      body: { success: true, balance: 900, transactionId: "tx-r3" },
    });
    mockResponses.set("balance", {
      status: 200,
      body: { balance: 1000, currency: "NOK" },
    });

    const adapter = new ExternalWalletAdapter({
      baseUrl: "https://mock.test/api/wallet",
      currency: "NOK",
    });

    await adapter.debit("player-1", 50, "test");

    const recon = new ReconciliationService({ walletAdapter: adapter });
    const report = await recon.reconcileLastHours(1);
    assert.equal(report.status, "ok");
    assert.equal(report.localTransactionCount, 1);
    assert.equal(report.providerTransactionCount, 0);
    restoreFetch();
  });
});
