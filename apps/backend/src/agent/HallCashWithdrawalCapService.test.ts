/**
 * HV2-A / BIR-036: unit-tester for HallCashWithdrawalCapService.
 *
 * Test-strategi:
 *   * Mock pg.Pool med en in-memory representasjon av
 *     `app_hall_cash_withdrawals_daily`. Vi simulerer SQL-statements vi
 *     bryr oss om — INSERT ... ON CONFLICT ... DO UPDATE WHERE og SELECT.
 *   * Verifiserer cap-grenser (50 000 kr/dag), dag-rollover (Oslo-tz),
 *     at to haller har separate buckets, og race-trygghet (RETURNING-rad
 *     manglende = 0 affected rows = exception).
 *   * `nowMs` injiseres for deterministisk Oslo-dato.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  HallCashWithdrawalCapService,
  CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS,
  CASH_WITHDRAW_CAP_PER_HALL_DAILY_NOK,
} from "./HallCashWithdrawalCapService.js";
import { DomainError } from "../errors/DomainError.js";

// ── Mock Pool ──────────────────────────────────────────────────────────────

interface BucketKey {
  hallId: string;
  businessDate: string;
}

interface BucketRow {
  total_amount_cents: number;
  count: number;
}

function keyOf(k: BucketKey): string {
  return `${k.hallId}|${k.businessDate}`;
}

interface MockState {
  buckets: Map<string, BucketRow>;
  /**
   * Hook for race-test: kalles før selve INSERT-utføres slik at en test
   * kan injisere en konkurrent som fyller bucketen.
   */
  preInsertHook?: () => void | Promise<void>;
  /**
   * Logg av alle SQL-statement som ble kjørt — nyttig for å avdekke
   * uventet read-pattern i tester.
   */
  log: string[];
}

function createMockState(): MockState {
  return { buckets: new Map(), log: [] };
}

function runInsertOnConflict(
  state: MockState,
  params: unknown[]
): { rowCount: number; rows: BucketRow[] } {
  const [hallId, businessDate, amountCents, cap] = params as [
    string,
    string,
    number,
    number,
  ];
  const key = keyOf({ hallId, businessDate });
  const existing = state.buckets.get(key);
  if (!existing) {
    // INSERT-grenen: alltid lykkes (cap-sjekk er kun på UPDATE-grenen).
    const row = { total_amount_cents: amountCents, count: 1 };
    state.buckets.set(key, row);
    return { rowCount: 1, rows: [{ ...row }] };
  }
  // UPDATE-grenen: cap-sjekk
  const newTotal = existing.total_amount_cents + amountCents;
  if (newTotal > cap) {
    return { rowCount: 0, rows: [] };
  }
  existing.total_amount_cents = newTotal;
  existing.count += 1;
  return { rowCount: 1, rows: [{ ...existing }] };
}

function runQuery(
  state: MockState,
  sql: string,
  params: unknown[]
): { rowCount: number; rows: BucketRow[] } {
  const trimmed = sql.trim();
  const upper = trimmed.slice(0, 16).toUpperCase();
  state.log.push(trimmed.slice(0, 100));

  if (
    upper.startsWith("BEGIN") ||
    upper.startsWith("COMMIT") ||
    upper.startsWith("ROLLBACK")
  ) {
    return { rowCount: 0, rows: [] };
  }

  if (upper.startsWith("SELECT")) {
    const [hallId, businessDate] = params as [string, string];
    const key = keyOf({ hallId, businessDate });
    const row = state.buckets.get(key);
    return row
      ? { rowCount: 1, rows: [{ ...row }] }
      : { rowCount: 0, rows: [] };
  }

  if (upper.startsWith("INSERT")) {
    return runInsertOnConflict(state, params);
  }

  return { rowCount: 0, rows: [] };
}

interface MockPool {
  pool: Pool;
  state: MockState;
}

function makeMockPool(): MockPool {
  const state = createMockState();
  const clientShim: PoolClient = {
    query: async (sql: string, params: unknown[] = []) => {
      // preInsertHook for race-test
      if (sql.trim().toUpperCase().startsWith("INSERT") && state.preInsertHook) {
        const hook = state.preInsertHook;
        // én-gangs hook
        state.preInsertHook = undefined;
        await hook();
      }
      return runQuery(state, sql, params) as never;
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const poolShim = {
    connect: async () => clientShim,
    query: async (sql: string, params: unknown[] = []) =>
      runQuery(state, sql, params),
  };
  return { pool: poolShim as unknown as Pool, state };
}

// Forventet Oslo-dato for et gitt UTC-tidspunkt (for å lage tester med
// kjent forventet `business_date`). Vi gjenbruker formatOsloDateKey via
// produksjons-koden for konsistens.
const ms = (iso: string): number => Date.parse(iso);

// ── Tests ──────────────────────────────────────────────────────────────────

test("BIR-036: getRemainingCapCents returnerer hele cap når bucketen er tom", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });

  const remaining = await svc.getRemainingCapCents(
    "hall-a",
    ms("2026-04-30T12:00:00Z")
  );
  assert.equal(remaining, CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS);
  assert.equal(remaining, 5_000_000);
  assert.equal(CASH_WITHDRAW_CAP_PER_HALL_DAILY_NOK, 50_000);
});

