/**
 * sharedPool.test.ts
 *
 * Unit tests for the shared-pool singleton. We don't need a live DB to
 * verify the lifecycle contract — the underlying `pg.Pool` doesn't open
 * a connection until you actually run a query, so `initSharedPool()` is
 * pure config + event-listener wiring.
 *
 * What we verify:
 *   * `initSharedPool()` returns a Pool and stores it as the singleton.
 *   * Calling `initSharedPool()` twice throws.
 *   * `getSharedPool()` throws before init, returns the same instance after.
 *   * `hasSharedPool()` reflects the lifecycle.
 *   * `closeSharedPool()` resets the singleton so a re-init works.
 *   * Empty connection-string is rejected.
 *
 * What we don't verify here (covered by integration tests):
 *   * statement_timeout actually applies on the server side.
 *   * Pool error-event handler logs without crashing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closeSharedPool,
  getSharedPool,
  hasSharedPool,
  initSharedPool,
  _setSharedPoolForTesting,
} from "../sharedPool.js";

const FAKE_CONN = "postgres://test:test@localhost:5432/test_doesnotexist";

test("getSharedPool throws before initSharedPool is called", () => {
  _setSharedPoolForTesting(null);
  assert.throws(
    () => getSharedPool(),
    /getSharedPool\(\) called before initSharedPool/
  );
  assert.equal(hasSharedPool(), false);
});

test("initSharedPool returns a Pool, getSharedPool returns same instance", async () => {
  _setSharedPoolForTesting(null);
  const pool = initSharedPool({ connectionString: FAKE_CONN });
  try {
    assert.ok(pool, "initSharedPool returned falsy");
    assert.equal(getSharedPool(), pool, "getSharedPool returned different instance");
    assert.equal(hasSharedPool(), true);
  } finally {
    await closeSharedPool();
  }
});

test("initSharedPool rejects empty connection string", () => {
  _setSharedPoolForTesting(null);
  assert.throws(
    () => initSharedPool({ connectionString: "" }),
    /connectionString must not be empty/
  );
  assert.throws(
    () => initSharedPool({ connectionString: "   " }),
    /connectionString must not be empty/
  );
});

test("initSharedPool throws when called twice", async () => {
  _setSharedPoolForTesting(null);
  initSharedPool({ connectionString: FAKE_CONN });
  try {
    assert.throws(
      () => initSharedPool({ connectionString: FAKE_CONN }),
      /initSharedPool\(\) called twice/
    );
  } finally {
    await closeSharedPool();
  }
});

test("closeSharedPool resets the singleton so re-init works", async () => {
  _setSharedPoolForTesting(null);
  const pool1 = initSharedPool({ connectionString: FAKE_CONN });
  await closeSharedPool();
  assert.equal(hasSharedPool(), false);
  const pool2 = initSharedPool({ connectionString: FAKE_CONN });
  try {
    assert.notEqual(pool1, pool2, "expected fresh pool instance after close");
  } finally {
    await closeSharedPool();
  }
});

test("statementTimeoutMs override is accepted", async () => {
  _setSharedPoolForTesting(null);
  // Just verifying the API accepts the option — actual timeout is
  // applied on first connect, which we don't trigger in this unit test.
  const pool = initSharedPool({ connectionString: FAKE_CONN, statementTimeoutMs: 5_000 });
  try {
    assert.ok(pool);
  } finally {
    await closeSharedPool();
  }
});

test("statementTimeoutMs=0 disables the timeout (no throw)", async () => {
  _setSharedPoolForTesting(null);
  const pool = initSharedPool({ connectionString: FAKE_CONN, statementTimeoutMs: 0 });
  try {
    assert.ok(pool);
  } finally {
    await closeSharedPool();
  }
});
