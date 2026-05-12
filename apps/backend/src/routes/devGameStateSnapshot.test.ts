/**
 * Tester for devGameStateSnapshot.ts (Tobias-direktiv 2026-05-12).
 *
 * Dekker:
 *   - Token-gating (401 uten token, 403 ved feil token, 503 hvis env mangler)
 *   - 400 hvis roomCode mangler
 *   - Engine in-memory snapshot (exists=false, exists=true med currentGame)
 *   - DB scheduled_games og game_state inkluderes når rows finnes
 *   - DB-feil i én kilde feller ikke hele requesten (fail-soft per kilde)
 *   - Socket-rom-size leses fra io.sockets.adapter
 *   - stateVersion leses fra store
 *   - Diagnose-hint flagger ENGINE_DB_STATUS_MISMATCH og STALE_SOCKETS
 *
 * Tester bygger en mini-Express-app med fakes for BingoEngine + Pool +
 * Socket.IO Server + RoomStateVersionStore.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createDevGameStateSnapshotRouter } from "./devGameStateSnapshot.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { Pool } from "pg";
import type { Server as SocketIOServer } from "socket.io";
import type { RoomStateVersionStore } from "../util/RoomStateVersionStore.js";

const ORIGINAL_TOKEN = process.env.RESET_TEST_PLAYERS_TOKEN;

interface FakeEngineOpts {
  summaries?: Array<{
    code: string;
    gameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED";
    playerCount: number;
  }>;
  snapshot?: unknown;
  snapshotThrowsForCode?: string;
}

function makeFakeEngine(opts: FakeEngineOpts): BingoEngine {
  return {
    listRoomSummaries: () => opts.summaries ?? [],
    getRoomSnapshot: (roomCode: string) => {
      if (opts.snapshotThrowsForCode === roomCode) {
        throw new Error("intentional snapshot failure");
      }
      return opts.snapshot;
    },
  } as unknown as BingoEngine;
}

interface FakePoolOpts {
  /** scheduledRow: row returned by første query (scheduled_games). undefined → no rows. */
  scheduledRow?: Record<string, unknown> | null;
  /** gameStateRow: row returned by andre query (game_state). undefined → no rows. */
  gameStateRow?: Record<string, unknown> | null;
  /** Hvis satt: kast feil ved query som matcher SUBSTRING. */
  throwOnSql?: string;
}

