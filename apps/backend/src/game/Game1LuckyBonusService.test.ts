/**
 * GAME1 Lucky Number Bonus — pure-service unit-tests.
 *
 * Dekker alle fail-closed-veiene i `Game1LuckyBonusService.evaluate` samt
 * `resolveLuckyBonusConfig` (parse fra ticket_config_json).
 *
 * Legacy-referanse: GameProcess.js:420-429 (Game 1 full-house lucky-bonus).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1LuckyBonusService,
  resolveLuckyBonusConfig,
  type Game1LuckyBonusConfig,
} from "./Game1LuckyBonusService.js";

function enabledConfig(amountCents = 5000): Game1LuckyBonusConfig {
  return { amountCents, enabled: true };
}

// ── Regel 1: kun Fullt Hus (fase 5) ────────────────────────────────────────

test("evaluate: fase 1 → ikke trigget selv med matching lucky", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 1,
    bonusConfig: enabledConfig(),
  });
  assert.equal(r.triggered, false);
  assert.equal(r.bonusCents, 0);
});

test("evaluate: fase 2..4 → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  for (const phase of [2, 3, 4]) {
    const r = svc.evaluate({
      winnerId: "w1",
      luckyNumber: 42,
      fullHouseTriggerBall: 42,
      phase,
      bonusConfig: enabledConfig(),
    });
    assert.equal(r.triggered, false, `fase ${phase} må ikke trigge`);
    assert.equal(r.bonusCents, 0);
  }
});

test("evaluate: fase 5 + matching lucky + enabled + positivt beløp → trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: enabledConfig(10000),
  });
  assert.equal(r.triggered, true);
  assert.equal(r.bonusCents, 10000);
});

// ── Regel 2: matching lastBall ─────────────────────────────────────────────

test("evaluate: lucky === 42 men lastBall === 13 → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 13,
    phase: 5,
    bonusConfig: enabledConfig(),
  });
  assert.equal(r.triggered, false);
  assert.equal(r.bonusCents, 0);
});

test("evaluate: lucky === fullHouseTriggerBall → trigget", () => {
  const svc = new Game1LuckyBonusService();
  for (const ball of [1, 30, 60, 75]) {
    const r = svc.evaluate({
      winnerId: "w1",
      luckyNumber: ball,
      fullHouseTriggerBall: ball,
      phase: 5,
      bonusConfig: enabledConfig(),
    });
    assert.equal(r.triggered, true, `ball=${ball} må trigge`);
  }
});

// ── Regel 5a: enabled-flag ─────────────────────────────────────────────────

test("evaluate: enabled=false → ikke trigget selv med matching lucky", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: 5000, enabled: false },
  });
  assert.equal(r.triggered, false);
  assert.equal(r.bonusCents, 0);
});

test("evaluate: enabled-flag undefined → ikke trigget (strict true-sjekk)", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bonusConfig: { amountCents: 5000, enabled: undefined as any },
  });
  assert.equal(r.triggered, false);
});

// ── Regel 5b: amountCents > 0 ──────────────────────────────────────────────

test("evaluate: amountCents=0 → ikke trigget selv med enabled=true", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: 0, enabled: true },
  });
  assert.equal(r.triggered, false);
  assert.equal(r.bonusCents, 0);
});

test("evaluate: amountCents=NaN → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: NaN, enabled: true },
  });
  assert.equal(r.triggered, false);
});

test("evaluate: amountCents=Infinity → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: Infinity, enabled: true },
  });
  assert.equal(r.triggered, false);
});

test("evaluate: amountCents=-1 → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: -1, enabled: true },
  });
  assert.equal(r.triggered, false);
});

test("evaluate: amountCents=123.9 → floor til 123", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: 123.9, enabled: true },
  });
  assert.equal(r.triggered, true);
  assert.equal(r.bonusCents, 123);
});

// ── Regel 5c: luckyNumber må være satt ─────────────────────────────────────

test("evaluate: luckyNumber=null → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: null,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: enabledConfig(),
  });
  assert.equal(r.triggered, false);
});

test("evaluate: luckyNumber=undefined → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: undefined,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: enabledConfig(),
  });
  assert.equal(r.triggered, false);
});

test("evaluate: luckyNumber som float (42.5) → ikke trigget (strict integer)", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42.5,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: enabledConfig(),
  });
  assert.equal(r.triggered, false);
});

// ── Regel 5d: fullHouseTriggerBall må være integer ─────────────────────────

test("evaluate: fullHouseTriggerBall=NaN → ikke trigget", () => {
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: NaN,
    phase: 5,
    bonusConfig: enabledConfig(),
  });
  assert.equal(r.triggered, false);
});

// ── resolveLuckyBonusConfig ────────────────────────────────────────────────

test("resolveLuckyBonusConfig: null/undefined → null", () => {
  assert.equal(resolveLuckyBonusConfig(null), null);
  assert.equal(resolveLuckyBonusConfig(undefined), null);
  assert.equal(resolveLuckyBonusConfig("string"), null);
  assert.equal(resolveLuckyBonusConfig(42), null);
});

test("resolveLuckyBonusConfig: ingen luckyBonus-nøkkel → null", () => {
  assert.equal(resolveLuckyBonusConfig({ other: "field" }), null);
});

test("resolveLuckyBonusConfig: enabled=true + amountCents>0 → enabled-config", () => {
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: 5000, enabled: true },
  });
  assert.deepEqual(c, { amountCents: 5000, enabled: true });
});

test("resolveLuckyBonusConfig: enabled=false → disabled-config bevart", () => {
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: 5000, enabled: false },
  });
  assert.deepEqual(c, { amountCents: 5000, enabled: false });
});

test("resolveLuckyBonusConfig: amountCents=0 + enabled=true → disabled-config (0-beløp)", () => {
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: 0, enabled: true },
  });
  assert.deepEqual(c, { amountCents: 0, enabled: false });
});

test("resolveLuckyBonusConfig: tomt luckyBonus-object → null", () => {
  assert.equal(resolveLuckyBonusConfig({ luckyBonus: {} }), null);
});

test("resolveLuckyBonusConfig: amountCents er non-number → 0 + disabled", () => {
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: "5000", enabled: true },
  });
  assert.deepEqual(c, { amountCents: 0, enabled: false });
});

test("resolveLuckyBonusConfig: amountCents=12.9 → floor til 12 (enabled)", () => {
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: 12.9, enabled: true },
  });
  assert.deepEqual(c, { amountCents: 12, enabled: true });
});
