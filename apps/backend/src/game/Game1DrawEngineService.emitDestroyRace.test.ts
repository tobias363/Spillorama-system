/**
 * Regresjons-test for race-condition mellom `emitRoomUpdate` (async) og
 * `destroyRoom` (sync) ved game-end (MAX_DRAWS_REACHED / Fullt Hus).
 *
 * Bakgrunn — Tobias-bug 2026-05-12 (PROD-data 19:15:34):
 * --------------------------------------------------------------------
 *   19:15:34.424 [game1-draw-engine-service] game1.engine.completed
 *                reason=MAX_DRAWS_REACHED
 *   19:15:34.432 [game1-draw-engine-cleanup]  destroyRoom etter
 *                scheduled-game-terminering
 *   19:15:34.432 [player-broadcaster-adapter] emitRoomUpdate failed:
 *                ROOM_NOT_FOUND
 *
 * Sekvens som fyrte bugen:
 *   1. `drawNext()` på siste ball POST-commit:
 *      - Async: `notifyPlayerRoomUpdate(roomCode)` queuer microtask
 *        `Promise.resolve().then(() => emitRoomUpdate(roomCode))`
 *      - Sync (8 ms senere): `destroyRoomIfPresent(roomCode)` fjerner
 *        rommet fra `engine.rooms`
 *   2. Microtask fyrer → `getAuthoritativeRoomSnapshot(roomCode)` →
 *      `requireRoom` kaster `ROOM_NOT_FOUND`
 *   3. Klient mottar ALDRI `room:update` med `gameStatus: ENDED`
 *
 * Konsekvens: spillerklient henger på `gameStatus: RUNNING` til
 * Socket.IO ping-timeout disconnecter (~30 sek). 458 klient-events
 * observert i Tobias' diagnose-dump 19:20:40 — siste var draw-75 med
 * `gameStatus="RUNNING"`, INGEN ENDED-snapshot.event fanget.
 *
 * Fix (PR #1267, cherry-picked):
 * --------------------------------------------------------------------
 *   - Ny `awaitRoomUpdate(roomCode): Promise<void>` på
 *     `Game1PlayerBroadcaster`-interfacet.
 *   - `drawNext` AWAITER denne FØR `destroyRoomIfPresent` når
 *     `isFinished=true` (rad ~1607-1610 i `Game1DrawEngineService.ts`).
 *   - For ikke-finished draws beholdes fire-and-forget
 *     `notifyPlayerRoomUpdate` siden ingen destroyRoom skjer.
 *
 * Hva denne test-filen dekker:
 * --------------------------------------------------------------------
 *   1. Happy-path: `awaitRoomUpdate` fullfører FØR `destroyRoom` kalles
 *      når draw fullfører spillet (3 unit-tester).
 *   2. Regresjons-bevis: dokumentasjon av hvordan race ville reprodusert
 *      seg uten `awaitRoomUpdate` (1 forklarende test som speiler
 *      fire-and-forget-flow direkte i mock).
 *   3. Ikke-finished draws beholder fire-and-forget-semantikk og kaller
 *      IKKE `awaitRoomUpdate` (1 unit-test).
 *   4. INGEN ROOM_NOT_FOUND-error oppstår fordi emit fullfører før
 *      destroy (verifisert via call-order + try/catch på mock).
 *
 * Test-mønster:
 * --------------------------------------------------------------------
 *   - Bruker stub-pool (samme som `Game1DrawEngineService.test.ts` og
 *     `Game1DrawEngineService.destroyRoom.test.ts`).
 *   - `awaitRoomUpdate`-mock har deterministisk latency via `await
 *     Promise.resolve()` (microtask-tick) for å demonstrere at
 *     destroy må VENTE på emit.
 *   - Fake BingoEngine sporer `destroyRoom`-kall.
 *   - Felles `callOrder: string[]` array logger eksakt rekkefølge.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import type {
  Game1PlayerBroadcaster,
  Game1PlayerDrawNewEvent,
  Game1PlayerPatternWonEvent,
} from "./Game1PlayerBroadcaster.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "./Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stub pool (matcher Game1DrawEngineService.destroyRoom.test.ts) ──────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
}

interface StubClient {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql)) {
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        if (r.once !== false) queue.splice(i, 1);
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async (): Promise<StubClient> => ({
        query: runQuery,
        release: () => undefined,
      }),
      query: runQuery,
    },
    queries,
  };
}

// ── Fixture helpers (matcher Game1DrawEngineService.destroyRoom.test.ts) ────

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "ready_to_start",
    ticket_config_json: {},
    room_code: null,
    game_config_json: null,
    ...overrides,
  };
}

function runningStateRow(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_game_id: "g1",
    draw_bag_json: [10, 20, 30, 40, 50, 60],
    draws_completed: 0,
    current_phase: 1,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

function makeFakeTicketPurchase(
  purchases: Game1TicketPurchaseRow[] = []
): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return purchases;
    },
  } as unknown as Game1TicketPurchaseService;
}

// ── Queue-builder: drawNext som fullfører spillet (gjenbrukt fra destroyRoom.test) ──

function drawNextCompletionResponses(opts: {
  roomCode: string | null;
  maxDraws?: number;
  startDraws?: number;
}): StubResponse[] {
  const maxDraws = opts.maxDraws ?? 3;
  const startDraws = opts.startDraws ?? maxDraws - 1;
  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          draws_completed: startDraws,
          last_drawn_ball: 20,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        scheduledGameRow({
          status: "running",
          ticket_config_json: { maxDraws },
          room_code: opts.roomCode,
        }),
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) => s.includes("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    // UPDATE scheduled_game → completed.
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("'completed'"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [
        runningStateRow({
          draws_completed: startDraws + 1,
          last_drawn_ball: 30,
          engine_ended_at: "2026-04-21T12:05:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

// Queue for drawNext som IKKE fullfører.
function drawNextNonCompletionResponses(
  roomCode: string | null = null
): StubResponse[] {
  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [scheduledGameRow({ status: "running", room_code: roomCode })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) => s.includes("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 10 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [{ draw_sequence: 1, ball_value: 10, drawn_at: "..." }],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

// ── Broadcaster med latency + call-order-tracking ───────────────────────────

interface CallOrderRecorder {
  /** Append-only ordered list av events ("emit:start", "emit:done", "destroy:<code>", ...). */
  log: string[];
  /** ROOM_NOT_FOUND-feil fanget under emit (skal være tom etter fixen). */
  roomNotFoundErrors: Array<{ roomCode: string; phase: string }>;
  /** Snapshot-er som ble emittet til klient (verifiserer ENDED-state nås). */
  emittedSnapshots: Array<{ roomCode: string; gameStatus: "RUNNING" | "ENDED" }>;
}

