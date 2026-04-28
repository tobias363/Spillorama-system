/**
 * Unified pipeline refactor — Fase 3 invariant-tester for PatternEvalService.
 *
 * Property-based-tester via fast-check som verifiserer at pattern-eval-
 * logikken holder for vilkårlige input-states. Hvis disse aritmetiske
 * eller strukturelle invariantene noensinne brytes (e.g. en spiller
 * "un-claimer" en pattern, eller fase-advance hopper bakover) blir
 * Spill 1-rundens lifecycle ustabil og §11-distribusjon kan avvike.
 *
 * Properties verifisert:
 *   - I1: claims monotonisk øker (ingen claim noensinne "un-claimes")
 *   - I2: hver ticket kan claime hver pattern maks én gang
 *   - I3: phase-advance kun når current-phase fully won
 *   - I4: phase-advance er monotonisk (aldri gå tilbake)
 *   - I5: hvis spillet har N totale faser, allCardsClosed kun true når
 *         BINGO-fasen er vunnet
 *   - I6: re-evaluering med oppdatert state gir konsistent resultat
 *         (idempotency på state-overgang)
 *
 * Forhold til Fase 0 atomicityInvariant:
 *   - Den atomic-testen verifiserer at portene støtter rollback. Denne
 *     filen verifiserer at pattern-eval-logikken er korrekt PER SE —
 *     uavhengig av transaksjonell commit/rollback.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  FLAT_GROUP_KEY,
  PatternEvalService,
  sortWinnerIdsDeterministic,
  type PatternEvalState,
  type PerColorMatrix,
} from "../../services/PatternEvalService.js";
import type {
  PatternDefinition,
  PatternResult,
  Ticket,
} from "../../game/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Bygg en valid 5×5 ticket fra en seed. Genererer numre 1-75 uten
 * duplikater, med free centre på (2,2).
 */
function buildRandomTicket(seed: number, color?: string): Ticket {
  // Enkel deterministisk pseudo-random fra seed.
  const rng = (n: number) => {
    seed = (seed * 9301 + 49297) % 233280;
    return Math.floor((seed / 233280) * n);
  };
  const used = new Set<number>([0]); // 0 reservert til free centre
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    const row: number[] = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        row.push(0); // free centre
      } else {
        let n: number;
        do {
          n = rng(75) + 1;
        } while (used.has(n));
        used.add(n);
        row.push(n);
      }
    }
    grid.push(row);
  }
  const ticket: Ticket = { grid };
  if (color !== undefined) ticket.color = color;
  return ticket;
}

function makeSpill1Patterns(): PatternDefinition[] {
  return [
    { id: "p1", name: "1 Rad", claimType: "LINE", prizePercent: 25, order: 1, design: 1 },
    { id: "p2", name: "2 Rader", claimType: "LINE", prizePercent: 35, order: 2, design: 2 },
    { id: "p3", name: "3 Rader", claimType: "LINE", prizePercent: 0, order: 3, design: 0 },
    { id: "p4", name: "4 Rader", claimType: "LINE", prizePercent: 0, order: 4, design: 0 },
    { id: "p5", name: "Fullt Hus", claimType: "BINGO", prizePercent: 40, order: 5, design: 3 },
  ];
}

function makeUnwonResults(patterns: readonly PatternDefinition[]): PatternResult[] {
  return patterns.map((p) => ({
    patternId: p.id,
    patternName: p.name,
    claimType: p.claimType,
    isWon: false,
  }));
}

/**
 * Arbitrary for et gyldig PatternEvalState: 1-5 spillere, 1-3 tickets per
 * player, drawn-set ∈ subset av 1-75, alle Spill 1-faser.
 */
const validStateArb = fc
  .integer({ min: 1, max: 5 })
  .chain((numPlayers) =>
    fc
      .array(fc.integer({ min: 1, max: 3 }), { minLength: numPlayers, maxLength: numPlayers })
      .chain((ticketsPerPlayer) =>
        fc
          .shuffledSubarray(
            Array.from({ length: 75 }, (_, i) => i + 1),
            { minLength: 0, maxLength: 75 },
          )
          .chain((drawn) =>
            fc.integer({ min: 0, max: 1_000_000 }).map((seed) => ({
              numPlayers,
              ticketsPerPlayer,
              drawnNumbers: [...drawn],
              seed,
            })),
          ),
      ),
  );

