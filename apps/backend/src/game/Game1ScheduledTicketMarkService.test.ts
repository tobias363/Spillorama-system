import assert from "node:assert/strict";
import test from "node:test";
import { Game1ScheduledTicketMarkService } from "./Game1ScheduledTicketMarkService.js";
import type { BingoEngine } from "./BingoEngine.js";
import type { RoomSnapshot } from "./types.js";

class FakePool {
  status = "running";
  draws: number[] = [39];
  drawBag: number[] = [39, 40];
  drawsCompleted = 1;
  assignmentGrids: number[][] = [[39, 1, 2, 3, 4]];
  queries: string[] = [];

  async query<T>(sql: string): Promise<{ rows: T[] }> {
    this.queries.push(sql);
    if (sql.includes("app_game1_scheduled_games")) {
      return {
        rows: [
          {
            status: this.status,
            draw_bag_json: this.drawBag,
            draws_completed: this.drawsCompleted,
          },
        ] as T[],
      };
    }
    if (sql.includes("app_game1_draws")) {
      return {
        rows: this.draws.map((ball_value) => ({ ball_value })) as T[],
      };
    }
    if (sql.includes("app_game1_ticket_assignments")) {
      return {
        rows: this.assignmentGrids.map((grid_numbers_json) => ({
          grid_numbers_json,
        })) as T[],
      };
    }
    throw new Error(`Unhandled SQL in fake pool: ${sql}`);
  }
}

function roomSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "BINGO_DEMO_PILOT_GOH",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    scheduledGameId: "scheduled-game-1",
    createdAt: new Date("2026-05-17T10:00:00.000Z").toISOString(),
    players: [{ id: "p1", name: "Player 1", walletId: "wallet-1", balance: 0 }],
    gameHistory: [],
    ...overrides,
  } as RoomSnapshot;
}

function makeService(pool: FakePool, snapshot: RoomSnapshot = roomSnapshot()): Game1ScheduledTicketMarkService {
  return new Game1ScheduledTicketMarkService({
    pool: pool as never,
    engine: {
      getRoomSnapshot: () => snapshot,
    } as unknown as BingoEngine,
    schema: "public",
    cacheTtlMs: 10_000,
  });
}

test("validate returns false for non-scheduled rooms so legacy path can handle them", async () => {
  const pool = new FakePool();
  const service = makeService(pool, roomSnapshot({ scheduledGameId: null }));

  const handled = await service.validate({
    roomCode: "ROOM-LEGACY",
    playerId: "p1",
    number: 39,
  });

  assert.equal(handled, false);
  assert.equal(pool.queries.length, 0);
});

test("validate accepts drawn scheduled Spill 1 number on player's ticket", async () => {
  const pool = new FakePool();
  const service = makeService(pool);

  const handled = await service.validate({
    roomCode: "BINGO_DEMO_PILOT_GOH",
    playerId: "p1",
    number: 39,
  });

  assert.equal(handled, true);
});

test("validate caches scheduled game draw state and per-player ticket numbers", async () => {
  const pool = new FakePool();
  const service = makeService(pool);

  await service.validate({ roomCode: "BINGO_DEMO_PILOT_GOH", playerId: "p1", number: 39 });
  await service.validate({ roomCode: "BINGO_DEMO_PILOT_GOH", playerId: "p1", number: 39 });

  assert.equal(
    pool.queries.filter((sql) => sql.includes("app_game1_ticket_assignments")).length,
    1,
  );
  assert.equal(
    pool.queries.filter((sql) => sql.includes("app_game1_draws")).length,
    1,
  );
});

test("validate refreshes draw cache once before rejecting undrawn number", async () => {
  const pool = new FakePool();
  const service = makeService(pool);

  await assert.rejects(
    () => service.validate({ roomCode: "BINGO_DEMO_PILOT_GOH", playerId: "p1", number: 40 }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "NUMBER_NOT_DRAWN");
      return true;
    },
  );
  assert.equal(
    pool.queries.filter((sql) => sql.includes("app_game1_draws")).length,
    2,
  );
});

test("validate rejects drawn number not present on player's tickets", async () => {
  const pool = new FakePool();
  pool.draws = [39, 40];
  pool.drawBag = [39, 40];
  pool.drawsCompleted = 2;
  const service = makeService(pool);

  await assert.rejects(
    () => service.validate({ roomCode: "BINGO_DEMO_PILOT_GOH", playerId: "p1", number: 40 }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "NUMBER_NOT_ON_TICKET");
      return true;
    },
  );
});
