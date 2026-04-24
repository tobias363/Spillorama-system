/**
 * Task 1.1: auto-pause ved phase-won. Gap #1 i
 * docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md.
 *
 * Tester at `Game1DrawEngineService.drawNext()`:
 *   1. LINE-vinn (fase 1) → engine setter paused=true, paused_at_phase=1
 *      og emitter `game1:auto-paused` via adminBroadcaster.
 *   2. Påfølgende `drawNext` når paused=true → DomainError(GAME_PAUSED)
 *      (ingen nye draws trekkes).
 *   3. Resume-flipp (simulert via DB-oppdatering) → neste drawNext går
 *      gjennom.
 *   4. Fullt Hus (fase 5) → engine avslutter spillet, IKKE auto-pauser
 *      (isFinished=true, paused_at_phase forblir NULL).
 *   5. drawNext-returvalue har `pausedAutomatically=true` når auto-pause
 *      ble trigget i samme kall.
 *
 * Testmønster følger Game1DrawEngineService.test.ts: stub-pool som matcher
 * SQL-fragment. Et fake payoutService returnerer kontrollerbare
 * phase-results (vi kan si "LINE vunnet" eller "ingen vinner").
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import {
  Game1DrawEngineService,
  type Game1GameStateView,
} from "./Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "./Game1TicketPurchaseService.js";
import type {
  Game1PayoutService,
  Game1PhasePayoutInput,
  Game1PhasePayoutResult,
} from "./Game1PayoutService.js";
import type {
  AdminGame1Broadcaster,
  AdminGame1AutoPausedEvent,
  AdminGame1PhaseWonEvent,
} from "./AdminGame1Broadcaster.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stub pool ───────────────────────────────────────────────────────────────

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
      connect: async () => ({ query: runQuery, release: () => undefined }),
      query: runQuery,
    },
    queries,
  };
}

// ── Fixture helpers ─────────────────────────────────────────────────────────

function runningStateRow(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_game_id: "g1",
    // Draw-bag: alle ≤75 slik at ingen unødige spill-endre. 6 baller er nok
    // for test-scenariene (LINE, paused, resume, Fullt Hus).
    draw_bag_json: [10, 20, 30, 40, 50, 60],
    draws_completed: 0,
    current_phase: 1,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    paused_at_phase: null,
    engine_started_at: "2026-04-24T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

function scheduledGameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    status: "running",
    ticket_config_json: {},
    game_config_json: null,
    room_code: null,
    ...overrides,
  };
}

/**
 * Fake payoutService som returnerer kontrollerbare phaseResults. Default
 * `phaseWon=false` (ingen vinner). Tester overstyrer ved å populere
 * `shouldWinOnBallValue` og `winnerAssignmentIds`.
 *
 * OBS: denne fakes inn BÅDE Game1PayoutService-grensesnittet (for typen)
 * og assignment-SELECT-queryene via pool-responsene. Service-intern logikk
 * kaller `client.query` for å laste assignments; vi returnerer 1 rad som
 * "matcher" winning-pattern slik at `evaluatePhase` (som kalles ekte) ser
 * full linje på ball-verdien.
 */
function makeFakePayoutService(): Game1PayoutService {
  return {
    async payoutPhase(
      _client: unknown,
      input: Game1PhasePayoutInput
    ): Promise<Game1PhasePayoutResult> {
      return {
        phase: input.phase,
        totalWinners: input.winners.length,
        prizePerWinnerCents: 1000,
        houseRetainedCents: 0,
        winnerRecords: input.winners.map((w) => ({
          assignmentId: w.assignmentId,
          userId: "u-1",
          prizeCents: 1000,
          jackpotCents: 0,
          walletTransactionId: "wtx-1",
          phaseWinnerId: `pw-${w.assignmentId}`,
        })),
      };
    },
    // Service-laget kaller ikke resten direkte fra drawNext; fyll inn som
    // any for å tilfredsstille typen.
  } as unknown as Game1PayoutService;
}

function makeFakeTicketPurchase(): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return [] as Game1TicketPurchaseRow[];
    },
  } as unknown as Game1TicketPurchaseService;
}

/**
 * Recording adminBroadcaster for å assertere at `onAutoPaused` kalles med
 * riktig payload.
 */
