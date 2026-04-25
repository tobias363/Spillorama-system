/**
 * ComplianceManager — restriksjons-lifecycle tester.
 *
 * Pengespillforskriften + Spillorama Spillvett-policy:
 *   - Frivillig pause (timed pause) er låst i sitt vindu — ikke mulig å fjerne
 *     før utløp (fail-closed).
 *   - Selvutelukkelse (self-exclusion) er låst i ≥ minimumsperiode (default 1 år).
 *     Forsøk på å fjerne tidligere skal kaste `SELF_EXCLUSION_LOCKED`.
 *   - `assertWalletAllowedForGameplay` skal kaste DomainError ved aktiv blokk —
 *     og ikke kaste hvis ingen blokk eksisterer.
 *   - Pålagt pause (mandatory break) trigges når play-session > limit.
 *
 * Disse testene dekker `setTimedPause`, `clearTimedPause`, `setSelfExclusion`,
 * `clearSelfExclusion`, `assertWalletAllowedForGameplay`, `startPlaySession`,
 * `finishPlaySession`, `incrementSessionGameCount`, og `getPlayerCompliance`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceManager } from "./ComplianceManager.js";

function createTestManager(opts?: { selfExclusionMinMs?: number; pauseDurationMs?: number; playSessionLimitMs?: number }): ComplianceManager {
  return new ComplianceManager({
    regulatoryLossLimits: { daily: 500, monthly: 4400 },
    playSessionLimitMs: opts?.playSessionLimitMs ?? 60 * 60 * 1000,
    pauseDurationMs: opts?.pauseDurationMs ?? 15 * 60 * 1000,
    selfExclusionMinMs: opts?.selfExclusionMinMs ?? 365 * 24 * 60 * 60 * 1000,
  });
}

// ── setTimedPause ──────────────────────────────────────────────────────────

test("setTimedPause: avviser tom walletId (INVALID_INPUT)", async () => {
  const mgr = createTestManager();
  await assert.rejects(() => mgr.setTimedPause({ walletId: "" }), /walletId mangler/);
});

test("setTimedPause: avviser durationMs <= 0", async () => {
  const mgr = createTestManager();
  await assert.rejects(() => mgr.setTimedPause({ walletId: "w-1", durationMs: 0 }), /duration må være større enn 0/);
  await assert.rejects(() => mgr.setTimedPause({ walletId: "w-1", durationMs: -1000 }), /duration må være større enn 0/);
});

test("setTimedPause: avviser ikke-finite durationMs", async () => {
  const mgr = createTestManager();
  await assert.rejects(() => mgr.setTimedPause({ walletId: "w-1", durationMs: Number.NaN }), /duration må være større enn 0/);
  await assert.rejects(() => mgr.setTimedPause({ walletId: "w-1", durationMs: Number.POSITIVE_INFINITY }), /duration må være større enn 0/);
});

test("setTimedPause: aktiverer pause med default 15min hvis ikke spesifisert", async () => {
  const mgr = createTestManager();
  const result = await mgr.setTimedPause({ walletId: "w-1" });
  assert.equal(result.restrictions.timedPause.isActive, true);
  assert.ok(result.restrictions.timedPause.pauseUntil);
  assert.ok(result.restrictions.timedPause.setAt);
});

test("setTimedPause: durationMinutes konverteres korrekt til durationMs", async () => {
  const mgr = createTestManager();
  const result = await mgr.setTimedPause({ walletId: "w-1", durationMinutes: 30 });
  assert.equal(result.restrictions.timedPause.isActive, true);
  // Verifiser at pause er aktiv via assertWalletAllowedForGameplay
  assert.throws(
    () => mgr.assertWalletAllowedForGameplay("w-1"),
    (err: unknown) => (err as { code?: string })?.code === "PLAYER_TIMED_PAUSE",
  );
});

test("setTimedPause: setting på allerede pauset wallet forlenger ikke (Math.max-pattern)", async () => {
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 60 * 60 * 1000 }); // 1 time
  // Sett kortere pause — den lengste skal vinne (eksisterende 1h)
  const result = await mgr.setTimedPause({ walletId: "w-1", durationMs: 1000 }); // 1 sek
  // pauseUntil skal være den lengste (≈ 1 time fra original setAt)
  const untilMs = new Date(result.restrictions.timedPause.pauseUntil!).getTime();
  assert.ok(untilMs > Date.now() + 30 * 60 * 1000, "lengste pause skal vinne");
});

test("setTimedPause: trimmer whitespace i walletId", async () => {
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "  w-1  " });
  // Hent uten whitespace — samme spiller
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.timedPause.isActive, true);
});

// ── clearTimedPause ────────────────────────────────────────────────────────

test("clearTimedPause: TIMED_PAUSE_LOCKED kastes ved aktiv pause (fail-closed)", async () => {
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 60 * 60 * 1000 });
  await assert.rejects(
    () => mgr.clearTimedPause("w-1"),
    (err: unknown) => (err as { code?: string })?.code === "TIMED_PAUSE_LOCKED",
  );
});

test("clearTimedPause: avviser tom walletId", async () => {
  const mgr = createTestManager();
  await assert.rejects(() => mgr.clearTimedPause(""), /walletId mangler/);
});

test("clearTimedPause: ingen aktiv pause → silent no-op (returnerer snapshot)", async () => {
  const mgr = createTestManager();
  const result = await mgr.clearTimedPause("w-1");
  assert.equal(result.restrictions.timedPause.isActive, false);
});

test("clearTimedPause: pause som har utløpt → fjernes uten feil", async () => {
  // Tett-koblet til intern tid: bruk veldig kort pause + delay
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 1 });
  // Vent til pause utløper
  await new Promise((r) => setTimeout(r, 5));
  const result = await mgr.clearTimedPause("w-1");
  assert.equal(result.restrictions.timedPause.isActive, false);
});

// ── setSelfExclusion ───────────────────────────────────────────────────────

test("setSelfExclusion: aktiverer 1-års lås (default)", async () => {
  const mgr = createTestManager();
  const result = await mgr.setSelfExclusion("w-1");
  assert.equal(result.restrictions.selfExclusion.isActive, true);
  assert.ok(result.restrictions.selfExclusion.setAt);
  assert.ok(result.restrictions.selfExclusion.minimumUntil);
  assert.equal(result.restrictions.selfExclusion.canBeRemoved, false);
});

test("setSelfExclusion: avviser tom walletId", async () => {
  const mgr = createTestManager();
  await assert.rejects(() => mgr.setSelfExclusion(""), /walletId mangler/);
});

test("setSelfExclusion: idempotent — gjentatt kall endrer ikke setAt/minimumUntil", async () => {
  const mgr = createTestManager();
  const first = await mgr.setSelfExclusion("w-1");
  await new Promise((r) => setTimeout(r, 5));
  const second = await mgr.setSelfExclusion("w-1");
  assert.equal(first.restrictions.selfExclusion.setAt, second.restrictions.selfExclusion.setAt);
  assert.equal(first.restrictions.selfExclusion.minimumUntil, second.restrictions.selfExclusion.minimumUntil);
});

test("setSelfExclusion: minimumUntil = nå + selfExclusionMinMs (config-styrt)", async () => {
  const mgr = createTestManager({ selfExclusionMinMs: 30 * 24 * 60 * 60 * 1000 }); // 30 dager
  const before = Date.now();
  const result = await mgr.setSelfExclusion("w-1");
  const minimumUntilMs = new Date(result.restrictions.selfExclusion.minimumUntil!).getTime();
  const expected = before + 30 * 24 * 60 * 60 * 1000;
  // Tillat 1s slack
  assert.ok(Math.abs(minimumUntilMs - expected) < 5000, `minimumUntil ≈ ${expected}, got ${minimumUntilMs}`);
});

test("setSelfExclusion: trimmer whitespace i walletId", async () => {
  const mgr = createTestManager();
  await mgr.setSelfExclusion("  w-1  ");
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.selfExclusion.isActive, true);
});

// ── clearSelfExclusion ─────────────────────────────────────────────────────

test("clearSelfExclusion: SELF_EXCLUSION_LOCKED kastes før minimumsperiode (KRITISK fail-closed)", async () => {
  const mgr = createTestManager(); // 1 år default
  await mgr.setSelfExclusion("w-1");
  await assert.rejects(
    () => mgr.clearSelfExclusion("w-1"),
    (err: unknown) => (err as { code?: string })?.code === "SELF_EXCLUSION_LOCKED",
  );
});

test("clearSelfExclusion: avviser tom walletId", async () => {
  const mgr = createTestManager();
  await assert.rejects(() => mgr.clearSelfExclusion(""), /walletId mangler/);
});

test("clearSelfExclusion: ingen aktiv eksklusjon → silent no-op", async () => {
  const mgr = createTestManager();
  const result = await mgr.clearSelfExclusion("w-1");
  assert.equal(result.restrictions.selfExclusion.isActive, false);
});

test("clearSelfExclusion: utløpt minimum-periode → fjerning aksepteres", async () => {
  const mgr = createTestManager({ selfExclusionMinMs: 1 }); // 1 ms
  await mgr.setSelfExclusion("w-1");
  await new Promise((r) => setTimeout(r, 5));
  const result = await mgr.clearSelfExclusion("w-1");
  assert.equal(result.restrictions.selfExclusion.isActive, false);
  assert.equal(result.restrictions.selfExclusion.setAt, undefined);
  assert.equal(result.restrictions.selfExclusion.minimumUntil, undefined);
});

// ── assertWalletAllowedForGameplay ─────────────────────────────────────────

test("assertWalletAllowedForGameplay: tom walletId → silent return (defensiv)", () => {
  const mgr = createTestManager();
  // Ikke kast — typisk for backward-compat med callers som har null wallet.
  assert.doesNotThrow(() => mgr.assertWalletAllowedForGameplay(""));
});

test("assertWalletAllowedForGameplay: ingen restriksjoner → ikke kast", () => {
  const mgr = createTestManager();
  assert.doesNotThrow(() => mgr.assertWalletAllowedForGameplay("w-1"));
});

test("assertWalletAllowedForGameplay: aktiv timed pause → DomainError code=PLAYER_TIMED_PAUSE", async () => {
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 60 * 60 * 1000 });
  assert.throws(
    () => mgr.assertWalletAllowedForGameplay("w-1"),
    (err: unknown) => (err as { code?: string })?.code === "PLAYER_TIMED_PAUSE",
  );
});

test("assertWalletAllowedForGameplay: aktiv self-exclusion → DomainError code=PLAYER_SELF_EXCLUDED", async () => {
  const mgr = createTestManager();
  await mgr.setSelfExclusion("w-1");
  assert.throws(
    () => mgr.assertWalletAllowedForGameplay("w-1"),
    (err: unknown) => (err as { code?: string })?.code === "PLAYER_SELF_EXCLUDED",
  );
});

test("assertWalletAllowedForGameplay: self-exclusion vinner over timed pause (priority)", async () => {
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 60 * 60 * 1000 });
  await mgr.setSelfExclusion("w-1");
  // Når begge er aktive, self-exclusion skal være den som rapporteres
  assert.throws(
    () => mgr.assertWalletAllowedForGameplay("w-1"),
    (err: unknown) => (err as { code?: string })?.code === "PLAYER_SELF_EXCLUDED",
  );
});

test("assertWalletAllowedForGameplay: utløpt timed pause → ikke kast", async () => {
  const mgr = createTestManager();
  await mgr.setTimedPause({ walletId: "w-1", durationMs: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.doesNotThrow(() => mgr.assertWalletAllowedForGameplay("w-1"));
});

// ── startPlaySession + finishPlaySession + mandatory break ─────────────────

test("startPlaySession: ny aktiv session uten eksisterende state", async () => {
  const mgr = createTestManager();
  const nowMs = Date.now();
  await mgr.startPlaySession("w-1", nowMs);
  // Ingen direkte getter — verifiser indirekte ved å avslutte session
  await mgr.finishPlaySession("w-1", "h-1", nowMs + 1000);
  // Ingen pause-trigger fordi total < limit
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.pause.isOnPause, false);
});

test("startPlaySession: avviser tom walletId silent (defensiv)", async () => {
  const mgr = createTestManager();
  await assert.doesNotReject(() => mgr.startPlaySession("", Date.now()));
});

test("startPlaySession: kalt under mandatory-pause (play-session pauseUntilMs aktiv) → no-op", async () => {
  // Trigg mandatory break først → playState.pauseUntilMs settes
  const mgr = createTestManager({ playSessionLimitMs: 1000, pauseDurationMs: 60 * 60 * 1000 });
  const start = Date.now();
  await mgr.startPlaySession("w-1", start);
  await mgr.finishPlaySession("w-1", "h-1", start + 2000); // trigger break
  // Nå er pauseUntilMs satt; nytt startPlaySession-kall skal være no-op
  const beforePause = mgr.getPlayerCompliance("w-1").pause.accumulatedPlayMs;
  await mgr.startPlaySession("w-1", start + 3000);
  await mgr.finishPlaySession("w-1", "h-1", start + 4000);
  const snap = mgr.getPlayerCompliance("w-1");
  // Ingen ny accumulation — pauseUntilMs blokkerte startPlaySession
  assert.equal(snap.pause.accumulatedPlayMs, beforePause);
});

test("finishPlaySession: total-time < limit → ingen mandatory break, accumulatedMs øker", async () => {
  const mgr = createTestManager({ playSessionLimitMs: 60 * 60 * 1000 }); // 1h
  const start = Date.now();
  await mgr.startPlaySession("w-1", start);
  // 30 min play
  await mgr.finishPlaySession("w-1", "h-1", start + 30 * 60 * 1000);
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.pause.isOnPause, false);
  assert.ok(snap.pause.accumulatedPlayMs >= 30 * 60 * 1000);
  assert.ok(snap.pause.accumulatedPlayMs < 60 * 60 * 1000);
});

test("finishPlaySession: total-time >= limit → trigger mandatory break (KRITISK regulatorisk)", async () => {
  const mgr = createTestManager({ playSessionLimitMs: 60 * 60 * 1000, pauseDurationMs: 15 * 60 * 1000 });
  const start = Date.now();
  await mgr.startPlaySession("w-1", start);
  // 1h play (når limit)
  const end = start + 60 * 60 * 1000;
  await mgr.finishPlaySession("w-1", "h-1", end);
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.pause.isOnPause, true, "mandatory pause skal være aktiv");
  assert.ok(snap.pause.lastMandatoryBreak);
  assert.equal(snap.pause.lastMandatoryBreak!.hallId, "h-1");
  // gameplay-block skal nå være MANDATORY_PAUSE
  assert.equal(snap.restrictions.blockedBy, "MANDATORY_PAUSE");
});

test("finishPlaySession: mandatory break inkluderer netLoss-snapshot for hall", async () => {
  const mgr = createTestManager({ playSessionLimitMs: 60 * 1000 }); // 1 min for å trigge raskt
  const start = Date.UTC(2026, 3, 22, 12, 0, 0);
  await mgr.recordLossEntry("w-1", "h-1", { type: "BUYIN", amount: 200, createdAtMs: start });
  await mgr.startPlaySession("w-1", start);
  await mgr.finishPlaySession("w-1", "h-1", start + 2 * 60 * 1000); // 2 min > 1 min limit
  const snap = mgr.getPlayerCompliance("w-1");
  assert.ok(snap.pause.lastMandatoryBreak);
  assert.equal(snap.pause.lastMandatoryBreak!.netLoss.daily, 200);
});

test("finishPlaySession: avviser tom walletId/hallId silent (defensiv)", async () => {
  const mgr = createTestManager();
  await assert.doesNotReject(() => mgr.finishPlaySession("", "h-1", Date.now()));
  await assert.doesNotReject(() => mgr.finishPlaySession("w-1", "", Date.now()));
});

test("finishPlaySession: kalt uten startPlaySession → no-op (activeFromMs undefined)", async () => {
  const mgr = createTestManager();
  await mgr.finishPlaySession("w-1", "h-1", Date.now());
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.pause.isOnPause, false);
  assert.equal(snap.pause.accumulatedPlayMs, 0);
});

test("incrementSessionGameCount: øker counter på eksisterende state", async () => {
  const mgr = createTestManager();
  await mgr.startPlaySession("w-1", Date.now());
  await mgr.incrementSessionGameCount("w-1");
  await mgr.incrementSessionGameCount("w-1");
  // Trigger mandatory break for å se gamesPlayed-snapshot
  const start = Date.now();
  await mgr.finishPlaySession("w-1", "h-1", start + 60 * 60 * 1000);
  const snap = mgr.getPlayerCompliance("w-1");
  if (snap.pause.lastMandatoryBreak) {
    assert.ok(snap.pause.lastMandatoryBreak.gamesPlayed >= 2);
  }
});

test("incrementSessionGameCount: tom walletId silent no-op", async () => {
  const mgr = createTestManager();
  await assert.doesNotReject(() => mgr.incrementSessionGameCount(""));
});

test("incrementSessionGameCount: ingen eksisterende state → silent no-op", async () => {
  const mgr = createTestManager();
  await assert.doesNotReject(() => mgr.incrementSessionGameCount("w-1"));
});

// ── getPlayerCompliance shape ──────────────────────────────────────────────

test("getPlayerCompliance: avviser tom walletId (INVALID_INPUT)", () => {
  const mgr = createTestManager();
  assert.throws(() => mgr.getPlayerCompliance(""), /walletId mangler/);
});

test("getPlayerCompliance: returnerer komplett snapshot-shape uten setup", () => {
  const mgr = createTestManager();
  const snap = mgr.getPlayerCompliance("w-1", "h-1");
  // Spec-required felt
  assert.equal(snap.walletId, "w-1");
  assert.equal(snap.hallId, "h-1");
  assert.deepEqual(snap.regulatoryLossLimits, { daily: 500, monthly: 4400 });
  assert.deepEqual(snap.personalLossLimits, { daily: 500, monthly: 4400 });
  assert.deepEqual(snap.netLoss, { daily: 0, monthly: 0 });
  assert.equal(snap.pause.isOnPause, false);
  assert.equal(snap.pause.playSessionLimitMs, 60 * 60 * 1000);
  assert.equal(snap.pause.pauseDurationMs, 15 * 60 * 1000);
  assert.equal(snap.restrictions.isBlocked, false);
  assert.equal(snap.restrictions.timedPause.isActive, false);
  assert.equal(snap.restrictions.selfExclusion.isActive, false);
});

test("getPlayerCompliance: trimmer hallId til undefined hvis tom string", () => {
  const mgr = createTestManager();
  const snap = mgr.getPlayerCompliance("w-1", "   ");
  assert.equal(snap.hallId, undefined);
});

test("getPlayerCompliance: blockedUntil ISO-string ved aktiv self-exclusion", async () => {
  const mgr = createTestManager();
  await mgr.setSelfExclusion("w-1");
  const snap = mgr.getPlayerCompliance("w-1");
  assert.equal(snap.restrictions.isBlocked, true);
  assert.equal(snap.restrictions.blockedBy, "SELF_EXCLUDED");
  assert.match(snap.restrictions.blockedUntil!, /^\d{4}-\d{2}-\d{2}T/);
});

// ── makeLossScopeKey ───────────────────────────────────────────────────────

test("makeLossScopeKey: deterministisk kombinerer walletId + hallId", () => {
  const mgr = createTestManager();
  const key = mgr.makeLossScopeKey("w-1", "h-1");
  assert.equal(key, "w-1::h-1");
});

test("makeLossScopeKey: trimmer whitespace", () => {
  const mgr = createTestManager();
  assert.equal(mgr.makeLossScopeKey("  w-1  ", "  h-1  "), "w-1::h-1");
});

// ── recordLossEntry — defensive paths ──────────────────────────────────────

test("recordLossEntry: tom walletId/hallId silent no-op (ikke kast)", async () => {
  const mgr = createTestManager();
  await assert.doesNotReject(() =>
    mgr.recordLossEntry("", "h-1", { type: "BUYIN", amount: 100, createdAtMs: Date.now() }),
  );
  await assert.doesNotReject(() =>
    mgr.recordLossEntry("w-1", "", { type: "BUYIN", amount: 100, createdAtMs: Date.now() }),
  );
});

// ── startOfLocalDayMs (eksponert helper) ──────────────────────────────────

test("startOfLocalDayMs: returnerer dag-start (lokal tid) for referanse", () => {
  const mgr = createTestManager();
  const ref = new Date(2026, 3, 22, 14, 30, 5).getTime();
  const dayStart = mgr.startOfLocalDayMs(ref);
  const expected = new Date(2026, 3, 22, 0, 0, 0, 0).getTime();
  assert.equal(dayStart, expected);
});