test("BIR-036: assertWithinCap aksepterer beløp under cap", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });

  // 49_999 kr — under cap.
  await svc.assertWithinCap("hall-a", 4_999_900, ms("2026-04-30T12:00:00Z"));
});

test("BIR-036: assertWithinCap aksepterer beløp helt opp til cap", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });

  // 50_000 kr — akkurat på cap.
  await svc.assertWithinCap("hall-a", 5_000_000, ms("2026-04-30T12:00:00Z"));
});

test("BIR-036: assertWithinCap kaster CASH_WITHDRAW_CAP_EXCEEDED for beløp over cap", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });

  // 50_001 kr — over cap.
  await assert.rejects(
    () => svc.assertWithinCap("hall-a", 5_000_100, ms("2026-04-30T12:00:00Z")),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.code, "CASH_WITHDRAW_CAP_EXCEEDED");
      assert.equal(err.details?.requestedAmountCents, 5_000_100);
      assert.equal(err.details?.remainingCapCents, 5_000_000);
      assert.equal(err.details?.capCents, 5_000_000);
      return true;
    }
  );
});

test("BIR-036: recordWithdrawal lagrer beløp og count i fersk bucket", async () => {
  const { pool, state } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });

  await svc.recordWithdrawal("hall-a", 100_000, ms("2026-04-30T12:00:00Z"));

  // Forventet rad: hall-a + 2026-04-30 (Oslo)
  const row = Array.from(state.buckets.values())[0];
  assert.equal(row?.total_amount_cents, 100_000);
  assert.equal(row?.count, 1);
});

test("BIR-036: 30_000 + 25_000 (totalt 55_000) → fail på record (overskrider cap)", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  // Først 30 000 kr — under cap, lagres.
  await svc.assertWithinCap("hall-a", 3_000_000, now);
  await svc.recordWithdrawal("hall-a", 3_000_000, now);

  // Sjekk gjenstående
  const remaining = await svc.getRemainingCapCents("hall-a", now);
  assert.equal(remaining, 2_000_000); // 50_000 - 30_000 = 20_000 kr

  // Forsøk 25 000 kr — overskrider cap (gjenstår kun 20 000).
  await assert.rejects(
    () => svc.assertWithinCap("hall-a", 2_500_000, now),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.code, "CASH_WITHDRAW_CAP_EXCEEDED");
      assert.equal(err.details?.remainingCapCents, 2_000_000);
      assert.equal(err.details?.requestedAmountCents, 2_500_000);
      return true;
    }
  );

  // recordWithdrawal med 25 000 skal også feile (race-safe path).
  await assert.rejects(
    () => svc.recordWithdrawal("hall-a", 2_500_000, now),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.code, "CASH_WITHDRAW_CAP_EXCEEDED");
      return true;
    }
  );
});

test("BIR-036: 30_000 + 20_000 (totalt 50_000) → success akkurat på cap-grensen", async () => {
  const { pool, state } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  await svc.recordWithdrawal("hall-a", 3_000_000, now); // 30 000 kr
  await svc.recordWithdrawal("hall-a", 2_000_000, now); // 20 000 kr — totalt 50 000

  const row = Array.from(state.buckets.values())[0];
  assert.equal(row?.total_amount_cents, 5_000_000);
  assert.equal(row?.count, 2);

  const remaining = await svc.getRemainingCapCents("hall-a", now);
  assert.equal(remaining, 0);
});

test("BIR-036: to haller har separate buckets — ikke samme cap", async () => {
  const { pool, state } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  // Hall A: 50 000 kr (akkurat på cap)
  await svc.recordWithdrawal("hall-a", 5_000_000, now);
  // Hall B: 50 000 kr (egen cap, ikke berørt av hall-a)
  await svc.recordWithdrawal("hall-b", 5_000_000, now);

  assert.equal(state.buckets.size, 2);
  assert.equal(await svc.getRemainingCapCents("hall-a", now), 0);
  assert.equal(await svc.getRemainingCapCents("hall-b", now), 0);

  // Hall C: fersk, full cap
  assert.equal(
    await svc.getRemainingCapCents("hall-c", now),
    CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS
  );
});

