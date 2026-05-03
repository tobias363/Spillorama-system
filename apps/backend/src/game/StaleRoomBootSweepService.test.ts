/**
 * Tester for StaleRoomBootSweepService.
 *
 * Dekker (per Tobias-direktiv 2026-05-03):
 *   - Spill 2 (rocket): drawn=21 + RUNNING + endedReason=null → ende-es
 *   - Spill 3 (monsterbingo): drawn=75 + RUNNING + endedReason=null → ende-es
 *   - Allerede-endet: endedReason="G2_WINNER" → IKKE rør
 *   - Pågående: drawn<maxBalls → IKKE rør (legitim runde)
 *   - Annen slug (bingo/spillorama) → IKKE rør
 *   - Multi-rom: begge end-es i samme sweep
 *   - Status-filter: WAITING/ENDED/NONE → skip uten å bumpe inspected
 *   - Race: getRoomSnapshot kaster → logges som failure, fortsetter
 *   - Race: forceEndStaleRound returnerer false → noop, ikke failure
 *   - forceEndStaleRound kaster → failure, fortsetter
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  StaleRoomBootSweepService,
  type StaleRoomBootSweepEngine,
  type StaleRoomBootSweepLogger,
  STALE_ROUND_END_REASON,
  maxBallsForSlug,
} from "./StaleRoomBootSweepService.js";

// ── Test-helpers ────────────────────────────────────────────────────────────

interface FakeRoom {
  code: string;
  gameSlug?: string;
  gameStatus: "WAITING" | "RUNNING" | "ENDED" | "NONE";
  drawnNumbers?: number[];
  endedReason?: string;
}

interface FakeEngineState {
  rooms: FakeRoom[];
  forceEndCalls: Array<{ roomCode: string; endedReason: string }>;
  /** Map roomCode → forceEndStaleRound return-value override. Default true. */
  forceEndReturns?: Map<string, boolean>;
  /** Map roomCode → forceEndStaleRound throw override. */
  forceEndThrows?: Map<string, Error>;
  /** Set of roomCodes that should throw on getRoomSnapshot. */
  snapshotThrows?: Set<string>;
}

function makeEngine(state: FakeEngineState): StaleRoomBootSweepEngine {
  return {
    listRoomSummaries: () =>
      state.rooms.map((r) => ({
        code: r.code,
        gameSlug: r.gameSlug,
        gameStatus: r.gameStatus,
      })),
    getRoomSnapshot: (roomCode) => {
      if (state.snapshotThrows?.has(roomCode)) {
        throw new Error(`getRoomSnapshot blew up for ${roomCode}`);
      }
      const room = state.rooms.find((r) => r.code === roomCode);
      if (!room) throw new Error(`ROOM_NOT_FOUND: ${roomCode}`);
      const snap: ReturnType<StaleRoomBootSweepEngine["getRoomSnapshot"]> = {
        code: room.code,
        ...(room.gameSlug !== undefined ? { gameSlug: room.gameSlug } : {}),
      };
      if (room.gameStatus !== "NONE") {
        const game: NonNullable<typeof snap.currentGame> = {
          status: room.gameStatus,
          drawnNumbers: room.drawnNumbers ?? [],
          ...(room.endedReason !== undefined
            ? { endedReason: room.endedReason }
            : {}),
        };
        snap.currentGame = game;
      }
      return snap;
    },
    forceEndStaleRound: async (roomCode, endedReason) => {
      state.forceEndCalls.push({ roomCode, endedReason });
      const thrownErr = state.forceEndThrows?.get(roomCode);
      if (thrownErr) throw thrownErr;
      return state.forceEndReturns?.get(roomCode) ?? true;
    },
  };
}

