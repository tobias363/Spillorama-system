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

test("actorPlayerId fra hostPlayerId", async () => {
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
  assert.equal(drawCalls[0]!.actorPlayerId, "host-id-3");
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
