/**
 * Tester designet for å drepe mutation-testing-survivors fra første Stryker-
 * baseline-kjøring 2026-05-13 (se docs/auto-generated/MUTATION_BASELINE.md).
 *
 * Hver test er taggat med fil:linje + mutator-operator den dreper.
 *
 * Pre-baseline: 46% mutation score (22 killed / 14 survived / 13 nocov /
 *   1 timeout / 14 errors).
 * Mål: >= 75% etter denne suiten.
 *
 * Strategi:
 *  - Tester `start()` lifecycle (linje 85-92) — verifiser at timer faktisk
 *    settes, og at gjentatt start ikke overskriver.
 *  - Tester `stop()` med pågående tick (linje 99-110) — verifiser at vi
 *    venter, og at deadline er future-positive.
 *  - Tester running-flag og throttle (linje 119-122).
 *  - Tester dead-letter boundary (linje 143) — `>=` vs `>` på MAX_ATTEMPTS.
 *  - Tester markProcessed-guard (linje 156) — verifiser at den IKKE kalles
 *    når ingenting lyktes.
 *  - Tester nocov: defaultDispatcher, auto-tick via setInterval, markFailed-
 *    failure (linje 148-153), outer-catch (linje 159-167).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  WalletOutboxWorker,
  type WalletOutboxDispatcher,
} from "./WalletOutboxWorker.js";
import {
  type WalletOutboxRepo,
  type WalletOutboxRow,
  WALLET_OUTBOX_MAX_ATTEMPTS,
} from "./WalletOutboxRepo.js";

// ── Mock repo ───────────────────────────────────────────────────────────────

interface FakeOutboxRow extends WalletOutboxRow {
  _claimedAt: number | null;
}

/** Minimal stub som tilfredstiller WalletOutboxRepo-interfacet for tests. */
class FakeOutboxRepo {
  rows: FakeOutboxRow[] = [];
  private nextId = 1;
  claimCalls = 0;
  processedCalls: number[][] = [];
  failedCalls: Array<{ id: number; error: string; attempts: number }> = [];
  /** Hvis satt: throwes ved neste claimNextBatch. */
  throwOnClaim: Error | null = null;
  /** Hvis satt: throwes ved markFailed. */
  throwOnMarkFailed: Error | null = null;

  seed(
    input: Partial<WalletOutboxRow> & Pick<WalletOutboxRow, "operationId">,
  ): FakeOutboxRow {
    const now = new Date().toISOString();
    const row: FakeOutboxRow = {
      id: this.nextId++,
      operationId: input.operationId,
      accountId: input.accountId ?? "acc-test",
      eventType: input.eventType ?? "wallet.credit",
      payload: input.payload ?? {},
      status: input.status ?? "pending",
      attempts: input.attempts ?? 0,
      lastAttemptAt: input.lastAttemptAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: input.createdAt ?? now,
      processedAt: input.processedAt ?? null,
      _claimedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async claimNextBatch(limit: number): Promise<WalletOutboxRow[]> {
    this.claimCalls++;
    if (this.throwOnClaim) {
      const e = this.throwOnClaim;
      this.throwOnClaim = null; // rearm
      throw e;
    }
    const claimed: FakeOutboxRow[] = [];
    for (const r of this.rows) {
      if (claimed.length >= limit) break;
      if (r.status !== "pending") continue;
      if (r._claimedAt && Date.now() - r._claimedAt < 1000) continue;
      r._claimedAt = Date.now();
      r.attempts += 1;
      r.lastAttemptAt = new Date().toISOString();
      claimed.push(r);
    }
    return claimed.map((r) => ({ ...r }));
  }

  async markProcessed(ids: number[]): Promise<void> {
    this.processedCalls.push([...ids]);
    for (const r of this.rows) {
      if (ids.includes(r.id)) {
        r.status = "processed";
        r.processedAt = new Date().toISOString();
        r.lastError = null;
        r._claimedAt = null;
      }
    }
  }

  async markFailed(id: number, error: string, attempts: number): Promise<void> {
    this.failedCalls.push({ id, error, attempts });
    if (this.throwOnMarkFailed) {
      const e = this.throwOnMarkFailed;
      this.throwOnMarkFailed = null; // rearm
      throw e;
    }
    const r = this.rows.find((x) => x.id === id);
    if (!r) return;
    r.lastError = error.length > 4000 ? error.slice(0, 4000) : error;
    r.status = attempts >= WALLET_OUTBOX_MAX_ATTEMPTS ? "dead_letter" : "pending";
    r._claimedAt = null;
  }
}

function asRepo(fake: FakeOutboxRepo): WalletOutboxRepo {
  return fake as unknown as WalletOutboxRepo;
}

// ── start() lifecycle (linje 85-93) ─────────────────────────────────────────

test("start() faktisk setter timer som tikker (kills BlockStatement on line 85, ConditionalExpression on 86)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-tick-1" });
  fake.seed({ operationId: "op-tick-2" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 20, // raskt poll
  });

