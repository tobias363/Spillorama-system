/**
 * Tester for Game2AutoDrawTickService.
 *
 * Dekker:
 *   - Slug-filter: kun rocket / game_2 / tallspill triggeres; bingo
 *     (Spill 1) og monsterbingo (Spill 3) ignoreres.
 *   - Status-filter: kun "RUNNING" rom triggeres; "WAITING"/"ENDED"/"NONE"
 *     skipper.
 *   - Maks-baller: drawnNumbers.length >= 21 → skip (engine ville kastet
 *     NO_MORE_NUMBERS).
 *   - Throttle: andre tick innen drawIntervalMs → skip.
 *   - Race-feil (DRAW_TOO_SOON, NO_MORE_NUMBERS, GAME_PAUSED) → skipped,
 *     ikke errors.
 *   - drawNextNumber-feil utenfor whitelist → errors+1, ikke krasj.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game2AutoDrawTickService,
  type AutoDrawEngine,
} from "./Game2AutoDrawTickService.js";
import { DomainError } from "../errors/DomainError.js";

// ── Test-helpers ────────────────────────────────────────────────────────────

interface FakeRoom {
  code: string;
  hostPlayerId: string;
  gameSlug?: string;
  gameStatus: "WAITING" | "RUNNING" | "ENDED" | "NONE";
  drawnNumbers?: number[];
}

function makeEngine(
  rooms: FakeRoom[],
  opts: {
    throwOnRoomCode?: Map<string, Error>;
    throwOnSnapshot?: Set<string>;
  } = {}
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
      if (opts.throwOnSnapshot?.has(roomCode)) {
        throw new Error(`snapshot-fail for ${roomCode}`);
      }
      const room = rooms.find((r) => r.code === roomCode);
      if (!room) throw new Error(`room ${roomCode} not found`);
      return {
        code: room.code,
        hostPlayerId: room.hostPlayerId,
        gameSlug: room.gameSlug,
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

test("slug-filter: kun Spill 2-rom (rocket/game_2/tallspill) triggeres — Spill 1 (bingo) og Spill 3 (monsterbingo) ignoreres", async () => {
  const { engine, drawCalls } = makeEngine([
    // Spill 2 — skal trigges
    { code: "ROCKET-1", hostPlayerId: "host-1", gameSlug: "rocket", gameStatus: "RUNNING" },
    { code: "GAME2-2", hostPlayerId: "host-2", gameSlug: "game_2", gameStatus: "RUNNING" },
    { code: "TALL-3", hostPlayerId: "host-3", gameSlug: "tallspill", gameStatus: "RUNNING" },
    // Spill 1 — skal IKKE trigges (kjøres av Game1AutoDrawTickService)
    { code: "BINGO-X", hostPlayerId: "host-x", gameSlug: "bingo", gameStatus: "RUNNING", drawnNumbers: [1, 2] },
    // Spill 3 — skal IKKE trigges (kjøres av Game3AutoDrawTickService)
    { code: "MONSTER-Y", hostPlayerId: "host-y", gameSlug: "monsterbingo", gameStatus: "RUNNING" },
    // Ukjent slug — skal IKKE trigges
    { code: "MYSTERY-Z", hostPlayerId: "host-z", gameSlug: "spillorama", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 3, "kun de 3 Spill 2-rommene skal telles som checked");
  assert.equal(r.drawsTriggered, 3);
  const triggeredCodes = drawCalls.map((c) => c.roomCode).sort();
  assert.deepEqual(triggeredCodes, ["GAME2-2", "ROCKET-1", "TALL-3"]);
  // Eksplisitt: Spill 1 og Spill 3 SKAL IKKE være kalt.
  assert.ok(!triggeredCodes.includes("BINGO-X"), "Spill 1 (bingo) må ikke trigges");
  assert.ok(!triggeredCodes.includes("MONSTER-Y"), "Spill 3 (monsterbingo) må ikke trigges");
});

test("slug-filter: case-insensitivt match — ROCKET, Rocket, rOcKeT alle aksepteres", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "R1", hostPlayerId: "h1", gameSlug: "ROCKET", gameStatus: "RUNNING" },
    { code: "R2", hostPlayerId: "h2", gameSlug: "Rocket", gameStatus: "RUNNING" },
    { code: "R3", hostPlayerId: "h3", gameSlug: "rOcKeT", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 3);
  assert.equal(r.drawsTriggered, 3);
  assert.equal(drawCalls.length, 3);
});

test("slug-filter: tom/manglende gameSlug ignoreres", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "NO-SLUG", hostPlayerId: "h1", gameStatus: "RUNNING" },
    { code: "EMPTY", hostPlayerId: "h2", gameSlug: "", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 0);
  assert.equal(drawCalls.length, 0);
});

// ── Status-filter ───────────────────────────────────────────────────────────

test("status-filter: WAITING/ENDED/NONE skip — kun RUNNING trigges", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "WAIT", hostPlayerId: "h1", gameSlug: "rocket", gameStatus: "WAITING" },
    { code: "RUN", hostPlayerId: "h2", gameSlug: "rocket", gameStatus: "RUNNING" },
    { code: "DONE", hostPlayerId: "h3", gameSlug: "rocket", gameStatus: "ENDED" },
    { code: "NONE", hostPlayerId: "h4", gameSlug: "rocket", gameStatus: "NONE" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 1, "kun det RUNNING-rommet skal være checked");
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0]!.roomCode, "RUN");
});

// ── Max baller ──────────────────────────────────────────────────────────────

test("max-baller: drawnNumbers.length >= 21 → skipped, ikke kall til drawNextNumber", async () => {
  const { engine, drawCalls } = makeEngine([
    {
      code: "FULL",
      hostPlayerId: "h",
      gameSlug: "rocket",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
    },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(r.skipped, 1);
  assert.equal(drawCalls.length, 0);
});

test("max-baller: 20 drawn + 1 plass igjen → trigges fortsatt", async () => {
  const { engine, drawCalls } = makeEngine([
    {
      code: "ALMOST",
      hostPlayerId: "h",
      gameSlug: "rocket",
      gameStatus: "RUNNING",
      drawnNumbers: Array.from({ length: 20 }, (_, i) => i + 1),
    },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
});

// ── Throttle ────────────────────────────────────────────────────────────────

test("throttle: andre tick innen drawIntervalMs → skipped, ingen ny draw-kall", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 60_000 });
  const r1 = await service.tick();
  assert.equal(r1.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
  // Andre tick umiddelbart — throttle skal blokkere.
  const r2 = await service.tick();
  assert.equal(r2.drawsTriggered, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(drawCalls.length, 1, "drawNextNumber skal ikke kalles igjen");
});

test("throttle: drawIntervalMs=0 → ingen throttle, hver tick trigger draw", async () => {
  const { engine, drawCalls } = makeEngine([
    { code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  await service.tick();
  await service.tick();
  await service.tick();
  assert.equal(drawCalls.length, 3);
});

// ── Race-feil (DRAW_TOO_SOON / NO_MORE_NUMBERS / GAME_PAUSED) ───────────────

test("race-feil DRAW_TOO_SOON: telt som skipped, ikke errors", async () => {
  const { engine } = makeEngine(
    [{ code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" }],
    {
      throwOnRoomCode: new Map([
        ["R", new DomainError("DRAW_TOO_SOON", "for tidlig")],
      ]),
    }
  );
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 0);
  assert.equal(r.skipped, 1);
});

test("race-feil NO_MORE_NUMBERS: telt som skipped", async () => {
  const { engine } = makeEngine(
    [{ code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" }],
    {
      throwOnRoomCode: new Map([
        ["R", new DomainError("NO_MORE_NUMBERS", "tom drawBag")],
      ]),
    }
  );
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 0);
  assert.equal(r.skipped, 1);
});

test("race-feil GAME_PAUSED: telt som skipped", async () => {
  const { engine } = makeEngine(
    [{ code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" }],
    {
      throwOnRoomCode: new Map([["R", new DomainError("GAME_PAUSED", "paused")]]),
    }
  );
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 0);
  assert.equal(r.skipped, 1);
});

// ── Ekte feil (utenfor whitelist) ──────────────────────────────────────────

test("ukjent feil: telt som errors, blokkerer ikke andre rom", async () => {
  const { engine, drawCalls } = makeEngine(
    [
      { code: "FAIL", hostPlayerId: "h1", gameSlug: "rocket", gameStatus: "RUNNING" },
      { code: "OK", hostPlayerId: "h2", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    {
      throwOnRoomCode: new Map([["FAIL", new Error("uventet engine-feil")]]),
    }
  );
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 2);
  assert.equal(r.errors, 1);
  assert.equal(r.drawsTriggered, 1, "OK-rommet må gå gjennom");
  assert.ok(r.errorMessages?.[0]?.includes("FAIL"));
  assert.equal(drawCalls.length, 2, "begge rom forsøkt");
});

test("getRoomSnapshot kaster: telt som errors, ingen drawNextNumber", async () => {
  const { engine, drawCalls } = makeEngine(
    [{ code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" }],
    { throwOnSnapshot: new Set(["R"]) }
  );
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 1);
  assert.equal(drawCalls.length, 0);
});

// ── Edge case: ingen rom ────────────────────────────────────────────────────

test("ingen rom: returnerer 0 telles", async () => {
  const { engine } = makeEngine([]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 0);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(r.skipped, 0);
  assert.equal(r.errors, 0);
});

// ── ActorPlayerId fra hostPlayerId ──────────────────────────────────────────

test("actorPlayerId settes til hostPlayerId fra room snapshot", async () => {
  const { engine, drawCalls } = makeEngine([
    {
      code: "R",
      hostPlayerId: "the-host-id-42",
      gameSlug: "rocket",
      gameStatus: "RUNNING",
    },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  await service.tick();
  assert.equal(drawCalls[0]!.actorPlayerId, "the-host-id-42");
});

// ── Snapshot-filtrert RUNNING-mismatch ──────────────────────────────────────

test("snapshot.currentGame.status !== RUNNING (race) → skipped uten draw-kall", async () => {
  // Summary sier RUNNING, men snapshot returnerer ENDED — race mellom
  // listRoomSummaries og getRoomSnapshot. Skal gracefult skipes.
  const drawCalls: Array<{ roomCode: string; actorPlayerId: string }> = [];
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "RACE", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "RACE",
      hostPlayerId: "h",
      gameSlug: "rocket",
      currentGame: { status: "ENDED", drawnNumbers: [1, 2, 3] },
    }),
    drawNextNumber: async (input) => {
      drawCalls.push(input);
      return { number: 4, drawIndex: 3, gameId: "g" };
    },
  };
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(r.skipped, 1);
  assert.equal(drawCalls.length, 0);
});

// ── Default drawIntervalMs ──────────────────────────────────────────────────

test("constructor: ugyldig drawIntervalMs (negativ/NaN/undefined) → faller til default 30000ms", async () => {
  // 0 er gyldig (= "ingen throttle" — engine-laget håndhever sin egen
  // minDrawIntervalMs). Negativ/NaN/undefined → default 30 000 ms.
  for (const bad of [-1, NaN, undefined]) {
    const { engine, drawCalls } = makeEngine([
      { code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
    ]);
    const service = new Game2AutoDrawTickService({
      engine,
      drawIntervalMs: bad as number,
    });
    await service.tick();
    const r2 = await service.tick();
    assert.equal(
      r2.skipped,
      1,
      `bad=${String(bad)}: andre tick innen 30s skal være throttled (default-fallback)`,
    );
    assert.equal(drawCalls.length, 1);
  }
});
