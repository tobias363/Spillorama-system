/**
 * roomState.cancelPreRoundTicket — BIN-692.
 *
 * Unity parity: `Game1ViewPurchaseElvisTicket.cs:17,49-76` deleteBtn.
 *
 * Covers:
 *   1. Single small ticket (ticketCount=1): removes exactly one from
 *      cache, decrements qty by 1, disarms player if it was the last.
 *   2. Large bundle (ticketCount=3): × on ANY of the 3 brett removes all
 *      3; selection.qty decrements by 1; cache shrinks by 3.
 *   3. Elvis bundle (ticketCount=2): same semantics, 2 brett removed.
 *   4. Traffic-light bundle (ticketCount=3): matches name on selection
 *      (not type, because traffic-light uses "Traffic Light" as a single
 *      selection entry that expands to 3 brett).
 *   5. Multiple selections: × on a ticket in the SECOND selection only
 *      touches that one; first selection stays intact.
 *   6. Mixed bundle + small: × on the Large bundle removes all 3 Large
 *      brett; the small brett are untouched.
 *   7. Last bundle → full disarm: player removed from armedPlayerIdsByRoom.
 *   8. Unknown ticketId → null (no mutation).
 *   9. No selections for player → null.
 *  10. Total weighted count stays consistent after cancel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RoomStateManager } from "./roomState.js";
import { DEFAULT_STANDARD_CONFIG, DEFAULT_ELVIS_CONFIG, DEFAULT_TRAFFIC_LIGHT_CONFIG } from "../game/variantConfig.js";

function seedRoom(
  rs: RoomStateManager,
  roomCode: string,
  playerId: string,
  selections: Array<{ type: string; qty: number; name?: string }>,
  displayTickets: Array<{ id: string; color?: string; type?: string }>,
  totalWeighted: number,
): void {
  rs.armPlayer(roomCode, playerId, totalWeighted, selections);
  // Seed display cache via the public API — pass colorAssignments so the
  // cache matches what expandSelectionsToTicketColors would have produced.
  const key = `${roomCode}:${playerId}`;
  // Bypass getOrCreateDisplayTickets (which would regenerate grids); use
  // the backing Map directly to insert a deterministic fixture.
  const tickets = displayTickets.map((t) => ({
    grid: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]],
    ...t,
  }));
  rs.displayTicketCache.set(key, tickets);
}

test("BIN-692: single small × removes 1 brett, decrements qty, disarms when last", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "small", name: "Small Yellow", qty: 1 }],
    [{ id: "tkt-0", color: "Small Yellow", type: "small" }],
    1,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-0", DEFAULT_STANDARD_CONFIG);
  assert.ok(result);
  assert.deepEqual(result.removedTicketIds, ["tkt-0"]);
  assert.equal(result.remainingTicketCount, 0);
  assert.equal(result.fullyDisarmed, true);
  assert.deepEqual(rs.getArmedPlayerIds("R1"), []);
});

test("BIN-692: Large bundle — × on brett 1 of 3 removes all 3", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "large", name: "Large White", qty: 1 }],
    [
      { id: "tkt-0", color: "Large White", type: "large" },
      { id: "tkt-1", color: "Large White", type: "large" },
      { id: "tkt-2", color: "Large White", type: "large" },
    ],
    3,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-1", DEFAULT_STANDARD_CONFIG);
  assert.ok(result);
  assert.deepEqual(result.removedTicketIds, ["tkt-0", "tkt-1", "tkt-2"]);
  assert.equal(result.fullyDisarmed, true);
});

test("BIN-692: × on first brett of a Large bundle removes whole bundle (smoketest)", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "large", name: "Large White", qty: 1 }],
    [
      { id: "tkt-0", color: "Large White", type: "large" },
      { id: "tkt-1", color: "Large White", type: "large" },
      { id: "tkt-2", color: "Large White", type: "large" },
    ],
    3,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-0", DEFAULT_STANDARD_CONFIG);
  assert.ok(result);
  assert.equal(result.removedTicketIds.length, 3);
});

test("BIN-692: Elvis bundle (ticketCount=2) removes both when ×ed", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "elvis", name: "Elvis 2", qty: 1 }],
    [
      { id: "tkt-0", color: "Elvis 2", type: "elvis" },
      { id: "tkt-1", color: "Elvis 2", type: "elvis" },
    ],
    2,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-0", DEFAULT_ELVIS_CONFIG);
  assert.ok(result);
  assert.equal(result.removedTicketIds.length, 2);
});

test("BIN-692: Traffic-light bundle — all 3 removed regardless of which brett is clicked", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "traffic-light", name: "Traffic Light", qty: 1 }],
    [
      { id: "tkt-0", color: "Small Red", type: "traffic-red" },
      { id: "tkt-1", color: "Small Yellow", type: "traffic-yellow" },
      { id: "tkt-2", color: "Small Green", type: "traffic-green" },
    ],
    3,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-2", DEFAULT_TRAFFIC_LIGHT_CONFIG);
  assert.ok(result);
  assert.equal(result.removedTicketIds.length, 3);
  assert.deepEqual(result.removedTicketIds, ["tkt-0", "tkt-1", "tkt-2"]);
});

test("BIN-692: multiple selections — × in second selection only touches that", () => {
  const rs = new RoomStateManager();
  // 1 Small Yellow + 2 Small White = 3 tickets, order: [Y, W, W]
  seedRoom(
    rs, "R1", "p1",
    [
      { type: "small", name: "Small Yellow", qty: 1 },
      { type: "small", name: "Small White", qty: 2 },
    ],
    [
      { id: "tkt-0", color: "Small Yellow", type: "small" },
      { id: "tkt-1", color: "Small White", type: "small" },
      { id: "tkt-2", color: "Small White", type: "small" },
    ],
    3,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-2", DEFAULT_STANDARD_CONFIG);
  assert.ok(result);
  assert.deepEqual(result.removedTicketIds, ["tkt-2"]);
  assert.equal(result.fullyDisarmed, false);
  assert.equal(result.remainingTicketCount, 2);
});

test("BIN-692: mixed Large + Small — × on Large brett only removes the 3 Large, Small untouched", () => {
  const rs = new RoomStateManager();
  // 1 Large White + 2 Small Yellow = 5 tickets, order: [L, L, L, Y, Y]
  seedRoom(
    rs, "R1", "p1",
    [
      { type: "large", name: "Large White", qty: 1 },
      { type: "small", name: "Small Yellow", qty: 2 },
    ],
    [
      { id: "tkt-0", color: "Large White", type: "large" },
      { id: "tkt-1", color: "Large White", type: "large" },
      { id: "tkt-2", color: "Large White", type: "large" },
      { id: "tkt-3", color: "Small Yellow", type: "small" },
      { id: "tkt-4", color: "Small Yellow", type: "small" },
    ],
    5,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-1", DEFAULT_STANDARD_CONFIG);
  assert.ok(result);
  assert.deepEqual(result.removedTicketIds, ["tkt-0", "tkt-1", "tkt-2"]);
  assert.equal(result.remainingTicketCount, 2); // 2 Small Yellow igjen
  assert.equal(result.fullyDisarmed, false);
});

test("BIN-692: × on last remaining bundle fully disarms the player", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "small", name: "Small Yellow", qty: 2 }],
    [
      { id: "tkt-0", color: "Small Yellow", type: "small" },
      { id: "tkt-1", color: "Small Yellow", type: "small" },
    ],
    2,
  );

  // Fjern første
  const r1 = rs.cancelPreRoundTicket("R1", "p1", "tkt-0", DEFAULT_STANDARD_CONFIG);
  assert.ok(r1);
  assert.equal(r1.fullyDisarmed, false);
  assert.equal(r1.remainingTicketCount, 1);

  // Fjern andre — nå blir det tomt → disarm
  const r2 = rs.cancelPreRoundTicket("R1", "p1", "tkt-1", DEFAULT_STANDARD_CONFIG);
  assert.ok(r2);
  assert.equal(r2.fullyDisarmed, true);
  assert.equal(r2.remainingTicketCount, 0);
  assert.deepEqual(rs.getArmedPlayerIds("R1"), []);
});

test("BIN-692: unknown ticketId returns null (no mutation)", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [{ type: "small", name: "Small Yellow", qty: 1 }],
    [{ id: "tkt-0", color: "Small Yellow", type: "small" }],
    1,
  );

  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-999", DEFAULT_STANDARD_CONFIG);
  assert.equal(result, null);
  assert.deepEqual(rs.getArmedPlayerIds("R1"), ["p1"]);
});

test("BIN-692: no selections for player returns null", () => {
  const rs = new RoomStateManager();
  const result = rs.cancelPreRoundTicket("R1", "p1", "tkt-0", DEFAULT_STANDARD_CONFIG);
  assert.equal(result, null);
});

test("BIN-692: totalWeighted in armedPlayerIdsByRoom is kept consistent", () => {
  const rs = new RoomStateManager();
  seedRoom(
    rs, "R1", "p1",
    [
      { type: "large", name: "Large White", qty: 1 }, // 3 brett
      { type: "small", name: "Small Yellow", qty: 2 }, // 2 brett
    ],
    [
      { id: "tkt-0", color: "Large White", type: "large" },
      { id: "tkt-1", color: "Large White", type: "large" },
      { id: "tkt-2", color: "Large White", type: "large" },
      { id: "tkt-3", color: "Small Yellow", type: "small" },
      { id: "tkt-4", color: "Small Yellow", type: "small" },
    ],
    5,
  );

  rs.cancelPreRoundTicket("R1", "p1", "tkt-1", DEFAULT_STANDARD_CONFIG);
  const counts = rs.getArmedPlayerTicketCounts("R1");
  assert.equal(counts.p1, 2, "5 − 3 (Large bundle) = 2 small igjen");
});
