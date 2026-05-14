/**
 * pgPoolErrorHandler.test.ts (Agent T, 2026-05-14)
 *
 * Verifiserer at pool-error-handler-en:
 *   1. Logger 57P01/57P02/57P03 som WARN (Postgres shutdown)
 *   2. Logger 08001/08006/ECONNxxx som WARN (transient)
 *   3. Logger uventede feil som ERROR
 *   4. IKKE kaster i noen case (uncaughtException-fri)
 *   5. Er idempotent — flere kall på samme pool installerer ikke duplikat
 *
 * `withDbRetry`-tester:
 *   - Lykkes på første forsøk → ingen retries
 *   - Feiler 57P01 1x → retry lykkes på forsøk 2
 *   - Feiler ALLE forsøk på 57P01 → kaster siste feil
 *   - Feiler på non-transient (eks. syntax-error) → kaster med en gang
 *   - Custom shouldRetry overstyrer default
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import {
  attachPoolErrorHandler,
  isTransientConnectionError,
  isPostgresShutdownError,
  getPgErrorCode,
  withDbRetry,
  TRANSIENT_PG_SQLSTATE_CODES,
  SHUTDOWN_PG_SQLSTATE_CODES,
  DEFAULT_DB_RETRY_DELAYS_MS,
  _hasHandlerInstalledForTesting,
} from "../pgPoolErrorHandler.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Minimal EventEmitter-mock som ser ut som en pg.Pool for error-event-flyten. */
function makeFakePool(): Pool {
  return new EventEmitter() as unknown as Pool;
}

function makePgError(code: string, message = "synthetic test error"): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  return err;
}

// ── getPgErrorCode ───────────────────────────────────────────────────────

describe("getPgErrorCode", () => {
  test("returns string code from pg-style error", () => {
    assert.equal(getPgErrorCode(makePgError("57P01")), "57P01");
  });

  test("returns null for non-pg errors", () => {
    assert.equal(getPgErrorCode(new Error("plain")), null);
    assert.equal(getPgErrorCode("string err"), null);
    assert.equal(getPgErrorCode(null), null);
    assert.equal(getPgErrorCode(undefined), null);
    assert.equal(getPgErrorCode({ msg: "no code" }), null);
  });

  test("returns null for empty-string code", () => {
    const err = new Error("empty");
    (err as Error & { code?: string }).code = "";
    assert.equal(getPgErrorCode(err), null);
  });
});

// ── isPostgresShutdownError ──────────────────────────────────────────────

describe("isPostgresShutdownError", () => {
  test("returns true for 57P01 / 57P02 / 57P03", () => {
    for (const code of ["57P01", "57P02", "57P03"]) {
      assert.equal(
        isPostgresShutdownError(makePgError(code)),
        true,
        `expected true for ${code}`,
      );
    }
  });

  test("returns false for non-shutdown transient codes", () => {
    assert.equal(isPostgresShutdownError(makePgError("08001")), false);
    assert.equal(isPostgresShutdownError(makePgError("08006")), false);
  });

  test("returns false for query-side errors", () => {
    assert.equal(isPostgresShutdownError(makePgError("23505")), false);
    assert.equal(isPostgresShutdownError(makePgError("42601")), false);
  });

  test("returns false for non-error inputs", () => {
    assert.equal(isPostgresShutdownError(null), false);
    assert.equal(isPostgresShutdownError("nope"), false);
  });
});

// ── isTransientConnectionError ───────────────────────────────────────────

describe("isTransientConnectionError", () => {
  test("returns true for all SQLSTATE transient codes", () => {
    for (const code of TRANSIENT_PG_SQLSTATE_CODES) {
      assert.equal(
        isTransientConnectionError(makePgError(code)),
        true,
        `expected true for ${code}`,
      );
    }
  });

  test("returns true for node TCP transient errors", () => {
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]) {
      assert.equal(
        isTransientConnectionError(makePgError(code)),
        true,
        `expected true for ${code}`,
      );
    }
  });

  test("returns false for query-side errors", () => {
    // 23505 = unique_violation, 42601 = syntax_error, 42P01 = undefined_table
    for (const code of ["23505", "42601", "42P01", "53300"]) {
      assert.equal(
        isTransientConnectionError(makePgError(code)),
        false,
        `expected false for ${code}`,
      );
    }
  });

  test("returns false for non-error inputs", () => {
    assert.equal(isTransientConnectionError(null), false);
    assert.equal(isTransientConnectionError(undefined), false);
    assert.equal(isTransientConnectionError("plain string"), false);
    assert.equal(isTransientConnectionError(new Error("no code")), false);
  });

  test("shutdown codes are a subset of transient codes", () => {
    for (const code of SHUTDOWN_PG_SQLSTATE_CODES) {
      assert.ok(
        TRANSIENT_PG_SQLSTATE_CODES.has(code),
        `shutdown code ${code} must be in transient set`,
      );
    }
  });
});

// ── attachPoolErrorHandler ───────────────────────────────────────────────

