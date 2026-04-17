#!/usr/bin/env tsx
/**
 * KRITISK-1: RNG Test Harness
 *
 * Generates large datasets of draw sequences and tickets for:
 * 1. Internal statistical pre-testing (this script)
 * 2. Submission to accredited test lab for RNG certification
 *
 * Usage:
 *   npx tsx tools/rng-test-harness.ts [--sequences N] [--tickets N] [--output-dir DIR]
 *
 * Outputs:
 *   - draw_sequences.csv  — one row per shuffled 60-ball sequence
 *   - tickets.csv          — one row per ticket (15 numbers, 3x5 grid flattened)
 *   - position_frequency.csv — frequency of each number at each draw position
 *   - summary.json         — statistical summary with test results
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeShuffledBallBag, generateTraditional75Ticket } from "../src/game/ticket.js";

// ── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback: number): number {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : fallback;
}
function getStringArg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const NUM_SEQUENCES = getArg("--sequences", 100_000);
const NUM_TICKETS = getArg("--tickets", 100_000);
const OUTPUT_DIR = getStringArg("--output-dir", join(import.meta.dirname ?? ".", "rng-output"));

mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`RNG Test Harness — KRITISK-1`);
console.log(`  Sequences: ${NUM_SEQUENCES.toLocaleString()}`);
console.log(`  Tickets:   ${NUM_TICKETS.toLocaleString()}`);
console.log(`  Output:    ${OUTPUT_DIR}`);
console.log();

// ── 1. Generate draw sequences ─────────────────────────────────────────
console.log("Generating draw sequences...");
const seqStart = performance.now();

// Track position frequency: positionFreq[position][number] = count
const BALLS = 60;
const positionFreq: number[][] = Array.from({ length: BALLS }, () => new Array(BALLS + 1).fill(0));

// Track first-position frequencies for chi-squared
const firstPositionCounts = new Array(BALLS + 1).fill(0);

// Track pair frequencies (serial correlation test)
const pairCounts = new Map<string, number>();

const seqLines: string[] = [];
for (let i = 0; i < NUM_SEQUENCES; i++) {
  const bag = makeShuffledBallBag(60);
  seqLines.push(bag.join(","));

  // Position frequency
  for (let pos = 0; pos < BALLS; pos++) {
    positionFreq[pos][bag[pos]]++;
  }

  // First position
  firstPositionCounts[bag[0]]++;

  // Serial pairs (first 5 positions)
  for (let p = 0; p < 4; p++) {
    const key = `${bag[p]}-${bag[p + 1]}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
}

writeFileSync(join(OUTPUT_DIR, "draw_sequences.csv"), seqLines.join("\n") + "\n");
const seqMs = performance.now() - seqStart;
console.log(`  Done in ${(seqMs / 1000).toFixed(1)}s`);

// ── 2. Generate tickets ────────────────────────────────────────────────
console.log("Generating tickets...");
const ticketStart = performance.now();

// Track column frequency: colFreq[col][number] = count
const colFreq: number[][] = Array.from({ length: 5 }, () => new Array(BALLS + 1).fill(0));

const ticketLines: string[] = [];
for (let i = 0; i < NUM_TICKETS; i++) {
  const ticket = generateTraditional75Ticket();
  const flat = ticket.grid.flat();
  ticketLines.push(flat.join(","));

  // Column frequency
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      colFreq[col][ticket.grid[row][col]]++;
    }
  }
}

writeFileSync(join(OUTPUT_DIR, "tickets.csv"), ticketLines.join("\n") + "\n");
const ticketMs = performance.now() - ticketStart;
console.log(`  Done in ${(ticketMs / 1000).toFixed(1)}s`);

// ── 3. Position frequency matrix ──────────────────────────────────────
console.log("Writing position frequency matrix...");
const posHeader = "position," + Array.from({ length: BALLS }, (_, i) => i + 1).join(",");
const posRows = positionFreq.map((counts, pos) => {
  return `${pos},` + counts.slice(1).join(",");
});
writeFileSync(join(OUTPUT_DIR, "position_frequency.csv"), posHeader + "\n" + posRows.join("\n") + "\n");

// ── 4. Statistical tests ──────────────────────────────────────────────
console.log("Running statistical tests...\n");

interface TestResult {
  name: string;
  passed: boolean;
  statistic: number;
  threshold: number;
  pValue?: number;
  detail: string;
}

const results: TestResult[] = [];

// ── 4a. Chi-squared test: first draw position uniformity ──────────────
{
  const expected = NUM_SEQUENCES / BALLS;
  let chiSquared = 0;
  for (let num = 1; num <= BALLS; num++) {
    const observed = firstPositionCounts[num];
    chiSquared += ((observed - expected) ** 2) / expected;
  }
  // df = 59, critical value at p=0.01 is ~86.38
  const criticalValue = 86.38;
  const passed = chiSquared < criticalValue;
  results.push({
    name: "Chi-squared: first position uniformity",
    passed,
    statistic: chiSquared,
    threshold: criticalValue,
    detail: `Expected ${expected.toFixed(1)} per number, chi2=${chiSquared.toFixed(2)} (critical=${criticalValue} at p=0.01, df=59)`
  });
}

// ── 4b. Chi-squared test: all positions uniformity ────────────────────
{
  const expected = NUM_SEQUENCES / BALLS;
  let maxChiSquared = 0;
  let worstPosition = 0;
  let allPassed = true;
  const criticalValue = 86.38; // df=59, p=0.01

  for (let pos = 0; pos < BALLS; pos++) {
    let chiSquared = 0;
    for (let num = 1; num <= BALLS; num++) {
      const observed = positionFreq[pos][num];
      chiSquared += ((observed - expected) ** 2) / expected;
    }
    if (chiSquared > maxChiSquared) {
      maxChiSquared = chiSquared;
      worstPosition = pos;
    }
    if (chiSquared >= criticalValue) {
      allPassed = false;
    }
  }
  results.push({
    name: "Chi-squared: all 60 positions uniformity",
    passed: allPassed,
    statistic: maxChiSquared,
    threshold: criticalValue,
    detail: `Worst position: ${worstPosition} with chi2=${maxChiSquared.toFixed(2)} (critical=${criticalValue} at p=0.01, df=59)`
  });
}

// ── 4c. Frequency range test (min/max deviation) ─────────────────────
{
  const expected = NUM_SEQUENCES / BALLS;
  let minCount = Infinity;
  let maxCount = 0;
  let minNum = 0;
  let maxNum = 0;
  let minPos = 0;
  let maxPos = 0;

  for (let pos = 0; pos < BALLS; pos++) {
    for (let num = 1; num <= BALLS; num++) {
      const count = positionFreq[pos][num];
      if (count < minCount) { minCount = count; minNum = num; minPos = pos; }
      if (count > maxCount) { maxCount = count; maxNum = num; maxPos = pos; }
    }
  }

  const maxDeviation = Math.max(
    Math.abs(minCount - expected) / expected,
    Math.abs(maxCount - expected) / expected
  );

  // Allow up to 5% deviation
  const threshold = 0.05;
  results.push({
    name: "Frequency range: max deviation from expected",
    passed: maxDeviation < threshold,
    statistic: maxDeviation,
    threshold,
    detail: `Min: ${minCount} (num=${minNum},pos=${minPos}), Max: ${maxCount} (num=${maxNum},pos=${maxPos}), Expected: ${expected.toFixed(1)}, MaxDev: ${(maxDeviation * 100).toFixed(2)}%`
  });
}

// ── 4d. Ticket column distribution ────────────────────────────────────
{
  const COLS = 5;
  const ROWS = 3;
  const ranges = [[1, 12], [13, 24], [25, 36], [37, 48], [49, 60]];
  let allPassed = true;
  let worstDetail = "";
  let worstChi = 0;

  for (let col = 0; col < COLS; col++) {
    const [lo, hi] = ranges[col];
    const rangeSize = hi - lo + 1; // 12
    const expectedPerNumber = (NUM_TICKETS * ROWS) / rangeSize;
    let chiSquared = 0;

    for (let num = lo; num <= hi; num++) {
      const observed = colFreq[col][num];
      chiSquared += ((observed - expectedPerNumber) ** 2) / expectedPerNumber;
    }

    // df = 11, critical value at p=0.01 is ~24.72
    const criticalValue = 24.72;
    if (chiSquared >= criticalValue) {
      allPassed = false;
    }
    if (chiSquared > worstChi) {
      worstChi = chiSquared;
      worstDetail = `Col ${col} (${lo}-${hi}): chi2=${chiSquared.toFixed(2)}`;
    }
  }

  results.push({
    name: "Chi-squared: ticket column distribution",
    passed: allPassed,
    statistic: worstChi,
    threshold: 24.72,
    detail: `Worst: ${worstDetail} (critical=24.72 at p=0.01, df=11)`
  });
}

// ── 4e. Serial correlation (adjacent pairs) ───────────────────────────
{
  // For positions 0-3, check if pair (bag[p], bag[p+1]) distribution is uniform
  // With 60 possible values for each, there are 60*59 = 3540 possible ordered pairs
  // Each pair appears with probability 1/3540 for truly random permutation
  const totalPairs = NUM_SEQUENCES * 4; // 4 adjacent pairs per sequence
  const possiblePairs = 60 * 59; // ordered pairs from permutation
  const expectedPerPair = totalPairs / possiblePairs;

  let chiSquared = 0;
  let observedPairs = 0;

  for (const count of pairCounts.values()) {
    chiSquared += ((count - expectedPerPair) ** 2) / expectedPerPair;
    observedPairs++;
  }

  // Add zero-count pairs
  const zeroPairs = possiblePairs - observedPairs;
  chiSquared += zeroPairs * ((0 - expectedPerPair) ** 2) / expectedPerPair;

  // df = possiblePairs - 1, use normal approximation for large df
  // For large df, chi2 ~ N(df, 2*df), so z = (chi2 - df) / sqrt(2*df)
  const df = possiblePairs - 1;
  const z = (chiSquared - df) / Math.sqrt(2 * df);
  const passed = Math.abs(z) < 3.0; // z within 3 sigma

  results.push({
    name: "Serial correlation: adjacent pair uniformity",
    passed,
    statistic: z,
    threshold: 3.0,
    detail: `chi2=${chiSquared.toFixed(1)}, df=${df}, z-score=${z.toFixed(3)} (threshold: |z| < 3.0)`
  });
}

// ── Print results ─────────────────────────────────────────────────────
console.log("=" .repeat(72));
console.log("  STATISTICAL PRE-TEST RESULTS");
console.log("=".repeat(72));

for (const r of results) {
  const status = r.passed ? "PASS" : "FAIL";
  const icon = r.passed ? "[OK]" : "[!!]";
  console.log(`\n${icon} ${r.name}: ${status}`);
  console.log(`    ${r.detail}`);
}

const allPassed = results.every(r => r.passed);
console.log("\n" + "=".repeat(72));
console.log(`  OVERALL: ${allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`);
console.log("=".repeat(72));

// ── Write summary ─────────────────────────────────────────────────────
const summary = {
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  config: {
    sequences: NUM_SEQUENCES,
    tickets: NUM_TICKETS,
    balls: BALLS,
  },
  rngSource: "node:crypto.randomInt() — OpenSSL CSPRNG",
  algorithm: "Fisher-Yates shuffle (Knuth variant, descending)",
  timings: {
    sequenceGenerationMs: Math.round(seqMs),
    ticketGenerationMs: Math.round(ticketMs),
  },
  tests: results,
  allPassed,
};

writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`\nResults written to ${OUTPUT_DIR}/summary.json`);
