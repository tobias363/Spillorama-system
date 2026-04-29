/**
 * BIN-690 Spor 3 M2: unit-tester for MiniGameWheelEngine.
 *
 * Dekning:
 *   - parseWheelConfig: tom config → default, malformed → throw, gyldig
 *     passes through.
 *   - totalBuckets + bucketIndexToPrizeGroup: mapping korrekt for
 *     eksempel-config.
 *   - trigger: returnerer korrekt payload-shape, bruker configSnapshot.
 *   - handleChoice: server-autoritativ RNG, payoutCents = amount*100,
 *     resultJson komplett, ignorerer choiceJson.
 *   - RNG-fordeling: 10 000 trekninger gir fordeling ≈ bucket-weights.
 *   - handleChoice med 0-amount bucket → payoutCents=0.
 *   - Determinisme via injected RNG.
 *   - Idempotens på orchestrator-nivå (payout-pre: samme resultId ⇒ samme
 *     RNG-utfall hvis vi re-kaller — men handleChoice kalles kun én gang
 *     per resultId av orchestrator, så vi tester orchestrator-binding.
 *
 * Integrasjonstester ligger i `MiniGameWheelEngine.integration.test.ts`
 * (full orchestrator + fake pool-flyt).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WHEEL_CONFIG,
  MiniGameWheelEngine,
  bucketIndexToPrizeGroup,
  parseWheelConfig,
  totalBuckets,
  type WheelConfig,
  type WheelResultJson,
  type WheelRng,
} from "./MiniGameWheelEngine.js";
import type { MiniGameTriggerContext } from "./types.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  configSnapshot: Readonly<Record<string, unknown>> = {},
): MiniGameTriggerContext {
  return {
    resultId: "mgr-test-1",
    scheduledGameId: "sg-1",
    winnerUserId: "u-1",
    winnerWalletId: "w-1",
    hallId: "h-1",
    drawSequenceAtWin: 45,
    configSnapshot,
  };
}

/** Deterministisk RNG for tester. Returnerer sekvens av forhåndsbestemte verdier. */
function makeSequencedRng(values: number[]): WheelRng {
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

// ── parseWheelConfig ─────────────────────────────────────────────────────────

test("BIN-690 M2: parseWheelConfig — tom configSnapshot returnerer default", () => {
  assert.deepEqual(parseWheelConfig({}), DEFAULT_WHEEL_CONFIG);
});

test("BIN-690 M2: parseWheelConfig — default har 50 buckets totalt (legacy-paritet)", () => {
  assert.equal(totalBuckets(DEFAULT_WHEEL_CONFIG), 50);
});

test("BIN-690 M2: parseWheelConfig — prizes undefined faller tilbake til default", () => {
  assert.deepEqual(parseWheelConfig({ active: true }), DEFAULT_WHEEL_CONFIG);
});

test("BIN-690 M2: parseWheelConfig — aksepterer gyldig admin-config", () => {
  const cfg = parseWheelConfig({
    prizes: [
      { amount: 5000, buckets: 1 },
      { amount: 1000, buckets: 9 },
    ],
    spinCount: 1,
  });
  assert.equal(cfg.prizes.length, 2);
  assert.equal(cfg.prizes[0]!.amount, 5000);
  assert.equal(cfg.prizes[1]!.buckets, 9);
  assert.equal(totalBuckets(cfg), 10);
});

test("BIN-690 M2: parseWheelConfig — prizes ikke array → INVALID_WHEEL_CONFIG", () => {
  assert.throws(
    () => parseWheelConfig({ prizes: "oops" as unknown as [] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

test("BIN-690 M2: parseWheelConfig — tom prizes-array → INVALID_WHEEL_CONFIG", () => {
  assert.throws(
    () => parseWheelConfig({ prizes: [] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

test("BIN-690 M2: parseWheelConfig — negativ amount → INVALID_WHEEL_CONFIG", () => {
  assert.throws(
    () =>
      parseWheelConfig({
        prizes: [{ amount: -100, buckets: 1 }],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

test("BIN-690 M2: parseWheelConfig — 0-amount er gyldig (free spin / no-prize bucket)", () => {
  const cfg = parseWheelConfig({
    prizes: [
      { amount: 0, buckets: 10 },
      { amount: 1000, buckets: 1 },
    ],
  });
  assert.equal(cfg.prizes[0]!.amount, 0);
});

test("BIN-690 M2: parseWheelConfig — buckets < 1 → INVALID_WHEEL_CONFIG", () => {
  assert.throws(
    () =>
      parseWheelConfig({
        prizes: [{ amount: 100, buckets: 0 }],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

test("BIN-690 M2: parseWheelConfig — non-integer amount → INVALID_WHEEL_CONFIG", () => {
  assert.throws(
    () =>
      parseWheelConfig({
        prizes: [{ amount: 100.5, buckets: 1 }],
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

test("BIN-690 M2: parseWheelConfig — spinCount != 1 → INVALID_WHEEL_CONFIG (M2-scope)", () => {
  assert.throws(
    () =>
      parseWheelConfig({
        prizes: [{ amount: 100, buckets: 1 }],
        spinCount: 2,
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

// ── bucketIndexToPrizeGroup ──────────────────────────────────────────────────

test("BIN-690 M2: bucketIndexToPrizeGroup — default-config mapping er riktig", () => {
  // default: [2, 4, 8, 32, 4] = 50 buckets.
  // gruppe 0: 0-1 (amount 4000)
  // gruppe 1: 2-5 (amount 3000)
  // gruppe 2: 6-13 (amount 2000)
  // gruppe 3: 14-45 (amount 1000)
  // gruppe 4: 46-49 (amount 500)
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 0), {
    prizeGroupIndex: 0,
    amountKroner: 4000,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 1), {
    prizeGroupIndex: 0,
    amountKroner: 4000,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 2), {
    prizeGroupIndex: 1,
    amountKroner: 3000,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 13), {
    prizeGroupIndex: 2,
    amountKroner: 2000,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 14), {
    prizeGroupIndex: 3,
    amountKroner: 1000,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 45), {
    prizeGroupIndex: 3,
    amountKroner: 1000,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 46), {
    prizeGroupIndex: 4,
    amountKroner: 500,
  });
  assert.deepEqual(bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 49), {
    prizeGroupIndex: 4,
    amountKroner: 500,
  });
});

test("BIN-690 M2: bucketIndexToPrizeGroup — out-of-range → INVALID_WHEEL_BUCKET", () => {
  assert.throws(
    () => bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, -1),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_BUCKET",
  );
  assert.throws(
    () => bucketIndexToPrizeGroup(DEFAULT_WHEEL_CONFIG, 50),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_BUCKET",
  );
});

// ── trigger ──────────────────────────────────────────────────────────────────

test("BIN-690 M2: trigger — returnerer korrekt payload-struktur for default-config", () => {
  const engine = new MiniGameWheelEngine();
  const payload = engine.trigger(makeContext());
  assert.equal(payload.type, "wheel");
  assert.equal(payload.resultId, "mgr-test-1");
  assert.equal(payload.timeoutSeconds, 60);
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.totalBuckets, 50);
  assert.equal(inner.spinCount, 1);
  assert.ok(Array.isArray(inner.prizes));
  assert.equal((inner.prizes as unknown[]).length, 5);
});

test("BIN-690 M2: trigger — bruker admin-configSnapshot (override default)", () => {
  const engine = new MiniGameWheelEngine();
  const payload = engine.trigger(
    makeContext({
      prizes: [
        { amount: 10000, buckets: 1 },
        { amount: 100, buckets: 99 },
      ],
    }),
  );
  const inner = payload.payload as Record<string, unknown>;
  assert.equal(inner.totalBuckets, 100);
  assert.deepEqual(inner.prizes, [
    { amount: 10000, buckets: 1 },
    { amount: 100, buckets: 99 },
  ]);
});

test("BIN-690 M2: trigger — malformed config kaster INVALID_WHEEL_CONFIG", () => {
  const engine = new MiniGameWheelEngine();
  assert.throws(
    () =>
      engine.trigger(
        makeContext({
          prizes: "not-an-array" as unknown as [],
        }),
      ),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_WHEEL_CONFIG",
  );
});

// ── handleChoice ─────────────────────────────────────────────────────────────

test("BIN-690 M2: handleChoice — server-autoritativ trekning (ignorerer choiceJson)", async () => {
  // Injected RNG velger bucket 0, deretter animationSeed 42.
  const engine = new MiniGameWheelEngine({
    rng: makeSequencedRng([0, 42]),
  });
  const result = await engine.handleChoice({
    resultId: "mgr-test-1",
    context: makeContext(),
    choiceJson: { spin: true },
  });
  const json = result.resultJson as WheelResultJson;
  // Bucket 0 → gruppe 0 i default = 4000 kr.
  assert.equal(json.winningBucketIndex, 0);
  assert.equal(json.prizeGroupIndex, 0);
  assert.equal(json.amountKroner, 4000);
  assert.equal(json.totalBuckets, 50);
  assert.equal(json.animationSeed, 42);
  assert.equal(result.payoutCents, 400_000); // 4000 kr * 100 = 400 000 øre.
});

test("BIN-690 M2: handleChoice — klient-sendt choiceJson påvirker IKKE utfall (anti-juks)", async () => {
  // Samme RNG → samme utfall selv om klient prøver å snyte.
  const engine1 = new MiniGameWheelEngine({
    rng: makeSequencedRng([25, 1]),
  });
  const result1 = await engine1.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    choiceJson: {},
  });
  const engine2 = new MiniGameWheelEngine({
    rng: makeSequencedRng([25, 1]),
  });
  const result2 = await engine2.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    // Klient prøver å "lede" til bucket 0 (4000 kr).
    choiceJson: { spin: true, winningBucketIndex: 0, cheat: true },
  });
  assert.equal(result1.payoutCents, result2.payoutCents);
  assert.deepEqual(result1.resultJson, result2.resultJson);
  const json = result1.resultJson as WheelResultJson;
  // Bucket 25 er i gruppe 3 (14-45) → 1000 kr.
  assert.equal(json.winningBucketIndex, 25);
  assert.equal(json.prizeGroupIndex, 3);
  assert.equal(json.amountKroner, 1000);
});

test("BIN-690 M2: handleChoice — 0-amount bucket gir payoutCents=0", async () => {
  const engine = new MiniGameWheelEngine({
    rng: makeSequencedRng([0, 1]),
  });
  const result = await engine.handleChoice({
    resultId: "r-zero",
    context: makeContext({
      prizes: [
        { amount: 0, buckets: 5 },
        { amount: 500, buckets: 1 },
      ],
    }),
    choiceJson: {},
  });
  assert.equal(result.payoutCents, 0);
  const json = result.resultJson as WheelResultJson;
  assert.equal(json.amountKroner, 0);
  assert.equal(json.prizeGroupIndex, 0);
});

test("BIN-690 M2: handleChoice — admin-config prize-gruppe velges riktig via weights", async () => {
  // Config: 1 bucket à 10 000, 99 buckets à 100. Bucket 0 → 10 000, ellers 100.
  const config = {
    prizes: [
      { amount: 10000, buckets: 1 },
      { amount: 100, buckets: 99 },
    ],
  };

  // Test 1: bucket 0 → 10 000 kr.
  const eng1 = new MiniGameWheelEngine({ rng: makeSequencedRng([0, 1]) });
  const r1 = await eng1.handleChoice({
    resultId: "r-1",
    context: makeContext(config),
    choiceJson: {},
  });
  assert.equal((r1.resultJson as WheelResultJson).amountKroner, 10000);
  assert.equal(r1.payoutCents, 1_000_000);

  // Test 2: bucket 50 → 100 kr (gruppe 1).
  const eng2 = new MiniGameWheelEngine({ rng: makeSequencedRng([50, 1]) });
  const r2 = await eng2.handleChoice({
    resultId: "r-2",
    context: makeContext(config),
    choiceJson: {},
  });
  assert.equal((r2.resultJson as WheelResultJson).amountKroner, 100);
  assert.equal((r2.resultJson as WheelResultJson).prizeGroupIndex, 1);
});

test("BIN-690 M2: handleChoice — RNG-fordeling er weighted (10k runs, default-config)", async () => {
  // Bruk default-config (50 buckets: 2+4+8+32+4).
  // Vi bruker Math.random men wrapped i WheelRng for deterministic-ish
  // statistisk sjekk — stor N gir liten varians.
  const N = 10_000;
  const groupCounts = [0, 0, 0, 0, 0];
  const rng: WheelRng = {
    nextInt: (max: number) => Math.floor(Math.random() * max),
  };
  const engine = new MiniGameWheelEngine({ rng });

  for (let i = 0; i < N; i += 1) {
    const res = await engine.handleChoice({
      resultId: `r-${i}`,
      context: makeContext(),
      choiceJson: {},
    });
    const json = res.resultJson as WheelResultJson;
    groupCounts[json.prizeGroupIndex] =
      (groupCounts[json.prizeGroupIndex] ?? 0) + 1;
  }

  // Forventet: gruppe 0 = 2/50 = 4%, gruppe 1 = 8%, gruppe 2 = 16%,
  // gruppe 3 = 64%, gruppe 4 = 8%.
  const expected = [2 / 50, 4 / 50, 8 / 50, 32 / 50, 4 / 50];
  // Toleranse: ±2 prosentpoeng (3σ for N=10 000 og p=0.04 er ca ±0.6%).
  const tolerance = 0.02;
  for (let g = 0; g < 5; g += 1) {
    const observed = (groupCounts[g] ?? 0) / N;
    assert.ok(
      Math.abs(observed - expected[g]!) < tolerance,
      `Gruppe ${g}: observed=${observed.toFixed(3)}, expected=${expected[g]}, diff=${Math.abs(observed - expected[g]!).toFixed(3)}`,
    );
  }
});

test("BIN-690 M2: handleChoice — nextInt kalles med riktig max (totalBuckets)", async () => {
  const calls: number[] = [];
  const rng: WheelRng = {
    nextInt: (max: number) => {
      calls.push(max);
      return 0;
    },
  };
  const engine = new MiniGameWheelEngine({ rng });
  await engine.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    choiceJson: {},
  });
  // Første kall: totalBuckets (50). Andre: animationSeed (1 000 000).
  assert.equal(calls[0], 50);
  assert.equal(calls[1], 1_000_000);
});

test("BIN-690 M2: handleChoice — sum(buckets) = totalBuckets for alle prize-grupper", () => {
  // Dette er en ren math-invariant, men viktig for regulatorisk audit.
  const configs: WheelConfig[] = [
    DEFAULT_WHEEL_CONFIG,
    {
      prizes: [
        { amount: 10000, buckets: 1 },
        { amount: 5000, buckets: 2 },
        { amount: 1000, buckets: 7 },
      ],
    },
    {
      prizes: [{ amount: 100, buckets: 1 }],
    },
  ];
  for (const c of configs) {
    const total = totalBuckets(c);
    let sumFromGroups = 0;
    for (let g = 0; g < c.prizes.length; g += 1) {
      sumFromGroups += c.prizes[g]!.buckets;
    }
    assert.equal(total, sumFromGroups);
  }
});

test("BIN-690 M2: handleChoice — determinisme med injected RNG (samme seed → samme utfall)", async () => {
  const engine1 = new MiniGameWheelEngine({
    rng: makeSequencedRng([17, 42]),
  });
  const engine2 = new MiniGameWheelEngine({
    rng: makeSequencedRng([17, 42]),
  });
  const r1 = await engine1.handleChoice({
    resultId: "r-1",
    context: makeContext(),
    choiceJson: {},
  });
  const r2 = await engine2.handleChoice({
    resultId: "r-2",
    context: makeContext(),
    choiceJson: {},
  });
  assert.deepEqual(r1.resultJson, r2.resultJson);
  assert.equal(r1.payoutCents, r2.payoutCents);
});

test("BIN-690 M2: handleChoice — alle buckets i default-config kan nåes (coverage)", async () => {
  // Sjekker at samtlige 50 bucket-indices gir valid resultat og mapper til
  // riktig gruppe. Beskyttelse mot off-by-one i bucketIndexToPrizeGroup.
  const total = totalBuckets(DEFAULT_WHEEL_CONFIG);
  for (let i = 0; i < total; i += 1) {
    const engine = new MiniGameWheelEngine({
      rng: makeSequencedRng([i, 0]),
    });
    const result = await engine.handleChoice({
      resultId: `r-${i}`,
      context: makeContext(),
      choiceJson: {},
    });
    const json = result.resultJson as WheelResultJson;
    assert.equal(json.winningBucketIndex, i);
    assert.equal(json.totalBuckets, 50);
    assert.ok(json.amountKroner >= 500, `bucket ${i}: amount=${json.amountKroner}`);
    assert.ok(json.amountKroner <= 4000, `bucket ${i}: amount=${json.amountKroner}`);
  }
});

test("BIN-690 M2: handleChoice — type='wheel' konstant", () => {
  const engine = new MiniGameWheelEngine();
  assert.equal(engine.type, "wheel");
});