/**
 * Bygger en `Game1PlayerBroadcaster` som:
 *   - Logger eksakt call-rekkefølge ved start + slutt av hver async-emit.
 *   - Simulerer realistisk latency via microtask-tick (`await Promise.resolve()`).
 *   - Sjekker mot et "room destroyed"-flag for å fange ROOM_NOT_FOUND-race
 *     (uten flag er emit "trygg"; med flag set ville den kasta).
 *   - Skriver simulert ENDED-snapshot til `emittedSnapshots` for verifisering.
 *
 * Mock-en speiler `game1PlayerBroadcasterAdapter.ts`-implementasjonen
 * (try/catch + log.warn ved emitRoomUpdate-feil), men i stedet for å
 * faktisk kaste loggrer vi til `roomNotFoundErrors`.
 */
function makeRaceTrackingBroadcaster(
  recorder: CallOrderRecorder,
  isRoomDestroyed: () => boolean,
  opts: {
    /**
     * Hvor mange microtask-ticks `awaitRoomUpdate` skal vente før det
     * lager snapshotet. Default 3 ticks for å sikre at en evt. sync
     * `destroyRoom` rekker å fyre først hvis fixen mangler.
     */
    microtaskTicks?: number;
  } = {}
): Game1PlayerBroadcaster {
  const ticks = opts.microtaskTicks ?? 3;

  const doEmit = async (roomCode: string, phase: string) => {
    recorder.log.push(`emit:start[${phase}](${roomCode})`);
    // Microtask-tick-loop simulerer den faktiske async-naturen til
    // `emitRoomUpdate` (snapshot-bygging + io.emit). Hver tick gir
    // sync code (eks. destroyRoom) en sjanse til å kjøre imellom.
    for (let i = 0; i < ticks; i++) {
      await Promise.resolve();
    }
    // Sjekk om rommet er destroyed — speiler `requireRoom(roomCode)`
    // i `getAuthoritativeRoomSnapshot`.
    if (isRoomDestroyed()) {
      recorder.roomNotFoundErrors.push({ roomCode, phase });
      recorder.log.push(`emit:ROOM_NOT_FOUND[${phase}](${roomCode})`);
      // Mock speiler adapter-en som try/catch-er feilen og log.warn-er.
      // I prod-koden ville ingen snapshot blitt emittet — klient hadde
      // hengt på forrige (RUNNING) state. Vi modellerer det ved IKKE
      // å skrive til `emittedSnapshots`.
      return;
    }
    // Rommet eksisterer fortsatt → emit ENDED-snapshot.
    recorder.emittedSnapshots.push({ roomCode, gameStatus: "ENDED" });
    recorder.log.push(`emit:done[${phase}](${roomCode})`);
  };

  return {
    onDrawNew: (_event: Game1PlayerDrawNewEvent) => undefined,
    onPatternWon: (_event: Game1PlayerPatternWonEvent) => undefined,
    onRoomUpdate: (roomCode: string) => {
      // Fire-and-forget — kalleren venter ikke. Race-mønsteret som
      // forårsaket bugen. Logger som "onRoomUpdate" så vi kan se om
      // service-koden kaller fire-and-forget vs await-variant.
      recorder.log.push(`onRoomUpdate-fire-and-forget(${roomCode})`);
      void doEmit(roomCode, "onRoomUpdate");
    },
    awaitRoomUpdate: async (roomCode: string) => {
      // AWAIT-variant — kaller skal vente på denne FØR destroyRoom.
      // Hvis denne brukes ved game-end fungerer fixen.
      recorder.log.push(`awaitRoomUpdate-called(${roomCode})`);
      await doEmit(roomCode, "awaitRoomUpdate");
    },
  };
}

