/**
 * Task 1.7 (2026-04-24): tester for `participatingHalls` på TvScreenService.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md §6 Bølge 1.
 *
 * Dekker:
 *   1. Happy path: hall-status-port returnerer 3 haller → TV-response har
 *      alle 3 med fargekode + playerCount.
 *   2. Fail-open (port kaster): HS-tabell mangler → tom array, ingen 500.
 *   3. Fail-open (port er null): wiring uten HS-PR → tom array.
 *   4. Filtrering: bare haller for aktivt spill (gameId-scoped port).
 *   5. Fallback: hvis app_halls-tabellen mangler, bruker vi hallId som navn.
 *   6. Empty-state (ingen aktiv/fallback-game) → tom array selv med port satt.
 *
 * Testene bruker stub-pool + stub-port for å unngå DB-avhengighet (matcher
 * mønsteret i Game1HallReadyService.test.ts).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  TvScreenService,
  type TvHallColor,
  type TvHallStatusPort,
} from "../TvScreenService.js";

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
}

interface StubPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
}

function createStubPool(responses: StubResponse[]): StubPool {
  const queue = responses.slice();
  return {
    query: async (sql: string) => {
      for (let i = 0; i < queue.length; i++) {
        const r = queue[i]!;
        if (r.match(sql)) {
          // NB: bevarer rader i køen slik at kallet er repeterbart
          // (TvScreenService kan kalle samme query flere ganger for
          // ulike kodestier). Vi bruker snapshot-semantikk her.
          return { rows: r.rows, rowCount: r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

function activeGameRow(): unknown {
  return {
    id: "sg-1",
    sub_game_index: 0,
    sub_game_name: "Spill 1",
    custom_game_name: null,
    scheduled_start_time: "2026-04-24T20:00:00.000Z",
    scheduled_end_time: "2026-04-24T20:30:00.000Z",
    status: "running",
    game_config_json: null,
  };
}

/**
 * Standard-stub-responser for en hall med ett aktivt spill.
 * Dekker queries TvScreenService gjør inne i `getStateInternal`:
 *   - findActiveScheduledGame
 *   - findNextScheduledGame
 *   - loadGameState
 *   - loadDraws
 *   - loadPhaseWinners
 *   - (task 1.7) loadHallNames
 */
function baseResponses(extra: StubResponse[] = []): StubResponse[] {
  return [
    {
      match: (s) => s.includes("FROM \"public\".\"app_game1_scheduled_games\"") && s.includes("'running'"),
      rows: [activeGameRow()],
    },
    {
      match: (s) => s.includes("FROM \"public\".\"app_game1_scheduled_games\"") && s.includes("scheduled_start_time > now()"),
      rows: [],
    },
    {
      match: (s) => s.includes("FROM \"public\".\"app_game1_game_state\""),
      rows: [{ current_phase: 1, last_drawn_ball: null, draws_completed: 0 }],
    },
    {
      match: (s) => s.includes("FROM \"public\".\"app_game1_draws\""),
      rows: [],
    },
    {
      match: (s) => s.includes("FROM \"public\".\"app_game1_phase_winners\""),
      rows: [],
    },
    ...extra,
  ];
}

function makeHallStatusPort(
  statuses: Array<{
    hallId: string;
    playerCount: number;
    excludedFromGame: boolean;
    color: TvHallColor;
  }>,
  opts: { throwError?: Error } = {}
): TvHallStatusPort {
  return {
    getHallStatusForGame: async () => {
      if (opts.throwError) throw opts.throwError;
      return statuses;
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("Task 1.7: happy path — returnerer alle deltakende haller med farge + playerCount", async () => {
  const pool = createStubPool(
    baseResponses([
      {
        match: (s) => s.includes("FROM \"public\".\"app_halls\""),
        rows: [
          { id: "hall-a", name: "Hall Alfa" },
          { id: "hall-b", name: "Hall Bravo" },
          { id: "hall-c", name: "Hall Charlie" },
        ],
      },
    ])
  );
  const port = makeHallStatusPort([
    { hallId: "hall-a", playerCount: 10, excludedFromGame: false, color: "green" },
    { hallId: "hall-b", playerCount: 3, excludedFromGame: false, color: "orange" },
    { hallId: "hall-c", playerCount: 0, excludedFromGame: true, color: "red" },
  ]);

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.equal(state.participatingHalls.length, 3);
  // Stabil sortering alfabetisk på hallName.
  assert.deepEqual(
    state.participatingHalls.map((h) => h.hallId),
    ["hall-a", "hall-b", "hall-c"]
  );
  assert.equal(state.participatingHalls[0]!.color, "green");
  assert.equal(state.participatingHalls[0]!.playerCount, 10);
  assert.equal(state.participatingHalls[0]!.hallName, "Hall Alfa");
  assert.equal(state.participatingHalls[1]!.color, "orange");
  assert.equal(state.participatingHalls[2]!.color, "red");
  assert.equal(state.participatingHalls[2]!.hallName, "Hall Charlie");
});

test("Task 1.7: fail-open når hall-status-porten kaster (HS-tabell mangler) → tom array", async () => {
  const pool = createStubPool(baseResponses());
  const missingTableErr = Object.assign(new Error("relation not found"), {
    code: "42P01",
  });
  const port = makeHallStatusPort([], { throwError: missingTableErr });

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.deepEqual(state.participatingHalls, []);
  // Andre felter skal være som forventet (fail-open påvirker kun halls).
  assert.equal(state.currentGame?.id, "sg-1");
});

test("Task 1.7: fail-open når porten kaster en generisk error → tom array + warn-log (ingen rethrow)", async () => {
  const pool = createStubPool(baseResponses());
  const genericErr = new Error("port blev trett");
  const port = makeHallStatusPort([], { throwError: genericErr });

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  // Skal IKKE kaste — kritisk for TV som ellers 500'er.
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });
  assert.deepEqual(state.participatingHalls, []);
});

test("Task 1.7: ingen hall-status-port satt → tom array (pre-HS-PR deploy)", async () => {
  const pool = createStubPool(baseResponses());
  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    // hallStatusPort utelatt — speiler main før HS-PR merge.
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });
  assert.deepEqual(state.participatingHalls, []);
});