  // Verifiser at før start: ingen claims har skjedd
  assert.equal(fake.claimCalls, 0);

  worker.start();

  // Vent på flere intervaller (50ms — gir 2-3 ticks ved intervalMs=20)
  await new Promise((r) => setTimeout(r, 60));

  // Etter start: minst én claim skal ha skjedd (verifiserer setInterval-callback
  // og dermed kills mutant der start() er en tom block, og IF (this.timer) → IF (false)).
  assert.ok(fake.claimCalls >= 1, `forventer minst 1 claim, fikk ${fake.claimCalls}`);

  await worker.stop();
});

test("start() er idempotent — internt timer-felt skal kun settes én gang (kills ConditionalExpression on line 86)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-once" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000,
  });

  // Track the internal timer field by inspecting before/after.
  // If `if (this.timer) return` is mutated to `if (false) return;` (no-op),
  // the second start() call will OVERWRITE this.timer with a new setInterval
  // and leak the first one. We can detect this via the internal `timer` field.
  worker.start();
  const timer1 = (worker as unknown as { timer: NodeJS.Timeout | null }).timer;
  assert.ok(timer1 !== null, "etter første start, timer skal være satt");

  worker.start(); // andre kall — skal være no-op
  const timer2 = (worker as unknown as { timer: NodeJS.Timeout | null }).timer;
  // Med korrekt kode (early-return): timer2 === timer1 (samme objekt).
  // Med mutant (no-op return): timer2 er ny setInterval-Timer, ikke samme.
  assert.strictEqual(
    timer2,
    timer1,
    "second start() should not replace the existing timer",
  );

  await worker.stop();
});

test("start() resetter stopping-flagg så worker kan re-startes etter stop (kills BooleanLiteral on line 87)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-1" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000, // disable auto-tick
  });

  worker.start();
  await worker.stop(); // setter stopping=true

  // Re-start — hvis `this.stopping = false` blir til `this.stopping = true`,
  // vil tick() forbli short-circuited (returnere 0).
  worker.start();
  const result = await worker.tick();
  assert.equal(result.claimed, 1, "tick må kunne claime etter restart");

  await worker.stop();
});

// ── stop() lifecycle (linje 99-110) ─────────────────────────────────────────

test("stop() faktisk clearer timer og stopper auto-tick (kills BlockStatement on line 101)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-clearTimer" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 20,
  });

  worker.start();
  // Vent på minst én tick.
  await new Promise((r) => setTimeout(r, 50));
  const claimsBeforeStop = fake.claimCalls;
  assert.ok(claimsBeforeStop >= 1);

  await worker.stop();

  // Etter stop: ingen nye ticks i 100ms.
  await new Promise((r) => setTimeout(r, 100));
  // Hvis stop() ikke clearer timeren, ville claims fortsatt øke. Med
  // intervalMs=20 og 100ms ekstra vente, forventer vi 4-5 nye ticks hvis
  // timer ikke ble cleared.
  const claimsAfterStop = fake.claimCalls;
  assert.equal(
    claimsAfterStop,
    claimsBeforeStop,
    `stop() må stoppe auto-tick — claims gikk fra ${claimsBeforeStop} til ${claimsAfterStop}`,
  );
});

