/**
 * BIN-690 Spor 3 M3: unit-tester for MiniGameChestEngine.
 *
 * Dekning:
 *   - parseChestConfig: tom config → default, malformed → throw, gyldig
 *     passes through (med og uten discreteTiers).
 *   - sampleChestValue + sampleChestValues: uniform og weighted sampling,
 *     deterministisk med injected RNG.
 *   - trigger: returnerer korrekt payload-shape, bruker configSnapshot,
 *     avslører IKKE faktiske verdier.
 *   - handleChoice: server-autoritativ RNG, payoutCents = amount*100,
 *     resultJson komplett, INVALID_CHOICE ved ugyldig index.
 *   - RNG-fordeling: 10 000 trekninger gir fordeling ≈ uniform over range.
 *   - Klient kan IKKE lede verdien — samme RNG-seed gir samme verdier
 *     uavhengig av hva klienten sender.
 *   - Determinisme via injected RNG (samme seed → samme utfall).
 *   - type === "chest"-konstant.
 *
 * Integrasjonstester ligger i `MiniGameChestEngine.integration.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CHEST_CONFIG,
  MiniGameChestEngine,
  parseChestConfig,
  sampleChestValue,
  sampleChestValues,
  type ChestConfig,
  type ChestResultJson,
  type ChestRng,
} from "./MiniGameChestEngine.js";
import type { MiniGameTriggerContext } from "./types.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  configSnapshot: Readonly<Record<string, unknown>> = {},
): MiniGameTriggerContext {
  return {
    resultId: "mgr-chest-test-1",
    scheduledGameId: "sg-chest-1",
    winnerUserId: "u-1",
    winnerWalletId: "w-1",
    hallId: "h-1",
    drawSequenceAtWin: 45,
    configSnapshot,
  };
}

/** Deterministisk RNG for tester. Returnerer sekvens av forhåndsbestemte verdier. */
function makeSequencedRng(values: number[]): ChestRng {
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

// ── parseChestConfig ─────────────────────────────────────────────────────────

test("BIN-690 M3: parseChestConfig — tom configSnapshot returnerer default", () => {
  assert.deepEqual(parseChestConfig({}), DEFAULT_CHEST_CONFIG);
});

test("BIN-690 M3: parseChestConfig — default har 6 luker og range 400-4000 (spec-paritet)", () => {
  assert.equal(DEFAULT_CHEST_CONFIG.numberOfChests, 6);
  assert.equal(DEFAULT_CHEST_CONFIG.prizeRange.minNok, 400);
  assert.equal(DEFAULT_CHEST_CONFIG.prizeRange.maxNok, 4000);
});

test("BIN-690 M3: parseChestConfig — kun 'active' i config faller tilbake til default", () => {
  assert.deepEqual(
    parseChestConfig({ active: true }),
    DEFAULT_CHEST_CONFIG,
  );
});

test("BIN-690 M3: parseChestConfig — aksepterer gyldig uniform config", () => {
  const cfg = parseChestConfig({
    numberOfChests: 8,
    prizeRange: { minNok: 500, maxNok: 5000 },
  });
  assert.equal(cfg.numberOfChests, 8);
  assert.equal(cfg.prizeRange.minNok, 500);
  assert.equal(cfg.prizeRange.maxNok, 5000);
  assert.equal(cfg.discreteTiers, undefined);
});

test("BIN-690 M3: parseChestConfig — aksepterer gyldig discreteTiers", () => {
  const cfg = parseChestConfig({
    numberOfChests: 6,
    prizeRange: { minNok: 0, maxNok: 0 },
    discreteTiers: [
      { amount: 500, weight: 3 },
      { amount: 1000, weight: 2 },
      { amount: 4000, weight: 1 },
    ],
  });
  assert.equal(cfg.numberOfChests, 6);
  assert.ok(cfg.discreteTiers);
  assert.equal(cfg.discreteTiers!.length, 3);
  assert.equal(cfg.discreteTiers![0]!.amount, 500);
  assert.equal(cfg.discreteTiers![0]!.weight, 3);
});

test("BIN-690 M3: parseChestConfig — numberOfChests < 2 → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () => parseChestConfig({ numberOfChests: 1 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — non-integer numberOfChests → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () => parseChestConfig({ numberOfChests: 6.5 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — negativ minNok → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () =>
      parseChestConfig({
        numberOfChests: 6,
        prizeRange: { minNok: -100, maxNok: 4000 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — minNok > maxNok → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () =>
      parseChestConfig({
        numberOfChests: 6,
        prizeRange: { minNok: 5000, maxNok: 1000 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — prizeRange ikke objekt → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () =>
      parseChestConfig({
        numberOfChests: 6,
        prizeRange: "oops" as unknown as object,
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — tom discreteTiers-array → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () =>
      parseChestConfig({
        numberOfChests: 6,
        discreteTiers: [],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — discreteTiers.weight < 1 → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () =>
      parseChestConfig({
        numberOfChests: 6,
        discreteTiers: [{ amount: 1000, weight: 0 }],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — discreteTiers.amount negativ → INVALID_CHEST_CONFIG", () => {
  assert.throws(
    () =>
      parseChestConfig({
        numberOfChests: 6,
        discreteTiers: [{ amount: -100, weight: 1 }],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

test("BIN-690 M3: parseChestConfig — 0-amount discrete tier er gyldig (tom-luke)", () => {
  const cfg = parseChestConfig({
    numberOfChests: 3,
    discreteTiers: [
      { amount: 0, weight: 1 },
      { amount: 1000, weight: 1 },
    ],
  });
  assert.equal(cfg.discreteTiers![0]!.amount, 0);
});

test("BIN-690 M3: parseChestConfig — minNok = maxNok er gyldig (alle luker samme beløp)", () => {
  const cfg = parseChestConfig({
    numberOfChests: 6,
    prizeRange: { minNok: 1000, maxNok: 1000 },
  });
  assert.equal(cfg.prizeRange.minNok, 1000);
  assert.equal(cfg.prizeRange.maxNok, 1000);
});

// ── sampleChestValue (uniform) ───────────────────────────────────────────────

test("BIN-690 M3: sampleChestValue — uniform range, RNG returnerer 0 → minNok", () => {
  const cfg = parseChestConfig({
    numberOfChests: 6,
    prizeRange: { minNok: 400, maxNok: 4000 },
  });
  const rng = makeSequencedRng([0]);
  assert.equal(sampleChestValue(cfg, rng), 400);
});

test("BIN-690 M3: sampleChestValue — uniform range, RNG returnerer span-1 → maxNok", () => {
  // span = 4000 - 400 + 1 = 3601. nextInt returnerer 3600 → minNok + 3600 = 4000.
  const cfg = parseChestConfig({
    numberOfChests: 6,
    prizeRange: { minNok: 400, maxNok: 4000 },
  });
  const rng = makeSequencedRng([3600]);
  assert.equal(sampleChestValue(cfg, rng), 4000);
});

test("BIN-690 M3: sampleChestValue — minNok === maxNok → alltid samme verdi", () => {
  const cfg = parseChestConfig({
    numberOfChests: 6,
    prizeRange: { minNok: 1000, maxNok: 1000 },
  });
  const rng = makeSequencedRng([0, 0, 0]);
  assert.equal(sampleChestValue(cfg, rng), 1000);
  assert.equal(sampleChestValue(cfg, rng), 1000);
  assert.equal(sampleChestValue(cfg, rng), 1000);
});

// ── sampleChestValue (weighted discreteTiers) ────────────────────────────────

test("BIN-690 M3: sampleChestValue — weighted-sampling tier 0 ved pick 0", () => {
  const cfg: ChestConfig = {
    numberOfChests: 6,
    prizeRange: { minNok: 0, maxNok: 0 },
    discreteTiers: [
      { amount: 500, weight: 3 },
      { amount: 1000, weight: 2 },
      { amount: 4000, weight: 1 },
    ],
  };
  // total weight = 6. pick=0 → tier 0 (500).
  const rng = makeSequencedRng([0]);
  assert.equal(sampleChestValue(cfg, rng), 500);
});

test("BIN-690 M3: sampleChestValue — weighted-sampling tier 0 grensetilfelle pick=2", () => {
  const cfg: ChestConfig = {
    numberOfChests: 6,
    prizeRange: { minNok: 0, maxNok: 0 },
    discreteTiers: [
      { amount: 500, weight: 3 }, // 0-2
      { amount: 1000, weight: 2 }, // 3-4
      { amount: 4000, weight: 1 }, // 5
    ],
  };
  // pick=2 er siste i tier 0.
  const rng = makeSequencedRng([2]);
  assert.equal(sampleChestValue(cfg, rng), 500);
});

test("BIN-690 M3: sampleChestValue — weighted-sampling tier 1 ved pick 3", () => {
  const cfg: ChestConfig = {
    numberOfChests: 6,
    prizeRange: { minNok: 0, maxNok: 0 },
    discreteTiers: [
      { amount: 500, weight: 3 },
      { amount: 1000, weight: 2 },
      { amount: 4000, weight: 1 },
    ],
  };
  const rng = makeSequencedRng([3]);
  assert.equal(sampleChestValue(cfg, rng), 1000);
});

test("BIN-690 M3: sampleChestValue — weighted-sampling tier 2 (siste) ved pick 5", () => {
  const cfg: ChestConfig = {
    numberOfChests: 6,
    prizeRange: { minNok: 0, maxNok: 0 },
    discreteTiers: [
      { amount: 500, weight: 3 },
      { amount: 1000, weight: 2 },
      { amount: 4000, weight: 1 },
    ],
  };
  const rng = makeSequencedRng([5]);
  assert.equal(sampleChestValue(cfg, rng), 4000);
});

// ── sampleChestValues ────────────────────────────────────────────────────────

test("BIN-690 M3: sampleChestValues — returnerer N verdier", () => {
  const cfg = parseChestConfig({
    numberOfChests: 3,
    prizeRange: { minNok: 100, maxNok: 200 },
  });
  const rng = makeSequencedRng([0, 50, 100]);
  const values = sampleChestValues(cfg, rng);
  assert.deepEqual(values, [100, 150, 200]);
});

test("BIN-690 M3: sampleChestValues — default-config returnerer 6 verdier", () => {
  const rng = makeSequencedRng([0, 100, 200, 300, 400, 500]);
  const values = sampleChestValues(DEFAULT_CHEST_CONFIG, rng);
  assert.equal(values.length, 6);
});

// ── trigger ──────────────────────────────────────────────────────────────────

test("BIN-690 M3: trigger — returnerer korrekt payload-struktur for default-config", () => {
  const engine = new MiniGameChestEngine();
  const payload = engine.trigger(makeContext());
  assert.equal(payload.type, "chest");
  assert.equal(payload.resultId, "mgr-chest-test-1");
  assert.equal(payload.timeoutSeconds, 60);
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.chestCount, 6);
  assert.deepEqual(inner.prizeRange, { minNok: 400, maxNok: 4000 });
  assert.equal(inner.hasDiscreteTiers, false);
});

test("BIN-690 M3: trigger — avslører IKKE faktiske verdier (anti-juks)", () => {
  const engine = new MiniGameChestEngine();
  const payload = engine.trigger(makeContext());
  const inner = payload.payload as Record<string, unknown>;
  // Ingen allValues / values / amounts felter avslørt.
  assert.equal(inner.allValues, undefined);
  assert.equal(inner.values, undefined);
  assert.equal(inner.amounts, undefined);
  assert.equal(inner.prizes, undefined);
});

test("BIN-690 M3: trigger — bruker admin-configSnapshot (override default)", () => {
  const engine = new MiniGameChestEngine();
  const payload = engine.trigger(
    makeContext({
      numberOfChests: 10,
      prizeRange: { minNok: 1000, maxNok: 10000 },
    }),
  );
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.chestCount, 10);
  assert.deepEqual(inner.prizeRange, { minNok: 1000, maxNok: 10000 });
});

test("BIN-690 M3: trigger — discrete-tiers config setter hasDiscreteTiers=true", () => {
  const engine = new MiniGameChestEngine();
  const payload = engine.trigger(
    makeContext({
      numberOfChests: 6,
      prizeRange: { minNok: 0, maxNok: 0 },
      discreteTiers: [
        { amount: 500, weight: 1 },
        { amount: 1000, weight: 1 },
      ],
    }),
  );
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.hasDiscreteTiers, true);
});

test("BIN-690 M3: trigger — malformed config kaster INVALID_CHEST_CONFIG", () => {
  const engine = new MiniGameChestEngine();
  assert.throws(
    () =>
      engine.trigger(
        makeContext({
          numberOfChests: "not-a-number" as unknown as number,
        }),
      ),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHEST_CONFIG",
  );
});

// ── handleChoice ─────────────────────────────────────────────────────────────

test("BIN-690 M3: handleChoice — happy-path, chosenIndex=0, default-config", async () => {
  // 6 luker, vi trekker verdier 0, 100, 200, 300, 400, 500 fra RNG
  // (span=3601). Alle verdier blir minNok + rng → 400, 500, 600, 700, 800, 900.
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 100, 200, 300, 400, 500]),
  });
  const result = await engine.handleChoice({
    resultId: "mgr-test-1",
    context: makeContext(),
    choiceJson: { chosenIndex: 0 },
  });
  const json = result.resultJson as ChestResultJson;
  assert.equal(json.chosenIndex, 0);
  assert.equal(json.prizeAmountKroner, 400);
  assert.equal(json.chestCount, 6);
  assert.deepEqual(json.allValuesKroner, [400, 500, 600, 700, 800, 900]);
  assert.equal(result.payoutCents, 40_000); // 400 kr * 100 = 40 000 øre.
});

test("BIN-690 M3: handleChoice — chosenIndex midt i array velger riktig verdi", async () => {
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 100, 200, 300, 400, 500]),
  });
  const result = await engine.handleChoice({
    resultId: "mgr-test-1",
    context: makeContext(),
    choiceJson: { chosenIndex: 3 },
  });
  const json = result.resultJson as ChestResultJson;
  assert.equal(json.chosenIndex, 3);
  // values = [400, 500, 600, 700, 800, 900] → index 3 = 700.
  assert.equal(json.prizeAmountKroner, 700);
  assert.equal(result.payoutCents, 70_000);
});

test("BIN-690 M3: handleChoice — chosenIndex = chestCount-1 (siste luke)", async () => {
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 100, 200, 300, 400, 500]),
  });
  const result = await engine.handleChoice({
    resultId: "mgr-test-1",
    context: makeContext(),
    choiceJson: { chosenIndex: 5 },
  });
  const json = result.resultJson as ChestResultJson;
  assert.equal(json.chosenIndex, 5);
  // values = [400, 500, 600, 700, 800, 900] → index 5 = 900.
  assert.equal(json.prizeAmountKroner, 900);
});

test("BIN-690 M3: handleChoice — manglende chosenIndex → INVALID_CHOICE", async () => {
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0]),
  });
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M3: handleChoice — negativ chosenIndex → INVALID_CHOICE", async () => {
  const engine = new MiniGameChestEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: { chosenIndex: -1 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M3: handleChoice — chosenIndex >= chestCount → INVALID_CHOICE", async () => {
  const engine = new MiniGameChestEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(), // default = 6 luker, gyldig er 0-5.
        choiceJson: { chosenIndex: 6 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M3: handleChoice — chosenIndex ikke-heltall (float) → INVALID_CHOICE", async () => {
  const engine = new MiniGameChestEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: { chosenIndex: 2.5 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M3: handleChoice — chosenIndex string → INVALID_CHOICE", async () => {
  const engine = new MiniGameChestEngine();
  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-test-1",
        context: makeContext(),
        choiceJson: { chosenIndex: "0" as unknown as number },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M3: handleChoice — klient kan IKKE lede verdien (anti-juks)", async () => {
  // Klient sender `hopefulValue: 99999` men det ignoreres. Server bruker
  // egen RNG.
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 100, 200, 300, 400, 500]),
  });
  const result = await engine.handleChoice({
    resultId: "mgr-test-1",
    context: makeContext(),
    choiceJson: {
      chosenIndex: 2,
      hopefulValue: 99999,
      cheat: true,
      prizeAmountKroner: 999999,
    },
  });
  const json = result.resultJson as ChestResultJson;
  // index 2 → values[2] = 400 + 200 = 600. Klientens "hopefulValue" ignoreres.
  assert.equal(json.prizeAmountKroner, 600);
  assert.equal(result.payoutCents, 60_000);
});

