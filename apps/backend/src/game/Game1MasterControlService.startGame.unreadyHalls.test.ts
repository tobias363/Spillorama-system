/**
 * Task 1.5 — "agents not ready"-popup + override.
 *
 * Unit-tester for `Game1MasterControlService.startGame` med ny
 * `confirmUnreadyHalls`-parameter + audit-entry `start_game_with_unready_override`.
 *
 * Matcher stub-pool-mønsteret i `Game1MasterControlService.test.ts` — testene
 * simulerer SQL-fragment-matching og verifiserer at serviceen:
 *   1. Kaster `HALLS_NOT_READY` med `details.unreadyHalls` når orange haller
 *      ikke er dekket av `confirmUnreadyHalls`.
 *   2. Godtar start når override dekker samtlige ikke-klare haller og
 *      skriver override-audit i tillegg til normal `start`-audit.
 *   3. Bevarer eksisterende rød-auto-exclude-mønster (`confirmExcludedHalls`
 *      blir kombinert med implisitt excluded via override).
 *
 * Pre-cond: `purchase_open` status. Tester dekker IKKE Resume-flyt — den
 * bruker ingen ready-sjekk per design (per-hall ready gjelder bare ved
 * initial start).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
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
  /** Hvis satt: responsen kan brukes flere ganger (for repeat-queries). */
  reusable?: boolean;
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
        if (!r.reusable) {
          activeResponses.splice(i, 1);
        }
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

function readyRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    hall_id: "hall-2",
    is_ready: true,
    excluded_from_game: false,
    // TASK HS: defaultverdier som gjør hallen GRØNN (digital-only, ingen
    // fysisk salg → ingen scan kreves; har spillere). Tester som vil teste
    // ulike farger overrider disse.
    digital_tickets_sold: 5,
    physical_tickets_sold: 0,
    start_ticket_id: null,
    final_scan_ticket_id: null,
    ...overrides,
  };
}

const masterActor: MasterActor = {
  userId: "user-master",
  hallId: "hall-master",
  role: "AGENT",
};

// ── Happy path: alle grønn → OK, ingen override ──────────────────────────

test("startGame: alle haller klare → OK (ingen HALLS_NOT_READY)", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
      reusable: true,
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running", actual_start_time: "2026-04-24T10:00:00Z" })],
    },
    { match: (s) => s.includes("master_audit") && s.includes("INSERT"), rows: [], reusable: true },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
  // Sjekk at det IKKE ble skrevet override-audit.
  const overrideAudit = queries.find(
    (q) =>
      q.sql.includes("master_audit") &&
      q.sql.includes("INSERT") &&
      Array.isArray(q.params) &&
      q.params[2] === "start_game_with_unready_override"
  );
  assert.equal(overrideAudit, undefined);
});

// ── 1 orange → HALLS_NOT_READY med details.unreadyHalls ──────────────────

test("startGame: 1 orange hall (ikke-klar) → HALLS_NOT_READY med unreadyHalls-liste", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: false }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => {
      if (!(err instanceof DomainError)) return false;
      if (err.code !== "HALLS_NOT_READY") return false;
      const details = err.details;
      if (!details || !Array.isArray(details.unreadyHalls)) return false;
      assert.deepEqual(details.unreadyHalls, ["hall-2"]);
      return true;
    }
  );
});

// ── 1 orange + confirmUnreadyHalls dekker → OK + override-audit ─────────

