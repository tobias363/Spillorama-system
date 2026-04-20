/**
 * expandSelectionsToTicketColors — BIN-688.
 *
 * Maps armed TicketSelection[] (from client, may or may not include the
 * canonical `name`) to a per-ticket colour/type list so pre-round tickets
 * in preRoundTickets render in the exact colour the player picked.
 *
 * Units under test:
 *   - Name-based match wins over type-based match (Small Yellow vs Small Purple).
 *   - Type-only match still resolves to a valid colour (legacy clients).
 *   - Bundle tickets (large=3 brett, elvis=2) expand to per-brett slots.
 *   - Traffic-light bundles expand across their colour triplet.
 *   - Unknown selection → fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STANDARD_CONFIG,
  DEFAULT_ELVIS_CONFIG,
  DEFAULT_TRAFFIC_LIGHT_CONFIG,
  expandSelectionsToTicketColors,
} from "./variantConfig.js";

test("name-based match: Small Yellow + Small White + Small Purple → 3 distinct colours", () => {
  const out = expandSelectionsToTicketColors(
    [
      { type: "small", name: "Small Yellow", qty: 1 },
      { type: "small", name: "Small White", qty: 1 },
      { type: "small", name: "Small Purple", qty: 1 },
    ],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].color, "Small Yellow");
  assert.equal(out[1].color, "Small White");
  assert.equal(out[2].color, "Small Purple");
  for (const a of out) assert.equal(a.type, "small");
});

test("qty > 1: 2× Small Yellow expands to two identical Small Yellow slots", () => {
  const out = expandSelectionsToTicketColors(
    [{ type: "small", name: "Small Yellow", qty: 2 }],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out, [
    { color: "Small Yellow", type: "small" },
    { color: "Small Yellow", type: "small" },
  ]);
});

test("Large Yellow expands to 3 brett (bundle), all coloured Large Yellow", () => {
  // DEFAULT_STANDARD_CONFIG has Large Yellow with ticketCount=3.
  const out = expandSelectionsToTicketColors(
    [{ type: "large", name: "Large Yellow", qty: 1 }],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  assert.equal(out.length, 3);
  for (const a of out) {
    assert.equal(a.color, "Large Yellow");
    assert.equal(a.type, "large");
  }
});

test("Mixed selection: 1 Small Yellow + 1 Large White → 1 + 3 = 4 brett", () => {
  const out = expandSelectionsToTicketColors(
    [
      { type: "small", name: "Small Yellow", qty: 1 },
      { type: "large", name: "Large White", qty: 1 },
    ],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  assert.equal(out.length, 4);
  assert.equal(out[0].color, "Small Yellow");
  // Slots 1..3 are the Large White bundle.
  for (let i = 1; i < 4; i++) {
    assert.equal(out[i].color, "Large White");
    assert.equal(out[i].type, "large");
  }
});

test("Type-only fallback (legacy client without `name`): resolves to first matching config entry", () => {
  const out = expandSelectionsToTicketColors(
    [{ type: "small", qty: 2 }],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  // First `small` in DEFAULT_STANDARD_CONFIG is "Small Yellow".
  assert.equal(out.length, 2);
  for (const a of out) {
    assert.equal(a.color, "Small Yellow");
    assert.equal(a.type, "small");
  }
});

test("Name match beats ambiguous type: sending name=Small Purple with type=small picks Purple", () => {
  const out = expandSelectionsToTicketColors(
    [{ type: "small", name: "Small Purple", qty: 1 }],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  assert.equal(out[0].color, "Small Purple");
});

test("Elvis bundle: 1× Elvis 2 → 2 brett, both Elvis 2", () => {
  // DEFAULT_ELVIS_CONFIG: each Elvis N has ticketCount=2.
  const out = expandSelectionsToTicketColors(
    [{ type: "elvis", name: "Elvis 2", qty: 1 }],
    DEFAULT_ELVIS_CONFIG,
    "elvis",
  );
  assert.equal(out.length, 2);
  for (const a of out) {
    assert.equal(a.color, "Elvis 2");
    assert.equal(a.type, "elvis");
  }
});

test("Traffic light bundle: 1× Traffic Light → 3 brett (Red/Yellow/Green)", () => {
  const out = expandSelectionsToTicketColors(
    [{ type: "traffic-light", name: "Traffic Light", qty: 1 }],
    DEFAULT_TRAFFIC_LIGHT_CONFIG,
    "traffic-light",
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].color, "Small Red");
  assert.equal(out[1].color, "Small Yellow");
  assert.equal(out[2].color, "Small Green");
});

test("Unknown selection falls back to sequential colours (safety net)", () => {
  const out = expandSelectionsToTicketColors(
    [{ type: "nonexistent", qty: 5 }],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  // assignTicketColors is called with count=0 when nothing matches, so we
  // don't synthesise ghost tickets. Empty is valid here — caller handles
  // padding.
  assert.equal(out.length, 0);
});

test("qty=0 selections are skipped", () => {
  const out = expandSelectionsToTicketColors(
    [
      { type: "small", name: "Small Yellow", qty: 0 },
      { type: "small", name: "Small White", qty: 1 },
    ],
    DEFAULT_STANDARD_CONFIG,
    "standard",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].color, "Small White");
});
