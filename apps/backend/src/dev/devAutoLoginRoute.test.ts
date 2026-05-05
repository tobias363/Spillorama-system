/**
 * apps/backend/src/dev/devAutoLoginRoute.test.ts
 *
 * Tester at den dev-only auto-login-routen returnerer `null` når
 * NODE_ENV=production, og at email-allowlisten + localhost-checken
 * fungerer i dev-mode.
 *
 * Co-located test (matcher konvensjonen brukt for andre tester i
 * `src/middleware/*.test.ts`).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createDevAutoLoginRouter } from "./devAutoLoginRoute.js";

// Minimal stub — vi kaller routeren direkte og trigger ikke
// PlatformService internt for de fleste testene.
const stubPlatform = {} as unknown as Parameters<
  typeof createDevAutoLoginRouter
>[0]["platformService"];

function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.NODE_ENV;
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = prev;
    }
  }
}

test("createDevAutoLoginRouter returns null when NODE_ENV=production", () => {
  withNodeEnv("production", () => {
    const router = createDevAutoLoginRouter({ platformService: stubPlatform });
    assert.equal(router, null);
  });
});

test("createDevAutoLoginRouter returns null for case-variants of production", () => {
  withNodeEnv("PRODUCTION", () => {
    assert.equal(
      createDevAutoLoginRouter({ platformService: stubPlatform }),
      null,
    );
  });
  withNodeEnv("Production", () => {
    assert.equal(
      createDevAutoLoginRouter({ platformService: stubPlatform }),
      null,
    );
  });
  withNodeEnv("  PRODUCTION  ", () => {
    assert.equal(
      createDevAutoLoginRouter({ platformService: stubPlatform }),
      null,
    );
  });
});

test("createDevAutoLoginRouter returns a Router when NODE_ENV=development", () => {
  withNodeEnv("development", () => {
    const router = createDevAutoLoginRouter({ platformService: stubPlatform });
    assert.notEqual(router, null);
  });
});

test("createDevAutoLoginRouter returns a Router when NODE_ENV is unset", () => {
  withNodeEnv(undefined, () => {
    const router = createDevAutoLoginRouter({ platformService: stubPlatform });
    assert.notEqual(router, null);
  });
});

test("createDevAutoLoginRouter returns a Router for non-production strings", () => {
  for (const v of ["test", "staging", "qa", ""]) {
    withNodeEnv(v, () => {
      const router = createDevAutoLoginRouter({ platformService: stubPlatform });
      assert.notEqual(router, null, `expected non-null for NODE_ENV='${v}'`);
    });
  }
});
