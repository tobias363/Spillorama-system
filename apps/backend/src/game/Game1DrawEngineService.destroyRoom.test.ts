/**
 * PR-C1b: destroyRoom-wiring i Game1DrawEngineService.
 *
 * Bakgrunn:
 *   - BingoEngine.Room (in-memory) opprettes av `game1:join-scheduled` ved
 *     første spiller som joiner et schedulert Spill 1.
 *   - Før PR-C1b ble rommet aldri eksplisitt slettet etter completion eller
 *     cancellation — kun naturlig eviction fra `InMemoryRoomStateStore`.
 *     Det er en memory-leak.
 *
 * Dekker:
 *   - drawNext som fullfører spillet (isFinished=true) → destroyRoom(roomCode)
 *     kalles POST-commit (én gang).
 *   - drawNext som ikke fullfører (draws_completed < maxDraws, ingen bingo)
 *     → destroyRoom IKKE kalt.
 *   - stopGame → destroyRoom(roomCode) kalles.
 *   - destroyRoomForScheduledGameSafe (public API) → kalt av masterControl
 *     ved cancel-before-start.
 *   - Fail-closed-kontrakt:
 *     - bingoEngine ikke satt → no-op (ingen kall).
 *     - roomCode null/tomt → no-op.
 *     - destroyRoom kaster → log warning + fortsetter (ingen re-throw).
 *     - destroyRoom er ikke funksjon på engine-instansen → no-op.
 *   - Idempotens: gjentatt destroyRoom-kall gir ROOM_NOT_FOUND som svelges.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../errors/DomainError.js";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "./Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stub pool (samme mønster som Game1DrawEngineService.test.ts) ─────────────

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

// ── Fake BingoEngine med destroyRoom-sporing ────────────────────────────────

interface FakeEngine {
  destroyRoom: (roomCode: string) => void;
  /** Liste av roomCodes som destroyRoom har fått som argument. */
  destroyCalls: string[];
  /**
   * Når satt: destroyRoom kaster denne koden for å simulere
   *   - ROOM_NOT_FOUND (idempotens-scenario / allerede slettet)
   *   - GAME_IN_PROGRESS (defensiv)
   *   - UNEXPECTED (generell feil)
   * Kast gjelder alltid; for idempotens-scenario gjør vi gjentatt-kall
   * ved å la `throwOnNextCall` bare gjelde n'te gang.
   */
  throwOnCalls?: Array<{ code: string; message: string }>;
}

function makeFakeEngine(opts: {
  throwOnCalls?: Array<{ code: string; message: string }>;
  noDestroyRoomMethod?: boolean;
} = {}): FakeEngine {
  const calls: string[] = [];
  const throwQueue = opts.throwOnCalls ? opts.throwOnCalls.slice() : [];
  const engine: Partial<FakeEngine> & { destroyRoom?: (code: string) => void } = {
    destroyCalls: calls,
    throwOnCalls: throwQueue,
  };
  if (!opts.noDestroyRoomMethod) {
    engine.destroyRoom = (roomCode: string) => {
      calls.push(roomCode);
      const next = throwQueue.shift();
      if (next) {
        throw new DomainError(
          next.code as never,
          next.message
        );
      }
    };
  }
  return engine as FakeEngine;
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

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

function makeService(opts: {
  poolResponses: StubResponse[];
  fakeEngine?: FakeEngine | null;
}): {
  service: Game1DrawEngineService;
  audit: InMemoryAuditLogStore;
  queries: RecordedQuery[];
  fakeEngine: FakeEngine | null;
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const ticketPurchase = makeFakeTicketPurchase();
  const fakeEngine = opts.fakeEngine ?? null;
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
    auditLogService,
    ...(fakeEngine
      ? { bingoEngine: fakeEngine as unknown as import("./BingoEngine.js").BingoEngine }
      : {}),
  });
  return { service, audit: auditStore, queries, fakeEngine };
}

// Queue-definisjon for drawNext som fullfører spillet (maxDraws=3, draws=2→3).
function drawNextCompletionResponses(opts: {
  roomCode: string | null;
  statusResult?: string;
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
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        scheduledGameRow({
          status: "running",
          ticket_config_json: { maxDraws },
          room_code: opts.roomCode,
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

// Helper: queue for drawNext som IKKE fullfører (maxDraws > startDraws+1).
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

// ── drawNext: completion triggers destroyRoom ───────────────────────────────

test("PR-C1b: drawNext som fullfører spill → destroyRoom(roomCode) kalles POST-commit", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: drawNextCompletionResponses({ roomCode: "ROOM-ABC123" }),
    fakeEngine: fake,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isFinished, true, "drawen skal ha fullført spillet");

  assert.deepEqual(
    fake.destroyCalls,
    ["ROOM-ABC123"],
    "destroyRoom skal ha blitt kalt nøyaktig én gang med roomCode"
  );
});

test("PR-C1b: drawNext som ikke fullfører → destroyRoom IKKE kalt", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: drawNextNonCompletionResponses("ROOM-STILL-RUNNING"),
    fakeEngine: fake,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isFinished, false, "drawen er ikke siste");
  assert.deepEqual(
    fake.destroyCalls,
    [],
    "destroyRoom skal IKKE kalles for ikke-fullførende draws"
  );
});