test("Task 1.7: porten får aktivt gameId (scoped call — filtrerer til aktivt spill)", async () => {
  const pool = createStubPool(
    baseResponses([
      {
        match: (s) => s.includes("FROM \"public\".\"app_halls\""),
        rows: [{ id: "hall-a", name: "Hall Alfa" }],
      },
    ])
  );
  let receivedGameId: string | null = null;
  const port: TvHallStatusPort = {
    getHallStatusForGame: async (gameId: string) => {
      receivedGameId = gameId;
      return [
        { hallId: "hall-a", playerCount: 5, excludedFromGame: false, color: "green" },
      ];
    },
  };

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.equal(receivedGameId, "sg-1", "port skal få det aktive spillets id");
});

test("Task 1.7: fallback til hallId som hallName hvis app_halls-oppslag feiler", async () => {
  const pool = createStubPool(
    baseResponses([
      {
        match: (s) => {
          if (!s.includes("FROM \"public\".\"app_halls\"")) return false;
          // Kast for navneoppslag — her simulert ved at matcher kaster.
          throw Object.assign(new Error("app_halls missing"), { code: "42P01" });
        },
        rows: [],
      },
    ])
  );
  const port = makeHallStatusPort([
    { hallId: "hall-a", playerCount: 5, excludedFromGame: false, color: "green" },
  ]);

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.equal(state.participatingHalls.length, 1);
  assert.equal(state.participatingHalls[0]!.hallId, "hall-a");
  // Fallback: hallId brukes som navn.
  assert.equal(state.participatingHalls[0]!.hallName, "hall-a");
  assert.equal(state.participatingHalls[0]!.color, "green");
});

test("Task 1.7: empty-state (ingen aktivt eller fallback-spill) → tom participatingHalls", async () => {
  // Pool returnerer ingen spillrad — da hopper vi over hele
  // `loadParticipatingHalls`-kallet.
  const pool = createStubPool([
    {
      match: (s) => s.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [],
    },
  ]);
  let portCalled = false;
  const port: TvHallStatusPort = {
    getHallStatusForGame: async () => {
      portCalled = true;
      return [];
    },
  };

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.deepEqual(state.participatingHalls, []);
  assert.equal(portCalled, false, "porten skal ikke spørres når det ikke er aktivt spill");
});

test("Task 1.7: fail-open på scheduled_games-tabellen mangler — tom state, tom halls-liste", async () => {
  // Pool kaster med 42P01 på første query — TvScreenService skal svelge
  // det (eksisterende fail-open-path) og returnere tom snapshot.
  const pool: StubPool = {
    query: async () => {
      throw Object.assign(new Error("relation not found"), { code: "42P01" });
    },
  };
  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: makeHallStatusPort([]),
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.equal(state.status, "waiting");
  assert.equal(state.currentGame, null);
  assert.deepEqual(state.participatingHalls, []);
});

test("Task 1.7: tom port-response → tom participatingHalls (digital-only eller ukjent HS)", async () => {
  const pool = createStubPool(baseResponses());
  const port = makeHallStatusPort([]);

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  assert.deepEqual(state.participatingHalls, []);
});

test("Task 1.7: playerCount normaliseres til heltall ≥ 0", async () => {
  const pool = createStubPool(
    baseResponses([
      {
        match: (s) => s.includes("FROM \"public\".\"app_halls\""),
        rows: [
          { id: "hall-a", name: "Hall Alfa" },
          { id: "hall-b", name: "Hall Bravo" },
        ],
      },
    ])
  );
  const port = makeHallStatusPort([
    // -1 skal klempes til 0 (defensiv guard — ikke boble ut negativt).
    { hallId: "hall-a", playerCount: -1, excludedFromGame: false, color: "red" },
    // Desimaltall skal flooreras.
    { hallId: "hall-b", playerCount: 7.9, excludedFromGame: false, color: "green" },
  ]);

  const svc = new TvScreenService({
    pool: pool as unknown as import("pg").Pool,
    hallStatusPort: port,
  });
  const state = await svc.getState({ id: "hall-a", name: "Hall Alfa" });

  const hallA = state.participatingHalls.find((h) => h.hallId === "hall-a")!;
  const hallB = state.participatingHalls.find((h) => h.hallId === "hall-b")!;
  assert.equal(hallA.playerCount, 0);
  assert.equal(hallB.playerCount, 7);
});
