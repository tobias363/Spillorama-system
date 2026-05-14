/**
 * REGULATORISK-KRITISK (2026-05-14, fix for runde 7dcbc3ba payout-feil):
 *
 * Tester for `resolveColorSlugFromAssignment` — bygg slug-form
 * ("small_yellow"/"large_purple") fra (family-form ticket_color, ticket_size)
 * slik at engine kan slå opp per-farge pre-multipliserte premier i
 * ticket_config_json.spill1.ticketColors[] og patternsByColor.
 *
 * **Hvorfor fix:** `app_game1_ticket_assignments.ticket_color` lagres som
 * FAMILY-form ("yellow"/"purple"/"white") av purchase-service. Pre-fix
 * brukte engine family-form direkte som lookup-key — ingen match i
 * `patternsByColor` (keyed på engine-navn "Small Yellow") → fall til
 * __default__ matrise med HVIT-base → auto-multiplikator gikk tapt.
 *
 * DB-bevis (runde 7dcbc3ba 2026-05-14):
 *   - Yellow Rad 1: utbetalt 100 kr, skal være 200 (= 100 × 2)
 *   - Purple Rad 2: utbetalt 200 kr, skal være 300 (= 100 × 3)
 *
 * Helper test-en sikrer at slug-bygging er korrekt for alle kanon-kombinasjoner
 * + idempotent for legacy/slug-form input + null for ukjente farger.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveColorSlugFromAssignment } from "./Game1DrawEngineHelpers.js";

// ── Family + size → slug (kanonisk produksjons-path) ─────────────────────

test("resolveColorSlugFromAssignment: yellow + small → small_yellow", () => {
  assert.equal(
    resolveColorSlugFromAssignment("yellow", "small"),
    "small_yellow",
  );
});

test("resolveColorSlugFromAssignment: yellow + large → large_yellow", () => {
  assert.equal(
    resolveColorSlugFromAssignment("yellow", "large"),
    "large_yellow",
  );
});

test("resolveColorSlugFromAssignment: purple + small → small_purple", () => {
  assert.equal(
    resolveColorSlugFromAssignment("purple", "small"),
    "small_purple",
  );
});

test("resolveColorSlugFromAssignment: purple + large → large_purple", () => {
  assert.equal(
    resolveColorSlugFromAssignment("purple", "large"),
    "large_purple",
  );
});

test("resolveColorSlugFromAssignment: white + small → small_white", () => {
  assert.equal(
    resolveColorSlugFromAssignment("white", "small"),
    "small_white",
  );
});

test("resolveColorSlugFromAssignment: white + large → large_white", () => {
  assert.equal(
    resolveColorSlugFromAssignment("white", "large"),
    "large_white",
  );
});

// ── Case-insensitiv normalisering (DB kan ha mixed case) ────────────────

test("resolveColorSlugFromAssignment: YELLOW + small → small_yellow (case-insensitive)", () => {
  assert.equal(
    resolveColorSlugFromAssignment("YELLOW", "small"),
    "small_yellow",
  );
});

test("resolveColorSlugFromAssignment: Yellow + small → small_yellow (mixed case)", () => {
  assert.equal(
    resolveColorSlugFromAssignment("Yellow", "small"),
    "small_yellow",
  );
});

test("resolveColorSlugFromAssignment: '  yellow  ' + small → small_yellow (trimmer whitespace)", () => {
  assert.equal(
    resolveColorSlugFromAssignment("  yellow  ", "small"),
    "small_yellow",
  );
});

// ── Idempotens: slug-form input returneres uendret ──────────────────────

test("resolveColorSlugFromAssignment: small_yellow (slug) + undefined size → small_yellow (idempotent)", () => {
  // Legacy stubs sender slug-form direkte; backwards-compat-path.
  assert.equal(
    resolveColorSlugFromAssignment("small_yellow", undefined),
    "small_yellow",
  );
});

test("resolveColorSlugFromAssignment: large_purple (slug) + small (ignored) → large_purple", () => {
  // Slug-form i input vinner over ev. size-parameter (idempotent for
  // legacy compat).
  assert.equal(
    resolveColorSlugFromAssignment("large_purple", "small"),
    "large_purple",
  );
});

test("resolveColorSlugFromAssignment: SMALL_YELLOW (slug, uppercase) → small_yellow", () => {
  // Case-insensitiv normalisering også for slug-form input.
  assert.equal(
    resolveColorSlugFromAssignment("SMALL_YELLOW", undefined),
    "small_yellow",
  );
});

// ── Elvis-farger (uten size-prefix) ─────────────────────────────────────

test("resolveColorSlugFromAssignment: elvis1 (uten size) → elvis1", () => {
  assert.equal(
    resolveColorSlugFromAssignment("elvis1", undefined),
    "elvis1",
  );
});

test("resolveColorSlugFromAssignment: elvis3 + small (size ignored for elvis) → elvis3", () => {
  // Elvis-farger har ikke size-prefix; small/large-input ignoreres.
  assert.equal(
    resolveColorSlugFromAssignment("elvis3", "small"),
    "elvis3",
  );
});

// ── Spesial-farger (red/green/orange) ──────────────────────────────────

test("resolveColorSlugFromAssignment: red + small → small_red", () => {
  assert.equal(resolveColorSlugFromAssignment("red", "small"), "small_red");
});

test("resolveColorSlugFromAssignment: green + small → small_green", () => {
  assert.equal(
    resolveColorSlugFromAssignment("green", "small"),
    "small_green",
  );
});

test("resolveColorSlugFromAssignment: orange + small → small_orange", () => {
  assert.equal(
    resolveColorSlugFromAssignment("orange", "small"),
    "small_orange",
  );
});

// ── Defensive: ukjente farger ──────────────────────────────────────────

test("resolveColorSlugFromAssignment: 'mango' + small → null (ukjent farge)", () => {
  // Mango er ikke registrert. Caller faller tilbake til ticketColor
  // uendret (defensiv).
  assert.equal(resolveColorSlugFromAssignment("mango", "small"), null);
});

test("resolveColorSlugFromAssignment: yellow + undefined size → null (family uten size)", () => {
  // Family-form alene uten size kan ikke bygge slug. Caller fallback.
  assert.equal(resolveColorSlugFromAssignment("yellow", undefined), null);
});

test("resolveColorSlugFromAssignment: tom streng → null", () => {
  assert.equal(resolveColorSlugFromAssignment("", "small"), null);
});