function makeRecordingBroadcaster(): {
  broadcaster: AdminGame1Broadcaster;
  autoPaused: AdminGame1AutoPausedEvent[];
  phaseWon: AdminGame1PhaseWonEvent[];
} {
  const autoPaused: AdminGame1AutoPausedEvent[] = [];
  const phaseWon: AdminGame1PhaseWonEvent[] = [];
  const broadcaster: AdminGame1Broadcaster = {
    onStatusChange: () => undefined,
    onDrawProgressed: () => undefined,
    onPhaseWon: (e) => phaseWon.push(e),
    onPhysicalTicketWon: () => undefined,
    onAutoPaused: (e) => autoPaused.push(e),
    onResumed: () => undefined,
    // Task 1.6: transfer/master-change broadcasts ikke under test her.
    onTransferRequest: () => undefined,
    onTransferApproved: () => undefined,
    onTransferRejected: () => undefined,
    onTransferExpired: () => undefined,
    onMasterChanged: () => undefined,
  };
  return { broadcaster, autoPaused, phaseWon };
}

/**
 * Bygg en 5x5-grid hvor første rad er [10, 20, 30, 40, 50] og sentrum
 * (index 12) er 0 (free centre). Resten er 1, 2, 3, ... innenfor gyldige
 * kolonne-ranges for å unngå at evaluatePhase plukker feil linje.
 *
 * Marked slik at når ballen 10, 20, 30, 40, 50 blir trukket → første rad
 * fullføres → LINE vunnet.
 */
function buildWinningGrid(): number[] {
  // Row 0 = winning line: ballene 10, 20, 30, 40, 50.
  // Row 1..4 = dummy tall inni korrekte kolonne-ranges (75-ball):
  //   col 0=1..15, col 1=16..30, col 2=31..45, col 3=46..60, col 4=61..75.
  // free centre (row 2 col 2, index 12) = 0.
  return [
    // row 0
    10, 20, 30, 40, 50,
    // row 1
    1, 16, 31, 46, 61,
    // row 2 — free centre (index 12) = 0
    2, 17, 0, 47, 62,
    // row 3
    3, 18, 32, 48, 63,
    // row 4
    4, 19, 33, 49, 64,
  ];
}

/**
 * Wrap bool[] i `{ marked: [...] }`-shape som parseMarkings forventer.
 * Real DB-format matcher jsonb_set som `markBallOnAssignments` skriver.
 */
function wrapMarkings(marked: boolean[]): { marked: boolean[] } {
  return { marked };
}

function makeService(opts: {
  poolResponses: StubResponse[];
  broadcaster?: AdminGame1Broadcaster;
  withPayout?: boolean;
}): {
  service: Game1DrawEngineService;
  audit: InMemoryAuditLogStore;
  queries: RecordedQuery[];
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService,
    payoutService: opts.withPayout === false ? undefined : makeFakePayoutService(),
    adminBroadcaster: opts.broadcaster,
  });
  return { service, audit: auditStore, queries };
}

// ── Tester ──────────────────────────────────────────────────────────────────

