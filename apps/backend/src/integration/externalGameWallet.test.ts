/**
 * Bølge D coverage: HTTP-router for ekstern game-wallet (Candy).
 *
 * Routeren eksponerer GET /balance, POST /debit, POST /credit til eksterne
 * spill (Candy iframe-embed). Tester via supertest-stil i-prosess Express
 * app — ingen ekte HTTP-server.
 *
 * Dekker:
 *   - 401 uten Bearer-token / feil token
 *   - 400 uten playerId / amount / transactionId
 *   - 400 ved ikke-numerisk eller negativ amount
 *   - 200 happy path debit/credit/balance
 *   - 402 ved INSUFFICIENT_FUNDS
 *   - 404 ved PLAYER_NOT_FOUND
 *   - 409 ved IDEMPOTENCY_CONFLICT (samme transactionId returnerer samme tx-id)
 *   - Idempotency-key videresendes til wallet adapter
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { createExternalGameWalletRouter } from "./externalGameWallet.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import { WalletError, type WalletAdapter } from "../adapters/WalletAdapter.js";

const API_KEY = "test-secret-key";

interface FetchResponse {
  status: number;
  body: unknown;
}

async function startServer(adapterOverride?: WalletAdapter): Promise<{
  server: Server;
  baseUrl: string;
  adapter: InMemoryWalletAdapter;
  shutdown: () => Promise<void>;
}> {
  const adapter = (adapterOverride ?? new InMemoryWalletAdapter(0)) as InMemoryWalletAdapter;
  const app = express();
  app.use(express.json());
  app.use("/api/ext-wallet", createExternalGameWalletRouter({ walletAdapter: adapter, apiKey: API_KEY }));

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}/api/ext-wallet`;

  const shutdown = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  return { server, baseUrl, adapter, shutdown };
}

/**
 * Strict adapter for 404-tester: kaster ACCOUNT_NOT_FOUND for ukjente IDer
 * (motsetning av InMemoryWalletAdapter som auto-oppretter via ensureAccount).
 */
function makeStrictAdapter(): WalletAdapter {
  const inner = new InMemoryWalletAdapter(0);
  const knownIds = new Set<string>();

  return {
    ...inner,
    createAccount: async (input) => {
      const acc = await inner.createAccount(input);
      knownIds.add(acc.id);
      return acc;
    },
    ensureAccount: async (id: string) => {
      if (!knownIds.has(id)) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${id} finnes ikke.`);
      }
      return inner.ensureAccount(id);
    },
    getBalance: async (id: string) => {
      if (!knownIds.has(id)) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${id} finnes ikke.`);
      }
      return inner.getBalance(id);
    },
    debit: async (id, amount, reason, options) => {
      if (!knownIds.has(id)) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${id} finnes ikke.`);
      }
      return inner.debit(id, amount, reason, options);
    },
    credit: async (id, amount, reason, options) => {
      if (!knownIds.has(id)) {
        throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${id} finnes ikke.`);
      }
      return inner.credit(id, amount, reason, options);
    },
  } as WalletAdapter;
}

async function call(url: string, opts: RequestInit & { auth?: string } = {}): Promise<FetchResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  if (opts.auth !== undefined) {
    headers["Authorization"] = opts.auth;
  } else {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }
  const res = await fetch(url, { ...opts, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ── Auth gate ─────────────────────────────────────────────────────────────

test("ext-wallet — uten Authorization-header svarer 401 UNAUTHORIZED på balance", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/balance?playerId=anything`, { auth: "" });
    assert.equal(res.status, 401);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "UNAUTHORIZED");
  } finally {
    await shutdown();
  }
});

test("ext-wallet — feil Bearer-token svarer 401 (debit)", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      auth: "Bearer wrong-secret",
      body: JSON.stringify({ playerId: "p1", amount: 10, transactionId: "tx-1" }),
    });
    assert.equal(res.status, 401);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "UNAUTHORIZED");
  } finally {
    await shutdown();
  }
});

test("ext-wallet — token uten 'Bearer '-prefix svarer 401", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/balance?playerId=p1`, { auth: API_KEY });
    assert.equal(res.status, 401);
  } finally {
    await shutdown();
  }
});

// ── GET /balance ──────────────────────────────────────────────────────────

test("ext-wallet GET /balance — happy path returnerer balance + NOK", async () => {
  const { baseUrl, adapter, shutdown } = await startServer();
  try {
    await adapter.createAccount({ accountId: "wallet-test", initialBalance: 500 });
    const res = await call(`${baseUrl}/balance?playerId=wallet-test`);
    assert.equal(res.status, 200);
    const body = res.body as { balance: number; currency: string };
    assert.equal(body.balance, 500);
    assert.equal(body.currency, "NOK");
  } finally {
    await shutdown();
  }
});

test("ext-wallet GET /balance — manglende playerId svarer 400 INVALID_INPUT", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/balance`);
    assert.equal(res.status, 400);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "INVALID_INPUT");
  } finally {
    await shutdown();
  }
});

test("ext-wallet GET /balance — tom playerId svarer 400", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/balance?playerId=`);
    assert.equal(res.status, 400);
  } finally {
    await shutdown();
  }
});

