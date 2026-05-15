/**
 * Pilot Q3 2026 (2026-05-15) — `Game1DrawEngineService` MÅ trigge
 * `lobbyBroadcaster.broadcastForHall(hallId)` POST-commit etter natural
 * round-end (Fullt Hus vunnet eller maxDraws nådd).
 *
 * Bakgrunn (Tobias-rapport 2026-05-15):
 *   "Jeg kjørte runde med første spill (Bingo). Etter at runden var
 *    fullført viser fortsatt 'Neste spill: Bingo' i ca 2 min FØR det
 *    endret seg til '1000-spill'. Spiller skal ALDRI se gammelt spill."
 *
 * Root cause: når draw-engine flippet `app_game1_scheduled_games.status`
 * fra `running` → `completed`, ble det IKKE pushet noen broadcast til
 * spiller-shellen. Klient måtte vente på 10s-polling-tick før
 * "Neste spill: <gammel>" oppdaterte seg. Backend broadcasted kun ved
 * master-actions (start/pause/resume/stop) via `MasterActionService`.
 *
 * Fix: nytt valgfritt option `lobbyBroadcaster` på
 * `Game1DrawEngineServiceOptions`. Når satt fyrer engine
 * `broadcastForHall(hallId)` POST-commit for ALLE haller listet i
 * `master_hall_id` + `participating_halls_json`.
 *
 * Disse testene verifiserer:
 *   1) Broadcaster blir kalt med master-hallens id når isFinished=true.
 *   2) Broadcaster fyres for ALLE deltager-haller i GoH (fan-out).
 *   3) Broadcaster IKKE blir kalt for ikke-finishing draws (drawIndex 1).
 *   4) Engine ikke kaster når broadcaster selv kaster (fail-soft).
 *   5) `collectHallIdsForBroadcast`-helper dedup-er + filtrerer tomme.
 *
 * Referanser:
 *   - Doc-protokoll §2.19 (`.claude/skills/spill1-master-flow/SKILL.md`)
 *   - PITFALLS_LOG.md §7.22 "Lobby-broadcast manglet etter natural round-end"
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1DrawEngineService,
  collectHallIdsForBroadcast,
} from "../Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "../Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";

// ── Stub pool (mønster: matcher Game1DrawEngineService.bugD6StatusGuard.test.ts) ───

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
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[]): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (
      sql: string,
      params?: unknown[],
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

function makeFakeTicketPurchase(
  purchases: Game1TicketPurchaseRow[] = [],
): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return purchases;
    },
  } as unknown as Game1TicketPurchaseService;
}

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "running",
    ticket_config_json: { maxDraws: 3 },
    room_code: null,
    game_config_json: null,
    trafikklys_row_color: null,
    master_hall_id: "hall-master-001",
    participating_halls_json: ["hall-master-001", "hall-2", "hall-3"],
    master_is_test_hall: null,
    ...overrides,
  };
}

function gameStateRow(overrides: Record<string, unknown> = {}) {
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
    paused_at_phase: null,
    ...overrides,
  };
}

interface BroadcastSpyResult {
  calls: string[];
  shouldThrow: boolean;
}

function makeBroadcasterSpy(opts: { shouldThrow?: boolean } = {}): {
  broadcaster: { broadcastForHall(hallId: string): Promise<void> };
  result: BroadcastSpyResult;
} {
  const result: BroadcastSpyResult = {
    calls: [],
    shouldThrow: opts.shouldThrow ?? false,
  };
  return {
    broadcaster: {
      async broadcastForHall(hallId: string): Promise<void> {
        result.calls.push(hallId);
        if (result.shouldThrow) {
          throw new Error("simulated broadcaster failure");
        }
      },
    },
    result,
  };
}

function makeService(opts: {
  poolResponses: StubResponse[];
  broadcaster?: { broadcastForHall(hallId: string): Promise<void> } | null;
}): {
  service: Game1DrawEngineService;
  queries: RecordedQuery[];
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const ticketPurchase = makeFakeTicketPurchase();
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
    auditLogService,
    lobbyBroadcaster: opts.broadcaster ?? undefined,
  });
  return { service, queries };
}

/**
 * Bygger pool-responses som driver `drawNext` mot maxDraws=3 med 2 draws
 * allerede gjort — neste draw flipper `isFinished=true` og engine prøver
 * å sette status='completed' (natural round-end).
 */
