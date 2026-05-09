/**
 * F4 (E2E-verification 2026-Q3): tidssone-bug i `dateRowToString`.
 *
 * Bug: tidligere brukte funksjonen `Date.getUTCFullYear/Month/Date()` på
 * et Date-objekt der momentet i tid representerte Oslo-midnatt. Når Oslo
 * er UTC+1/+2 ligger UTC-momentet i forrige kalenderdag, så formatet ble
 * forskjøvet ett døgn for spørringer mellom 22:00 og 00:00 UTC (00:00-02:00
 * Oslo-tid).
 *
 * Fix: bruk `formatOsloDateKey` fra `osloTimezone.ts` som tolker momentet
 * i Europe/Oslo-tidssonen. Dette gir korrekt kalenderdato uavhengig av
 * server-host-tz og DST.
 *
 * Disse testene reproduserer det presise scenarioet fra E2E-rapporten
 * (DB row sier "2026-05-09" mens API-mappingen returnerte "2026-05-08")
 * og låser fix-en mot regresjon.
 *
 * Test-strategi: dateRowToString er ikke eksportert, men effekten observeres
 * via `mapRow` som driver `businessDate`-feltet i alle service-svar.
 * Vi tester via en proxy: opprett en GamePlanRunService med en mock-pool
 * som returnerer en kontrollert business_date, kjør findForDay,
 * og verifiser businessDate-feltet i resultatet.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GamePlanRunService } from "../GamePlanRunService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GameCatalogService } from "../GameCatalogService.js";
import type { Pool } from "pg";

interface MockQueryRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: unknown;
  current_position: number;
  status: string;
  jackpot_overrides_json: unknown;
  started_at: unknown;
  finished_at: unknown;
  master_user_id: string | null;
  created_at: unknown;
  updated_at: unknown;
}

function makePoolReturningRow(row: MockQueryRow): Pool {
  // Minimal pool-shim: only needs `query` to return our seeded row.
  // GamePlanRunService.findForDay runs a single SELECT.
  const fakePool = {
    query: async (
      _sql: string,
      _params?: unknown[],
    ): Promise<{ rows: MockQueryRow[]; rowCount: number }> => {
      return { rows: [row], rowCount: 1 };
    },
  };
  return fakePool as unknown as Pool;
}

function makeService(pool: Pool): GamePlanRunService {
  // GamePlanRunService needs plan-service + catalog-service to satisfy
  // constructor — we never invoke methods on them here, so plain stubs
  // are sufficient.
  const planService = {} as unknown as GamePlanService;
  const catalogService = {} as unknown as GameCatalogService;
  return new GamePlanRunService({
    pool,
    schema: "public",
    planService,
    catalogService,
  });
}

function baseRow(businessDate: unknown): MockQueryRow {
  return {
    id: "run-1",
    plan_id: "plan-1",
    hall_id: "hall-1",
    business_date: businessDate,
    current_position: 1,
    status: "running",
    jackpot_overrides_json: {},
    started_at: null,
    finished_at: null,
    master_user_id: null,
    created_at: new Date("2026-05-09T00:00:00.000Z"),
    updated_at: new Date("2026-05-09T00:00:00.000Z"),
  };
}

test("F4: business_date='2026-05-09' string passes through unchanged", async () => {
  const pool = makePoolReturningRow(baseRow("2026-05-09"));
  const service = makeService(pool);
  const result = await service.findForDay("hall-1", "2026-05-09");
  assert.ok(result, "row should be returned");
  assert.equal(result?.businessDate, "2026-05-09");
});

test("F4: business_date as ISO-string truncates to 10 chars", async () => {
  const pool = makePoolReturningRow(baseRow("2026-05-09T00:00:00.000Z"));
  const service = makeService(pool);
  const result = await service.findForDay("hall-1", "2026-05-09");
  assert.equal(result?.businessDate, "2026-05-09");
});

test(
  "F4: business_date as Date at Oslo-midnight (UTC+2 sommertid) returns " +
    "correct Oslo date (regression: prev impl returned previous day)",
  async () => {
    // Oslo-midnatt 9. mai 2026 (sommertid, UTC+2) = 8. mai 2026 22:00 UTC.
    // Pre-fix: getUTCDate() returnerte 8 → "2026-05-08" (FEIL).
    // Post-fix: formatOsloDateKey returnerer "2026-05-09" (RIKTIG).
    const osloMidnight = new Date("2026-05-08T22:00:00.000Z");
    const pool = makePoolReturningRow(baseRow(osloMidnight));
    const service = makeService(pool);
    const result = await service.findForDay("hall-1", "2026-05-09");
    assert.equal(
      result?.businessDate,
      "2026-05-09",
      "Oslo-midnight Date should format to the Oslo calendar date, not UTC",
    );
  },
);

test(
  "F4: business_date as Date at Oslo-midnight (UTC+1 vintertid) returns " +
    "correct Oslo date",
  async () => {
    // Oslo-midnatt 15. januar 2026 (vintertid, UTC+1) = 14. januar 2026 23:00 UTC.
    // Pre-fix returnerte "2026-01-14". Post-fix returnerer "2026-01-15".
    const osloMidnight = new Date("2026-01-14T23:00:00.000Z");
    const pool = makePoolReturningRow(baseRow(osloMidnight));
    const service = makeService(pool);
    const result = await service.findForDay("hall-1", "2026-01-15");
    assert.equal(
      result?.businessDate,
      "2026-01-15",
      "Oslo-midnight Date in winter (UTC+1) should also format correctly",
    );
  },
);

test("F4: invalid Date returns sentinel '0000-00-00'", async () => {
  const invalidDate = new Date("not-a-date");
  const pool = makePoolReturningRow(baseRow(invalidDate));
  const service = makeService(pool);
  const result = await service.findForDay("hall-1", "2026-05-09");
  assert.equal(result?.businessDate, "0000-00-00");
});

test("F4: unknown shape (number) returns sentinel '0000-00-00'", async () => {
  const pool = makePoolReturningRow(baseRow(12345 as unknown as number));
  const service = makeService(pool);
  const result = await service.findForDay("hall-1", "2026-05-09");
  assert.equal(result?.businessDate, "0000-00-00");
});