test("startGame: confirmUnreadyHalls dekker orange-listen → OK + audit", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    // Første loadReadySnapshot (pre-override).
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: false }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    // UPSERT for override-exclude av hall-2.
    { match: (s) => s.includes("INSERT INTO") && s.includes("hall_ready_status"), rows: [] },
    // Override-audit (action=start_game_with_unready_override).
    { match: (s) => s.includes("master_audit") && s.includes("INSERT"), rows: [] },
    // Andre loadReadySnapshot ETTER override (hall-2 nå excluded).
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: false, excluded_from_game: true }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    // Status-flip til running.
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running", actual_start_time: "2026-04-24T10:00:00Z" })],
    },
    // Normal start-audit.
    { match: (s) => s.includes("master_audit") && s.includes("INSERT"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({
    gameId: "g1",
    actor: masterActor,
    confirmUnreadyHalls: ["hall-2"],
  });
  assert.equal(result.status, "running");

  // Verifiser override-audit ble skrevet.
  const overrideAudit = queries.find(
    (q) =>
      q.sql.includes("master_audit") &&
      q.sql.includes("INSERT") &&
      Array.isArray(q.params) &&
      q.params[2] === "start_game_with_unready_override"
  );
  assert.ok(overrideAudit, "override-audit forventet");

  // Verifiser exclude-UPSERT for hall-2.
  const excludeUpsert = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("hall_ready_status") &&
      Array.isArray(q.params) &&
      q.params[1] === "hall-2" &&
      q.params[2] === "unready_override"
  );
  assert.ok(excludeUpsert, "UPSERT excluded_from_game=true for hall-2 forventet");

  // Verifiser at normal start-audit også skjedde.
  const startAudit = queries.find(
    (q) =>
      q.sql.includes("master_audit") &&
      q.sql.includes("INSERT") &&
      Array.isArray(q.params) &&
      q.params[2] === "start"
  );
  assert.ok(startAudit, "normal start-audit forventet etter override");
});

// ── 1 orange + confirmUnreadyHalls dekker ikke → HALLS_NOT_READY ─────────

test("startGame: confirmUnreadyHalls dekker IKKE alle orange → HALLS_NOT_READY", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: false }),
        readyRow({ hall_id: "hall-3", is_ready: false }),
      ],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({
      gameId: "g1",
      actor: masterActor,
      confirmUnreadyHalls: ["hall-2"], // kun delvis dekning
    }),
    (err: unknown) => {
      if (!(err instanceof DomainError)) return false;
      if (err.code !== "HALLS_NOT_READY") return false;
      const details = err.details;
      if (!details || !Array.isArray(details.unreadyHalls)) return false;
      // Forventer at kun hall-3 er "uncovered" (hall-2 er confirmed).
      assert.deepEqual(details.unreadyHalls, ["hall-3"]);
      return true;
    }
  );
});

// ── 1 rød + confirmExcludedHalls dekker → OK ──────────────────────────────

test("startGame: confirmExcludedHalls dekker eksplisitt-ekskludert hall → OK", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    // Alle klare (non-excluded) + hall-3 er ekskludert.
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: false, excluded_from_game: true }),
      ],
      reusable: true,
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running", actual_start_time: "2026-04-24T10:00:00Z" })],
    },
    { match: (s) => s.includes("master_audit") && s.includes("INSERT"), rows: [], reusable: true },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({
    gameId: "g1",
    actor: masterActor,
    confirmExcludedHalls: ["hall-3"],
  });
  assert.equal(result.status, "running");
});

// ── Master-hall ikke klar → HALLS_NOT_READY (selv med override) ──────────

test("startGame: master-hall orange → HALLS_NOT_READY uansett confirmUnreadyHalls", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: false }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({
      gameId: "g1",
      actor: masterActor,
      confirmUnreadyHalls: ["hall-master"], // override skal IKKE dekke master-hall
    }),
    (err: unknown) => {
      if (!(err instanceof DomainError)) return false;
      if (err.code !== "HALLS_NOT_READY") return false;
      const details = err.details;
      if (!details || !Array.isArray(details.unreadyHalls)) return false;
      assert.deepEqual(details.unreadyHalls, ["hall-master"]);
      return true;
    }
  );
});

// ── ready_to_start-status → ingen ready-sjekk (eksisterende adferd) ───────

test("startGame: ready_to_start-status hopper over ready-sjekk (scheduler har allerede validert)", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: false }), // ikke klar!
      ],
      reusable: true,
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running", actual_start_time: "2026-04-24T10:00:00Z" })],
    },
    { match: (s) => s.includes("master_audit") && s.includes("INSERT"), rows: [], reusable: true },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  // ready_to_start-status er scheduler-validert — startGame skal ikke re-
  // sjekke ready-flag her (eksisterende adferd bevares).
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
  const queryCount = queries.length;
  assert.ok(queryCount > 0);
});