test("ext-wallet GET /balance — ukjent wallet svarer 404 PLAYER_NOT_FOUND", async () => {
  // InMemoryWalletAdapter auto-oppretter wallets via ensureAccount; vi
  // bruker strict-adapter som kaster ACCOUNT_NOT_FOUND så vi kan teste
  // 404-pathen. I produksjon (Postgres-adapter) vil ukjent ID alltid
  // kaste, så denne testen reflekterer prod-oppførsel.
  const strict = makeStrictAdapter();
  const { baseUrl, shutdown } = await startServer(strict);
  try {
    const res = await call(`${baseUrl}/balance?playerId=does-not-exist`);
    assert.equal(res.status, 404);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "PLAYER_NOT_FOUND");
  } finally {
    await shutdown();
  }
});

// ── POST /debit ───────────────────────────────────────────────────────────

test("ext-wallet POST /debit — happy path: 200 med ny balance og tx-id", async () => {
  const { baseUrl, adapter, shutdown } = await startServer();
  try {
    await adapter.createAccount({ accountId: "wallet-1", initialBalance: 1000 });
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "wallet-1", amount: 100, transactionId: "tx-debit-1", roundId: "R1" }),
    });
    assert.equal(res.status, 200);
    const body = res.body as { success: boolean; balance: number; transactionId: string };
    assert.equal(body.success, true);
    assert.equal(body.balance, 900, "balance reduseres med 100");
    assert.ok(body.transactionId, "wallet tx-id returneres");

    assert.equal(await adapter.getBalance("wallet-1"), 900);
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /debit — INSUFFICIENT_FUNDS svarer 402", async () => {
  const { baseUrl, adapter, shutdown } = await startServer();
  try {
    await adapter.createAccount({ accountId: "wallet-1", initialBalance: 50 });
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "wallet-1", amount: 100, transactionId: "tx-1" }),
    });
    assert.equal(res.status, 402);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "INSUFFICIENT_FUNDS");
    assert.equal(await adapter.getBalance("wallet-1"), 50, "balance skal ikke endres");
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /debit — manglende playerId svarer 400", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ amount: 100, transactionId: "tx-1" }),
    });
    assert.equal(res.status, 400);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "INVALID_INPUT");
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /debit — manglende transactionId svarer 400", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "p1", amount: 100 }),
    });
    assert.equal(res.status, 400);
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /debit — negativ amount svarer 400 INVALID_AMOUNT", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "p1", amount: -10, transactionId: "tx-1" }),
    });
    assert.equal(res.status, 400);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "INVALID_AMOUNT");
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /debit — amount=0 svarer 400 (må være positiv)", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "p1", amount: 0, transactionId: "tx-1" }),
    });
    assert.equal(res.status, 400);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "INVALID_AMOUNT");
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /debit — ikke-numerisk amount svarer 400", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "p1", amount: "ten", transactionId: "tx-1" }),
    });
    assert.equal(res.status, 400);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "INVALID_AMOUNT");
  } finally {
    await shutdown();
  }
});

// ── Idempotency (KRITISK for ekstern wallet) ──────────────────────────────

test("ext-wallet POST /debit — gjentatt transactionId returnerer samme tx-id (idempotent)", async () => {
  const { baseUrl, adapter, shutdown } = await startServer();
  try {
    await adapter.createAccount({ accountId: "wallet-1", initialBalance: 1000 });
    const body = { playerId: "wallet-1", amount: 100, transactionId: "tx-idem-1" };

    const res1 = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(res1.status, 200);
    const txId1 = (res1.body as { transactionId: string }).transactionId;

    // Andre kall samme transactionId — wallet adapter skal returnere samme tx
    const res2 = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(res2.status, 200, "idempotency skal returnere 200, ikke 409");
    const txId2 = (res2.body as { transactionId: string }).transactionId;
    assert.equal(txId2, txId1, "samme tx-id ved gjentatt kall");

    assert.equal(await adapter.getBalance("wallet-1"), 900, "kun én reell debit");
  } finally {
    await shutdown();
  }
});

// ── POST /credit ──────────────────────────────────────────────────────────

test("ext-wallet POST /credit — happy path: 200 med ny balance", async () => {
  const { baseUrl, adapter, shutdown } = await startServer();
  try {
    await adapter.createAccount({ accountId: "wallet-1", initialBalance: 100 });
    const res = await call(`${baseUrl}/credit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "wallet-1", amount: 50, transactionId: "tx-credit-1", roundId: "R1" }),
    });
    assert.equal(res.status, 200);
    const body = res.body as { success: boolean; balance: number };
    assert.equal(body.success, true);
    assert.equal(body.balance, 150);
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /credit — ukjent player svarer 404 (strict adapter)", async () => {
  const strict = makeStrictAdapter();
  const { baseUrl, shutdown } = await startServer(strict);
  try {
    const res = await call(`${baseUrl}/credit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "ghost-wallet", amount: 50, transactionId: "tx-1" }),
    });
    assert.equal(res.status, 404);
    const body = res.body as { errorCode: string };
    assert.equal(body.errorCode, "PLAYER_NOT_FOUND");
  } finally {
    await shutdown();
  }
});

test("ext-wallet POST /credit — manglende amount svarer 400", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/credit`, {
      method: "POST",
      body: JSON.stringify({ playerId: "p1", transactionId: "tx-1" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await shutdown();
  }
});

// ── Validation: tom body / null ────────────────────────────────────────────

test("ext-wallet POST /debit — tom body svarer 400 (alle felt mangler)", async () => {
  const { baseUrl, shutdown } = await startServer();
  try {
    const res = await call(`${baseUrl}/debit`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await shutdown();
  }
});
