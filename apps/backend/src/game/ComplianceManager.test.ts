/**
 * Regulatorisk regresjonstest for netto-loss-beregning.
 *
 * ComplianceManager.calculateNetLoss bruker netto-beregning: BUYIN - PAYOUT
 * (flooret til 0). Dette er et regulatorisk krav (pengespillforskriften §11) —
 * gevinster som brukes videre skal IKKE telle mot daglig/månedlig tapsgrense.
 *
 * Testene her beskytter mot fremtidig brutto-regresjon. Hvis en utvikler
 * utilsiktet endrer formelen til brutto (BUYIN-sum uavhengig av PAYOUT), vil
 * minst én av assertions nedenfor feile.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceManager } from "./ComplianceManager.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestComplianceManager(): ComplianceManager {
  return new ComplianceManager({
    regulatoryLossLimits: { daily: 500, monthly: 4400 },
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 15 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000
  });
}

// ── calculateNetLoss: netto-beregning ────────────────────────────────

test("calculateNetLoss: PAYOUT reduserer daglig og månedlig grense-teller", async () => {
  const mgr = createTestComplianceManager();
  const walletId = "test-wallet-1";
  const hallId = "test-hall";
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0); // Midt i døgn og måned

  // Steg 1: BUYIN 500 — bruker har tapt 500 netto.
  await mgr.recordLossEntry(walletId, hallId, {
    type: "BUYIN",
    amount: 500,
    createdAtMs: nowMs
  });
  assert.deepEqual(
    mgr.calculateNetLoss(walletId, nowMs, hallId),
    { daily: 500, monthly: 500 },
    "Etter BUYIN 500 skal netto = 500"
  );

  // Steg 2: PAYOUT 1000 — gevinst 1000. Netto = 500 - 1000 = -500 → flooret til 0.
  await mgr.recordLossEntry(walletId, hallId, {
    type: "PAYOUT",
    amount: 1000,
    createdAtMs: nowMs + 1_000
  });
  assert.deepEqual(
    mgr.calculateNetLoss(walletId, nowMs + 1_000, hallId),
    { daily: 0, monthly: 0 },
    "Etter PAYOUT 1000 på 500 BUYIN skal netto = 0 (floored)"
  );

  // Steg 3: BUYIN 500 fra gevinsten — skal IKKE telle mot grense
  // (samlet: 1000 BUYIN - 1000 PAYOUT = 0 netto).
  await mgr.recordLossEntry(walletId, hallId, {
    type: "BUYIN",
    amount: 500,
    createdAtMs: nowMs + 2_000
  });
  assert.deepEqual(
    mgr.calculateNetLoss(walletId, nowMs + 2_000, hallId),
    { daily: 0, monthly: 0 },
    "Gevinst-bruk skal ikke telle: BUYIN 500+500 - PAYOUT 1000 = 0"
  );

  // Steg 4: Enda 1000 i BUYIN — nå er gevinsten brukt opp, bruker taper egne penger.
  // Samlet: 2000 BUYIN - 1000 PAYOUT = 1000 netto.
  await mgr.recordLossEntry(walletId, hallId, {
    type: "BUYIN",
    amount: 1000,
    createdAtMs: nowMs + 3_000
  });
  assert.deepEqual(
    mgr.calculateNetLoss(walletId, nowMs + 3_000, hallId),
    { daily: 1000, monthly: 1000 },
    "Når gevinst er brukt opp skal egne tap telle igjen: netto = 1000"
  );
});

test("calculateNetLoss: PAYOUT alene uten BUYIN flooret til 0", () => {
  const mgr = createTestComplianceManager();
  const walletId = "test-wallet-payout-only";
  const hallId = "test-hall";
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Edge case: PAYOUT uten forutgående BUYIN (ikke mulig i praksis, men
  // forsikrer at floor-logikken aldri gir negativ netto).
  void mgr.recordLossEntry(walletId, hallId, {
    type: "PAYOUT",
    amount: 500,
    createdAtMs: nowMs
  });
  assert.deepEqual(mgr.calculateNetLoss(walletId, nowMs, hallId), { daily: 0, monthly: 0 });
});

// ── wouldExceedLossLimit: avviser ikke gevinst-bruk ──────────────────

test("wouldExceedLossLimit: gevinst-bruk avviser ikke selv om sum BUYIN > limit", async () => {
  const mgr = createTestComplianceManager(); // daily-limit: 500
  const walletId = "test-wallet-2";
  const hallId = "test-hall";
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);

  // Bruker har 500 BUYIN + 1000 PAYOUT → netto = 0.
  await mgr.recordLossEntry(walletId, hallId, {
    type: "BUYIN",
    amount: 500,
    createdAtMs: nowMs
  });
  await mgr.recordLossEntry(walletId, hallId, {
    type: "PAYOUT",
    amount: 1000,
    createdAtMs: nowMs + 1_000
  });

  // Forsøk på 100 kr ny BUYIN skal IKKE avvises: netto 0 + 100 = 100 ≤ 500.
  // Ved brutto-regresjon ville dette feilaktig vært 500 + 100 = 600 > 500.
  assert.equal(
    mgr.wouldExceedLossLimit(walletId, 100, nowMs + 2_000, hallId),
    false,
    "Gevinst-bruk innenfor limit skal ikke avvises"
  );

  // Sanity-sjekk: BUYIN som ville presset netto over grensen skal avvises.
  // Netto er 0, limit er 500 → 501 kr BUYIN skal avvises.
  assert.equal(
    mgr.wouldExceedLossLimit(walletId, 501, nowMs + 2_000, hallId),
    true,
    "BUYIN som presser netto over daglig grense skal avvises"
  );
});
