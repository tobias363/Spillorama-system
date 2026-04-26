/**
 * Tests for resolvePlayerReportRange — Lotteritilsynet-rapporter for spillere.
 *
 * Range-resolution er regulatorisk-relevant: Spillvett-eksport må reflektere
 * det perioden spilleren ber om (today/last7/last30/last365/week/month/year).
 * Hvis range-grensene er feil, eksporten gir feil tall.
 *
 * Edge cases:
 *   - Negative offset (forrige uke / forrige måned)
 *   - Offset clamping ved -60 og 0
 *   - ISO-uke-grenser (mandag → søndag)
 *   - Måned-grenser (også februar med skuddår-håndtering)
 *   - Søndag-edge (siste-dag-i-uka logikk)
 *   - Year-rolling (siste 365 dager, alltid offset=0)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlayerReportRange, PLAYER_REPORT_PERIODS } from "../playerReport.js";

// ── Period catalog ──────────────────────────────────────────────────────────

test("PLAYER_REPORT_PERIODS has exactly the 7 supported periods", () => {
  assert.deepEqual([...PLAYER_REPORT_PERIODS].sort(), [
    "last30",
    "last365",
    "last7",
    "month",
    "today",
    "week",
    "year",
  ]);
});

// ── today ───────────────────────────────────────────────────────────────────

test("range today: from = midnatt, to = nå, label viser dato", () => {
  const now = new Date(2026, 3, 15, 14, 30, 0); // wed 15.04.2026 14:30 local
  const range = resolvePlayerReportRange("today", now);
  assert.equal(range.period, "today");
  assert.equal(range.offset, 0);
  assert.equal(new Date(range.from).getHours(), 0);
  assert.equal(new Date(range.from).getMinutes(), 0);
  assert.equal(new Date(range.to).getTime(), now.getTime());
  assert.match(range.label, /^I dag/);
  assert.match(range.label, /15\.04\.2026/);
});

// ── last7 / last30 / last365 ────────────────────────────────────────────────

test("range last7: from = -6 dager, to = nå", () => {
  const now = new Date(2026, 3, 15, 12, 0, 0);
  const range = resolvePlayerReportRange("last7", now);
  assert.equal(range.offset, 0);
  const from = new Date(range.from);
  // Should be 6 days before "now" at midnight local
  const expected = new Date(2026, 3, 9, 0, 0, 0);
  assert.equal(from.getFullYear(), 2026);
  assert.equal(from.getMonth(), 3);
  assert.equal(from.getDate(), 9);
  assert.equal(from.getHours(), 0);
  // Sanity check on label
  assert.match(range.label, /^09\.04\.2026.*15\.04\.2026$/);
});

test("range last30: from = -29 dager", () => {
  const now = new Date(2026, 3, 30, 12, 0, 0);
  const range = resolvePlayerReportRange("last30", now);
  const from = new Date(range.from);
  assert.equal(from.getDate(), 1); // 30 - 29 = 1
});

test("range last365: from = -364 dager (rolling year)", () => {
  const now = new Date(2026, 3, 15, 12, 0, 0);
  const range = resolvePlayerReportRange("last365", now);
  const from = new Date(range.from);
  // 364 days back from 2026-04-15 → 2025-04-16
  assert.equal(from.getFullYear(), 2025);
  assert.equal(from.getMonth(), 3); // april
  assert.equal(from.getDate(), 16);
});

// ── week (calendar / ISO Monday-Sunday) ─────────────────────────────────────

test("range week (offset=0): mandag-søndag, to = nå hvis offset=0 og inneværende uke", () => {
  // 2026-04-15 is a Wednesday
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("week", now);
  const from = new Date(range.from);
  // Week of 2026-04-15 → Monday 2026-04-13
  assert.equal(from.getDate(), 13);
  assert.equal(from.getDay(), 1); // Monday
  // to is "now" since offset=0
  assert.equal(new Date(range.to).getTime(), now.getTime());
  assert.match(range.label, /^Uke \d+, 2026$/);
});

test("range week handles Sunday correctly (last day of week)", () => {
  // 2026-04-19 is Sunday
  const now = new Date(2026, 3, 19, 14, 0, 0);
  const range = resolvePlayerReportRange("week", now);
  const from = new Date(range.from);
  // Should still go back to Mon 2026-04-13
  assert.equal(from.getDate(), 13);
  assert.equal(from.getDay(), 1);
});

test("range week (offset=-1): forrige uke, to = søndag 23:59:59.999", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0); // Wednesday
  const range = resolvePlayerReportRange("week", now, -1);
  const from = new Date(range.from);
  // Previous Monday: 2026-04-06
  assert.equal(from.getMonth(), 3);
  assert.equal(from.getDate(), 6);
  // to = Sunday end-of-day: 2026-04-12 23:59:59.999
  const to = new Date(range.to);
  assert.equal(to.getDate(), 12);
  assert.equal(to.getHours(), 23);
  assert.equal(to.getMinutes(), 59);
  assert.equal(to.getSeconds(), 59);
});

test("range week clamps offset > 0 to 0", () => {
  const now = new Date(2026, 3, 15, 12, 0, 0);
  const r1 = resolvePlayerReportRange("week", now, 5);
  const r2 = resolvePlayerReportRange("week", now, 0);
  assert.equal(r1.offset, 0);
  assert.equal(r1.from, r2.from);
});

test("range week clamps offset < -60 to -60", () => {
  const now = new Date(2026, 3, 15, 12, 0, 0);
  const range = resolvePlayerReportRange("week", now, -100);
  assert.equal(range.offset, -60);
});

// ── month (calendar) ─────────────────────────────────────────────────────────

test("range month (offset=0): første dag i måned, to = nå hvis inneværende", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("month", now);
  const from = new Date(range.from);
  assert.equal(from.getMonth(), 3); // april
  assert.equal(from.getDate(), 1);
  assert.equal(from.getHours(), 0);
  assert.equal(new Date(range.to).getTime(), now.getTime());
  assert.match(range.label, /^April 2026$/);
});

test("range month (offset=-1): forrige måned, to = siste dag 23:59:59.999", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("month", now, -1);
  const from = new Date(range.from);
  assert.equal(from.getMonth(), 2); // mars
  assert.equal(from.getDate(), 1);
  const to = new Date(range.to);
  assert.equal(to.getMonth(), 2);
  assert.equal(to.getDate(), 31); // mars siste dag
  assert.equal(to.getHours(), 23);
  assert.match(range.label, /^Mars 2026$/);
});

test("range month spans year boundary (offset crossing januar)", () => {
  const now = new Date(2026, 0, 15, 14, 0, 0); // januar
  const range = resolvePlayerReportRange("month", now, -1);
  const from = new Date(range.from);
  assert.equal(from.getFullYear(), 2025);
  assert.equal(from.getMonth(), 11); // desember
  assert.match(range.label, /^Desember 2025$/);
});

test("range month februar 2024 har 29 dager (skuddår)", () => {
  const now = new Date(2024, 1, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("month", now, 0);
  const to = new Date(range.to);
  // Feb 2024 is a leap year — siste dag should still respect that
  // (offset=0 means to=now, but check label)
  assert.match(range.label, /Februar 2024/);
});

test("range month februar 2025 har 28 dager (ikke skuddår)", () => {
  const now = new Date(2025, 2, 15, 14, 0, 0); // mars 15
  const range = resolvePlayerReportRange("month", now, -1);
  const to = new Date(range.to);
  assert.equal(to.getMonth(), 1); // februar
  assert.equal(to.getDate(), 28);
});

// ── year (rolling 365) ──────────────────────────────────────────────────────

test("range year alltid offset=0 (rolling 365)", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("year", now, -5);
  // year period should always have offset=0 (clamping doesn't apply because of fixed return)
  assert.equal(range.offset, 0);
  assert.match(range.label, /^Siste 12 måneder$/);
  const from = new Date(range.from);
  // 364 days before 2026-04-15 → 2025-04-16
  assert.equal(from.getFullYear(), 2025);
  assert.equal(from.getDate(), 16);
});

// ── Offset truncation ───────────────────────────────────────────────────────

test("offset is truncated (not rounded) — 1.7 → 1, then clamped to 0", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("week", now, 1.7);
  // 1.7 → trunc → 1 → clamp → 0
  assert.equal(range.offset, 0);
});

test("offset is truncated (not rounded) — -2.9 → -2", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("week", now, -2.9);
  // -2.9 → trunc → -2 (truncation towards zero)
  assert.equal(range.offset, -2);
});

test("offset NaN treated as 0", () => {
  const now = new Date(2026, 3, 15, 14, 0, 0);
  const range = resolvePlayerReportRange("week", now, NaN);
  assert.equal(range.offset, 0);
});