// ── Fake BingoEngine som synkront fjerner rommet ────────────────────────────

function makeRaceTrackingEngine(recorder: CallOrderRecorder): {
  engine: import("./BingoEngine.js").BingoEngine;
  roomDestroyed: { value: boolean };
  destroyCalls: string[];
} {
  const destroyCalls: string[] = [];
  const roomDestroyed = { value: false };
  const fake = {
    destroyRoom(roomCode: string) {
      recorder.log.push(`destroyRoom-sync(${roomCode})`);
      destroyCalls.push(roomCode);
      // Sync-mutering av "rom-state" — etter dette ville
      // `getAuthoritativeRoomSnapshot` kasta ROOM_NOT_FOUND.
      roomDestroyed.value = true;
    },
  } as unknown as import("./BingoEngine.js").BingoEngine;
  return { engine: fake, roomDestroyed, destroyCalls };
}

// ── Test 1: emit fullfører FØR destroyRoom ved game-end ─────────────────────

test(
  "race-fix: drawNext på siste ball — awaitRoomUpdate fullfører FØR destroyRoom kjøres",
  async () => {
    const recorder: CallOrderRecorder = {
      log: [],
      roomNotFoundErrors: [],
      emittedSnapshots: [],
    };
    const { engine, roomDestroyed, destroyCalls } =
      makeRaceTrackingEngine(recorder);
    const broadcaster = makeRaceTrackingBroadcaster(
      recorder,
      () => roomDestroyed.value,
      { microtaskTicks: 3 }
    );
    const { pool } = createStubPool(
      drawNextCompletionResponses({ roomCode: "ROOM-RACE" })
    );

    const service = new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      playerBroadcaster: broadcaster,
      bingoEngine: engine,
    });

    const view = await service.drawNext("g1");
    assert.equal(
      view.isFinished,
      true,
      "drawen skal ha fullført spillet (isFinished=true)"
    );

    // Verifiser at destroyRoom faktisk ble kalt med riktig roomCode.
    assert.deepEqual(
      destroyCalls,
      ["ROOM-RACE"],
      "destroyRoom skal kalles én gang med roomCode"
    );

    // Verifiser at awaitRoomUpdate (ikke onRoomUpdate) ble brukt ved game-end.
    const awaitCalled = recorder.log.some((entry) =>
      entry.startsWith("awaitRoomUpdate-called(ROOM-RACE)")
    );
    assert.ok(
      awaitCalled,
      "awaitRoomUpdate skal kalles ved game-end (ikke fire-and-forget onRoomUpdate)"
    );

    // Verifiser at fire-and-forget IKKE ble brukt ved game-end.
    const fireAndForget = recorder.log.some((entry) =>
      entry.startsWith("onRoomUpdate-fire-and-forget")
    );
    assert.equal(
      fireAndForget,
      false,
      "onRoomUpdate (fire-and-forget) skal IKKE kalles når isFinished=true"
    );

    // Verifiser call-rekkefølge: emit:done MÅ være FØR destroyRoom-sync.
    const emitDoneIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("emit:done[awaitRoomUpdate](ROOM-RACE)")
    );
    const destroyIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("destroyRoom-sync(ROOM-RACE)")
    );
    assert.ok(emitDoneIdx >= 0, "emit:done skal vises i call-loggen");
    assert.ok(destroyIdx >= 0, "destroyRoom-sync skal vises i call-loggen");
    assert.ok(
      emitDoneIdx < destroyIdx,
      `emit må fullføre (${emitDoneIdx}) FØR destroy (${destroyIdx}) — fant call-order: ${recorder.log.join(" → ")}`
    );

    // Verifiser at INGEN ROOM_NOT_FOUND-feil oppstod.
    assert.deepEqual(
      recorder.roomNotFoundErrors,
      [],
      `INGEN ROOM_NOT_FOUND-feil skal logges — fant: ${JSON.stringify(recorder.roomNotFoundErrors)}`
    );

    // Verifiser at ENDED-snapshot faktisk ble emittet til klient.
    assert.equal(
      recorder.emittedSnapshots.length,
      1,
      "ett snapshot skal emittes til klient"
    );
    assert.equal(
      recorder.emittedSnapshots[0]!.gameStatus,
      "ENDED",
      "klient skal motta room:update med gameStatus=ENDED"
    );
    assert.equal(recorder.emittedSnapshots[0]!.roomCode, "ROOM-RACE");
  }
);

