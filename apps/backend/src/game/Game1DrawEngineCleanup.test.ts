/**
 * Regresjons-test for Tobias-direktiv 2026-05-13:
 * Spill 1 lobby-rom-persistens fix.
 *
 * Bakgrunn — bug rapportert av Tobias 2026-05-12 etter PR #1284:
 * --------------------------------------------------------------------
 *   "Jeg kjøpte bonger til neste spill, når trekning startet ble de
 *    borte. Etter endt trekning prøvde jeg å kjøpe bonger til neste
 *    spill og fikk beskjed at rommet ikke fantes."
 *
 * Bevis fra spillorama-debug-2026-05-12T22-14-22.json (evt-238/239):
 *   - Etter gameEnded (75 baller trukket på sg=2fe2020e...)
 *   - Klient emit `bet:arm` på `BINGO_DEMO-PILOT-GOH`
 *   - Server ack: ok=false, errorCode=ROOM_NOT_FOUND
 *
 * Root cause:
 *   Game1DrawEngineService.drawNext kaller destroyRoomIfPresent etter
 *   isFinished=true. For multi-hall Spill 1 (GoH) er roomCode den
 *   kanoniske `BINGO_<groupId>` — destruksjon wipet hele lobby-rommet,
 *   evictet alle spillere, og wipet armed-state. Spillere som ikke
 *   disconnectet socket fikk ROOM_NOT_FOUND på neste bet:arm.
 *
 * Per Tobias' immutable direktiv:
 *   "Lobby-rommet skal være åpent innenfor åpningstid. Spillere skal
 *    alltid kunne kjøpe bonger til neste spill — også under aktiv
 *    trekning og rett etter trekningsslutt."
 *
 * Fix:
 *   For HALL-SHARED CANONICAL Spill 1 lobby-rom (`BINGO_<groupId>`):
 *   - destroyBingoEngineRoomIfPresent forsøker FØRST
 *     resetCanonicalRoomAfterGameEnd
 *   - Reset arkiverer currentGame, clear scheduledGameId, disarm
 *     players, men BEHOLDER players-map og isHallShared
 *   - Hvis reset returnerer false (rommet er IKKE hall-shared
 *     canonical) → fall tilbake til destroyRoom som før
 *
 * Tests:
 *   1. Canonical hall-shared BINGO_ rom: reset kalles, destroy IKKE
 *   2. Canonical hall-shared rom + reset returnerer false: destroy fallback
 *   3. Canonical hall-shared rom + reset kaster: destroy fallback
 *   4. Per-hall BINGO_<hallId> (ikke hall-shared): reset kalles, returnerer
 *      false, destroy fallback
 *   5. Non-canonical rom (legacy 4RCQSX-style): destroy kalles direkte
 *   6. Engine null / roomCode null: no-op (eksisterende kontrakt bevart)
 *   7. Engine uten resetCanonicalRoomAfterGameEnd-metode: faller tilbake
 *      til destroyRoom (graceful for eldre engine-versjoner)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { destroyBingoEngineRoomIfPresent } from "./Game1DrawEngineCleanup.js";
import { DomainError } from "../errors/DomainError.js";

// ── Test types ────────────────────────────────────────────────────────────────

interface FakeEngineCleanup {
  destroyRoomCalls: string[];
  resetCalls: string[];
  destroyRoom: (roomCode: string) => void;
  resetCanonicalRoomAfterGameEnd?: (roomCode: string) => boolean;
}

interface FakeEngineCleanupOpts {
  /** When set, resetCanonicalRoomAfterGameEnd returns this value (default true). */
  resetReturns?: boolean;
  /** When set, resetCanonicalRoomAfterGameEnd throws this error. */
  resetThrows?: DomainError;
  /** When true, omit resetCanonicalRoomAfterGameEnd from the engine (legacy). */
  omitResetMethod?: boolean;
  /** When set, destroyRoom throws this error. */
  destroyThrows?: DomainError;
}

function makeFakeEngine(opts: FakeEngineCleanupOpts = {}): FakeEngineCleanup {
  const destroyCalls: string[] = [];
  const resetCalls: string[] = [];

  const engine: FakeEngineCleanup = {
    destroyRoomCalls: destroyCalls,
    resetCalls,
    destroyRoom: (roomCode: string) => {
      destroyCalls.push(roomCode);
      if (opts.destroyThrows) {
        throw opts.destroyThrows;
      }
    },
  };

  if (!opts.omitResetMethod) {
    engine.resetCanonicalRoomAfterGameEnd = (roomCode: string): boolean => {
      resetCalls.push(roomCode);
      if (opts.resetThrows) {
        throw opts.resetThrows;
      }
      return opts.resetReturns ?? true;
    };
  }

  return engine;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("canonical BINGO_<groupId> + reset returnerer true → reset, NOT destroy", () => {
  const engine = makeFakeEngine({ resetReturns: true });
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "BINGO_DEMO-PILOT-GOH",
    "completion",
  );
  assert.deepEqual(engine.resetCalls, ["BINGO_DEMO-PILOT-GOH"]);
  assert.deepEqual(engine.destroyRoomCalls, []);
});

