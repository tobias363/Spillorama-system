/**
 * BIN-763: Tester for `wallet-reconciliation` cron-job + service.
 *
 * Dekker (uten Postgres):
 *   - Før runAtHour → waiting-note, ingen kall til service
 *   - Samme date-key to ganger → andre kall er no-op
 *   - alwaysRun=true overstyrer hour/date-key
 *   - 42P01 fra service → soft-no-op
 *   - Ikke-42P01 feil propageres
 *   - Note inneholder scanned/divergences/alertsCreated
 *
 * Integrasjons-test (med Postgres) ligger i walletReconciliation.integration.test.ts
 * og skipper når WALLET_PG_TEST_CONNECTION_STRING ikke er satt.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletReconciliationJob,
  type WalletReconciliationService,
  type ReconciliationResult,
} from "../walletReconciliation.js";

interface Recorder {
  calls: number;
  behavior?: () => Promise<ReconciliationResult>;
}

function makeService(rec: Recorder): WalletReconciliationService {
  return {
    reconcileAll: async (): Promise<ReconciliationResult> => {
      rec.calls += 1;
      if (rec.behavior) return rec.behavior();
      return {
        accountsScanned: 100,
        divergencesFound: 0,
        alertsCreated: 0,
        durationMs: 42,
      };
    },
    listOpenAlerts: async () => [],
    resolveAlert: async () => true,
  } as unknown as WalletReconciliationService;
}

// ── Guards ────────────────────────────────────────────────────────────────

test("wallet-reconciliation: før runAtHour → waiting note, ingen kall", async () => {
  const rec: Recorder = { calls: 0 };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 3,
    runAtMinuteLocal: 0,
  });
  // Klokka er 02:00 — før 03:00
  const tooEarly = new Date("2026-04-26T02:00:00").getTime();
  const result = await job(tooEarly);
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /waiting for 03:00/);
  assert.equal(rec.calls, 0);
});

test("wallet-reconciliation: samme date-key to ganger → andre kall er no-op", async () => {
  const rec: Recorder = { calls: 0 };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 3,
    runAtMinuteLocal: 0,
  });
  const first = new Date("2026-04-26T03:05:00").getTime();
  const second = new Date("2026-04-26T03:10:00").getTime();

  const r1 = await job(first);
  assert.equal(rec.calls, 1, "første kall skal kjøre");
  assert.doesNotMatch(r1.note ?? "", /already ran today/);

  const r2 = await job(second);
  assert.equal(rec.calls, 1, "andre kall samme dag skal være no-op");
  assert.match(r2.note ?? "", /already ran today/);
});

test("wallet-reconciliation: note inkluderer scanned/divergences/alertsCreated", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => ({
      accountsScanned: 250,
      divergencesFound: 3,
      alertsCreated: 2,
      durationMs: 1234.5,
    }),
  };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
  });
  const result = await job(new Date("2026-04-26T01:00:00").getTime());
  assert.equal(result.itemsProcessed, 3, "itemsProcessed = divergencesFound");
  assert.match(result.note ?? "", /scanned=250/);
  assert.match(result.note ?? "", /divergences=3/);
  assert.match(result.note ?? "", /alertsCreated=2/);
  assert.match(result.note ?? "", /durationMs=1235/); // rundes
});

test("wallet-reconciliation: alwaysRun overstyrer hour og date-key", async () => {
  const rec: Recorder = { calls: 0 };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 23,
    runAtMinuteLocal: 59,
    alwaysRun: true,
  });
  const morning = new Date("2026-04-26T08:00:00").getTime();
  await job(morning);
  await job(morning);
  assert.equal(rec.calls, 2, "alwaysRun skal ignorere date-key");
});

// ── Error handling ────────────────────────────────────────────────────────

test("wallet-reconciliation: 42P01 fra service → soft no-op (migrasjon ikke kjørt)", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => {
      const err = new Error("relation \"wallet_reconciliation_alerts\" does not exist") as Error & {
        code?: string;
      };
      err.code = "42P01";
      throw err;
    },
  };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /tabell mangler/i);
});

test("wallet-reconciliation: ikke-42P01 feil propageres", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => {
      throw new Error("catastrophic failure");
    },
  };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
    alwaysRun: true,
  });
  await assert.rejects(() => job(Date.now()), /catastrophic failure/);
});

test("wallet-reconciliation: clean run logger info-note (ikke warn-route)", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => ({
      accountsScanned: 1000,
      divergencesFound: 0,
      alertsCreated: 0,
      durationMs: 500,
    }),
  };
  const job = createWalletReconciliationJob({
    service: makeService(rec),
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0, "clean run = 0 items");
  assert.match(result.note ?? "", /divergences=0/);
});