// ── Test 2: emit-rekkefølge med høyere microtask-latency (deterministisk) ───

test(
  "race-fix: emit fullfører før destroy selv ved høy microtask-latency (10 ticks)",
  async () => {
    // Høyere tick-count = mer aggressiv simulert latency. Hvis fixen
    // mangler skulle destroy uavhengig rekke å fyre først (race-bevis).
    // Med fixen er rekkefølgen garantert uansett ticks.
    const recorder: CallOrderRecorder = {
      log: [],
      roomNotFoundErrors: [],
      emittedSnapshots: [],
    };
    const { engine, roomDestroyed } = makeRaceTrackingEngine(recorder);
    const broadcaster = makeRaceTrackingBroadcaster(
      recorder,
      () => roomDestroyed.value,
      { microtaskTicks: 10 }
    );
    const { pool } = createStubPool(
      drawNextCompletionResponses({ roomCode: "ROOM-SLOW-EMIT" })
    );

    const service = new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      playerBroadcaster: broadcaster,
      bingoEngine: engine,
    });

    await service.drawNext("g1");

    // Selv med 10 microtask-tick ventetid skal emit fullføre først.
    assert.deepEqual(
      recorder.roomNotFoundErrors,
      [],
      "fixen skal garantere at emit fullfører før destroy uavhengig av latency"
    );
    assert.equal(
      recorder.emittedSnapshots.length,
      1,
      "klient skal motta ENDED-snapshot selv ved treg emit"
    );

    // Verifiser at både emit:done og destroyRoom-sync er i loggen.
    const emitDoneIdx = recorder.log.findIndex((entry) =>
      entry.includes("emit:done[awaitRoomUpdate]")
    );
    const destroyIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("destroyRoom-sync")
    );
    assert.ok(emitDoneIdx < destroyIdx, "emit må fullføre før destroy");
  }
);

// ── Test 3: ikke-finished draws bruker fire-and-forget (uendret atferd) ─────

