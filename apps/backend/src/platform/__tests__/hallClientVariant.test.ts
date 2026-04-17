/**
 * BIN-540: unit tests for PlatformService.getHallClientVariant.
 *
 * Doesn't hit a real Postgres. We stub `getHall` on a real PlatformService
 * instance constructed via a minimal options shim, then call the cache
 * method directly.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PlatformService, type HallDefinition, type HallClientVariant } from "../PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

function makeHall(variant: HallClientVariant, id = "hall-a"): HallDefinition {
  return {
    id,
    slug: id,
    name: "Test Hall",
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: variant,
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
  };
}

/**
 * Build a PlatformService instance with getHall stubbed and
 * ensureInitialized neutered. This runs through the real cache + fail-safe
 * code without needing a live database.
 */
function makeService(initialVariant: HallClientVariant, opts: { failNext?: number } = {}) {
  const walletAdapter: Partial<WalletAdapter> = {};
  // The real constructor wants a PG connection string and immediately kicks
  // off an async init. We dodge the init by mocking `ensureInitialized`
  // after construction. The pool never gets used because our stubbed
  // getHall doesn't touch it.
  const svc = new PlatformService(walletAdapter as WalletAdapter, {
    connectionString: "postgres://bin540-noop/noop",
    schema: "public",
    sessionTtlHours: 1,
    minAgeYears: 18,
    // kycAdapter shape doesn't matter for these tests — getHallClientVariant
    // only calls getHall, which we stub.
    kycAdapter: { verify: async () => ({ ok: true }) } as unknown as ConstructorParameters<typeof PlatformService>[1]["kycAdapter"],
  });
  const svcInternal = svc as unknown as {
    ensureInitialized: () => Promise<void>;
    getHall: (ref: string) => Promise<HallDefinition>;
  };
  svcInternal.ensureInitialized = async () => { /* noop */ };

  const state = { variant: initialVariant, calls: 0, failNext: opts.failNext ?? 0 };
  svcInternal.getHall = async () => {
    state.calls += 1;
    if (state.failNext > 0) {
      state.failNext -= 1;
      throw new Error("simulated DB outage");
    }
    return makeHall(state.variant);
  };

  return { svc, state };
}

test("BIN-540: returns the configured variant", async () => {
  const { svc } = makeService("web");
  assert.equal(await svc.getHallClientVariant("hall-a"), "web");
});

test("BIN-540: caches for the TTL window (no second DB call)", async () => {
  const { svc, state } = makeService("web");
  await svc.getHallClientVariant("hall-a");
  await svc.getHallClientVariant("hall-a");
  await svc.getHallClientVariant("hall-a");
  assert.equal(state.calls, 1, "should hit DB exactly once within the TTL window");
});

test("BIN-540: clearClientVariantCache forces a fresh read", async () => {
  const { svc, state } = makeService("web");
  await svc.getHallClientVariant("hall-a");
  svc.clearClientVariantCache();
  await svc.getHallClientVariant("hall-a");
  assert.equal(state.calls, 2);
});

test("BIN-540: fails CLOSED to 'unity' on DB error", async () => {
  const { svc } = makeService("web", { failNext: 1 });
  const result = await svc.getHallClientVariant("hall-a");
  assert.equal(result, "unity", "fallback must always be unity, never silently grant web");
});

test("BIN-540: flipping variant in DB is not visible until cache clears", async () => {
  const { svc, state } = makeService("unity");
  assert.equal(await svc.getHallClientVariant("hall-a"), "unity");
  state.variant = "web"; // simulate DBA flip
  assert.equal(await svc.getHallClientVariant("hall-a"), "unity", "cached value wins until TTL");
  svc.clearClientVariantCache();
  assert.equal(await svc.getHallClientVariant("hall-a"), "web", "after clear, fresh read");
});
