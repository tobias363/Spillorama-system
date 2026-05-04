/**
 * Tobias 2026-05-04: admin-konfigurerbar runde-pace per Spill 2/3.
 *
 * Dekker:
 *   1. `validateRoundPauseMs` — område 1000-300000 ms, kaster ved ugyldig.
 *   2. `validateBallIntervalMs` — område 1000-10000 ms, kaster ved ugyldig.
 *   3. `resolveRoundPauseMs` — fallback-rekkefølge (per-game > env > 5000).
 *   4. `resolveBallIntervalMs` — fallback-rekkefølge (per-game > env > 30000).
 *   5. `parseVariantConfig` — leser felt fra JSONB, validerer, fallback til
 *      defaults når feltet er ugyldig.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BALL_INTERVAL_MS_MAX,
  BALL_INTERVAL_MS_MIN,
  ROUND_PAUSE_MS_MAX,
  ROUND_PAUSE_MS_MIN,
  parseVariantConfig,
  resolveBallIntervalMs,
  resolveRoundPauseMs,
  validateBallIntervalMs,
  validateRoundPauseMs,
} from "./variantConfig.js";

// ── validateRoundPauseMs ────────────────────────────────────────────────────

test("validateRoundPauseMs: aksepterer gyldige verdier i området [1000, 300000]", () => {
  assert.equal(validateRoundPauseMs(1000), 1000);
  assert.equal(validateRoundPauseMs(30000), 30000);
  assert.equal(validateRoundPauseMs(300000), 300000);
  assert.equal(validateRoundPauseMs(ROUND_PAUSE_MS_MIN), ROUND_PAUSE_MS_MIN);
  assert.equal(validateRoundPauseMs(ROUND_PAUSE_MS_MAX), ROUND_PAUSE_MS_MAX);
});

test("validateRoundPauseMs: floorer desimal-verdier", () => {
  assert.equal(validateRoundPauseMs(30000.7), 30000);
  assert.equal(validateRoundPauseMs(15000.99), 15000);
});

test("validateRoundPauseMs: aksepterer numeriske strings (form-input)", () => {
  assert.equal(validateRoundPauseMs("30000"), 30000);
  assert.equal(validateRoundPauseMs("1000"), 1000);
});

test("validateRoundPauseMs: avviser verdier under MIN (1000)", () => {
  assert.throws(() => validateRoundPauseMs(999), /mellom 1000 og 300000/);
  assert.throws(() => validateRoundPauseMs(0), /mellom 1000 og 300000/);
  assert.throws(() => validateRoundPauseMs(-1000), /mellom 1000 og 300000/);
});

test("validateRoundPauseMs: avviser verdier over MAX (300000)", () => {
  assert.throws(() => validateRoundPauseMs(300001), /mellom 1000 og 300000/);
  assert.throws(() => validateRoundPauseMs(1_000_000), /mellom 1000 og 300000/);
});

test("validateRoundPauseMs: avviser ikke-numeriske verdier", () => {
  assert.throws(() => validateRoundPauseMs("abc"), /må være et tall|mellom/);
  assert.throws(() => validateRoundPauseMs(NaN), /må være et tall|mellom/);
  assert.throws(() => validateRoundPauseMs(Infinity), /må være et tall|mellom/);
  assert.throws(() => validateRoundPauseMs(undefined), /må være et tall/);
  assert.throws(() => validateRoundPauseMs(null), /må være et tall/);
});

// ── validateBallIntervalMs ──────────────────────────────────────────────────

test("validateBallIntervalMs: aksepterer gyldige verdier i området [1000, 10000]", () => {
  assert.equal(validateBallIntervalMs(1000), 1000);
  assert.equal(validateBallIntervalMs(2000), 2000);
  assert.equal(validateBallIntervalMs(10000), 10000);
  assert.equal(validateBallIntervalMs(BALL_INTERVAL_MS_MIN), BALL_INTERVAL_MS_MIN);
  assert.equal(validateBallIntervalMs(BALL_INTERVAL_MS_MAX), BALL_INTERVAL_MS_MAX);
});

test("validateBallIntervalMs: avviser verdier utenfor området", () => {
  assert.throws(() => validateBallIntervalMs(999), /mellom 1000 og 10000/);
  assert.throws(() => validateBallIntervalMs(10001), /mellom 1000 og 10000/);
  assert.throws(() => validateBallIntervalMs(0), /mellom 1000 og 10000/);
  assert.throws(() => validateBallIntervalMs(-2000), /mellom 1000 og 10000/);
});

test("validateBallIntervalMs: avviser ikke-numeriske verdier", () => {
  assert.throws(() => validateBallIntervalMs("xyz"), /må være et tall|mellom/);
  assert.throws(() => validateBallIntervalMs(NaN), /må være et tall|mellom/);
});

// ── resolveRoundPauseMs ─────────────────────────────────────────────────────

test("resolveRoundPauseMs: per-game variantConfig vinner over env-fallback", () => {
  const got = resolveRoundPauseMs({ ticketTypes: [], patterns: [], roundPauseMs: 45000 }, 5000);
  assert.equal(got, 45000);
});

test("resolveRoundPauseMs: env-fallback når variantConfig mangler felt", () => {
  const got = resolveRoundPauseMs({ ticketTypes: [], patterns: [] }, 5000);
  assert.equal(got, 5000);
});

test("resolveRoundPauseMs: hardkodet 5000 når både variantConfig og env mangler", () => {
  assert.equal(resolveRoundPauseMs(null, 0), 5000);
  assert.equal(resolveRoundPauseMs(undefined, NaN), 5000);
});

test("resolveRoundPauseMs: ugyldig per-game-verdi (under MIN) → env-fallback", () => {
  // Defense-in-depth: hvis ugyldig verdi har sluppet inn i DB-en, skal
  // resolve fortsatt returnere noe gyldig — env-default eller hardkodet.
  const got = resolveRoundPauseMs({ ticketTypes: [], patterns: [], roundPauseMs: 500 }, 5000);
  assert.equal(got, 5000);
});

test("resolveRoundPauseMs: ugyldig per-game-verdi (over MAX) → env-fallback", () => {
  const got = resolveRoundPauseMs({ ticketTypes: [], patterns: [], roundPauseMs: 999_999 }, 5000);
  assert.equal(got, 5000);
});

// ── resolveBallIntervalMs ───────────────────────────────────────────────────

test("resolveBallIntervalMs: per-game variantConfig vinner over env-fallback", () => {
  const got = resolveBallIntervalMs(
    { ticketTypes: [], patterns: [], ballIntervalMs: 3000 },
    30000,
  );
  assert.equal(got, 3000);
});

test("resolveBallIntervalMs: env-fallback når variantConfig mangler felt", () => {
  const got = resolveBallIntervalMs({ ticketTypes: [], patterns: [] }, 30000);
  assert.equal(got, 30000);
});

test("resolveBallIntervalMs: hardkodet 30000 når både variantConfig og env mangler", () => {
  assert.equal(resolveBallIntervalMs(null, 0), 30000);
});

test("resolveBallIntervalMs: ugyldig per-game-verdi → env-fallback", () => {
  const got = resolveBallIntervalMs(
    { ticketTypes: [], patterns: [], ballIntervalMs: 500_000 },
    2000,
  );
  assert.equal(got, 2000);
});

// ── parseVariantConfig ──────────────────────────────────────────────────────

test("parseVariantConfig: leser gyldig roundPauseMs + ballIntervalMs fra JSONB", () => {
  const got = parseVariantConfig(
    {
      ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
      patterns: [],
      roundPauseMs: 45000,
      ballIntervalMs: 3500,
    },
    "rocket",
  );
  assert.equal(got.roundPauseMs, 45000);
  assert.equal(got.ballIntervalMs, 3500);
});

test("parseVariantConfig: ignorerer ugyldig roundPauseMs (under MIN), beholder default-fravær", () => {
  const got = parseVariantConfig(
    {
      ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
      patterns: [],
      roundPauseMs: 500, // < MIN
    },
    "rocket",
  );
  // Default for rocket har ingen roundPauseMs satt → resultat har ingen.
  assert.equal(got.roundPauseMs, undefined);
});

test("parseVariantConfig: ignorerer ugyldig ballIntervalMs (over MAX)", () => {
  const got = parseVariantConfig(
    {
      ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
      patterns: [],
      ballIntervalMs: 99999, // > MAX
    },
    "rocket",
  );
  assert.equal(got.ballIntervalMs, undefined);
});

test("parseVariantConfig: floor-er desimaler i pace-felter", () => {
  const got = parseVariantConfig(
    {
      ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
      patterns: [],
      roundPauseMs: 30000.9,
      ballIntervalMs: 2500.7,
    },
    "rocket",
  );
  assert.equal(got.roundPauseMs, 30000);
  assert.equal(got.ballIntervalMs, 2500);
});
