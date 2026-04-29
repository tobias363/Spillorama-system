/**
 * BIN-622: unit-tester for GameManagementService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminGameManagement.test.ts) stubber
 * ut service. Denne filen verifiserer at selve service-laget avviser
 * ugyldig input før det når Postgres, og at validerings-meldinger er
 * konsistente. Vi bruker Object.create-pattern for å unngå faktisk
 * Postgres-oppkopling — testene kaller assert-funksjoner indirekte via
 * create()/update() og forventer DomainError.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { GameManagementService } from "./GameManagementService.js";
import { DomainError } from "../errors/DomainError.js";

/**
 * Bygger en "service" der ensureInitialized er no-op og pool-query er
 * throw-on-reach. Alle validerings-feil skal komme før vi treffer pool.
 */
function makeValidatingService(): GameManagementService {
  const svc = Object.create(GameManagementService.prototype) as GameManagementService;
  const stubPool = {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
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

test("BIN-622 service: create() avviser tom gameTypeId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty gameTypeId",
    () =>
      svc.create({
        gameTypeId: "",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "   ",
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser name > 200 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "too long name",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "x".repeat(201),
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser ticketPrice < 0", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative price",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        ticketPrice: -100,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser ikke-heltall ticketPrice", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "float price",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        ticketPrice: 1.5,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser ugyldig ticketType", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad ticket type",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        ticketType: "Medium" as "Large",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() godtar null ticketType", async () => {
  const svc = makeValidatingService();
  // Dette treffer pool-query (som throw), men validerings-sjekk må passere
  // først — vi forventer "UNEXPECTED_POOL_CALL"-Error, ikke DomainError.
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "bingo",
      name: "Test",
      startDate: "2026-05-01T10:00:00Z",
      ticketType: null,
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`null ticketType skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "validerings-lag skulle ha godtatt null ticketType");
});

test("BIN-622 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        status: "banana" as "active",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser ugyldig ISO startDate", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad startDate",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "not-a-date",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser endDate < startDate", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "endDate before startDate",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        endDate: "2026-04-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser config som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array config",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        config: ["not", "valid"] as unknown as Record<string, unknown>,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-622 service: create() avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () =>
      svc.create({
        gameTypeId: "bingo",
        name: "Test",
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "",
      }),
    "INVALID_INPUT"
  );
});

// ── repeat-validering (via create) ──────────────────────────────────────────

test("BIN-622 service: constructor avviser blank connection string", () => {
  assert.throws(
    () => new GameManagementService({ connectionString: "  " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("BIN-622 service: constructor avviser skjema med ugyldig navn", () => {
  assert.throws(
    () =>
      new GameManagementService({
        connectionString: "postgres://x",
        schema: "drop-table; --",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});
