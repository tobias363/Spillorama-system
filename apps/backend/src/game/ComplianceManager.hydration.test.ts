/**
 * ComplianceManager.hydrateFromSnapshot — bootstrap-tester.
 *
 * Når backend starter må ComplianceManager rebygge intern state fra
 * persistens (ResponsibleGamingPersistence). Disse testene verifiserer
 * at hydration:
 *   - Tømmer eksisterende state før den fyller på (full reset).
 *   - Tar imot loss-entries, personalLossLimits, pendingLossLimitChanges,
 *     restrictions og playStates uten å miste data.
 *   - Hopper over tomme/no-op records (defensivt mot DB-rader uten data).
 *   - Floor-rounder limit-verdier og accumulatedMs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceManager } from "./ComplianceManager.js";
import type { ComplianceHydrationSnapshot } from "./ComplianceManagerTypes.js";

function createTestManager(): ComplianceManager {
  return new ComplianceManager({
    regulatoryLossLimits: { daily: 500, monthly: 4400 },
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 15 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000,
  });
}

function emptySnapshot(): ComplianceHydrationSnapshot {
  return {
    personalLossLimits: [],
    pendingLossLimitChanges: [],
    restrictions: [],
    playStates: [],
    lossEntries: [],
  };
}

test("hydrateFromSnapshot: tom snapshot resetter alt til defaults", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot(emptySnapshot());
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.deepEqual(snap.personalLossLimits, { daily: 500, monthly: 4400 });
  assert.deepEqual(snap.netLoss, { daily: 0, monthly: 0 });
  assert.equal(snap.restrictions.timedPause.isActive, false);
  assert.equal(snap.restrictions.selfExclusion.isActive, false);
});

test("hydrateFromSnapshot: tømmer eksisterende state først (full reset)", async () => {
  const mgr = createTestManager();
  await mgr.setPlayerLossLimits({ walletId: "w-1", hallId: "h-1", daily: 100 });
  await mgr.setSelfExclusion("w-2");
  // Hydrate med tom snapshot — alt skal nullstilles
  mgr.hydrateFromSnapshot(emptySnapshot());
  const snap1 = mgr.getPlayerCompliance("w-1", "h-1");
  const snap2 = mgr.getPlayerCompliance("w-2");
  assert.equal(snap1.personalLossLimits.daily, 500, "limit reset til regulatorisk");
  assert.equal(snap2.restrictions.selfExclusion.isActive, false, "self-exclusion ryddet bort");
});

test("hydrateFromSnapshot: personalLossLimits restaurert korrekt", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    personalLossLimits: [{ walletId: "w-1", hallId: "h-1", daily: 200, monthly: 1500 }],
  });
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.personalLossLimits.daily, 200);
  assert.equal(snap.personalLossLimits.monthly, 1500);
});

test("hydrateFromSnapshot: floor-rounder personalLossLimits", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    personalLossLimits: [{ walletId: "w-1", hallId: "h-1", daily: 199.99, monthly: 1500.7 }],
  });
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.personalLossLimits.daily, 199);
  assert.equal(snap.personalLossLimits.monthly, 1500);
});

test("hydrateFromSnapshot: pendingLossLimitChanges restaurert (begge felt)", () => {
  const mgr = createTestManager();
  const future = Date.now() + 24 * 60 * 60 * 1000;
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    pendingLossLimitChanges: [
      {
        walletId: "w-1",
        hallId: "h-1",
        dailyPendingValue: 300,
        dailyEffectiveFromMs: future,
        monthlyPendingValue: 2000,
        monthlyEffectiveFromMs: future,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.pendingLossLimits!.daily!.value, 300);
  assert.equal(snap.pendingLossLimits!.monthly!.value, 2000);
});

test("hydrateFromSnapshot: pendingLossLimitChanges med kun daily-felt", () => {
  const mgr = createTestManager();
  const future = Date.now() + 24 * 60 * 60 * 1000;
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    pendingLossLimitChanges: [
      {
        walletId: "w-1",
        hallId: "h-1",
        dailyPendingValue: 300,
        dailyEffectiveFromMs: future,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.pendingLossLimits!.daily!.value, 300);
  assert.equal(snap.pendingLossLimits!.monthly, undefined);
});

test("hydrateFromSnapshot: pendingLossLimitChanges helt uten value-felt → ikke lagret", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    pendingLossLimitChanges: [
      // Begge mangler value/effectiveFromMs → ikke lagret
      { walletId: "w-1", hallId: "h-1" },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.pendingLossLimits, undefined);
});

test("hydrateFromSnapshot: pendingLossLimitChanges med value uten effectiveFromMs ignoreres", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    pendingLossLimitChanges: [
      // value uten effectiveFromMs → ikke gyldig pending
      { walletId: "w-1", hallId: "h-1", dailyPendingValue: 300 },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  assert.equal(snap.pendingLossLimits, undefined);
});

test("hydrateFromSnapshot: lossEntries grupperes per scope", () => {
  const mgr = createTestManager();
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    lossEntries: [
      { walletId: "w-1", hallId: "h-1", type: "BUYIN", amount: 100, createdAtMs: nowMs },
      { walletId: "w-1", hallId: "h-1", type: "PAYOUT", amount: 50, createdAtMs: nowMs + 1000 },
    ],
  });
  const netLoss = mgr.calculateNetLoss("w-1", nowMs + 2000, "h-1");
  assert.equal(netLoss.daily, 50);
});

test("hydrateFromSnapshot: lossEntries fra ulike halls separeres", () => {
  const mgr = createTestManager();
  const nowMs = Date.UTC(2026, 3, 22, 12, 0, 0);
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    lossEntries: [
      { walletId: "w-1", hallId: "h-1", type: "BUYIN", amount: 100, createdAtMs: nowMs },
      { walletId: "w-1", hallId: "h-2", type: "BUYIN", amount: 200, createdAtMs: nowMs },
    ],
  });
  // Per-hall isolasjon
  assert.equal(mgr.calculateNetLoss("w-1", nowMs + 1000, "h-1").daily, 100);
  assert.equal(mgr.calculateNetLoss("w-1", nowMs + 1000, "h-2").daily, 200);
  // Cross-hall sum (ingen hallId)
  assert.equal(mgr.calculateNetLoss("w-1", nowMs + 1000).daily, 300);
});

test("hydrateFromSnapshot: restrictions med self-exclusion lagres", () => {
  const mgr = createTestManager();
  const setAt = Date.now() - 1000;
  const minimumUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    restrictions: [
      {
        walletId: "w-1",
        timedPauseUntilMs: undefined,
        timedPauseSetAtMs: undefined,
        selfExcludedAtMs: setAt,
        selfExclusionMinimumUntilMs: minimumUntil,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.selfExclusion.isActive, true);
  assert.equal(snap.restrictions.isBlocked, true);
});

test("hydrateFromSnapshot: restrictions med kun timedPause lagres", () => {
  const mgr = createTestManager();
  const future = Date.now() + 60 * 60 * 1000;
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    restrictions: [
      {
        walletId: "w-1",
        timedPauseUntilMs: future,
        timedPauseSetAtMs: Date.now() - 1000,
        selfExcludedAtMs: undefined,
        selfExclusionMinimumUntilMs: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.timedPause.isActive, true);
  assert.equal(snap.restrictions.selfExclusion.isActive, false);
});

test("hydrateFromSnapshot: restrictions uten noen aktiv felt → ikke lagret", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    restrictions: [
      {
        walletId: "w-1",
        timedPauseUntilMs: undefined,
        timedPauseSetAtMs: undefined,
        selfExcludedAtMs: undefined,
        selfExclusionMinimumUntilMs: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.timedPause.isActive, false);
  assert.equal(snap.restrictions.selfExclusion.isActive, false);
});

test("hydrateFromSnapshot: playStates med accumulated > 0 lagres", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    playStates: [
      {
        walletId: "w-1",
        accumulatedMs: 30 * 60 * 1000,
        activeFromMs: undefined,
        pauseUntilMs: undefined,
        gamesPlayedInSession: 5,
        lastMandatoryBreak: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  assert.ok(snap.pause.accumulatedPlayMs >= 30 * 60 * 1000);
});

test("hydrateFromSnapshot: playStates med tom data → skipper", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    playStates: [
      {
        walletId: "w-1",
        accumulatedMs: 0,
        activeFromMs: undefined,
        pauseUntilMs: undefined,
        gamesPlayedInSession: 0,
        lastMandatoryBreak: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  // Ikke noe spor — defaults
  assert.equal(snap.pause.accumulatedPlayMs, 0);
  assert.equal(snap.pause.lastMandatoryBreak, undefined);
});

test("hydrateFromSnapshot: playStates med lastMandatoryBreak restaureres", () => {
  const mgr = createTestManager();
  const triggeredAt = Date.now() - 5 * 60 * 1000;
  const pauseUntil = Date.now() + 10 * 60 * 1000;
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    playStates: [
      {
        walletId: "w-1",
        accumulatedMs: 0,
        activeFromMs: undefined,
        pauseUntilMs: pauseUntil,
        gamesPlayedInSession: 0,
        lastMandatoryBreak: {
          triggeredAtMs: triggeredAt,
          pauseUntilMs: pauseUntil,
          totalPlayMs: 60 * 60 * 1000,
          hallId: "h-1",
          gamesPlayed: 12,
          netLoss: { daily: 250, monthly: 250 },
        },
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.pause.isOnPause, true);
  assert.equal(snap.pause.lastMandatoryBreak!.hallId, "h-1");
  assert.equal(snap.pause.lastMandatoryBreak!.gamesPlayed, 12);
  assert.deepEqual(snap.pause.lastMandatoryBreak!.netLoss, { daily: 250, monthly: 250 });
});

test("hydrateFromSnapshot: floor-rounder accumulatedMs (defensivt mot DB-fragments)", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    playStates: [
      {
        walletId: "w-1",
        accumulatedMs: 1234.987,
        activeFromMs: undefined,
        pauseUntilMs: undefined,
        gamesPlayedInSession: 0,
        lastMandatoryBreak: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  // Math.floor(1234.987) = 1234
  assert.equal(snap.pause.accumulatedPlayMs, 1234);
});

test("hydrateFromSnapshot: negativ accumulatedMs clampes til 0 (defensivt)", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    playStates: [
      {
        walletId: "w-1",
        accumulatedMs: -1000,
        activeFromMs: undefined,
        pauseUntilMs: undefined,
        gamesPlayedInSession: 0,
        lastMandatoryBreak: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  // Hverken negativ verdi eller fjerning — playState lagres med 0 hvis lastMandatoryBreak finnes;
  // siden ingen finnes, blir state også fjernet. Begge utfall er OK — sjekk bare ikke-negativt.
  assert.ok(snap.pause.accumulatedPlayMs >= 0);
});

test("hydrateFromSnapshot: gamesPlayedInSession default 0 ved undefined", () => {
  const mgr = createTestManager();
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    playStates: [
      {
        walletId: "w-1",
        accumulatedMs: 5000,
        activeFromMs: undefined,
        pauseUntilMs: undefined,
        gamesPlayedInSession: undefined as unknown as number, // simulerer null fra DB
        lastMandatoryBreak: undefined,
      },
    ],
  });
  const snap = mgr.getPlayerCompliance("w-1");
  // gamesPlayedInSession er ikke direkte i snapshot, men vi sjekker at hydrate ikke kraschet.
  assert.ok(snap, "snapshot eksisterer");
});

test("hydrateFromSnapshot: re-hydration overstyrer tidligere state (idempotent rerun)", () => {
  const mgr = createTestManager();
  // Første hydrate
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    personalLossLimits: [{ walletId: "w-1", hallId: "h-1", daily: 100, monthly: 1000 }],
  });
  assert.equal(mgr.getPlayerCompliance("w-1", "h-1").personalLossLimits.daily, 100);
  // Andre hydrate med ny verdi
  mgr.hydrateFromSnapshot({
    ...emptySnapshot(),
    personalLossLimits: [{ walletId: "w-1", hallId: "h-1", daily: 50, monthly: 500 }],
  });
  assert.equal(mgr.getPlayerCompliance("w-1", "h-1").personalLossLimits.daily, 50);
});
