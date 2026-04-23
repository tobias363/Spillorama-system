/**
 * GAME1_SCHEDULE PR 4b: unit-tester for Game1DrawEngineService.
 *
 * Testmønster: stub-pool som matcher mot SQL-fragment (samme som
 * Game1MasterControlService.test.ts og Game1TicketPurchaseService.test.ts).
 * Fake Game1TicketPurchaseService returnerer preset purchase-rows.
 * InMemoryAuditLogStore for audit-verifisering.
 *
 * Dekker:
 *   - startGame happy-path: state + assignments opprettet, scheduled_game
 *     status='running'.
 *   - startGame idempotent: 2x kall → samme state, ingen duplicate assignments.
 *   - startGame uten purchases → engine kan starte, 0 assignments.
 *   - startGame med refunded purchases → de hoppes over.
 *   - drawNext happy-path: kule trekket, persisted, markings oppdatert.
 *   - drawNext når paused → GAME_PAUSED error.
 *   - drawNext når finished → GAME_FINISHED error.
 *   - drawNext ved maxDraws → game.status='completed'.
 *   - pauseGame/resumeGame toggle.
 *   - stopGame setter engine_ended_at.
 *   - getState returnerer riktig view.
 *   - listDraws returnerer draws i rekkefølge.
 *   - Grid-generering: 5x5 med free centre (idx 12 = 0) og proporsjonale
 *     column-ranges per maxBallValue. 'size'-parameter påvirker ikke format.
 *   - Markings: kule 23 trukket → assignments med grid containing 23 har
 *     markings.marked[idx]=true. Free centre (idx 12) alltid markert.
 *   - Audit skrives for start/draw/pause/resume/stop.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import {
  Game1DrawEngineService,
  generateGridForTicket,
  DEFAULT_GAME1_MAX_DRAWS,
} from "./Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "./Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stub pool (matcher Game1TicketPurchaseService.test.ts-pattern) ───────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
  throwErr?: { code: string; message: string };
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
        if (r.throwErr) {
          const err = Object.assign(new Error(r.throwErr.message), {
            code: r.throwErr.code,
          });
          if (r.once !== false) queue.splice(i, 1);
          throw err;
        }
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

// ── Fixture helpers ──────────────────────────────────────────────────────────

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "ready_to_start",
    ticket_config_json: {},
    ...overrides,
  };
}

function purchaseRow(
  overrides: Partial<Game1TicketPurchaseRow> = {}
): Game1TicketPurchaseRow {
  return {
    id: "p-1",
    scheduledGameId: "g1",
    buyerUserId: "u-1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    totalAmountCents: 2000,
    paymentMethod: "digital_wallet",
    agentUserId: null,
    idempotencyKey: "idem-1",
    purchasedAt: "2026-04-21T12:00:00.000Z",
    refundedAt: null,
    refundReason: null,
    refundedByUserId: null,
    refundTransactionId: null,
    ...overrides,
  };
}

function makeFakeTicketPurchase(
  purchases: Game1TicketPurchaseRow[]
): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return purchases;
    },
  } as unknown as Game1TicketPurchaseService;
}

function makeService(opts: {
  poolResponses: StubResponse[];
  purchases?: Game1TicketPurchaseRow[];
}): {
  service: Game1DrawEngineService;
  audit: InMemoryAuditLogStore;
  queries: RecordedQuery[];
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const ticketPurchase = makeFakeTicketPurchase(opts.purchases ?? []);
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
    auditLogService,
  });
  return { service, audit: auditStore, queries };
}

// ── Grid-generator tester ───────────────────────────────────────────────────

test("generateGridForTicket: 5x5 m/ free centre (25 celler, idx 12 = 0) — maxBallValue=75", () => {
  const grid = generateGridForTicket("small", 75);
  assert.equal(grid.length, 25, "5x5 = 25 celler");
  assert.equal(grid[12], 0, "index 12 (row 2, col 2) = 0 = free centre");

  // 24 unike non-centre celler, alle innenfor 1..75.
  const nonCentre = grid
    .filter((_, i) => i !== 12)
    .filter((n): n is number => typeof n === "number");
  assert.equal(nonCentre.length, 24, "24 non-centre tall-celler (ingen null)");
  const unique = new Set(nonCentre);
  assert.equal(unique.size, 24, "alle non-centre tall skal være unike");
  for (const n of nonCentre) {
    assert.ok(n >= 1 && n <= 75, `tall ${n} utenfor 1..75`);
  }
});

test("generateGridForTicket: 'size' ignoreres — både 'small' og 'large' gir 5x5", () => {
  const small = generateGridForTicket("small", 75);
  const large = generateGridForTicket("large", 75);
  assert.equal(small.length, 25);
  assert.equal(large.length, 25);
  assert.equal(small[12], 0);
  assert.equal(large[12], 0);
});

test("generateGridForTicket maxBallValue=75: proporsjonale col-ranges (amerikansk 75-ball)", () => {
  const grid = generateGridForTicket("small", 75);
  // Row-major: grid[row*5 + col].
  // col 0 = 1..15, col 1 = 16..30, col 2 = 31..45, col 3 = 46..60, col 4 = 61..75.
  const colRanges: Array<[number, number]> = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75],
  ];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      if (idx === 12) continue; // free centre
      const cell = grid[idx];
      if (cell === null) continue;
      const [lo, hi] = colRanges[col]!;
      assert.ok(
        typeof cell === "number" && cell >= lo && cell <= hi,
        `col ${col} row ${row} = ${cell}, forventet ${lo}..${hi}`
      );
    }
  }
});

test("generateGridForTicket maxBallValue=90: legacy 90-ball col-ranges (1..18, 19..36, …, 73..90)", () => {
  const grid = generateGridForTicket("small", 90);
  assert.equal(grid.length, 25);
  assert.equal(grid[12], 0);
  const colRanges: Array<[number, number]> = [
    [1, 18],
    [19, 36],
    [37, 54],
    [55, 72],
    [73, 90],
  ];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      if (idx === 12) continue;
      const cell = grid[idx];
      if (cell === null) continue;
      const [lo, hi] = colRanges[col]!;
      assert.ok(
        typeof cell === "number" && cell >= lo && cell <= hi,
        `col ${col} row ${row} = ${cell}, forventet ${lo}..${hi}`
      );
    }
  }
});

test("generateGridForTicket: col 2 unngår row 2 (free centre) — 4 plukk fra col 2, ikke 5", () => {
  // Kjør 50 ganger for å få statistisk robusthet: col 2 skal ha akkurat 4
  // ikke-null non-centre tall.
  for (let trial = 0; trial < 50; trial++) {
    const grid = generateGridForTicket("small", 75);
    const col2Nums: number[] = [];
    for (let r = 0; r < 5; r++) {
      if (r === 2) continue;
      const v = grid[r * 5 + 2];
      if (typeof v === "number" && v !== 0) col2Nums.push(v);
    }
    assert.equal(col2Nums.length, 4, "col 2 skal ha 4 non-centre tall (row 2 er free)");
    const unique = new Set(col2Nums);
    assert.equal(unique.size, 4, "col 2 skal ha unike tall");
    for (const n of col2Nums) {
      assert.ok(n >= 31 && n <= 45, `col 2 tall ${n} utenfor 31..45`);
    }
  }
});

// ── startGame tester ────────────────────────────────────────────────────────

test("startGame happy-path: INSERT state + assignments + UPDATE status", async () => {
  const { service, audit, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      // loadScheduledGameForUpdate.
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "ready_to_start" })],
      },
      // loadGameState (eksisterer ikke enda).
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [],
        once: true,
      },
      // INSERT game_state.
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_game_state"),
        rows: [],
      },
      // INSERT assignments (×1 for purchase med count=1).
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      // UPDATE scheduled_games → running.
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("scheduled_games") &&
          s.includes("'running'"),
        rows: [],
      },
      // loadGameState (etter INSERT).
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [
          {
            scheduled_game_id: "g1",
            draw_bag_json: [1, 2, 3],
            draws_completed: 0,
            current_phase: 1,
            last_drawn_ball: null,
            last_drawn_at: null,
            next_auto_draw_at: null,
            paused: false,
            engine_started_at: "2026-04-21T12:00:00.000Z",
            engine_ended_at: null,
          },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
    purchases: [purchaseRow()],
  });

  const view = await service.startGame("g1", "user-1");
  assert.equal(view.scheduledGameId, "g1");
  assert.equal(view.drawsCompleted, 0);
  assert.equal(view.isPaused, false);
  assert.equal(view.isFinished, false);

  // Verifiser at INSERT game_state + INSERT assignments + UPDATE status skjedde.
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_game_state")
    ),
    "INSERT game_state skal skje"
  );
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("INSERT INTO") &&
        q.sql.includes("app_game1_ticket_assignments")
    ),
    "INSERT assignments skal skje"
  );
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("scheduled_games") &&
        q.sql.includes("'running'")
    ),
    "UPDATE status='running' skal skje"
  );

  // Audit skrevet.
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(
    events.some((e) => e.action === "game1_engine.start"),
    "audit game1_engine.start"
  );
});

test("startGame idempotent: 2. kall når state finnes → ingen nye INSERTs", async () => {
  const existingState = {
    scheduled_game_id: "g1",
    draw_bag_json: [1, 2, 3],
    draws_completed: 0,
    current_phase: 1,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: null,
  };
  const { service, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "running" })],
      },
      // loadGameState returnerer eksisterende rad → idempotent short-circuit.
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [existingState],
      },
      // loadDrawsInOrder.
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  await service.startGame("g1", "user-1");
  // Ingen INSERT skal ha skjedd.
  assert.ok(
    !queries.some(
      (q) =>
        q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_game_state")
    ),
    "ingen INSERT game_state ved idempotent hit"
  );
});

test("startGame uten purchases: 0 assignments opprettet", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "ready_to_start" })],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [],
        once: true,
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("scheduled_games") &&
          s.includes("'running'"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [
          {
            scheduled_game_id: "g1",
            draw_bag_json: [1, 2, 3],
            draws_completed: 0,
            current_phase: 1,
            last_drawn_ball: null,
            last_drawn_at: null,
            next_auto_draw_at: null,
            paused: false,
            engine_started_at: "2026-04-21T12:00:00.000Z",
            engine_ended_at: null,
          },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
    purchases: [], // ingen purchases
  });

  await service.startGame("g1", "user-1");
  assert.ok(
    !queries.some(
      (q) =>
        q.sql.includes("INSERT INTO") &&
        q.sql.includes("app_game1_ticket_assignments")
    ),
    "ingen INSERT assignments uten purchases"
  );
});

test("startGame med refunded purchase: hoppes over", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "ready_to_start" })],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [],
        once: true,
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("scheduled_games") &&
          s.includes("'running'"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [
          {
            scheduled_game_id: "g1",
            draw_bag_json: [1, 2, 3],
            draws_completed: 0,
            current_phase: 1,
            last_drawn_ball: null,
            last_drawn_at: null,
            next_auto_draw_at: null,
            paused: false,
            engine_started_at: "2026-04-21T12:00:00.000Z",
            engine_ended_at: null,
          },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
    purchases: [purchaseRow({ refundedAt: "2026-04-21T11:59:00.000Z" })],
  });

  await service.startGame("g1", "user-1");
  assert.ok(
    !queries.some(
      (q) =>
        q.sql.includes("INSERT INTO") &&
        q.sql.includes("app_game1_ticket_assignments")
    ),
    "refunded purchase skal ikke gi assignments"
  );
});

test("startGame kaster hvis status er uvalid", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "scheduled" })],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [],
        once: true,
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.startGame("g1", "user-1"),
    (err) =>
      err instanceof DomainError && err.code === "ENGINE_NOT_STARTABLE"
  );
});

test("startGame kaster GAME_NOT_FOUND ved manglende scheduled_game", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [],
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.startGame("missing-id", "user-1"),
    (err) => err instanceof DomainError && err.code === "GAME_NOT_FOUND"
  );
});

// ── drawNext tester ─────────────────────────────────────────────────────────

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

test("drawNext happy-path: trekker første kule og oppdaterer state", async () => {
  const { service, audit, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      // loadGameStateForUpdate.
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [runningStateRow()],
      },
      // loadScheduledGameForUpdate.
      {
        match: (s) =>
          s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "running" })],
      },
      // INSERT draws.
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      // markBallOnAssignments: SELECT assignments.
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      // UPDATE game_state.
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      // loadGameState (etter update).
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [
          runningStateRow({
            draws_completed: 1,
            last_drawn_ball: 10,
            last_drawn_at: "2026-04-21T12:01:00.000Z",
          }),
        ],
      },
      // loadDrawsInOrder.
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          {
            draw_sequence: 1,
            ball_value: 10,
            drawn_at: "2026-04-21T12:01:00.000Z",
          },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 1);
  assert.equal(view.lastDrawnBall, 10);
  assert.deepEqual(view.drawnBalls, [10]);

  // Verifiser INSERT draws.
  const drawInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_draws")
  );
  assert.ok(drawInsert, "INSERT draws skal skje");
  // params: id, scheduled_game_id, draw_sequence, ball_value, current_phase
  assert.equal(drawInsert!.params[2], 1, "draw_sequence = 1");
  assert.equal(drawInsert!.params[3], 10, "ball_value = 10 (bag[0])");

  // Audit.
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(events.some((e) => e.action === "game1_engine.draw"));
});

test("drawNext: andre kule plukker bag[1]", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 10 })],
      },
      {
        match: (s) =>
          s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "running" })],
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [
          runningStateRow({
            draws_completed: 2,
            last_drawn_ball: 20,
            last_drawn_at: "2026-04-21T12:02:00.000Z",
          }),
        ],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          { draw_sequence: 1, ball_value: 10, drawn_at: "..." },
          { draw_sequence: 2, ball_value: 20, drawn_at: "..." },
        ],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 2);
  assert.equal(view.lastDrawnBall, 20);

  const drawInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_draws")
  );
  assert.equal(drawInsert!.params[2], 2);
  assert.equal(drawInsert!.params[3], 20);
});

test("drawNext når paused → GAME_PAUSED error", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [runningStateRow({ paused: true })],
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) => err instanceof DomainError && err.code === "GAME_PAUSED"
  );
});

test("drawNext når finished → GAME_FINISHED error", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({ engine_ended_at: "2026-04-21T12:10:00.000Z" }),
        ],
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) => err instanceof DomainError && err.code === "GAME_FINISHED"
  );
});

test("drawNext: game.status='paused' → GAME_NOT_RUNNING", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [runningStateRow()],
      },
      {
        match: (s) =>
          s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "paused" })],
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) => err instanceof DomainError && err.code === "GAME_NOT_RUNNING"
  );
});

test("drawNext uten eksisterende state → ENGINE_NOT_STARTED", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [],
      },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
    ],
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) => err instanceof DomainError && err.code === "ENGINE_NOT_STARTED"
  );
});

test("drawNext ved maxDraws → scheduled_game.status='completed'", async () => {
  // Simuler spill med maxDraws=3 (via ticket_config_json.maxDraws) og 2
  // kuler allerede trukket.
  const { service, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            draws_completed: 2,
            last_drawn_ball: 20,
          }),
        ],
      },
      {
        match: (s) =>
          s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [
          scheduledGameRow({
            status: "running",
            ticket_config_json: { maxDraws: 3 },
          }),
        ],
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
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
            draws_completed: 3,
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
    ],
  });

  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 3);
  assert.equal(view.isFinished, true);

  // UPDATE status='completed' skal ha skjedd.
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("scheduled_games") &&
        q.sql.includes("'completed'")
    ),
    "UPDATE status='completed' skal skje ved maxDraws"
  );
});

test("drawNext: markings oppdateres når kule matcher grid-celle", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      { match: (s) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [
          runningStateRow({
            // bag[0]=23 → vil trekkes neste.
            draw_bag_json: [23, 42, 15],
          }),
        ],
      },
      {
        match: (s) =>
          s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [scheduledGameRow({ status: "running" })],
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        rows: [],
      },
      // SELECT assignments — én med 5x5 grid. Ball 23 skal matche idx 0.
      // Grid: [23, 16, 17, 18, 19,   1, 20, 21, 46, 61,   2, 22, 0, 47, 62,   3, 24, 32, 48, 63,   4, 25, 33, 49, 64]
      // Free centre idx 12 = 0 (allerede markert).
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_assignments") &&
          s.includes("FOR UPDATE"),
        rows: [
          {
            id: "a-1",
            grid_numbers_json: [
              23, 16, 17, 18, 19,
              1, 20, 21, 46, 61,
              2, 22, 0, 47, 62,
              3, 24, 32, 48, 63,
              4, 25, 33, 49, 64,
            ],
            markings_json: {
              marked: [
                false, false, false, false, false,
                false, false, false, false, false,
                false, false, true, false, false,
                false, false, false, false, false,
                false, false, false, false, false,
              ],
            },
          },
        ],
      },
      // UPDATE assignment markings (ball 23 matcher idx 0).
      {
        match: (s) =>
          s.trim().startsWith("UPDATE") &&
          s.includes("app_game1_ticket_assignments") &&
          s.includes("markings_json"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 23 })],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [{ draw_sequence: 1, ball_value: 23, drawn_at: "..." }],
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [] },
    ],
  });

  await service.drawNext("g1");

  // Verifiser at markings-UPDATE ble kjørt med marked[0]=true.
  // NB: SELECT ... FOR UPDATE matcher også "UPDATE" fragment. Krever UPDATE
  // på start for å fange bare den skrivende UPDATE.
  const markingUpdate = queries.find(
    (q) =>
      q.sql.trim().startsWith("UPDATE") &&
      q.sql.includes("app_game1_ticket_assignments") &&
      q.sql.includes("markings_json")
  );
  assert.ok(markingUpdate, "markings-UPDATE skal skje");
  const markingsJson = JSON.parse(String(markingUpdate!.params[1]));
  assert.equal(
    markingsJson.marked[0],
    true,
    "markings[0] skal være true (ball 23 = grid[0])"
  );
  assert.equal(markingsJson.marked[1], false);
  assert.equal(
    markingsJson.marked[12],
    true,
    "markings[12] (free centre) forblir markert"
  );
});

// ── pauseGame/resumeGame tester ─────────────────────────────────────────────

test("pauseGame setter paused=true + skriver audit", async () => {
  const { service, audit, queries } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
    ],
  });

  await service.pauseGame("g1", "user-1");
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("app_game1_game_state") &&
        q.sql.includes("paused = true")
    )
  );
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(events.some((e) => e.action === "game1_engine.pause"));
});

test("resumeGame setter paused=false + skriver audit", async () => {
  const { service, audit, queries } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
    ],
  });

  await service.resumeGame("g1", "user-1");
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("app_game1_game_state") &&
        q.sql.includes("paused = false")
    )
  );
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(events.some((e) => e.action === "game1_engine.resume"));
});

// ── stopGame tester ─────────────────────────────────────────────────────────

test("stopGame setter engine_ended_at + skriver audit", async () => {
  const { service, audit, queries } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
    ],
  });

  await service.stopGame("g1", "master stop", "user-1");
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("app_game1_game_state") &&
        q.sql.includes("engine_ended_at")
    )
  );
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  const stopEvent = events.find((e) => e.action === "game1_engine.stop");
  assert.ok(stopEvent);
  assert.equal((stopEvent!.details as { reason?: string }).reason, "master stop");
});

// ── getState + listDraws tester ─────────────────────────────────────────────

test("getState returnerer null for ukjent game", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_game_state"),
        rows: [],
      },
    ],
  });
  const state = await service.getState("g-unknown");
  assert.equal(state, null);
});

test("getState returnerer view for eksisterende game", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_game_state"),
        rows: [runningStateRow({ draws_completed: 5, last_drawn_ball: 42 })],
      },
      {
        match: (s) =>
          s.includes("SELECT status FROM") && s.includes("scheduled_games"),
        rows: [{ status: "running" }],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          { draw_sequence: 1, ball_value: 10, drawn_at: "..." },
          { draw_sequence: 2, ball_value: 20, drawn_at: "..." },
        ],
      },
    ],
  });
  const view = await service.getState("g1");
  assert.ok(view);
  assert.equal(view!.drawsCompleted, 5);
  assert.equal(view!.lastDrawnBall, 42);
  assert.deepEqual(view!.drawnBalls, [10, 20]);
  assert.equal(view!.isFinished, false);
});

test("getState når scheduled_game er completed → isFinished=true", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_game_state"),
        rows: [runningStateRow()],
      },
      {
        match: (s) =>
          s.includes("SELECT status FROM") && s.includes("scheduled_games"),
        rows: [{ status: "completed" }],
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [],
      },
    ],
  });
  const view = await service.getState("g1");
  assert.ok(view);
  assert.equal(view!.isFinished, true);
});

test("listDraws returnerer draws i rekkefølge", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [
          {
            draw_sequence: 1,
            ball_value: 5,
            drawn_at: "2026-04-21T12:01:00.000Z",
          },
          {
            draw_sequence: 2,
            ball_value: 10,
            drawn_at: "2026-04-21T12:02:00.000Z",
          },
          {
            draw_sequence: 3,
            ball_value: 15,
            drawn_at: "2026-04-21T12:03:00.000Z",
          },
        ],
      },
    ],
  });
  const draws = await service.listDraws("g1");
  assert.equal(draws.length, 3);
  assert.deepEqual(
    draws.map((d) => d.ball),
    [5, 10, 15]
  );
  assert.deepEqual(
    draws.map((d) => d.sequence),
    [1, 2, 3]
  );
});

// ── Default-config sanity ───────────────────────────────────────────────────

test("DEFAULT_GAME1_MAX_DRAWS er 52 (legacy Game 1)", () => {
  assert.equal(DEFAULT_GAME1_MAX_DRAWS, 52);
});

// ── Integration: Full spill-loop (startGame → drawNext × N → finished) ──────
//
// Semi-integration: stub-pool simulerer DB-lag mens servicens transactions +
// state-lookups verifiseres end-to-end. Tester at et komplett spill-loop
// fungerer med draws_completed som monotonisk økende teller.

test("integration: startGame → 3×drawNext loop (2 purchases, maxDraws=3)", async () => {
  // Simulerer DB-state progressivt via mutable rows-arrays.
  const drawBag: number[] = [11, 22, 33, 44, 55];
  let drawsCompleted = 0;
  let lastDrawnBall: number | null = null;
  let engineEndedAt: string | null = null;
  let started = false;
  // Stateful mock: game_state-raden eksisterer ikke før INSERT. Uten dette
  // short-circuiter startGame via idempotent-guard (eksisterende state finnes
  // → hopper over INSERT + UPDATE status='running'), og drawNext ser da
  // scheduled_game i 'ready_to_start' → GAME_NOT_RUNNING.
  let stateInserted = false;

  const gameStateRow = () => ({
    scheduled_game_id: "g-integration",
    draw_bag_json: drawBag,
    draws_completed: drawsCompleted,
    current_phase: 1,
    last_drawn_ball: lastDrawnBall,
    last_drawn_at: lastDrawnBall ? "2026-04-21T12:00:00.000Z" : null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: engineEndedAt,
  });

  const { service } = makeService({
    poolResponses: [
      // startGame: BEGIN + scheduled_game FOR UPDATE + game_state SELECT
      // (tom) + INSERT state + INSERT assignments + UPDATE status + state
      // reload + COMMIT.
      { match: (s) => s.startsWith("BEGIN"), rows: [] as unknown[], once: false },
      {
        match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: () => [
          {
            id: "g-integration",
            status: started ? "running" : "ready_to_start",
            ticket_config_json: { maxDraws: 3 },
          },
        ],
        once: false,
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: () => (stateInserted && engineEndedAt === null ? [gameStateRow()] : []),
        once: false,
      },
      {
        match: (s) =>
          s.includes("app_game1_game_state") && s.includes("SELECT"),
        rows: () => (stateInserted ? [gameStateRow()] : []),
        once: false,
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_game_state"),
        rows: () => {
          stateInserted = true;
          return [];
        },
        once: false,
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_assignments"),
        rows: [],
        once: false,
      },
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("scheduled_games") &&
          s.includes("'running'"),
        rows: () => {
          started = true;
          return [];
        },
        once: false,
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") && s.includes("app_game1_draws"),
        // Simulerer draws_completed++ when INSERT happens.
        rows: () => {
          drawsCompleted++;
          lastDrawnBall = drawBag[drawsCompleted - 1]!;
          if (drawsCompleted >= 3) engineEndedAt = "2026-04-21T12:05:00.000Z";
          return [];
        },
        once: false,
      },
      {
        match: (s) =>
          s.trim().startsWith("SELECT") &&
          s.includes("app_game1_ticket_assignments"),
        rows: [],
        once: false,
      },
      {
        match: (s) =>
          s.trim().startsWith("UPDATE") &&
          s.includes("app_game1_game_state"),
        rows: [],
        once: false,
      },
      {
        match: (s) =>
          s.trim().startsWith("UPDATE") &&
          s.includes("scheduled_games") &&
          s.includes("'completed'"),
        rows: [],
        once: false,
      },
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
        rows: () => {
          const draws: Array<{
            draw_sequence: number;
            ball_value: number;
            drawn_at: string;
          }> = [];
          for (let i = 0; i < drawsCompleted; i++) {
            draws.push({
              draw_sequence: i + 1,
              ball_value: drawBag[i]!,
              drawn_at: "2026-04-21T12:01:00.000Z",
            });
          }
          return draws;
        },
        once: false,
      },
      { match: (s) => s.startsWith("COMMIT"), rows: [], once: false },
      { match: (s) => s.startsWith("ROLLBACK"), rows: [], once: false },
    ],
    purchases: [
      purchaseRow({
        id: "p-a",
        ticketSpec: [
          { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
        ],
      }),
      purchaseRow({
        id: "p-b",
        buyerUserId: "u-2",
        ticketSpec: [
          { color: "white", size: "small", count: 1, priceCentsEach: 2000 },
        ],
      }),
    ],
  });

  // 1. startGame.
  const startView = await service.startGame("g-integration", "user-master");
  assert.equal(startView.drawsCompleted, 0);
  assert.equal(startView.isFinished, false);

  // 2. drawNext × 3 → skal ende med isFinished=true.
  const view1 = await service.drawNext("g-integration");
  assert.equal(view1.drawsCompleted, 1);
  assert.equal(view1.lastDrawnBall, 11);

  const view2 = await service.drawNext("g-integration");
  assert.equal(view2.drawsCompleted, 2);
  assert.equal(view2.lastDrawnBall, 22);

  const view3 = await service.drawNext("g-integration");
  assert.equal(view3.drawsCompleted, 3);
  assert.equal(view3.lastDrawnBall, 33);
  assert.equal(view3.isFinished, true);
  assert.deepEqual(view3.drawnBalls, [11, 22, 33]);
});

// ── PR-C4: player-broadcaster-tester ────────────────────────────────────────
//
// Disse testene dekker gapet identifisert i P1.1 research: scheduled Spill 1
// broadcastet før PR-C4 kun til `/admin-game1`-namespace, så spiller-klient
// (default-namespace) fikk ingen live-oppdateringer fra drawNext().

interface RecordedPlayerDrawNew {
  roomCode: string;
  number: number;
  drawIndex: number;
  gameId: string;
}

interface RecordedPlayerPatternWon {
  roomCode: string;
  gameId: string;
  patternName: string;
  phase: number;
  winnerIds: string[];
  winnerCount: number;
  drawIndex: number;
}

function makeRecordingPlayerBroadcaster(): {
  broadcaster: import("./Game1PlayerBroadcaster.js").Game1PlayerBroadcaster;
  drawNewCalls: RecordedPlayerDrawNew[];
  patternWonCalls: RecordedPlayerPatternWon[];
  roomUpdateCalls: string[];
} {
  const drawNewCalls: RecordedPlayerDrawNew[] = [];
  const patternWonCalls: RecordedPlayerPatternWon[] = [];
  const roomUpdateCalls: string[] = [];
  return {
    broadcaster: {
      onDrawNew: (evt) => {
        drawNewCalls.push({ ...evt });
      },
      onPatternWon: (evt) => {
        patternWonCalls.push({ ...evt });
      },
      onRoomUpdate: (roomCode) => {
        roomUpdateCalls.push(roomCode);
      },
    },
    drawNewCalls,
    patternWonCalls,
    roomUpdateCalls,
  };
}

test("PR-C4: drawNext sender draw:new + room:update til spiller-rom når room_code er satt", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      // Første spiller har joinet — room_code er satt.
      rows: [scheduledGameRow({ status: "running", room_code: "ROOM-C4" })],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 10,
          last_drawn_at: "2026-04-21T12:01:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 10,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const recorder = makeRecordingPlayerBroadcaster();
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase([]),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    playerBroadcaster: recorder.broadcaster,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 1);
  assert.equal(view.lastDrawnBall, 10);

  // draw:new sendt med 0-basert drawIndex (matcher GameBridge-kontrakt).
  assert.equal(recorder.drawNewCalls.length, 1, "draw:new sendt én gang");
  assert.equal(recorder.drawNewCalls[0]!.roomCode, "ROOM-C4");
  assert.equal(recorder.drawNewCalls[0]!.number, 10);
  assert.equal(
    recorder.drawNewCalls[0]!.drawIndex,
    0,
    "første ball skal ha drawIndex=0 (0-basert)"
  );
  assert.equal(recorder.drawNewCalls[0]!.gameId, "g1");

  // room:update sendt POST draw:new så klient får fresh snapshot.
  assert.deepEqual(
    recorder.roomUpdateCalls,
    ["ROOM-C4"],
    "room:update skal pushes etter draw:new"
  );

  // Ingen phase-won (ingen vinnere).
  assert.equal(recorder.patternWonCalls.length, 0);
});

test("PR-C4: drawNext sender INGEN broadcast til spiller-rom når room_code er NULL (ingen joinet enda)", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      // room_code er NULL — ingen spiller har joinet.
      rows: [scheduledGameRow({ status: "running", room_code: null })],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 10,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        { draw_sequence: 1, ball_value: 10, drawn_at: "2026-04-21T12:01:00.000Z" },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const recorder = makeRecordingPlayerBroadcaster();
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase([]),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    playerBroadcaster: recorder.broadcaster,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 1);

  // Ingen spiller-broadcast — ingen trenger den, rommet er tomt.
  assert.equal(recorder.drawNewCalls.length, 0, "ingen draw:new når room_code=NULL");
  assert.equal(recorder.roomUpdateCalls.length, 0);
  assert.equal(recorder.patternWonCalls.length, 0);
});

test("PR-C4: drawNext sender drawIndex=1 på andre ball (0-basert inkrement)", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      // Første ball allerede trukket.
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 10 })],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [scheduledGameRow({ status: "running", room_code: "ROOM-C4" })],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [runningStateRow({ draws_completed: 2, last_drawn_ball: 20 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        { draw_sequence: 1, ball_value: 10, drawn_at: "..." },
        { draw_sequence: 2, ball_value: 20, drawn_at: "..." },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const recorder = makeRecordingPlayerBroadcaster();
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase([]),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    playerBroadcaster: recorder.broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(recorder.drawNewCalls.length, 1);
  assert.equal(
    recorder.drawNewCalls[0]!.drawIndex,
    1,
    "andre ball = drawIndex 1 (drawsCompleted=2 → 2-1)"
  );
  assert.equal(recorder.drawNewCalls[0]!.number, 20);
});

test("PR-C4: playerBroadcaster.onDrawNew som kaster svelges (fire-and-forget)", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [scheduledGameRow({ status: "running", room_code: "ROOM-C4" })],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("UPDATE") && s.includes("app_game1_game_state"),
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
  ]);

  const throwingBroadcaster: import("./Game1PlayerBroadcaster.js").Game1PlayerBroadcaster = {
    onDrawNew: () => {
      throw new Error("socket explode");
    },
    onPatternWon: () => undefined,
    onRoomUpdate: () => undefined,
  };

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase([]),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    playerBroadcaster: throwingBroadcaster,
  });

  // Skal ikke kaste selv om broadcasteren feiler — draw er allerede committed.
  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 1);
  assert.equal(view.lastDrawnBall, 10);
});