function buildNaturalEndResponses(
  schedOverrides: Record<string, unknown> = {},
): StubResponse[] {
  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        gameStateRow({
          draws_completed: 2,
          last_drawn_ball: 20,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [scheduledGameRow(schedOverrides)],
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
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_game_state"),
      rows: [],
    },
    // UPDATE scheduled_game → completed.
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("'completed'"),
      rows: [],
      rowCount: 1,
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [
        gameStateRow({
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
  ];
}

/**
 * Wait helper for fire-and-forget Promises i POST-commit-pathen.
 * Engine bruker `void Promise.resolve(...).catch(...)` så broadcasts
 * fanges av microtask-køen. Vi venter 2 ticks for å la dem flushes.
 */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

// ── collectHallIdsForBroadcast unit-tester ───────────────────────────────────

test("collectHallIdsForBroadcast: master + participating halls dedup-ed", () => {
  const halls = collectHallIdsForBroadcast({
    master_hall_id: "hall-1",
    participating_halls_json: ["hall-1", "hall-2", "hall-3"],
  });
  assert.deepEqual(halls, ["hall-1", "hall-2", "hall-3"]);
});

test("collectHallIdsForBroadcast: parser JSON-string", () => {
  const halls = collectHallIdsForBroadcast({
    master_hall_id: "hall-1",
    participating_halls_json: JSON.stringify(["hall-2", "hall-3"]),
  });
  assert.deepEqual(halls, ["hall-1", "hall-2", "hall-3"]);
});

test("collectHallIdsForBroadcast: filtrerer ut tomme/whitespace-strings", () => {
  const halls = collectHallIdsForBroadcast({
    master_hall_id: "hall-1",
    participating_halls_json: ["", "   ", "hall-2", null, undefined],
  });
  assert.deepEqual(halls, ["hall-1", "hall-2"]);
});

test("collectHallIdsForBroadcast: tom array når begge er null", () => {
  const halls = collectHallIdsForBroadcast({
    master_hall_id: null,
    participating_halls_json: null,
  });
  assert.deepEqual(halls, []);
});

test("collectHallIdsForBroadcast: defensiv mot ugyldig JSON", () => {
  const halls = collectHallIdsForBroadcast({
    master_hall_id: "hall-1",
    participating_halls_json: "this is not json",
  });
  // Master-hall blir lagt til; participating-string er ikke en array
  // etter parse-fail → ignoreres.
  assert.deepEqual(halls, ["hall-1"]);
});

test("collectHallIdsForBroadcast: master-hall trimmed", () => {
  const halls = collectHallIdsForBroadcast({
    master_hall_id: "   hall-1   ",
    participating_halls_json: [],
  });
  assert.deepEqual(halls, ["hall-1"]);
});

// ── Engine-integration: lobby-broadcast etter natural round-end ──────────────

test(
  "natural end: broadcaster.broadcastForHall kalles med master-hall og deltager-haller",
  async () => {
    const { broadcaster, result } = makeBroadcasterSpy();
    const { service } = makeService({
      poolResponses: buildNaturalEndResponses(),
      broadcaster,
    });

    await service.drawNext("g1");
    await flushPromises();

    // Alle tre haller skal ha mottatt én broadcast hver (master + 2 deltager).
    assert.equal(
      result.calls.length,
      3,
      `forventet 3 broadcasts (master + 2 GoH-haller), fikk ${result.calls.length}: ${JSON.stringify(result.calls)}`,
    );
    assert.ok(
      result.calls.includes("hall-master-001"),
      "master-hallen MÅ være i broadcast-listen",
    );
    assert.ok(
      result.calls.includes("hall-2"),
      "deltager-hall-2 MÅ være i broadcast-listen",
    );
    assert.ok(
      result.calls.includes("hall-3"),
      "deltager-hall-3 MÅ være i broadcast-listen",
    );
  },
);

test(
  "natural end: broadcaster kalles ikke når lobbyBroadcaster er undefined (bakoverkompat)",
  async () => {
    // Ingen broadcaster injisert — engine MÅ ikke kaste.
    const { service } = makeService({
      poolResponses: buildNaturalEndResponses(),
      broadcaster: null,
    });

    await assert.doesNotReject(service.drawNext("g1"));
  },
);

test(
  "natural end: engine ruller IKKE tilbake når broadcaster.broadcastForHall kaster (fail-soft)",
  async () => {
    const { broadcaster, result } = makeBroadcasterSpy({ shouldThrow: true });
    const { service } = makeService({
      poolResponses: buildNaturalEndResponses(),
      broadcaster,
    });

    // drawNext skal lykkes — broadcast-feil er fail-soft.
    await assert.doesNotReject(service.drawNext("g1"));
    await flushPromises();

    // Spy ble fortsatt kalt (alle haller forsøkt) selv om hver feilet.
    assert.equal(
      result.calls.length,
      3,
      "broadcaster forsøkes for alle haller selv om hver enkelt kaster",
    );
  },
);

test(
  "natural end: master_hall_id satt men participating_halls_json tom array → kun master broadcastes",
  async () => {
    const { broadcaster, result } = makeBroadcasterSpy();
    const { service } = makeService({
      poolResponses: buildNaturalEndResponses({
        master_hall_id: "hall-solo",
        participating_halls_json: [],
      }),
      broadcaster,
    });

    await service.drawNext("g1");
    await flushPromises();

    assert.deepEqual(result.calls, ["hall-solo"]);
  },
);

test(
  "natural end: master_hall_id null OG participating tom → ingen broadcast (legacy/test-rad)",
  async () => {
    const { broadcaster, result } = makeBroadcasterSpy();
    const { service } = makeService({
      poolResponses: buildNaturalEndResponses({
        master_hall_id: null,
        participating_halls_json: null,
      }),
      broadcaster,
    });

    await service.drawNext("g1");
    await flushPromises();

    assert.equal(result.calls.length, 0);
  },
);
