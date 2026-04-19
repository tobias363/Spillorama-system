/**
 * BIN-665: unit-tester for HallGroupService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminHallGroups.test.ts) stubber ut
 * service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres. Vi bruker Object.create-pattern for å unngå faktisk
 * oppkopling — testene kaller assert-funksjoner indirekte via
 * create()/update() og forventer DomainError.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { HallGroupService } from "./HallGroupService.js";
import { DomainError } from "../game/BingoEngine.js";

/**
 * Bygger en "service" der ensureInitialized er no-op og pool-query er
 * throw-on-reach. Alle validerings-feil skal komme før vi treffer pool.
 */
function makeValidatingService(): HallGroupService {
  const svc = Object.create(HallGroupService.prototype) as HallGroupService;
  const stubPool = {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  (svc as unknown as { referenceChecker: null }).referenceChecker = null;
  return svc;
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    if (expectedCode) {
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
    }
  }
}

// ── create-validering ───────────────────────────────────────────────────────

test("BIN-665 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () => svc.create({ name: "", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser whitespace-only name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "whitespace name",
    () => svc.create({ name: "   ", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser name > 200 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "too long name",
    () => svc.create({ name: "x".repeat(201), createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () => svc.create({ name: "Group A", createdBy: "" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        name: "Group A",
        status: "running" as "active",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser negativ tvId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative tvId",
    () => svc.create({ name: "Group A", tvId: -1, createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser non-integer tvId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "float tvId",
    () => svc.create({ name: "Group A", tvId: 3.5, createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser hallIds som ikke-array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-array hallIds",
    () =>
      svc.create({
        name: "Group A",
        hallIds: "hall-1" as unknown as string[],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser hallIds med tom streng", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty string in hallIds",
    () =>
      svc.create({
        name: "Group A",
        hallIds: ["hall-1", "  "],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser productIds med non-string-element", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-string productId",
    () =>
      svc.create({
        name: "Group A",
        productIds: ["p-1", 42 as unknown as string],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() avviser extra som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array extra",
    () =>
      svc.create({
        name: "Group A",
        extra: ["not", "valid"] as unknown as Record<string, unknown>,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: create() aksepterer null tvId (kolonne nullable)", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      name: "Group A",
      tvId: null,
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`tvId=null skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "validering skulle ha godtatt tvId=null");
});

test("BIN-665 service: create() godtar gyldig input (skal treffe pool)", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      name: "Østlandet",
      hallIds: ["hall-1", "hall-2"],
      status: "active",
      tvId: 42,
      productIds: ["p-1"],
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`gyldig input skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "gyldig input skulle ha passert validering");
});

test("BIN-665 service: create() dedupliserer hallIds", async () => {
  const svc = makeValidatingService();
  // Dedup skjer i validerings-laget; forventer UNEXPECTED_POOL_CALL etter dedup.
  let reachedPool = false;
  try {
    await svc.create({
      name: "Group dup",
      hallIds: ["hall-1", "hall-1", "hall-2"],
      createdBy: "u-1",
    });
  } catch (err) {
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "dedup skulle ikke feile på validering");
});

// ── update-validering (via stub get()) ─────────────────────────────────────

test("BIN-665 service: update() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.update("", { name: "Ny" }),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: update() avviser når ingen endringer er oppgitt", async () => {
  // Vi stubber get() til å returnere et objekt, slik at vi treffer validering
  // på tomt update-sett.
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "g-1",
    deletedAt: null,
  });
  await expectDomainError(
    "no changes",
    () => svc.update("g-1", {}),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: update() avviser slettet gruppe", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "g-1",
    deletedAt: "2026-04-01T00:00:00Z",
  });
  await expectDomainError(
    "deleted group",
    () => svc.update("g-1", { name: "Ny" }),
    "HALL_GROUP_DELETED"
  );
});

// ── remove-validering ───────────────────────────────────────────────────────

test("BIN-665 service: remove() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for remove",
    () => svc.remove(""),
    "INVALID_INPUT"
  );
});

test("BIN-665 service: remove() avviser allerede slettet gruppe", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "g-1",
    deletedAt: "2026-04-01T00:00:00Z",
  });
  await expectDomainError(
    "already deleted",
    () => svc.remove("g-1"),
    "HALL_GROUP_DELETED"
  );
});

test("BIN-665 service: remove(hard=true) blokkeres hvis referenceChecker returnerer true", async () => {
  const svc = Object.create(HallGroupService.prototype) as HallGroupService;
  const stubPool = {
    query: async () => ({ rows: [] }),
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  (svc as unknown as { referenceChecker: (id: string) => Promise<boolean> }).referenceChecker =
    async () => true;
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "g-1",
    deletedAt: null,
  });

  await expectDomainError(
    "hard delete blocked",
    () => svc.remove("g-1", { hard: true }),
    "HALL_GROUP_IN_USE"
  );
});

// ── constructor-validering ──────────────────────────────────────────────────

test("BIN-665 service: constructor avviser blank connection string", () => {
  assert.throws(
    () => new HallGroupService({ connectionString: "  " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("BIN-665 service: constructor avviser skjema med ugyldig navn", () => {
  assert.throws(
    () =>
      new HallGroupService({
        connectionString: "postgres://x",
        schema: "drop-table; --",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

// ── forTesting-hook ────────────────────────────────────────────────────────

test("BIN-665 service: forTesting() lager instans uten å åpne pool", () => {
  const fakePool = { query: async () => ({ rows: [] }) } as unknown as import("pg").Pool;
  const svc = HallGroupService.forTesting(fakePool, "public");
  assert.ok(svc instanceof HallGroupService);
});

test("BIN-665 service: forTesting() avviser ugyldig schema-navn", () => {
  const fakePool = { query: async () => ({ rows: [] }) } as unknown as import("pg").Pool;
  assert.throws(
    () => HallGroupService.forTesting(fakePool, "drop table;"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

// ── get() validering ────────────────────────────────────────────────────────

test("BIN-665 service: get() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for get",
    () => svc.get(""),
    "INVALID_INPUT"
  );
});
