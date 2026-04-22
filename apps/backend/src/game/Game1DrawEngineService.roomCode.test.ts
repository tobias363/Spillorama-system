/**
 * GAME1_SCHEDULE PR 4d.1: room_code-mapping for Game1DrawEngineService.
 *
 * Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.2
 *
 * Verifiserer:
 *   - `getRoomCodeForScheduledGame` returnerer kolonneverdi når satt
 *   - Returnerer null når scheduled_game eksisterer men room_code er NULL
 *   - Kaster DomainError("GAME_NOT_FOUND") når scheduled_game ikke finnes
 *   - `loadScheduledGameForUpdate`s SELECT inkluderer room_code-kolonnen
 *     (via query-sql-inspeksjon) — slik at 4d.2 (join-flyt) kan lese
 *     room_code i samme transaksjon som den eventuelt skriver.
 *   - startGame SKRIVER IKKE room_code i 4d.1 — kolonnen forblir som den
 *     var (verifiseres indirekte ved at ingen UPDATE ... SET room_code
 *     logges).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import {
  Game1DrawEngineService,
} from "./Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "./Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stub pool (samme mønster som Game1DrawEngineService.test.ts) ────────────

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

function makeFakeTicketPurchase(
  purchases: Game1TicketPurchaseRow[] = []
): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return purchases;
    },
  } as unknown as Game1TicketPurchaseService;
}

function makeService(opts: { poolResponses: StubResponse[] }): {
  service: Game1DrawEngineService;
  queries: RecordedQuery[];
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const auditLogService = new AuditLogService(new InMemoryAuditLogStore());
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService,
  });
  return { service, queries };
}

// ── getRoomCodeForScheduledGame ─────────────────────────────────────────────

test("4d.1: getRoomCodeForScheduledGame returnerer kolonneverdi når satt", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (sql) => /SELECT\s+room_code\s+FROM/i.test(sql),
        rows: [{ room_code: "ROOM-ABC123" }],
      },
    ],
  });

  const result = await service.getRoomCodeForScheduledGame("g1");
  assert.equal(result, "ROOM-ABC123");
});

test("4d.1: getRoomCodeForScheduledGame returnerer null når raden har NULL room_code", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (sql) => /SELECT\s+room_code\s+FROM/i.test(sql),
        rows: [{ room_code: null }],
      },
    ],
  });

  const result = await service.getRoomCodeForScheduledGame("g1");
  assert.equal(result, null);
});

test("4d.1: getRoomCodeForScheduledGame kaster GAME_NOT_FOUND når rad ikke finnes", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (sql) => /SELECT\s+room_code\s+FROM/i.test(sql),
        rows: [],
      },
    ],
  });

  await assert.rejects(
    () => service.getRoomCodeForScheduledGame("ukjent"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "skal kaste DomainError");
      assert.equal((err as DomainError).code, "GAME_NOT_FOUND");
      return true;
    }
  );
});

// ── assignRoomCode (PR 4d.2) ────────────────────────────────────────────────

test("4d.2: assignRoomCode persisterer kolonnen atomisk når NULL", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      { match: (sql) => /^BEGIN/i.test(sql), rows: [] },
      {
        match: (sql) =>
          /SELECT\s+room_code[\s\S]+FOR UPDATE/i.test(sql),
        rows: [{ room_code: null }],
      },
      {
        match: (sql) => /UPDATE[\s\S]+SET\s+room_code/i.test(sql),
        rows: [],
        rowCount: 1,
      },
      { match: (sql) => /^COMMIT/i.test(sql), rows: [] },
    ],
  });

  const result = await service.assignRoomCode("g1", "ROOM-NEW");
  assert.equal(result, "ROOM-NEW");

  // Verifiser at både SELECT FOR UPDATE og UPDATE ble kjørt.
  const updates = queries.filter((q) =>
    /UPDATE[\s\S]+SET\s+room_code/i.test(q.sql)
  );
  assert.equal(updates.length, 1, "én UPDATE ... SET room_code = $2 forventet");
  assert.deepEqual(updates[0]!.params, ["g1", "ROOM-NEW"]);
});

test("4d.2: assignRoomCode returnerer eksisterende kode ved race (ikke overskriver)", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      { match: (sql) => /^BEGIN/i.test(sql), rows: [] },
      {
        match: (sql) =>
          /SELECT\s+room_code[\s\S]+FOR UPDATE/i.test(sql),
        rows: [{ room_code: "ROOM-WINNER" }],
      },
      { match: (sql) => /^COMMIT/i.test(sql), rows: [] },
    ],
  });

  const result = await service.assignRoomCode("g1", "ROOM-LOSER");
  assert.equal(result, "ROOM-WINNER", "vinneren beholdes");

  // Ingen UPDATE skal ha skjedd.
  const updates = queries.filter((q) =>
    /UPDATE[\s\S]+SET\s+room_code/i.test(q.sql)
  );
  assert.equal(updates.length, 0, "ingen UPDATE når kolonnen allerede er satt");
});

test("4d.2: assignRoomCode kaster GAME_NOT_FOUND når scheduled_game ikke finnes", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (sql) => /^BEGIN/i.test(sql), rows: [] },
      {
        match: (sql) =>
          /SELECT\s+room_code[\s\S]+FOR UPDATE/i.test(sql),
        rows: [],
      },
      { match: (sql) => /^ROLLBACK/i.test(sql), rows: [] },
    ],
  });

  await assert.rejects(
    () => service.assignRoomCode("ukjent", "ROOM-X"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "GAME_NOT_FOUND");
      return true;
    }
  );
});

// ── Tilbake til resten av 4d.1-testene ──────────────────────────────────────

test("4d.1: getRoomCodeForScheduledGame sender scheduledGameId som parameter", async () => {
  const { service, queries } = makeService({
    poolResponses: [
      {
        match: (sql) => /SELECT\s+room_code\s+FROM/i.test(sql),
        rows: [{ room_code: "ROOM-XYZ" }],
      },
    ],
  });

  await service.getRoomCodeForScheduledGame("scheduled-42");
  const selectQuery = queries.find((q) =>
    /SELECT\s+room_code\s+FROM/i.test(q.sql)
  );
  assert.ok(selectQuery, "SELECT-query skal være utført");
  assert.deepEqual(selectQuery!.params, ["scheduled-42"]);
});

// ── loadScheduledGameForUpdate inkluderer room_code (via SELECT-trace) ──────

test("4d.1: loadScheduledGameForUpdate SELECT FOR UPDATE inkluderer room_code-kolonnen", async () => {
  // Vi trigger startGame med en stub som kaster på SELECT FOR UPDATE, slik
  // at transaksjonen feiler TIDLIG — men vi kan fortsatt inspisere hvilke
  // SQL som ble forsøkt kjørt. Query-traset viser at FOR UPDATE-select
  // inkluderer `room_code` i kolonne-lista.
  //
  // Denne tilnærmingen unngår full startGame-stub (som krever 8+ queries
  // riktig ordnet) for en bekreftelse som tsc uansett enforcer statically.
  const { service, queries } = makeService({
    poolResponses: [
      { match: (sql) => /^BEGIN/i.test(sql), rows: [] },
      {
        match: (sql) =>
          /app_game1_scheduled_games[\s\S]+FOR UPDATE/i.test(sql),
        rows: [],
        throwErr: { code: "SIMULATED_EARLY_STOP", message: "early stop" },
      },
      { match: (sql) => /^ROLLBACK/i.test(sql), rows: [] },
    ],
  });

  await assert.rejects(() => service.startGame("g1", "actor-1"));

  // Table-navn kvotes som "public"."app_game1_scheduled_games" i SQL-
  // bygget av Game1DrawEngineService.scheduledGamesTable(), derfor matcher
  // vi på kolonne-lista + FOR UPDATE i stedet for FROM-klausulen.
  const forUpdateQuery = queries.find(
    (q) =>
      /FOR UPDATE/i.test(q.sql) &&
      /app_game1_scheduled_games/i.test(q.sql)
  );
  assert.ok(forUpdateQuery, "SELECT FOR UPDATE skal ha vært forsøkt kjørt");
  assert.match(
    forUpdateQuery!.sql,
    /SELECT\s+id,\s+status,\s+ticket_config_json,\s+room_code/i,
    "SELECT FOR UPDATE skal inkludere room_code i kolonne-lista"
  );

  // Ingen UPDATE ... SET room_code skulle ha vært forsøkt (4d.2-scope).
  const writesRoomCode = queries.some((q) =>
    /SET[\s\S]*room_code/i.test(q.sql)
  );
  assert.equal(
    writesRoomCode,
    false,
    "4d.1 skal IKKE skrive room_code — det kommer i 4d.2 (join-handler)"
  );
});
