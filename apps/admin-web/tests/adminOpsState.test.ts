// ADMIN Super-User Operations Console — state-store unit tests.
//
// Verifiserer at:
//  - replaceSnapshot setter loaded=true og sorterer alerts.
//  - applyDelta merger keyed (halls/rooms/groups/alerts).
//  - alertsRemovedIds fjerner items fra state.alerts.
//  - sortAlerts sorterer på severity (CRITICAL>WARN>INFO) deretter newest-first.

import { describe, it, expect } from "vitest";
import {
  applyDelta,
  createInitialState,
  replaceSnapshot,
  roomsByHallId,
  sortAlerts,
} from "../src/pages/admin-ops/opsState.js";
import type {
  OpsAlert,
  OpsHall,
  OpsRoom,
  OpsOverviewResponse,
} from "../src/api/admin-ops.js";

function makeAlert(
  id: string,
  severity: OpsAlert["severity"],
  createdAt: string,
  acknowledged = false
): OpsAlert {
  return {
    id,
    severity,
    type: "DRAW_STUCK",
    hallId: "hall-a",
    roomCode: "ROOM-A",
    message: "x",
    acknowledgedAt: acknowledged ? "2026-04-27T12:00:00Z" : null,
    acknowledgedByUserId: null,
    createdAt,
  };
}

function makeHall(id: string, name = "Hall"): OpsHall {
  return {
    id,
    name: `${name} ${id}`,
    hallNumber: 100,
    groupOfHallsId: "goh-1",
    groupName: "G",
    masterHallId: id,
    isActive: true,
    isTestHall: false,
    activeRoomCount: 1,
    playersOnline: 5,
  };
}

function makeRoom(code: string, hallId: string): OpsRoom {
  return {
    code,
    hallId,
    currentGame: {
      id: "game-1",
      status: "RUNNING",
      drawnNumbersCount: 12,
      maxDraws: 75,
      isPaused: false,
      endedReason: null,
    },
    playersOnline: 24,
    lastDrawAt: "2026-04-27T11:59:55Z",
  };
}

describe("createInitialState", () => {
  it("returns empty state with loaded=false", () => {
    const state = createInitialState();
    expect(state.loaded).toBe(false);
    expect(state.halls).toEqual([]);
    expect(state.alerts).toEqual([]);
    expect(state.metrics.totalActiveRooms).toBe(0);
  });
});

describe("replaceSnapshot", () => {
  it("loads snapshot data, sorts alerts, sets loaded=true", () => {
    const state = createInitialState();
    const snapshot: OpsOverviewResponse = {
      halls: [makeHall("hall-a")],
      rooms: [makeRoom("ROOM-A", "hall-a")],
      groups: [
        {
          id: "goh-1",
          name: "G1",
          hallCount: 4,
          readyAggregate: "4/4",
          totalPayoutToday: 1000,
        },
      ],
      alerts: [
        makeAlert("a1", "INFO", "2026-04-27T12:00:00Z"),
        makeAlert("a2", "CRITICAL", "2026-04-27T11:59:00Z"),
      ],
      metrics: { totalActiveRooms: 1, totalPlayersOnline: 24 },
      snapshotAt: "2026-04-27T12:00:00Z",
    };
    replaceSnapshot(state, snapshot);
    expect(state.loaded).toBe(true);
    expect(state.halls).toHaveLength(1);
    expect(state.alerts[0]?.id).toBe("a2"); // CRITICAL first
    expect(state.alerts[1]?.id).toBe("a1");
    expect(state.snapshotAt).toBe("2026-04-27T12:00:00Z");
  });
});

describe("applyDelta", () => {
  it("adds new halls and updates existing ones by id", () => {
    const state = createInitialState();
    state.halls = [makeHall("hall-a", "Original")];

    const dirty = applyDelta(state, {
      halls: [makeHall("hall-a", "Updated"), makeHall("hall-b")],
    });
    expect(dirty.has("halls")).toBe(true);
    expect(state.halls).toHaveLength(2);
    // Existing hall-a is replaced in-place (same index), incoming wins on id-collision.
    const a = state.halls.find((h) => h.id === "hall-a");
    expect(a?.name).toBe("Updated hall-a");
    const b = state.halls.find((h) => h.id === "hall-b");
    expect(b?.name).toBe("Hall hall-b");
  });

  it("merges rooms by code", () => {
    const state = createInitialState();
    state.rooms = [makeRoom("ROOM-A", "hall-a")];

    const updated = makeRoom("ROOM-A", "hall-a");
    if (updated.currentGame) updated.currentGame.drawnNumbersCount = 50;
    applyDelta(state, { rooms: [updated, makeRoom("ROOM-B", "hall-b")] });
    expect(state.rooms).toHaveLength(2);
    const a = state.rooms.find((r) => r.code === "ROOM-A");
    expect(a?.currentGame?.drawnNumbersCount).toBe(50);
  });

  it("removes alerts via alertsRemovedIds", () => {
    const state = createInitialState();
    state.alerts = [
      makeAlert("a1", "WARN", "2026-04-27T12:00:00Z"),
      makeAlert("a2", "INFO", "2026-04-27T11:00:00Z"),
    ];
    applyDelta(state, { alertsRemovedIds: ["a1"] });
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]?.id).toBe("a2");
  });

  it("updates metrics", () => {
    const state = createInitialState();
    applyDelta(state, {
      metrics: { totalActiveRooms: 12, totalPlayersOnline: 234 },
    });
    expect(state.metrics.totalActiveRooms).toBe(12);
    expect(state.metrics.totalPlayersOnline).toBe(234);
  });

  it("returns empty dirty-set for empty delta", () => {
    const state = createInitialState();
    const dirty = applyDelta(state, {});
    expect(dirty.size).toBe(0);
  });
});

describe("sortAlerts", () => {
  it("sorts CRITICAL before WARN before INFO", () => {
    const sorted = sortAlerts([
      makeAlert("a", "INFO", "2026-04-27T12:00:00Z"),
      makeAlert("b", "CRITICAL", "2026-04-27T11:00:00Z"),
      makeAlert("c", "WARN", "2026-04-27T11:30:00Z"),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["b", "c", "a"]);
  });

  it("within same severity, sorts newest first", () => {
    const sorted = sortAlerts([
      makeAlert("old", "WARN", "2026-04-27T10:00:00Z"),
      makeAlert("new", "WARN", "2026-04-27T12:00:00Z"),
      makeAlert("mid", "WARN", "2026-04-27T11:00:00Z"),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("roomsByHallId", () => {
  it("returns first room per hall", () => {
    const map = roomsByHallId([
      makeRoom("ROOM-A", "hall-a"),
      makeRoom("ROOM-B", "hall-b"),
    ]);
    expect(map.get("hall-a")?.code).toBe("ROOM-A");
    expect(map.get("hall-b")?.code).toBe("ROOM-B");
  });

  it("prefers non-ENDED room when multiple per hall", () => {
    const ended = makeRoom("ROOM-A", "hall-a");
    if (ended.currentGame) ended.currentGame.status = "ENDED";
    const running = makeRoom("ROOM-B", "hall-a");
    const map = roomsByHallId([ended, running]);
    // first added is ended; second is running — running should win
    expect(map.get("hall-a")?.code).toBe("ROOM-B");
  });
});