test("stop() venter på pågående tick før resolve (kills ConditionalExpression on line 107 + ArithmeticOperator on 106)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-wait" });

  let dispatchEnded = false;
  const dispatcher: WalletOutboxDispatcher = async () => {
    // Sov 100ms — dette er tick'ens "pågående arbeid"
    await new Promise((r) => setTimeout(r, 100));
    dispatchEnded = true;
  };

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  // Start en tick uten å vente på den.
  const tickPromise = worker.tick();

  // Gi tick'en 10ms til å sette running=true.
  await new Promise((r) => setTimeout(r, 10));

  // Ring stop() mens tick fortsatt er i dispatcher. stop() må vente.
  const stopPromise = worker.stop();
  await stopPromise;

  // Etter stop er ferdig, må dispatcher være ferdig.
  // Med ArithmeticOperator-mutasjon (deadline = now() - 5000), ville
  // deadline være i fortiden og while-loopen aldri kjøre → stop returnerer
  // for tidlig.
  // Med ConditionalExpression false, ville while-loopen aldri kjøre → samme problem.
  assert.equal(dispatchEnded, true, "dispatcher må være ferdig før stop() returnerer");
  await tickPromise;
});

// ── tick() running-flag + throttle (linje 119-122) ──────────────────────────

test("tick() setter running=true → andre samtidige tick short-circuiter (kills BooleanLiteral on line 122)", async () => {
  const fake = new FakeOutboxRepo();
  for (let i = 0; i < 5; i++) fake.seed({ operationId: `op-${i}` });

  let runningWhileDispatch = false;
  const dispatcher: WalletOutboxDispatcher = async () => {
    // Mens vi er her, må running=true. Kjør parallell tick() og sjekk
    // at den short-circuiter.
    await new Promise((r) => setTimeout(r, 5));
  };

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  // Kjør tick. Mens den arbeider, kjør tick() igjen.
  const p1 = worker.tick();
  // Liten yield så p1 har rukket å sette running=true.
  await new Promise((r) => setTimeout(r, 1));
  const p2 = worker.tick(); // skal returnere {0,0,0,0} fordi running=true

  const [r1, r2] = await Promise.all([p1, p2]);

  // Hvis `this.running = true` ble til `this.running = false`, ville begge
  // ticker faktisk kjøre parallelt og begge claime. Vi forventer at p2
  // returnerer 0 (throttle), p1 returnerer 5.
  assert.ok(r1.claimed + r2.claimed === 5, `total claimed=${r1.claimed + r2.claimed}, skal være 5`);
  assert.ok(r1.claimed === 0 || r2.claimed === 0, "én tick må ha returnert 0 (throttled)");
});

// ── Dead-letter boundary (linje 143) ─────────────────────────────────────────

test("dead-letter trigges når attempts == MAX_ATTEMPTS (kills EqualityOperator on line 143: >= vs >)", async () => {
  const fake = new FakeOutboxRepo();
  // Seed med attempts allerede på MAX-1, så NEXT tick gir attempts=MAX.
  fake.seed({ operationId: "op-boundary", attempts: WALLET_OUTBOX_MAX_ATTEMPTS - 1 });

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("boom");
  };

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  const result = await worker.tick();

  // Etter denne tick'en skal attempts=MAX (claim incrementer). Med `>=`
  // skal dead-lettered=1. Med `>` (mutasjon) ville den vært failed=1.
  assert.equal(fake.rows[0].attempts, WALLET_OUTBOX_MAX_ATTEMPTS);
  assert.equal(result.deadLettered, 1, "deadLettered må være 1 ved attempts==MAX");
  assert.equal(result.failed, 0, "failed må være 0 (deadLettered konsumerte)");
  assert.equal(fake.rows[0].status, "dead_letter");
});

