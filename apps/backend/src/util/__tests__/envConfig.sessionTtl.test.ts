/**
 * NEW-001: tester at session-TTL default er 8 timer (wireframe-spec)
 * og at AUTH_SESSION_TTL_HOURS-env overstyrer riktig.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadBingoRuntimeConfig } from "../envConfig.js";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) previous[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("NEW-001: AUTH_SESSION_TTL_HOURS default er 8 timer (wireframe-spec)", () => {
  withEnv({ AUTH_SESSION_TTL_HOURS: undefined }, () => {
    const cfg = loadBingoRuntimeConfig();
    assert.equal(cfg.sessionTtlHours, 8, "Default skal være 8 timer per wireframe NEW-001");
  });
});

test("NEW-001: AUTH_SESSION_TTL_HOURS=168 honoreres for legacy-bakoverkompatibilitet", () => {
  withEnv({ AUTH_SESSION_TTL_HOURS: "168" }, () => {
    const cfg = loadBingoRuntimeConfig();
    assert.equal(cfg.sessionTtlHours, 168, "Override skal funke når PM ønsker legacy 7 dager");
  });
});

test("NEW-001: AUTH_SESSION_TTL_HOURS=24 honoreres for mellomverdi", () => {
  withEnv({ AUTH_SESSION_TTL_HOURS: "24" }, () => {
    const cfg = loadBingoRuntimeConfig();
    assert.equal(cfg.sessionTtlHours, 24);
  });
});
