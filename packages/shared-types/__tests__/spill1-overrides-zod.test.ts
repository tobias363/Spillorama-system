/**
 * Audit 2026-04-30 (PR #748): Zod-validering av Spill 1 legacy-paritet
 * override-felter på `ScheduleSubgameSchema`.
 *
 * Verifiserer at:
 *   1. Eksisterende schedules UTEN `spill1Overrides` parser uendret
 *      (bakoverkompat).
 *   2. Schedules MED `spill1Overrides` validerer felter typesikkert.
 *   3. Negative tall, ikke-heltall og ugyldige typer rejectes.
 *   4. Round-trip parse → JSON → parse er identitets-bevarende.
 *
 * Refs:
 *   - docs/legacy-snapshots/2026-04-30/SPILL1_GAP_AUDIT.md
 *   - packages/shared-types/src/schemas/admin.ts:Spill1OverridesSchema
 *   - packages/shared-types/src/spill1-sub-variants.ts:Spill1VariantOverrides
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ScheduleSubgameSchema,
  Spill1OverridesSchema,
  type ScheduleSubgame,
  type Spill1Overrides,
} from "../src/schemas/admin.js";

// ── Bakoverkompat: schedules uten spill1Overrides ─────────────────────────

test("ScheduleSubgameSchema: eksisterende subgame uten spill1Overrides parser ok", () => {
  const legacy = {
    name: "Jackpot",
    customGameName: "Superjoker",
    notificationStartTime: "5s",
    minseconds: 5,
    maxseconds: 10,
    seconds: 5,
    ticketTypesData: { somelegacyfield: "value" },
    jackpotData: { prizeByColor: { yellow: 15000 }, draw: 57 },
    elvisData: {},
    extra: { someExtra: "preserved" },
  };
  const parsed = ScheduleSubgameSchema.parse(legacy);
  assert.equal(parsed.name, "Jackpot");
  assert.equal(parsed.spill1Overrides, undefined, "spill1Overrides defaulter til undefined");
});

test("ScheduleSubgameSchema: tom subgame parser ok (alle felt optional)", () => {
  const empty = {};
  const parsed = ScheduleSubgameSchema.parse(empty);
  assert.equal(parsed.spill1Overrides, undefined);
});

// ── Spill1OverridesSchema: alle 3 sub-objekter ─────────────────────────────

test("Spill1OverridesSchema: tom override parser ok", () => {
  const parsed = Spill1OverridesSchema.parse({});
  assert.deepEqual(parsed, {});
});

test("Spill1OverridesSchema: full TV Extra override (alle 3 felter)", () => {
  const tvExtra: Spill1Overrides = {
    tvExtra: {
      pictureYellow: 500,
      frameYellow: 1000,
      fullHouseYellow: 3000,
    },
  };
  const parsed = Spill1OverridesSchema.parse(tvExtra);
  assert.deepEqual(parsed, tvExtra);
});

test("Spill1OverridesSchema: TV Extra partial (kun picture) ok", () => {
  const partial = { tvExtra: { pictureYellow: 750 } };
  const parsed = Spill1OverridesSchema.parse(partial);
  assert.equal(parsed.tvExtra?.pictureYellow, 750);
  assert.equal(parsed.tvExtra?.frameYellow, undefined);
  assert.equal(parsed.tvExtra?.fullHouseYellow, undefined);
});

test("Spill1OverridesSchema: full Oddsen 56 override (yellow + white)", () => {
  const oddsen: Spill1Overrides = {
    oddsen56: {
      fullHouseWithin56Yellow: 3000,
      fullHouseWithin56White: 1500,
    },
  };
  const parsed = Spill1OverridesSchema.parse(oddsen);
  assert.deepEqual(parsed, oddsen);
});

test("Spill1OverridesSchema: Spillerness Spill 2 override (minimumPrize)", () => {
  const sp: Spill1Overrides = {
    spillerness2: { minimumPrize: 100 },
  };
  const parsed = Spill1OverridesSchema.parse(sp);
  assert.equal(parsed.spillerness2?.minimumPrize, 100);
});

test("Spill1OverridesSchema: alle 3 sub-objekter samtidig", () => {
  const all: Spill1Overrides = {
    tvExtra: { pictureYellow: 500, frameYellow: 1000 },
    oddsen56: { fullHouseWithin56Yellow: 3000, fullHouseWithin56White: 1500 },
    spillerness2: { minimumPrize: 100 },
  };
  const parsed = Spill1OverridesSchema.parse(all);
  assert.deepEqual(parsed, all);
});

// ── Validering: avvis ugyldig input ────────────────────────────────────────

test("Spill1OverridesSchema: avvis negative tall i tvExtra", () => {
  assert.throws(
    () =>
      Spill1OverridesSchema.parse({
        tvExtra: { pictureYellow: -1 },
      }),
    /too[_ ]small|nonnegative|greater_than_or_equal/i,
  );
});

test("Spill1OverridesSchema: avvis ikke-heltall i tvExtra", () => {
  assert.throws(
    () =>
      Spill1OverridesSchema.parse({
        tvExtra: { pictureYellow: 100.5 },
      }),
    /int|integer/i,
  );
});

test("Spill1OverridesSchema: avvis negative tall i oddsen56", () => {
  assert.throws(
    () =>
      Spill1OverridesSchema.parse({
        oddsen56: { fullHouseWithin56Yellow: -50 },
      }),
    /too[_ ]small|nonnegative|greater_than_or_equal/i,
  );
});

test("Spill1OverridesSchema: avvis negative tall i spillerness2", () => {
  assert.throws(
    () =>
      Spill1OverridesSchema.parse({
        spillerness2: { minimumPrize: -10 },
      }),
    /too[_ ]small|nonnegative|greater_than_or_equal/i,
  );
});

test("Spill1OverridesSchema: avvis string i numerisk felt", () => {
  assert.throws(() =>
    Spill1OverridesSchema.parse({
      tvExtra: { pictureYellow: "500" as unknown as number },
    }),
  );
});

test("Spill1OverridesSchema: aksepterer 0 (eksplisitt nullstilt premie)", () => {
  // 0 er gyldig (nonnegative); kan brukes til gratis-pattern.
  const parsed = Spill1OverridesSchema.parse({
    tvExtra: { pictureYellow: 0 },
    oddsen56: { fullHouseWithin56White: 0 },
    spillerness2: { minimumPrize: 0 },
  });
  assert.equal(parsed.tvExtra?.pictureYellow, 0);
  assert.equal(parsed.oddsen56?.fullHouseWithin56White, 0);
  assert.equal(parsed.spillerness2?.minimumPrize, 0);
});

// ── Round-trip via ScheduleSubgameSchema ──────────────────────────────────

test("ScheduleSubgameSchema: round-trip subgame med spill1Overrides bevart", () => {
  const subgame: ScheduleSubgame = {
    name: "Tv Extra",
    customGameName: "Tv-Extra",
    notificationStartTime: "5s",
    spill1Overrides: {
      tvExtra: {
        pictureYellow: 500,
        frameYellow: 1000,
        fullHouseYellow: 3000,
      },
    },
  };
  const json = JSON.parse(JSON.stringify(subgame));
  const parsed = ScheduleSubgameSchema.parse(json);
  assert.deepEqual(parsed, subgame);
});

test("ScheduleSubgameSchema: round-trip Oddsen 56-subgame", () => {
  const subgame: ScheduleSubgame = {
    name: "Oddsen 56",
    notificationStartTime: "5s",
    spill1Overrides: {
      oddsen56: {
        fullHouseWithin56Yellow: 3000,
        fullHouseWithin56White: 1500,
      },
    },
  };
  const json = JSON.parse(JSON.stringify(subgame));
  const parsed = ScheduleSubgameSchema.parse(json);
  assert.deepEqual(parsed, subgame);
});

test("ScheduleSubgameSchema: round-trip Spillernes Spill 2-subgame", () => {
  const subgame: ScheduleSubgame = {
    name: "Spillerness Spill 2",
    notificationStartTime: "10s",
    spill1Overrides: {
      spillerness2: { minimumPrize: 100 },
    },
  };
  const json = JSON.parse(JSON.stringify(subgame));
  const parsed = ScheduleSubgameSchema.parse(json);
  assert.deepEqual(parsed, subgame);
});

test("ScheduleSubgameSchema: round-trip kombinert (alle 3 sub-objekter)", () => {
  const subgame: ScheduleSubgame = {
    name: "Combined Test",
    spill1Overrides: {
      tvExtra: { pictureYellow: 500, frameYellow: 1000, fullHouseYellow: 3000 },
      oddsen56: {
        fullHouseWithin56Yellow: 3000,
        fullHouseWithin56White: 1500,
      },
      spillerness2: { minimumPrize: 100 },
    },
  };
  const json = JSON.parse(JSON.stringify(subgame));
  const parsed = ScheduleSubgameSchema.parse(json);
  assert.deepEqual(parsed, subgame);
});