test("BIN-690 M3: handleChoice — determinisme med injected RNG (samme seed → samme utfall)", async () => {
  const engine1 = new MiniGameChestEngine({
    rng: makeSequencedRng([17, 42, 100, 200, 300, 400]),
  });
  const engine2 = new MiniGameChestEngine({
    rng: makeSequencedRng([17, 42, 100, 200, 300, 400]),
  });
  const r1 = await engine1.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    choiceJson: { chosenIndex: 0 },
  });
  const r2 = await engine2.handleChoice({
    resultId: "r-2",
    context: makeContext(),
    choiceJson: { chosenIndex: 0 },
  });
  assert.deepEqual(r1.resultJson, r2.resultJson);
  assert.equal(r1.payoutCents, r2.payoutCents);
});

test("BIN-690 M3: handleChoice — 0-amount discrete tier gir payoutCents=0", async () => {
  // Weighted config: 50% 0, 50% 1000. Med rng returning 0 → 0.
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 0, 0]),
  });
  const result = await engine.handleChoice({
    resultId: "r-zero",
    context: makeContext({
      numberOfChests: 3,
      prizeRange: { minNok: 0, maxNok: 0 },
      discreteTiers: [
        { amount: 0, weight: 1 },
        { amount: 1000, weight: 1 },
      ],
    }),
    choiceJson: { chosenIndex: 0 },
  });
  assert.equal(result.payoutCents, 0);
  const json = result.resultJson as ChestResultJson;
  assert.equal(json.prizeAmountKroner, 0);
});