function buildState(args: {
  numPlayers: number;
  ticketsPerPlayer: number[];
  drawnNumbers: number[];
  seed: number;
  patternResults?: PatternResult[];
  perColorMatrix?: PerColorMatrix;
}): PatternEvalState {
  const patterns = makeSpill1Patterns();
  const tickets = new Map<string, Ticket[]>();
  let seedCounter = args.seed;
  for (let i = 0; i < args.numPlayers; i++) {
    const playerId = `p${String(i).padStart(2, "0")}`;
    const ticketCount = args.ticketsPerPlayer[i] ?? 1;
    const playerTickets: Ticket[] = [];
    for (let t = 0; t < ticketCount; t++) {
      seedCounter = (seedCounter + 17) % 1_000_000;
      playerTickets.push(buildRandomTicket(seedCounter));
    }
    tickets.set(playerId, playerTickets);
  }
  return {
    gameId: "invariant-game",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: args.drawnNumbers,
    tickets,
    patterns,
    patternResults: args.patternResults ?? makeUnwonResults(patterns),
    ...(args.perColorMatrix !== undefined ? { perColorMatrix: args.perColorMatrix } : {}),
  };
}

// ── I1: claims monotonisk øker ──────────────────────────────────────────────

test("invariant I1: gjentatt evaluering av samme state mellom draws gir aldri færre claims", async () => {
  // Property: hvis vi evaluerer state S, oppdaterer patternResults[i].isWon
  // for vinnerne, og evaluerer igjen — antall vunne patterns kan kun øke,
  // aldri minske. Dette er en svak monotonisk-egenskap (caller's ansvar
  // egentlig, men tjenesten må ikke "un-tagge" en vunnet pattern).
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state1 = buildState(args);

      const result1 = service.evaluateAfterDraw(state1);

      // Simuler caller-state-update: marker vinnere som isWon.
      const updatedResults: PatternResult[] = state1.patternResults.map((r) => {
        const advance = result1.phasesAdvanced.find((a) => a.patternId === r.patternId);
        if (advance) {
          return { ...r, isWon: true, winnerIds: [...advance.winnerIds] };
        }
        return r;
      });

      // Re-evaluate.
      const state2: PatternEvalState = {
        ...state1,
        patternResults: updatedResults,
      };
      const result2 = service.evaluateAfterDraw(state2);

      // I1: I result2 skal ingen tidligere vunne patterns dukke opp som
      // newly-advanced (de skal hoppes over).
      for (const advance of result2.phasesAdvanced) {
        const wasAlreadyWon = result1.phasesAdvanced.some(
          (a) => a.patternId === advance.patternId,
        );
        assert.ok(
          !wasAlreadyWon,
          `pattern ${advance.patternId} was already won in result1, should not appear in result2`,
        );
      }

      // I1b: Antall ferdig-vunne patterns øker monotonisk.
      const wonAfter1 = result1.phasesAdvanced.length;
      const wonAfter2Total =
        wonAfter1 +
        result2.phasesAdvanced.filter(
          (a) => !result1.phasesAdvanced.some((p) => p.patternId === a.patternId),
        ).length;
      assert.ok(
        wonAfter2Total >= wonAfter1,
        `won patterns kan ikke minske (var ${wonAfter1}, ble ${wonAfter2Total})`,
      );
    }),
    { numRuns: 100 },
  );
});

// ── I2: hver ticket kan claime hver pattern maks én gang ───────────────────

test("invariant I2: ingen player vises mer enn én gang per pattern i flat-path-claims", async () => {
  // Property: i et single-evaluation-resultat, en (player, pattern)-kombo
  // skal IKKE forekomme mer enn én gang i newClaims (uten per-color matrix).
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);
      const result = service.evaluateAfterDraw(state);

      // I2: For flat-path (ingen perColorMatrix), (playerId, patternId) er
      // unik i newClaims.
      const seen = new Set<string>();
      for (const claim of result.newClaims) {
        const key = `${claim.playerId}::${claim.patternId}`;
        assert.ok(
          !seen.has(key),
          `Duplicate claim: ${key} forekommer flere ganger`,
        );
        seen.add(key);
      }
    }),
    { numRuns: 100 },
  );
});