test("BIR-036: dag-rollover (Oslo-tz) gir ny bucket — gammel bucket ikke berørt", async () => {
  const { pool, state } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });

  // Tirsdag 29. april kl 23:00 UTC = 01:00 onsdag 30. april Oslo-tid
  // Onsdag 30. april kl 23:00 UTC = 01:00 torsdag 1. mai Oslo-tid
  const dag1 = ms("2026-04-29T23:00:00Z"); // Oslo: 30. april kl 01:00
  const dag2 = ms("2026-04-30T23:00:00Z"); // Oslo: 1. mai kl 01:00

  await svc.recordWithdrawal("hall-a", 5_000_000, dag1); // fyll dag 1
  // Cap nådd dag 1
  assert.equal(await svc.getRemainingCapCents("hall-a", dag1), 0);

  // Dag 2: ny bucket, full cap igjen
  assert.equal(
    await svc.getRemainingCapCents("hall-a", dag2),
    CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS
  );

  // Vi skal nå ha to rader: en for 2026-04-30 (Oslo) og en for 2026-05-01 (Oslo)
  await svc.recordWithdrawal("hall-a", 1_000_000, dag2);
  assert.equal(state.buckets.size, 2);
});

test("BIR-036: bank-withdrawal er ikke vårt ansvar — caller filtrerer dette", async () => {
  // Service har ingen kunnskap om destinationType. Det er caller (route)
  // sin oppgave å skille bank/cash. Dette test-caset dokumenterer at
  // service-en ikke kjenner til destinationType i input.
  const { pool, state } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  // Service bryr seg ikke om hva slags type uttak — alle 3 calls øker
  // kontant-cap-bucketen for hall-a. Caller MÅ filtrere.
  await svc.recordWithdrawal("hall-a", 1_000_000, now);
  await svc.recordWithdrawal("hall-a", 1_000_000, now);

  const row = Array.from(state.buckets.values())[0];
  assert.equal(row?.total_amount_cents, 2_000_000);
  assert.equal(row?.count, 2);
});

test("BIR-036: race — to concurrent recordWithdrawal med samme cap-grense lykkes kun én", async () => {
  const { pool, state } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  // Pre-fylling: 49 000 kr — gjenstår 1 000 kr.
  await svc.recordWithdrawal("hall-a", 4_900_000, now);
  assert.equal(await svc.getRemainingCapCents("hall-a", now), 100_000);

  // Konkurrent fyller opp til cap akkurat før denne rekorden lander.
  // preInsertHook simulerer at en annen request fylte bucketen mellom
  // assertWithinCap og recordWithdrawal.
  state.preInsertHook = () => {
    const existing = state.buckets.get("hall-a|2026-04-30")!;
    existing.total_amount_cents = 5_000_000; // fylt til cap
    existing.count = 999;
  };

  // Vi kjører recordWithdrawal med 100 kr — burde få plass etter
  // assertWithinCap, men preInsertHook fyller bucketen før vår INSERT
  // → UPDATE-grenens WHERE filtrerer oss ut (newTotal = 5_000_100 > cap).
  await assert.rejects(
    () => svc.recordWithdrawal("hall-a", 10_000, now),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.code, "CASH_WITHDRAW_CAP_EXCEEDED");
      assert.equal(err.details?.remainingCapCents, 0);
      return true;
    }
  );
});

test("BIR-036: amountCents over cap aleinen feiler med definitive error", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  // 60 000 kr i én enkel transaksjon — over cap (50 000 kr) selv på fersk dag.
  await assert.rejects(
    () => svc.recordWithdrawal("hall-a", 6_000_000, now),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.code, "CASH_WITHDRAW_CAP_EXCEEDED");
      // INSERT-grenen lar dette gjennom (det er kun UPDATE som har WHERE).
      // Defensiv check i recordWithdrawal fanger det opp.
      return true;
    }
  );
});

test("BIR-036: input-validering — negativ amountCents", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  await assert.rejects(
    () => svc.assertWithinCap("hall-a", -100, now),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => svc.recordWithdrawal("hall-a", 0, now),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => svc.recordWithdrawal("hall-a", 1.5, now),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIR-036: input-validering — tom hallId", async () => {
  const { pool } = makeMockPool();
  const svc = new HallCashWithdrawalCapService({ pool });
  const now = ms("2026-04-30T12:00:00Z");

  await assert.rejects(
    () => svc.assertWithinCap("", 1000, now),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => svc.recordWithdrawal("   ", 1000, now),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIR-036: konstanter — CAP_NOK = 50_000 og CAP_CENTS = 5_000_000", () => {
  assert.equal(CASH_WITHDRAW_CAP_PER_HALL_DAILY_NOK, 50_000);
  assert.equal(CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS, 5_000_000);
  assert.equal(
    CASH_WITHDRAW_CAP_PER_HALL_DAILY_CENTS,
    CASH_WITHDRAW_CAP_PER_HALL_DAILY_NOK * 100
  );
});