test("deadLettered counter blir INKREMENTERT, ikke dekrementert (kills UpdateOperator on line 144)", async () => {
  const fake = new FakeOutboxRepo();
  // 3 rader på MAX-1, alle vil dead-letteres samme tick.
  fake.seed({ operationId: "op-a", attempts: WALLET_OUTBOX_MAX_ATTEMPTS - 1 });
  fake.seed({ operationId: "op-b", attempts: WALLET_OUTBOX_MAX_ATTEMPTS - 1 });
  fake.seed({ operationId: "op-c", attempts: WALLET_OUTBOX_MAX_ATTEMPTS - 1 });

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("fail");
  };

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  const result = await worker.tick();
  // Hvis UpdateOperator var dekrement, ville result.deadLettered være -3
  // (eller noe rart). Med korrekt kode: 3.
  assert.equal(result.deadLettered, 3, "deadLettered må telle opp, ikke ned");
});

test("dead-letter block kjører (kills BlockStatement on line 143:61)", async () => {
  // Hvis dead-letter-if-blocken erstattes med `{}`, vil INGEN av deadLettered/
  // failed bli inkrementert. Vi tester at MINST én av tellerne er satt
  // (kombinert med foregående test som sjekker konkret deadLettered=1, gir
  // dette komplett dekning).
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op", attempts: WALLET_OUTBOX_MAX_ATTEMPTS - 1 });

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("fail");
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  const result = await worker.tick();
  assert.ok(
    result.deadLettered + result.failed > 0,
    "én av deadLettered/failed må være > 0",
  );
});

// ── ConditionalExpression on line 143 ───────────────────────────────────────

test("attempts < MAX → IKKE deadLettered (kills ConditionalExpression on line 143: 'false')", async () => {
  // Hvis `if (row.attempts >= MAX)` blir `if (false)`, ville VI alltid gå
  // til else (failed++). Vi tester at attempts < MAX gir failed=1 og
  // deadLettered=0 (verifiserer at IF-grenen faktisk evalueres riktig).
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-small-attempts" }); // attempts=0 initially

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("fail");
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  const result = await worker.tick();
  // attempts blir 1 etter claim. 1 < MAX → failed-grenen, ikke dead-letter.
  // Hvis IF alltid evaluerer til true (`true`-mutasjon på linje 143), hadde
  // vi fått deadLettered=1.
  assert.equal(result.failed, 1, "failed må være 1 (attempts < MAX)");
  assert.equal(result.deadLettered, 0, "deadLettered må være 0");
});

// ── markProcessed guard (linje 156) ─────────────────────────────────────────

test("markProcessed kalles IKKE når ingenting lyktes (kills ConditionalExpression on line 156: 'true')", async () => {
  // Hvis `if (succeededIds.length > 0)` ble `if (true)`, ville markProcessed
  // bli kalt med tom array. Det er en feil — kunne overskrive prosesserte
  // rader hvis det ble en eller annen race.
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op" });

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("fail");
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  await worker.tick();
  // Hvis IF alltid var true, ville processedCalls inneholde [[]].
  // Korrekt: tom liste.
  assert.equal(
    fake.processedCalls.length,
    0,
    "markProcessed må IKKE kalles når succeededIds er tom",
  );
});

test("markProcessed kalles når MINST ÉN lyktes (kills EqualityOperator on line 156: '>= 0')", async () => {
  // Hvis `> 0` ble `>= 0`, ville den alltid kalt markProcessed. Vi har allerede
  // testen over som verifiserer at tom array IKKE kaller. Her sjekker vi at
  // én suksess KALLER med en non-empty array.
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-success" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher: () => {
      /* success — no-op */
    },
    intervalMs: 10_000,
  });

  await worker.tick();
  assert.equal(fake.processedCalls.length, 1, "markProcessed må kalles én gang");
  assert.equal(fake.processedCalls[0].length, 1, "med array med 1 id");
});

// ── markFailed-failure path (linje 148-153, currently no-coverage) ──────────

test("markFailed selv kaster → tellern failed øker, ikke markProcessed (kills line 148-152)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-double-fail" });

  // Dispatcher kaster → markFailed kalles → markFailed kaster også
  fake.throwOnMarkFailed = new Error("DB connection lost");

  const dispatcher: WalletOutboxDispatcher = () => {
    throw new Error("dispatch fail");
  };
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 10_000,
  });

  const result = await worker.tick();
  // Worker skal fortsatt rapportere én failed (ikke kaste videre).
  assert.equal(result.failed, 1, "failed må telles selv om markFailed kastet");
  assert.equal(result.processed, 0);
});

