/**
 * Unified pipeline refactor — Fase 2 invariant-tester for DrawingService.
 *
 * Property-based-tester via fast-check som verifiserer at draw-logikken
 * holder for vilkårlige input-states. Hvis denne aritmetikken noensinne
 * brytes (e.g. off-by-one i drawSequenceNumber, eller siste-draw-flag som
 * trigges feil) blir Spill 1-rundens lifecycle ustabil og settling-rapport
 * for §11-distribusjon kan avvike.
 *
 * Properties verifisert:
 *   - I1: drawn.length ≤ maxDraws (alltid, etter N successive draws)
 *   - I2: ingen duplikate baller i output-sekvensen (hvis bag har unike)
 *   - I3: hvert draw øker drawSequenceNumber med eksakt 1
 *   - I4: ball-verdier er innenfor [1, ballRange]
 *   - I5: deterministisk for samme seed (samme bag → samme output)
 *   - I6: isLastDraw=true presis når drawSequenceNumber == maxDraws
 *
 * Forhold til Fase 0 atomicityInvariant:
 *   - Den atomic-testen verifiserer at portene støtter rollback. Denne
 *     filen verifiserer at draw-logikken er korrekt PER SE — uavhengig av
 *     transaksjonel commit/rollback.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  DrawingError,
  DrawingService,
  type DrawingGameState,
} from "../../services/DrawingService.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Konstruér en gyldig `DrawingGameState` fra et bag-sett og en cap. Brukes
 * av flere properties — sentralisert så bag-shuffling er konsistent.
 */
function buildState(args: {
  drawBag: number[];
  drawsCompleted: number;
  maxDraws: number;
  ballRange: number;
  status?: DrawingGameState["status"];
  gameId?: string;
}): DrawingGameState {
  return {
    gameId: args.gameId ?? "invariant-game",
    status: args.status ?? "RUNNING",
    drawBag: args.drawBag,
    drawsCompleted: args.drawsCompleted,
    maxDraws: args.maxDraws,
    ballRange: args.ballRange,
  };
}

/**
 * Arbitrary for et gyldig (drawBag, maxDraws, ballRange)-tuple der:
 *   - ballRange ∈ [1, 100]
 *   - drawBag inneholder UNIKE verdier i [1, ballRange]
 *   - maxDraws ∈ [1, drawBag.length]
 *
 * Skipping: vi konstruerer drawBag fra en shuffled subset av 1..ballRange
 * for å garantere uniqueness (matcher buildDrawBag-output).
 */
const validStateArb = fc
  .integer({ min: 1, max: 100 })
  .chain((ballRange) =>
    fc
      .shuffledSubarray(
        Array.from({ length: ballRange }, (_, i) => i + 1),
        { minLength: 1, maxLength: ballRange },
      )
      .chain((drawBag) =>
        fc
          .integer({ min: 1, max: drawBag.length })
          .map((maxDraws) => ({
            drawBag: [...drawBag], // mutable kopi
            ballRange,
            maxDraws,
          })),
      ),
  );

// ── I1: drawn.length ≤ maxDraws ─────────────────────────────────────────────

test("invariant I1: etter N successive drawNext-kall er ant trekninger ≤ maxDraws", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      const drawn: number[] = [];
      let drawsCompleted = 0;

      // Trekk inntil maxDraws nådd, eller bag tom (skal være maxDraws først).
      while (drawsCompleted < maxDraws) {
        const state = buildState({
          drawBag,
          drawsCompleted,
          maxDraws,
          ballRange,
        });
        const result = service.drawNext(state);
        drawn.push(result.nextBall);
        drawsCompleted++;
      }

      // I1: drawn.length ≤ maxDraws.
      assert.ok(
        drawn.length <= maxDraws,
        `drawn.length=${drawn.length} skal være ≤ maxDraws=${maxDraws}`,
      );
      assert.equal(
        drawn.length,
        maxDraws,
        "Vi har trukket alle tillatte baller — drawn.length == maxDraws",
      );

      // Neste forsøk skal kaste MAX_DRAWS_REACHED.
      assert.throws(
        () =>
          service.drawNext(
            buildState({
              drawBag,
              drawsCompleted,
              maxDraws,
              ballRange,
            }),
          ),
        (err: unknown) =>
          err instanceof DrawingError && err.code === "MAX_DRAWS_REACHED",
      );
    }),
    { numRuns: 100 },
  );
});

