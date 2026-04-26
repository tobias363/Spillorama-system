/**
 * BIN-762: enhetstest for withWalletTx — retry-logikk + SQLState-klassifisering.
 *
 * Disse testene mocker `pg.Pool` slik at vi kan simulere serialization-feil
 * (40001) og deadlocks (40P01) uten å trenge en faktisk Postgres-instans.
 * Concurrency-tester mot ekte DB ligger i
 * PostgresWalletAdapter.isolation.test.ts (gated på
 * WALLET_PG_TEST_CONNECTION_STRING).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { WalletError } from "../adapters/WalletAdapter.js";
import { __testing, withWalletTx } from "./walletTxRetry.js";

// ── Helpers: minimal mock-Pool / mock-Client ────────────────────────────────

interface MockClient extends PoolClient {
  __released: boolean;
  __queries: string[];
}

function makeError(code: string): Error & { code: string } {
  const e = new Error(`Postgres error ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

function makeMockClient(): MockClient {
  const queries: string[] = [];
  const client = {
    __released: false,
    __queries: queries,
    query: async (sql: unknown, _params?: unknown) => {
      const sqlStr = typeof sql === "string" ? sql : (sql as { text: string }).text;
      queries.push(sqlStr);
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      client.__released = true;
    },
  } as unknown as MockClient;
  return client;
}

interface MockPoolControl {
  pool: Pool;
  clients: MockClient[];
}

function makeMockPool(): MockPoolControl {
  const clients: MockClient[] = [];
  const pool = {
    connect: async () => {
      const c = makeMockClient();
      clients.push(c);
      return c;
    },
  } as unknown as Pool;
  return { pool, clients };
}

// ── Test 1: SQLState-klassifisering ─────────────────────────────────────────

test("isRetryableError klassifiserer 40001 som retry-bar", () => {
  assert.equal(__testing.isRetryableError(makeError("40001")), true);
});

test("isRetryableError klassifiserer 40P01 som retry-bar", () => {
  assert.equal(__testing.isRetryableError(makeError("40P01")), true);
});

test("isRetryableError klassifiserer ikke 23505 (unique violation) som retry-bar", () => {
  assert.equal(__testing.isRetryableError(makeError("23505")), false);
});

test("isRetryableError klassifiserer ikke vanlig Error uten code som retry-bar", () => {
  assert.equal(__testing.isRetryableError(new Error("plain")), false);
});

test("isRetryableError klassifiserer ikke null/undefined som retry-bar", () => {
  assert.equal(__testing.isRetryableError(null), false);
  assert.equal(__testing.isRetryableError(undefined), false);
});

// ── Test 2: happy path — fn kjører én gang, COMMIT, returnerer verdi ─────────

test("withWalletTx: happy path — fn kjøres én gang, BEGIN/SET/COMMIT, returnerer fn-resultat", async () => {
  const { pool, clients } = makeMockPool();
  let calls = 0;
  const result = await withWalletTx(
    pool,
    async (_client) => {
      calls += 1;
      return "ok-value";
    },
    { sleepFn: async () => undefined },
  );
  assert.equal(result, "ok-value");
  assert.equal(calls, 1, "fn kalles én gang");
  assert.equal(clients.length, 1, "én client tatt fra pool");
  assert.equal(clients[0]!.__released, true, "client released");
  // Verifiser at riktige SQL-statements kjøres.
  const queries = clients[0]!.__queries;
  assert.ok(queries[0]!.startsWith("BEGIN"), "BEGIN først");
  assert.ok(
    queries[1]!.includes("ISOLATION LEVEL REPEATABLE READ"),
    "SET ISOLATION rett etter BEGIN",
  );
  assert.equal(queries[queries.length - 1], "COMMIT", "COMMIT til slutt");
});

// ── Test 3: SERIALIZABLE opt-in ──────────────────────────────────────────────

test("withWalletTx: SERIALIZABLE — opt-in via options.isolation", async () => {
  const { pool, clients } = makeMockPool();
  await withWalletTx(
    pool,
    async () => undefined,
    { isolation: "SERIALIZABLE", sleepFn: async () => undefined },
  );
  const queries = clients[0]!.__queries;
  assert.ok(
    queries[1]!.includes("ISOLATION LEVEL SERIALIZABLE"),
    "SERIALIZABLE settes",
  );
});

// ── Test 4: ikke-retry-bar feil propageres umiddelbart (ingen retry) ─────────

test("withWalletTx: 23505 (ikke retry-bar) propageres uten retry", async () => {
  const { pool, clients } = makeMockPool();
  const err = makeError("23505");
  let calls = 0;
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        calls += 1;
        throw err;
      },
      { sleepFn: async () => undefined },
    ),
    (e: unknown) => e === err,
  );
  assert.equal(calls, 1, "fn kalles kun én gang — ingen retry");
  assert.equal(clients.length, 1, "kun én client tatt");
  assert.equal(clients[0]!.__released, true);
});

// ── Test 5: 40001 én gang → retry → suksess på andre forsøk ──────────────────

test("withWalletTx: 40001 én gang → retry → andre forsøk lykkes", async () => {
  const { pool, clients } = makeMockPool();
  let calls = 0;
  const result = await withWalletTx(
    pool,
    async () => {
      calls += 1;
      if (calls === 1) {
        throw makeError("40001");
      }
      return "retry-success";
    },
    { sleepFn: async () => undefined },
  );
  assert.equal(result, "retry-success");
  assert.equal(calls, 2, "fn kalt to ganger");
  assert.equal(clients.length, 2, "to clients (én per attempt)");
  assert.equal(clients[0]!.__released, true, "første client released");
  assert.equal(clients[1]!.__released, true, "andre client released");
});

// ── Test 6: 40P01 deadlock retries akkurat som 40001 ─────────────────────────

test("withWalletTx: 40P01 deadlock retries på samme måte som 40001", async () => {
  const { pool } = makeMockPool();
  let calls = 0;
  const result = await withWalletTx(
    pool,
    async () => {
      calls += 1;
      if (calls === 1) {
        throw makeError("40P01");
      }
      return "deadlock-recovered";
    },
    { sleepFn: async () => undefined },
  );
  assert.equal(result, "deadlock-recovered");
  assert.equal(calls, 2);
});

// ── Test 7: tom for retries → kaster WALLET_SERIALIZATION_FAILURE ────────────

test("withWalletTx: 40001 fire ganger (én + tre retries) → WALLET_SERIALIZATION_FAILURE", async () => {
  const { pool, clients } = makeMockPool();
  let calls = 0;
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        calls += 1;
        throw makeError("40001");
      },
      { sleepFn: async () => undefined },
    ),
    (e: unknown) => {
      assert.ok(e instanceof WalletError, "kaster WalletError");
      assert.equal((e as WalletError).code, "WALLET_SERIALIZATION_FAILURE");
      assert.match(
        (e as WalletError).message,
        /Lommebok-operasjon kunne ikke fullføres/,
      );
      return true;
    },
  );
  // 1 initial + 3 retries = 4 fn-kall + 4 clients.
  assert.equal(calls, 4, "fn kalt 4 ganger (1 initial + 3 retries)");
  assert.equal(clients.length, 4);
  for (const c of clients) {
    assert.equal(c.__released, true, "alle clients released");
  }
});

// ── Test 8: maxRetries=0 → ingen retry ───────────────────────────────────────

test("withWalletTx: maxRetries=0 — ingen retry, kaster umiddelbart", async () => {
  const { pool } = makeMockPool();
  let calls = 0;
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        calls += 1;
        throw makeError("40001");
      },
      { maxRetries: 0, sleepFn: async () => undefined },
    ),
    (e: unknown) => e instanceof WalletError && (e as WalletError).code === "WALLET_SERIALIZATION_FAILURE",
  );
  assert.equal(calls, 1, "kun ett kall");
});

// ── Test 9: backoffMs kalles med riktig attempt-nummer ───────────────────────

test("withWalletTx: backoffMs kalles med 0,1,2 (én per retry)", async () => {
  const { pool } = makeMockPool();
  const backoffs: number[] = [];
  let calls = 0;
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        calls += 1;
        throw makeError("40001");
      },
      {
        backoffMs: (attempt) => {
          backoffs.push(attempt);
          return 1; // konstant ms
        },
        sleepFn: async () => undefined,
      },
    ),
    (e: unknown) => e instanceof WalletError,
  );
  assert.equal(calls, 4);
  // Initial fail (attempt 0) → backoffMs(0)
  // Retry 1 fail → backoffMs(1)
  // Retry 2 fail → backoffMs(2)
  // Retry 3 fail → ingen backoffMs (vi er tom for retries)
  assert.deepEqual(backoffs, [0, 1, 2], "backoffMs kalt med 0,1,2");
});

// ── Test 10: sleepFn ventes mellom retries ───────────────────────────────────

test("withWalletTx: sleepFn ventes mellom retries", async () => {
  const { pool } = makeMockPool();
  const sleeps: number[] = [];
  let calls = 0;
  const result = await withWalletTx(
    pool,
    async () => {
      calls += 1;
      if (calls < 3) throw makeError("40001");
      return "ok";
    },
    {
      backoffMs: (attempt) => 100 * (attempt + 1), // 100, 200, 300
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  // To retries skjer (etter attempt 0 og 1) — to sleeps.
  assert.deepEqual(sleeps, [100, 200], "sleepFn kalt mellom retries");
});

// ── Test 11: WalletError.INSUFFICIENT_FUNDS propageres uten retry ────────────

test("withWalletTx: WalletError fra fn (ikke pg-feil) propageres umiddelbart", async () => {
  const { pool } = makeMockPool();
  const err = new WalletError("INSUFFICIENT_FUNDS", "for lite");
  let calls = 0;
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        calls += 1;
        throw err;
      },
      { sleepFn: async () => undefined },
    ),
    (e: unknown) => e === err,
  );
  assert.equal(calls, 1, "fn kalt én gang");
});

// ── Test 12: ROLLBACK kalles ved feil ────────────────────────────────────────

test("withWalletTx: ROLLBACK kalles ved feil i fn", async () => {
  const { pool, clients } = makeMockPool();
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        throw new WalletError("OOPS", "noe gikk galt");
      },
      { sleepFn: async () => undefined },
    ),
    (e: unknown) => e instanceof WalletError,
  );
  const queries = clients[0]!.__queries;
  assert.ok(queries.includes("ROLLBACK"), "ROLLBACK kalt etter feil i fn");
  assert.ok(!queries.includes("COMMIT"), "COMMIT IKKE kalt");
});

// ── Test 13: client released selv ved retry-failure ──────────────────────────

test("withWalletTx: client.release kalles på alle attempts (resource leak-test)", async () => {
  const { pool, clients } = makeMockPool();
  await assert.rejects(
    withWalletTx(
      pool,
      async () => {
        throw makeError("40001");
      },
      { sleepFn: async () => undefined },
    ),
    (e: unknown) => e instanceof WalletError,
  );
  // 4 attempts → 4 clients → alle skal være released
  for (const c of clients) {
    assert.equal(c.__released, true);
  }
});
