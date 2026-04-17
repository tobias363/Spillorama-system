import test from "node:test";
import assert from "node:assert/strict";
import { roundCurrency, assertSafeCurrencyAmount } from "./currency.js";

test("roundCurrency: 0.1 + 0.2 = 0.3", () => {
  assert.equal(roundCurrency(0.1 + 0.2), 0.3);
});

test("roundCurrency: rounds to 2 decimal places", () => {
  assert.equal(roundCurrency(1.005), 1.01); // Fixed: penny rounding now correct
  assert.equal(roundCurrency(1.006), 1.01);
  assert.equal(roundCurrency(1.004), 1.0);
  assert.equal(roundCurrency(99.999), 100);
  assert.equal(roundCurrency(0), 0);
  assert.equal(roundCurrency(100), 100);
  assert.equal(roundCurrency(2.675), 2.68); // Additional half-penny case
  assert.equal(roundCurrency(1.255), 1.26);
});

test("roundCurrency: handles negative amounts", () => {
  assert.equal(roundCurrency(-0.1 - 0.2), -0.3);
  assert.equal(roundCurrency(-1.005), -1); // Negative half-penny rounds toward zero
});

test("assertSafeCurrencyAmount: passes for normal values", () => {
  assert.equal(assertSafeCurrencyAmount(100), 100);
  assert.equal(assertSafeCurrencyAmount(0), 0);
  assert.equal(assertSafeCurrencyAmount(999999.99), 999999.99);
});

test("assertSafeCurrencyAmount: throws for NaN", () => {
  assert.throws(() => assertSafeCurrencyAmount(NaN), /Invalid currency amount/);
});

test("assertSafeCurrencyAmount: throws for Infinity", () => {
  assert.throws(() => assertSafeCurrencyAmount(Infinity), /Invalid currency amount/);
  assert.throws(() => assertSafeCurrencyAmount(-Infinity), /Invalid currency amount/);
});

test("assertSafeCurrencyAmount: throws for values exceeding safe range", () => {
  const tooLarge = Number.MAX_SAFE_INTEGER; // ~9e15, which as ore would overflow
  assert.throws(() => assertSafeCurrencyAmount(tooLarge), /exceeds safe range/);
});
