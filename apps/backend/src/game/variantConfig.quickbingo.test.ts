/**
 * BIN-689: Kvikkis — hurtig-bingo-variant.
 *
 * Dekker:
 *   1. `DEFAULT_QUICKBINGO_CONFIG` har riktig shape:
 *        - Én pattern: "Fullt Hus" med fast premie 1000 kr
 *        - `autoClaimPhaseMode: true` + `patternEvalMode: "auto-claim-on-draw"`
 *        - 75-ball drawbag (samme som norsk bingo)
 *   2. `getDefaultVariantConfig("quickbingo")` → DEFAULT_QUICKBINGO_CONFIG
 *   3. `getDefaultVariantConfig("kvikkis")` → samme (alias)
 *   4. `getDefaultVariantConfig("bingo")` → norsk 5-fase (regresjon — norsk
 *      bingo-flyten må IKKE påvirkes av Kvikkis-tillegget)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_QUICKBINGO_CONFIG,
  DEFAULT_NORSK_BINGO_CONFIG,
  getDefaultVariantConfig,
} from "./variantConfig.js";

test("BIN-689: DEFAULT_QUICKBINGO_CONFIG har kun én pattern (Fullt Hus)", () => {
  assert.equal(DEFAULT_QUICKBINGO_CONFIG.patterns.length, 1, "Kvikkis skal ha kun én fase");
  const [p] = DEFAULT_QUICKBINGO_CONFIG.patterns;
  assert.equal(p!.name, "Fullt Hus", "pattern-navn må matche classifyPhaseFromPatternName");
  assert.equal(p!.claimType, "BINGO");
});

test("BIN-689: DEFAULT_QUICKBINGO_CONFIG har fast 1000 kr premie", () => {
  const [p] = DEFAULT_QUICKBINGO_CONFIG.patterns;
  assert.equal(p!.winningType, "fixed", "skal bruke fixed-prize");
  assert.equal(p!.prize1, 1000, "1000 kr matcher papir-planen");
  assert.equal(p!.prizePercent, 0, "percent=0 når fixed er aktiv");
});

test("BIN-689: DEFAULT_QUICKBINGO_CONFIG aktiverer auto-claim-pathen", () => {
  assert.equal(DEFAULT_QUICKBINGO_CONFIG.autoClaimPhaseMode, true);
  assert.equal(DEFAULT_QUICKBINGO_CONFIG.patternEvalMode, "auto-claim-on-draw");
});

test("BIN-689: DEFAULT_QUICKBINGO_CONFIG bruker 75-ball drawbag", () => {
  assert.equal(DEFAULT_QUICKBINGO_CONFIG.maxBallValue, 75);
  assert.equal(DEFAULT_QUICKBINGO_CONFIG.drawBagSize, 75);
});

test("BIN-689: DEFAULT_QUICKBINGO_CONFIG har alle standard ticket-farger + Large Yellow/White", () => {
  const names = DEFAULT_QUICKBINGO_CONFIG.ticketTypes.map((t) => t.name);
  assert.ok(names.includes("Small Yellow"));
  assert.ok(names.includes("Small White"));
  assert.ok(names.includes("Large Yellow"));
  assert.ok(names.includes("Large White"));
});

test("BIN-689: getDefaultVariantConfig('quickbingo') returnerer DEFAULT_QUICKBINGO_CONFIG", () => {
  assert.strictEqual(getDefaultVariantConfig("quickbingo"), DEFAULT_QUICKBINGO_CONFIG);
});

test("BIN-689: getDefaultVariantConfig('kvikkis') returnerer DEFAULT_QUICKBINGO_CONFIG (alias)", () => {
  assert.strictEqual(getDefaultVariantConfig("kvikkis"), DEFAULT_QUICKBINGO_CONFIG);
});

test("BIN-689: Regresjon — 'bingo'/'norsk-bingo' er IKKE påvirket av Kvikkis-tillegget", () => {
  assert.strictEqual(getDefaultVariantConfig("bingo"), DEFAULT_NORSK_BINGO_CONFIG);
  assert.strictEqual(getDefaultVariantConfig("norsk-bingo"), DEFAULT_NORSK_BINGO_CONFIG);
  assert.strictEqual(getDefaultVariantConfig("game_1"), DEFAULT_NORSK_BINGO_CONFIG);
  // Norsk 5-fase må fortsatt ha 5 patterns.
  assert.equal(DEFAULT_NORSK_BINGO_CONFIG.patterns.length, 5);
});