// ── Outer-catch (linje 159-167, currently no-coverage) ──────────────────────

test("claimNextBatch kaster → tick swallower og returnerer 0/0/0/0 (kills line 159-162)", async () => {
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-claim-fails" });
  fake.throwOnClaim = new Error("DB connection lost");

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000,
  });

  // Skal IKKE kaste — testen ville feilet hvis worker propagerte feilen.
  const result = await worker.tick();
  assert.deepEqual(
    result,
    { claimed: 0, processed: 0, failed: 0, deadLettered: 0 },
    "tick må returnere null-resultat ved claim-feil",
  );
});

// ── onTick callback alltid kalles selv ved error (kills BlockStatement on line 159) ──

test("onTick callback kalles selv om claimNextBatch kaster", async () => {
  const fake = new FakeOutboxRepo();
  fake.throwOnClaim = new Error("DB fail");

  let onTickCalled = false;
  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000,
    onTick: () => {
      onTickCalled = true;
    },
  });

  await worker.tick();
  // Verifiser at finally-blokken med onTick-call faktisk kjørte.
  // Hvis catch på linje 159 var tom (BlockStatement-mutant), ville error
  // bobble opp og finally-block fortsatt kjøre. Vi sjekker likevel onTick
  // for å være sikker.
  assert.equal(onTickCalled, true, "onTick må kalles selv ved claim-feil");
});

// ── Default dispatcher (linje 53-58, currently no-coverage) ─────────────────

test("default dispatcher kaster ikke når dispatcher ikke er gitt", async () => {
  // Verifiserer at constructor.opts.dispatcher ?? defaultDispatcher faktisk
  // tilbyr en gyldig dispatcher som ikke kaster. Den interne console.debug
  // er forventet (no-op).
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-default" });

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    // ingen dispatcher
    intervalMs: 10_000,
  });

  // Skal ikke kaste. defaultDispatcher logger til console.debug og returner.
  const result = await worker.tick();
  assert.equal(result.claimed, 1);
  assert.equal(result.processed, 1, "default dispatcher må telles som processed");
});

// ── setInterval-callback-body (linje 88-90, currently no-coverage) ──────────

test("setInterval-callback bruker void this.tick() — ingen unhandled rejection", async () => {
  // Verifiserer at start() faktisk wirer setInterval-callbacken til å kalle
  // this.tick(), og at dispatcher-rejections ikke leaker som unhandled
  // promise rejection.
  const fake = new FakeOutboxRepo();
  fake.seed({ operationId: "op-async-fail" });

  let unhandled = false;
  const handler = () => {
    unhandled = true;
  };
  process.once("unhandledRejection", handler);

  const dispatcher: WalletOutboxDispatcher = async () => {
    throw new Error("async failure");
  };

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    dispatcher,
    intervalMs: 20,
  });
  worker.start();

  // Vent på minst én tick.
  await new Promise((r) => setTimeout(r, 50));
  await worker.stop();

  // Cleanup handler.
  process.removeListener("unhandledRejection", handler);
  assert.equal(unhandled, false, "setInterval-callback må swallow rejections");
});

// ── unref optional-chaining (linje 92) ──────────────────────────────────────

test("start() bruker optional-chaining på unref() — ingen feil hvis unref mangler", async () => {
  // I node-miljø er unref() alltid tilgjengelig, men optional-chaining
  // beskytter mot edge-case der Timer er en mock uten unref. Hvis vi
  // fjernet `?.` ville det krasje. Test at start() ikke kaster.
  const fake = new FakeOutboxRepo();

  const worker = new WalletOutboxWorker({
    repo: asRepo(fake),
    intervalMs: 10_000,
  });

  // Skal ikke kaste.
  assert.doesNotThrow(() => worker.start());
  await worker.stop();
});
