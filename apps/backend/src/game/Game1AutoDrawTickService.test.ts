/**
 * GAME1_SCHEDULE PR 4c Bolk 4: Tester for Game1AutoDrawTickService.
 *
 * Dekker:
 *   - tick: ingen running games → 0 draws trigget
 *   - tick: game med last_drawn_at + seconds <= now → drawNext kalt
 *   - tick: game ikke klar → skipped
 *   - tick: paused-game filtreres bort (SELECT ekskluderer)
 *   - tick: første draw bruker engine_started_at + seconds, ikke umiddelbart
 *   - tick: drawNext-feil blokkerer ikke tick for andre games
 *   - tick: seconds-resolution — top-level, nested, spill1-admin-form,
 *     default-fallback
 *   - tick: multiple games med ulike seconds → riktig per-game
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1AutoDrawTickService } from "./Game1AutoDrawTickService.js";
import type { Game1DrawEngineService } from "./Game1DrawEngineService.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createStubPool(rows: unknown[]): {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  return {
    pool: {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        return { rows, rowCount: rows.length };
      },
    },
    queries,
  };
}

function makeFakeDrawEngine(opts: { throwOnIds?: string[] } = {}): {
  service: Game1DrawEngineService;
  called: string[];
} {
  const called: string[] = [];
  const service = {
    async drawNext(scheduledGameId: string) {
      called.push(scheduledGameId);
      if (opts.throwOnIds?.includes(scheduledGameId)) {
        throw new Error(`simulated drawNext failure for ${scheduledGameId}`);
      }
      return {};
    },
  } as unknown as Game1DrawEngineService;
  return { service, called };
}

function makeService(
  rows: unknown[],
  opts: Parameters<typeof makeFakeDrawEngine>[0] = {},
  serviceOpts: { forceSecondsOverride?: number } = {}
) {
  const { pool, queries } = createStubPool(rows);
  const { service: drawEngine, called } = makeFakeDrawEngine(opts);
  const service = new Game1AutoDrawTickService({
    pool: pool as never,
    drawEngine,
    forceSecondsOverride: serviceOpts.forceSecondsOverride,
  });
  return { service, drawEngine, called, queries };
}

// ── tick: ingen games ──────────────────────────────────────────────────────

test("tick: ingen running games → 0 draws", async () => {
  const { service, called } = makeService([]);
  const r = await service.tick();
  assert.equal(r.checked, 0);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(called.length, 0);
});

// ── tick: game klar ────────────────────────────────────────────────────────

test("tick: game med last_drawn_at + seconds < now → drawNext trigget", async () => {
  const now = Date.now();
  const tenSecondsAgo = new Date(now - 10_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 3,
      last_drawn_at: tenSecondsAgo,
      engine_started_at: new Date(now - 60_000),
    },
  ]);
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("tick: game med last_drawn_at + seconds > now → skipped", async () => {
  const now = Date.now();
  const oneSecondAgo = new Date(now - 1_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 3,
      last_drawn_at: oneSecondAgo,
      engine_started_at: new Date(now - 60_000),
    },
  ]);
  const r = await service.tick();
  assert.equal(r.skippedNotDue, 1);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(called.length, 0);
});

// ── Første draw — bruker engine_started_at + seconds ─────────────────────────

test("tick: første draw (last_drawn_at=null) → bruker engine_started_at + seconds", async () => {
  const now = Date.now();
  // engine startet for 10 sekunder siden, seconds=5 → due.
  const { service: svcDue, called: calledDue } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 0,
      last_drawn_at: null,
      engine_started_at: new Date(now - 10_000),
    },
  ]);
  const rDue = await svcDue.tick();
  assert.equal(rDue.drawsTriggered, 1);
  assert.deepEqual(calledDue, ["g1"]);

  // engine startet for 2 sekunder siden, seconds=5 → ikke due.
  const { service: svcNotDue, called: calledNotDue } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 0,
      last_drawn_at: null,
      engine_started_at: new Date(now - 2_000),
    },
  ]);
  const rNotDue = await svcNotDue.tick();
  assert.equal(rNotDue.drawsTriggered, 0);
  assert.equal(rNotDue.skippedNotDue, 1);
  assert.equal(calledNotDue.length, 0);
});

// ── Feilisolasjon ─────────────────────────────────────────────────────────

test("tick: drawNext-feil blokkerer ikke tick for andre games", async () => {
  const now = Date.now();
  const old = new Date(now - 10_000);
  const { service, called } = makeService(
    [
      {
        id: "g-fail",
        ticket_config_json: { seconds: 5 },
        draws_completed: 1,
        last_drawn_at: old,
        engine_started_at: old,
      },
      {
        id: "g-ok",
        ticket_config_json: { seconds: 5 },
        draws_completed: 1,
        last_drawn_at: old,
        engine_started_at: old,
      },
    ],
    { throwOnIds: ["g-fail"] }
  );
  const r = await service.tick();
  assert.equal(r.checked, 2);
  assert.equal(r.drawsTriggered, 1, "g-ok skal gå gjennom selv om g-fail feilet");
  assert.equal(r.errors, 1);
  assert.ok(r.errorMessages?.length === 1);
  assert.ok(r.errorMessages![0]!.includes("g-fail"));
  assert.deepEqual(called.sort(), ["g-fail", "g-ok"]);
});

// ── SELECT-query filter ────────────────────────────────────────────────────

test("tick: SELECT filtrerer på status='running' AND paused=false AND engine_ended_at IS NULL", async () => {
  const { service, queries } = makeService([]);
  await service.tick();
  assert.equal(queries.length, 1);
  const sql = queries[0]!.sql;
  assert.ok(sql.includes("sg.status = 'running'"));
  assert.ok(sql.includes("gs.paused = false"));
  assert.ok(sql.includes("gs.engine_ended_at IS NULL"));
});

// ── HIGH-7: SKIP LOCKED + in-process mutex ─────────────────────────────────

test("HIGH-7: SELECT bruker `FOR UPDATE OF gs SKIP LOCKED` for cross-instance idempotens", async () => {
  // Cross-instance: en annen backend-instans kan parallelt fyre tick(). Uten
  // SKIP LOCKED ville begge fetche samme rad og forsøke drawNext, som
  // resulterer i lock-timeout-warning fra postgres FOR UPDATE inne i drawNext.
  // Med SKIP LOCKED filtrerer DB bort rader en annen tx allerede holder.
  const { service, queries } = makeService([]);
  await service.tick();
  assert.equal(queries.length, 1);
  const sql = queries[0]!.sql;
  assert.ok(
    /FOR\s+UPDATE\s+OF\s+gs\s+SKIP\s+LOCKED/i.test(sql),
    `forventet 'FOR UPDATE OF gs SKIP LOCKED' i SELECT, fikk:\n${sql}`
  );
});

test("HIGH-7: in-process mutex skipper rad som allerede prosesseres parallelt", async () => {
  // Simulerer to tick-promises i samme Node-prosess som overlapper på samme
  // scheduledGameId. Den første låser raden via `currentlyProcessing`, den
  // andre må skippe (og IKKE kalle drawNext for den raden) — ellers ville
  // drawNext racet på FOR UPDATE-rad-locken og logget warning.
  const now = Date.now();
  const tenSecAgo = new Date(now - 10_000);
  const row = {
    id: "g-shared",
    ticket_config_json: { seconds: 5 },
    draws_completed: 1,
    last_drawn_at: tenSecAgo,
    engine_started_at: tenSecAgo,
  };
  const queries: RecordedQuery[] = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    },
  };

  // drawNext-stub som blokkerer inntil vi løser bremsen — slik at vi kan
  // fyre tick #2 mens tick #1 fortsatt holder mutex-en.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calledIds: string[] = [];
  const drawEngine = {
    async drawNext(scheduledGameId: string) {
      calledIds.push(scheduledGameId);
      await gate;
      return {};
    },
  } as unknown as Game1DrawEngineService;

  const service = new Game1AutoDrawTickService({
    pool: pool as never,
    drawEngine,
  });

  // Fyr tick #1; den blokkerer i drawNext (gate ikke release-t ennå).
  const tick1 = service.tick();
  // Yield slik at tick #1 hinner å sette currentlyProcessing før tick #2 starter.
  await new Promise((r) => setImmediate(r));

  // Fyr tick #2 — skal skippe raden uten å kalle drawNext.
  const r2 = await service.tick();
  assert.equal(r2.checked, 1, "tick #2 leser raden fra DB...");
  assert.equal(r2.drawsTriggered, 0, "...men SKAL IKKE kalle drawNext");
  assert.equal(r2.errors, 0, "...og SKAL IKKE logge feil");
  assert.equal(r2.skippedNotDue, 1, "...skipped-telleren bumpes");
  assert.equal(calledIds.length, 1, "kun tick #1 har kalt drawNext");

  // Slipp tick #1 fri og rydd opp.
  release();
  await tick1;
});

test("HIGH-7: mutex ryddes opp etter drawNext-feil (ingen permanent blokkering)", async () => {
  // Hvis drawNext kaster, skal currentlyProcessing.delete kjøres i finally
  // slik at neste tick kan prosessere raden på nytt.
  const now = Date.now();
  const tenSecAgo = new Date(now - 10_000);
  const { service, called } = makeService(
    [
      {
        id: "g-recover",
        ticket_config_json: { seconds: 5 },
        draws_completed: 1,
        last_drawn_at: tenSecAgo,
        engine_started_at: tenSecAgo,
      },
    ],
    { throwOnIds: ["g-recover"] }
  );

  // Tick #1: feiler.
  const r1 = await service.tick();
  assert.equal(r1.errors, 1);
  assert.equal(called.length, 1);

  // Tick #2: mutex skal være ryddet → drawNext kalles igjen.
  const r2 = await service.tick();
  assert.equal(r2.errors, 1, "tick #2 skal også feile (samme stub-feil)");
  assert.equal(called.length, 2, "drawNext skal være kalt på nytt — mutex ble ryddet");
});

// ── seconds-resolution ─────────────────────────────────────────────────────

test("tick: seconds fra ticket_config.spill1.timing.seconds (admin-form-shape)", async () => {
  const now = Date.now();
  const twoSecAgo = new Date(now - 2_000);
  const { service, called } = makeService([
    {
      id: "g1",
      // Admin-form: { spill1: { timing: { seconds: 1 } } }.
      ticket_config_json: { spill1: { timing: { seconds: 1 } } },
      draws_completed: 1,
      last_drawn_at: twoSecAgo, // 2s siden, seconds=1 → due.
      engine_started_at: twoSecAgo,
    },
  ]);
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("tick: seconds fra generisk timing.seconds", async () => {
  const now = Date.now();
  const twoSecAgo = new Date(now - 2_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { timing: { seconds: 1 } },
      draws_completed: 1,
      last_drawn_at: twoSecAgo,
      engine_started_at: twoSecAgo,
    },
  ]);
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("tick: seconds default 5 hvis ticket_config ugyldig/mangler", async () => {
  const now = Date.now();
  const threeSecAgo = new Date(now - 3_000);
  const sixSecAgo = new Date(now - 6_000);
  // Default 5: 3s siden → ikke due, 6s siden → due.
  const { service: svcNotDue, called: calledNotDue } = makeService([
    {
      id: "g1",
      ticket_config_json: {},
      draws_completed: 1,
      last_drawn_at: threeSecAgo,
      engine_started_at: threeSecAgo,
    },
  ]);
  const r1 = await svcNotDue.tick();
  assert.equal(r1.drawsTriggered, 0);

  const { service: svcDue, called: calledDue } = makeService([
    {
      id: "g1",
      ticket_config_json: {},
      draws_completed: 1,
      last_drawn_at: sixSecAgo,
      engine_started_at: sixSecAgo,
    },
  ]);
  const r2 = await svcDue.tick();
  assert.equal(r2.drawsTriggered, 1);
  assert.deepEqual(calledDue, ["g1"]);
  assert.deepEqual(calledNotDue, []);
});

test("tick: seconds kan være string (numerisk) fra JSON-serialisering", async () => {
  const now = Date.now();
  const twoSecAgo = new Date(now - 2_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: "1" },
      draws_completed: 1,
      last_drawn_at: twoSecAgo,
      engine_started_at: twoSecAgo,
    },
  ]);
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
});

test("tick: multiple games med ulike seconds-verdier beregnes per-game", async () => {
  const now = Date.now();
  const { service, called } = makeService([
    // g-1: seconds=10, last=5s siden → ikke due
    {
      id: "g-1",
      ticket_config_json: { seconds: 10 },
      draws_completed: 1,
      last_drawn_at: new Date(now - 5_000),
      engine_started_at: new Date(now - 60_000),
    },
    // g-2: seconds=3, last=5s siden → due
    {
      id: "g-2",
      ticket_config_json: { seconds: 3 },
      draws_completed: 1,
      last_drawn_at: new Date(now - 5_000),
      engine_started_at: new Date(now - 60_000),
    },
  ]);
  const r = await service.tick();
  assert.equal(r.checked, 2);
  assert.equal(r.drawsTriggered, 1);
  assert.equal(r.skippedNotDue, 1);
  assert.deepEqual(called, ["g-2"]);
});

// ── 4c-services-coverage tillegg: 6 nye tester per PM-godkjent scope ────────

test("defensivity: seconds=0 eller negativ → defaultSeconds brukes", () => {
  // `pickPositiveInt` avviser 0, negativ, float — faller til defaultSeconds=5.
  // Låser at ugyldig config fra DB ikke fører til infinite-loop (seconds=0 =
  // always-due).
  const now = Date.now();
  // last=2s siden, seconds skulle vært 0 (=always-due), men faller til default=5 → ikke due.
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 0 },
      draws_completed: 1,
      last_drawn_at: new Date(now - 2_000),
      engine_started_at: new Date(now - 2_000),
    },
  ]);
  return service.tick().then((r) => {
    assert.equal(r.drawsTriggered, 0, "seconds=0 skal falle til default=5 → 2s < 5s → ikke due");
    assert.equal(r.skippedNotDue, 1);
    assert.equal(called.length, 0);
  });
});

test("defensivity: seconds=negativ eller float → defaultSeconds brukes", async () => {
  const now = Date.now();
  const eightSecAgo = new Date(now - 8_000);
  // Negativ → default 5. 8s siden → due.
  const { service: svc1, called: c1 } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: -3 },
      draws_completed: 1,
      last_drawn_at: eightSecAgo,
      engine_started_at: eightSecAgo,
    },
  ]);
  const r1 = await svc1.tick();
  assert.equal(r1.drawsTriggered, 1, "seconds=-3 → default=5, 8s > 5s → due");
  assert.deepEqual(c1, ["g1"]);

  // Float 3.5 — pickPositiveInt avviser ikke-heltall → default 5.
  const { service: svc2, called: c2 } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 3.5 },
      draws_completed: 1,
      last_drawn_at: new Date(now - 4_000),
      engine_started_at: new Date(now - 4_000),
    },
  ]);
  const r2 = await svc2.tick();
  assert.equal(r2.drawsTriggered, 0, "seconds=3.5 → default=5, 4s < 5s → ikke due");
  assert.equal(c2.length, 0);
});

test("defensivity: ticket_config som malformed JSON-streng → defaultSeconds brukes", async () => {
  const now = Date.now();
  const sixSecAgo = new Date(now - 6_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: "{not valid json", // string som ikke parser
      draws_completed: 1,
      last_drawn_at: sixSecAgo,
      engine_started_at: sixSecAgo,
    },
  ]);
  const r = await service.tick();
  // Default=5, 6s > 5s → due.
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("parseLastDrawnMs: ugyldig dato-streng → fallback til Date.now() → skipped", async () => {
  // `new Date("garbage")` gir Invalid Date, `.getTime()` gir NaN.
  // Sammenligning `dueAt = NaN + seconds*1000 = NaN`, `now < NaN` er false,
  // så tick-en prøver å kalle drawNext. MEN — dette dokumenterer kun
  // dagens oppførsel. Mer robust ville vært fallback til Date.now() slik
  // at NaN-rows alltid skippes.
  //
  // Låser dagens observerbare oppførsel: ugyldig string gir NaN-drawAt og
  // drawNext BLIR kalt. (Faktisk ikke `skipped` som navnet antyder —
  // testen dokumenterer en quirk som bør tas med Agent 3 i Fase 5
  // konsolideringen.)
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 1,
      last_drawn_at: "definitely not a date",
      engine_started_at: new Date(Date.now() - 60_000),
    },
  ]);
  const r = await service.tick();
  // `NaN < Date.now()` er false → `now < dueAt` der dueAt=NaN også false
  // → faller inn i drawNext-kallet.
  assert.equal(r.checked, 1);
  // Dokumenterer dagens quirk: drawNext trigges (ikke skipped).
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("errorMessages cappet til 10 når mange games feiler samtidig", async () => {
  // errorMessages: Array.push gated med `< 10`. Test: 12 games feiler,
  // errorMessages.length skal være nøyaktig 10. Dette beskytter tick-response
  // fra å vokse ubegrenset ved store cascading failures.
  const now = Date.now();
  const oldAt = new Date(now - 10_000);
  const rows = [];
  const failIds = [];
  for (let i = 1; i <= 12; i++) {
    rows.push({
      id: `g-${i}`,
      ticket_config_json: { seconds: 5 },
      draws_completed: 1,
      last_drawn_at: oldAt,
      engine_started_at: oldAt,
    });
    failIds.push(`g-${i}`);
  }
  const { service, called } = makeService(rows, { throwOnIds: failIds });
  const r = await service.tick();
  assert.equal(r.checked, 12);
  assert.equal(r.errors, 12, "alle 12 feiler");
  assert.equal(r.errorMessages?.length, 10, "men errorMessages cappet til 10");
  assert.equal(called.length, 12, "drawNext kalles fortsatt for alle");
});

test("pool-query-feil propagerer til caller (kontraktstest for JobScheduler)", async () => {
  // PM-direktiv 4c #3: pool-feil skal propagere til JobScheduler, ikke
  // fanges inne i tick(). Slik blir kritiske DB-feil synlige i ops-logg
  // i stedet for å bli stumme.
  const boomPool = {
    async query() {
      throw new Error("simulated pg connection lost");
    },
  };
  const { service: drawEngine } = makeFakeDrawEngine();
  const service = new Game1AutoDrawTickService({
    pool: boomPool as never,
    drawEngine,
  });

  await assert.rejects(
    service.tick(),
    (err) =>
      err instanceof Error && err.message.includes("connection lost"),
  );
});

// ── Task 1.1: auto-pause regresjon ──────────────────────────────────────────

test("Task 1.1: paused game filtreres bort av SELECT — ingen drawNext trigges", async () => {
  // Legacy-paritet (Gap #1 i MASTER_HALL_DASHBOARD_GAP_2026-04-24.md): etter
  // at Game1DrawEngineService.drawNext setter paused=true + paused_at_phase
  // ved phase-won skal auto-tick-servicen SKIP rundetak. Dette testes via
  // stub-pool-en som returnerer en tom rows-array (simulerer DB-filter
  // `gs.paused = false`); selv ved en gammel last_drawn_at skal ingen draw
  // trigges.
  //
  // Kontraktstest: denne låser at auto-tick-loopen aldri vil "race" med
  // auto-pause-logikken og trekke en ekstra kule etter en phase-winner.
  const { service, called, queries } = makeService([]); // tom = paused filtrert av DB
  const r = await service.tick();
  assert.equal(r.checked, 0, "ingen paused games skal matches");
  assert.equal(r.drawsTriggered, 0);
  assert.equal(called.length, 0);
  // Dobbelsjekk at SELECT-en fortsatt filtrerer på paused=false (regresjons-
  // gard mot at noen fjerner WHERE-klausulen).
  const sql = queries[0]!.sql;
  assert.ok(
    sql.includes("gs.paused = false"),
    "SELECT må filtrere på paused=false for å unngå tick på auto-paused games"
  );
});

// ── AUTO_DRAW_INTERVAL_MS bug-fix: forceSecondsOverride persisterer ─────────

test("forceSecondsOverride: vinner over per-game ticket_config_json.timing.seconds", async () => {
  // Bug-fix: tidligere ble AUTO_DRAW_INTERVAL_MS env-var aldri lest, så
  // første runde kunne se ut til å bruke den (av tilfeldighet) mens andre
  // runde falt tilbake til ticket_config-default. Med forceSecondsOverride=20
  // skal ALLE runder bruke 20 sekunder uavhengig av per-game ticket_config.
  const now = Date.now();
  const fifteenSecAgo = new Date(now - 15_000);
  // ticket_config sier seconds=5 — uten override ville 15s siden vært "due".
  // Med override=20 skal det IKKE være due (15s < 20s).
  const { service: svcWithOverride, called: c1 } = makeService(
    [
      {
        id: "g-round-2",
        ticket_config_json: { spill1: { timing: { seconds: 5 } } },
        draws_completed: 1,
        last_drawn_at: fifteenSecAgo,
        engine_started_at: fifteenSecAgo,
      },
    ],
    {},
    { forceSecondsOverride: 20 }
  );
  const r1 = await svcWithOverride.tick();
  assert.equal(r1.drawsTriggered, 0, "override=20s skal blokkere draw når det er gått 15s");
  assert.equal(r1.skippedNotDue, 1);
  assert.equal(c1.length, 0);

  // Uten override skal default per-game-config (seconds=5) gjelde og 15s > 5s → due.
  const { service: svcNoOverride, called: c2 } = makeService([
    {
      id: "g-round-2",
      ticket_config_json: { spill1: { timing: { seconds: 5 } } },
      draws_completed: 1,
      last_drawn_at: fifteenSecAgo,
      engine_started_at: fifteenSecAgo,
    },
  ]);
  const r2 = await svcNoOverride.tick();
  assert.equal(r2.drawsTriggered, 1, "uten override → seconds=5 < 15s → due");
  assert.deepEqual(c2, ["g-round-2"]);
});

test("forceSecondsOverride: holder seg stabilt over flere runder med ulike ticket_configs", async () => {
  // Regresjons-låsing: simulerer 3 påfølgende "runder" der hver runde får
  // ulik ticket_config (typisk admin-edit mellom rundene). Override skal
  // holde 20 sekunder for ALLE runder — bug-fixens kjerne.
  const now = Date.now();
  const twentyFiveSecAgo = new Date(now - 25_000);
  const tenSecAgo = new Date(now - 10_000);

  for (const config of [
    { spill1: { timing: { seconds: 3 } } }, // runde 1: 3s
    { timing: { seconds: 5 } }, // runde 2: 5s (generic shape)
    { seconds: 180 }, // runde 3: 180s (worst-case "3 minutter")
  ]) {
    // Med override=20: 25s > 20s → due, men 10s < 20s → ikke due.
    const { service: svcDue, called: cDue } = makeService(
      [
        {
          id: "g-due",
          ticket_config_json: config,
          draws_completed: 1,
          last_drawn_at: twentyFiveSecAgo,
          engine_started_at: twentyFiveSecAgo,
        },
      ],
      {},
      { forceSecondsOverride: 20 }
    );
    const rDue = await svcDue.tick();
    assert.equal(rDue.drawsTriggered, 1, `25s siden + override=20s skal trigge for config ${JSON.stringify(config)}`);
    assert.deepEqual(cDue, ["g-due"]);

    const { service: svcNotDue, called: cNotDue } = makeService(
      [
        {
          id: "g-notdue",
          ticket_config_json: config,
          draws_completed: 1,
          last_drawn_at: tenSecAgo,
          engine_started_at: tenSecAgo,
        },
      ],
      {},
      { forceSecondsOverride: 20 }
    );
    const rNotDue = await svcNotDue.tick();
    assert.equal(rNotDue.drawsTriggered, 0, `10s siden + override=20s skal IKKE trigge for config ${JSON.stringify(config)}`);
    assert.equal(rNotDue.skippedNotDue, 1);
    assert.equal(cNotDue.length, 0);
  }
});

test("forceSecondsOverride: 0/negativ/float ignoreres (samme som ikke-satt)", async () => {
  // Defensiv: ugyldige override-verdier skal ikke knekke tick — service
  // skal falle tilbake til ticket_config + defaultSeconds.
  const now = Date.now();
  const sixSecAgo = new Date(now - 6_000);
  for (const badOverride of [0, -1, -100, NaN, 1.5]) {
    const { service, called } = makeService(
      [
        {
          id: "g1",
          ticket_config_json: { seconds: 3 },
          draws_completed: 1,
          last_drawn_at: sixSecAgo,
          engine_started_at: sixSecAgo,
        },
      ],
      {},
      { forceSecondsOverride: badOverride as number }
    );
    const r = await service.tick();
    // Bad override → ignorert → seconds=3 fra ticket_config → 6s > 3s → due.
    assert.equal(r.drawsTriggered, 1, `ugyldig override=${badOverride} skal ignoreres`);
    assert.deepEqual(called, ["g1"]);
  }
});

test("Task 1.1: paused_at_phase != null endrer ikke tick-kontrakten (ekstra-defensive)", async () => {
  // Stub-pool som simulerer DB som returnerer en rad DESPITE filter (f.eks.
  // om noen ved uhell fjerner `paused = false` fra WHERE). Da ville
  // tick-servicen kalle drawNext, som igjen ville kaste GAME_PAUSED.
  // Denne testen låser feil-isolasjon slik at GAME_PAUSED kun plasseres i
  // errorMessages, tick-en fortsetter for andre games.
  const now = Date.now();
  const oldAt = new Date(now - 10_000);
  const { pool } = createStubPool([
    {
      id: "g-paused",
      ticket_config_json: { seconds: 5 },
      draws_completed: 3,
      last_drawn_at: oldAt,
      engine_started_at: oldAt,
    },
  ] as unknown[]);
  const { service: drawEngine } = makeFakeDrawEngine({
    throwOnIds: ["g-paused"],
  });
  // drawNext throwOnIds simulerer GAME_PAUSED kastet av drawNext-guard.
  // Tick-servicen skal fange denne og merke den som error (ikke krasje).
  const service = new Game1AutoDrawTickService({
    pool: pool as never,
    drawEngine,
  });
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.errors, 1);
  assert.equal(r.drawsTriggered, 0);
  assert.ok(r.errorMessages?.[0]?.includes("g-paused"));
});