test("BIN-690 M3: handleChoice — admin-config discreteTiers velges riktig via weights", async () => {
  const config = {
    numberOfChests: 3,
    prizeRange: { minNok: 0, maxNok: 0 },
    discreteTiers: [
      { amount: 4000, weight: 1 }, // 0
      { amount: 1000, weight: 2 }, // 1-2
    ],
  };
  // Trek for 3 luker: 0 → 4000, 1 → 1000, 2 → 1000.
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 1, 2]),
  });
  const r = await engine.handleChoice({
    resultId: "r-1",
    context: makeContext(config),
    choiceJson: { chosenIndex: 0 },
  });
  const json = r.resultJson as ChestResultJson;
  assert.deepEqual(json.allValuesKroner, [4000, 1000, 1000]);
  assert.equal(json.prizeAmountKroner, 4000);
  assert.equal(r.payoutCents, 400_000);
});

test("BIN-690 M3: handleChoice — RNG-fordeling er uniform (10k runs, range 100-200)", async () => {
  // Vi genererer mange values og sjekker fordeling.
  const N = 10_000;
  const counts = new Map<number, number>();
  const rng: ChestRng = {
    nextInt: (max: number) => Math.floor(Math.random() * max),
  };
  const engine = new MiniGameChestEngine({ rng });

  for (let i = 0; i < N; i += 1) {
    const res = await engine.handleChoice({
      resultId: `r-${i}`,
      context: makeContext({
        numberOfChests: 2,
        prizeRange: { minNok: 100, maxNok: 200 },
      }),
      choiceJson: { chosenIndex: 0 },
    });
    const json = res.resultJson as ChestResultJson;
    const v = json.prizeAmountKroner;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Forventet: 101 verdier (100-200), ca N/101 ≈ 99 per verdi.
  // Sjekk at alle 101 verdier vises minst én gang (coverage av range).
  // Toleranse: på N=10 000 er forventet per bucket 99, ±3σ ca ±30.
  const expectedPerBucket = N / 101;
  const minAcceptable = expectedPerBucket * 0.5; // ≈ 50
  const maxAcceptable = expectedPerBucket * 1.5; // ≈ 150
  let seenBuckets = 0;
  for (const [_v, count] of counts) {
    seenBuckets += 1;
    assert.ok(
      count >= minAcceptable,
      `Bucket har ${count} hits, forventet >= ${minAcceptable}`,
    );
    assert.ok(
      count <= maxAcceptable,
      `Bucket har ${count} hits, forventet <= ${maxAcceptable}`,
    );
  }
  // Alle 101 verdier skal være representert (med høy sannsynlighet).
  assert.ok(
    seenBuckets >= 95,
    `Kun ${seenBuckets} unike verdier av forventet ≈101`,
  );
});

test("BIN-690 M3: handleChoice — nextInt kalles numberOfChests ganger (én per luke)", async () => {
  const calls: number[] = [];
  const rng: ChestRng = {
    nextInt: (max: number) => {
      calls.push(max);
      return 0;
    },
  };
  const engine = new MiniGameChestEngine({ rng });
  await engine.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    choiceJson: { chosenIndex: 0 },
  });
  // Default = 6 luker → 6 nextInt-kall.
  assert.equal(calls.length, 6);
  // Hver med samme max = span = 4000 - 400 + 1 = 3601.
  for (const c of calls) {
    assert.equal(c, 3601);
  }
});