test("Task 1.1: LINE-vinn (fase 1) → paused=true, paused_at_phase=1 persisteres", async () => {
  const { broadcaster, autoPaused, phaseWon } = makeRecordingBroadcaster();

  // Vi simulerer at første rad (row 0 = 10,20,30,40,50) allerede er delvis
  // markert. Engine trekker ball nr. 50 (draws_completed=4 → bag[4]=50) og
  // dette fullfører linjen. Grid + markings må reflekter at 10,20,30,40 er
  // markert, og at siste ball 50 plasseres i grid-celle som gjør row 0 til
  // winning.
  //
  // Men: evaluatePhase i engine leser `markings_json` per assignment. Vi
  // returnerer 1 assignment med `markings` som har indeksene for 10,20,30,40
  // markert (pluss free centre).

  const winningMarkings = new Array(25).fill(false);
  winningMarkings[0] = true; // ball 10
  winningMarkings[1] = true; // ball 20
  winningMarkings[2] = true; // ball 30
  winningMarkings[3] = true; // ball 40
  winningMarkings[12] = true; // free centre

  const { service, queries } = makeService({
    broadcaster,
    poolResponses: [
      // runInTransaction
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      // loadGameStateForUpdate — første kall (fase 1, 4 baller trukket)
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 4,
            last_drawn_ball: 40,
          }),
        ],
      },
      // loadScheduledGameForUpdate
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow()],
      },
      // INSERT draws
      {
        match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      // markBallOnAssignments — les assignments med grid (første kall i trans)
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: buildWinningGrid(),
            markings_json: wrapMarkings(winningMarkings),
            buyer_user_id: "u-1",
            hall_id: "hall-a",
            ticket_color: "yellow",
          },
        ],
      },
      // markBallOnAssignments — UPDATE per assignment (siste ball markeres på rad 0 col 4)
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      // evaluateAndPayoutPhase — andre lesning av assignments (nå med siste ball markert)
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: buildWinningGrid(),
            markings_json: wrapMarkings(
              (() => {
                const m = [...winningMarkings];
                m[4] = true; // siste ball 50 markert på row 0 col 4 → LINE komplett
                return m;
              })()
            ),
            buyer_user_id: "u-1",
            hall_id: "hall-a",
            ticket_color: "yellow",
          },
        ],
      },
      // evaluatePhysicalTickets — ingen fysiske bonger
      {
        match: (s) =>
          s.includes("static_tickets") || s.includes("physical_ticket"),
        rows: [],
        once: false,
      },
      // resolveWalletIdForUser for vinner
      {
        match: (s) => s.includes("app_users") && s.includes("wallet_id"),
        rows: [{ wallet_id: "wlt-1" }],
      },
      // UPDATE game_state (draws_completed, last_drawn_*, current_phase,
      // engine_ended_at, paused, paused_at_phase — DEN sentrale assertion)
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("app_game1_game_state") &&
          s.includes("paused_at_phase"),
        rows: [],
      },
      // loadGameState (SELECT *) etter UPDATE — returner ny state med
      // paused=true og paused_at_phase=1 slik at view speiler DB.
      {
        match: (s) =>
          s.includes("app_game1_game_state") &&
          s.includes("SELECT") &&
          !s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 5,
            last_drawn_ball: 50,
            last_drawn_at: "2026-04-24T12:01:00.000Z",
            current_phase: 2, // phase-won → neste fase
            paused: true,
            paused_at_phase: 1, // fasen som akkurat ble vunnet
          }),
        ],
      },
      // loadDrawsInOrder
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          { draw_sequence: 1, ball_value: 10, drawn_at: "2026-04-24T12:00:10.000Z" },
          { draw_sequence: 2, ball_value: 20, drawn_at: "2026-04-24T12:00:20.000Z" },
          { draw_sequence: 3, ball_value: 30, drawn_at: "2026-04-24T12:00:30.000Z" },
          { draw_sequence: 4, ball_value: 40, drawn_at: "2026-04-24T12:00:40.000Z" },
          { draw_sequence: 5, ball_value: 50, drawn_at: "2026-04-24T12:00:50.000Z" },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  const view = await service.drawNext("g1");

  // View-et skal speile DB-state: paused, paused_at_phase=1.
  assert.equal(view.isPaused, true, "view.isPaused skal være true etter auto-pause");
  assert.equal(
    view.pausedAtPhase,
    1,
    "view.pausedAtPhase skal matche fasen som ble vunnet"
  );
  assert.equal(
    view.pausedAutomatically,
    true,
    "view.pausedAutomatically skal merke at auto-pause trigget i denne draw"
  );
  assert.equal(view.drawsCompleted, 5);
  assert.equal(view.lastDrawnBall, 50);

  // Verifiser UPDATE-query SET paused=true + paused_at_phase=1.
  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("paused_at_phase")
  );
  assert.ok(updateQuery, "UPDATE med paused_at_phase skal skje");
  // Params: [scheduledGameId, nextSequence, ball, newPhase, isFinished,
  //          autoPauseTriggered, paused_at_phase_value]
  assert.equal(updateQuery!.params[5], true, "autoPauseTriggered param = true");
  assert.equal(
    updateQuery!.params[6],
    1,
    "paused_at_phase-param = current_phase (1)"
  );
  assert.equal(
    updateQuery!.params[4],
    false,
    "isFinished param = false (LINE, ikke Fullt Hus)"
  );

  // POST-commit: phase-won + auto-paused events emittet i rekkefølge.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(phaseWon.length, 1, "phase-won skal emittes");
  assert.equal(phaseWon[0]!.phase, 1);
  assert.equal(autoPaused.length, 1, "auto-paused skal emittes");
  assert.equal(autoPaused[0]!.phase, 1, "auto-paused.phase = fasen som ble vunnet");
  assert.equal(autoPaused[0]!.gameId, "g1");
  assert.ok(autoPaused[0]!.pausedAt > 0);
});

test("Task 1.1: påfølgende drawNext når paused=true → DomainError(GAME_PAUSED)", async () => {
  // Etter auto-pause er paused=true i DB. Neste drawNext må avvises slik at
  // ingen flere kuler trekkes før Resume.
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 5,
            last_drawn_ball: 50,
            paused: true,
            paused_at_phase: 1,
          }),
        ],
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) => err instanceof DomainError && err.code === "GAME_PAUSED",
    "drawNext skal kaste GAME_PAUSED når paused=true"
  );
});

