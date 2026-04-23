/**
 * BIN-MYSTERY M6: unit-tester for MiniGameMysteryEngine.
 *
 * Dekning:
 *   - parseMysteryConfig: tom config → default, malformed → throw.
 *   - getDigitAt: korrekt reversed-from-right lookup (index 0 = ones).
 *   - evaluateMysteryRound: alle paths (correct / wrong / joker), clamp.
 *   - sampleMysteryFiveDigitNumber: alltid i [10000, 99999].
 *   - trigger: korrekt payload-shape, deterministisk fra resultId-seed,
 *     ny resultId → typisk ny state.
 *   - handleChoice: rekonstruerer samme state som trigger, joker avslutter
 *     spillet tidlig, wrong-paths synker priceIndex, correct-paths øker,
 *     finalPriceIndex mapper til prizeListNok[index], INVALID_CHOICE ved
 *     ugyldig payload.
 *   - Determinisme: trigger + handleChoice gir konsistent state for samme
 *     resultId (seeded RNG).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MYSTERY_CONFIG,
  MYSTERY_MAX_ROUNDS,
  MiniGameMysteryEngine,
  evaluateMysteryRound,
  getDigitAt,
  parseMysteryConfig,
  sampleMysteryFiveDigitNumber,
  type MysteryDirection,
  type MysteryResultJson,
  type MysteryRng,
} from "./MiniGameMysteryEngine.js";
import type { MiniGameTriggerContext } from "./types.js";
import { DomainError } from "../BingoEngine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  configSnapshot: Readonly<Record<string, unknown>> = {},
  overrideResultId?: string,
): MiniGameTriggerContext {
  return {
    resultId: overrideResultId ?? "mgr-mystery-test-1",
    scheduledGameId: "sg-mystery-1",
    winnerUserId: "u-1",
    winnerWalletId: "w-1",
    hallId: "h-1",
    drawSequenceAtWin: 45,
    configSnapshot,
  };
}

/** Deterministisk RNG for tester. */
function makeSequencedRng(values: number[]): MysteryRng {
  let i = 0;
  return {
    nextInt: (max: number) => {
      if (i >= values.length) {
        throw new Error(
          `SequencedRng tømt etter ${values.length} kall (max=${max})`,
        );
      }
      const v = values[i]!;
      i += 1;
      if (v < 0 || v >= max) {
        throw new Error(
          `SequencedRng: value ${v} out-of-range for max ${max}`,
        );
      }
      return v;
    },
  };
}

// ── parseMysteryConfig ──────────────────────────────────────────────────────

test("BIN-MYSTERY M6: parseMysteryConfig — tom configSnapshot returnerer default", () => {
  assert.deepEqual(parseMysteryConfig({}), DEFAULT_MYSTERY_CONFIG);
});

test("BIN-MYSTERY M6: parseMysteryConfig — default har 6-trinns premie-stige + 20/10 timers", () => {
  assert.equal(DEFAULT_MYSTERY_CONFIG.prizeListNok.length, 6);
  assert.deepEqual(
    [...DEFAULT_MYSTERY_CONFIG.prizeListNok],
    [50, 100, 200, 400, 800, 1500],
  );
  assert.equal(DEFAULT_MYSTERY_CONFIG.autoTurnFirstMoveSec, 20);
  assert.equal(DEFAULT_MYSTERY_CONFIG.autoTurnOtherMoveSec, 10);
});

test("BIN-MYSTERY M6: parseMysteryConfig — config med kun 'active' faller tilbake til default", () => {
  assert.deepEqual(
    parseMysteryConfig({ active: true }),
    DEFAULT_MYSTERY_CONFIG,
  );
});

test("BIN-MYSTERY M6: parseMysteryConfig — aksepterer gyldig full config", () => {
  const cfg = parseMysteryConfig({
    prizeListNok: [0, 50, 100, 200, 500, 2000],
    autoTurnFirstMoveSec: 30,
    autoTurnOtherMoveSec: 15,
  });
  assert.deepEqual([...cfg.prizeListNok], [0, 50, 100, 200, 500, 2000]);
  assert.equal(cfg.autoTurnFirstMoveSec, 30);
  assert.equal(cfg.autoTurnOtherMoveSec, 15);
});