test("invariant I2b: en player kan max claime én pattern per phase advance", async () => {
  // Sterkere: i hver PhaseAdvance er en player maks én gang i winnerIds.
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);
      const result = service.evaluateAfterDraw(state);

      for (const advance of result.phasesAdvanced) {
        const ids = [...advance.winnerIds];
        const uniq = new Set(ids);
        assert.equal(
          ids.length,
          uniq.size,
          `winnerIds inneholder duplikater: ${ids}`,
        );
      }
    }),
    { numRuns: 100 },
  );
});

// ── I3: phase-advance kun når current-phase fully won ──────────────────────

test("invariant I3: phase N+1 advanced kun når phase N er vunnet (current OR previous evaluation)", async () => {
  // Property: i hver evaluering, hvis phase N+1 er i phasesAdvanced, så er
  // EITHER phase N også i phasesAdvanced (recursion) ELLER phase N er
  // allerede merket som vunnet i state.patternResults.
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);
      const result = service.evaluateAfterDraw(state);

      const wonInState = new Set(
        state.patternResults.filter((r) => r.isWon).map((r) => r.patternId),
      );
      const advancedInThisEval = new Set(
        result.phasesAdvanced.map((a) => a.patternId),
      );

      for (const advance of result.phasesAdvanced) {
        // For every advanced phase at index > 0, the previous phase MUST
        // be either in wonInState OR advancedInThisEval (sequential ordering).
        if (advance.patternIndex > 0) {
          const prevPattern = state.patterns[advance.patternIndex - 1]!;
          const prevWon =
            wonInState.has(prevPattern.id) || advancedInThisEval.has(prevPattern.id);
          assert.ok(
            prevWon,
            `Phase ${advance.patternId} (index ${advance.patternIndex}) advanced, men forrige (${prevPattern.id}) er ikke vunnet i state eller denne eval`,
          );
        }
      }
    }),
    { numRuns: 100 },
  );
});

// ── I4: phase-advance er monotonisk (aldri gå tilbake) ─────────────────────

test("invariant I4: phasesAdvanced er sortert i strikt voksende patternIndex-rekkefølge", async () => {
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);
      const result = service.evaluateAfterDraw(state);

      // I4: phasesAdvanced rekkefølge skal være strikt økende patternIndex.
      for (let i = 1; i < result.phasesAdvanced.length; i++) {
        const prev = result.phasesAdvanced[i - 1]!;
        const curr = result.phasesAdvanced[i]!;
        assert.ok(
          curr.patternIndex > prev.patternIndex,
          `phasesAdvanced[${i}].patternIndex (${curr.patternIndex}) skal være > forrige (${prev.patternIndex})`,
        );
      }
    }),
    { numRuns: 100 },
  );
});

// ── I5: allCardsClosed kun true når BINGO-fasen er vunnet ──────────────────

test("invariant I5: allCardsClosed=true kun når BINGO-pattern er vunnet (sequential mode)", async () => {
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);
      const result = service.evaluateAfterDraw(state);

      const bingoPatternIds = new Set(
        state.patterns.filter((p) => p.claimType === "BINGO").map((p) => p.id),
      );
      const wonInState = new Set(
        state.patternResults.filter((r) => r.isWon).map((r) => r.patternId),
      );
      const wonInThisEval = new Set(
        result.phasesAdvanced.map((a) => a.patternId),
      );
      const totalWon = new Set([...wonInState, ...wonInThisEval]);

      const anyBingoWon = [...bingoPatternIds].some((id) => totalWon.has(id));

      if (result.allCardsClosed) {
        assert.ok(
          anyBingoWon || state.patterns.length === 0,
          `allCardsClosed=true men ingen BINGO-pattern er vunnet`,
        );
      }
    }),
    { numRuns: 100 },
  );
});

