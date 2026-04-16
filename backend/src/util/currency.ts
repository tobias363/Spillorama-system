/**
 * BIN-163: Centralized currency rounding utility.
 *
 * Prevents floating-point arithmetic errors in JavaScript by rounding
 * all currency amounts to 2 decimal places. PostgreSQL uses NUMERIC(20,6)
 * which prevents precision loss at storage, but JS arithmetic between
 * DB round-trips needs explicit rounding.
 */

/**
 * Round a currency amount to 2 decimal places.
 * Uses Math.round(value * 100) / 100 which handles the common
 * floating-point cases (e.g., 0.1 + 0.2 → 0.30 not 0.30000000000000004).
 */
export function roundCurrency(value: number): number {
  return Number(Math.round(parseFloat(value + "e2")) + "e-2");
}

/**
 * Assert that an amount is safe for currency operations.
 * Guards against NaN, Infinity, and values that exceed safe integer range
 * when converted to ore (minor units).
 */
export function assertSafeCurrencyAmount(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid currency amount: ${value}`);
  }
  // Ensure the ore representation fits in a safe integer (2^53 - 1 ore ≈ 90 trillion NOK)
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error(`Currency amount exceeds safe range: ${value}`);
  }
  return value;
}
