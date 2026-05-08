/**
 * Spill 2 (rocket) re-design 2026-05-08: unit-tester for
 * Spill2GlobalRoomService bridge.
 *
 * Tester at `buildVariantConfigFromSpill2Config` produserer riktig
 * `GameVariantConfig`-shape for Game2Engine + PerpetualRoundService.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildVariantConfigFromSpill2Config } from "./Spill2GlobalRoomService.js";
import type {
  Spill2Config,
  Spill2JackpotTable,
} from "./Spill2ConfigService.js";

const DEFAULT_JACKPOT_TABLE: Spill2JackpotTable = {
  "9":    { price: 5000, isCash: true },
  "10":   { price: 2500, isCash: true },
  "11":   { price: 1000, isCash: true },
  "12":   { price: 100,  isCash: false },
  "13":   { price: 75,   isCash: false },
  "1421": { price: 50,   isCash: false },
};

function makeConfig(overrides: Partial<Spill2Config> = {}): Spill2Config {
  return {
    id: "spill2-default",
    openingTimeStart: null,
    openingTimeEnd: null,
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60000,
    ballIntervalMs: 4000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: false,
    luckyNumberPrizeCents: null,
    active: true,
    createdAt: "",
    updatedAt: "",
    updatedByUserId: null,
    ...overrides,
  };
}

// ── ticketTypes ────────────────────────────────────────────────────────────

test("buildVariantConfig: ticketTypes har én Standard-type med game2-3x3", () => {
  const config = makeConfig();
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.ticketTypes.length, 1);
  assert.equal(variant.ticketTypes[0]?.name, "Standard");
  assert.equal(variant.ticketTypes[0]?.type, "game2-3x3");
  assert.equal(variant.ticketTypes[0]?.priceMultiplier, 1);
  assert.equal(variant.ticketTypes[0]?.ticketCount, 1);
});

// ── patterns ───────────────────────────────────────────────────────────────

test("buildVariantConfig: patterns er tom liste (auto-claim-on-draw)", () => {
  const config = makeConfig();
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.patterns.length, 0);
});

// ── ball-range ─────────────────────────────────────────────────────────────

test("buildVariantConfig: maxBallValue + drawBagSize = 21", () => {
  const config = makeConfig();
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.maxBallValue, 21);
  assert.equal(variant.drawBagSize, 21);
});

test("buildVariantConfig: patternEvalMode = auto-claim-on-draw", () => {
  const config = makeConfig();
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.patternEvalMode, "auto-claim-on-draw");
});

// ── jackpot-tabell ─────────────────────────────────────────────────────────

test("buildVariantConfig: jackpotNumberTable kopieres", () => {
  const config = makeConfig();
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.deepEqual(variant.jackpotNumberTable, DEFAULT_JACKPOT_TABLE);
});

test("buildVariantConfig: jackpot-tabell er klone (caller-mutate hjelper ikke)", () => {
  const config = makeConfig();
  const variant = buildVariantConfigFromSpill2Config(config);
  // Muter variant — config skal IKKE påvirkes.
  if (variant.jackpotNumberTable && variant.jackpotNumberTable["9"]) {
    variant.jackpotNumberTable["9"]!.price = 99999;
  }
  assert.equal(config.jackpotNumberTable["9"]?.price, 5000);
});

// ── lucky-number ───────────────────────────────────────────────────────────

test("buildVariantConfig: luckyNumberPrize=0 når deaktivert", () => {
  const config = makeConfig({ luckyNumberEnabled: false });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.luckyNumberPrize, 0);
});

test("buildVariantConfig: luckyNumberPrize konverteres øre→kr", () => {
  const config = makeConfig({
    luckyNumberEnabled: true,
    luckyNumberPrizeCents: 50000,  // 500 kr
  });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.luckyNumberPrize, 500);
});

test("buildVariantConfig: luckyNumberPrize=0 når enabled men prize_cents=null", () => {
  // Edge-case: konsistens-validering har ikke kjørt (skal ikke skje i praksis).
  const config = makeConfig({
    luckyNumberEnabled: true,
    luckyNumberPrizeCents: null,
  });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.luckyNumberPrize, 0);
});

// ── pace-fields ────────────────────────────────────────────────────────────

test("buildVariantConfig: minTicketsBeforeCountdown propageres", () => {
  const config = makeConfig({ minTicketsToStart: 25 });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.minTicketsBeforeCountdown, 25);
});

test("buildVariantConfig: roundPauseMs propageres", () => {
  const config = makeConfig({ roundPauseMs: 90000 });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.roundPauseMs, 90000);
});

test("buildVariantConfig: ballIntervalMs propageres", () => {
  const config = makeConfig({ ballIntervalMs: 5000 });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.ballIntervalMs, 5000);
});

test("buildVariantConfig: roundPauseMs clampes til min 1000ms", () => {
  // Selv om service-laget skulle slippe gjennom 500ms, må bridgen klampe.
  const config = makeConfig({ roundPauseMs: 500 });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.roundPauseMs, 1000);
});

test("buildVariantConfig: roundPauseMs clampes til max 300000ms", () => {
  const config = makeConfig({ roundPauseMs: 999999 });
  const variant = buildVariantConfigFromSpill2Config(config);
  assert.equal(variant.roundPauseMs, 300000);
});

test("buildVariantConfig: ballIntervalMs clampes til min/max", () => {
  const tooSmall = makeConfig({ ballIntervalMs: 100 });
  const variant1 = buildVariantConfigFromSpill2Config(tooSmall);
  assert.equal(variant1.ballIntervalMs, 1000);

  const tooBig = makeConfig({ ballIntervalMs: 100000 });
  const variant2 = buildVariantConfigFromSpill2Config(tooBig);
  assert.equal(variant2.ballIntervalMs, 10000);
});

// ── full snapshot ──────────────────────────────────────────────────────────

test("buildVariantConfig: full snapshot med åpningstider + lucky aktiv", () => {
  const config = makeConfig({
    openingTimeStart: "10:00",
    openingTimeEnd: "22:00",
    minTicketsToStart: 10,
    ticketPriceCents: 2000,
    roundPauseMs: 45000,
    ballIntervalMs: 3500,
    luckyNumberEnabled: true,
    luckyNumberPrizeCents: 100000,  // 1000 kr
  });
  const variant = buildVariantConfigFromSpill2Config(config);

  // ticketTypes
  assert.equal(variant.ticketTypes[0]?.name, "Standard");
  // ball-range
  assert.equal(variant.maxBallValue, 21);
  // jackpot-tabell
  assert.equal(variant.jackpotNumberTable!["9"]?.price, 5000);
  // lucky-number
  assert.equal(variant.luckyNumberPrize, 1000);
  // pace
  assert.equal(variant.minTicketsBeforeCountdown, 10);
  assert.equal(variant.roundPauseMs, 45000);
  assert.equal(variant.ballIntervalMs, 3500);
});
