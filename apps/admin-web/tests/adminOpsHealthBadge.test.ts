// ADMIN Super-User Operations Console — health-badge unit tests.
//
// Test boundaries:
//  - Inactive hall → "inactive"
//  - Active hall, no room → "inactive" (Idle)
//  - ENDED status → red
//  - PAUSED status → yellow
//  - WAITING/NONE status → yellow
//  - RUNNING + last-draw timing:
//    * <30s → green
//    * 30s-60s (boundary) → yellow
//    * >=60s → red (Stuck)
//    * no last-draw yet → green (fresh start)
//  - PAUSED via isPaused-flag (legacy) → yellow

import { describe, it, expect } from "vitest";
import {
  computeHealthBadge,
  type HealthBadge,
} from "../src/pages/admin-ops/healthBadge.js";
import type { OpsHall, OpsRoom, OpsRoomStatus } from "../src/api/admin-ops.js";

function makeHall(overrides: Partial<OpsHall> = {}): OpsHall {
  return {
    id: "hall-a",
    name: "Hall A",
    hallNumber: 100,
    groupOfHallsId: "goh-1",
    groupName: "Group 1",
    masterHallId: "hall-a",
    isActive: true,
    isTestHall: false,
    activeRoomCount: 1,
    playersOnline: 24,
    ...overrides,
  };
}

function makeRoom(
  status: OpsRoomStatus | null,
  lastDrawAt: string | null,
  overrides: Partial<OpsRoom> = {}
): OpsRoom {
  return {
    code: "ROOM-A",
    hallId: "hall-a",
    currentGame:
      status === null
        ? null
        : {
            id: "game-1",
            status,
            drawnNumbersCount: 12,
            maxDraws: 75,
            isPaused: false,
            endedReason: null,
          },
    playersOnline: 24,
    lastDrawAt,
    ...overrides,
  };
}

const NOW = Date.parse("2026-04-27T12:00:00.000Z");

describe("computeHealthBadge", () => {
  it("returns inactive when hall is disabled", () => {
    const hall = makeHall({ isActive: false });
    const badge = computeHealthBadge(hall, makeRoom("RUNNING", "2026-04-27T11:59:55.000Z"), NOW);
    expect(badge.color).toBe("inactive");
    expect(badge.label).toBe("Inactive");
  });

  it("returns inactive (Idle) when there is no room", () => {
    const badge = computeHealthBadge(makeHall(), null, NOW);
    expect(badge.color).toBe("inactive");
    expect(badge.label).toBe("Idle");
  });

  it("returns inactive (Idle) when room has no current game", () => {
    const room = makeRoom(null, null);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("inactive");
    expect(badge.label).toBe("Idle");
  });

  it("returns red for ENDED status", () => {
    const room = makeRoom("ENDED", "2026-04-27T11:55:00.000Z");
    if (room.currentGame) room.currentGame.endedReason = "Operator ended";
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("red");
    expect(badge.label).toBe("Ended");
    expect(badge.reason).toContain("Operator ended");
  });

  it("returns yellow for PAUSED status", () => {
    const room = makeRoom("PAUSED", "2026-04-27T11:59:55.000Z");
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("yellow");
    expect(badge.label).toBe("Paused");
  });

  it("returns yellow for RUNNING+isPaused (legacy fallback)", () => {
    const room = makeRoom("RUNNING", "2026-04-27T11:59:55.000Z");
    if (room.currentGame) room.currentGame.isPaused = true;
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("yellow");
    expect(badge.label).toBe("Paused");
  });

  it("returns yellow for WAITING status", () => {
    const room = makeRoom("WAITING", null);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("yellow");
    expect(badge.label).toBe("Waiting");
  });

  it("returns yellow for NONE status", () => {
    const room = makeRoom("NONE", null);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("yellow");
    expect(badge.label).toBe("Waiting");
  });

  // ── RUNNING + draw-timing boundaries ────────────────────────────────

  it("returns green when RUNNING with no draws yet (fresh start)", () => {
    const room = makeRoom("RUNNING", null);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("green");
    expect(badge.label).toMatch(/^R\d+\/\d+$/);
  });

  it("returns green when last draw < 30s ago (29s boundary)", () => {
    const lastDraw = new Date(NOW - 29_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("green");
  });

  it("returns yellow when last draw exactly 30s ago", () => {
    const lastDraw = new Date(NOW - 30_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("yellow");
  });

  it("returns yellow when last draw 59s ago", () => {
    const lastDraw = new Date(NOW - 59_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("yellow");
  });

  it("returns red (Stuck) when last draw exactly 60s ago", () => {
    const lastDraw = new Date(NOW - 60_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("red");
    expect(badge.label).toBe("Stuck");
  });

  it("returns red (Stuck) when last draw 5min ago", () => {
    const lastDraw = new Date(NOW - 5 * 60_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.color).toBe("red");
  });

  it("uses maxDraws=75 by default in label", () => {
    const lastDraw = new Date(NOW - 1_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    if (room.currentGame) {
      room.currentGame.drawnNumbersCount = 33;
      room.currentGame.maxDraws = 75;
    }
    const badge: HealthBadge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.label).toBe("R33/75");
  });

  it("uses provided maxDraws value", () => {
    const lastDraw = new Date(NOW - 1_000).toISOString();
    const room = makeRoom("RUNNING", lastDraw);
    if (room.currentGame) {
      room.currentGame.drawnNumbersCount = 12;
      room.currentGame.maxDraws = 60;
    }
    const badge = computeHealthBadge(makeHall(), room, NOW);
    expect(badge.label).toBe("R12/60");
  });
});