test("PR-C1b: drawNext fullfører men room_code er NULL → destroyRoom IKKE kalt", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: drawNextCompletionResponses({ roomCode: null }),
    fakeEngine: fake,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isFinished, true);
  assert.deepEqual(
    fake.destroyCalls,
    [],
    "destroyRoom skal ikke kalles når ingen spiller har joinet (room_code=null)"
  );
});

test("PR-C1b: drawNext fullfører men ingen bingoEngine wired → no-op (ingen crash)", async () => {
  const { service } = makeService({
    poolResponses: drawNextCompletionResponses({ roomCode: "ROOM-NO-ENGINE" }),
    fakeEngine: null,
  });

  // Skal ikke kaste — rett og slett no-op for cleanup-steget.
  const view = await service.drawNext("g1");
  assert.equal(view.isFinished, true);
});

test("PR-C1b: drawNext fullfører, destroyRoom kaster ROOM_NOT_FOUND → swallowed, draw fullføres normalt", async () => {
  const fake = makeFakeEngine({
    throwOnCalls: [{ code: "ROOM_NOT_FOUND", message: "Rom ROOM-X finnes ikke." }],
  });
  const { service } = makeService({
    poolResponses: drawNextCompletionResponses({ roomCode: "ROOM-X" }),
    fakeEngine: fake,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isFinished, true, "completion-persist skal IKKE ruke av cleanup-feil");
  assert.deepEqual(fake.destroyCalls, ["ROOM-X"]);
});

test("PR-C1b: drawNext fullfører, destroyRoom kaster generell feil → swallowed", async () => {
  const fake = makeFakeEngine({
    throwOnCalls: [{ code: "UNEXPECTED", message: "uventet feil" }],
  });
  const { service } = makeService({
    poolResponses: drawNextCompletionResponses({ roomCode: "ROOM-BOOM" }),
    fakeEngine: fake,
  });

  // Assert at drawNext ikke kaster selv om destroyRoom kaster.
  await service.drawNext("g1");
});

// ── stopGame (engine-level) ─────────────────────────────────────────────────

test("PR-C1b: stopGame → destroyRoom(roomCode) kalles fail-closed", async () => {
  const fake = makeFakeEngine();
  const { service, queries } = makeService({
    poolResponses: [
      // UPDATE engine_ended_at.
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      // SELECT room_code fra destroyRoomForScheduledGameSafe.
      {
        match: (s) =>
          /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [{ room_code: "ROOM-STOP" }],
      },
    ],
    fakeEngine: fake,
  });

  await service.stopGame("g1", "test reason", "user-1");

  // engine_ended_at UPDATE og SELECT room_code begge kjørt.
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("app_game1_game_state") &&
        q.sql.includes("engine_ended_at")
    ),
    "engine_ended_at skal settes"
  );
  assert.ok(
    queries.some((q) => /SELECT\s+room_code\s+FROM/i.test(q.sql)),
    "room_code skal leses"
  );
  assert.deepEqual(fake.destroyCalls, ["ROOM-STOP"]);
});

test("PR-C1b: stopGame uten room_code (ingen spiller joinet) → destroyRoom IKKE kalt", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s) =>
          /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [{ room_code: null }],
      },
    ],
    fakeEngine: fake,
  });

  await service.stopGame("g1", "reason", "user-1");
  assert.deepEqual(fake.destroyCalls, []);
});

test("PR-C1b: stopGame uten bingoEngine → ingen crash, kun engine_ended_at", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      // room_code-oppslag skjer fortsatt, men destroyRoomIfPresent er no-op
      // uten engine — vi returnerer tom rad for simplicity.
      {
        match: (s) =>
          /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [{ room_code: "ROOM-IRRELEVANT" }],
      },
    ],
    fakeEngine: null,
  });

  await service.stopGame("g1", "reason", "user-1");
});

test("PR-C1b: stopGame når SELECT room_code feiler → swallowed (engine_ended_at står ved lag)", async () => {
  const fake = makeFakeEngine();
  const { service, queries } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s) =>
          /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [],
        throwErr: { code: "DB_FAIL", message: "DB down" },
      },
    ],
    fakeEngine: fake,
  });

  // Skal ikke kaste.
  await service.stopGame("g1", "reason", "user-1");

  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("app_game1_game_state") &&
        q.sql.includes("engine_ended_at")
    ),
    "engine_ended_at skal fortsatt være oppdatert"
  );
  assert.deepEqual(fake.destroyCalls, [], "destroyRoom skal ikke nås når SELECT feiler");
});

