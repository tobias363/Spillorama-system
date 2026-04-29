/**
 * roomState.hasArmedOrReservation.test.ts
 *
 * FORHANDSKJOP-ORPHAN-FIX (PR 2, 2026-04-29).
 *
 * Unit tests for `RoomStateManager.hasArmedOrReservation` — the
 * introspection helper supplied to `BingoEngine.cleanupStaleWalletInIdleRooms`
 * via the `isPreserve` callback. It must return true when the (roomCode,
 * playerId) tuple has any in-flight pre-round purchase state — armed-set
 * membership OR an active wallet-reservation — and false otherwise.
 *
 * Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md §6 PR 2.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RoomStateManager } from "../roomState.js";

test("hasArmedOrReservation returns false when neither armed nor reserved", () => {
  const rs = new RoomStateManager();
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "player-1"), false);
});

test("hasArmedOrReservation returns true when only armed", () => {
  const rs = new RoomStateManager();
  rs.armPlayer("ROOM-A", "player-1", 1);
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "player-1"), true);
  assert.equal(
    rs.hasArmedOrReservation("ROOM-A", "player-2"),
    false,
    "other players in same room are not armed",
  );
});

test("hasArmedOrReservation returns true when only reserved", () => {
  const rs = new RoomStateManager();
  rs.setReservationId("ROOM-A", "player-1", "res-abc-123");
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "player-1"), true);
});

test("hasArmedOrReservation returns true when both armed AND reserved", () => {
  const rs = new RoomStateManager();
  rs.armPlayer("ROOM-A", "player-1", 3);
  rs.setReservationId("ROOM-A", "player-1", "res-xyz-789");
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "player-1"), true);
});

test("hasArmedOrReservation returns false for unknown room", () => {
  const rs = new RoomStateManager();
  rs.armPlayer("ROOM-A", "player-1", 1);
  rs.setReservationId("ROOM-A", "player-1", "res-1");
  // Same player id but different room code — no match.
  assert.equal(rs.hasArmedOrReservation("ROOM-OTHER", "player-1"), false);
});

test("hasArmedOrReservation returns false for unknown player in known room", () => {
  const rs = new RoomStateManager();
  rs.armPlayer("ROOM-A", "player-1", 1);
  rs.setReservationId("ROOM-A", "player-1", "res-1");
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "player-unknown"), false);
});

test("hasArmedOrReservation flips back to false after disarmPlayer + clearReservationId", () => {
  const rs = new RoomStateManager();
  rs.armPlayer("ROOM-A", "player-1", 1);
  rs.setReservationId("ROOM-A", "player-1", "res-1");
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "player-1"), true);
  // disarmPlayer also clears the reservation in current implementation,
  // but be explicit for documentation purposes.
  rs.disarmPlayer("ROOM-A", "player-1");
  rs.clearReservationId("ROOM-A", "player-1");
  assert.equal(
    rs.hasArmedOrReservation("ROOM-A", "player-1"),
    false,
    "no in-flight state remains after disarm + clearReservation",
  );
});

test("hasArmedOrReservation: disarmAllPlayers clears the room's armed + reserved snapshots", () => {
  const rs = new RoomStateManager();
  rs.armPlayer("ROOM-A", "p1", 1);
  rs.armPlayer("ROOM-A", "p2", 2);
  rs.setReservationId("ROOM-A", "p1", "res-p1");
  rs.setReservationId("ROOM-A", "p2", "res-p2");
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "p1"), true);
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "p2"), true);

  rs.disarmAllPlayers("ROOM-A");

  assert.equal(rs.hasArmedOrReservation("ROOM-A", "p1"), false);
  assert.equal(rs.hasArmedOrReservation("ROOM-A", "p2"), false);
});