function makeLogger(): {
  logger: StaleRoomBootSweepLogger;
  infos: Array<{ msg: string; meta?: Record<string, unknown> }>;
  warns: Array<{ msg: string; meta?: Record<string, unknown> }>;
  errors: Array<{ msg: string; meta?: Record<string, unknown> }>;
} {
  const infos: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const logger: StaleRoomBootSweepLogger = {
    info: (msg, meta) => infos.push({ msg, ...(meta ? { meta } : {}) }),
    warn: (msg, meta) => warns.push({ msg, ...(meta ? { meta } : {}) }),
    error: (msg, meta) => errors.push({ msg, ...(meta ? { meta } : {}) }),
  };
  return { logger, infos, warns, errors };
}

// ── maxBallsForSlug helper tests ─────────────────────────────────────────────

test("maxBallsForSlug — Spill 2 slugs return 21", () => {
  assert.equal(maxBallsForSlug("rocket"), 21);
  assert.equal(maxBallsForSlug("game_2"), 21);
  assert.equal(maxBallsForSlug("tallspill"), 21);
  assert.equal(maxBallsForSlug("ROCKET"), 21, "case-insensitive");
  assert.equal(maxBallsForSlug("  rocket  "), 21, "trim whitespace");
});

test("maxBallsForSlug — Spill 3 slugs return 75", () => {
  assert.equal(maxBallsForSlug("monsterbingo"), 75);
  assert.equal(maxBallsForSlug("mønsterbingo"), 75, "norsk ø-variant");
  assert.equal(maxBallsForSlug("game_3"), 75);
  assert.equal(maxBallsForSlug("MONSTERBINGO"), 75, "case-insensitive");
});

test("maxBallsForSlug — non-perpetual slugs return null", () => {
  assert.equal(maxBallsForSlug("bingo"), null, "Spill 1 not in scope");
  assert.equal(maxBallsForSlug("spillorama"), null, "SpinnGo not in scope");
  assert.equal(maxBallsForSlug("candy"), null);
  assert.equal(maxBallsForSlug(""), null);
  assert.equal(maxBallsForSlug(undefined), null);
});

// ── Sweep behaviour tests ────────────────────────────────────────────────────

test("sweep — Spill 2 ROCKET with 21/21 + RUNNING + endedReason=null is forced-ended", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger, infos } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, ["ROCKET"]);
  assert.deepEqual(result.noop, []);
  assert.deepEqual(result.failures, []);
  assert.equal(state.forceEndCalls.length, 1);
  assert.equal(state.forceEndCalls[0]!.roomCode, "ROCKET");
  assert.equal(state.forceEndCalls[0]!.endedReason, STALE_ROUND_END_REASON);
  assert.equal(state.forceEndCalls[0]!.endedReason, "BOOT_SWEEP_STALE_ROUND");
  // Verify info-log ble emittert per Tobias-direktiv:
  // "[boot-sweep] ended stale room ROCKET (drawn=21/21)"
  const endedLog = infos.find((i) => i.msg.includes("ended stale room ROCKET"));
  assert.ok(endedLog, `expected ended-log; got: ${infos.map((i) => i.msg).join(" | ")}`);
  assert.match(endedLog!.msg, /drawn=21\/21/);
});

test("sweep — Spill 3 MONSTERBINGO with 75/75 + RUNNING + endedReason=null is forced-ended", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "MONSTERBINGO",
        gameSlug: "monsterbingo",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger, infos } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, ["MONSTERBINGO"]);
  assert.equal(state.forceEndCalls.length, 1);
  assert.equal(state.forceEndCalls[0]!.roomCode, "MONSTERBINGO");
  const endedLog = infos.find((i) => i.msg.includes("ended stale room MONSTERBINGO"));
  assert.ok(endedLog);
  assert.match(endedLog!.msg, /drawn=75\/75/);
});

test("sweep — room with 21 draws BUT endedReason='G2_WINNER' is NOT touched", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
        endedReason: "G2_WINNER", // already-ended naturally
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  // Status="RUNNING" + slug match → inspected bump, men endedReason satt
  // → ingen forceEnd-call.
  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, []);
  assert.deepEqual(result.noop, []);
  assert.deepEqual(result.failures, []);
  assert.equal(state.forceEndCalls.length, 0, "must not call forceEndStaleRound");
});