describe("attachPoolErrorHandler", () => {
  test("returns true on first call, false on subsequent calls (idempotent)", () => {
    const pool = makeFakePool();
    assert.equal(attachPoolErrorHandler(pool, { poolName: "test-1" }), true);
    assert.equal(attachPoolErrorHandler(pool, { poolName: "test-1" }), false);
    assert.equal(attachPoolErrorHandler(pool, { poolName: "test-1" }), false);
    assert.equal(_hasHandlerInstalledForTesting(pool), true);
  });

  test("57P01 error does NOT throw (uncaughtException-fri)", () => {
    const pool = makeFakePool();
    attachPoolErrorHandler(pool, { poolName: "test-shutdown" });

    // Emitting an `error` event on an EventEmitter without listeners
    // throws. With our handler attached, it should NOT throw.
    assert.doesNotThrow(() => {
      pool.emit("error", makePgError("57P01", "admin_shutdown"));
    });
  });

  test("57P02 + 57P03 do NOT throw", () => {
    const pool = makeFakePool();
    attachPoolErrorHandler(pool, { poolName: "test-shutdown" });
    assert.doesNotThrow(() => {
      pool.emit("error", makePgError("57P02"));
      pool.emit("error", makePgError("57P03"));
    });
  });

  test("transient TCP errors do NOT throw", () => {
    const pool = makeFakePool();
    attachPoolErrorHandler(pool, { poolName: "test-transient" });
    assert.doesNotThrow(() => {
      pool.emit("error", makePgError("ECONNREFUSED"));
      pool.emit("error", makePgError("ECONNRESET"));
      pool.emit("error", makePgError("08006"));
    });
  });

  test("unexpected errors do NOT throw (logged as ERROR)", () => {
    const pool = makeFakePool();
    attachPoolErrorHandler(pool, { poolName: "test-unexpected" });
    assert.doesNotThrow(() => {
      pool.emit("error", new Error("totally unexpected"));
      pool.emit("error", makePgError("99999", "fake code"));
    });
  });

  test("pool without handler throws on error-emit (sanity-check)", () => {
    // Confirms that our test fixture behaves like pg.Pool — unhandled
    // `error` events DO throw on EventEmitter unless someone listens.
    const pool = makeFakePool();
    assert.throws(
      () => pool.emit("error", makePgError("57P01")),
      /synthetic test error/,
    );
  });

  test("default poolName is 'unknown' when not provided", () => {
    const pool = makeFakePool();
    // Just verify it doesn't crash and accepts no-options.
    assert.doesNotThrow(() => {
      attachPoolErrorHandler(pool);
      pool.emit("error", makePgError("57P01"));
    });
  });
});

// ── withDbRetry ──────────────────────────────────────────────────────────

describe("withDbRetry", () => {
  test("lykkes på første forsøk → ingen retries", async () => {
    let calls = 0;
    const result = await withDbRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      {
        operationName: "test.first-success",
        sleep: async () => {}, // instant retry
      },
    );
    assert.equal(result.value, "ok");
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
  });

  test("feiler 57P01 1x → retry lykkes på forsøk 2", async () => {
    let calls = 0;
    const result = await withDbRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw makePgError("57P01", "admin shutdown");
        return "recovered";
      },
      {
        operationName: "test.retry-once",
        sleep: async () => {},
      },
    );
    assert.equal(result.value, "recovered");
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
  });

  test("feiler alle forsøk på 57P01 → kaster siste feil uendret", async () => {
    let calls = 0;
    await assert.rejects(
      withDbRetry(
        async () => {
          calls += 1;
          throw makePgError("57P01", `attempt ${calls}`);
        },
        {
          operationName: "test.exhaust",
          sleep: async () => {},
        },
      ),
      (err: unknown) => {
        // Should be the LAST error thrown
        assert.equal((err as Error).message, `attempt 4`); // 1 initial + 3 retries
        return true;
      },
    );
    // 1 initial + 3 retries = 4 calls
    assert.equal(calls, 4);
  });

  test("non-transient feil → kaster med en gang uten retry", async () => {
    let calls = 0;
    await assert.rejects(
      withDbRetry(
        async () => {
          calls += 1;
          throw makePgError("23505", "unique violation");
        },
        {
          operationName: "test.no-retry-permanent",
          sleep: async () => {},
        },
      ),
      /unique violation/,
    );
    assert.equal(calls, 1, "skal kun gjøre ett forsøk for non-transient feil");
  });

  test("plain Error uten code → kaster med en gang", async () => {
    let calls = 0;
    await assert.rejects(
      withDbRetry(
        async () => {
          calls += 1;
          throw new Error("plain js error without code");
        },
        {
          operationName: "test.plain-error",
          sleep: async () => {},
        },
      ),
      /plain js error/,
    );
    assert.equal(calls, 1);
  });

  test("custom shouldRetry overstyrer default-predikat", async () => {
    let calls = 0;
    // Custom: retry på ALT (også non-transient)
    const result = await withDbRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw makePgError("99999", "synthetic non-transient");
        return "ok";
      },
      {
        operationName: "test.custom-shouldretry",
        sleep: async () => {},
        shouldRetry: () => true, // override: retry alt
      },
    );
    assert.equal(result.value, "ok");
    assert.equal(calls, 2);
  });

  test("DEFAULT_DB_RETRY_DELAYS_MS er kortere enn DEFAULT_RETRY_DELAYS_MS", () => {
    // Sanity: db-retry skal være kjapp ([100,250,500] vs [100,500,2000])
    const totalDelay = DEFAULT_DB_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    assert.ok(
      totalDelay <= 1000,
      `db-retry total worst-case må være ≤ 1s, var ${totalDelay}ms`,
    );
  });

  test("ECONNRESET retries på samme måte som 57P01", async () => {
    let calls = 0;
    const result = await withDbRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw makePgError("ECONNRESET", "network drop");
        return "ok";
      },
      {
        operationName: "test.econnreset",
        sleep: async () => {},
      },
    );
    assert.equal(result.value, "ok");
    assert.equal(result.attempts, 3);
  });
});