test("BIN-MYSTERY M6: parseMysteryConfig — prizeListNok av feil lengde → INVALID_MYSTERY_CONFIG", () => {
  assert.throws(
    () => parseMysteryConfig({ prizeListNok: [0, 50, 100] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
  assert.throws(
    () =>
      parseMysteryConfig({
        prizeListNok: [0, 50, 100, 200, 500, 2000, 5000],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
});

test("BIN-MYSTERY M6: parseMysteryConfig — prizeListNok ikke-array → INVALID_MYSTERY_CONFIG", () => {
  assert.throws(
    () =>
      parseMysteryConfig({
        prizeListNok: "not-an-array" as unknown as number[],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
});

test("BIN-MYSTERY M6: parseMysteryConfig — negativ prize-element → INVALID_MYSTERY_CONFIG", () => {
  assert.throws(
    () => parseMysteryConfig({ prizeListNok: [0, 50, -10, 200, 500, 2000] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
});

test("BIN-MYSTERY M6: parseMysteryConfig — ikke-heltall prize → INVALID_MYSTERY_CONFIG", () => {
  assert.throws(
    () => parseMysteryConfig({ prizeListNok: [0, 50, 100, 200, 500.5, 2000] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
});

test("BIN-MYSTERY M6: parseMysteryConfig — autoTurnFirstMoveSec <= 0 → INVALID_MYSTERY_CONFIG", () => {
  assert.throws(
    () => parseMysteryConfig({ autoTurnFirstMoveSec: 0 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
  assert.throws(
    () => parseMysteryConfig({ autoTurnFirstMoveSec: -5 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
});

test("BIN-MYSTERY M6: parseMysteryConfig — partial config merges med default", () => {
  const cfg = parseMysteryConfig({ autoTurnFirstMoveSec: 25 });
  assert.equal(cfg.autoTurnFirstMoveSec, 25);
  assert.equal(cfg.autoTurnOtherMoveSec, DEFAULT_MYSTERY_CONFIG.autoTurnOtherMoveSec);
  assert.deepEqual(
    [...cfg.prizeListNok],
    [...DEFAULT_MYSTERY_CONFIG.prizeListNok],
  );
});

// ── getDigitAt ──────────────────────────────────────────────────────────────

test("BIN-MYSTERY M6: getDigitAt — index 0 er ones-siffer (rightmost)", () => {
  assert.equal(getDigitAt(12345, 0), 5);
  assert.equal(getDigitAt(12345, 1), 4);
  assert.equal(getDigitAt(12345, 2), 3);
  assert.equal(getDigitAt(12345, 3), 2);
  assert.equal(getDigitAt(12345, 4), 1);
});

test("BIN-MYSTERY M6: getDigitAt — pad med leading zero for < 5-sifrede tall", () => {
  // "00042" → index 0 = 2, index 1 = 4, index 2 = 0, ...
  assert.equal(getDigitAt(42, 0), 2);
  assert.equal(getDigitAt(42, 1), 4);
  assert.equal(getDigitAt(42, 2), 0);
  assert.equal(getDigitAt(42, 3), 0);
  assert.equal(getDigitAt(42, 4), 0);
});

test("BIN-MYSTERY M6: getDigitAt — index out-of-range → INVALID_MYSTERY_STATE", () => {
  assert.throws(
    () => getDigitAt(12345, -1),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_STATE",
  );
  assert.throws(
    () => getDigitAt(12345, 5),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_STATE",
  );
});

// ── evaluateMysteryRound ─────────────────────────────────────────────────────

test("BIN-MYSTERY M6: evaluateMysteryRound — UP + result > middle → correct, priceIndex++", () => {
  const r = evaluateMysteryRound("up", 3, 7, 0);
  assert.equal(r.outcome, "correct");
  assert.equal(r.priceIndex, 1);
});

test("BIN-MYSTERY M6: evaluateMysteryRound — DOWN + result < middle → correct, priceIndex++", () => {
  const r = evaluateMysteryRound("down", 7, 3, 2);
  assert.equal(r.outcome, "correct");
  assert.equal(r.priceIndex, 3);
});

test("BIN-MYSTERY M6: evaluateMysteryRound — feil retning → wrong, priceIndex--", () => {
  const wrongUp = evaluateMysteryRound("up", 7, 3, 3);
  assert.equal(wrongUp.outcome, "wrong");
  assert.equal(wrongUp.priceIndex, 2);

  const wrongDown = evaluateMysteryRound("down", 3, 7, 3);
  assert.equal(wrongDown.outcome, "wrong");
  assert.equal(wrongDown.priceIndex, 2);
});

test("BIN-MYSTERY M6: evaluateMysteryRound — equal digits → joker, priceIndex = MAX", () => {
  const r = evaluateMysteryRound("up", 5, 5, 0);
  assert.equal(r.outcome, "joker");
  assert.equal(r.priceIndex, MYSTERY_MAX_ROUNDS);

  // Joker uansett direction (DOWN + equal).
  const r2 = evaluateMysteryRound("down", 5, 5, 2);
  assert.equal(r2.outcome, "joker");
  assert.equal(r2.priceIndex, MYSTERY_MAX_ROUNDS);
});

test("BIN-MYSTERY M6: evaluateMysteryRound — priceIndex clamped til [0, MAX]", () => {
  // Correct at max: holder seg på max.
  const max = evaluateMysteryRound(
    "up",
    0,
    9,
    MYSTERY_MAX_ROUNDS,
  );
  assert.equal(max.priceIndex, MYSTERY_MAX_ROUNDS);

  // Wrong at 0: holder seg på 0.
  const zero = evaluateMysteryRound("up", 9, 0, 0);
  assert.equal(zero.outcome, "wrong");
  assert.equal(zero.priceIndex, 0);
});

// ── sampleMysteryFiveDigitNumber ─────────────────────────────────────────────

test("BIN-MYSTERY M6: sampleMysteryFiveDigitNumber — alltid i [10000, 99999]", () => {
  // min-endepunkt: nextInt(90000) = 0 → 10000.
  const min = sampleMysteryFiveDigitNumber(makeSequencedRng([0]));
  assert.equal(min, 10000);
  // max-endepunkt: nextInt(90000) = 89999 → 99999.
  const max = sampleMysteryFiveDigitNumber(makeSequencedRng([89999]));
  assert.equal(max, 99999);
});

test("BIN-MYSTERY M6: sampleMysteryFiveDigitNumber — ekte tilfeldig er i range", () => {
  const rng: MysteryRng = {
    nextInt: (max: number) => Math.floor(Math.random() * max),
  };
  for (let i = 0; i < 1000; i += 1) {
    const n = sampleMysteryFiveDigitNumber(rng);
    assert.ok(n >= 10000 && n <= 99999, `out-of-range: ${n}`);
  }
});

// ── trigger ──────────────────────────────────────────────────────────────────

test("BIN-MYSTERY M6: trigger — returnerer korrekt payload-struktur for default-config", () => {
  const engine = new MiniGameMysteryEngine();
  const payload = engine.trigger(makeContext());
  assert.equal(payload.type, "mystery");
  assert.equal(payload.resultId, "mgr-mystery-test-1");
  assert.ok(typeof payload.timeoutSeconds === "number");
  const inner = payload.payload as Record<string, unknown>;
  assert.ok(
    typeof inner.middleNumber === "number" &&
      (inner.middleNumber as number) >= 10000 &&
      (inner.middleNumber as number) <= 99999,
  );
  assert.ok(
    typeof inner.resultNumber === "number" &&
      (inner.resultNumber as number) >= 10000 &&
      (inner.resultNumber as number) <= 99999,
  );
  assert.deepEqual(
    inner.prizeListNok,
    [...DEFAULT_MYSTERY_CONFIG.prizeListNok],
  );
  assert.equal(inner.autoTurnFirstMoveSec, 20);
  assert.equal(inner.autoTurnOtherMoveSec, 10);
  assert.equal(inner.maxRounds, MYSTERY_MAX_ROUNDS);
});

test("BIN-MYSTERY M6: trigger — deterministisk basert på resultId", () => {
  const engine = new MiniGameMysteryEngine();
  const p1 = engine.trigger(makeContext({}, "mgr-deterministic-mystery"));
  const p2 = engine.trigger(makeContext({}, "mgr-deterministic-mystery"));
  const i1 = p1.payload as Record<string, unknown>;
  const i2 = p2.payload as Record<string, unknown>;
  assert.equal(i1.middleNumber, i2.middleNumber);
  assert.equal(i1.resultNumber, i2.resultNumber);
});

test("BIN-MYSTERY M6: trigger — forskjellig resultId → typisk forskjellig state", () => {
  const engine = new MiniGameMysteryEngine();
  const states = new Set<string>();
  for (let i = 0; i < 10; i += 1) {
    const p = engine.trigger(makeContext({}, `mgr-mystery-uniq-${i}`));
    const inner = p.payload as Record<string, unknown>;
    states.add(`${inner.middleNumber}|${inner.resultNumber}`);
  }
  assert.ok(states.size > 1, "Forventer > 1 unike states over 10 resultIds");
});

test("BIN-MYSTERY M6: trigger — bruker admin-configSnapshot (override default)", () => {
  const engine = new MiniGameMysteryEngine();
  const payload = engine.trigger(
    makeContext({
      prizeListNok: [100, 200, 400, 800, 1600, 3200],
      autoTurnFirstMoveSec: 25,
      autoTurnOtherMoveSec: 15,
    }),
  );
  const inner = payload.payload as Record<string, unknown>;
  assert.deepEqual(inner.prizeListNok, [100, 200, 400, 800, 1600, 3200]);
  assert.equal(inner.autoTurnFirstMoveSec, 25);
  assert.equal(inner.autoTurnOtherMoveSec, 15);
});

test("BIN-MYSTERY M6: trigger — malformed config kaster INVALID_MYSTERY_CONFIG", () => {
  const engine = new MiniGameMysteryEngine();
  assert.throws(
    () =>
      engine.trigger(
        makeContext({
          prizeListNok: "not-an-array" as unknown as number[],
        }),
      ),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_MYSTERY_CONFIG",
  );
});

// ── handleChoice ─────────────────────────────────────────────────────────────

test("BIN-MYSTERY M6: handleChoice — manglende directions → INVALID_CHOICE", async () => {
  const engine = new MiniGameMysteryEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-mystery-test-1",
        context: makeContext(),
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-MYSTERY M6: handleChoice — directions ikke-array → INVALID_CHOICE", async () => {
  const engine = new MiniGameMysteryEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-mystery-test-1",
        context: makeContext(),
        choiceJson: { directions: "up" },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-MYSTERY M6: handleChoice — tom directions → INVALID_CHOICE", async () => {
  const engine = new MiniGameMysteryEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-mystery-test-1",
        context: makeContext(),
        choiceJson: { directions: [] },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-MYSTERY M6: handleChoice — for mange directions → INVALID_CHOICE", async () => {
  const engine = new MiniGameMysteryEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-mystery-test-1",
        context: makeContext(),
        choiceJson: {
          directions: ["up", "up", "up", "up", "up", "up"],
        },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-MYSTERY M6: handleChoice — ugyldig direction-verdi → INVALID_CHOICE", async () => {
  const engine = new MiniGameMysteryEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-mystery-test-1",
        context: makeContext(),
        choiceJson: { directions: ["up", "left"] },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-MYSTERY M6: handleChoice — rekonstruerer samme state som trigger", async () => {
  const engine = new MiniGameMysteryEngine();
  const ctx = makeContext({}, "mgr-state-recon-test");
  const triggerPayload = engine.trigger(ctx);
  const triggerInner = triggerPayload.payload as Record<string, unknown>;

  // Send 5 "up" → serveren bruker samme middleNumber + resultNumber.
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions: ["up", "up", "up", "up", "up"] },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  assert.equal(resultJson.middleNumber, triggerInner.middleNumber);
  assert.equal(resultJson.resultNumber, triggerInner.resultNumber);
});

test("BIN-MYSTERY M6: handleChoice — joker avslutter spillet tidlig (resterende directions ignoreres)", async () => {
  // Finn en resultId der første sammenligning er equal-digits (joker).
  // Vi prøver noen resultIds til vi finner en.
  const engine = new MiniGameMysteryEngine();
  let foundJokerAtRound = -1;
  let foundResultId = "";
  for (let i = 0; i < 500; i += 1) {
    const rid = `mgr-mystery-joker-hunt-${i}`;
    const p = engine.trigger(makeContext({}, rid));
    const inner = p.payload as Record<string, unknown>;
    const mid = inner.middleNumber as number;
    const res = inner.resultNumber as number;
    // Sjekk alle 5 digit-positions for equal.
    for (let d = 0; d < 5; d += 1) {
      if (getDigitAt(mid, d) === getDigitAt(res, d)) {
        foundJokerAtRound = d;
        foundResultId = rid;
        break;
      }
    }
    if (foundJokerAtRound >= 0) break;
  }
  assert.ok(foundJokerAtRound >= 0, "Fant ingen joker-seed (usannsynlig)");

  // Send 5 "up" — joker skal avslutte spillet på runde foundJokerAtRound.
  const ctx = makeContext({}, foundResultId);
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions: ["up", "up", "up", "up", "up"] },
  });
  const resultJson = result.resultJson as MysteryResultJson;

  // Hvis joker er på runde 0, er rounds.length = 1. Hvis på runde 2, rounds.length = 3.
  // Men kun hvis ingen tidligere runde var joker. Her ser vi etter FØRSTE joker.
  // Find first joker-round:
  let firstJokerIdx = -1;
  for (let d = 0; d < 5; d += 1) {
    const md = getDigitAt(
      resultJson.middleNumber,
      d,
    );
    const rd = getDigitAt(
      resultJson.resultNumber,
      d,
    );
    if (md === rd) {
      firstJokerIdx = d;
      break;
    }
  }
  assert.ok(firstJokerIdx >= 0, "Should have found a joker round");

  assert.equal(resultJson.rounds.length, firstJokerIdx + 1);
  assert.equal(resultJson.jokerTriggered, true);
  assert.equal(resultJson.finalPriceIndex, MYSTERY_MAX_ROUNDS);
  assert.equal(resultJson.rounds[firstJokerIdx]!.outcome, "joker");
});

test("BIN-MYSTERY M6: handleChoice — alle 5 correct → priceIndex=5, max premie", async () => {
  // Strategy: vi finner en resultId der vi kan velge directions slik at
  // alle 5 runder er correct (ingen joker). Sjekk hver digit-par og velg
  // riktig direction.
  const engine = new MiniGameMysteryEngine();
  let ctx: MiniGameTriggerContext | null = null;
  let directions: MysteryDirection[] = [];
  for (let i = 0; i < 500; i += 1) {
    const rid = `mgr-mystery-allcorrect-${i}`;
    const candidate = makeContext({}, rid);
    const p = engine.trigger(candidate);
    const inner = p.payload as Record<string, unknown>;
    const mid = inner.middleNumber as number;
    const res = inner.resultNumber as number;
    // Build optimal directions — skip if any digit is joker (equal).
    const dirs: MysteryDirection[] = [];
    let anyJoker = false;
    for (let d = 0; d < 5; d += 1) {
      const md = getDigitAt(mid, d);
      const rd = getDigitAt(res, d);
      if (md === rd) {
        anyJoker = true;
        break;
      }
      dirs.push(rd > md ? "up" : "down");
    }
    if (!anyJoker) {
      ctx = candidate;
      directions = dirs;
      break;
    }
  }
  assert.ok(ctx !== null, "Fant ingen helt-joker-fri seed (usannsynlig)");

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  assert.equal(resultJson.rounds.length, 5);
  assert.equal(resultJson.jokerTriggered, false);
  assert.equal(resultJson.finalPriceIndex, MYSTERY_MAX_ROUNDS);
  // prizeListNok[5] er max = 1500 kr default.
  assert.equal(
    resultJson.prizeAmountKroner,
    DEFAULT_MYSTERY_CONFIG.prizeListNok[MYSTERY_MAX_ROUNDS],
  );
  // payoutCents = 1500 * 100 = 150000.
  assert.equal(result.payoutCents, 150000);
  for (const r of resultJson.rounds) {
    assert.equal(r.outcome, "correct");
  }
});

test("BIN-MYSTERY M6: handleChoice — alle 5 wrong → priceIndex=0, minimum premie", async () => {
  // Strategy: invers av previous. Velg MOTSATT retning av optimal (med
  // mindre joker blokkerer).
  const engine = new MiniGameMysteryEngine();
  let ctx: MiniGameTriggerContext | null = null;
  let directions: MysteryDirection[] = [];
  for (let i = 0; i < 500; i += 1) {
    const rid = `mgr-mystery-allwrong-${i}`;
    const candidate = makeContext({}, rid);
    const p = engine.trigger(candidate);
    const inner = p.payload as Record<string, unknown>;
    const mid = inner.middleNumber as number;
    const res = inner.resultNumber as number;
    const dirs: MysteryDirection[] = [];
    let anyJoker = false;
    for (let d = 0; d < 5; d += 1) {
      const md = getDigitAt(mid, d);
      const rd = getDigitAt(res, d);
      if (md === rd) {
        anyJoker = true;
        break;
      }
      // Velg FEIL retning.
      dirs.push(rd > md ? "down" : "up");
    }
    if (!anyJoker) {
      ctx = candidate;
      directions = dirs;
      break;
    }
  }
  assert.ok(ctx !== null, "Fant ingen joker-fri seed");

  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  assert.equal(resultJson.rounds.length, 5);
  assert.equal(resultJson.jokerTriggered, false);
  // Alle wrong → priceIndex starter på 0, clamped → forblir 0.
  assert.equal(resultJson.finalPriceIndex, 0);
  // prizeListNok[0] = 50 kr default.
  assert.equal(
    resultJson.prizeAmountKroner,
    DEFAULT_MYSTERY_CONFIG.prizeListNok[0],
  );
  assert.equal(result.payoutCents, 50 * 100);
  for (const r of resultJson.rounds) {
    assert.equal(r.outcome, "wrong");
  }
});

test("BIN-MYSTERY M6: handleChoice — fewer than MAX directions → no penalty, bare partial-play", async () => {
  // Hvis klient sender færre directions (f.eks. 3), skal engine evaluere
  // kun de 3, og bruke resulterende priceIndex for payout.
  const engine = new MiniGameMysteryEngine();
  const ctx = makeContext({}, "mgr-mystery-partial-test");
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions: ["up", "up", "up"] },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  // Rounds skal være max 3 (pluss joker kan være tidligere, men usannsynlig
  // for denne spesifikke resultId — vi tester kun at det ikke krasjer og at
  // prizeAmountKroner finnes).
  assert.ok(resultJson.rounds.length <= 3);
  assert.ok(resultJson.finalPriceIndex >= 0);
  assert.ok(
    resultJson.finalPriceIndex <= MYSTERY_MAX_ROUNDS,
  );
  assert.ok(typeof resultJson.prizeAmountKroner === "number");
});

test("BIN-MYSTERY M6: handleChoice — payout reflekterer finalPriceIndex", async () => {
  // Sjekk at payoutCents = prizeListNok[finalPriceIndex] * 100.
  const engine = new MiniGameMysteryEngine();
  const ctx = makeContext({}, "mgr-mystery-payout-test");
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions: ["up", "down", "up", "down", "up"] },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  const expectedPayoutCents =
    DEFAULT_MYSTERY_CONFIG.prizeListNok[resultJson.finalPriceIndex]! * 100;
  assert.equal(result.payoutCents, expectedPayoutCents);
  assert.equal(
    resultJson.prizeAmountKroner,
    DEFAULT_MYSTERY_CONFIG.prizeListNok[resultJson.finalPriceIndex]!,
  );
});

test("BIN-MYSTERY M6: handleChoice — hvert round inneholder direction + middleDigit + resultDigit + outcome + priceIndexAfter", async () => {
  const engine = new MiniGameMysteryEngine();
  const ctx = makeContext({}, "mgr-mystery-rounds-shape");
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions: ["up", "up", "up", "up", "up"] },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  for (const r of resultJson.rounds) {
    assert.ok(r.direction === "up" || r.direction === "down");
    assert.ok(r.middleDigit >= 0 && r.middleDigit <= 9);
    assert.ok(r.resultDigit >= 0 && r.resultDigit <= 9);
    assert.ok(
      r.outcome === "correct" ||
        r.outcome === "wrong" ||
        r.outcome === "joker",
    );
    assert.ok(r.priceIndexAfter >= 0 && r.priceIndexAfter <= MYSTERY_MAX_ROUNDS);
  }
});

test("BIN-MYSTERY M6: type === 'mystery'", () => {
  const engine = new MiniGameMysteryEngine();
  assert.equal(engine.type, "mystery");
});

test("BIN-MYSTERY M6: handleChoice — admin-config prizeListNok overstyrer default", async () => {
  const engine = new MiniGameMysteryEngine();
  const customPrizes = [0, 100, 200, 400, 800, 10000];
  const ctx = makeContext(
    { prizeListNok: customPrizes },
    "mgr-mystery-custom-prize",
  );
  const result = await engine.handleChoice({
    resultId: ctx.resultId,
    context: ctx,
    choiceJson: { directions: ["up", "up", "up", "up", "up"] },
  });
  const resultJson = result.resultJson as MysteryResultJson;
  // prizeAmountKroner skal være fra customPrizes, ikke default.
  assert.equal(
    resultJson.prizeAmountKroner,
    customPrizes[resultJson.finalPriceIndex]!,
  );
});

// ── Integrasjon: trigger + handleChoice konsistens ──────────────────────────

test("BIN-MYSTERY M6 integration: trigger og handleChoice bruker samme middleNumber + resultNumber", async () => {
  // Kjør trigger, deretter handleChoice på samme resultId — verifiser at
  // serveren bruker samme state i begge faser (seeded-RNG-garanti).
  const engine = new MiniGameMysteryEngine();
  for (let i = 0; i < 20; i += 1) {
    const rid = `mgr-mystery-consistency-${i}`;
    const ctx = makeContext({}, rid);
    const triggerPayload = engine.trigger(ctx);
    const triggerInner = triggerPayload.payload as Record<string, unknown>;

    const result = await engine.handleChoice({
      resultId: ctx.resultId,
      context: ctx,
      choiceJson: { directions: ["up", "down", "up", "down", "up"] },
    });
    const resultJson = result.resultJson as MysteryResultJson;

    assert.equal(
      resultJson.middleNumber,
      triggerInner.middleNumber,
      `middleNumber mismatch for ${rid}`,
    );
    assert.equal(
      resultJson.resultNumber,
      triggerInner.resultNumber,
      `resultNumber mismatch for ${rid}`,
    );
  }
});
