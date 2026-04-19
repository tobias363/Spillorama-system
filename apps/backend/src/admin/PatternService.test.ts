/**
 * BIN-627: unit-tester for PatternService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminPatterns.test.ts) stubber ut
 * service. Denne filen verifiserer at selve service-laget avviser ugyldig
 * input før det når Postgres, og at bitmask-validering holder (0 ≤ mask <
 * 2^25). Vi bruker Object.create-pattern for å unngå faktisk Postgres-
 * oppkopling — testene kaller assert-funksjoner indirekte via
 * create()/update() og forventer DomainError.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PatternService } from "./PatternService.js";
import { DomainError } from "../game/BingoEngine.js";

/**
 * Bygger en "service" der ensureInitialized er no-op og pool-query er
 * throw-on-reach. Alle validerings-feil skal komme før vi treffer pool.
 */
function makeValidatingService(): PatternService {
  const svc = Object.create(PatternService.prototype) as PatternService;
  const stubPool = {
    query: async () => {
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

test("BIN-627 service: create() avviser tom gameTypeId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty gameTypeId",
    () =>
      svc.create({
        gameTypeId: "",
        name: "Line 1",
        mask: 31,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "   ",
        mask: 31,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser name > 200 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "too long name",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "x".repeat(201),
        mask: 31,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser negativ mask", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative mask",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: -1,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser mask = 2^25 (over grensen)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "mask too large",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 0x2000000, // 2^25 = 33554432, eksklusiv grense
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser non-integer mask", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "float mask",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 3.5,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() godtar mask = 0 og mask = 2^25 - 1", async () => {
  const svc = makeValidatingService();
  // Full house = alle 25 bits (2^25 - 1 = 33554431).
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_3",
      name: "Full House",
      mask: 0x1ffffff,
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`mask = 2^25 - 1 skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "validerings-lag skulle ha godtatt mask = 2^25 - 1");

  // mask = 0 er også gyldig (tom mønster).
  reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_3",
      name: "Empty",
      mask: 0,
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`mask = 0 skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "validerings-lag skulle ha godtatt mask = 0");
});

test("BIN-627 service: create() avviser ugyldig claimType", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad claim type",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        claimType: "COVERALL" as "BINGO",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        status: "running" as "active",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser prizePercent < 0", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative prize",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        prizePercent: -5,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser prizePercent > 100", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "over 100 prize",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        prizePercent: 101,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser negativ orderIndex", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative orderIndex",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        orderIndex: -1,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser extra som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array extra",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        extra: ["not", "valid"] as unknown as Record<string, unknown>,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-627 service: create() avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Test",
        mask: 31,
        createdBy: "",
      }),
    "INVALID_INPUT"
  );
});

// ── bitmask grensetilfeller ─────────────────────────────────────────────────

test("BIN-627 service: mask-validering — 33554431 = 0x1FFFFFF aksepteres (full house)", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_3",
      name: "Full House",
      mask: 33554431,
      createdBy: "u-1",
    });
  } catch (err) {
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "33554431 (2^25 - 1) skulle passere validering");
});

test("BIN-627 service: mask-validering — 33554432 (2^25) avvises", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "mask = 2^25 (exact)",
    () =>
      svc.create({
        gameTypeId: "game_3",
        name: "Overflow",
        mask: 33554432,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

// ── constructor-validering ──────────────────────────────────────────────────

test("BIN-627 service: constructor avviser blank connection string", () => {
  assert.throws(
    () => new PatternService({ connectionString: "  " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("BIN-627 service: constructor avviser skjema med ugyldig navn", () => {
  assert.throws(
    () =>
      new PatternService({
        connectionString: "postgres://x",
        schema: "drop-table; --",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});
