/**
 * Pilot Q3 2026 (PR #1116, 2026-05-09): unit-tester for `withRetry`-helper.
 *
 * Tester valideres med node:test + tsx (samme runner som resten av backend).
 * Tester bruker en synkron-i-praksis sleep-mock (resolve umiddelbart) så
 * test-suite ikke stopper i 2 sekunder per scenario.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withRetry, DEFAULT_RETRY_DELAYS_MS } from "../retry.js";

const FAST_DELAYS = [0, 0, 0] as const;

function makeFakeSleep(): {
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  const delays: number[] = [];
  return {
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    delays,
  };
}

test("withRetry: lykkes på første forsøk → ingen retries", async () => {
  let calls = 0;
  const fake = makeFakeSleep();
  const result = await withRetry(
    async () => {
      calls += 1;
      return "ok";
    },
    {
      operationName: "test.first-success",
      sleep: fake.sleep,
    },
  );
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.deepEqual(fake.delays, []);
});

test("withRetry: feil 1x → retry lykkes på forsøk 2", async () => {
  let calls = 0;
  const fake = makeFakeSleep();
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return "ok";
    },
    {
      operationName: "test.retry-once",
      delaysMs: [10, 50, 100],
      sleep: fake.sleep,
    },
  );
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  // Én retry → ett sleep-anrop med første delay-verdi.
  assert.deepEqual(fake.delays, [10]);
});

test("withRetry: feil 2x → retry lykkes på forsøk 3", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error(`fail-${calls}`);
      return "ok";
    },
    {
      operationName: "test.retry-twice",
      delaysMs: FAST_DELAYS,
      sleep: makeFakeSleep().sleep,
    },
  );
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
});

test("withRetry: feil 4x (alle forsøk) → kaster siste feil uendret", async () => {
  let calls = 0;
  const lastErr = new Error("permanent");
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          if (calls < 4) throw new Error(`flaky-${calls}`);
          throw lastErr;
        },
        {
          operationName: "test.exhaust",
          delaysMs: FAST_DELAYS,
          sleep: makeFakeSleep().sleep,
        },
      ),
    (err: unknown) => err === lastErr,
  );
  // 1 initial + 3 retries = 4 totale forsøk.
  assert.equal(calls, 4);
});

test("withRetry: shouldRetry returnerer false → kaster med en gang", async () => {
  let calls = 0;
  const permanentErr = new Error("do-not-retry");
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw permanentErr;
        },
        {
          operationName: "test.no-retry",
          delaysMs: FAST_DELAYS,
          sleep: makeFakeSleep().sleep,
          shouldRetry: () => false,
        },
      ),
    (err: unknown) => err === permanentErr,
  );
  assert.equal(calls, 1);
});

test("withRetry: shouldRetry tar attemptNumber → kan stoppe etter N retries", async () => {
  let calls = 0;
  // Stopp etter første retry (attempt 2 i shouldRetry-arg).
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        {
          operationName: "test.partial-retry",
          delaysMs: FAST_DELAYS,
          sleep: makeFakeSleep().sleep,
          shouldRetry: (_err, attempt) => attempt < 2,
        },
      ),
  );
  // attempt=1 retry-safe (shouldRetry returns true), attempt=2 not.
  assert.equal(calls, 2);
});

test("withRetry: onRetry-hook kalles for hver retry med correlation-id", async () => {
  const calls: Array<{
    attemptNumber: number;
    delayMs: number;
    correlationId: string;
  }> = [];
  let invocations = 0;
  await withRetry(
    async () => {
      invocations += 1;
      if (invocations < 3) throw new Error("transient");
      return "ok";
    },
    {
      operationName: "test.hook",
      delaysMs: [10, 20, 30],
      sleep: makeFakeSleep().sleep,
      correlationId: "corr-123",
      onRetry: (info) => {
        calls.push({
          attemptNumber: info.attemptNumber,
          delayMs: info.delayMs,
          correlationId: info.correlationId,
        });
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    attemptNumber: 1,
    delayMs: 10,
    correlationId: "corr-123",
  });
  assert.deepEqual(calls[1], {
    attemptNumber: 2,
    delayMs: 20,
    correlationId: "corr-123",
  });
});

test("withRetry: onRetry-hook som kaster blir ignorert", async () => {
  let invocations = 0;
  const result = await withRetry(
    async () => {
      invocations += 1;
      if (invocations === 1) throw new Error("transient");
      return "ok";
    },
    {
      operationName: "test.hook-throws",
      delaysMs: FAST_DELAYS,
      sleep: makeFakeSleep().sleep,
      onRetry: () => {
        throw new Error("hook-broken");
      },
    },
  );
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 2);
});

test("withRetry: default delays = [100, 500, 2000]", () => {
  assert.deepEqual([...DEFAULT_RETRY_DELAYS_MS], [100, 500, 2000]);
});

test("withRetry: respekterer custom delaysMs (sleep-tider matcher)", async () => {
  const customDelays = [50, 200, 1000];
  const fake = makeFakeSleep();
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error("always-fails");
        },
        {
          operationName: "test.custom-delays",
          delaysMs: customDelays,
          sleep: fake.sleep,
        },
      ),
  );
  // 4 forsøk (1 initial + 3 retries) → 3 sleep-anrop.
  assert.equal(calls, 4);
  assert.deepEqual(fake.delays, customDelays);
});

test("withRetry: tom delaysMs-array → ingen retries (kun ett forsøk)", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error("nope");
        },
        {
          operationName: "test.no-delays",
          delaysMs: [],
          sleep: makeFakeSleep().sleep,
        },
      ),
  );
  assert.equal(calls, 1);
});

test("withRetry: auto-genererer correlation-id når ikke gitt", async () => {
  const captured: { id: string | null } = { id: null };
  await withRetry(
    async () => "ok",
    {
      operationName: "test.auto-corr",
      sleep: makeFakeSleep().sleep,
      onRetry: (info) => {
        captured.id = info.correlationId;
      },
    },
  );
  // Suksess på første forsøk → onRetry blir aldri kalt → id observeres
  // via return-value i stedet.
  assert.equal(captured.id, null);

  // Tving en retry så onRetry observerer id-en.
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("once");
      return "ok";
    },
    {
      operationName: "test.auto-corr-2",
      delaysMs: FAST_DELAYS,
      sleep: makeFakeSleep().sleep,
      onRetry: (info) => {
        captured.id = info.correlationId;
      },
    },
  );
  assert.equal(result.value, "ok");
  const finalId = captured.id as string | null;
  if (finalId === null) {
    throw new Error("auto-generated correlation-id should be set");
  }
  // finalId er nå snevret til string.
  assert.ok(
    finalId.includes("test.auto-corr-2"),
    `correlation-id should include operationName, got: ${finalId}`,
  );
});

test("withRetry: result.correlationId matcher loggen-id", async () => {
  const observed: { id: string | null } = { id: null };
  const result = await withRetry(
    async () => {
      // Lykkes på første forsøk — correlationId skal fortsatt være satt
      // i return-value selv uten retries.
      return "ok";
    },
    {
      operationName: "test.id-stable",
      sleep: makeFakeSleep().sleep,
      correlationId: "my-fixed-id",
      onRetry: (info) => {
        observed.id = info.correlationId;
      },
    },
  );
  assert.equal(result.correlationId, "my-fixed-id");
  // onRetry blir aldri kalt → observed forblir null.
  assert.equal(observed.id, null);
});
