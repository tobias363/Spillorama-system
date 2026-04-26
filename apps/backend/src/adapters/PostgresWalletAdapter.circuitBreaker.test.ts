/**
 * HIGH-8: integration tests for the circuit breaker around
 * `PostgresWalletAdapter` write paths.
 *
 * Strategy: construct the real adapter with a dummy connection string,
 * then replace its private `pool` with a stub whose `connect()` and
 * `query()` we control. This lets us drive the breaker through CLOSED →
 * OPEN → HALF_OPEN → CLOSED transitions deterministically without a
 * live Postgres instance.
 *
 * Coverage matrix (matches HIGH-8 spec — 4–5 tests):
 *   1. 3 consecutive write failures → state OPEN.
 *   2. Under OPEN: subsequent writes fail-fast with WALLET_CIRCUIT_OPEN
 *      (Norwegian message) and the underlying pool is never called.
 *   3. HALF-OPEN probe succeeds → state returns to CLOSED.
 *   4. Threshold counter resets on a single success — must take another
 *      full burst of failures to re-open.
 *   5. Breaker can be disabled via constructor option (backwards-compat).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { PostgresWalletAdapter } from "./PostgresWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Pool stub ──────────────────────────────────────────────────────────────
//
// Mimics the surface area of `pg.Pool` that PostgresWalletAdapter actually
// uses. The stub keeps a programmable failure-mode so tests can swap
// between "every call rejects" and "every call resolves" without
// re-instantiating the adapter.

interface StubMode {
  /** When true, both `pool.query` and any client query reject. */
  failing: boolean;
  /** Optional artificial delay before resolve/reject (ms). */
  delayMs?: number;
}

function makePoolStub(mode: StubMode) {
  let connectCalls = 0;
  let queryCalls = 0;

  const runOnce = async <T,>(value: T): Promise<T> => {
    if (mode.delayMs && mode.delayMs > 0) {
      await wait(mode.delayMs);
    }
    if (mode.failing) {
      throw new Error("simulated DB outage");
    }
    return value;
  };

  const fakeClient = {
    query: async (_text: string, _params?: unknown[]) => {
      queryCalls++;
      return runOnce({ rows: [], rowCount: 0 });
    },
    release: () => {},
  };

  const pool = {
    connect: async () => {
      connectCalls++;
      if (mode.failing) {
        if (mode.delayMs && mode.delayMs > 0) await wait(mode.delayMs);
        throw new Error("simulated DB outage");
      }
      return fakeClient;
    },
    query: async (_text: string, _params?: unknown[]) => {
      queryCalls++;
      return runOnce({ rows: [], rowCount: 0 });
    },
    end: async () => {},
  };

  return {
    pool,
    counters: {
      get connectCalls() { return connectCalls; },
      get queryCalls() { return queryCalls; },
    },
  };
}

function adapterWithStub(stub: ReturnType<typeof makePoolStub>, opts?: {
  threshold?: number;
  resetMs?: number;
  enabled?: boolean;
}) {
  const adapter = new PostgresWalletAdapter({
    connectionString: "postgres://stub:stub@127.0.0.1:1/stub",
    schema: "public",
    circuitBreaker: {
      threshold: opts?.threshold ?? 3,
      resetMs: opts?.resetMs ?? 30_000,
      enabled: opts?.enabled ?? true,
    },
  });
  // Replace internal pool + short-circuit init so the adapter never tries
  // to talk to a real DB. Both fields are private but the test owns the
  // instance; cast to bypass TypeScript visibility for test instrumentation.
  const a = adapter as unknown as {
    pool: unknown;
    initPromise: Promise<void> | null;
  };
  a.pool = stub.pool;
  a.initPromise = Promise.resolve();
  return adapter;
}

// ── Test 1: 3 consecutive failures → OPEN ──────────────────────────────────

test("HIGH-8 wallet breaker: 3 consecutive failures → OPEN", async () => {
  const stub = makePoolStub({ failing: true });
  const adapter = adapterWithStub(stub, { threshold: 3, resetMs: 60_000 });

  // First two failures pass through and bubble up DB errors.
  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      adapter.topUp("player-x", 100, "test"),
      (err: unknown) => err instanceof WalletError,
    );
  }

  assert.equal(adapter.getCircuitState(), "OPEN");
});

// ── Test 2: fail-fast under OPEN with Norwegian error ──────────────────────