test(
  "race-fix: ikke-finished draw beholder fire-and-forget onRoomUpdate (ingen await + ingen destroy)",
  async () => {
    // For non-final draws (draws_completed < maxDraws, ingen full house) er
    // det INGEN destroyRoom som race-er. Da skal vi beholde
    // fire-and-forget for å unngå unødvendig latency per draw.
    const recorder: CallOrderRecorder = {
      log: [],
      roomNotFoundErrors: [],
      emittedSnapshots: [],
    };
    const { engine, roomDestroyed, destroyCalls } =
      makeRaceTrackingEngine(recorder);
    const broadcaster = makeRaceTrackingBroadcaster(
      recorder,
      () => roomDestroyed.value,
      { microtaskTicks: 2 }
    );
    const { pool } = createStubPool(
      drawNextNonCompletionResponses("ROOM-NON-FINAL")
    );

    const service = new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      playerBroadcaster: broadcaster,
      bingoEngine: engine,
    });

    const view = await service.drawNext("g1");
    assert.equal(
      view.isFinished,
      false,
      "drawen skal IKKE ha fullført spillet"
    );

    // destroyRoom skal IKKE kalles for ikke-finished draws.
    assert.deepEqual(
      destroyCalls,
      [],
      "destroyRoom skal IKKE kalles for ikke-finished draws"
    );

    // Fire-and-forget skal brukes (ikke await).
    const fireAndForget = recorder.log.some((entry) =>
      entry.startsWith("onRoomUpdate-fire-and-forget(ROOM-NON-FINAL)")
    );
    assert.ok(
      fireAndForget,
      "ikke-finished draws skal bruke fire-and-forget onRoomUpdate"
    );

    const awaitCalled = recorder.log.some((entry) =>
      entry.startsWith("awaitRoomUpdate-called")
    );
    assert.equal(
      awaitCalled,
      false,
      "awaitRoomUpdate skal IKKE kalles for ikke-finished draws"
    );

    // Vi venter et microtask-pust slik at den fire-and-forget-microtasken
    // får fyre før vi sjekker resultatet.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    // Klient skal fortsatt motta snapshot (men gameStatus er fortsatt RUNNING
    // — vi modellerer ENDED kun siden mock-en alltid skriver "ENDED";
    // i prod ville snapshot reflektert faktisk state).
    assert.equal(
      recorder.emittedSnapshots.length,
      1,
      "fire-and-forget skal også emittere snapshot"
    );

    // Ingen ROOM_NOT_FOUND-feil siden destroyRoom ikke kjøres.
    assert.deepEqual(recorder.roomNotFoundErrors, []);
  }
);

// ── Test 4: REGRESJONS-BEVIS — hva ville skjedd uten fixen ──────────────────

test(
  "REGRESJON-BEVIS: simulerer pre-fix-atferd (fire-and-forget + sync destroy) → ROOM_NOT_FOUND",
  async () => {
    // Denne testen mocker IKKE service-koden — den simulerer DIRECTLY
    // hva som ville skjedd hvis service-koden brukte fire-and-forget
    // `onRoomUpdate` istedenfor `awaitRoomUpdate` ved game-end. Demonstrerer
    // hvorfor `awaitRoomUpdate` trengs.
    //
    // Sekvens (pre-fix, fra PROD-log 19:15:34):
    //   1. service.notifyPlayerRoomUpdate(roomCode)
    //      → fire-and-forget microtask som skal emit room:update
    //   2. service.destroyRoomIfPresent(...)  ← SYNC
    //      → engine.destroyRoom(roomCode)     ← sync mutering av room-state
    //   3. microtask fyrer → getAuthoritativeRoomSnapshot(roomCode)
    //      → requireRoom → ROOM_NOT_FOUND
    //
    // Vi reproduserer ved å kalle de samme operasjonene direkte i mock-en.
    const recorder: CallOrderRecorder = {
      log: [],
      roomNotFoundErrors: [],
      emittedSnapshots: [],
    };
    const { engine: fakeEngine, roomDestroyed } =
      makeRaceTrackingEngine(recorder);
    const broadcaster = makeRaceTrackingBroadcaster(
      recorder,
      () => roomDestroyed.value,
      { microtaskTicks: 3 }
    );

    // SIMULER PRE-FIX FLOW:
    //   - Steg 1: queue fire-and-forget emit (uten å awaite)
    broadcaster.onRoomUpdate("ROOM-PROD-LOG");
    //   - Steg 2: SYNC kall til destroyRoom (mock = engine.destroyRoom)
    fakeEngine.destroyRoom("ROOM-PROD-LOG");
    //   - Steg 3: la microtask-køen drenes
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    // ── Assert at race-en faktisk skjedde ──
    // a) destroyRoom-sync var FØRST i loggen (etter fire-and-forget-trigger).
    const destroyIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("destroyRoom-sync(ROOM-PROD-LOG)")
    );
    const emitStartIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("emit:start[onRoomUpdate]")
    );
    assert.ok(
      destroyIdx > 0,
      "destroyRoom-sync må ha kjørt i pre-fix-simulering"
    );
    assert.ok(
      emitStartIdx >= 0,
      "emit:start må ha kjørt i pre-fix-simulering"
    );
    // I pre-fix-flow ble fire-and-forget queuet FØRST men destroy kjørte
    // SYNKRONT — så destroy fullførte før emit fikk gjort jobben sin.
    assert.ok(
      destroyIdx < emitStartIdx ||
        recorder.log.indexOf(
          `emit:ROOM_NOT_FOUND[onRoomUpdate](ROOM-PROD-LOG)`
        ) >= 0,
      "i pre-fix-flow ville destroy enten fyre først eller emit ramme ROOM_NOT_FOUND"
    );

    // b) ROOM_NOT_FOUND-feil ble logget — bekrefter PROD-bug-pattern.
    assert.equal(
      recorder.roomNotFoundErrors.length,
      1,
      `pre-fix-flow skal trigge ROOM_NOT_FOUND-feil (PROD-log-pattern). Faktisk: ${recorder.roomNotFoundErrors.length}`
    );
    assert.equal(
      recorder.roomNotFoundErrors[0]!.roomCode,
      "ROOM-PROD-LOG",
      "feilen skal være bundet til riktig roomCode"
    );
    assert.equal(
      recorder.roomNotFoundErrors[0]!.phase,
      "onRoomUpdate",
      "feilen skjedde i fire-and-forget-pathen (det er bug-en fixen adresserer)"
    );

    // c) KRITISK: ingen ENDED-snapshot ble emittet → klient henger på RUNNING.
    assert.equal(
      recorder.emittedSnapshots.length,
      0,
      `pre-fix-bugen: klient mottar ALDRI ENDED-snapshot. Hadde sett ${recorder.emittedSnapshots.length} snapshots.`
    );
  }
);