function makeFakePool(opts: FakePoolOpts): Pool {
  return {
    query: async (sql: string) => {
      if (opts.throwOnSql && sql.includes(opts.throwOnSql)) {
        throw new Error(`intentional query failure for: ${opts.throwOnSql}`);
      }
      if (sql.includes("app_game1_scheduled_games") && !sql.includes("app_game1_game_state")) {
        return { rows: opts.scheduledRow != null ? [opts.scheduledRow] : [] };
      }
      if (sql.includes("app_game1_game_state")) {
        return { rows: opts.gameStateRow != null ? [opts.gameStateRow] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
}

function makeFakeIo(roomSizes: Record<string, number>): SocketIOServer {
  return {
    sockets: {
      adapter: {
        rooms: {
          get: (roomCode: string) => {
            const size = roomSizes[roomCode];
            if (size === undefined) return undefined;
            // Mock Set with .size getter
            return { size } as Set<string>;
          },
        },
      },
    },
  } as unknown as SocketIOServer;
}

function makeFakeVersionStore(versions: Record<string, number>): RoomStateVersionStore {
  return {
    next: async (code: string) => {
      const v = (versions[code] ?? 0) + 1;
      versions[code] = v;
      return v;
    },
    current: async (code: string) => versions[code] ?? 0,
  };
}

async function startApp(opts: {
  engine: BingoEngine;
  pool: Pool;
  io: SocketIOServer;
  roomStateVersionStore: RoomStateVersionStore;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(
    createDevGameStateSnapshotRouter({
      pool: opts.pool,
      engine: opts.engine,
      io: opts.io,
      roomStateVersionStore: opts.roomStateVersionStore,
    }),
  );
  return await new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        throw new Error("server.address() returnerte ikke object");
      }
      const port = addr.port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe("devGameStateSnapshot router", () => {
  beforeEach(() => {
    process.env.RESET_TEST_PLAYERS_TOKEN = "test-token";
  });

  after(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
    } else {
      process.env.RESET_TEST_PLAYERS_TOKEN = ORIGINAL_TOKEN;
    }
  });

  describe("token-gating", () => {
    it("returnerer 503 hvis RESET_TEST_PLAYERS_TOKEN er ikke satt", async () => {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R`,
        );
        assert.equal(res.status, 503);
        const body = (await res.json()) as { ok: boolean; error: { code: string } };
        assert.equal(body.ok, false);
        assert.equal(body.error.code, "DEV_TOKEN_NOT_CONFIGURED");
      } finally {
        await close();
      }
    });

    it("returnerer 401 hvis token mangler", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R`,
        );
        assert.equal(res.status, 401);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "TOKEN_REQUIRED");
      } finally {
        await close();
      }
    });

    it("returnerer 403 hvis token er feil", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=wrong`,
        );
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "FORBIDDEN");
      } finally {
        await close();
      }
    });

    it("returnerer 200 ved valid token", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        assert.equal(res.status, 200);
      } finally {
        await close();
      }
    });
  });

  describe("input validation", () => {
    it("returnerer 400 hvis roomCode mangler", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?token=test-token`,
        );
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "INVALID_INPUT");
      } finally {
        await close();
      }
    });

    it("normaliserer roomCode til UPPERCASE", async () => {
      let queriedFor: string | null = null;
      const pool = {
        query: async (_sql: string, params?: unknown[]) => {
          if (Array.isArray(params)) {
            queriedFor = String(params[0]);
          }
          return { rows: [] };
        },
      } as unknown as Pool;
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool,
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=bingo_demo&token=test-token`,
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { roomCode: string } };
        assert.equal(body.data.roomCode, "BINGO_DEMO");
        assert.equal(queriedFor, "BINGO_DEMO");
      } finally {
        await close();
      }
    });
  });

  describe("engine in-memory snapshot", () => {
    it("returnerer engineRoom.exists=false hvis rommet ikke finnes", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({ summaries: [] }),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { engineRoom: { exists: boolean } };
        };
        assert.equal(body.data.engineRoom.exists, false);
      } finally {
        await close();
      }
    });

    it("returnerer engineRoom med currentGame hvis snapshot finnes", async () => {
      const snapshot = {
        code: "R",
        hostPlayerId: "p1",
        hallId: "h1",
        gameSlug: "bingo",
        createdAt: "2026-05-12T00:00:00.000Z",
        players: [
          { id: "p1", walletId: "w1", hallId: "h1", socketId: "s1" },
          { id: "p2", walletId: "w2", hallId: "h1", socketId: null },
        ],
        currentGame: {
          id: "g1",
          status: "RUNNING",
          drawnNumbers: [1, 5, 23, 42],
          drawBag: [2, 3, 4],
          startedAt: "2026-05-12T00:01:00.000Z",
          endedAt: null,
          endedReason: null,
          isPaused: false,
          pauseReason: null,
          pauseUntil: null,
          participatingPlayerIds: ["p1", "p2"],
          claims: [{ id: "c1" }],
        },
      };
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({
          summaries: [{ code: "R", gameStatus: "RUNNING", playerCount: 2 }],
          snapshot,
        }),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { engineRoom: Record<string, unknown> };
        };
        assert.equal(body.data.engineRoom.exists, true);
        assert.equal(body.data.engineRoom.playerCount, 2);
        const game = body.data.engineRoom.currentGame as Record<string, unknown>;
        assert.equal(game.status, "RUNNING");
        assert.equal(game.drawnCount, 4);
        assert.equal(game.drawBagRemaining, 3);
        assert.equal(game.claimsCount, 1);
      } finally {
        await close();
      }
    });

    it("fail-soft hvis getRoomSnapshot kaster — beholder summary-felter", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({
          summaries: [{ code: "R", gameStatus: "RUNNING", playerCount: 3 }],
          snapshotThrowsForCode: "R",
        }),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { engineRoom: Record<string, unknown> };
        };
        assert.equal(body.data.engineRoom.exists, true);
        assert.equal(body.data.engineRoom.gameStatus, "RUNNING");
        assert.equal(body.data.engineRoom.playerCount, 3);
        assert.ok(body.data.engineRoom.snapshotError);
      } finally {
        await close();
      }
    });
  });

  describe("DB queries", () => {
    it("inkluderer scheduledGame når row finnes", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({
          scheduledRow: {
            id: "sg-1",
            status: "running",
            scheduled_start_time: new Date("2026-05-12T10:00:00.000Z"),
            scheduled_end_time: new Date("2026-05-12T11:00:00.000Z"),
            actual_start_time: new Date("2026-05-12T10:00:30.000Z"),
            actual_end_time: null,
            master_hall_id: "h-master",
            group_hall_id: "g-1",
            participating_halls_json: ["h-master", "h-other"],
            pause_reason: null,
            room_code: "R",
          },
        }),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { scheduledGame: Record<string, unknown> | null };
        };
        const sg = body.data.scheduledGame as Record<string, unknown>;
        assert.equal(sg.id, "sg-1");
        assert.equal(sg.status, "running");
        assert.equal(sg.masterHallId, "h-master");
        assert.equal(sg.actualEndTime, null);
      } finally {
        await close();
      }
    });

    it("scheduledGame=null når ingen row finnes", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { scheduledGame: unknown };
        };
        assert.equal(body.data.scheduledGame, null);
      } finally {
        await close();
      }
    });

    it("fail-soft hvis scheduled_games query kaster", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({ throwOnSql: "app_game1_scheduled_games" }),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          data: { scheduledGameError: unknown };
        };
        assert.ok(body.data.scheduledGameError);
      } finally {
        await close();
      }
    });

    it("inkluderer gameState når row finnes", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({
          gameStateRow: {
            scheduled_game_id: "sg-1",
            draws_completed: 42,
            current_phase: 3,
            last_drawn_ball: 75,
            last_drawn_at: new Date("2026-05-12T10:05:00.000Z"),
            paused: false,
            next_auto_draw_at: null,
            engine_started_at: new Date("2026-05-12T10:00:30.000Z"),
            engine_ended_at: null,
          },
        }),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { gameState: Record<string, unknown> | null };
        };
        const gs = body.data.gameState as Record<string, unknown>;
        assert.equal(gs.drawsCompleted, 42);
        assert.equal(gs.currentPhase, 3);
        assert.equal(gs.lastDrawnBall, 75);
        assert.equal(gs.paused, false);
      } finally {
        await close();
      }
    });
  });

  describe("socket-room-size", () => {
    it("returnerer 0 hvis rommet ikke finnes i adapter", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as { data: { socketRoomSize: number } };
        assert.equal(body.data.socketRoomSize, 0);
      } finally {
        await close();
      }
    });

    it("returnerer adapter-størrelsen", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({ R: 7 }),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as { data: { socketRoomSize: number } };
        assert.equal(body.data.socketRoomSize, 7);
      } finally {
        await close();
      }
    });
  });

  describe("stateVersion", () => {
    it("returnerer 0 hvis ingen emit har skjedd", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as { data: { stateVersion: number } };
        assert.equal(body.data.stateVersion, 0);
      } finally {
        await close();
      }
    });

    it("returnerer current() fra version-store", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({ R: 412 }),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as { data: { stateVersion: number } };
        assert.equal(body.data.stateVersion, 412);
      } finally {
        await close();
      }
    });
  });

  describe("diagnosis", () => {
    it("flagger ENGINE_DB_STATUS_MISMATCH når engine=RUNNING men db=completed", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({
          summaries: [{ code: "R", gameStatus: "RUNNING", playerCount: 1 }],
          snapshot: {
            code: "R",
            hostPlayerId: "p1",
            hallId: "h1",
            gameSlug: "bingo",
            createdAt: "2026-05-12T00:00:00.000Z",
            players: [],
            currentGame: {
              id: "g1",
              status: "RUNNING",
              drawnNumbers: [1, 2, 3],
              drawBag: [],
              startedAt: null,
              endedAt: null,
              endedReason: null,
              isPaused: false,
              pauseReason: null,
              pauseUntil: null,
              participatingPlayerIds: [],
              claims: [],
            },
          },
        }),
        pool: makeFakePool({
          scheduledRow: {
            id: "sg-1",
            status: "completed",
            scheduled_start_time: null,
            scheduled_end_time: null,
            actual_start_time: null,
            actual_end_time: null,
            master_hall_id: "h",
            group_hall_id: "g",
            participating_halls_json: [],
            pause_reason: null,
            room_code: "R",
          },
        }),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { diagnosis: { hasInconsistencies: boolean; inconsistencies: string[] } };
        };
        assert.equal(body.data.diagnosis.hasInconsistencies, true);
        assert.ok(
          body.data.diagnosis.inconsistencies.some((s) =>
            s.includes("ENGINE_DB_STATUS_MISMATCH"),
          ),
        );
      } finally {
        await close();
      }
    });

    it("flagger STALE_SOCKETS når engine=ENDED men sockets fortsatt connected", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({
          summaries: [{ code: "R", gameStatus: "ENDED", playerCount: 0 }],
          snapshot: {
            code: "R",
            hostPlayerId: "p1",
            hallId: "h1",
            gameSlug: "bingo",
            createdAt: "2026-05-12T00:00:00.000Z",
            players: [],
            currentGame: {
              id: "g1",
              status: "ENDED",
              drawnNumbers: [],
              drawBag: [],
              startedAt: null,
              endedAt: null,
              endedReason: null,
              isPaused: false,
              pauseReason: null,
              pauseUntil: null,
              participatingPlayerIds: [],
              claims: [],
            },
          },
        }),
        pool: makeFakePool({}),
        io: makeFakeIo({ R: 3 }),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { diagnosis: { hasInconsistencies: boolean; inconsistencies: string[] } };
        };
        assert.ok(
          body.data.diagnosis.inconsistencies.some((s) =>
            s.includes("STALE_SOCKETS"),
          ),
        );
      } finally {
        await close();
      }
    });

    it("ingen inconsistencies når alle kilder er konsistente", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { diagnosis: { hasInconsistencies: boolean } };
        };
        assert.equal(body.data.diagnosis.hasInconsistencies, false);
      } finally {
        await close();
      }
    });
  });

  describe("response shape", () => {
    it("inkluderer checkedAt ISO + checkedAtMs", async () => {
      const { baseUrl, close } = await startApp({
        engine: makeFakeEngine({}),
        pool: makeFakePool({}),
        io: makeFakeIo({}),
        roomStateVersionStore: makeFakeVersionStore({}),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/game-state-snapshot?roomCode=R&token=test-token`,
        );
        const body = (await res.json()) as {
          data: { checkedAt: string; checkedAtMs: number };
        };
        assert.ok(typeof body.data.checkedAt === "string");
        assert.ok(/\d{4}-\d{2}-\d{2}T/.test(body.data.checkedAt));
        assert.ok(typeof body.data.checkedAtMs === "number");
        assert.ok(body.data.checkedAtMs > 0);
      } finally {
        await close();
      }
    });
  });
});