// ── I2: ingen duplikater i output-sekvens ───────────────────────────────────

test("invariant I2: output-sekvensen inneholder ingen duplikate ball-verdier", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      const drawn: number[] = [];
      let drawsCompleted = 0;

      while (drawsCompleted < maxDraws) {
        const result = service.drawNext(
          buildState({ drawBag, drawsCompleted, maxDraws, ballRange }),
        );
        drawn.push(result.nextBall);
        drawsCompleted++;
      }

      // I2: alle verdier i drawn[] er unike (Set-størrelse == array-størrelse).
      const uniqueDrawn = new Set(drawn);
      assert.equal(
        uniqueDrawn.size,
        drawn.length,
        `drawn[] inneholder duplikat — set-size=${uniqueDrawn.size}, array-size=${drawn.length}`,
      );
    }),
    { numRuns: 100 },
  );
});

// ── I3: hvert draw øker drawSequenceNumber med eksakt 1 ─────────────────────

test("invariant I3: drawSequenceNumber øker monotont med 1 per draw", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      const sequences: number[] = [];
      let drawsCompleted = 0;

      while (drawsCompleted < maxDraws) {
        const result = service.drawNext(
          buildState({ drawBag, drawsCompleted, maxDraws, ballRange }),
        );
        sequences.push(result.drawSequenceNumber);
        drawsCompleted++;
      }

      // I3a: første sekvens = 1.
      assert.equal(sequences[0], 1, "første draw → sequence 1");

      // I3b: alle sekvenser øker med eksakt 1.
      for (let i = 1; i < sequences.length; i++) {
        assert.equal(
          sequences[i],
          sequences[i - 1]! + 1,
          `sequence[${i}] (${sequences[i]}) skal være sequence[${i - 1}] (${sequences[i - 1]}) + 1`,
        );
      }

      // I3c: siste sekvens = maxDraws.
      assert.equal(
        sequences[sequences.length - 1],
        maxDraws,
        "siste draw → sequence == maxDraws",
      );
    }),
    { numRuns: 100 },
  );
});

// ── I4: ball-verdier innenfor [1, ballRange] ────────────────────────────────

test("invariant I4: alle nextBall-verdier er innenfor [1, ballRange]", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      let drawsCompleted = 0;

      while (drawsCompleted < maxDraws) {
        const result = service.drawNext(
          buildState({ drawBag, drawsCompleted, maxDraws, ballRange }),
        );
        assert.ok(
          result.nextBall >= 1,
          `nextBall=${result.nextBall} skal være ≥ 1`,
        );
        assert.ok(
          result.nextBall <= ballRange,
          `nextBall=${result.nextBall} skal være ≤ ballRange=${ballRange}`,
        );
        assert.ok(
          Number.isInteger(result.nextBall),
          `nextBall=${result.nextBall} skal være heltall`,
        );
        drawsCompleted++;
      }
    }),
    { numRuns: 100 },
  );
});

// ── I5: determinisme — samme bag → samme output ─────────────────────────────

test("invariant I5: samme bag + samme drawsCompleted → samme nextBall (deterministisk)", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();

      // Trekk hele runden 3 ganger med ny instans hver gang.
      const runs: number[][] = [];
      for (let run = 0; run < 3; run++) {
        const localService = new DrawingService();
        const drawn: number[] = [];
        let drawsCompleted = 0;
        while (drawsCompleted < maxDraws) {
          const result = localService.drawNext(
            buildState({ drawBag, drawsCompleted, maxDraws, ballRange }),
          );
          drawn.push(result.nextBall);
          drawsCompleted++;
        }
        runs.push(drawn);
      }

      // Alle 3 runs er identiske.
      assert.deepEqual(runs[0], runs[1], "run 1 == run 2");
      assert.deepEqual(runs[1], runs[2], "run 2 == run 3");

      // Også: samme service-instans, gjentatt kall med samme state.
      const state = buildState({
        drawBag,
        drawsCompleted: 0,
        maxDraws,
        ballRange,
      });
      const firstResult = service.drawNext(state);
      for (let i = 0; i < 50; i++) {
        const r = service.drawNext(state);
        assert.deepEqual(r, firstResult, "samme state → samme resultat");
      }
    }),
    { numRuns: 50 },
  );
});

// ── I6: isLastDraw når drawSequenceNumber == maxDraws ───────────────────────

