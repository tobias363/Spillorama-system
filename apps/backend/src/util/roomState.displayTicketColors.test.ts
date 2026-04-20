/**
 * roomState.getOrCreateDisplayTickets — BIN-688 colour assignments.
 *
 * Covers:
 *   1. Without colourAssignments → tickets have no `color`/`type` (backward
 *      compat with pre-BIN-688 behaviour).
 *   2. With colourAssignments → each generated ticket gets the paired
 *      colour + type, in order.
 *   3. Cache invalidation: same count but different colour mix must
 *      regenerate, so a player switching from Small Yellow → Small
 *      Purple sees the change immediately.
 *   4. Same count + same colours → cache hit (no regeneration — stable
 *      ticket ids/grids across polls).
 *   5. Cache-invalidation boundary: adding colourAssignments to a
 *      previously-uncoloured cache entry regenerates too.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RoomStateManager } from "./roomState.js";

function fresh(): RoomStateManager {
  return new RoomStateManager();
}

test("no colourAssignments → tickets have no color/type (backward compat)", () => {
  const rs = fresh();
  const tickets = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo");
  assert.equal(tickets.length, 2);
  for (const t of tickets) {
    assert.equal(t.color, undefined);
    assert.equal(t.type, undefined);
  }
});

test("with colourAssignments → each ticket gets the paired colour + type in order", () => {
  const rs = fresh();
  const tickets = rs.getOrCreateDisplayTickets("R1", "p1", 3, "bingo", [
    { color: "Small Yellow", type: "small" },
    { color: "Small White", type: "small" },
    { color: "Small Purple", type: "small" },
  ]);
  assert.equal(tickets.length, 3);
  assert.equal(tickets[0].color, "Small Yellow");
  assert.equal(tickets[1].color, "Small White");
  assert.equal(tickets[2].color, "Small Purple");
  for (const t of tickets) assert.equal(t.type, "small");
});

test("cache invalidates when colour mix changes (same count)", () => {
  const rs = fresh();
  const first = rs.getOrCreateDisplayTickets("R1", "p1", 3, "bingo", [
    { color: "Small Yellow", type: "small" },
    { color: "Small Yellow", type: "small" },
    { color: "Small Yellow", type: "small" },
  ]);
  const firstIds = first.map((t) => t.id);

  const second = rs.getOrCreateDisplayTickets("R1", "p1", 3, "bingo", [
    { color: "Small Yellow", type: "small" },
    { color: "Small White", type: "small" },
    { color: "Small Purple", type: "small" },
  ]);

  // Colours updated to the new mix.
  assert.equal(second[0].color, "Small Yellow");
  assert.equal(second[1].color, "Small White");
  assert.equal(second[2].color, "Small Purple");
  // Ids are regenerated as tkt-0..2 (deterministic, but tickets are a new
  // instance — grids are re-rolled).
  assert.deepEqual(
    second.map((t) => t.id),
    firstIds,
  );
  // The ticket objects themselves are new references post-regeneration.
  assert.notStrictEqual(second[0], first[0]);
});

test("cache hit when count + colour mix unchanged (stable grids across polls)", () => {
  const rs = fresh();
  const colours = [
    { color: "Small Yellow", type: "small" },
    { color: "Small White", type: "small" },
  ];
  const a = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo", colours);
  const b = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo", colours);
  // Same array reference → cache was reused; grids stay stable across
  // repeated room:update builds.
  assert.strictEqual(b, a);
});

test("cache invalidates when colourAssignments go from undefined → defined", () => {
  const rs = fresh();
  const uncoloured = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo");
  assert.equal(uncoloured[0].color, undefined);

  const coloured = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo", [
    { color: "Small Yellow", type: "small" },
    { color: "Small White", type: "small" },
  ]);
  assert.equal(coloured[0].color, "Small Yellow");
  assert.notStrictEqual(coloured, uncoloured);
});

test("cache invalidates when colourAssignments go from defined → undefined", () => {
  const rs = fresh();
  const coloured = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo", [
    { color: "Small Yellow", type: "small" },
    { color: "Small White", type: "small" },
  ]);
  assert.equal(coloured[0].color, "Small Yellow");

  const uncoloured = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo");
  assert.equal(uncoloured[0].color, undefined);
  assert.notStrictEqual(uncoloured, coloured);
});

test("count change still invalidates (existing contract preserved)", () => {
  const rs = fresh();
  const colours = [
    { color: "Small Yellow", type: "small" },
    { color: "Small White", type: "small" },
  ];
  const two = rs.getOrCreateDisplayTickets("R1", "p1", 2, "bingo", colours);
  assert.equal(two.length, 2);

  const three = rs.getOrCreateDisplayTickets("R1", "p1", 3, "bingo", [
    ...colours,
    { color: "Small Purple", type: "small" },
  ]);
  assert.equal(three.length, 3);
  assert.notStrictEqual(three, two);
});