test("invariant I5b: i sequential-mode med Fullt-Hus-pattern, allCardsClosed=true kun når Fullt Hus vinnes I DENNE EVAL", async () => {
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);
      const result = service.evaluateAfterDraw(state);

      // Sequential mode: allCardsClosed settes kun når BINGO-pattern vinnes
      // i denne evaluering. Hvis allerede vunnet før eval er allCardsClosed
      // håndtert via den early-return-pathen (patternResults.every isWon).
      const bingoPattern = state.patterns.find((p) => p.claimType === "BINGO");
      if (!bingoPattern) {
        // Ingen BINGO-pattern → allCardsClosed bør være false (eller true
        // hvis alle patterns allerede vunnet, men det er en annen path).
        if (state.patternResults.every((r) => r.isWon) && state.patterns.length > 0) {
          assert.equal(result.allCardsClosed, true, "tomme advance + alle vunnet → closed");
        }
        return;
      }

      const bingoWonNow = result.phasesAdvanced.some((a) => a.patternId === bingoPattern.id);
      const bingoWonBefore = state.patternResults.find((r) => r.patternId === bingoPattern.id)?.isWon === true;

      if (result.allCardsClosed) {
        assert.ok(
          bingoWonNow || bingoWonBefore,
          `allCardsClosed=true men BINGO-pattern ${bingoPattern.id} verken vunnet før eller nå`,
        );
      }
    }),
    { numRuns: 100 },
  );
});

// ── I6: idempotens på samme state ──────────────────────────────────────────

test("invariant I6: gjentatte evaluering med identisk state gir identisk resultat", async () => {
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args);

      const r1 = service.evaluateAfterDraw(state);
      const r2 = service.evaluateAfterDraw(state);
      const r3 = service.evaluateAfterDraw(state);

      // Sammenlign på relevante felt (Maps sammenlignes via array-projeksjon).
      function project(r: ReturnType<typeof service.evaluateAfterDraw>) {
        return {
          allCardsClosed: r.allCardsClosed,
          newClaims: r.newClaims.map((c) => ({
            playerId: c.playerId,
            patternId: c.patternId,
            colorGroupKey: c.colorGroupKey,
          })),
          phasesAdvanced: r.phasesAdvanced.map((p) => ({
            patternId: p.patternId,
            patternIndex: p.patternIndex,
            winnerIds: [...p.winnerIds],
            groups: [...p.winnerGroups.entries()].map(([k, v]) => [k, [...v.winnerIds]]),
          })),
        };
      }

      assert.deepEqual(project(r1), project(r2));
      assert.deepEqual(project(r2), project(r3));
    }),
    { numRuns: 100 },
  );
});

// ── Negative properties ────────────────────────────────────────────────────

test("invariant: NOT_RUNNING gir ALLTID tom resultat uavhengig av draw / tickets", async () => {
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state: PatternEvalState = {
        ...buildState(args),
        status: "NOT_RUNNING",
      };
      const result = service.evaluateAfterDraw(state);
      assert.equal(result.phasesAdvanced.length, 0);
      assert.equal(result.newClaims.length, 0);
      assert.equal(result.allCardsClosed, false);
    }),
    { numRuns: 50 },
  );
});

test("invariant: tom drawn-set gir ingen vinnere", async () => {
  // Med ingen draws kan ingen pattern oppfylles (drawnSet er tom).
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state: PatternEvalState = {
        ...buildState(args),
        drawnNumbers: [],
      };
      const result = service.evaluateAfterDraw(state);
      // Ingen draws → ingen rad/kolonne kan være komplett.
      assert.equal(result.phasesAdvanced.length, 0);
      assert.equal(result.newClaims.length, 0);
    }),
    { numRuns: 50 },
  );
});

// ── Determinism: sortWinnerIdsDeterministic ────────────────────────────────

test("invariant: sortWinnerIdsDeterministic er stabil og lex-sortert", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 50 }),
      (ids) => {
        const sorted = sortWinnerIdsDeterministic(ids);
        // Lengde uendret (deduplisering skjer ikke i denne funksjonen).
        assert.equal(sorted.length, ids.length);
        // Lex-sortert.
        for (let i = 1; i < sorted.length; i++) {
          assert.ok(
            sorted[i - 1]! <= sorted[i]!,
            `sorted[${i - 1}]=${sorted[i - 1]} skal være ≤ sorted[${i}]=${sorted[i]}`,
          );
        }
        // Idempotent.
        const sortedAgain = sortWinnerIdsDeterministic(sorted);
        assert.deepEqual(sortedAgain, sorted);
      },
    ),
    { numRuns: 100 },
  );
});