// ── destroyRoomForScheduledGameSafe (public API for cancel-before-start) ────

test("PR-C1b: destroyRoomForScheduledGameSafe happy path", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) => /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [{ room_code: "ROOM-CANCEL" }],
      },
    ],
    fakeEngine: fake,
  });

  await service.destroyRoomForScheduledGameSafe("g1", "cancellation");
  assert.deepEqual(fake.destroyCalls, ["ROOM-CANCEL"]);
});

test("PR-C1b: destroyRoomForScheduledGameSafe med null room_code er no-op", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) => /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [{ room_code: null }],
      },
    ],
    fakeEngine: fake,
  });

  await service.destroyRoomForScheduledGameSafe("g1", "cancellation");
  assert.deepEqual(fake.destroyCalls, []);
});

test("PR-C1b: destroyRoomForScheduledGameSafe scheduled_game finnes ikke er no-op", async () => {
  const fake = makeFakeEngine();
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) => /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [],
      },
    ],
    fakeEngine: fake,
  });

  await service.destroyRoomForScheduledGameSafe("ukjent", "cancellation");
  assert.deepEqual(fake.destroyCalls, []);
});

// ── Idempotens (gjentatte destroyRoom-kall) ─────────────────────────────────

test("PR-C1b: idempotens — andre destroyRoom-kall på samme room kaster ROOM_NOT_FOUND men svelges", async () => {
  const fake = makeFakeEngine({
    // Første kall går fint, andre simulerer "allerede slettet".
    throwOnCalls: [
      // Første kall: ingen feil (throwOnCalls queue har bare 1 entry etter første consume)
    ],
  });

  // Vi trenger en mer avansert fake: første kall OK, andre kaster.
  const customCalls: string[] = [];
  let callCount = 0;
  const customFake = {
    destroyRoom(code: string) {
      customCalls.push(code);
      callCount += 1;
      if (callCount >= 2) {
        throw new DomainError(
          "ROOM_NOT_FOUND",
          `Rom ${code} finnes ikke.`
        );
      }
    },
  } as unknown as import("./BingoEngine.js").BingoEngine;

  const { pool } = createStubPool([
    {
      match: (s) => /SELECT\s+room_code\s+FROM/i.test(s),
      rows: [{ room_code: "ROOM-SAME" }],
      once: false,
    },
  ]);
  const auditLogService = new AuditLogService(new InMemoryAuditLogStore());
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService,
    bingoEngine: customFake,
  });

  // Første kall: skal kalle destroyRoom OK.
  await service.destroyRoomForScheduledGameSafe("g1", "completion");
  assert.deepEqual(customCalls, ["ROOM-SAME"]);

  // Andre kall: destroyRoom kaster, men vi skal ikke re-throw.
  await service.destroyRoomForScheduledGameSafe("g1", "cancellation");
  assert.deepEqual(customCalls, ["ROOM-SAME", "ROOM-SAME"]);

  // Marker fake som brukt for å unngå unused-warning i denne testen.
  void fake;
});

// ── setBingoEngine late-binding ─────────────────────────────────────────────

test("PR-C1b: setBingoEngine aktiverer cleanup på senere kall", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => /SELECT\s+room_code\s+FROM/i.test(s),
      rows: [{ room_code: "ROOM-LATE" }],
      once: false,
    },
  ]);
  const auditLogService = new AuditLogService(new InMemoryAuditLogStore());
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService,
    // INGEN bingoEngine i konstruksjonen.
  });

  // Før late-binding: no-op.
  await service.destroyRoomForScheduledGameSafe("g1", "cancellation");

  const calls: string[] = [];
  const fake = {
    destroyRoom(code: string) {
      calls.push(code);
    },
  } as unknown as import("./BingoEngine.js").BingoEngine;
  service.setBingoEngine(fake);

  await service.destroyRoomForScheduledGameSafe("g1", "completion");
  assert.deepEqual(calls, ["ROOM-LATE"]);
});

// ── defensiv: engine uten destroyRoom-metode ────────────────────────────────

test("PR-C1b: engine uten destroyRoom-metode → no-op (ingen crash)", async () => {
  const fake = makeFakeEngine({ noDestroyRoomMethod: true });
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) => /SELECT\s+room_code\s+FROM/i.test(s),
        rows: [{ room_code: "ROOM-X" }],
      },
    ],
    fakeEngine: fake,
  });

  // Skal ikke kaste.
  await service.destroyRoomForScheduledGameSafe("g1", "completion");
  assert.deepEqual(fake.destroyCalls, [], "ingen method = ingen call");
});