test("canonical BINGO_<groupId> + reset returnerer false → fall tilbake til destroy", () => {
  const engine = makeFakeEngine({ resetReturns: false });
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "BINGO_DEMO-HALL-001",
    "completion",
  );
  assert.deepEqual(engine.resetCalls, ["BINGO_DEMO-HALL-001"]);
  assert.deepEqual(engine.destroyRoomCalls, ["BINGO_DEMO-HALL-001"]);
});

test("canonical BINGO_<groupId> + reset kaster → fall tilbake til destroy (best-effort)", () => {
  const engine = makeFakeEngine({
    resetThrows: new DomainError("GAME_IN_PROGRESS", "test"),
  });
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "BINGO_DEMO-PILOT-GOH",
    "cancellation",
  );
  // Reset ble forsøkt
  assert.deepEqual(engine.resetCalls, ["BINGO_DEMO-PILOT-GOH"]);
  // Destroy ble fallback
  assert.deepEqual(engine.destroyRoomCalls, ["BINGO_DEMO-PILOT-GOH"]);
});

test("legacy room (random non-canonical kode 4RCQSX-style) → destroy direkte, IKKE reset", () => {
  const engine = makeFakeEngine();
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "4RCQSX",
    "completion",
  );
  // Reset SKAL IKKE kalles for non-canonical kode
  assert.deepEqual(engine.resetCalls, []);
  // Destroy kalles direkte
  assert.deepEqual(engine.destroyRoomCalls, ["4RCQSX"]);
});

test("ROCKET / MONSTERBINGO ikke berørt (kun BINGO_-prefix går via reset)", () => {
  // ROCKET er canonical men ikke et Spill 1 lobby — den hører til Spill 2.
  // For nå er destroyRoomIfPresent kun kalt fra Spill 1-pathen, men hvis den
  // ble kalt med ROCKET skulle den IKKE gå via reset (som er Spill 1-spesifikk).
  // I praksis: Spill 1 cleanup-pathen får aldri ROCKET. Vi tester at filteret
  // er strikt BINGO_-prefix-basert som ekstra defense.
  const engine = makeFakeEngine();
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "ROCKET",
    "completion",
  );
  // ROCKET er canonical men ikke BINGO_-prefix → ikke reset
  assert.deepEqual(engine.resetCalls, []);
  // Destroy fallback (selv om denne pathen i praksis aldri trigges for Spill 2)
  assert.deepEqual(engine.destroyRoomCalls, ["ROCKET"]);
});

test("engine null → no-op (eksisterende kontrakt bevart)", () => {
  destroyBingoEngineRoomIfPresent(
    null,
    "sg-1",
    "BINGO_DEMO-PILOT-GOH",
    "completion",
  );
  // Ikke krasjer
  assert.ok(true);
});

test("roomCode null → no-op", () => {
  const engine = makeFakeEngine();
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    null,
    "completion",
  );
  assert.deepEqual(engine.resetCalls, []);
  assert.deepEqual(engine.destroyRoomCalls, []);
});

test("roomCode tom streng → no-op", () => {
  const engine = makeFakeEngine();
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "   ",
    "completion",
  );
  assert.deepEqual(engine.resetCalls, []);
  assert.deepEqual(engine.destroyRoomCalls, []);
});

test("engine uten resetCanonicalRoomAfterGameEnd-metode (legacy) → faller tilbake til destroy", () => {
  const engine = makeFakeEngine({ omitResetMethod: true });
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "BINGO_DEMO-PILOT-GOH",
    "completion",
  );
  // Reset ble ikke kalt (metoden mangler)
  assert.deepEqual(engine.resetCalls, []);
  // Destroy ble kalt som fallback (legacy compatibility)
  assert.deepEqual(engine.destroyRoomCalls, ["BINGO_DEMO-PILOT-GOH"]);
});

test("case-insensitivt: lowercase 'bingo_demo-pilot-goh' uppercases til BINGO_DEMO-PILOT-GOH", () => {
  const engine = makeFakeEngine();
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "bingo_demo-pilot-goh",
    "completion",
  );
  // Reset kalles med uppercase form
  assert.deepEqual(engine.resetCalls, ["BINGO_DEMO-PILOT-GOH"]);
});

test("whitespace trimmes før prefix-check", () => {
  const engine = makeFakeEngine();
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "  BINGO_DEMO-PILOT-GOH  ",
    "completion",
  );
  assert.deepEqual(engine.resetCalls, ["BINGO_DEMO-PILOT-GOH"]);
});

test("destroy kaster ved fallback → svelges (best-effort cleanup, ikke regulatorisk-kritisk)", () => {
  const engine = makeFakeEngine({
    resetReturns: false, // force fallback
    destroyThrows: new DomainError("ROOM_NOT_FOUND", "test"),
  });
  // Skal IKKE kaste — destroyRoom-feilen logges og swallowes
  destroyBingoEngineRoomIfPresent(
    engine as unknown as Parameters<typeof destroyBingoEngineRoomIfPresent>[0],
    "sg-1",
    "BINGO_DEMO-HALL-001",
    "completion",
  );
  assert.deepEqual(engine.resetCalls, ["BINGO_DEMO-HALL-001"]);
  assert.deepEqual(engine.destroyRoomCalls, ["BINGO_DEMO-HALL-001"]);
});