test("Task 1.1: etter resume (paused=false) → drawNext fortsetter normalt", async () => {
  // Simuler state etter resume: paused=false, paused_at_phase=NULL,
  // current_phase=2 (vi er nå i rad 2-fasen). Draw trekker ball 60.
  // Ingen vinner i fase 2 for denne drawen (payoutService returnerer
  // tom winners-array fordi assignment-liste har ingen match).

  const { broadcaster, autoPaused } = makeRecordingBroadcaster();
  const { service, queries } = makeService({
    broadcaster,
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 5,
            last_drawn_ball: 50,
            current_phase: 2,
            paused: false,
            paused_at_phase: null,
          }),
        ],
      },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow()],
      },
      {
        match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      // markBallOnAssignments — ingen assignments (tom game)
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [],
        once: false,
      },
      // evaluatePhysicalTickets
      {
        match: (s) => s.includes("static_tickets"),
        rows: [],
        once: false,
      },
      // UPDATE game_state (ingen pause)
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      // loadGameState
      {
        match: (s) =>
          s.includes("app_game1_game_state") &&
          s.includes("SELECT") &&
          !s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 6,
            last_drawn_ball: 60,
            current_phase: 2,
            paused: false,
            paused_at_phase: null,
          }),
        ],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          { draw_sequence: 6, ball_value: 60, drawn_at: "2026-04-24T12:10:00.000Z" },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isPaused, false);
  assert.equal(view.pausedAtPhase, null);
  assert.equal(view.pausedAutomatically, undefined);
  assert.equal(view.drawsCompleted, 6);
  assert.equal(view.lastDrawnBall, 60);

  // UPDATE skal ha autoPauseTriggered=false.
  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("paused_at_phase")
  );
  assert.ok(updateQuery);
  assert.equal(
    updateQuery!.params[5],
    false,
    "autoPauseTriggered=false når ingen phase vunnet"
  );

  // Ingen auto-paused event.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(autoPaused.length, 0);
});

test("Task 1.1: Fullt Hus (fase 5) → game ends, IKKE auto-pause", async () => {
  // Fullt Hus-scenariet: fase 5 vinnes. Engine setter isFinished=true (slik at
  // scheduled_game.status='completed' + engine_ended_at), men IKKE paused —
  // spillet er ferdig, ingen Resume-flyt nødvendig.
  const { broadcaster, autoPaused } = makeRecordingBroadcaster();

  const fullHouseMarkings = new Array(25).fill(true);
  fullHouseMarkings[12] = true; // free centre

  const { service, queries } = makeService({
    broadcaster,
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 4,
            last_drawn_ball: 40,
            current_phase: 5, // Fullt Hus-fasen
          }),
        ],
      },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow()],
      },
      {
        match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      // Alle celler markert bortsett fra siste (som blir ball 50).
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: buildWinningGrid(),
            markings_json: wrapMarkings(
              (() => {
                const m = new Array(25).fill(true);
                // Simuler at ball 50 på index 4 er LAST ball — markeres i UPDATE.
                m[4] = false;
                m[12] = true;
                return m;
              })()
            ),
            buyer_user_id: "u-1",
            hall_id: "hall-a",
            ticket_color: "yellow",
          },
        ],
      },
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      // Andre lesning — nå er alle cellene markert → Fullt Hus.
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: buildWinningGrid(),
            markings_json: wrapMarkings(fullHouseMarkings),
            buyer_user_id: "u-1",
            hall_id: "hall-a",
            ticket_color: "yellow",
          },
        ],
      },
      {
        match: (s) => s.includes("static_tickets"),
        rows: [],
        once: false,
      },
      {
        match: (s) => s.includes("app_users") && s.includes("wallet_id"),
        rows: [{ wallet_id: "wlt-1" }],
      },
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("app_game1_game_state") &&
          s.includes("paused_at_phase"),
        rows: [],
      },
      // UPDATE scheduled_games status='completed'
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("app_game1_scheduled_games") &&
          s.includes("'completed'"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") &&
          s.includes("SELECT") &&
          !s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 5,
            last_drawn_ball: 50,
            current_phase: 5,
            paused: false, // Fullt Hus pauser IKKE
            paused_at_phase: null,
            engine_ended_at: "2026-04-24T12:15:00.000Z",
          }),
        ],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          { draw_sequence: 1, ball_value: 10, drawn_at: "..." },
          { draw_sequence: 2, ball_value: 20, drawn_at: "..." },
          { draw_sequence: 3, ball_value: 30, drawn_at: "..." },
          { draw_sequence: 4, ball_value: 40, drawn_at: "..." },
          { draw_sequence: 5, ball_value: 50, drawn_at: "..." },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  const view: Game1GameStateView = await service.drawNext("g1");
  assert.equal(view.isFinished, true, "Fullt Hus → isFinished=true");
  assert.equal(view.isPaused, false, "Fullt Hus pauser IKKE");
  assert.equal(view.pausedAtPhase, null);
  assert.equal(
    view.pausedAutomatically,
    undefined,
    "Fullt Hus trigger ikke pausedAutomatically"
  );

  // UPDATE-params: isFinished=true, autoPauseTriggered=false.
  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("paused_at_phase")
  );
  assert.ok(updateQuery);
  assert.equal(updateQuery!.params[4], true, "isFinished=true");
  assert.equal(
    updateQuery!.params[5],
    false,
    "autoPauseTriggered=false selv ved Fullt Hus"
  );

  await new Promise((r) => setTimeout(r, 5));
  assert.equal(autoPaused.length, 0, "ingen auto-paused event ved Fullt Hus");
});

