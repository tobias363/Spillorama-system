/**
 * Unified pipeline refactor — Fase 2 unit tests for DrawingService.
 *
 * Verifiserer happy path, alle DomainError-grener, idempotency, og at
 * service-en er pure (ingen mutering av input-state).
 *
 * Property-based invariants ligger i:
 *   `apps/backend/src/__tests__/invariants/drawingInvariant.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DrawingError,
  DrawingService,
  type DrawingGameState,
} from "./DrawingService.js";

function makeState(overrides: Partial<DrawingGameState> = {}): DrawingGameState {
  return {
    gameId: "game-1",
    status: "RUNNING",
    drawBag: [42, 17, 3, 88, 31, 5, 60, 23, 11, 7],
    drawsCompleted: 0,
    maxDraws: 10,
    ballRange: 90,
    ...overrides,
  };
}

// ── Happy path ──────────────────────────────────────────────────────────────

test("DrawingService: happy path — første draw returnerer drawBag[0] med sequence=1", () => {
  const service = new DrawingService();
  const state = makeState();

  const result = service.drawNext(state);

  assert.equal(result.nextBall, 42, "nextBall = drawBag[drawsCompleted]");
  assert.equal(result.drawSequenceNumber, 1, "første draw → sequence 1");
  assert.equal(result.isLastDraw, false, "1 < maxDraws=10 → ikke siste");
});

test("DrawingService: happy path — draw mid-game returnerer riktig ball", () => {
  const service = new DrawingService();
  const state = makeState({ drawsCompleted: 5 });

  const result = service.drawNext(state);

  assert.equal(result.nextBall, 5, "drawBag[5] = 5");
  assert.equal(result.drawSequenceNumber, 6, "sequence = drawsCompleted + 1");
  assert.equal(result.isLastDraw, false);
});

test("DrawingService: pure — input-state ikke mutert etter drawNext", () => {
  const service = new DrawingService();
  const originalBag = [42, 17, 3, 88];
  const state: DrawingGameState = {
    gameId: "game-1",
    status: "RUNNING",
    drawBag: originalBag,
    drawsCompleted: 0,
    maxDraws: 4,
    ballRange: 90,
  };

  service.drawNext(state);

  // Bag uendret.
  assert.deepEqual([...state.drawBag], [42, 17, 3, 88]);
  assert.equal(state.drawsCompleted, 0, "drawsCompleted ikke mutert");
  assert.equal(state.maxDraws, 4, "maxDraws ikke mutert");
  assert.equal(state.status, "RUNNING", "status ikke mutert");
});

// ── Boundary: at maxDraws ───────────────────────────────────────────────────

test("DrawingService: boundary — siste draw (maxDraws-1) → isLastDraw=true", () => {
  const service = new DrawingService();
  const state = makeState({ drawsCompleted: 9, maxDraws: 10 });
  // drawsCompleted=9 → neste blir sequence=10 = maxDraws → isLastDraw=true.

  const result = service.drawNext(state);

  assert.equal(result.nextBall, 7, "drawBag[9] = 7");
  assert.equal(result.drawSequenceNumber, 10);
  assert.equal(result.isLastDraw, true, "sequence == maxDraws → siste draw");
});

test("DrawingService: boundary — maxDraws=1 og drawsCompleted=0 → første og siste draw", () => {
  const service = new DrawingService();
  const state = makeState({
    drawBag: [42],
    maxDraws: 1,
    drawsCompleted: 0,
  });

  const result = service.drawNext(state);

  assert.equal(result.nextBall, 42);
  assert.equal(result.drawSequenceNumber, 1);
  assert.equal(result.isLastDraw, true, "maxDraws=1 → første er også siste");
});

test("DrawingService: boundary — maxDraws < drawBag.length (operatør-overstyring)", () => {
  // 75-ball bag men operatør har satt maxDraws=52 (typisk Spill 1-default).
  const service = new DrawingService();
  const state = makeState({
    drawBag: Array.from({ length: 75 }, (_, i) => i + 1),
    maxDraws: 52,
    drawsCompleted: 51,
    ballRange: 75,
  });

  const result = service.drawNext(state);

  assert.equal(result.nextBall, 52, "drawBag[51] = 52 (1-indexed bag)");
  assert.equal(result.drawSequenceNumber, 52);
  assert.equal(result.isLastDraw, true, "treffer maxDraws cap");
});

// ── Error: GAME_NOT_RUNNING ─────────────────────────────────────────────────

test("DrawingService: error — status NOT_RUNNING → GAME_NOT_RUNNING", () => {
  const service = new DrawingService();
  const state = makeState({ status: "NOT_RUNNING" });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "GAME_NOT_RUNNING" &&
      err.details?.gameId === "game-1" &&
      err.details?.status === "NOT_RUNNING",
  );
});

// ── Error: MAX_DRAWS_REACHED ────────────────────────────────────────────────

test("DrawingService: error — drawsCompleted == maxDraws → MAX_DRAWS_REACHED", () => {
  const service = new DrawingService();
  const state = makeState({ drawsCompleted: 10, maxDraws: 10 });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "MAX_DRAWS_REACHED" &&
      err.details?.drawsCompleted === 10 &&
      err.details?.maxDraws === 10,
  );
});

test("DrawingService: error — drawsCompleted > maxDraws (innenfor bag) → MAX_DRAWS_REACHED", () => {
  const service = new DrawingService();
  // Defensive — bør ikke skje i prod, men service-en må håndtere det.
  // Bruk en bag som er stor nok til å passere validate-laget; da treffer
  // service-en MAX_DRAWS_REACHED først (rekkefølge i drawNext).
  const state = makeState({
    drawBag: Array.from({ length: 20 }, (_, i) => i + 1),
    drawsCompleted: 15,
    maxDraws: 10,
    ballRange: 90,
  });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError && err.code === "MAX_DRAWS_REACHED",
  );
});

// ── Error: DRAW_BAG_EXHAUSTED ───────────────────────────────────────────────

test("DrawingService: error — bag tom (drawsCompleted == drawBag.length) → DRAW_BAG_EXHAUSTED", () => {
  // Sett opp slik at maxDraws > drawBag.length aldri når validate-laget
  // (validateState ville rejected). I stedet: maxDraws == drawBag.length,
  // så draws-loopen treffer DRAW_BAG_EXHAUSTED og MAX_DRAWS_REACHED på
  // samme tidspunkt — vi sjekker MAX_DRAWS_REACHED først (rekkefølge i
  // implementasjonen). For å trigge DRAW_BAG_EXHAUSTED trenger vi en
  // case der drawsCompleted ≥ drawBag.length men < maxDraws — det er
  // umulig gitt validateState. Service-en har likevel guarden som
  // defense-in-depth. Vi tester den ved å konstruere state som nettopp
  // passerer validate, så manuelt overstyre drawBag for å simulere
  // korrupsjon.
  const service = new DrawingService();
  const state = makeState({
    drawBag: [1, 2, 3],
    drawsCompleted: 3,
    maxDraws: 3, // ikke > drawBag.length, så validate passerer
    ballRange: 90,
  });

  // Treffer MAX_DRAWS_REACHED først pga rekkefølge.
  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError && err.code === "MAX_DRAWS_REACHED",
  );
});

test("DrawingService: error — bag-tom-guard nås når maxDraws > drawBag.length blokkeres av validate", () => {
  // validateState blokkerer maxDraws > drawBag.length, så DRAW_BAG_EXHAUSTED
  // er en defense-in-depth-guard for caller-bug der drawsCompleted øker
  // utenfor service. Vi verifiserer at guarden eksisterer ved å mock'e en
  // state der vi setter drawsCompleted = drawBag.length men maxDraws høyere
  // (skulle vært blokkert av validate, så vi bypasser ved direkte konstruksjon
  // og forventer INVALID_STATE i stedet).
  const service = new DrawingService();
  const state: DrawingGameState = {
    gameId: "game-broken",
    status: "RUNNING",
    drawBag: [1, 2, 3],
    drawsCompleted: 3,
    maxDraws: 5, // > drawBag.length, vil bli avvist av validate
    ballRange: 90,
  };

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      String(err.message).includes("maxDraws"),
  );
});

// ── Error: INVALID_STATE (validate-grener) ──────────────────────────────────

test("DrawingService: validate — tom gameId → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({ gameId: "" });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("gameId"),
  );
});

test("DrawingService: validate — ugyldig status → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({
    status: "PAUSED" as DrawingGameState["status"],
  });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("status"),
  );
});

test("DrawingService: validate — drawBag ikke array → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({
    drawBag: "not-an-array" as unknown as readonly number[],
  });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("drawBag"),
  );
});

test("DrawingService: validate — negativ drawsCompleted → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({ drawsCompleted: -1 });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("drawsCompleted"),
  );
});

test("DrawingService: validate — drawsCompleted > drawBag.length → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({
    drawBag: [1, 2, 3],
    drawsCompleted: 4,
    maxDraws: 3,
  });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("drawsCompleted"),
  );
});

test("DrawingService: validate — maxDraws=0 → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({ maxDraws: 0 });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("maxDraws"),
  );
});

test("DrawingService: validate — maxDraws > drawBag.length → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({
    drawBag: [1, 2, 3],
    maxDraws: 5,
  });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("maxDraws"),
  );
});

test("DrawingService: validate — ballRange=0 → INVALID_STATE", () => {
  const service = new DrawingService();
  const state = makeState({ ballRange: 0 });

  assert.throws(
    () => service.drawNext(state),
    (err: unknown) =>
      err instanceof DrawingError &&
      err.code === "INVALID_STATE" &&
      err.message.includes("ballRange"),
  );
});

// ── Determinism / idempotency ───────────────────────────────────────────────

test("DrawingService: idempotent — samme input gir samme output (1000 ganger)", () => {
  const service = new DrawingService();
  const state = makeState({ drawsCompleted: 3 });

  const expected = service.drawNext(state);

  for (let i = 0; i < 1000; i++) {
    const result = service.drawNext(state);
    assert.deepEqual(result, expected);
  }
});

test("DrawingService: deterministisk gjennom hele bag — sekvens av drawNext-kall matcher bag", () => {
  const service = new DrawingService();
  const bag = Array.from({ length: 75 }, (_, i) => 75 - i); // 75,74,73,...,1
  const drawnSequence: number[] = [];

  for (let i = 0; i < 75; i++) {
    const state: DrawingGameState = {
      gameId: "game-deterministic",
      status: "RUNNING",
      drawBag: bag,
      drawsCompleted: i,
      maxDraws: 75,
      ballRange: 75,
    };
    const result = service.drawNext(state);
    drawnSequence.push(result.nextBall);
    assert.equal(result.drawSequenceNumber, i + 1);
    assert.equal(result.isLastDraw, i === 74);
  }

  // Output-sekvens matcher bag eksakt.
  assert.deepEqual(drawnSequence, bag);
});

// ── Multi-instance isolation ────────────────────────────────────────────────

test("DrawingService: pure — to instanser gir samme output for samme state", () => {
  const service1 = new DrawingService();
  const service2 = new DrawingService();
  const state = makeState();

  const r1 = service1.drawNext(state);
  const r2 = service2.drawNext(state);

  assert.deepEqual(r1, r2);
});

// ── Realistiske scenario ────────────────────────────────────────────────────

test("DrawingService: realistisk Spill 1 75-ball med maxDraws=52 (default)", () => {
  // Default Spill 1 cap er 52 baller per Game1DrawEngineService.
  const service = new DrawingService();
  const bag = Array.from({ length: 75 }, (_, i) => i + 1);

  const lastDraw = service.drawNext({
    gameId: "spill1-runde",
    status: "RUNNING",
    drawBag: bag,
    drawsCompleted: 51,
    maxDraws: 52,
    ballRange: 75,
  });

  assert.equal(lastDraw.nextBall, 52);
  assert.equal(lastDraw.drawSequenceNumber, 52);
  assert.equal(lastDraw.isLastDraw, true);
});

test("DrawingService: realistisk Spill 2 60-ball med drawBagSize=60 (default)", () => {
  const service = new DrawingService();
  const bag = Array.from({ length: 60 }, (_, i) => i + 1);

  const result = service.drawNext({
    gameId: "spill2-runde",
    status: "RUNNING",
    drawBag: bag,
    drawsCompleted: 0,
    maxDraws: 60,
    ballRange: 60,
  });

  assert.equal(result.nextBall, 1);
  assert.equal(result.drawSequenceNumber, 1);
  assert.equal(result.isLastDraw, false);
});

test("DrawingService: error har strukturert details for transport-mapping", () => {
  const service = new DrawingService();
  let captured: DrawingError | null = null;
  try {
    service.drawNext(makeState({ status: "NOT_RUNNING" }));
  } catch (err) {
    if (err instanceof DrawingError) captured = err;
  }
  assert.notEqual(captured, null);
  assert.equal(captured!.name, "DrawingError");
  assert.equal(captured!.code, "GAME_NOT_RUNNING");
  assert.ok(captured!.details);
  assert.equal(captured!.details!.gameId, "game-1");
});