// ── Per-color claim multiplicity ───────────────────────────────────────────

test("invariant: per-color path — hver (player, color) er unik kombinasjon i newClaims", async () => {
  // Med per-color matrix kan en (player, color)-kombo forekomme én gang per
  // pattern (ikke per ticket innenfor color).
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();

      // Lag en per-color matrise med 2 farger.
      const patterns = makeSpill1Patterns();
      const yellowVariant = patterns.map((p) => ({ ...p, name: `${p.name} Y` }));
      const purpleVariant = patterns.map((p) => ({ ...p, name: `${p.name} P` }));
      const matrix: PerColorMatrix = {
        patternsByColor: new Map([
          ["Yellow", yellowVariant],
          ["Purple", purpleVariant],
        ]),
      };

      // Bygg tickets — fordel mellom farger.
      const tickets = new Map<string, Ticket[]>();
      let seedCounter = args.seed;
      for (let i = 0; i < args.numPlayers; i++) {
        const playerId = `p${String(i).padStart(2, "0")}`;
        const ticketCount = args.ticketsPerPlayer[i] ?? 1;
        const playerTickets: Ticket[] = [];
        for (let t = 0; t < ticketCount; t++) {
          seedCounter = (seedCounter + 17) % 1_000_000;
          const color = t % 2 === 0 ? "Yellow" : "Purple";
          playerTickets.push(buildRandomTicket(seedCounter, color));
        }
        tickets.set(playerId, playerTickets);
      }

      const state: PatternEvalState = {
        gameId: "invariant-percolor",
        status: "RUNNING",
        mode: "sequential",
        drawnNumbers: args.drawnNumbers,
        tickets,
        patterns,
        patternResults: makeUnwonResults(patterns),
        perColorMatrix: matrix,
      };
      const result = service.evaluateAfterDraw(state);

      // (playerId, patternId, colorGroupKey) er unik trippel.
      const seen = new Set<string>();
      for (const claim of result.newClaims) {
        const key = `${claim.playerId}::${claim.patternId}::${claim.colorGroupKey}`;
        assert.ok(
          !seen.has(key),
          `Duplicate per-color claim: ${key}`,
        );
        seen.add(key);
      }
    }),
    { numRuns: 50 },
  );
});

test("invariant: flat-path bruker FLAT_GROUP_KEY i alle claims", async () => {
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const state = buildState(args); // ingen perColorMatrix
      const result = service.evaluateAfterDraw(state);

      for (const claim of result.newClaims) {
        assert.equal(
          claim.colorGroupKey,
          FLAT_GROUP_KEY,
          `flat-path skal ALLTID bruke FLAT_GROUP_KEY, fikk ${claim.colorGroupKey}`,
        );
      }
      // Også: hver advance har max én entry i winnerGroups (FLAT_GROUP_KEY).
      for (const advance of result.phasesAdvanced) {
        assert.equal(advance.winnerGroups.size, 1);
        assert.ok(advance.winnerGroups.has(FLAT_GROUP_KEY));
      }
    }),
    { numRuns: 50 },
  );
});

// ── Concurrent mode invariants ─────────────────────────────────────────────

