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
      // Tobias 2026-05-04 (host-fallback fix, Game2AutoDrawTickService.ts:441-460):
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

// ── Tobias 2026-05-04: stuck-room auto-recovery + diagnostic helpers ───────

test("stuck-room recovery: drawn=21 + status=RUNNING + forceEndStaleRound wired → ender + callback fyrer", async () => {
  // Replicates the prod-bug pattern: ROCKET-rom på status=RUNNING med 21
  // baller trukket, men endedReason=null. Med forceEndStaleRound-callback
  // wired skal tick-en force-ende rommet OG kalle onStaleRoomEnded så
  // perpetual-loopen kan spawne ny runde.
  const forceEndCalls: Array<{ roomCode: string; reason: string }> = [];
  const onStaleCalls: string[] = [];
  const drawCalls: Array<{ roomCode: string; actorPlayerId: string }> = [];

  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "ROCKET", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "ROCKET",
      hostPlayerId: "host",
      gameSlug: "rocket",
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async (input) => {
      drawCalls.push(input);
      return { number: 22, drawIndex: 21, gameId: "g" };
    },
    forceEndStaleRound: async (roomCode, reason) => {
      forceEndCalls.push({ roomCode, reason });
      return true;
    },
  };

  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    onStaleRoomEnded: async (roomCode) => {
      onStaleCalls.push(roomCode);
    },
  });
  const r = await service.tick();

  assert.equal(drawCalls.length, 0, "stuck rom skal IKKE trigge drawNextNumber");
  assert.equal(forceEndCalls.length, 1);
  assert.equal(forceEndCalls[0]!.roomCode, "ROCKET");
  assert.equal(forceEndCalls[0]!.reason, "STUCK_AT_MAX_BALLS_AUTO_RECOVERY");
  assert.equal(onStaleCalls.length, 1);
  assert.equal(onStaleCalls[0], "ROCKET");
  assert.equal(r.skipped, 1, "stuck rom telles fortsatt som skipped (bevart obs)");
  assert.deepEqual(r.staleRoomsEnded, ["ROCKET"]);
});

test("stuck-room recovery: forceEndStaleRound MANGLER på engine → faller til legacy skip-only", async () => {
  // Backward-compat: fake-engine i eksisterende tester har ikke
  // forceEndStaleRound. Da skal vi bare skippe (gammel oppførsel).
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
  assert.equal(r.skipped, 1);
  assert.equal(drawCalls.length, 0);
  assert.equal(r.staleRoomsEnded, undefined);
});

