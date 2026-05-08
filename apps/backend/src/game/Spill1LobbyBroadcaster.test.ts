/**
 * R1 (BIN-822, 2026-05-08): unit-test for Spill1LobbyBroadcaster.
 *
 * Verifiserer fan-out-logikken (master + participating halls) og at
 * broadcasteren er best-effort (kaster ikke ved DB-feil eller ugyldig input).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Spill1LobbyBroadcaster } from "./Spill1LobbyBroadcaster.js";
import type { Game1LobbyService } from "./Game1LobbyService.js";
import type { Pool } from "pg";
import type { Server } from "socket.io";

interface FakeIoEmit {
  room: string;
  event: string;
  payload: unknown;
}

function makeFakeIo(emits: FakeIoEmit[]): Server {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emits.push({ room, event, payload });
        return true;
      },
    }),
  } as unknown as Server;
}

function makeFakeLobbyService(
  states: Map<string, { overallStatus: string }>,
): Game1LobbyService {
  return {
    async getLobbyState(hallId: string) {
      const state = states.get(hallId);
      if (!state) {
        // Default: returner stengt-state.
        return {
          hallId,
          businessDate: "2026-05-08",
          isOpen: false,
          openingTimeStart: null,
          openingTimeEnd: null,
          planId: null,
          planName: null,
          runId: null,
          runStatus: null,
          overallStatus: "closed" as const,
          nextScheduledGame: null,
          currentRunPosition: 0,
          totalPositions: 0,
        };
      }
      return {
        hallId,
        businessDate: "2026-05-08",
        isOpen: true,
        openingTimeStart: "11:00",
        openingTimeEnd: "23:00",
        planId: "plan-1",
        planName: "Plan",
        runId: "run-1",
        runStatus: state.overallStatus === "running" ? "running" : "idle",
        overallStatus: state.overallStatus as
          | "closed"
          | "idle"
          | "purchase_open"
          | "ready_to_start"
          | "running"
          | "paused"
          | "finished",
        nextScheduledGame: null,
        currentRunPosition: 1,
        totalPositions: 5,
      };
    },
  } as unknown as Game1LobbyService;
}

function makeFakePool(rows: Map<string, unknown[]>): Pool {
  return {
    async query(sql: string, params: unknown[]) {
      // Match query basert på FROM-klausen.
      if (sql.includes("app_game1_scheduled_games")) {
        const id = params[0] as string;
        const data = rows.get(`game:${id}`) ?? [];
        return { rows: data, rowCount: data.length };
      }
      if (sql.includes("app_game_plan_run")) {
        const id = params[0] as string;
        const data = rows.get(`run:${id}`) ?? [];
        return { rows: data, rowCount: data.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
}

test("broadcastForHall: emit til hall-room med fersk lobby-state", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const states = new Map([["hall-1", { overallStatus: "running" }]]);
  const lobbyService = makeFakeLobbyService(states);
  const pool = makeFakePool(new Map());

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForHall("hall-1");

  assert.equal(emits.length, 1);
  assert.equal(emits[0].room, "spill1:lobby:hall-1");
  assert.equal(emits[0].event, "lobby:state-update");
  const payload = emits[0].payload as { hallId: string; state: { overallStatus: string } };
  assert.equal(payload.hallId, "hall-1");
  assert.equal(payload.state.overallStatus, "running");
});

test("broadcastForHall: ignorerer ugyldig hallId (best-effort)", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const lobbyService = makeFakeLobbyService(new Map());
  const pool = makeFakePool(new Map());

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForHall("");
  await broadcaster.broadcastForHall("   ");

  assert.equal(emits.length, 0);
});

test("broadcastForHall: kaster ikke ved service-feil", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const failingService = {
    async getLobbyState() {
      throw new Error("simulated DB failure");
    },
  } as unknown as Game1LobbyService;
  const pool = makeFakePool(new Map());

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService: failingService,
    pool,
    schema: "public",
  });
  // Skal ikke kaste — bare logge warning og return.
  await broadcaster.broadcastForHall("hall-1");
  assert.equal(emits.length, 0);
});

test("broadcastForScheduledGame: fan-out til master + participating halls", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const states = new Map([
    ["hall-master", { overallStatus: "running" }],
    ["hall-2", { overallStatus: "running" }],
    ["hall-3", { overallStatus: "running" }],
  ]);
  const lobbyService = makeFakeLobbyService(states);
  const pool = makeFakePool(
    new Map([
      [
        "game:sg-1",
        [
          {
            master_hall_id: "hall-master",
            participating_halls_json: ["hall-master", "hall-2", "hall-3"],
          },
        ],
      ],
    ]),
  );

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForScheduledGame("sg-1");

  assert.equal(emits.length, 3);
  const rooms = emits.map((e) => e.room).sort();
  assert.deepEqual(rooms, [
    "spill1:lobby:hall-2",
    "spill1:lobby:hall-3",
    "spill1:lobby:hall-master",
  ]);
});

test("broadcastForScheduledGame: tom participating-array → bare master", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const states = new Map([["hall-master", { overallStatus: "running" }]]);
  const lobbyService = makeFakeLobbyService(states);
  const pool = makeFakePool(
    new Map([
      [
        "game:sg-1",
        [
          {
            master_hall_id: "hall-master",
            participating_halls_json: [],
          },
        ],
      ],
    ]),
  );

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForScheduledGame("sg-1");

  assert.equal(emits.length, 1);
  assert.equal(emits[0].room, "spill1:lobby:hall-master");
});

test("broadcastForScheduledGame: rad ikke funnet → no-op", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const lobbyService = makeFakeLobbyService(new Map());
  const pool = makeFakePool(new Map());

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForScheduledGame("missing");
  assert.equal(emits.length, 0);
});

test("broadcastForPlanRun: 1-til-1 hall-binding", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const states = new Map([["hall-master", { overallStatus: "running" }]]);
  const lobbyService = makeFakeLobbyService(states);
  const pool = makeFakePool(
    new Map([
      [
        "run:run-1",
        [{ hall_id: "hall-master" }],
      ],
    ]),
  );

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForPlanRun("run-1");

  assert.equal(emits.length, 1);
  assert.equal(emits[0].room, "spill1:lobby:hall-master");
});

test("broadcastForScheduledGame: tolerer participating-json som string", async () => {
  const emits: FakeIoEmit[] = [];
  const io = makeFakeIo(emits);
  const states = new Map([
    ["hall-master", { overallStatus: "running" }],
    ["hall-2", { overallStatus: "running" }],
  ]);
  const lobbyService = makeFakeLobbyService(states);
  const pool = makeFakePool(
    new Map([
      [
        "game:sg-1",
        [
          {
            master_hall_id: "hall-master",
            // Som om Postgres returnerte unparsed JSON-string
            participating_halls_json: '["hall-master","hall-2"]',
          },
        ],
      ],
    ]),
  );

  const broadcaster = new Spill1LobbyBroadcaster({
    io,
    lobbyService,
    pool,
    schema: "public",
  });
  await broadcaster.broadcastForScheduledGame("sg-1");

  assert.equal(emits.length, 2);
});
