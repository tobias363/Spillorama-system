/**
 * E2E integration test — 4-hall master coordination flow.
 *
 * Pilot-blokker. Verifiserer at hele kjeden av services som driver et
 * multi-hall Spill 1 kan settes opp, koordineres og kjøres uten DB-admin-
 * intervensjon.
 *
 * Dekker:
 *   1) Setup: HallGroup-opprettelse, 4 haller, master-tildeling, agent-shifts
 *   2) Pre-flight validering (RoomStartPreFlightValidator) — sjekker at
 *      en hall er medlem av en aktiv group + har spilleplan
 *   3) Ready-state-flyt (Game1HallReadyService) — alle 4 haller signaliserer
 *      ready, riktig farge-aggregat (red → orange → green)
 *   4) Master-start-guards (Game1MasterControlService) — orange/red haller
 *      blokkerer start; HALLS_NOT_READY DomainError med strukturert details
 *   5) Restart etter ENDED — UI-canStart-logikk
 *   6) Pause/resume-state (BingoEngine.pauseGame/resumeGame)
 *
 * Tilnærming:
 *   - Bruker ekte service-instanser fra DI (Game1HallReadyService,
 *     HallGroupService, AgentShiftService, BingoEngine) med stub-pool
 *     hvor DB-operasjon kreves. Matcher etablerte test-mønstre i
 *     samme repo (Game1HallReadyService.test.ts, Game1MasterControlService.startGuards.test.ts).
 *   - Hver test-step bygger sin egen stub-pool. Dette unngår krav om at
 *     hele systemet er kjørbart in-memory som én sammenhengende graf
 *     (ScheduleService og HallGroupService er Postgres-only og har ingen
 *     in-memory-implementasjon).
 *   - Tester kjøres som diagnostiske steg: hver step rapporterer PASS/FAIL
 *     med tydelig feilmelding så bugs lokaliseres umiddelbart.
 *
 * Branch-context (2026-04-27):
 *   - Agent ac8db6a307aa062c5 jobber på RoomStartPreFlightValidator
 *     (test-fil eksisterer, implementasjon ennå ikke commited til main).
 *   - Agent a117ef17574ba2030 jobber på engine end-game-bypass for test-haller.
 *   - Denne testen tester eksisterende state og rapporterer hva som mangler.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  BingoEngine,
  DomainError,
} from "../game/BingoEngine.js";
import { InMemoryWalletAdapter } from "../game/BingoEngine.test.js";
import { Game1HallReadyService } from "../game/Game1HallReadyService.js";
import { Game1MasterControlService, type MasterActor } from "../game/Game1MasterControlService.js";
import { AgentShiftService } from "../agent/AgentShiftService.js";
import { AgentService } from "../agent/AgentService.js";
import { InMemoryAgentStore } from "../agent/AgentStore.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../game/types.js";
import type { AppUser } from "../platform/PlatformService.js";

// ── Test fixtures ────────────────────────────────────────────────────────────

const TEST_GROUP_ID = "grp-e2e";
const TEST_GROUP_NAME = "Test Group E2E";
const HALL_IDS = ["hall-1", "hall-2", "hall-3", "hall-4"] as const;
const MASTER_HALL_ID = "hall-1";
const TEST_GAME_ID = "g-e2e-1";
const TEST_SCHEDULED_GAME_ID = TEST_GAME_ID;

const FIXED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((r) => [...r]) };
  }
}

// ── Stub pool helpers (matches Game1HallReadyService.test.ts pattern) ───────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

interface StubClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql)) {
        queue.splice(i, 1);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async (): Promise<StubClient> => ({
        query,
        release: () => undefined,
      }),
      query,
    },
    queries,
  };
}

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: TEST_SCHEDULED_GAME_ID,
    status: "purchase_open",
    participating_halls_json: HALL_IDS.slice(),
    group_hall_id: TEST_GROUP_ID,
    master_hall_id: MASTER_HALL_ID,
    actual_start_time: null,
    actual_end_time: null,
    ...overrides,
  };
}

function hallReadyRow(hallId: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    game_id: TEST_SCHEDULED_GAME_ID,
    hall_id: hallId,
    is_ready: false,
    ready_at: null,
    ready_by_user_id: null,
    digital_tickets_sold: 5,
    physical_tickets_sold: 3,
    excluded_from_game: false,
    excluded_reason: null,
    created_at: "2026-04-27T10:00:00.000Z",
    updated_at: "2026-04-27T10:00:00.000Z",
    start_ticket_id: "100",
    start_scanned_at: "2026-04-27T10:00:00.000Z",
    final_scan_ticket_id: "108",
    final_scanned_at: "2026-04-27T10:30:00.000Z",
    ...overrides,
  };
}

// ── Setup helpers ───────────────────────────────────────────────────────────

interface AgentTestRig {
  shiftService: AgentShiftService;
  agentService: AgentService;
  store: InMemoryAgentStore;
}

function makeAgentRig(): AgentTestRig {
  const store = new InMemoryAgentStore();
  let nextUserId = 1;
  const stubPlatform = {
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
      role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
      phone?: string;
    }): Promise<AppUser> {
      const id = `agent-user-${nextUserId++}`;
      store.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        phone: input.phone,
      });
      return {
        id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        walletId: `wallet-${id}`,
        role: input.role,
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async softDeletePlayer(): Promise<void> {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentService = new AgentService({ platformService: stubPlatform as any, agentStore: store });
  const shiftService = new AgentShiftService({ agentStore: store, agentService });
  return { shiftService, agentService, store };
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe("E2E 4-hall master flow — pilot blokker-validering", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1 — Setup-fase: agent-opprettelse + shift-start
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 1 — opprett 4 agent-brukere (én per hall) og start shifts", async () => {
    const rig = makeAgentRig();
    const agents: Array<{ hallId: string; userId: string }> = [];

    for (let i = 0; i < HALL_IDS.length; i++) {
      const hallId = HALL_IDS[i]!;
      const agent = await rig.agentService.createAgent({
        email: `agent${i + 1}@e2e.test`,
        password: "hunter2hunter2",
        displayName: `Agent ${i + 1}`,
        surname: "E2E",
        hallIds: [hallId],
      });
      agents.push({ hallId, userId: agent.userId });
    }

    assert.equal(agents.length, 4, "expected 4 agents created (one per hall)");

    // Hver agent åpner shift i sin hall
    for (const a of agents) {
      const shift = await rig.shiftService.startShift({
        userId: a.userId,
        hallId: a.hallId,
      });
      assert.equal(shift.isActive, true, `shift for ${a.hallId} should be active`);
      assert.equal(shift.hallId, a.hallId, `shift hallId should match`);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2 — Pre-flight validation (RoomStartPreFlightValidator)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 2 — RoomStartPreFlightValidator finnes som modul (agent ac8db6a30 leverer)", async () => {
    // Sjekker at implementation eksisterer. Hvis ikke: tydelig FAIL-melding
    // som dokumenterer at agentens arbeid trengs.
    let validator: unknown;
    let importError: Error | null = null;
    try {
      const mod = await import("../game/RoomStartPreFlightValidator.js");
      validator = mod.RoomStartPreFlightValidator;
    } catch (err) {
      importError = err as Error;
    }
    assert.equal(
      importError,
      null,
      `RoomStartPreFlightValidator-modulen mangler. ` +
        `Test-fil finnes (apps/backend/src/game/RoomStartPreFlightValidator.test.ts) ` +
        `men implementasjon er ikke commited til main.\n` +
        `Importfeil: ${importError?.message ?? "n/a"}\n` +
        `Forventet: agent ac8db6a307aa062c5 lander filen ` +
        `apps/backend/src/game/RoomStartPreFlightValidator.ts.`
    );
    assert.ok(validator, "RoomStartPreFlightValidator should be importable");
  });

  test("STEP 2.1 — pre-flight passes when hall is in active group + has schedule", async () => {
    let RoomStartPreFlightValidator: unknown;
    try {
      const mod = await import("../game/RoomStartPreFlightValidator.js");
      RoomStartPreFlightValidator = mod.RoomStartPreFlightValidator;
    } catch {
      // Skip — STEP 2 dokumenterer mangelen.
      console.warn("[STEP 2.1] SKIPPED: RoomStartPreFlightValidator mangler");
      return;
    }
    const { pool } = createStubPool([
      // Group lookup: hall-1 er medlem av aktiv gruppe
      {
        match: (sql) =>
          /app_hall_groups.*INNER JOIN.*app_hall_group_members/s.test(sql),
        rows: [{ id: TEST_GROUP_ID }],
      },
      // Schedule lookup: aktiv schedule finnes for gruppen
      {
        match: (sql) => /FROM .*app_daily_schedules/s.test(sql),
        rows: [{ "?column?": 1 }],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validator = (RoomStartPreFlightValidator as any).forTesting(pool);
    await validator.validate(MASTER_HALL_ID); // skal ikke kaste
  });

  test("STEP 2.2 — pre-flight rejects hall NOT in any group (HALL_NOT_IN_GROUP)", async () => {
    let RoomStartPreFlightValidator: unknown;
    try {
      const mod = await import("../game/RoomStartPreFlightValidator.js");
      RoomStartPreFlightValidator = mod.RoomStartPreFlightValidator;
    } catch {
      console.warn("[STEP 2.2] SKIPPED: RoomStartPreFlightValidator mangler");
      return;
    }
    const { pool } = createStubPool([
      // Group lookup: ingen treff
      {
        match: (sql) =>
          /app_hall_groups.*INNER JOIN.*app_hall_group_members/s.test(sql),
        rows: [],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validator = (RoomStartPreFlightValidator as any).forTesting(pool);
    await assert.rejects(
      () => validator.validate("hall-orphan"),
      (err: unknown) =>
        err instanceof DomainError && err.code === "HALL_NOT_IN_GROUP"
    );
  });

  test("STEP 2.3 — pre-flight rejects when group has NO active schedule (NO_SCHEDULE_FOR_HALL_GROUP)", async () => {
    let RoomStartPreFlightValidator: unknown;
    try {
      const mod = await import("../game/RoomStartPreFlightValidator.js");
      RoomStartPreFlightValidator = mod.RoomStartPreFlightValidator;
    } catch {
      console.warn("[STEP 2.3] SKIPPED: RoomStartPreFlightValidator mangler");
      return;
    }
    const { pool } = createStubPool([
      {
        match: (sql) =>
          /app_hall_groups.*INNER JOIN.*app_hall_group_members/s.test(sql),
        rows: [{ id: TEST_GROUP_ID }],
      },
      // Schedule lookup: tom — ingen aktiv schedule
      {
        match: (sql) => /FROM .*app_daily_schedules/s.test(sql),
        rows: [],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validator = (RoomStartPreFlightValidator as any).forTesting(pool);
    await assert.rejects(
      () => validator.validate(MASTER_HALL_ID),
      (err: unknown) =>
        err instanceof DomainError &&
        err.code === "NO_SCHEDULE_FOR_HALL_GROUP"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3 — Ready-state-flyt (Game1HallReadyService)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 3.1 — initial state: alle 4 haller er NOT_READY (rød eller orange)", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [scheduledGameRow()],
      },
      {
        match: (sql) =>
          sql.includes("SELECT game_id") &&
          !sql.includes("WHERE game_id = $1 AND hall_id = $2"),
        rows: [], // ingen ready-rader ennå
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    const statuses = await svc.getReadyStatusForGame(TEST_SCHEDULED_GAME_ID);
    assert.equal(statuses.length, 4, "should return one row per hall (defaults)");
    for (const s of statuses) {
      assert.equal(s.isReady, false, `${s.hallId} should be NOT_READY initially`);
      assert.equal(s.excludedFromGame, false);
    }
  });

  test("STEP 3.2 — Hall 2 markerer ready → state.is_ready=true", async () => {
    const { pool } = createStubPool([
      // 1) loadScheduledGame
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [scheduledGameRow()],
      },
      // 2) countPhysicalSoldForHall
      {
        match: (sql) => sql.includes('FROM "public"."app_physical_tickets"'),
        rows: [{ cnt: "3" }],
      },
      // 3) loadExistingRow (final-scan-guard) — må ha final-scan utført
      {
        match: (sql) =>
          sql.includes("SELECT game_id") &&
          sql.includes("WHERE game_id = $1 AND hall_id = $2"),
        rows: [hallReadyRow("hall-2", { is_ready: false })],
      },
      // 4) UPSERT
      {
        match: (sql) => sql.includes('INSERT INTO "public"."app_game1_hall_ready_status"'),
        rows: [hallReadyRow("hall-2", { is_ready: true, ready_at: new Date().toISOString() })],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    const result = await svc.markReady({
      gameId: TEST_SCHEDULED_GAME_ID,
      hallId: "hall-2",
      userId: "agent-2",
      digitalTicketsSold: 5,
    });
    assert.equal(result.isReady, true);
    assert.equal(result.hallId, "hall-2");
    assert.notEqual(result.readyAt, null, "ready_at should be set after markReady");
  });

  test("STEP 3.3 — partial ready (Hall 2,3,4 ready, master hall-1 NOT) → allParticipatingHallsReady=false", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [scheduledGameRow()],
      },
      {
        match: (sql) => sql.includes("SELECT game_id"),
        rows: [
          hallReadyRow("hall-1", { is_ready: false }), // master NOT ready
          hallReadyRow("hall-2", { is_ready: true }),
          hallReadyRow("hall-3", { is_ready: true }),
          hallReadyRow("hall-4", { is_ready: true }),
        ],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    const allReady = await svc.allParticipatingHallsReady(TEST_SCHEDULED_GAME_ID);
    assert.equal(allReady, false, "should be false when master is not ready");
  });

  test("STEP 3.4 — alle 4 haller ready → allParticipatingHallsReady=true", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [scheduledGameRow()],
      },
      {
        match: (sql) => sql.includes("SELECT game_id"),
        rows: [
          hallReadyRow("hall-1", { is_ready: true }),
          hallReadyRow("hall-2", { is_ready: true }),
          hallReadyRow("hall-3", { is_ready: true }),
          hallReadyRow("hall-4", { is_ready: true }),
        ],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    const allReady = await svc.allParticipatingHallsReady(TEST_SCHEDULED_GAME_ID);
    assert.equal(allReady, true, "all 4 halls ready should yield ALL_READY=true");
  });

  test("STEP 3.5 — color-aggregation: green for ready+sold, orange for ready-but-no-final-scan, red for 0-players", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [scheduledGameRow()],
      },
      {
        match: (sql) => sql.includes("SELECT game_id"),
        rows: [
          // Hall 1 (master): green — ready + final scan + 8 spillere
          hallReadyRow("hall-1", { is_ready: true }),
          // Hall 2: orange — har spillere men mangler final-scan
          hallReadyRow("hall-2", {
            is_ready: false,
            final_scan_ticket_id: null,
            final_scanned_at: null,
            digital_tickets_sold: 2,
            physical_tickets_sold: 3,
          }),
          // Hall 3: red — 0 spillere
          hallReadyRow("hall-3", {
            is_ready: false,
            digital_tickets_sold: 0,
            physical_tickets_sold: 0,
            start_ticket_id: null,
            final_scan_ticket_id: null,
          }),
          // Hall 4: green — ready + sold
          hallReadyRow("hall-4", { is_ready: true }),
        ],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    const statuses = await svc.getHallStatusForGame(TEST_SCHEDULED_GAME_ID);
    const byHall = new Map(statuses.map((s) => [s.hallId, s]));
    assert.equal(byHall.get("hall-1")!.color, "green", "master should be green");
    assert.equal(byHall.get("hall-2")!.color, "orange", "hall-2 missing final-scan should be orange");
    assert.equal(byHall.get("hall-3")!.color, "red", "hall-3 with 0 players should be red");
    assert.equal(byHall.get("hall-4")!.color, "green", "hall-4 ready+sold should be green");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4 — Master start-guards (Game1MasterControlService)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 4.1 — master start auto-ekskluderer 1 unready hall (Tobias-direktiv 2026-05-08)", async () => {
    // OPPDATERT 2026-05-09: Per Tobias-direktiv 2026-05-08
    // (Game1MasterControlService.ts:535-540) kan master starte UAVHENGIG av
    // om andre haller er klare. Ready-status er KUN informativ visning, ikke
    // gate. Ikke-grønne ikke-master-haller auto-ekskluderes med audit-trail
    // (`unready_override` / `auto_excluded_red_no_players` /
    // `auto_excluded_scan_pending`).
    //
    // FORRIGE assertion (HALLS_NOT_READY) gjaldt OLD adferd der unready
    // halls blokkerte start. Lockdown-test oppdatert for å verifisere ny
    // adferd: master start skal SUKSEDE og hall-2 (unready) skal ende opp i
    // INSERT-eksklusjons-queryen som queue trekker.
    //
    // Master-hall-not-ready er fortsatt hard-feil (HALLS_NOT_READY) og
    // verifiseres i en egen test (STEP 4.1b nedenfor).
    const masterActor: MasterActor = {
      userId: "agent-master",
      hallId: MASTER_HALL_ID,
      role: "AGENT",
    };
    const { pool, queries } = createStubPool([
      // BEGIN
      { match: (sql) => /^\s*BEGIN/.test(sql), rows: [] },
      // SELECT FOR UPDATE on scheduled_games
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_scheduled_games") &&
          sql.includes("FOR UPDATE"),
        rows: [scheduledGameRow()],
      },
      // SELECT ready snapshot — master grønn, hall-2 orange (unready), 3+4 grønne
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_hall_ready_status"),
        rows: [
          // Master is ready (must be — separate guard)
          {
            hall_id: "hall-1",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 5,
            physical_tickets_sold: 3,
            start_ticket_id: "100",
            final_scan_ticket_id: "108",
          },
          // Hall 2 is NOT ready (orange — has players, missing final scan).
          // Skal AUTO-EKSKLUDERES av master-start, ikke blokkere.
          {
            hall_id: "hall-2",
            is_ready: false,
            excluded_from_game: false,
            digital_tickets_sold: 0,
            physical_tickets_sold: 5,
            start_ticket_id: "200",
            final_scan_ticket_id: null,
          },
          // Hall 3 ready
          {
            hall_id: "hall-3",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 4,
            physical_tickets_sold: 2,
            start_ticket_id: "300",
            final_scan_ticket_id: "302",
          },
          // Hall 4 ready
          {
            hall_id: "hall-4",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 3,
            physical_tickets_sold: 4,
            start_ticket_id: "400",
            final_scan_ticket_id: "404",
          },
        ],
      },
      // INSERT auto-eksklusjon for hall-2 (unready_override)
      {
        match: (sql) =>
          sql.includes("INSERT INTO") &&
          sql.includes("app_game1_hall_ready_status") &&
          sql.includes("ON CONFLICT"),
        rows: [],
        rowCount: 1,
      },
      // INSERT audit-event start_game_with_unready_override
      {
        match: (sql) =>
          sql.includes("INSERT INTO") &&
          sql.includes("app_game1_master_audit"),
        rows: [{ id: "audit-override" }],
        rowCount: 1,
      },
      // SELECT ready snapshot post-eksklusjon (re-load)
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_hall_ready_status"),
        rows: [
          {
            hall_id: "hall-1",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 5,
            physical_tickets_sold: 3,
            start_ticket_id: "100",
            final_scan_ticket_id: "108",
          },
          {
            hall_id: "hall-2",
            is_ready: false,
            excluded_from_game: true, // nå auto-ekskludert
            digital_tickets_sold: 0,
            physical_tickets_sold: 5,
            start_ticket_id: "200",
            final_scan_ticket_id: null,
          },
          {
            hall_id: "hall-3",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 4,
            physical_tickets_sold: 2,
            start_ticket_id: "300",
            final_scan_ticket_id: "302",
          },
          {
            hall_id: "hall-4",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 3,
            physical_tickets_sold: 4,
            start_ticket_id: "400",
            final_scan_ticket_id: "404",
          },
        ],
      },
      // UPDATE status='running'
      {
        match: (sql) =>
          /UPDATE/.test(sql) &&
          sql.includes("app_game1_scheduled_games") &&
          sql.includes("status"),
        rows: [{ id: TEST_SCHEDULED_GAME_ID, status: "running" }],
        rowCount: 1,
      },
      // INSERT main start-audit
      {
        match: (sql) =>
          sql.includes("INSERT INTO") &&
          sql.includes("app_game1_master_audit"),
        rows: [{ id: "audit-start" }],
        rowCount: 1,
      },
      // COMMIT
      { match: (sql) => /^\s*COMMIT/.test(sql), rows: [] },
      // Fallback ROLLBACK hvis stuben er feil-konfigurert
      { match: (sql) => /^\s*ROLLBACK/.test(sql), rows: [] },
    ]);
    const svc = Game1MasterControlService.forTesting(pool as never);
    // Skal IKKE kaste — master kan starte uavhengig av unready halls
    try {
      const result = await svc.startGame({
        gameId: TEST_SCHEDULED_GAME_ID,
        actor: masterActor,
      });
      assert.ok(result, "startGame skal returnere MasterActionResult");
    } catch (err) {
      if (err instanceof DomainError) {
        assert.fail(
          `STEP 4.1 master start feilet med DomainError: ${err.code} — ${err.message}\n` +
            `Per Tobias-direktiv 2026-05-08 skal master kunne starte uavhengig av unready halls.\n` +
            `Sjekk Game1MasterControlService.startGame auto-eksklusjons-flyt.`
        );
      }
      throw err;
    }
    // Verifiser at auto-eksklusjon faktisk ble forsøkt (INSERT med ON CONFLICT)
    const exclusionInsert = queries.find(
      (q) =>
        q.sql.includes("INSERT INTO") &&
        q.sql.includes("app_game1_hall_ready_status") &&
        q.sql.includes("ON CONFLICT")
    );
    assert.ok(
      exclusionInsert,
      "auto-eksklusjons-INSERT med ON CONFLICT bør ha kjørt"
    );
  });

  test("STEP 4.1b — master start fails when MASTER hall is unready (HALLS_NOT_READY)", async () => {
    // Master-hallen kan ALDRI auto-ekskluderes — hvis master er rød er det
    // feil-situasjon (master må fikse sitt eget salg før start). Bevart
    // som hard-feil per Tobias-direktiv 2026-05-08.
    const masterActor: MasterActor = {
      userId: "agent-master",
      hallId: MASTER_HALL_ID,
      role: "AGENT",
    };
    const { pool } = createStubPool([
      { match: (sql) => /^\s*BEGIN/.test(sql), rows: [] },
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_scheduled_games") &&
          sql.includes("FOR UPDATE"),
        rows: [scheduledGameRow()],
      },
      // Ready snapshot — MASTER (hall-1) ER NOT READY
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_hall_ready_status"),
        rows: [
          {
            hall_id: "hall-1", // MASTER
            is_ready: false, // ← KEY: master er ikke klar
            excluded_from_game: false,
            digital_tickets_sold: 0,
            physical_tickets_sold: 5,
            start_ticket_id: "100",
            final_scan_ticket_id: null,
          },
          {
            hall_id: "hall-2",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 5,
            physical_tickets_sold: 3,
            start_ticket_id: "200",
            final_scan_ticket_id: "208",
          },
          {
            hall_id: "hall-3",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 4,
            physical_tickets_sold: 2,
            start_ticket_id: "300",
            final_scan_ticket_id: "302",
          },
          {
            hall_id: "hall-4",
            is_ready: true,
            excluded_from_game: false,
            digital_tickets_sold: 3,
            physical_tickets_sold: 4,
            start_ticket_id: "400",
            final_scan_ticket_id: "404",
          },
        ],
      },
      { match: (sql) => /^\s*ROLLBACK/.test(sql), rows: [] },
    ]);
    const svc = Game1MasterControlService.forTesting(pool as never);
    await assert.rejects(
      () =>
        svc.startGame({
          gameId: TEST_SCHEDULED_GAME_ID,
          actor: masterActor,
        }),
      (err: unknown) => {
        assert.ok(err instanceof DomainError, "skal kaste DomainError");
        assert.equal(
          (err as DomainError).code,
          "HALLS_NOT_READY",
          "master-hall not ready skal forsatt være hard-feil"
        );
        return true;
      }
    );
  });

  test("STEP 4.2 — master start succeeds when all 4 halls are ready (no jackpot)", async () => {
    const masterActor: MasterActor = {
      userId: "agent-master",
      hallId: MASTER_HALL_ID,
      role: "AGENT",
    };
    const { pool } = createStubPool([
      { match: (sql) => /^\s*BEGIN/.test(sql), rows: [] },
      // loadGameForUpdate
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_scheduled_games") &&
          sql.includes("FOR UPDATE"),
        rows: [scheduledGameRow()],
      },
      // ready snapshot — alle 4 grønne
      {
        match: (sql) =>
          sql.includes("FROM") &&
          sql.includes("app_game1_hall_ready_status"),
        rows: HALL_IDS.map((hallId) => ({
          hall_id: hallId,
          is_ready: true,
          excluded_from_game: false,
          digital_tickets_sold: 5,
          physical_tickets_sold: 3,
          start_ticket_id: "100",
          final_scan_ticket_id: "108",
        })),
      },
      // UPDATE status='running'
      {
        match: (sql) =>
          /UPDATE/.test(sql) &&
          sql.includes("app_game1_scheduled_games") &&
          sql.includes("status"),
        rows: [{ id: TEST_SCHEDULED_GAME_ID, status: "running" }],
        rowCount: 1,
      },
      // INSERT audit
      {
        match: (sql) =>
          sql.includes("INSERT INTO") &&
          sql.includes("app_game1_master_audit"),
        rows: [{ id: "audit-1" }],
        rowCount: 1,
      },
      // COMMIT
      { match: (sql) => /^\s*COMMIT/.test(sql), rows: [] },
    ]);
    const svc = Game1MasterControlService.forTesting(pool as never);
    // Test bør ikke kaste — men hvis det kaster pga. mangler i mock,
    // dokumenter det tydelig.
    try {
      const result = await svc.startGame({
        gameId: TEST_SCHEDULED_GAME_ID,
        actor: masterActor,
      });
      assert.ok(result, "startGame should return MasterActionResult");
    } catch (err) {
      // Hvis dette feiler er det fordi service trenger flere DB-rader enn
      // vår stub gir. Vi fanger det og gir tydelig feilmelding for PM.
      if (err instanceof DomainError) {
        assert.fail(
          `STEP 4.2 master start failed with DomainError: ${err.code} — ${err.message}\n` +
            `Dette indikerer at start-flyten har flere SQL-steg enn stub-pool dekker.\n` +
            `Sjekk Game1MasterControlService.startGame for crash-rollback (CRIT-7) og engine-wiring.`
        );
      }
      throw err;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5 — BingoEngine pause/resume (room-scoped engine)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 5.1 — BingoEngine.pauseGame setter game.isPaused=true", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: MASTER_HALL_ID,
      playerName: "Master Host",
      walletId: "wallet-host",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    const before = engine.getRoomSnapshot(roomCode);
    assert.equal(before.currentGame?.status, "RUNNING");
    assert.notEqual(before.currentGame?.isPaused, true);

    engine.pauseGame(roomCode, "Test pause");
    const paused = engine.getRoomSnapshot(roomCode);
    assert.equal(paused.currentGame?.isPaused, true, "isPaused should be true after pauseGame");
    assert.equal(paused.currentGame?.status, "RUNNING", "status should still be RUNNING when paused");
  });

  test("STEP 5.2 — BingoEngine.resumeGame clears isPaused", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: MASTER_HALL_ID,
      playerName: "Master Host",
      walletId: "wallet-host2",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    engine.pauseGame(roomCode, "Test pause");
    engine.resumeGame(roomCode);
    const resumed = engine.getRoomSnapshot(roomCode);
    assert.notEqual(resumed.currentGame?.isPaused, true, "isPaused should be false after resume");
  });

  test("STEP 5.3 — pauseGame throws GAME_ALREADY_PAUSED when called twice", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: MASTER_HALL_ID,
      playerName: "Host",
      walletId: "wallet-host3",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    engine.pauseGame(roomCode);
    assert.throws(
      () => engine.pauseGame(roomCode),
      (err: unknown) =>
        err instanceof DomainError && err.code === "GAME_ALREADY_PAUSED"
    );
  });

  test("STEP 5.4 — resumeGame throws GAME_NOT_PAUSED when game is not paused", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: MASTER_HALL_ID,
      playerName: "Host",
      walletId: "wallet-host4",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    assert.throws(
      () => engine.resumeGame(roomCode),
      (err: unknown) =>
        err instanceof DomainError && err.code === "GAME_NOT_PAUSED"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 6 — Restart-after-ENDED (UI canStart-logikk)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 6.1 — UI canStart-logikk: status NONE/WAITING/ENDED → canStart=true", async () => {
    // Replikerer logikken fra
    // apps/admin-web/src/pages/agent-portal/NextGamePanel.ts:654.
    // canStart = gameStatus !== "RUNNING" && gameStatus !== "PAUSED"
    function canStart(gameStatus: string): boolean {
      return gameStatus !== "RUNNING" && gameStatus !== "PAUSED";
    }
    assert.equal(canStart("NONE"), true);
    assert.equal(canStart("WAITING"), true);
    assert.equal(canStart("ENDED"), true);
    assert.equal(canStart("RUNNING"), false);
    assert.equal(canStart("PAUSED"), false);
  });

  test("STEP 6.2 — engine.endGame transitions WAITING/RUNNING → ENDED, allowing restart", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: MASTER_HALL_ID,
      playerName: "Host",
      walletId: "wallet-end",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    const running = engine.getRoomSnapshot(roomCode);
    assert.equal(running.currentGame?.status, "RUNNING");

    await engine.endGame({
      roomCode,
      actorPlayerId: playerId,
      reason: "manual end (test)",
    });
    const ended = engine.getRoomSnapshot(roomCode);
    // Etter endGame: status er ENDED i siste game-history-entry og
    // currentGame kan være ENDED eller null. Begge tillater canStart=true.
    const lastStatus = ended.currentGame?.status ?? "ENDED";
    assert.notEqual(lastStatus, "RUNNING", "should not be RUNNING after endGame");
    assert.notEqual(lastStatus, "PAUSED", "should not be PAUSED after endGame");
  });

  test("STEP 6.3 — restart-after-end: ny startGame oppretter ny gameId med tom drawnNumbers", async () => {
    // BingoEngine har 30s hardkodet floor på minRoundIntervalMs (regulatorisk
    // krav per pengespillforskriften). For å teste restart-flyten i samme
    // test-tick stomper vi den private `roomLastRoundStartMs` til 40s
    // tilbake — samme mønster som Game3Engine.test.ts:884-888 bruker.
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: MASTER_HALL_ID,
      playerName: "Host",
      walletId: "wallet-restart",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    const first = engine.getRoomSnapshot(roomCode);
    const firstGameId = first.currentGame?.id;
    assert.ok(firstGameId, "first game should have id");

    // Trekk noen baller
    await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
    await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

    await engine.endGame({
      roomCode,
      actorPlayerId: playerId,
      reason: "test end",
    });

    // Stomp last-round-start så minRoundIntervalMs (30s floor) tillater restart.
    const lastStart = (engine as unknown as {
      roomLastRoundStartMs: Map<string, number>;
    }).roomLastRoundStartMs;
    lastStart.set(roomCode, Date.now() - 40_000);

    // Restart
    let secondStartFailed: Error | null = null;
    try {
      await engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: 0,
        ticketsPerPlayer: 1,
        payoutPercent: 100,
      });
    } catch (err) {
      secondStartFailed = err as Error;
    }
    assert.equal(
      secondStartFailed,
      null,
      `restart after endGame should succeed, but failed: ${secondStartFailed?.message ?? "n/a"}`
    );

    const second = engine.getRoomSnapshot(roomCode);
    assert.notEqual(second.currentGame?.id, firstGameId, "new game should have different gameId");
    assert.equal(
      second.currentGame?.drawnNumbers.length ?? 0,
      0,
      "drawnNumbers should be empty on new game"
    );
    assert.equal(second.currentGame?.status, "RUNNING");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 7 — Negativ-tester: validation pre-flight
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 7.1 — markReady avviser status='running' (kan ikke endre når spill kjører)", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [scheduledGameRow({ status: "running" })],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    await assert.rejects(
      () =>
        svc.markReady({
          gameId: TEST_SCHEDULED_GAME_ID,
          hallId: "hall-2",
          userId: "agent-2",
        }),
      (err) =>
        err instanceof DomainError && err.code === "GAME_NOT_READY_ELIGIBLE"
    );
  });

  test("STEP 7.2 — markReady avviser hall som IKKE deltar (HALL_NOT_PARTICIPATING)", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [
          scheduledGameRow({
            participating_halls_json: ["hall-1", "hall-2"], // hall-99 ikke med
            master_hall_id: "hall-1",
          }),
        ],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    await assert.rejects(
      () =>
        svc.markReady({
          gameId: TEST_SCHEDULED_GAME_ID,
          hallId: "hall-99",
          userId: "agent-x",
        }),
      (err) =>
        err instanceof DomainError && err.code === "HALL_NOT_PARTICIPATING"
    );
  });

  test("STEP 7.3 — assertPurchaseOpenForHall blokkerer kjøp etter hall har trykket ready", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes("LEFT JOIN"),
        rows: [{ is_ready: true, status: "purchase_open" }],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    await assert.rejects(
      () => svc.assertPurchaseOpenForHall(TEST_SCHEDULED_GAME_ID, "hall-2"),
      (err) =>
        err instanceof DomainError && err.code === "PURCHASE_CLOSED_FOR_HALL"
    );
  });

  test("STEP 7.4 — agent kan IKKE starte 2 shifts (SHIFT_ALREADY_ACTIVE)", async () => {
    const rig = makeAgentRig();
    const agent = await rig.agentService.createAgent({
      email: "double-shift@e2e.test",
      password: "hunter2hunter2",
      displayName: "Double Shift",
      surname: "Test",
      hallIds: ["hall-1"],
    });
    await rig.shiftService.startShift({
      userId: agent.userId,
      hallId: "hall-1",
    });
    await assert.rejects(
      () => rig.shiftService.startShift({ userId: agent.userId, hallId: "hall-1" }),
      (err) =>
        err instanceof DomainError && err.code === "SHIFT_ALREADY_ACTIVE"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 8 — Multi-hall ready-state aggregation (full setup)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP 8 — full 4-hall ready-progression: 0/4 → 1/4 → 3/4 → 4/4", async () => {
    // Simulerer at vi spør allParticipatingHallsReady etter hver hall
    // markerer ready. Hver query er sin egen stub-pool fordi vi ikke har
    // delt state mellom queries.
    type Snapshot = {
      readyHalls: string[];
      expectedAllReady: boolean;
    };
    const snapshots: Snapshot[] = [
      { readyHalls: [], expectedAllReady: false }, // 0/4
      { readyHalls: ["hall-2"], expectedAllReady: false }, // 1/4
      { readyHalls: ["hall-2", "hall-3", "hall-4"], expectedAllReady: false }, // 3/4 (master ikke ready)
      { readyHalls: ["hall-1", "hall-2", "hall-3", "hall-4"], expectedAllReady: true }, // 4/4
    ];

    for (const snapshot of snapshots) {
      const { pool } = createStubPool([
        {
          match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
          rows: [scheduledGameRow()],
        },
        {
          match: (sql) => sql.includes("SELECT game_id"),
          rows: HALL_IDS.map((hallId) =>
            hallReadyRow(hallId, {
              is_ready: snapshot.readyHalls.includes(hallId),
            })
          ),
        },
      ]);
      const svc = Game1HallReadyService.forTesting(pool as never);
      const allReady = await svc.allParticipatingHallsReady(TEST_SCHEDULED_GAME_ID);
      assert.equal(
        allReady,
        snapshot.expectedAllReady,
        `[${snapshot.readyHalls.length}/4 ready: ${snapshot.readyHalls.join(",")}] ` +
          `expected allReady=${snapshot.expectedAllReady}, got ${allReady}`
      );
    }
  });
});