test("Task 1.1: Rad 2-vinn → paused_at_phase=2 (idempotent pause-mekanisme)", async () => {
  // Verifiserer at auto-pause fungerer gjentagende, ikke bare for Rad 1.
  // Fase 2 i Spill 1 = 2 komplette VERTIKALE KOLONNER (ref
  // Game1PatternEvaluator.ts:11-15). Vi markerer kolonne 0 + kolonne 1
  // fullt + free centre. `buildWinningGrid()` har:
  //   col 0 = [10, 1, 2, 3, 4]
  //   col 1 = [20, 16, 17, 18, 19]
  const twoColumnsMarked = new Array(25).fill(false);
  // Kolonne 0: indices 0, 5, 10, 15, 20
  for (const r of [0, 1, 2, 3, 4]) twoColumnsMarked[r * 5 + 0] = true;
  // Kolonne 1: indices 1, 6, 11, 16, 21
  for (const r of [0, 1, 2, 3, 4]) twoColumnsMarked[r * 5 + 1] = true;
  twoColumnsMarked[12] = true; // free centre

  // Viktig: draw_bag må være stor nok til å støtte at tilstrekkelig mange
  // draws kan skje. 6-ball-bag holder opp til draw 6 — så vi bruker en
  // større bag her.
  const largerBag = [1, 2, 3, 4, 10, 16, 17, 18, 19, 20];
  const { broadcaster, autoPaused } = makeRecordingBroadcaster();

  const { service, queries } = makeService({
    broadcaster,
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draw_bag_json: largerBag,
            draws_completed: 9, // draws 1..9 trukket; draw 10 = bag[9] = 20
            last_drawn_ball: 19,
            current_phase: 2, // nå i fase 2 etter resume
          }),
        ],
      },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow()],
      },
      {
        match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: buildWinningGrid(),
            markings_json: wrapMarkings(
              (() => {
                const m = [...twoColumnsMarked];
                m[1] = false; // ball 20 (idx 1) vil markeres i markBallOnAssignments
                return m;
              })()
            ),
            buyer_user_id: "u-1",
            hall_id: "hall-a",
            ticket_color: "yellow",
          },
        ],
      },
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: buildWinningGrid(),
            markings_json: wrapMarkings(twoColumnsMarked), // nå komplett
            buyer_user_id: "u-1",
            hall_id: "hall-a",
            ticket_color: "yellow",
          },
        ],
      },
      {
        match: (s) => s.includes("static_tickets"),
        rows: [],
        once: false,
      },
      {
        match: (s) => s.includes("app_users") && s.includes("wallet_id"),
        rows: [{ wallet_id: "wlt-1" }],
      },
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("app_game1_game_state") &&
          s.includes("paused_at_phase"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") &&
          s.includes("SELECT") &&
          !s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draw_bag_json: largerBag,
            draws_completed: 10,
            last_drawn_ball: 20,
            current_phase: 3, // fase 2 vunnet → engine klar for fase 3
            paused: true,
            paused_at_phase: 2,
          }),
        ],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          { draw_sequence: 10, ball_value: 20, drawn_at: "..." },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isPaused, true);
  assert.equal(view.pausedAtPhase, 2);
  assert.equal(view.pausedAutomatically, true);
  assert.equal(view.currentPhase, 3, "current_phase = 3 (fase 2 vunnet)");

  const updateQuery = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("paused_at_phase")
  );
  assert.equal(updateQuery!.params[6], 2, "paused_at_phase=2 for Rad 2-vinn");

  await new Promise((r) => setTimeout(r, 5));
  assert.equal(autoPaused.length, 1);
  assert.equal(autoPaused[0]!.phase, 2);
});
