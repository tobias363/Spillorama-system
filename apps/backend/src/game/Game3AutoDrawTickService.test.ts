/**
 * Tester for Game3AutoDrawTickService.
 *
 * Symmetrisk med Game2AutoDrawTickService.test.ts. Viktigste forskjeller:
 *   - Slug-filter: monsterbingo / mønsterbingo / game_3.
 *   - Maks-baller: 75 (vs Spill 2 sine 21).
 *   - Spill 1 (bingo) og Spill 2 (rocket) MÅ IKKE trigges.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game3AutoDrawTickService } from "./Game3AutoDrawTickService.js";
import type { AutoDrawEngine } from "./Game2AutoDrawTickService.js";
import { DomainError } from "../errors/DomainError.js";

interface FakeRoom {
  code: string;
  hostPlayerId: string;
  gameSlug?: string;
  gameStatus: "WAITING" | "RUNNING" | "ENDED" | "NONE";
  drawnNumbers?: number[];
}

function makeEngine(
  rooms: FakeRoom[],
  opts: { throwOnRoomCode?: Map<string, Error> } = {}
): {
  engine: AutoDrawEngine;
  drawCalls: Array<{ roomCode: string; actorPlayerId: string }>;
} {
  const drawCalls: Array<{ roomCode: string; actorPlayerId: string }> = [];
  const engine: AutoDrawEngine = {
    listRoomSummaries: () =>
      rooms.map((r) => ({
        code: r.code,
        gameSlug: r.gameSlug,
        gameStatus: r.gameStatus,
      })),
    getRoomSnapshot: (roomCode: string) => {
      const room = rooms.find((r) => r.code === roomCode);
      if (!room) throw new Error(`room ${roomCode} not found`);
      // Tobias 2026-05-04 (host-fallback fix, Game3AutoDrawTickService.ts):
      // tick-en henter `snapshot.players` for å sjekke om host fortsatt er
      // i rommet. Dersom listen er tom hopper tick-en over uten å trigge
      // draw, så hvert mock-rom må ha minst én spiller (hosten).
      return {
        code: room.code,
        hostPlayerId: room.hostPlayerId,
        gameSlug: room.gameSlug,
        players: [{ id: room.hostPlayerId }],
        currentGame:
          room.gameStatus === "NONE"
            ? undefined
            : {
                status: room.gameStatus,
                drawnNumbers: room.drawnNumbers ?? [],
              },
      };
    },
    drawNextNumber: async (input) => {
      drawCalls.push(input);
      const err = opts.throwOnRoomCode?.get(input.roomCode);
      if (err) throw err;
      const room = rooms.find((r) => r.code === input.roomCode);
      const drawn = room?.drawnNumbers?.length ?? 0;
      return { number: drawn + 1, drawIndex: drawn, gameId: `g-${input.roomCode}` };
    },
  };
  return { engine, drawCalls };
}

// ── Slug-filter ─────────────────────────────────────────────────────────────

test("slug-filter: kun Spill 3 (monsterbingo/mønsterbingo/game_3) triggeres — Spill 1 (bingo) og Spill 2 (rocket) ignoreres", async () => {
  const { engine, drawCalls } = makeEngine([
    // Spill 3 — skal trigges
    { code: "MB-1", hostPlayerId: "h1", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    { code: "MB-2", hostPlayerId: "h2", gameSlug: "mønsterbingo", gameStatus: "RUNNING" },
    { code: "MB-3", hostPlayerId: "h3", gameSlug: "game_3", gameStatus: "RUNNING" },
    // Spill 1 — skal IKKE trigges
    { code: "BINGO-X", hostPlayerId: "hx", gameSlug: "bingo", gameStatus: "RUNNING", drawnNumbers: [1, 2] },
    // Spill 2 — skal IKKE trigges
    { code: "ROCKET-Y", hostPlayerId: "hy", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 3);
  assert.equal(r.drawsTriggered, 3);
  const triggeredCodes = drawCalls.map((c) => c.roomCode).sort();
  assert.deepEqual(triggeredCodes, ["MB-1", "MB-2", "MB-3"]);
  assert.ok(!triggeredCodes.includes("BINGO-X"), "Spill 1 (bingo) må ikke trigges");
  assert.ok(!triggeredCodes.includes("ROCKET-Y"), "Spill 2 (rocket) må ikke trigges");
});

test("slug-filter: case-insensitivt — MONSTERBINGO, Monsterbingo, mOnStErBiNgO alle aksepteres", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "M1", hostPlayerId: "h1", gameSlug: "MONSTERBINGO", gameStatus: "RUNNING" },
    { code: "M2", hostPlayerId: "h2", gameSlug: "Monsterbingo", gameStatus: "RUNNING" },
    { code: "M3", hostPlayerId: "h3", gameSlug: "mOnStErBiNgO", gameStatus: "RUNNING" },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 3);
  assert.equal(r.drawsTriggered, 3);
  assert.equal(drawCalls.length, 3);
});

// ── Maks-baller ─────────────────────────────────────────────────────────────

test("max-baller: drawnNumbers.length >= 75 → skipped", async () => {
  const { engine, drawCalls } = makeEngine([
    {
      code: "FULL",
      hostPlayerId: "h",
      gameSlug: "monsterbingo",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
    },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(r.skipped, 1);
  assert.equal(drawCalls.length, 0);
});

test("max-baller: 74 drawn → trigges fortsatt (1 plass igjen)", async () => {
  const { engine, drawCalls } = makeEngine([
    {
      code: "ALMOST",
      hostPlayerId: "h",
      gameSlug: "monsterbingo",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 74 }, (_, i) => i + 1),
    },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
});

test("max-baller: 21 drawn (Spill 2-grense) → fortsatt trigges for Spill 3 (75-grense)", async () => {
  // Regresjon-vakt: hvis vi ved et uhell brukte Spill 2-grensen (21) for
  // Spill 3, ville denne testen krasje.
  const { engine, drawCalls } = makeEngine([
    {
      code: "S3-AT-21",
      hostPlayerId: "h",
      gameSlug: "monsterbingo",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
    },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
});

// ── Status-filter ───────────────────────────────────────────────────────────

test("status-filter: kun RUNNING trigges", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "WAIT", hostPlayerId: "h1", gameSlug: "monsterbingo", gameStatus: "WAITING" },
    { code: "RUN", hostPlayerId: "h2", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    { code: "DONE", hostPlayerId: "h3", gameSlug: "monsterbingo", gameStatus: "ENDED" },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls[0]!.roomCode, "RUN");
});

// ── Throttle ────────────────────────────────────────────────────────────────

test("throttle: andre tick innen drawIntervalMs → skipped", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "R", hostPlayerId: "h", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 60_000 });
  await service.tick();
  const r2 = await service.tick();
  assert.equal(r2.drawsTriggered, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(drawCalls.length, 1);
});

// ── Race-feil ───────────────────────────────────────────────────────────────

test("race-feil DRAW_TOO_SOON / NO_MORE_NUMBERS / GAME_PAUSED → skipped, ikke errors", async () => {
  for (const code of ["DRAW_TOO_SOON", "NO_MORE_NUMBERS", "GAME_PAUSED", "GAME_ENDED", "GAME_NOT_RUNNING"]) {
    const { engine } = makeEngine(
      [{ code: "R", hostPlayerId: "h", gameSlug: "monsterbingo", gameStatus: "RUNNING" }],
      { throwOnRoomCode: new Map([["R", new DomainError(code, "race")]]) }
    );
    const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
    const r = await service.tick();
    assert.equal(r.errors, 0, `${code} skal ikke regnes som error`);
    assert.equal(r.skipped, 1);
  }
});

test("ukjent feil: telt som errors, ikke fatal", async () => {
  const { engine } = makeEngine(
    [
      { code: "F", hostPlayerId: "h1", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
      { code: "OK", hostPlayerId: "h2", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    { throwOnRoomCode: new Map([["F", new Error("uventet")]]) }
  );
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 1);
  assert.equal(r.drawsTriggered, 1);
});

// ── Edge case ──────────────────────────────────────────────────────────────

test("ingen rom: 0 telles", async () => {
  const { engine } = makeEngine([]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 0);
  assert.equal(r.drawsTriggered, 0);
});

test("actorPlayerId settes til SYSTEM_ACTOR_ID (audit §2.6)", async () => {
  // Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.6):
  // identisk pattern som Game2AutoDrawTickService — auto-draw er
  // server-driven, ikke spiller-handling.
  const { engine, drawCalls } = makeEngine([
    {
      code: "R",
      hostPlayerId: "host-id-3",
      gameSlug: "monsterbingo",
      gameStatus: "RUNNING",
    },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  await service.tick();
  assert.equal(drawCalls[0]!.actorPlayerId, "__system_actor__");
});

// ── Tobias-bug-fix 2026-05-04: broadcaster wires `draw:new` + room:update ─

test("broadcaster: kalles for HVERT vellykket draw med korrekt event-shape", async () => {
  // Speiler Game2-testen — uten broadcaster så server-state korrekt nye
  // tall, men spiller-UI sto fast på "Trekk: 00/75" for monsterbingo.
  const { engine } = makeEngine([
    { code: "M1", hostPlayerId: "h1", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    { code: "M2", hostPlayerId: "h2", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
  ]);
  const broadcasterCalls: Array<{
    roomCode: string;
    number: number;
    drawIndex: number;
    gameId: string;
  }> = [];
  const service = new Game3AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    broadcaster: {
      onDrawCompleted: (input) => {
        broadcasterCalls.push(input);
      },
    },
  });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 2);
  assert.equal(broadcasterCalls.length, 2);
  assert.deepEqual(broadcasterCalls.map((c) => c.roomCode).sort(), ["M1", "M2"]);
  for (const call of broadcasterCalls) {
    assert.ok(typeof call.number === "number" && Number.isFinite(call.number));
    assert.ok(typeof call.drawIndex === "number" && Number.isFinite(call.drawIndex));
    assert.ok(typeof call.gameId === "string" && call.gameId.length > 0);
  }
});

test("broadcaster: IKKE kalt når draw-en feiler", async () => {
  const { engine } = makeEngine(
    [
      { code: "M", hostPlayerId: "h", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    {
      throwOnRoomCode: new Map([
        ["M", new DomainError("NO_MORE_NUMBERS", "tom drawBag")],
      ]),
    }
  );
  let broadcasterCalled = false;
  const service = new Game3AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    broadcaster: {
      onDrawCompleted: () => {
        broadcasterCalled = true;
      },
    },
  });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 0);
  assert.equal(r.skipped, 1);
  assert.equal(broadcasterCalled, false);
});

test("broadcaster: kast i onDrawCompleted krasjer IKKE tick + teller ikke som error", async () => {
  const { engine } = makeEngine([
    { code: "M", hostPlayerId: "h", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    { code: "OK", hostPlayerId: "h2", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
  ]);
  let okCalled = false;
  const service = new Game3AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    broadcaster: {
      onDrawCompleted: (input) => {
        if (input.roomCode === "M") throw new Error("broadcaster boom");
        okCalled = true;
      },
    },
  });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 2);
  assert.equal(r.errors, 0);
  assert.equal(okCalled, true);
});

test("broadcaster: ikke injected → tick kjører uten emit (legacy-fallback)", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "M", hostPlayerId: "h", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
});

// ── 2026-05-06 (audit §5.1): stuck-room auto-recovery — paritet med PR #876 ─

test("stuck-room recovery: drawn=75 + status=RUNNING + forceEndStaleRound wired → ender + callback fyrer", async () => {
  // Replikerer prod-bug-mønsteret for monsterbingo: rom på status=RUNNING med
  // 75 baller trukket, men endedReason=null. Med forceEndStaleRound-callback
  // wired skal tick-en force-ende rommet OG kalle onStaleRoomEnded så
  // perpetual-loopen kan spawne ny runde.
  const forceEndCalls: Array<{ roomCode: string; reason: string }> = [];
  const onStaleCalls: string[] = [];
  const drawCalls: Array<{ roomCode: string; actorPlayerId: string }> = [];

  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "MB", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "MB",
      hostPlayerId: "host",
      gameSlug: "monsterbingo",
      players: [{ id: "host" }],
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async (input) => {
      drawCalls.push(input);
      return { number: 76, drawIndex: 75, gameId: "g" };
    },
    forceEndStaleRound: async (roomCode, reason) => {
      forceEndCalls.push({ roomCode, reason });
      return true;
    },
  };

  const service = new Game3AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    onStaleRoomEnded: async (roomCode) => {
      onStaleCalls.push(roomCode);
    },
  });
  const r = await service.tick();

  assert.equal(drawCalls.length, 0, "stuck rom skal IKKE trigge drawNextNumber");
  assert.equal(forceEndCalls.length, 1);
  assert.equal(forceEndCalls[0]!.roomCode, "MB");
  assert.equal(forceEndCalls[0]!.reason, "STUCK_AT_MAX_BALLS_AUTO_RECOVERY");
  assert.equal(onStaleCalls.length, 1);
  assert.equal(onStaleCalls[0], "MB");
  assert.equal(r.skipped, 1, "stuck rom telles fortsatt som skipped (bevart obs)");
  assert.deepEqual(r.staleRoomsEnded, ["MB"]);
});

test("stuck-room recovery: forceEndStaleRound MANGLER på engine → faller til legacy skip-only", async () => {
  // Backward-compat: fake-engine i eksisterende tester har ikke
  // forceEndStaleRound. Da skal vi bare skippe (gammel oppførsel).
  const { engine, drawCalls } = makeEngine([
    {
      code: "FULL",
      hostPlayerId: "h",
      gameSlug: "monsterbingo",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
    },
  ]);
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.skipped, 1);
  assert.equal(drawCalls.length, 0);
  assert.equal(r.staleRoomsEnded, undefined);
});

test("stuck-room recovery: forceEndStaleRound returnerer false (allerede endet) → ingen callback", async () => {
  let forceEndCallCount = 0;
  let onStaleCallCount = 0;
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "MB", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "MB",
      hostPlayerId: "host",
      gameSlug: "monsterbingo",
      players: [{ id: "host" }],
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async () => {
      throw new Error("should not be called");
    },
    forceEndStaleRound: async () => {
      forceEndCallCount++;
      return false; // no-op (e.g., room already had endedReason)
    },
  };
  const service = new Game3AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    onStaleRoomEnded: async () => {
      onStaleCallCount++;
    },
  });
  const r = await service.tick();
  assert.equal(forceEndCallCount, 1);
  assert.equal(onStaleCallCount, 0, "callback skal ikke fyre når force-end returnerer false");
  assert.equal(r.staleRoomsEnded, undefined);
});

test("stuck-room recovery: forceEndStaleRound kaster → telles som error, krasjer ikke tick", async () => {
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "MB", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "MB",
      hostPlayerId: "host",
      gameSlug: "monsterbingo",
      players: [{ id: "host" }],
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async () => {
      throw new Error("not called");
    },
    forceEndStaleRound: async () => {
      throw new Error("forceEnd boom");
    },
  };
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 1);
  assert.ok(r.errorMessages?.[0]?.includes("forceEndStaleRound failed"));
});

test("stuck-room recovery: callback-feil i onStaleRoomEnded krasjer ikke tick + telles ikke som error", async () => {
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "MB", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "MB",
      hostPlayerId: "host",
      gameSlug: "monsterbingo",
      players: [{ id: "host" }],
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async () => {
      throw new Error("not called");
    },
    forceEndStaleRound: async () => true,
  };
  const service = new Game3AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    onStaleRoomEnded: async () => {
      throw new Error("callback boom");
    },
  });
  const r = await service.tick();
  assert.equal(r.errors, 0, "callback-feil teller ikke som engine-error");
  assert.deepEqual(r.staleRoomsEnded, ["MB"]);
});

test("stuck-room recovery: drawn=74 → IKKE recovery (under threshold), trigge normal draw", async () => {
  // Regresjon-vakt: kun rom med drawnNumbers >= 75 skal trigge recovery.
  // Rom på 74 har 1 ball igjen — normal draw-flyt.
  const forceEndCalls: string[] = [];
  const drawCalls: Array<{ roomCode: string }> = [];

  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "MB", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "MB",
      hostPlayerId: "host",
      gameSlug: "monsterbingo",
      players: [{ id: "host" }],
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 74 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async (input) => {
      drawCalls.push({ roomCode: input.roomCode });
      return { number: 75, drawIndex: 74, gameId: "g" };
    },
    forceEndStaleRound: async (roomCode) => {
      forceEndCalls.push(roomCode);
      return true;
    },
  };
  const service = new Game3AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(drawCalls.length, 1, "draw skal kjøre normalt på 74 baller");
  assert.equal(forceEndCalls.length, 0, "forceEndStaleRound skal IKKE kalles på 74 baller");
  assert.equal(r.staleRoomsEnded, undefined);
});
