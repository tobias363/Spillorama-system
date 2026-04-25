/**
 * ComplianceManager — personal loss-limit lifecycle tests.
 *
 * Pengespillforskriften § 11 + Spillorama Spillvett-policy:
 *   - Spillere skal kunne sette eget tap-limit ≤ regulatorisk grense.
 *   - Senking av limit aktiveres umiddelbart (fail-closed for spiller).
 *   - Økning av limit må forsinkes (default: starten av neste dag/måned;
 *     BIN-720 spiller-self-service: 48h).
 *   - Pending-økning kan overskrives av en ny verdi før den effektueres.
 *   - Ingen path skal kunne sette limit høyere enn regulatorisk maks.
 *
 * Disse testene dekker `setPlayerLossLimits`, `setPlayerLossLimitsWithEffectiveAt`,
 * `getEffectiveLossLimits`, og `promotePendingLossLimitIfDue`. Den eksisterende
 * `ComplianceManager.test.ts` dekker netto-tap-beregning (calculateNetLoss /
 * wouldExceedLossLimit), så samme code-paths re-testes ikke her.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceManager } from "./ComplianceManager.js";

function createTestManager(): ComplianceManager {
  return new ComplianceManager({
    regulatoryLossLimits: { daily: 500, monthly: 4400 },
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 15 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000,
  });
}

// ── setPlayerLossLimits — input-validering ──────────────────────────────────

test("setPlayerLossLimits: avviser tom walletId (INVALID_INPUT)", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "", hallId: "h-1", daily: 100 }),
    /walletId mangler/,
  );
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "   ", hallId: "h-1", daily: 100 }),
    /walletId mangler/,
  );
});

test("setPlayerLossLimits: avviser tom hallId (INVALID_INPUT)", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "", daily: 100 }),
    /hallId mangler/,
  );
});

test("setPlayerLossLimits: avviser negativ daily-limit (INVALID_INPUT)", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: -1 }),
    /dailyLossLimit må være 0 eller større/,
  );
});

test("setPlayerLossLimits: avviser NaN/Infinity daily-limit (INVALID_INPUT)", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: Number.NaN }),
    /dailyLossLimit må være 0 eller større/,
  );
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: Number.POSITIVE_INFINITY }),
    /dailyLossLimit må være 0 eller større/,
  );
});

test("setPlayerLossLimits: avviser negativ monthly-limit (INVALID_INPUT)", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", monthly: -100 }),
    /monthlyLossLimit må være 0 eller større/,
  );
});

// ── setPlayerLossLimits — regulatorisk øvre grense (KRITISK fail-closed) ─────

test("setPlayerLossLimits: REGULATORY GUARD — daglig over regulatorisk grense kastes", async () => {
  const mgr = createTestManager(); // regulatorisk daglig = 500
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 501 }),
    /dailyLossLimit kan ikke være høyere enn regulatorisk grense \(500\)/,
  );
});

test("setPlayerLossLimits: REGULATORY GUARD — månedlig over regulatorisk grense kastes", async () => {
  const mgr = createTestManager(); // regulatorisk månedlig = 4400
  await assert.rejects(
    () => mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", monthly: 4401 }),
    /monthlyLossLimit kan ikke være høyere enn regulatorisk grense \(4400\)/,
  );
});

test("setPlayerLossLimits: nøyaktig på regulatorisk grense aksepteres (boundary)", async () => {
  const mgr = createTestManager();
  const result = await mgr.setPlayerLossLimits({
    walletId: "w-1",
    hallId: "h-1",
    daily: 500,
    monthly: 4400,
  });
  assert.deepEqual(result.personalLossLimits, { daily: 500, monthly: 4400 });
});

// ── setPlayerLossLimits — senking aktiveres umiddelbart ─────────────────────

test("setPlayerLossLimits: senking av daily aktiveres umiddelbart (fail-closed for spiller)", async () => {
  const mgr = createTestManager();
  // Sett opp eksisterende limit på regulatorisk maks
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 500 });
  // Senk til 100 — skal aktiveres umiddelbart
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  assert.equal(result.personalLossLimits.daily, 100);
  assert.equal(result.pendingLossLimits?.daily, undefined, "ingen pending etter senking");
});

test("setPlayerLossLimits: senking under default starter ny limit umiddelbart", async () => {
  const mgr = createTestManager();
  // Direkte senking uten forutgående setup — default = regulatorisk
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 200 });
  assert.equal(result.personalLossLimits.daily, 200);
  assert.equal(result.pendingLossLimits?.daily, undefined);
});

test("setPlayerLossLimits: senking til 0 aksepteres (lås seg selv ut av spill)", async () => {
  const mgr = createTestManager();
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 0 });
  assert.equal(result.personalLossLimits.daily, 0);
});

// ── setPlayerLossLimits — økning krever pending (effektiv fra neste dag/mnd) ─

test("setPlayerLossLimits: økning av daily lagres som pending (ikke aktiv før neste dag)", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  // Forsøk på å øke fra 100 til 300 — skal lagres som pending
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 300 });
  assert.equal(result.personalLossLimits.daily, 100, "active er fortsatt 100");
  assert.ok(result.pendingLossLimits?.daily, "pending eksisterer");
  assert.equal(result.pendingLossLimits!.daily!.value, 300);
  // effectiveFrom skal være ISO-string
  assert.match(result.pendingLossLimits!.daily!.effectiveFrom, /^\d{4}-\d{2}-\d{2}T/);
});

test("setPlayerLossLimits: økning av monthly lagres som pending (ikke aktiv før neste mnd)", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", monthly: 1000 });
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", monthly: 2000 });
  assert.equal(result.personalLossLimits.monthly, 1000, "active er fortsatt 1000");
  assert.equal(result.pendingLossLimits!.monthly!.value, 2000);
});

test("setPlayerLossLimits: ny pending overstyrer tidligere pending med samme limit-felt", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  // Pending = 300
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 300 });
  // Pending = 400 (overstyrer 300)
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 400 });
  assert.equal(result.pendingLossLimits!.daily!.value, 400);
  assert.equal(result.personalLossLimits.daily, 100, "active fortsatt 100");
});

test("setPlayerLossLimits: senking sletter eksisterende pending-økning", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 300 });
  // Senk igjen — pending skal forsvinne
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 50 });
  assert.equal(result.personalLossLimits.daily, 50);
  assert.equal(result.pendingLossLimits?.daily, undefined);
});

test("setPlayerLossLimits: floor-rounding av desimal-verdier", async () => {
  const mgr = createTestManager();
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 199.99 });
  assert.equal(result.personalLossLimits.daily, 199, "199.99 floored til 199");
});

test("setPlayerLossLimits: kun daily-felt ikke endrer monthly", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 200, monthly: 1000 });
  const result = await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  assert.equal(result.personalLossLimits.daily, 100);
  assert.equal(result.personalLossLimits.monthly, 1000, "monthly uendret");
});

// ── setPlayerLossLimits — wallet/hall trim ──────────────────────────────────

test("setPlayerLossLimits: trimmer whitespace i walletId og hallId", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "  w-1  ", hallId: "  h-1  ", daily: 100 });
  // Hent uten whitespace — samme scope
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.personalLossLimits.daily, 100);
});

// ── setPlayerLossLimitsWithEffectiveAt (BIN-720 self-service med 48h) ───────

test("setPlayerLossLimitsWithEffectiveAt: dailyDecrease aktiveres umiddelbart", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 500 });
  const result = await mgr.setPlayerLossLimitsWithEffectiveAt({
    walletId: "w-1",
    hallId: "h-1",
    dailyDecrease: 100,
  });
  assert.equal(result.personalLossLimits.daily, 100);
  assert.equal(result.pendingLossLimits?.daily, undefined);
});

test("setPlayerLossLimitsWithEffectiveAt: dailyDecrease over regulatorisk grense kastes", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimitsWithEffectiveAt({
        walletId: "w-1",
        hallId: "h-1",
        dailyDecrease: 501,
      }),
    /regulatorisk grense \(500\)/,
  );
});

test("setPlayerLossLimitsWithEffectiveAt: dailyDecrease NaN kastes", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimitsWithEffectiveAt({
        walletId: "w-1",
        hallId: "h-1",
        dailyDecrease: Number.NaN,
      }),
    /daily må være 0 eller større/,
  );
});

test("setPlayerLossLimitsWithEffectiveAt: monthlyDecrease aktiveres umiddelbart", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", monthly: 4400 });
  const result = await mgr.setPlayerLossLimitsWithEffectiveAt({
    walletId: "w-1",
    hallId: "h-1",
    monthlyDecrease: 1000,
  });
  assert.equal(result.personalLossLimits.monthly, 1000);
  assert.equal(result.pendingLossLimits?.monthly, undefined);
});

test("setPlayerLossLimitsWithEffectiveAt: monthlyDecrease over regulatorisk grense kastes", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimitsWithEffectiveAt({
        walletId: "w-1",
        hallId: "h-1",
        monthlyDecrease: 4401,
      }),
    /regulatorisk grense \(4400\)/,
  );
});

test("setPlayerLossLimitsWithEffectiveAt: daily-økning lagres med eksplisitt effectiveFromMs", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  const future = Date.now() + 48 * 60 * 60 * 1000; // 48h fram
  const result = await mgr.setPlayerLossLimitsWithEffectiveAt({
    walletId: "w-1",
    hallId: "h-1",
    daily: { value: 300, effectiveFromMs: future },
  });
  assert.equal(result.personalLossLimits.daily, 100, "active fortsatt 100");
  assert.equal(result.pendingLossLimits!.daily!.value, 300);
  assert.equal(result.pendingLossLimits!.daily!.effectiveFrom, new Date(future).toISOString());
});

test("setPlayerLossLimitsWithEffectiveAt: REGULATORY GUARD — daily-økning over regulatorisk avvises", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimitsWithEffectiveAt({
        walletId: "w-1",
        hallId: "h-1",
        daily: { value: 501, effectiveFromMs: Date.now() + 1000 },
      }),
    /regulatorisk grense \(500\)/,
  );
});

test("setPlayerLossLimitsWithEffectiveAt: REGULATORY GUARD — monthly-økning over regulatorisk avvises", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () =>
      mgr.setPlayerLossLimitsWithEffectiveAt({
        walletId: "w-1",
        hallId: "h-1",
        monthly: { value: 4401, effectiveFromMs: Date.now() + 1000 },
      }),
    /regulatorisk grense \(4400\)/,
  );
});

test("setPlayerLossLimitsWithEffectiveAt: avviser tom walletId/hallId", async () => {
  const mgr = createTestManager();
  await assert.rejects(
    () => mgr.setPlayerLossLimitsWithEffectiveAt({ walletId: "", hallId: "h-1", dailyDecrease: 100 }),
    /walletId mangler/,
  );
  await assert.rejects(
    () => mgr.setPlayerLossLimitsWithEffectiveAt({ walletId: "w-1", hallId: "", dailyDecrease: 100 }),
    /hallId mangler/,
  );
});

// ── getEffectiveLossLimits ─────────────────────────────────────────────────

test("getEffectiveLossLimits: uten hallId returnerer regulatorisk grense", () => {
  const mgr = createTestManager();
  const limits = mgr.getEffectiveLossLimits("w-1");
  assert.deepEqual(limits, { daily: 500, monthly: 4400 });
});

test("getEffectiveLossLimits: med hallId og ingen tidligere setup returnerer regulatorisk", () => {
  const mgr = createTestManager();
  const limits = mgr.getEffectiveLossLimits("w-1", "h-1");
  assert.deepEqual(limits, { daily: 500, monthly: 4400 });
});

test("getEffectiveLossLimits: returnerer min(personal, regulatory) — defensivt floor", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 200 });
  const limits = mgr.getEffectiveLossLimits("w-1", "h-1");
  assert.equal(limits.daily, 200);
});

// ── promotePendingLossLimitIfDue ───────────────────────────────────────────

test("promotePendingLossLimitIfDue: ingen pending → returnerer false", async () => {
  const mgr = createTestManager();
  const promoted = await mgr.promotePendingLossLimitIfDue("w-1", "h-1", Date.now());
  assert.equal(promoted, false);
});

test("promotePendingLossLimitIfDue: pending som ikke er due → returnerer false", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 300 });
  // Sjekk med tid før effectiveFromMs
  const promoted = await mgr.promotePendingLossLimitIfDue("w-1", "h-1", Date.now());
  assert.equal(promoted, false, "pending starter neste dag → ikke due nå");
});

test("promotePendingLossLimitIfDue: pending som er due → returnerer true og promoterer", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 300 });
  // Hopp tiden 2 dager fram → pending burde være due
  const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const promoted = await mgr.promotePendingLossLimitIfDue("w-1", "h-1", future);
  assert.equal(promoted, true);
  // Verifiser at den faktisk er promotert
  const limits = mgr.getEffectiveLossLimits("w-1", "h-1", future);
  assert.equal(limits.daily, 300);
});

test("promotePendingLossLimitIfDue: trimmer whitespace", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 300 });
  const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const promoted = await mgr.promotePendingLossLimitIfDue("  w-1  ", "  h-1  ", future);
  assert.equal(promoted, true);
});