test("sweep — Spill 2 room with <21 draws is NOT touched (legitimate ongoing round)", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 15 }, (_, i) => i + 1), // 15/21
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, []);
  assert.equal(state.forceEndCalls.length, 0);
});

test("sweep — Spill 3 room with 50/75 draws is NOT touched", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "MONSTERBINGO",
        gameSlug: "monsterbingo",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 50 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(state.forceEndCalls.length, 0);
});

test("sweep — Spill 1 (bingo) and SpinnGo (spillorama) rooms are NEVER touched", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "BINGO_HALL1",
        gameSlug: "bingo",
        gameStatus: "RUNNING",
        // Stuck-looking state: 75 drawn, no endedReason. Should still skip.
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
      {
        code: "SPILLORAMA_HALL1",
        gameSlug: "spillorama",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 60 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  // Slugs not in GAME2_SLUGS or GAME3_SLUGS → maxBallsForSlug returns null
  // → skip uten inspected-bump.
  assert.equal(result.inspected, 0);
  assert.deepEqual(result.ended, []);
  assert.equal(state.forceEndCalls.length, 0);
});

test("sweep — multi-room scenario: ROCKET + MONSTERBINGO both get ended", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "MONSTERBINGO",
        gameSlug: "monsterbingo",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 2);
  assert.deepEqual(result.ended.sort(), ["MONSTERBINGO", "ROCKET"]);
  assert.equal(state.forceEndCalls.length, 2);
  const calledRooms = state.forceEndCalls.map((c) => c.roomCode).sort();
  assert.deepEqual(calledRooms, ["MONSTERBINGO", "ROCKET"]);
  // Begge skal få samme endedReason.
  assert.ok(state.forceEndCalls.every((c) => c.endedReason === STALE_ROUND_END_REASON));
});

test("sweep — non-RUNNING status (WAITING/ENDED/NONE) is skipped", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET_WAITING",
        gameSlug: "rocket",
        gameStatus: "WAITING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "ROCKET_ENDED",
        gameSlug: "rocket",
        gameStatus: "ENDED",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "ROCKET_NONE",
        gameSlug: "rocket",
        gameStatus: "NONE",
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  // Filter på listRoomSummaries.gameStatus === "RUNNING" → ingen av disse
  // teller som inspected.
  assert.equal(result.inspected, 0);
  assert.deepEqual(result.ended, []);
  assert.equal(state.forceEndCalls.length, 0);
});

test("sweep — getRoomSnapshot throw is captured as failure, sweep continues", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET_BAD",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "ROCKET_GOOD",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
    snapshotThrows: new Set(["ROCKET_BAD"]),
  };
  const { logger, warns } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  // BAD-rommet teller som inspected (vi nådde getRoomSnapshot-stedet)
  // og resulterer i failure. GOOD-rommet ende-es normalt.
  assert.equal(result.inspected, 2);
  assert.deepEqual(result.ended, ["ROCKET_GOOD"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.roomCode, "ROCKET_BAD");
  assert.match(result.failures[0]!.error, /getRoomSnapshot failed/);
  assert.ok(warns.some((w) => w.msg.includes("getRoomSnapshot failed")));
  // GOOD-room fikk forceEnd-call
  assert.equal(state.forceEndCalls.length, 1);
  assert.equal(state.forceEndCalls[0]!.roomCode, "ROCKET_GOOD");
});

test("sweep — forceEndStaleRound returning false is recorded as noop, not failure", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
    forceEndReturns: new Map([["ROCKET", false]]),
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, []);
  assert.deepEqual(result.noop, ["ROCKET"]);
  assert.deepEqual(result.failures, []);
});

test("sweep — forceEndStaleRound throw is captured as failure, sweep continues", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET_THROW",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "ROCKET_OK",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
    forceEndThrows: new Map([
      ["ROCKET_THROW", new Error("bingoAdapter.onGameEnded blew up")],
    ]),
  };
  const { logger, errors } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 2);
  assert.deepEqual(result.ended, ["ROCKET_OK"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.roomCode, "ROCKET_THROW");
  assert.match(result.failures[0]!.error, /forceEndStaleRound failed.*onGameEnded/);
  assert.ok(errors.some((e) => e.msg.includes("forceEndStaleRound failed")));
});

