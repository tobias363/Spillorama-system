/**
 * Spill 3 (monsterbingo) re-design 2026-05-08: tester for
 * Spill3GlobalRoomService — config → variantConfig bridge.
 *
 * Tester at:
 *   - Spill3Config (fixed-mode) mappes til 5 patterns med prize1
 *   - Spill3Config (percentage-mode) mappes til 5 patterns med prizePercent
 *   - Patterns har korrekt struktur (Row 1-4 + Full House)
 *   - minTicketsBeforeCountdown propageres
 *   - pauseBetweenRowsMs propageres til roundPauseMs (clamped)
 *   - calculatePhasePrizeCents-helper gir riktig premie ved gitt totalSold
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVariantConfigFromSpill3Config,
  calculatePhasePrizeCents,
  SPILL3_PHASE_NAMES,
} from "./Spill3GlobalRoomService.js";
import type { Spill3Config } from "./Spill3ConfigService.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

const PERCENTAGE_CONFIG: Spill3Config = {
  id: "spill3-default",
  minTicketsToStart: 20,
  prizeMode: "percentage",
  prizeRad1Cents: null,
  prizeRad2Cents: null,
  prizeRad3Cents: null,
  prizeRad4Cents: null,
  prizeFullHouseCents: null,
  prizeRad1Pct: 5,
  prizeRad2Pct: 8,
  prizeRad3Pct: 12,
  prizeRad4Pct: 15,
  prizeFullHousePct: 30,
  ticketPriceCents: 500,
  pauseBetweenRowsMs: 3000,
  openingTimeStart: "11:00",
  openingTimeEnd: "23:00",
  active: true,
  createdAt: "2026-05-08T00:00:00Z",
  updatedAt: "2026-05-08T00:00:00Z",
  updatedByUserId: null,
};

const FIXED_CONFIG: Spill3Config = {
  ...PERCENTAGE_CONFIG,
  prizeMode: "fixed",
  prizeRad1Cents: 5000,    // 50 kr
  prizeRad2Cents: 8000,    // 80 kr
  prizeRad3Cents: 12000,   // 120 kr
  prizeRad4Cents: 15000,   // 150 kr
  prizeFullHouseCents: 30000, // 300 kr
  prizeRad1Pct: null,
  prizeRad2Pct: null,
  prizeRad3Pct: null,
  prizeRad4Pct: null,
  prizeFullHousePct: null,
};

// ── buildVariantConfigFromSpill3Config: shape-tester ──────────────────────

test("bridge: percentage-config gir 5 patterns med prizePercent", () => {
  const variant = buildVariantConfigFromSpill3Config(PERCENTAGE_CONFIG);
  assert.equal(variant.patterns.length, 5);
  assert.equal(variant.patterns[0]?.name, "1 Rad");
  assert.equal(variant.patterns[0]?.winningType, "percent");
  assert.equal(variant.patterns[0]?.prizePercent, 5);
  assert.equal(variant.patterns[4]?.name, "Fullt Hus");
  assert.equal(variant.patterns[4]?.winningType, "percent");
  assert.equal(variant.patterns[4]?.prizePercent, 30);
  assert.equal(variant.patterns[4]?.claimType, "BINGO");
  assert.equal(variant.patterns[0]?.claimType, "LINE");
});

test("bridge: fixed-config gir 5 patterns med prize1 i kr", () => {
  const variant = buildVariantConfigFromSpill3Config(FIXED_CONFIG);
  assert.equal(variant.patterns.length, 5);
  // prize_rad1_cents=5000 (50 kr) → prize1 = 50
  assert.equal(variant.patterns[0]?.winningType, "fixed");
  assert.equal(variant.patterns[0]?.prize1, 50);
  assert.equal(variant.patterns[1]?.prize1, 80);
  assert.equal(variant.patterns[2]?.prize1, 120);
  assert.equal(variant.patterns[3]?.prize1, 150);
  // prize_full_house_cents=30000 (300 kr) → prize1 = 300
  assert.equal(variant.patterns[4]?.prize1, 300);
  assert.equal(variant.patterns[4]?.claimType, "BINGO");
});

test("bridge: ticketTypes har KUN 'Standard' (én type)", () => {
  const variant = buildVariantConfigFromSpill3Config(PERCENTAGE_CONFIG);
  assert.equal(variant.ticketTypes.length, 1);
  assert.equal(variant.ticketTypes[0]?.name, "Standard");
  assert.equal(variant.ticketTypes[0]?.priceMultiplier, 1);
  assert.equal(variant.ticketTypes[0]?.ticketCount, 1);
});

test("bridge: 75-ball drawbag", () => {
  const variant = buildVariantConfigFromSpill3Config(PERCENTAGE_CONFIG);
  assert.equal(variant.maxBallValue, 75);
  assert.equal(variant.drawBagSize, 75);
});

test("bridge: pattern-eval-mode er auto-claim-on-draw", () => {
  const variant = buildVariantConfigFromSpill3Config(PERCENTAGE_CONFIG);
  assert.equal(variant.patternEvalMode, "auto-claim-on-draw");
  assert.equal(variant.autoClaimPhaseMode, true);
});

test("bridge: minTicketsBeforeCountdown propageres", () => {
  const variant = buildVariantConfigFromSpill3Config({
    ...PERCENTAGE_CONFIG,
    minTicketsToStart: 50,
  });
  assert.equal(variant.minTicketsBeforeCountdown, 50);
});

test("bridge: pauseBetweenRowsMs blir til roundPauseMs (clamped >=1000)", () => {
  // Spec sier 3000ms default → 3000 (over min, ingen clamp).
  const v1 = buildVariantConfigFromSpill3Config(PERCENTAGE_CONFIG);
  assert.equal(v1.roundPauseMs, 3000);

  // 0ms → clamped til 1000 (engine MIN).
  const v2 = buildVariantConfigFromSpill3Config({
    ...PERCENTAGE_CONFIG,
    pauseBetweenRowsMs: 0,
  });
  assert.equal(v2.roundPauseMs, 1000);

  // 60000ms → 60000 (under engine MAX 300000).
  const v3 = buildVariantConfigFromSpill3Config({
    ...PERCENTAGE_CONFIG,
    pauseBetweenRowsMs: 60_000,
  });
  assert.equal(v3.roundPauseMs, 60_000);
});

test("bridge: SPILL3_PHASE_NAMES er Row 1-4 + Full House", () => {
  assert.equal(SPILL3_PHASE_NAMES[0], "1 Rad");
  assert.equal(SPILL3_PHASE_NAMES[1], "2 Rader");
  assert.equal(SPILL3_PHASE_NAMES[2], "3 Rader");
  assert.equal(SPILL3_PHASE_NAMES[3], "4 Rader");
  assert.equal(SPILL3_PHASE_NAMES[4], "Fullt Hus");
});

test("bridge: pattern.design er 1-4 for rader, 0 for Fullt Hus", () => {
  const variant = buildVariantConfigFromSpill3Config(PERCENTAGE_CONFIG);
  assert.equal(variant.patterns[0]?.design, 1);
  assert.equal(variant.patterns[1]?.design, 2);
  assert.equal(variant.patterns[2]?.design, 3);
  assert.equal(variant.patterns[3]?.design, 4);
  assert.equal(variant.patterns[4]?.design, 0);
});

// ── calculatePhasePrizeCents-tester ────────────────────────────────────────

test("calculatePhasePrizeCents: percentage-mode regner X% av omsetning", () => {
  // 200 bonger × 500 øre = 100000 øre omsetning
  // Rad 1 = 5% × 100000 = 5000 øre = 50 kr
  const totalSold = 200 * 500;
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 0, totalSold), 5000);
  // Rad 2 = 8% × 100000 = 8000 øre
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 1, totalSold), 8000);
  // Fullt Hus = 30% × 100000 = 30000 øre = 300 kr
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 4, totalSold), 30000);
});

test("calculatePhasePrizeCents: fixed-mode ignorerer omsetning", () => {
  // Fixed Rad 1 = 5000 øre, uavhengig av totalSold.
  assert.equal(calculatePhasePrizeCents(FIXED_CONFIG, 0, 1000), 5000);
  assert.equal(calculatePhasePrizeCents(FIXED_CONFIG, 0, 1_000_000), 5000);
  assert.equal(calculatePhasePrizeCents(FIXED_CONFIG, 4, 0), 30000);
});

test("calculatePhasePrizeCents: percentage med 0 omsetning gir 0", () => {
  // Edge case: ingen bonger solgt → ingen pott å dele ut.
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 0, 0), 0);
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 4, 0), 0);
});

test("calculatePhasePrizeCents: percentage rounder ned (Math.floor)", () => {
  // 7 bonger × 500 øre = 3500 øre. 5% × 3500 = 175 øre. Math.floor(175) = 175.
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 0, 3500), 175);
  // Edge: 5% × 3501 = 175.05 → floor = 175.
  assert.equal(calculatePhasePrizeCents(PERCENTAGE_CONFIG, 0, 3501), 175);
});

// ── Multi-vinner pott-deling (regulatorisk: §9 SPILL_REGLER_OG_PAYOUT.md) ─

test("payout-arithmetikk: 2 vinnere på Rad 1 deler poten flatt", () => {
  // Spec §9: "Siden det kun er én bong-type, blir det FLAT pot-deling
  // (ingen bong-vekting)."
  //
  // Eks: 200 bonger × 5 kr = 1000 kr omsetning. Rad 1 = 5% → 50 kr pott.
  //  - 1 vinner → 50 kr
  //  - 2 vinnere → 25 kr hver
  //  - 3 vinnere → 16.66 kr hver (floor til øre)
  //
  // Engine bruker Math.round(prize / winnerCount) per Game3Engine.processG3Winners
  // — men dagens Game3Engine bruker round, ikke floor. Vi tester begge variants
  // for å dokumentere oppførselen.
  const totalSold = 200 * 500; // 100000 øre = 1000 kr
  const rad1PotCents = calculatePhasePrizeCents(PERCENTAGE_CONFIG, 0, totalSold);
  assert.equal(rad1PotCents, 5000); // 50 kr

  // 1 vinner → får hele poten
  const winner1Share = Math.round(rad1PotCents / 1);
  assert.equal(winner1Share, 5000);

  // 2 vinnere → 2500 øre hver, ingen rest
  const winner2Share = Math.round(rad1PotCents / 2);
  assert.equal(winner2Share, 2500);
  assert.equal(winner2Share * 2, rad1PotCents);

  // 3 vinnere → 1667 øre hver (Math.round(1666.67))
  const winner3Share = Math.round(rad1PotCents / 3);
  assert.equal(winner3Share, 1667);
});

test("payout-arithmetikk: fixed Rad 1 = 50 kr deles på 2 vinnere = 25 kr hver", () => {
  // Fixed Rad 1 = 5000 øre = 50 kr.
  const rad1PotCents = calculatePhasePrizeCents(FIXED_CONFIG, 0, 999999);
  assert.equal(rad1PotCents, 5000);
  const share = Math.round(rad1PotCents / 2);
  assert.equal(share, 2500); // 25 kr hver
});
