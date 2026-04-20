/**
 * BIN-679: unit-tester for MiniGamesConfigService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminMiniGames.test.ts) stubber ut
 * service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres — Object.create-pattern (samme som
 * LeaderboardTierService-test).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  MiniGamesConfigService,
  MINI_GAME_TYPES,
  assertMiniGameType,
  type MiniGameType,
} from "./MiniGamesConfigService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): MiniGamesConfigService {
  const svc = Object.create(
    MiniGamesConfigService.prototype,
  ) as MiniGamesConfigService;
  const stubPool = {
    query: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her",
      );
    },
    connect: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her",
      );
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return svc;
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string,
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

// ── assertMiniGameType ──────────────────────────────────────────────────────

test("BIN-679 service: assertMiniGameType accepterer alle 4 verdier", () => {
  for (const gt of MINI_GAME_TYPES) {
    assert.equal(assertMiniGameType(gt), gt);
  }
});

test("BIN-679 service: assertMiniGameType avviser ukjent streng", () => {
  assert.throws(
    () => assertMiniGameType("bingo"),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-679 service: assertMiniGameType avviser tall", () => {
  assert.throws(
    () => assertMiniGameType(42),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-679 service: assertMiniGameType avviser null/undefined", () => {
  assert.throws(
    () => assertMiniGameType(null),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT",
  );
  assert.throws(
    () => assertMiniGameType(undefined),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

// ── get-validering ──────────────────────────────────────────────────────────

test("BIN-679 service: get() avviser ukjent gameType før DB-kall", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "unknown gameType",
    () => svc.get("unknown" as MiniGameType),
    "INVALID_INPUT",
  );
});

// ── update-validering ───────────────────────────────────────────────────────

test("BIN-679 service: update() avviser ukjent gameType før DB-kall", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "unknown gameType",
    () =>
      svc.update("nope" as MiniGameType, {
        config: {},
        updatedByUserId: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("BIN-679 service: update() avviser manglende updatedByUserId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "missing updatedByUserId",
    () => svc.update("wheel", { config: {}, updatedByUserId: "" }),
    "INVALID_INPUT",
  );
});

test("BIN-679 service: update() avviser config som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "config as array",
    () =>
      svc.update("wheel", {
        config: [1, 2, 3] as unknown as Record<string, unknown>,
        updatedByUserId: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("BIN-679 service: update() avviser config som streng", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "config as string",
    () =>
      svc.update("wheel", {
        config: "not-an-object" as unknown as Record<string, unknown>,
        updatedByUserId: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("BIN-679 service: update() avviser active som streng", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "active as string",
    () =>
      svc.update("chest", {
        active: "true" as unknown as boolean,
        updatedByUserId: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("BIN-679 service: update() avviser active som tall", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "active as number",
    () =>
      svc.update("mystery", {
        active: 1 as unknown as boolean,
        updatedByUserId: "u-1",
      }),
    "INVALID_INPUT",
  );
});

// ── constructor-validering ──────────────────────────────────────────────────

test("BIN-679 service: constructor avviser tom connectionString", () => {
  assert.throws(
    () => new MiniGamesConfigService({ connectionString: "" }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("BIN-679 service: constructor avviser ugyldig schema-navn", () => {
  assert.throws(
    () =>
      new MiniGamesConfigService({
        connectionString: "postgres://x",
        schema: "bad-schema-with-dash",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

// ── forTesting-hook ─────────────────────────────────────────────────────────

test("BIN-679 service: forTesting() setter initPromise så get() kan kalles uten init", () => {
  const stub = {
    query: async () => ({ rows: [] }),
  };
  const svc = MiniGamesConfigService.forTesting(stub as unknown as never);
  assert.ok(svc instanceof MiniGamesConfigService);
});