test("HIGH-8 wallet breaker: under OPEN — WALLET_CIRCUIT_OPEN, pool untouched", async () => {
  const stub = makePoolStub({ failing: true });
  const adapter = adapterWithStub(stub, { threshold: 2, resetMs: 60_000 });

  // Drive into OPEN.
  await assert.rejects(adapter.topUp("p", 10, "x"));
  await assert.rejects(adapter.topUp("p", 10, "x"));
  assert.equal(adapter.getCircuitState(), "OPEN");

  const connectsBefore = stub.counters.connectCalls;

  // Subsequent call must fail fast with the Norwegian-language error
  // and never reach the pool.
  const err = await adapter
    .topUp("p", 10, "x")
    .then(() => null, (e: unknown) => e);
  assert.ok(err instanceof WalletError);
  assert.equal((err as WalletError).code, "WALLET_CIRCUIT_OPEN");
  assert.match(
    (err as WalletError).message,
    /Lommebok midlertidig utilgjengelig/,
    "Norwegian fail-fast message exposed to caller",
  );
  assert.equal(stub.counters.connectCalls, connectsBefore, "pool was not touched");
});

// ── Test 3: HALF-OPEN probe success → CLOSED ───────────────────────────────

test("HIGH-8 wallet breaker: HALF-OPEN probe success → CLOSED", async () => {
  const mode: StubMode = { failing: true };
  const stub = makePoolStub(mode);
  const adapter = adapterWithStub(stub, { threshold: 2, resetMs: 20 });

  await assert.rejects(adapter.topUp("p", 10, "x"));
  await assert.rejects(adapter.topUp("p", 10, "x"));
  assert.equal(adapter.getCircuitState(), "OPEN");

  // Cool-down — we don't actually run the probe yet, just observe the
  // breaker auto-flips its derived state.
  await wait(25);
  assert.equal(adapter.getCircuitState(), "HALF_OPEN");

  // Recovery: stub starts succeeding. The next write goes through as
  // the probe, succeeds, and closes the breaker.
  mode.failing = false;
  // Note: topUp internally calls ensureAccount → getAccount, which uses
  // pool.query and sees the un-failing stub. The probe call counts as
  // success for the breaker (no row is needed for assertion). We only
  // care about the breaker state transition.
  // The stub returns rows: [] for every query, which makes the adapter
  // throw ACCOUNT_NOT_FOUND inside ensureAccount — but that's still a
  // WalletError, NOT a transient failure, so the breaker should treat
  // it as success. To avoid that ambiguity, we exercise a method that
  // doesn't depend on row content: expireStaleReservations.
  await adapter.expireStaleReservations(Date.now());
  assert.equal(adapter.getCircuitState(), "CLOSED");
});

// ── Test 4: success resets the failure counter ─────────────────────────────

test("HIGH-8 wallet breaker: success in CLOSED resets failure counter", async () => {
  const mode: StubMode = { failing: true };
  const stub = makePoolStub(mode);
  const adapter = adapterWithStub(stub, { threshold: 3, resetMs: 60_000 });

  // Two failures — almost OPEN.
  await assert.rejects(adapter.expireStaleReservations(Date.now()));
  await assert.rejects(adapter.expireStaleReservations(Date.now()));
  assert.equal(adapter.getCircuitState(), "CLOSED");

  // One success — counter resets.
  mode.failing = false;
  await adapter.expireStaleReservations(Date.now());
  assert.equal(adapter.getCircuitState(), "CLOSED");

  // Two more failures — still CLOSED because we need 3 in a row.
  mode.failing = true;
  await assert.rejects(adapter.expireStaleReservations(Date.now()));
  await assert.rejects(adapter.expireStaleReservations(Date.now()));
  assert.equal(adapter.getCircuitState(), "CLOSED", "only 2 consecutive — not yet open");

  // Third → OPEN.
  await assert.rejects(adapter.expireStaleReservations(Date.now()));
  assert.equal(adapter.getCircuitState(), "OPEN");
});

// ── Test 5: breaker can be disabled (backwards-compat) ─────────────────────

test("HIGH-8 wallet breaker: enabled=false bypasses breaker entirely", async () => {
  const stub = makePoolStub({ failing: true });
  const adapter = adapterWithStub(stub, { threshold: 2, enabled: false });

  // 5 failures — would have opened a 2-threshold breaker — but it's off.
  for (let i = 0; i < 5; i++) {
    await assert.rejects(adapter.expireStaleReservations(Date.now()));
  }
  assert.equal(
    adapter.getCircuitState(),
    null,
    "breaker disabled → getCircuitState returns null",
  );
});
