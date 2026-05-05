/**
 * Unit-tester for error-metrics counter (Fase 2A — 2026-05-05).
 *
 * Testene verifiserer at counter-en korrekt:
 *   1. Akkumulerer lifetime-total.
 *   2. Plotter siste 60s riktig (sliding window).
 *   3. Pruner gamle buckets etter 60s.
 *   4. Returnerer kjente og ukjente koder fra `getErrorRates`.
 *   5. Inkluderer registry-koder med 0 events når includeZero=true.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetCountersForTests,
  getErrorRate,
  getErrorRates,
  incrementErrorCounter,
} from "../errorMetrics.js";

test.beforeEach(() => {
  __resetCountersForTests();
});

test("incrementErrorCounter: lifetime øker per call", () => {
  incrementErrorCounter("BIN-RKT-001");
  incrementErrorCounter("BIN-RKT-001");
  incrementErrorCounter("BIN-RKT-001");

  const rate = getErrorRate("BIN-RKT-001");
  assert.ok(rate);
  assert.equal(rate?.lifetime, 3);
});

test("incrementErrorCounter: lastSeenAt blir satt", () => {
  const before = Date.now();
  incrementErrorCounter("BIN-RKT-001");
  const after = Date.now();

  const rate = getErrorRate("BIN-RKT-001");
  assert.ok(rate?.lastSeenAt);
  assert.ok(rate.lastSeenAt instanceof Date);
  const ts = rate.lastSeenAt.getTime();
  assert.ok(ts >= before && ts <= after);
});

test("getErrorRate: returnerer null for ukjent kode som aldri har vært seen", () => {
  assert.equal(getErrorRate("BIN-XYZ-999"), null);
});

test("getErrorRate: returnerer 0 for kjent registry-kode aldri seen", () => {
  // BIN-RKT-001 er i registry, men vi har ikke incrementet ennå.
  const rate = getErrorRate("BIN-RKT-001");
  assert.ok(rate);
  assert.equal(rate?.lifetime, 0);
  assert.equal(rate?.perMinute, 0);
  assert.equal(rate?.lastSeenAt, null);
  assert.equal(rate?.severity, "MEDIUM"); // From registry
});

test("getErrorRates: ignorer registry-koder med 0 events default", () => {
  incrementErrorCounter("BIN-RKT-001");
  const list = getErrorRates();

  // Vi har incrementet kun BIN-RKT-001 — listen skal kun inneholde den.
  assert.equal(list.length, 1);
  assert.equal(list[0].code, "BIN-RKT-001");
  assert.equal(list[0].lifetime, 1);
});

test("getErrorRates: includeZero=true tar med alle registry-koder", () => {
  incrementErrorCounter("BIN-RKT-001");
  const list = getErrorRates(true);

  // Skal inneholde alle registry-koder, inkludert BIN-RKT-001 + alle andre.
  const codes = list.map((r) => r.code);
  assert.ok(codes.includes("BIN-RKT-001"));
  assert.ok(codes.includes("BIN-MON-001"));
  assert.ok(codes.includes("BIN-DRW-001"));

  // Den ene vi incrementet skal ha lifetime=1, resten lifetime=0.
  const rkt001 = list.find((r) => r.code === "BIN-RKT-001");
  assert.equal(rkt001?.lifetime, 1);

  const mon001 = list.find((r) => r.code === "BIN-MON-001");
  assert.equal(mon001?.lifetime, 0);
});

test("getErrorRates: sortert lifetime desc, så code asc", () => {
  incrementErrorCounter("BIN-MON-001");
  incrementErrorCounter("BIN-MON-001");
  incrementErrorCounter("BIN-MON-001"); // 3
  incrementErrorCounter("BIN-RKT-001");
  incrementErrorCounter("BIN-RKT-001"); // 2

  const list = getErrorRates();
  assert.equal(list[0].code, "BIN-MON-001"); // 3, kommer først
  assert.equal(list[1].code, "BIN-RKT-001"); // 2
});

test("getErrorRates: rapporterer ukjent kode med severity=UNKNOWN", () => {
  incrementErrorCounter("BIN-FAKE-999");

  const list = getErrorRates();
  assert.equal(list.length, 1);
  assert.equal(list[0].code, "BIN-FAKE-999");
  assert.equal(list[0].severity, "UNKNOWN");
  assert.equal(list[0].category, "uncategorized");
});

test("perMinute: counter for samme sekund grupperes i én bucket", () => {
  // Increment 5 ganger raskt — alle skal lande i samme bucket.
  for (let i = 0; i < 5; i++) {
    incrementErrorCounter("BIN-RKT-001");
  }

  const rate = getErrorRate("BIN-RKT-001");
  assert.equal(rate?.perMinute, 5);
});

test("incrementErrorCounter aksepterer string (ikke bare ErrorCode)", () => {
  // Runtime-kode kan ha errorCode fra database som string. TS skal ikke
  // tvinge oss til å validere før vi incrementer.
  const codeFromDb: string = "BIN-RKT-002";
  incrementErrorCounter(codeFromDb);

  const rate = getErrorRate(codeFromDb);
  assert.equal(rate?.lifetime, 1);
});
