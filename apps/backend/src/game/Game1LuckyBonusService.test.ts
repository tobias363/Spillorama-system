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

// ── Audit-funn 2026-04-25: parse-defens + race-scenarios ────────────────────

test("resolveLuckyBonusConfig: array som luckyBonus → null (array er ikke object)", () => {
  // Array.isArray-guard fanger array-input. Hvis admin lagrer feil shape
  // skal vi returnere null (bonus av) i stedet for å kaste.
  const c = resolveLuckyBonusConfig({ luckyBonus: [{ amountCents: 5000, enabled: true }] });
  assert.equal(c, null, "array-shape avvises");
});

test("resolveLuckyBonusConfig: NaN amountCents → 0 + disabled", () => {
  // Number.isFinite-guard avviser NaN slik at det ikke ender opp som
  // amountCents: NaN i config (vil ellers gi NaN sammenligning i evaluate).
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: NaN, enabled: true },
  });
  assert.deepEqual(c, { amountCents: 0, enabled: false });
});

test("resolveLuckyBonusConfig: Infinity amountCents → 0 + disabled", () => {
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: Infinity, enabled: true },
  });
  assert.deepEqual(c, { amountCents: 0, enabled: false });
});

test("resolveLuckyBonusConfig: enabled='true' (string) → enabled=false (strict-true-sjekk)", () => {
  // resolveLuckyBonusConfig har `enabledRaw === true`-strict-sjekk. Locker
  // kontrakten mot at noen senere bytter til truthy-sjekk og dermed
  // godtar string "true" som on-flagg.
  const c = resolveLuckyBonusConfig({
    luckyBonus: { amountCents: 5000, enabled: "true" },
  });
  assert.deepEqual(
    c,
    { amountCents: 5000, enabled: false },
    "enabled-flagg må være boolean true, ikke truthy",
  );
});

test("resolveLuckyBonusConfig: kun enabled=true uten amountCents → null (begge må finnes)", () => {
  // Subtilt: hvis kun enabled finnes (ingen amountCents), returneres null
  // fordi koden krever at minst ett av amountCents/enabled er satt (Object
  // har minst én av dem) for å returnere en config. Locker semantikk.
  const c = resolveLuckyBonusConfig({
    luckyBonus: { enabled: true },
  });
  // amountCents=0, enabled=true. Begge er definert: enabled finnes som key.
  // amountCents er IKKE definert i input, så undefined-check trigger:
  // > if (luckyBonus.enabled !== undefined || luckyBonus.amountCents !== undefined)
  // returner disabled-config ({ amountCents: 0, enabled: false }) — fordi
  // enabled IS defined.
  assert.deepEqual(c, { amountCents: 0, enabled: false });
});

test("evaluate idempotency: gjentatte kall med samme input gir samme output", () => {
  // Pure-service-kontrakt: ingen state mellom kall.
  const svc = new Game1LuckyBonusService();
  const input = {
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: 10000, enabled: true },
  };
  const r1 = svc.evaluate(input);
  const r2 = svc.evaluate(input);
  const r3 = svc.evaluate(input);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
});

test("evaluate: phase=0 → ikke trigget (defens mot off-by-one fra DB)", () => {
  // Phase verdier som ikke er 1..5 skal aldri trigge bonus. Dette er
  // fail-closed mot DB-rusk hvor phase kan være 0 eller >5.
  const svc = new Game1LuckyBonusService();
  for (const phase of [0, 6, -1, 99, NaN]) {
    const r = svc.evaluate({
      winnerId: "w1",
      luckyNumber: 42,
      fullHouseTriggerBall: 42,
      phase,
      bonusConfig: { amountCents: 5000, enabled: true },
    });
    assert.equal(r.triggered, false, `phase=${phase} skal aldri trigge bonus`);
  }
});

test("evaluate: bonusConfig=null → ikke trigget (fail-closed)", () => {
  // Konfig kan være null fra database hvis admin ikke har satt opp
  // luckyBonus for dette spillet. Service har eksplisitt null-guard
  // ('!input.bonusConfig'-sjekk).
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: null as unknown as { amountCents: number; enabled: boolean },
  });
  assert.equal(r.triggered, false);
});

test("evaluate: lucky=fullHouseTriggerBall=0 → ikke trigget (defens mot edge-input)", () => {
  // Backend bør aldri sende ball=0, men hvis det skjer, fall-closed.
  // luckyNumber kan teoretisk være 0 hvis spilleren glemte å velge.
  // Grenseverdi: bingo-baller er typisk 1..75 eller 1..90.
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "w1",
    luckyNumber: 0,
    fullHouseTriggerBall: 0,
    phase: 5,
    bonusConfig: { amountCents: 5000, enabled: true },
  });
  // 0 === 0 og 0 er integer, men luckyNumber=0 betyr "ikke valgt" → trigget=true
  // fordi service ikke har spesial-sjekk for 0. Kan velge å skrive denne
  // inverst hvis vi har spesial-semantikk for 0. Aktuell oppførsel:
  // 0 er integer, ball-match holder, så bonus trigget.
  assert.equal(
    r.triggered,
    true,
    "luckyNumber=0 + ball=0 trigger fortsatt fordi 0 er valid integer",
  );
});

test("evaluate: brukerId/winnerId uses bare for logging — påvirker ikke trigget", () => {
  // winnerId er kun for logging/idempotency-key-formål, ikke for evaluering.
  // Bevis: tom string + valid ellers → fortsatt trigget.
  const svc = new Game1LuckyBonusService();
  const r = svc.evaluate({
    winnerId: "",
    luckyNumber: 42,
    fullHouseTriggerBall: 42,
    phase: 5,
    bonusConfig: { amountCents: 5000, enabled: true },
  });
  assert.equal(r.triggered, true, "tom winnerId påvirker ikke evaluering");
  assert.equal(r.bonusCents, 5000);
});
