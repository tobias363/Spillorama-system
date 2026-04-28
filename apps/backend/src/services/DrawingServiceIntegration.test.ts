/**
 * Unified pipeline refactor — Fase 2 integration test for DrawingService.
 *
 * Demonstrerer wire-up-mønsteret som `Game1DrawEngineService.drawNext` og
 * `BingoEngine._drawNextNumberLocked` vil bruke i Fase 4 (GameOrchestrator).
 *
 * Verifiserer:
 *   - DrawingService kan kjøre mot bag konstruert via faktisk
 *     `buildDrawBag(resolveDrawBagConfig(...))` (eksisterende prod-helpers).
 *   - DrawingService er kompatibel med `parseDrawBag()` (helper som
 *     Game1DrawEngineService bruker for å lese `draw_bag_json` fra DB).
 *   - Slug-baserte konfig-routings (bingo→75, rocket→60) gir riktig
 *     ballRange og bag-lengde.
 *
 * Hvorfor:
 *   Når Fase 4 lander GameOrchestrator må vi være sikre på at konstruksjonen
 *   `parseDrawBag(state.draw_bag_json) → drawingState.drawBag` ikke
 *   forandrer semantikken. Denne testen er lakmus-papiret.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDrawBag,
  resolveDrawBagConfig,
} from "../game/DrawBagStrategy.js";
import { parseDrawBag } from "../game/Game1DrawEngineHelpers.js";
import {
  DrawingService,
  type DrawingGameState,
} from "./DrawingService.js";

test("DrawingService integration: bingo-slug (Spill 1) → 75-ball bag, alle 75 trekkbare", () => {
  // Som ved game-start: konstruer bag fra slug + variantConfig.
  const config = resolveDrawBagConfig("bingo", undefined);
  assert.equal(config.maxBallValue, 75);
  assert.equal(config.drawBagSize, 75);

  const bag = buildDrawBag(config);
  assert.equal(bag.length, 75);

  // Som ved DB-lagring + lesing: round-trip gjennom parseDrawBag.
  const persisted = JSON.stringify(bag);
  const parsedBag = parseDrawBag(persisted);
  assert.deepEqual(parsedBag, bag);

  // Wire opp DrawingService.
  const service = new DrawingService();
  const drawn: number[] = [];

  for (let i = 0; i < 75; i++) {
    const state: DrawingGameState = {
      gameId: "spill1-integration",
      status: "RUNNING",
      drawBag: parsedBag,
      drawsCompleted: i,
      maxDraws: 75,
      ballRange: config.maxBallValue,
    };
    const result = service.drawNext(state);
    drawn.push(result.nextBall);
    assert.equal(result.drawSequenceNumber, i + 1);
  }

  // Alle 75 ball-verdier 1..75 trukket eksakt én gang.
  const sorted = [...drawn].sort((a, b) => a - b);
  assert.deepEqual(
    sorted,
    Array.from({ length: 75 }, (_, i) => i + 1),
  );
});

test("DrawingService integration: rocket-slug (Spill 2) → 60-ball bag", () => {
  const config = resolveDrawBagConfig("rocket", undefined);
  assert.equal(config.maxBallValue, 60);
  assert.equal(config.drawBagSize, 60);

  const bag = buildDrawBag(config);
  assert.equal(bag.length, 60);

  const service = new DrawingService();
  const result = service.drawNext({
    gameId: "spill2-integration",
    status: "RUNNING",
    drawBag: bag,
    drawsCompleted: 0,
    maxDraws: 60,
    ballRange: 60,
  });

  assert.ok(result.nextBall >= 1 && result.nextBall <= 60);
  assert.equal(result.drawSequenceNumber, 1);
  assert.equal(result.isLastDraw, false);
});

test("DrawingService integration: variantConfig overstyring av maxBallValue + drawBagSize", () => {
  // Operatør-overstyring: 75-bag men cap på 52 draws (Spill 1-default).
  const config = resolveDrawBagConfig("bingo", {
    maxBallValue: 75,
    drawBagSize: 75,
  } as Parameters<typeof resolveDrawBagConfig>[1]);

  const bag = buildDrawBag(config);
  const service = new DrawingService();
  const drawn: number[] = [];

  // Maxdraws = 52 er en CALLER-decision (typisk fra ticket_config_json).
  // Service-en respekterer dette og stopper etter 52 draws.
  const maxDraws = 52;

  for (let i = 0; i < maxDraws; i++) {
    const result = service.drawNext({
      gameId: "spill1-cap-52",
      status: "RUNNING",
      drawBag: bag,
      drawsCompleted: i,
      maxDraws,
      ballRange: config.maxBallValue,
    });
    drawn.push(result.nextBall);
    assert.equal(result.isLastDraw, i === maxDraws - 1);
  }

  assert.equal(drawn.length, 52);
  assert.equal(new Set(drawn).size, 52, "alle 52 unike");
});

test("DrawingService integration: parseDrawBag round-trip via DB-shape (string vs array)", () => {
  // Game1DrawEngineService leser `state.draw_bag_json` som kan komme som
  // enten array (jsonb) eller string (json som ble cast til text). Begge
  // shape-r skal fungere ende-til-ende med DrawingService.
  const config = resolveDrawBagConfig("bingo", undefined);
  const bag = buildDrawBag(config);

  // Variant 1: array direkte (typisk for jsonb-kolonne).
  const parsedFromArray = parseDrawBag(bag);
  assert.deepEqual(parsedFromArray, bag);

  // Variant 2: stringified (typisk for text-kolonne eller serialisert form).
  const parsedFromString = parseDrawBag(JSON.stringify(bag));
  assert.deepEqual(parsedFromString, bag);

  // Begge variants må gi identisk DrawingService-output.
  const service = new DrawingService();
  const r1 = service.drawNext({
    gameId: "round-trip-1",
    status: "RUNNING",
    drawBag: parsedFromArray,
    drawsCompleted: 0,
    maxDraws: 75,
    ballRange: 75,
  });
  const r2 = service.drawNext({
    gameId: "round-trip-2",
    status: "RUNNING",
    drawBag: parsedFromString,
    drawsCompleted: 0,
    maxDraws: 75,
    ballRange: 75,
  });
  assert.equal(r1.nextBall, r2.nextBall);
  assert.equal(r1.drawSequenceNumber, r2.drawSequenceNumber);
});
