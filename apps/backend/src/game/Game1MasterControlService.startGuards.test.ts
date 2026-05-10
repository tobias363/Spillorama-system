/**
 * TASK HS: start-guard-tester for Game1MasterControlService.startGame.
 *
 * 2026-05-08 (Tobias-direktiv) — oppdatert til ny soft-warning-flyt:
 *   - 🟠 Oransje hall (manglende slutt-scan) → auto-ekskluder med
 *     'auto_excluded_scan_pending' (ikke lenger HALLS_NOT_READY-blokk)
 *   - 🔴 Rød hall (0 spillere) → auto-ekskluder med
 *     'auto_excluded_red_no_players' (ikke lenger RED_HALLS_NOT_CONFIRMED)
 *   - Blanding av grønne + ikke-grønne → start går gjennom (ikke-grønne
 *     auto-ekskluderes)
 *
 * 2026-05-10 (ADR-0021):
 *   - 🔴 Master-hall rød (0 spillere) → start TILLATES (ikke lenger
 *     `MASTER_HALL_RED`-blokk). Master-hallen deltar alltid med 0 spillere
 *     uten å bli ekskludert. Bingoverten har full kontroll.
 *   - Master-hall ikke "Klar"-huket → fortsatt `HALLS_NOT_READY` (separat
 *     sjekk fra kapasitet, gjelder ready-flag-knappen).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../errors/DomainError.js";
import {
  Game1MasterControlService,
  type MasterActor,
} from "./Game1MasterControlService.js";

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
  const queries: RecordedQuery[] = [];
  const activeResponses = responses.slice();

  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < activeResponses.length; i++) {
      const r = activeResponses[i]!;
      if (r.match(sql)) {
        activeResponses.splice(i, 1);
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

function gameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "purchase_open",
    master_hall_id: "hall-master",
    group_hall_id: "grp-1",
    participating_halls_json: ["hall-master", "hall-2", "hall-3"],
    actual_start_time: null,
    actual_end_time: null,
    ...overrides,
  };
}

const masterActor: MasterActor = {
  userId: "user-master",
  hallId: "hall-master",
  role: "AGENT",
};

// Green hall default: ready + players + final-scan done
function greenRow(hallId: string): unknown {
  return {
    hall_id: hallId,
    is_ready: true,
    excluded_from_game: false,
    digital_tickets_sold: 2,
    physical_tickets_sold: 5,
    start_ticket_id: "100",
    final_scan_ticket_id: "105",
  };
}

function redRow(hallId: string): unknown {
  return {
    hall_id: hallId,
    is_ready: false,
    excluded_from_game: false,
    digital_tickets_sold: 0,
    physical_tickets_sold: 0,
    start_ticket_id: null,
    final_scan_ticket_id: null,
  };
}

function orangeRow(hallId: string): unknown {
  // Spillere finnes, men slutt-scan mangler.
  return {
    hall_id: hallId,
    is_ready: false,
    excluded_from_game: false,
    digital_tickets_sold: 0,
    physical_tickets_sold: 5,
    start_ticket_id: "100",
    final_scan_ticket_id: null,
  };
}

// ── 🟠 Oransje hall auto-ekskluderes (Tobias 2026-05-08) ────────────────────

test("startGame auto-ekskluderer 🟠 oransje hall (manglende slutt-scan)", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        // Oransje: is_ready=false + spillere finnes (slutt-scan mangler).
        // I dette setupet behandler unreadyHalls-filteren den som unready
        // (is_ready=false). Det viktige er at start ikke blokkerer.
        orangeRow("hall-3"),
      ],
    },
    // UPSERT auto-exclusion av hall-3
    {
      match: (s) =>
        s.includes("INSERT INTO") &&
        s.includes("app_game1_hall_ready_status"),
      rows: [],
    },
    // Override-audit
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    // Post-exclusion snapshot
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        { ...(orangeRow("hall-3") as Record<string, unknown>), excluded_from_game: true },
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-04-24T10:00:00.000Z",
        }),
      ],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");

  // Verifiser at hall-3 ble auto-ekskludert (uansett kategori — orange-not-ready
  // eller scan-pending er begge gyldige reasons her).
  const upsert = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("app_game1_hall_ready_status") &&
      Array.isArray(q.params) &&
      q.params[1] === "hall-3"
  );
  assert.ok(upsert, "auto-exclusion av oransje hall-3 forventet");
});

// ── 🔴 Rød hall uten bekreftelse → auto-ekskluder (Tobias 2026-05-08) ──────

test("startGame auto-ekskluderer 🔴 rød hall uten confirmExcludeRedHalls", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        redRow("hall-3"),
      ],
    },
    // UPSERT auto-exclusion av rød hall-3
    {
      match: (s) =>
        s.includes("INSERT INTO") &&
        s.includes("app_game1_hall_ready_status"),
      rows: [],
    },
    // Override-audit
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    // Post-exclusion snapshot
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        { ...(redRow("hall-3") as Record<string, unknown>), excluded_from_game: true },
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-04-24T10:00:00.000Z",
        }),
      ],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");

  // Verifiser at hall-3 ble auto-ekskludert med 'auto_excluded_red_no_players'.
  const upsert = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("app_game1_hall_ready_status") &&
      Array.isArray(q.params) &&
      q.params[1] === "hall-3" &&
      q.params[2] === "auto_excluded_red_no_players"
  );
  assert.ok(upsert, "auto-exclusion av rød hall-3 med 'auto_excluded_red_no_players'");
});

// ── 🔴 Rød hall MED bekreftelse → OK + ekskludering ─────────────────────────

test("startGame med confirmExcludeRedHalls setter excluded_from_game=true", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        redRow("hall-3"),
      ],
    },
    // UPSERT red hall to excluded — reason er nå parameterisert ($3) i ny
    // 2026-05-08-flyt, så vi matcher på SQL-fragment uten literal.
    {
      match: (s) =>
        s.includes("INSERT INTO") &&
        s.includes("app_game1_hall_ready_status"),
      rows: [],
    },
    // Override-audit (auto-exclusion event)
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    // Post-exclusion snapshot
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        { ...(redRow("hall-3") as Record<string, unknown>), excluded_from_game: true },
      ],
    },
    // UPDATE to running
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-04-24T10:00:00.000Z",
        }),
      ],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({
    gameId: "g1",
    actor: masterActor,
    confirmExcludeRedHalls: ["hall-3"],
  });
  assert.equal(result.status, "running");

  // Verifiser at hall-3 ble auto-ekskludert med 'auto_excluded_red_no_players'
  // som parameter (ikke literal i SQL).
  const autoExcludeQuery = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("app_game1_hall_ready_status") &&
      Array.isArray(q.params) &&
      q.params[1] === "hall-3" &&
      q.params[2] === "auto_excluded_red_no_players"
  );
  assert.ok(autoExcludeQuery, "skal ha utført auto-exclude UPSERT med rett reason");

  // Audit skal logge autoExcludedRedHalls i metadata.
  const startAudit = queries.find(
    (q) =>
      q.sql.includes("master_audit") &&
      q.sql.includes("INSERT") &&
      Array.isArray(q.params) &&
      q.params[2] === "start"
  );
  assert.ok(startAudit);
  const metadata = JSON.parse(String(startAudit!.params[7]));
  assert.deepEqual(metadata.autoExcludedRedHalls, ["hall-3"]);
  assert.deepEqual(metadata.noPlayersHalls, ["hall-3"]);
});

// ── Master-hall rød (0 spillere) men "Klar" → start TILLATES (ADR-0021) ────

test("startGame: master-hall rød (0 spillere) MED is_ready=true → OK (ADR-0021)", async () => {
  // Master-hall er rød (0 spillere) men er huket "Klar". Etter ADR-0021
  // skal start TILLATES uten `MASTER_HALL_RED`-blokk. Master deltar i
  // runden med 0 spillere — auto-eksklusjons-loopen skipper master-hallen.
  const masterRedButReady = {
    hall_id: "hall-master",
    is_ready: true,
    excluded_from_game: false,
    digital_tickets_sold: 0,
    physical_tickets_sold: 0,
    start_ticket_id: null,
    final_scan_ticket_id: null,
  };
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    // Pre-auto-exclusion snapshot.
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [masterRedButReady, greenRow("hall-2"), greenRow("hall-3")],
    },
    // Post-auto-exclusion snapshot (ingen endring — master ikke ekskludert,
    // ingen andre haller å auto-ekskludere siden hall-2/hall-3 er grønne).
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [masterRedButReady, greenRow("hall-2"), greenRow("hall-3")],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-04-24T10:00:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");

  // Verifiser at master-hallen IKKE ble auto-ekskludert (selv om rød).
  const masterExcludedQuery = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("app_game1_hall_ready_status") &&
      Array.isArray(q.params) &&
      q.params[1] === "hall-master"
  );
  assert.equal(
    masterExcludedQuery,
    undefined,
    "master-hallen skal ALDRI ekskluderes (ADR-0021)"
  );
});

// ── Alle grønne → happy path uten confirm ───────────────────────────────────

test("startGame alle 🟢 grønne → OK uten confirmExcludeRedHalls", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        greenRow("hall-master"),
        greenRow("hall-2"),
        greenRow("hall-3"),
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-04-24T10:00:00.000Z",
        }),
      ],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
});