test("BIN-690 M3: handleChoice — alle luker i default-config får verdi i [400, 4000]", async () => {
  const engine = new MiniGameChestEngine({
    rng: {
      nextInt: (max: number) => Math.floor(Math.random() * max),
    },
  });
  const result = await engine.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    choiceJson: { chosenIndex: 0 },
  });
  const json = result.resultJson as ChestResultJson;
  assert.equal(json.allValuesKroner.length, 6);
  for (const v of json.allValuesKroner) {
    assert.ok(v >= 400, `verdi ${v} er < 400`);
    assert.ok(v <= 4000, `verdi ${v} er > 4000`);
    assert.ok(Number.isInteger(v), `verdi ${v} er ikke heltall`);
  }
});

test("BIN-690 M3: handleChoice — numberOfChests=8 gir 8 verdier", async () => {
  const engine = new MiniGameChestEngine({
    rng: makeSequencedRng([0, 100, 200, 300, 400, 500, 600, 700]),
  });
  const result = await engine.handleChoice({
    resultId: "r-1",
    context: makeContext({
      numberOfChests: 8,
      prizeRange: { minNok: 400, maxNok: 4000 },
    }),
    choiceJson: { chosenIndex: 7 },
  });
  const json = result.resultJson as ChestResultJson;
  assert.equal(json.chestCount, 8);
  assert.equal(json.allValuesKroner.length, 8);
  // chosenIndex 7 → values[7] = 400 + 700 = 1100.
  assert.equal(json.prizeAmountKroner, 1100);
});

test("BIN-690 M3: handleChoice — type='chest' konstant", () => {
  const engine = new MiniGameChestEngine();
  assert.equal(engine.type, "chest");
});