test("sweep — empty engine (no rooms) returns clean result, no logs", async () => {
  const state: FakeEngineState = {
    rooms: [],
    forceEndCalls: [],
  };
  const { logger, infos, warns, errors } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 0);
  assert.deepEqual(result.ended, []);
  assert.deepEqual(result.failures, []);
  // Ingen logging når ingen Spill 2/3-rom finnes (bevisst støy-reduksjon).
  assert.equal(infos.length, 0);
  assert.equal(warns.length, 0);
  assert.equal(errors.length, 0);
});

test("sweep — listRoomSummaries throw aborts sweep cleanly without crashing", async () => {
  const engine: StaleRoomBootSweepEngine = {
    listRoomSummaries: () => {
      throw new Error("engine borked at boot");
    },
    getRoomSnapshot: () => {
      throw new Error("should not be reached");
    },
    forceEndStaleRound: async () => {
      throw new Error("should not be reached");
    },
  };
  const { logger, errors } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine, logger });
  const result = await service.sweep();

  // Aldri kaster — returnerer tom result og logger error.
  assert.equal(result.inspected, 0);
  assert.deepEqual(result.ended, []);
  assert.ok(errors.some((e) => e.msg.includes("listRoomSummaries failed")));
});

test("sweep — slug variants (game_2, tallspill, mønsterbingo) all match", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET_LEGACY",
        gameSlug: "game_2",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "TALLSPILL_HALL",
        gameSlug: "tallspill",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
      {
        code: "MONSTER_NORSK",
        gameSlug: "mønsterbingo",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
      {
        code: "GAME_3_LEGACY",
        gameSlug: "game_3",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 4);
  assert.equal(result.ended.length, 4);
  assert.equal(state.forceEndCalls.length, 4);
});

test("sweep — RUNNING with drawn=20 (one short of max) is NOT touched", async () => {
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 20 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, []);
  assert.equal(state.forceEndCalls.length, 0);
});

test("sweep — RUNNING with drawn>maxBalls (e.g. 22 from corrupt state) is still ended", async () => {
  // Defensiv: hvis state er korrupt (drawnNumbers > maxBalls pga bug),
  // skal sweepen fortsatt rydde — `>=` er hovedkriteriet.
  const state: FakeEngineState = {
    rooms: [
      {
        code: "ROCKET",
        gameSlug: "rocket",
        gameStatus: "RUNNING",
        drawnNumbers: Array.from({ length: 22 }, (_, i) => i + 1),
      },
    ],
    forceEndCalls: [],
  };
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });
  const result = await service.sweep();

  assert.equal(result.inspected, 1);
  assert.deepEqual(result.ended, ["ROCKET"]);
  assert.equal(state.forceEndCalls.length, 1);
});

test("sweep — idempotent: second sweep finds nothing after first ended a room", async () => {
  // Simuler at engine etter første sweep har endedReason satt
  // (forceEndStaleRound mutered state). Andre sweep skal være no-op.
  const rooms: FakeRoom[] = [
    {
      code: "ROCKET",
      gameSlug: "rocket",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
    },
  ];
  const state: FakeEngineState = {
    rooms,
    forceEndCalls: [],
  };
  // Etter første sweep oppdaterer vi rommet manuelt (mimicking engine
  // mutation av currentGame.endedReason).
  const { logger } = makeLogger();
  const service = new StaleRoomBootSweepService({ engine: makeEngine(state), logger });

  const first = await service.sweep();
  assert.equal(first.ended.length, 1);
  assert.equal(state.forceEndCalls.length, 1);

  // Mutate state to simulate engine-side update
  rooms[0]!.endedReason = STALE_ROUND_END_REASON;

  const second = await service.sweep();
  assert.equal(second.ended.length, 0);
  assert.equal(state.forceEndCalls.length, 1, "no second forceEnd call");
});