// ── Test 5: kontrast-test — fixen sin AWAIT-flow gir korrekt sekvens ────────

test(
  "KONTRAST: simulert post-fix-flow (await + sync destroy) → ENDED-snapshot mottatt",
  async () => {
    // Speilbilde av Test 4 men med `awaitRoomUpdate` istedenfor
    // fire-and-forget `onRoomUpdate`. Verifiserer at fixen løser bugen.
    const recorder: CallOrderRecorder = {
      log: [],
      roomNotFoundErrors: [],
      emittedSnapshots: [],
    };
    const { engine: fakeEngine, roomDestroyed } =
      makeRaceTrackingEngine(recorder);
    const broadcaster = makeRaceTrackingBroadcaster(
      recorder,
      () => roomDestroyed.value,
      { microtaskTicks: 3 }
    );

    // SIMULER POST-FIX FLOW:
    //   - Steg 1: AWAIT emit (blokkerer til microtask har fullført)
    await broadcaster.awaitRoomUpdate("ROOM-FIXED");
    //   - Steg 2: SYNC destroyRoom (nå trygt siden emit er ferdig)
    fakeEngine.destroyRoom("ROOM-FIXED");

    // ── Assert at sekvensen funket ──
    const emitDoneIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("emit:done[awaitRoomUpdate](ROOM-FIXED)")
    );
    const destroyIdx = recorder.log.findIndex((entry) =>
      entry.startsWith("destroyRoom-sync(ROOM-FIXED)")
    );
    assert.ok(
      emitDoneIdx >= 0 && destroyIdx >= 0,
      "begge events skal vises i loggen"
    );
    assert.ok(
      emitDoneIdx < destroyIdx,
      `emit:done (${emitDoneIdx}) må komme FØR destroy (${destroyIdx}) i post-fix-flow`
    );

    // Ingen ROOM_NOT_FOUND-feil.
    assert.deepEqual(
      recorder.roomNotFoundErrors,
      [],
      "post-fix-flow skal ALDRI trigge ROOM_NOT_FOUND"
    );

    // ENDED-snapshot mottatt → klient ser game-over-state.
    assert.equal(recorder.emittedSnapshots.length, 1);
    assert.equal(recorder.emittedSnapshots[0]!.gameStatus, "ENDED");
    assert.equal(recorder.emittedSnapshots[0]!.roomCode, "ROOM-FIXED");
  }
);
