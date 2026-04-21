/**
 * BIN-700: unit-tester for LoyaltyService validering + CRUD-flyt.
 *
 * Stubber pg-pool med Object.create-pattern (samme som
 * LeaderboardTierService.test.ts / GameTypeService.test.ts).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { LoyaltyService } from "./LoyaltyService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): LoyaltyService {
  const svc = Object.create(LoyaltyService.prototype) as LoyaltyService;
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
    if (!(err instanceof DomainError)) throw err;
    if (expectedCode) {
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
    }
  }
}

// ── createTier validering ───────────────────────────────────────────────────

test("BIN-700 service: createTier() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () => svc.createTier({ name: "", rank: 1, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: createTier() avviser rank = 0", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero rank",
    () =>
      svc.createTier({ name: "Bronze", rank: 0, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: createTier() avviser negativ rank", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative rank",
    () =>
      svc.createTier({ name: "Bronze", rank: -2, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: createTier() avviser negative minPoints", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative minPoints",
    () =>
      svc.createTier({
        name: "Bronze",
        rank: 1,
        minPoints: -100,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: createTier() avviser maxPoints <= minPoints", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "max <= min",
    () =>
      svc.createTier({
        name: "Bronze",
        rank: 1,
        minPoints: 100,
        maxPoints: 100,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: createTier() avviser tom createdByUserId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdByUserId",
    () => svc.createTier({ name: "Bronze", rank: 1, createdByUserId: "" }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: createTier() avviser benefits som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array benefits",
    () =>
      svc.createTier({
        name: "Bronze",
        rank: 1,
        benefits: ["foo"] as unknown as Record<string, unknown>,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

// ── awardPoints validering ─────────────────────────────────────────────────

test("BIN-700 service: awardPoints() avviser pointsDelta = 0", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero delta",
    () =>
      svc.awardPoints({
        userId: "u-1",
        pointsDelta: 0,
        reason: "test",
        createdByUserId: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: awardPoints() avviser tom reason", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty reason",
    () =>
      svc.awardPoints({
        userId: "u-1",
        pointsDelta: 100,
        reason: "",
        createdByUserId: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: awardPoints() avviser ikke-heltall delta", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "float delta",
    () =>
      svc.awardPoints({
        userId: "u-1",
        pointsDelta: 1.5,
        reason: "test",
        createdByUserId: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: awardPoints() avviser tom userId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty userId",
    () =>
      svc.awardPoints({
        userId: "",
        pointsDelta: 100,
        reason: "test",
        createdByUserId: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

// ── monthlyReset validering ─────────────────────────────────────────────────

test("BIN-700 service: monthlyReset() avviser ugyldig format", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad monthKey format",
    () => svc.monthlyReset("2026/04"),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: monthlyReset() avviser tom streng", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty monthKey",
    () => svc.monthlyReset(""),
    "INVALID_INPUT"
  );
});

// ── listTiers validering ────────────────────────────────────────────────────

test("BIN-700 service: listTiers() avviser ikke-boolean active", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-bool active",
    () => svc.listTiers({ active: "true" as unknown as boolean }),
    "INVALID_INPUT"
  );
});

// ── getTier validering ──────────────────────────────────────────────────────

test("BIN-700 service: getTier() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.getTier(""),
    "INVALID_INPUT"
  );
});

// ── CRUD-flyt med stubbet pool ──────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makePoolWithRows(
  responses: Array<{ rows: unknown[]; rowCount?: number }>
): {
  pool: unknown;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  let idx = 0;
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const next = responses[idx];
      idx += 1;
      return next ?? { rows: [], rowCount: 0 };
    },
  };
  return { pool, calls };
}

function makeServiceWithPool(pool: unknown): LoyaltyService {
  const svc = Object.create(LoyaltyService.prototype) as LoyaltyService;
  (svc as unknown as { pool: unknown }).pool = pool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  return svc;
}

test("BIN-700 service: createTier() returnerer normalisert LoyaltyTier", async () => {
  const now = new Date("2026-04-29T10:00:00Z");
  const { pool, calls } = makePoolWithRows([
    { rows: [] }, // INSERT
    {
      rows: [
        {
          id: "t-1",
          name: "Bronze",
          rank: 1,
          min_points: 0,
          max_points: 500,
          benefits_json: { bonus_pct: 5 },
          active: true,
          created_by_user_id: "u-1",
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);

  const result = await svc.createTier({
    name: "Bronze",
    rank: 1,
    minPoints: 0,
    maxPoints: 500,
    benefits: { bonus_pct: 5 },
    createdByUserId: "u-1",
  });

  assert.equal(result.name, "Bronze");
  assert.equal(result.rank, 1);
  assert.equal(result.minPoints, 0);
  assert.equal(result.maxPoints, 500);
  assert.deepEqual(result.benefits, { bonus_pct: 5 });
  assert.equal(result.active, true);
  assert.ok(calls[0]!.sql.includes("INSERT INTO"));
  assert.ok(calls[1]!.sql.includes("SELECT"));
});

test("BIN-700 service: createTier() oversetter unique-violation til LOYALTY_TIER_DUPLICATE", async () => {
  const pool = {
    query: async () => {
      const err = new Error("duplicate") as Error & { code: string };
      err.code = "23505";
      throw err;
    },
  };
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "dup",
    () =>
      svc.createTier({
        name: "Bronze",
        rank: 1,
        createdByUserId: "u-1",
      }),
    "LOYALTY_TIER_DUPLICATE"
  );
});

test("BIN-700 service: getTier() kaster LOYALTY_TIER_NOT_FOUND ved tom rad", async () => {
  const { pool } = makePoolWithRows([{ rows: [] }]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "not-found",
    () => svc.getTier("abc"),
    "LOYALTY_TIER_NOT_FOUND"
  );
});

test("BIN-700 service: updateTier() uten felter gir INVALID_INPUT", async () => {
  const now = new Date();
  const { pool } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          name: "Bronze",
          rank: 1,
          min_points: 0,
          max_points: null,
          benefits_json: {},
          active: true,
          created_by_user_id: "u-1",
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "empty update",
    () => svc.updateTier("t-1", {}),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: updateTier() avviser oppdatering av slettet rad", async () => {
  const now = new Date();
  const { pool } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          name: "Bronze",
          rank: 1,
          min_points: 0,
          max_points: null,
          benefits_json: {},
          active: false,
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
          deleted_at: now,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "update deleted",
    () => svc.updateTier("t-1", { minPoints: 100 }),
    "LOYALTY_TIER_DELETED"
  );
});

test("BIN-700 service: removeTier() default soft-delete", async () => {
  const now = new Date();
  const { pool, calls } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          name: "Bronze",
          rank: 1,
          min_points: 0,
          max_points: null,
          benefits_json: {},
          active: true,
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    },
    { rows: [] },
  ]);
  const svc = makeServiceWithPool(pool);
  const res = await svc.removeTier("t-1");
  assert.equal(res.softDeleted, true);
  assert.ok(calls[1]!.sql.includes("deleted_at = now()"));
});

test("BIN-700 service: removeTier(hard=true) gjør DELETE", async () => {
  const now = new Date();
  const { pool, calls } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          name: "Bronze",
          rank: 1,
          min_points: 0,
          max_points: null,
          benefits_json: {},
          active: true,
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    },
    { rows: [] },
  ]);
  const svc = makeServiceWithPool(pool);
  const res = await svc.removeTier("t-1", { hard: true });
  assert.equal(res.softDeleted, false);
  assert.ok(calls[1]!.sql.startsWith("DELETE FROM"));
});

test("BIN-700 service: getPlayerState() returnerer tom-projeksjon for ukjent user", async () => {
  const { pool } = makePoolWithRows([{ rows: [] }]);
  const svc = makeServiceWithPool(pool);
  const state = await svc.getPlayerState("u-42");
  assert.equal(state.userId, "u-42");
  assert.equal(state.lifetimePoints, 0);
  assert.equal(state.monthPoints, 0);
  assert.equal(state.currentTier, null);
  assert.equal(state.tierLocked, false);
});

test("BIN-700 service: listTiers() sorterer etter rank ASC", async () => {
  const { pool, calls } = makePoolWithRows([{ rows: [] }]);
  const svc = makeServiceWithPool(pool);
  await svc.listTiers();
  assert.ok(calls[0]!.sql.includes("ORDER BY rank ASC"));
});

test("BIN-700 service: monthlyReset() idempotent når monthKey matcher", async () => {
  const { pool, calls } = makePoolWithRows([{ rows: [], rowCount: 0 }]);
  const svc = makeServiceWithPool(pool);
  const res = await svc.monthlyReset("2026-04");
  assert.equal(res.playersReset, 0);
  assert.equal(res.monthKey, "2026-04");
  // UPDATE-queryen har WHERE month_key < $1 OR month_key IS NULL
  assert.ok(calls[0]!.sql.includes("month_key"));
});