test("invariant I6: isLastDraw=true presis når drawSequenceNumber == maxDraws", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      let drawsCompleted = 0;

      while (drawsCompleted < maxDraws) {
        const result = service.drawNext(
          buildState({ drawBag, drawsCompleted, maxDraws, ballRange }),
        );
        const expectedLast = result.drawSequenceNumber >= maxDraws;
        assert.equal(
          result.isLastDraw,
          expectedLast,
          `isLastDraw=${result.isLastDraw} skal matche (sequence=${result.drawSequenceNumber} >= maxDraws=${maxDraws}) = ${expectedLast}`,
        );
        drawsCompleted++;
      }
    }),
    { numRuns: 100 },
  );
});

// ── Negative properties: invariant-brudd kastes som DrawingError ────────────

test("invariant: NOT_RUNNING-state kaster ALLTID GAME_NOT_RUNNING uansett drawsCompleted/maxDraws", async () => {
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      // Hvilken som helst drawsCompleted i [0, maxDraws] er gyldig.
      for (const drawsCompleted of [0, Math.floor(maxDraws / 2), maxDraws - 1]) {
        const state = buildState({
          drawBag,
          drawsCompleted,
          maxDraws,
          ballRange,
          status: "NOT_RUNNING",
        });
        assert.throws(
          () => service.drawNext(state),
          (err: unknown) =>
            err instanceof DrawingError && err.code === "GAME_NOT_RUNNING",
        );
      }
    }),
    { numRuns: 50 },
  );
});

test("invariant: drawn-output matcher drawBag-prefix av lengde maxDraws", async () => {
  // I1+I2+I5 kombinert: hva vi trekker er nøyaktig de første `maxDraws`
  // elementene fra drawBag (siden bag er pre-shuffled og service-en
  // ikke mutere noe).
  await fc.assert(
    fc.property(validStateArb, ({ drawBag, ballRange, maxDraws }) => {
      const service = new DrawingService();
      const drawn: number[] = [];
      let drawsCompleted = 0;

      while (drawsCompleted < maxDraws) {
        const result = service.drawNext(
          buildState({ drawBag, drawsCompleted, maxDraws, ballRange }),
        );
        drawn.push(result.nextBall);
        drawsCompleted++;
      }

      // Output == drawBag.slice(0, maxDraws).
      const expected = drawBag.slice(0, maxDraws);
      assert.deepEqual(
        drawn,
        expected,
        "trukket sekvens = drawBag.slice(0, maxDraws)",
      );
    }),
    { numRuns: 100 },
  );
});

// ── Concrete regression scenarios ───────────────────────────────────────────

test("invariant: Spill 1 75-ball / maxDraws=52 — drawer 52 baller, isLastDraw kun på siste", () => {
  // Konkret prod-scenario fra Game1DrawEngineService.
  const service = new DrawingService();
  const bag = Array.from({ length: 75 }, (_, i) => i + 1);
  const drawn: number[] = [];
  const lastFlags: boolean[] = [];

  for (let i = 0; i < 52; i++) {
    const result = service.drawNext({
      gameId: "spill1-prod",
      status: "RUNNING",
      drawBag: bag,
      drawsCompleted: i,
      maxDraws: 52,
      ballRange: 75,
    });
    drawn.push(result.nextBall);
    lastFlags.push(result.isLastDraw);
  }

  // Alle flagg false unntatt siste.
  for (let i = 0; i < 51; i++) {
    assert.equal(lastFlags[i], false, `i=${i}: ikke siste`);
  }
  assert.equal(lastFlags[51], true, "siste draw");

  // Drawn er prefix-en av bag.
  assert.deepEqual(drawn, bag.slice(0, 52));
});

test("invariant: Spill 2 60-ball / maxDraws=60 — 60 baller, alle unike, siste = sequence 60", () => {
  const service = new DrawingService();
  const bag = Array.from({ length: 60 }, (_, i) => i + 1);
  const drawn: number[] = [];

  for (let i = 0; i < 60; i++) {
    const result = service.drawNext({
      gameId: "spill2-prod",
      status: "RUNNING",
      drawBag: bag,
      drawsCompleted: i,
      maxDraws: 60,
      ballRange: 60,
    });
    drawn.push(result.nextBall);
    if (i === 59) {
      assert.equal(result.drawSequenceNumber, 60);
      assert.equal(result.isLastDraw, true);
    }
  }

  assert.equal(new Set(drawn).size, 60, "alle 60 unike");
});
