/**
 * BIN-540: PlatformService.updateHall admin-flip tests for clientVariant.
 *
 * Stubs the underlying pg pool + ensureInitialized so we can assert
 * validation + cache-invalidation behaviour without a live database.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PlatformService, type HallDefinition, type HallClientVariant } from "../PlatformService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

function makeHallRow(variant: HallClientVariant, id = "hall-a") {
  const now = "2026-04-18T00:00:00Z";
  return {
    id,
    slug: id,
    name: "Test Hall",
    region: "NO",
    address: "",
    organization_number: null,
    settlement_account: null,
    invoice_method: null,
    is_active: true,
    client_variant: variant,
    tv_url: null,
    created_at: now,
    updated_at: now,
  };
}

function makeService(initialVariant: HallClientVariant) {
  const svc = new PlatformService({} as WalletAdapter, {
    connectionString: "postgres://noop/noop",
    schema: "public",
    sessionTtlHours: 1,
    minAgeYears: 18,
    kycAdapter: { verify: async () => ({ ok: true }) } as unknown as ConstructorParameters<typeof PlatformService>[1]["kycAdapter"],
  });

  const state = {
    row: makeHallRow(initialVariant),
    updateCalls: [] as Array<{ sql: string; params: unknown[] }>,
  };

  // Stub internals to skip DB entirely
  const svcInternal = svc as unknown as {
    ensureInitialized: () => Promise<void>;
    resolveHallRowByReference: (ref: string) => Promise<unknown>;
    pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  };
  svcInternal.ensureInitialized = async () => { /* noop */ };
  svcInternal.resolveHallRowByReference = async () => state.row;
  svcInternal.pool = {
    query: async (sql: string, params: unknown[] = []) => {
      state.updateCalls.push({ sql, params });
      if (sql.includes("SELECT id FROM") && sql.includes("WHERE slug = $1")) {
        // slug-conflict check — pretend no conflict
        return { rows: [] };
      }
      // UPDATE RETURNING * — mutate row state and return it
      if (sql.includes("UPDATE") && sql.includes("RETURNING *")) {
        // params order: [id, slug, name, region, address, org, settle, inv, isActive, clientVariant]
        state.row = {
          ...state.row,
          slug: params[1] as string,
          name: params[2] as string,
          client_variant: params[9] as HallClientVariant,
        };
        return { rows: [state.row] };
      }
      return { rows: [] };
    },
  };

  return { svc, state };
}

test("BIN-540 updateHall: accepts 'web' and persists it", async () => {
  const { svc, state } = makeService("unity");
  const updated = await svc.updateHall("hall-a", { clientVariant: "web" });
  assert.equal(updated.clientVariant, "web");
  assert.equal(state.row.client_variant, "web");
});

test("BIN-540 updateHall: accepts 'unity-fallback'", async () => {
  const { svc } = makeService("web");
  const updated = await svc.updateHall("hall-a", { clientVariant: "unity-fallback" });
  assert.equal(updated.clientVariant, "unity-fallback");
});

test("BIN-540 updateHall: round-trip unity→web→unity", async () => {
  const { svc } = makeService("unity");
  const a = await svc.updateHall("hall-a", { clientVariant: "web" });
  assert.equal(a.clientVariant, "web");
  const b = await svc.updateHall("hall-a", { clientVariant: "unity" });
  assert.equal(b.clientVariant, "unity");
});

test("BIN-540 updateHall: rejects invalid clientVariant with INVALID_INPUT", async () => {
  const { svc } = makeService("unity");
  await assert.rejects(
    svc.updateHall("hall-a", { clientVariant: "typo" as HallClientVariant }),
    (err: unknown) => {
      const e = err as { code?: string; message?: string };
      assert.equal(e.code, "INVALID_INPUT");
      assert.ok(e.message?.includes("clientVariant"));
      return true;
    }
  );
});

test("BIN-540 updateHall: rejects non-string clientVariant", async () => {
  const { svc } = makeService("unity");
  await assert.rejects(
    svc.updateHall("hall-a", { clientVariant: 42 as unknown as HallClientVariant }),
    (err: unknown) => (err as { code?: string }).code === "INVALID_INPUT"
  );
});

test("BIN-540 updateHall: leaves clientVariant unchanged when omitted", async () => {
  const { svc } = makeService("web");
  const updated = await svc.updateHall("hall-a", { name: "Renamed" });
  assert.equal(updated.clientVariant, "web", "existing variant preserved");
});

test("BIN-540 updateHall: invalidates client-variant cache so next read is fresh", async () => {
  const { svc } = makeService("unity");
  // Prime the cache with a read (which stubs return unity)
  const svcInternal = svc as unknown as { getHall: (ref: string) => Promise<HallDefinition> };
  svcInternal.getHall = async () => ({
    id: "hall-a", slug: "hall-a", name: "x", region: "NO", address: "",
    isActive: true, clientVariant: "unity",
    createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z",
  });
  assert.equal(await svc.getHallClientVariant("hall-a"), "unity");

  // Flip via updateHall; subsequent read should re-fetch
  await svc.updateHall("hall-a", { clientVariant: "web" });
  // Stub getHall to return new value
  svcInternal.getHall = async () => ({
    id: "hall-a", slug: "hall-a", name: "x", region: "NO", address: "",
    isActive: true, clientVariant: "web",
    createdAt: "2026-04-18T00:00:00Z", updatedAt: "2026-04-18T00:00:00Z",
  });
  const after = await svc.getHallClientVariant("hall-a");
  assert.equal(after, "web", "cache must be invalidated after clientVariant flip");
});