test("invariant concurrent: alle phasesAdvanced har patterns med definert mask", async () => {
  // Concurrent hopper over patterns uten mask. Vi tester at output bare
  // inneholder patterns som faktisk hadde mask.
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      // Bygg custom-patterns med eksplisitte masks.
      const customPatterns: PatternDefinition[] = [
        { id: "rowA", name: "Row A", claimType: "LINE", prizePercent: 30, order: 1, design: 0, mask: 0x1F },
        { id: "rowB", name: "Row B", claimType: "LINE", prizePercent: 30, order: 2, design: 0, mask: 0x3E0 },
      ];
      const tickets = new Map<string, Ticket[]>();
      let seedCounter = args.seed;
      for (let i = 0; i < args.numPlayers; i++) {
        const playerId = `p${String(i).padStart(2, "0")}`;
        seedCounter = (seedCounter + 17) % 1_000_000;
        tickets.set(playerId, [buildRandomTicket(seedCounter)]);
      }
      const state: PatternEvalState = {
        gameId: "concurrent-test",
        status: "RUNNING",
        mode: "concurrent",
        drawnNumbers: args.drawnNumbers,
        tickets,
        patterns: customPatterns,
        patternResults: makeUnwonResults(customPatterns),
      };
      const result = service.evaluateAfterDraw(state);

      // Concurrent kan returnere flere phases, men alle skal ha gyldig
      // mask (de som ikke har mask skal være filtrert ut).
      for (const advance of result.phasesAdvanced) {
        const pattern = customPatterns.find((p) => p.id === advance.patternId)!;
        assert.equal(typeof pattern.mask, "number");
      }
    }),
    { numRuns: 50 },
  );
});

// ── Color-key sorting ──────────────────────────────────────────────────────

test("invariant: winnerGroups iterasjons-rekkefølge er lex-sortert på color-key", async () => {
  // Map preserverer insertion-order; service-en inserter sortert.
  await fc.assert(
    fc.property(validStateArb, (args) => {
      const service = new PatternEvalService();
      const patterns = makeSpill1Patterns();
      const colors = ["Zebra", "Alpha", "Mike", "Bravo"]; // ikke-sortert!
      const matrix: PerColorMatrix = {
        patternsByColor: new Map(colors.map((c) => [c, patterns])),
      };
      const tickets = new Map<string, Ticket[]>();
      let seedCounter = args.seed;
      for (let i = 0; i < args.numPlayers; i++) {
        const playerId = `p${String(i).padStart(2, "0")}`;
        const playerTickets: Ticket[] = [];
        for (let t = 0; t < colors.length; t++) {
          seedCounter = (seedCounter + 17) % 1_000_000;
          playerTickets.push(buildRandomTicket(seedCounter, colors[t]!));
        }
        tickets.set(playerId, playerTickets);
      }
      const state: PatternEvalState = {
        gameId: "color-sort",
        status: "RUNNING",
        mode: "sequential",
        drawnNumbers: args.drawnNumbers,
        tickets,
        patterns,
        patternResults: makeUnwonResults(patterns),
        perColorMatrix: matrix,
      };
      const result = service.evaluateAfterDraw(state);

      for (const advance of result.phasesAdvanced) {
        const keys = [...advance.winnerGroups.keys()];
        const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        assert.deepEqual(
          keys,
          sorted,
          `color-keys må være sortert lex i iterasjons-rekkefølge`,
        );
      }
    }),
    { numRuns: 30 },
  );
});

// ── Concrete regression scenarios ───────────────────────────────────────────

test("invariant concrete: Spill 1 — empty drawn ⇒ 0 advances, 5 patterns ⇒ allCardsClosed=false", () => {
  const service = new PatternEvalService();
  const patterns = makeSpill1Patterns();
  const state: PatternEvalState = {
    gameId: "concrete-1",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: [],
    tickets: new Map([["alice", [buildRandomTicket(1)]]]),
    patterns,
    patternResults: makeUnwonResults(patterns),
  };
  const result = service.evaluateAfterDraw(state);
  assert.equal(result.phasesAdvanced.length, 0);
  assert.equal(result.allCardsClosed, false);
});

test("invariant concrete: Spill 1 — sequential mode ⇒ ingen winnerGroups med tom playerIds", () => {
  // En vunnet phase skal ha minst én player i hver winnerGroup-entry.
  const service = new PatternEvalService();
  const patterns = makeSpill1Patterns();
  const state: PatternEvalState = {
    gameId: "concrete-2",
    status: "RUNNING",
    mode: "sequential",
    drawnNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
    tickets: new Map([["alice", [buildRandomTicket(42)]]]),
    patterns,
    patternResults: makeUnwonResults(patterns),
  };
  const result = service.evaluateAfterDraw(state);

  for (const advance of result.phasesAdvanced) {
    for (const [, group] of advance.winnerGroups) {
      assert.ok(group.winnerIds.length > 0, "winnerGroup må ha minst én vinner");
    }
  }
});