test("stuck-room recovery: forceEndStaleRound returnerer false (allerede endet) → ingen callback", async () => {
  let forceEndCallCount = 0;
  let onStaleCallCount = 0;
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "ROCKET", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "ROCKET",
      hostPlayerId: "host",
      gameSlug: "rocket",
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
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
  const service = new Game2AutoDrawTickService({
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
      { code: "ROCKET", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "ROCKET",
      hostPlayerId: "host",
      gameSlug: "rocket",
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async () => {
      throw new Error("not called");
    },
    forceEndStaleRound: async () => {
      throw new Error("forceEnd boom");
    },
  };
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.errors, 1);
  assert.ok(r.errorMessages?.[0]?.includes("forceEndStaleRound failed"));
});

test("getLastTickResult: returnerer null før første tick, deretter siste tick-resultat", async () => {
  const { engine } = makeEngine([
    { code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  assert.equal(service.getLastTickResult(), null, "før tick: null");

  const r = await service.tick();
  const last = service.getLastTickResult();
  assert.notEqual(last, null);
  assert.equal(last!.checked, r.checked);
  assert.equal(last!.drawsTriggered, r.drawsTriggered);
  assert.ok(typeof last!.completedAtMs === "number");
});

test("getLastTickResult: callback-feil i onStaleRoomEnded krasjer ikke tick + telles ikke som error", async () => {
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "ROCKET", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "ROCKET",
      hostPlayerId: "host",
      gameSlug: "rocket",
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async () => {
      throw new Error("not called");
    },
    forceEndStaleRound: async () => true,
  };
  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    onStaleRoomEnded: async () => {
      throw new Error("callback boom");
    },
  });
  const r = await service.tick();
  assert.equal(r.errors, 0, "callback-feil teller ikke som engine-error");
  assert.deepEqual(r.staleRoomsEnded, ["ROCKET"]);
});

// ── Tobias-bug-fix 2026-05-04: broadcaster wires `draw:new` + room:update ─

test("broadcaster: kalles for HVERT vellykket draw med korrekt event-shape", async () => {
  // Kjerne-regression-vakt for prod-bug fra 2026-05-04: cron-tick-en
  // trakk baller server-side men emitterte ALDRI `draw:new`/`room:update`
  // ut til klientene. Når broadcaster er injected MÅ den kalles én gang
  // per draw med riktig payload (number/drawIndex/gameId).
  const { engine } = makeEngine([
    { code: "R1", hostPlayerId: "h1", gameSlug: "rocket", gameStatus: "RUNNING" },
    { code: "R2", hostPlayerId: "h2", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const broadcasterCalls: Array<{
    roomCode: string;
    number: number;
    drawIndex: number;
    gameId: string;
  }> = [];
  const service = new Game2AutoDrawTickService({
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
  assert.equal(broadcasterCalls.length, 2, "broadcaster skal kalles én gang per draw");
  // Kall-shape: matche {number, drawIndex, gameId, roomCode}.
  assert.deepEqual(broadcasterCalls.map((c) => c.roomCode).sort(), ["R1", "R2"]);
  for (const call of broadcasterCalls) {
    assert.ok(
      typeof call.number === "number" && Number.isFinite(call.number),
      "number må være endelig number",
    );
    assert.ok(
      typeof call.drawIndex === "number" && Number.isFinite(call.drawIndex),
      "drawIndex må være endelig number",
    );
    assert.ok(typeof call.gameId === "string" && call.gameId.length > 0);
  }
});

test("broadcaster: IKKE kalt når draw-en feiler (race-error)", async () => {
  // Hvis draw kaster (DRAW_TOO_SOON, NO_MORE_NUMBERS, etc.) skal vi IKKE
  // emitte `draw:new` — det ville lede til fantom-baller på klienten.
  const { engine } = makeEngine(
    [{ code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" }],
    {
      throwOnRoomCode: new Map([
        ["R", new DomainError("DRAW_TOO_SOON", "for tidlig")],
      ]),
    }
  );
  let broadcasterCalled = false;
  const service = new Game2AutoDrawTickService({
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
  assert.equal(broadcasterCalled, false, "broadcaster må IKKE kalles ved draw-feil");
});

test("broadcaster: IKKE kalt for stuck-room (drawn=21, status=RUNNING)", async () => {
  // Stuck-recovery-stien skal kun kalle `forceEndStaleRound` +
  // `onStaleRoomEnded`, ikke broadcaster — det er ingen ny ball å emitte.
  const engine: AutoDrawEngine = {
    listRoomSummaries: () => [
      { code: "ROCKET", gameSlug: "rocket", gameStatus: "RUNNING" },
    ],
    getRoomSnapshot: () => ({
      code: "ROCKET",
      hostPlayerId: "host",
      gameSlug: "rocket",
      currentGame: {
        status: "RUNNING",
        drawnNumbers: Array.from({ length: 21 }, (_, i) => i + 1),
      },
    }),
    drawNextNumber: async () => {
      throw new Error("not called");
    },
    forceEndStaleRound: async () => true,
  };
  let broadcasterCalled = false;
  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    broadcaster: {
      onDrawCompleted: () => {
        broadcasterCalled = true;
      },
    },
  });
  await service.tick();
  assert.equal(broadcasterCalled, false);
});

test("broadcaster: kast i broadcaster.onDrawCompleted krasjer IKKE tick + teller ikke som engine-error", async () => {
  // Broadcaster-feil skal ikke blokkere andre rom eller markere ticken som
  // failed. Adapter-en sluker egne feil; service har egen lokal try/catch
  // som ekstra defense.
  const { engine } = makeEngine([
    { code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
    { code: "OK", hostPlayerId: "h2", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  let okCalled = false;
  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 0,
    broadcaster: {
      onDrawCompleted: (input) => {
        if (input.roomCode === "R") throw new Error("broadcaster boom");
        okCalled = true;
      },
    },
  });
  const r = await service.tick();
  // Engine kalles for begge rom, drawsTriggered=2 — broadcaster-feil
  // teller ikke som engine-feil.
  assert.equal(r.drawsTriggered, 2);
  assert.equal(r.errors, 0, "broadcaster-kast er ikke en engine-error");
  assert.equal(okCalled, true, "etterfølgende rom skal fortsatt få broadcaster-kall");
});

test("broadcaster: ikke injected → tick kjører uten emit (legacy-fallback for tester)", async () => {
  // Eksisterende tester konstruerer service uten `broadcaster`. Da skal
  // tick fortsette å virke — bare uten emit til klientene. Dette
  // verifiserer at vi ikke har gjort broadcasteren obligatorisk.
  const { engine, drawCalls } = makeEngine([
    { code: "R", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({ engine, drawIntervalMs: 0 });
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.equal(drawCalls.length, 1);
});

// ── Admin-config-round-pace (Tobias 2026-05-04) ─────────────────────────────

test("admin-config-round-pace: per-game ballIntervalMs throttler tick uavhengig av service drawIntervalMs", async () => {
  // Tobias 2026-05-04: variantConfig.ballIntervalMs (admin-konfig) tar
  // presedens over service-level drawIntervalMs (env-fallback). Vi verifiserer
  // throttle-oppførselen ved to back-to-back-tick-er der per-game-throttle
  // er 5 sekunder mens service-level er 0.
  const { engine } = makeEngine([
    { code: "ROCKET", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 0, // service-level: ingen throttle
    variantLookup: {
      getVariantConfig: () => ({
        gameType: "rocket",
        config: {
          ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
          patterns: [],
          ballIntervalMs: 5000, // per-game: 5s throttle
        },
      }),
    },
  });
  // Første tick: ingen forrige draw → trigger.
  const r1 = await service.tick();
  assert.equal(r1.drawsTriggered, 1);
  // Andre tick rett etter: per-game-throttle (5s) skal blokkere.
  const r2 = await service.tick();
  assert.equal(r2.drawsTriggered, 0);
  assert.equal(r2.skipped, 1);
});

test("admin-config-round-pace: variantLookup ikke injected → service drawIntervalMs brukes (legacy)", async () => {
  // Bakoverkompat: tester uten roomState skal fortsette å virke.
  const { engine } = makeEngine([
    { code: "ROCKET", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 0, // service-level: ingen throttle
    // variantLookup: undefined
  });
  const r1 = await service.tick();
  const r2 = await service.tick();
  assert.equal(r1.drawsTriggered, 1);
  assert.equal(r2.drawsTriggered, 1, "uten variantLookup skal service drawIntervalMs (=0) tillate begge tick-er");
});

test("admin-config-round-pace: ugyldig per-game ballIntervalMs → faller til env-default", async () => {
  // Defense-in-depth: ugyldig DB-verdi skal ikke bypasse throttle.
  const { engine } = makeEngine([
    { code: "ROCKET", hostPlayerId: "h", gameSlug: "rocket", gameStatus: "RUNNING" },
  ]);
  const service = new Game2AutoDrawTickService({
    engine,
    drawIntervalMs: 5000, // service-level: 5s
    variantLookup: {
      getVariantConfig: () => ({
        gameType: "rocket",
        config: {
          ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
          patterns: [],
          ballIntervalMs: 999, // < MIN
        },
      }),
    },
  });
  const r1 = await service.tick();
  const r2 = await service.tick();
  assert.equal(r1.drawsTriggered, 1);
  assert.equal(r2.drawsTriggered, 0, "ugyldig per-game-verdi → service drawIntervalMs (5000) håndhever throttle");
});
