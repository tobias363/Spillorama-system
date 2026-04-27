/**
 * BIN-623: unit-tester for CloseDayService validering + DB-interaksjoner.
 *
 * Validation-testene bruker samme Object.create-pattern som
 * HallGroupService/DailyScheduleService: pool-queryen kaster hvis den treffes,
 * slik at vi verifiserer at validering skjer før DB-tur.
 *
 * DB-interaksjons-testene stub'er et Pool-objekt og verifiserer at:
 *   - summary henter eksisterende close-day-rad og returnerer alreadyClosed=true
 *   - close avviser dobbel-lukking (INSERT 23505 → CLOSE_DAY_ALREADY_CLOSED)
 *   - close skriver INSERT med riktig parametre
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CloseDayService } from "./CloseDayService.js";
import { DomainError } from "../game/BingoEngine.js";
import type { GameManagementService, GameManagement } from "./GameManagementService.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

interface StubPool {
  query: QueryFn;
  connect: () => Promise<unknown>;
}

function throwingPool(): StubPool {
  return {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
}

function makeGame(overrides: Partial<GameManagement> = {}): GameManagement {
  return {
    id: overrides.id ?? "gm-1",
    gameTypeId: overrides.gameTypeId ?? "gt-1",
    parentId: overrides.parentId ?? null,
    name: overrides.name ?? "Test Game",
    ticketType: overrides.ticketType ?? "Large",
    ticketPrice: overrides.ticketPrice ?? 1000,
    startDate: overrides.startDate ?? "2026-04-20T10:00:00Z",
    endDate: overrides.endDate ?? null,
    status: overrides.status ?? "running",
    totalSold: overrides.totalSold ?? 42,
    totalEarning: overrides.totalEarning ?? 42000,
    config: overrides.config ?? {},
    repeatedFromId: overrides.repeatedFromId ?? null,
    createdBy: overrides.createdBy ?? "admin-1",
    createdAt: overrides.createdAt ?? "2026-04-01T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-01T10:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

function stubGameManagementService(
  games: Record<string, GameManagement | Error>
): GameManagementService {
  return {
    async get(id: string): Promise<GameManagement> {
      const g = games[id];
      if (!g) throw new DomainError("GAME_MANAGEMENT_NOT_FOUND", "not found");
      if (g instanceof Error) throw g;
      return g;
    },
  } as unknown as GameManagementService;
}

function makeService(
  pool: StubPool,
  gameManagementService: GameManagementService
): CloseDayService {
  return CloseDayService.forTesting(
    pool as unknown as Parameters<typeof CloseDayService.forTesting>[0],
    gameManagementService
  );
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError(${expectedCode}) men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
  }
}

// ── Validering (pre-pool) ─────────────────────────────────────────────────

test("BIN-623 service: summary() avviser tom gameId", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({}));
  await expectDomainError(
    "empty gameId",
    () => svc.summary("", "2026-04-20"),
    "INVALID_INPUT"
  );
});

test("BIN-623 service: summary() avviser ugyldig closeDate-format", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({}));
  await expectDomainError(
    "bad date format",
    () => svc.summary("gm-1", "20-04-2026"),
    "INVALID_INPUT"
  );
});

test("BIN-623 service: summary() avviser tom closeDate", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({}));
  await expectDomainError(
    "empty closeDate",
    () => svc.summary("gm-1", ""),
    "INVALID_INPUT"
  );
});

test("BIN-623 service: close() avviser ugyldig closeDate (ikke-eksisterende dato)", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({}));
  await expectDomainError(
    "invalid calendar date",
    () =>
      svc.close({
        gameManagementId: "gm-1",
        closeDate: "abcd-ef-gh",
        closedBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-623 service: close() avviser tom closedBy", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({}));
  await expectDomainError(
    "empty closedBy",
    () =>
      svc.close({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        closedBy: "   ",
      }),
    "INVALID_INPUT"
  );
});

// ── summary() DB-interaksjoner ────────────────────────────────────────────

test("BIN-623 service: summary() uten eksisterende rad returnerer live-snapshot + alreadyClosed=false", async () => {
  const pool: StubPool = {
    query: async (_sql, _params) => ({ rows: [] }),
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  const game = makeGame({ totalSold: 15, totalEarning: 15000 });
  const svc = makeService(pool, stubGameManagementService({ "gm-1": game }));
  const summary = await svc.summary("gm-1", "2026-04-20");
  assert.equal(summary.alreadyClosed, false);
  assert.equal(summary.closedAt, null);
  assert.equal(summary.closedBy, null);
  assert.equal(summary.totalSold, 15);
  assert.equal(summary.totalEarning, 15000);
  assert.equal(summary.ticketsSold, 15);
  assert.equal(summary.winnersCount, 0);
  assert.equal(summary.payoutsTotal, 0);
  assert.equal(summary.jackpotsTotal, 0);
  assert.equal(summary.closeDate, "2026-04-20");
  assert.equal(summary.gameManagementId, "gm-1");
});

test("BIN-623 service: summary() med eksisterende rad returnerer alreadyClosed=true + frozen snapshot", async () => {
  const pool: StubPool = {
    query: async (_sql, _params) => ({
      rows: [
        {
          id: "cd-1",
          game_management_id: "gm-1",
          close_date: "2026-04-20",
          closed_by: "admin-1",
          summary_json: {
            totalSold: 10,
            totalEarning: 10000,
            ticketsSold: 10,
            winnersCount: 3,
            payoutsTotal: 2500,
            jackpotsTotal: 0,
            capturedAt: "2026-04-20T23:59:59.000Z",
          },
          closed_at: "2026-04-20T23:59:59.000Z",
        },
      ],
    }),
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  // Live-tall har drevet videre etter lukking — summary skal IKKE reflektere
  // live-tall, men frosne snapshot-tall fra loggen.
  const game = makeGame({ totalSold: 99, totalEarning: 99000 });
  const svc = makeService(pool, stubGameManagementService({ "gm-1": game }));
  const summary = await svc.summary("gm-1", "2026-04-20");
  assert.equal(summary.alreadyClosed, true);
  assert.equal(summary.closedBy, "admin-1");
  assert.equal(summary.closedAt, "2026-04-20T23:59:59.000Z");
  assert.equal(summary.totalSold, 10, "frosne tall fra snapshot — ikke live 99");
  assert.equal(summary.winnersCount, 3);
  assert.equal(summary.payoutsTotal, 2500);
});

test("BIN-623 service: summary() kaster GAME_MANAGEMENT_NOT_FOUND hvis spillet ikke finnes", async () => {
  const pool: StubPool = {
    query: async () => ({ rows: [] }),
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  const svc = makeService(pool, stubGameManagementService({}));
  await expectDomainError(
    "missing game",
    () => svc.summary("gm-missing", "2026-04-20"),
    "GAME_MANAGEMENT_NOT_FOUND"
  );
});

// ── close() DB-interaksjoner ──────────────────────────────────────────────

test("BIN-623 service: close() insert-happy-path returnerer CloseDayEntry", async () => {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT")) {
        return { rows: [] }; // findExisting → ingen tidligere lukking
      }
      if (sql.includes("INSERT")) {
        return {
          rows: [
            {
              id: "cd-new",
              game_management_id: "gm-1",
              close_date: "2026-04-20",
              closed_by: "admin-1",
              summary_json: {
                totalSold: 42,
                totalEarning: 42000,
                ticketsSold: 42,
                winnersCount: 0,
                payoutsTotal: 0,
                jackpotsTotal: 0,
                capturedAt: "2026-04-20T12:00:00.000Z",
              },
              closed_at: "2026-04-20T12:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  const game = makeGame({ totalSold: 42, totalEarning: 42000 });
  const svc = makeService(pool, stubGameManagementService({ "gm-1": game }));
  const entry = await svc.close({
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    closedBy: "admin-1",
  });
  assert.equal(entry.id, "cd-new");
  assert.equal(entry.gameManagementId, "gm-1");
  assert.equal(entry.closeDate, "2026-04-20");
  assert.equal(entry.closedBy, "admin-1");
  assert.equal(entry.summary.alreadyClosed, true); // (etter map)
  assert.equal(entry.summary.totalSold, 42);
  // Verifiser at vi først sjekket for duplikat, deretter INSERT'et.
  assert.equal(queries.length, 2);
  assert.ok(queries[0]!.sql.includes("SELECT"));
  assert.ok(queries[1]!.sql.includes("INSERT"));
});

test("BIN-623 service: close() avviser dobbel-lukking (pre-check)", async () => {
  const pool: StubPool = {
    query: async (_sql) => ({
      rows: [
        {
          id: "cd-1",
          game_management_id: "gm-1",
          close_date: "2026-04-20",
          closed_by: "admin-1",
          summary_json: {},
          closed_at: "2026-04-20T23:59:59.000Z",
        },
      ],
    }),
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  const game = makeGame();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": game }));
  await expectDomainError(
    "double-close",
    () =>
      svc.close({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        closedBy: "admin-1",
      }),
    "CLOSE_DAY_ALREADY_CLOSED"
  );
});

test("BIN-623 service: close() mapper pg 23505 unique-violation til CLOSE_DAY_ALREADY_CLOSED", async () => {
  // Simuler race-condition: pre-check passerer, men INSERT feiler med 23505.
  let called = 0;
  const pool: StubPool = {
    query: async (sql) => {
      called += 1;
      if (sql.includes("SELECT")) return { rows: [] };
      if (sql.includes("INSERT")) {
        const err = new Error("duplicate") as Error & { code?: string };
        err.code = "23505";
        throw err;
      }
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  const game = makeGame();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": game }));
  await expectDomainError(
    "race-condition unique",
    () =>
      svc.close({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        closedBy: "admin-1",
      }),
    "CLOSE_DAY_ALREADY_CLOSED"
  );
  assert.equal(called, 2, "både SELECT og INSERT ble kalt");
});

test("BIN-623 service: close() avviser lukking av slettet spill", async () => {
  const pool: StubPool = {
    query: async () => {
      throw new Error("pool should not be hit");
    },
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  const deleted = makeGame({ deletedAt: "2026-04-19T00:00:00Z" });
  const svc = makeService(pool, stubGameManagementService({ "gm-1": deleted }));
  await expectDomainError(
    "deleted game",
    () =>
      svc.close({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        closedBy: "admin-1",
      }),
    "GAME_MANAGEMENT_DELETED"
  );
});

// ── BIN-700: closeMany — Single / Consecutive / Random ──────────────────

/**
 * In-memory close-day-store som etterligner DB-tabellen for SELECT-bulk +
 * INSERT-stier i `closeMany`. Brukes av flertallet av de nye testene.
 */
interface StoredRow {
  id: string;
  game_management_id: string;
  close_date: string;
  closed_by: string | null;
  summary_json: Record<string, unknown>;
  closed_at: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  recurring_pattern_id: string | null;
}

/** REQ-116: in-memory rad for recurring-patterns. */
interface StoredPatternRow {
  id: string;
  game_management_id: string;
  pattern_json: Record<string, unknown>;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

function makeStorePool(initial: StoredRow[] = []): {
  pool: StubPool;
  rows: StoredRow[];
  patterns: StoredPatternRow[];
  insertSqls: string[];
} {
  const rows: StoredRow[] = [...initial];
  const patterns: StoredPatternRow[] = [];
  const insertSqls: string[] = [];
  let counter = rows.length;
  const pool: StubPool = {
    query: async (sql, params) => {
      const args = (params ?? []) as unknown[];

      // ── REQ-116: app_close_day_recurring_patterns ───────────────────
      if (sql.includes("app_close_day_recurring_patterns")) {
        if (sql.includes("INSERT")) {
          insertSqls.push(sql);
          const [
            id,
            gameId,
            patternJson,
            startDate,
            endDate,
            maxOccurrences,
            startTime,
            endTime,
            notes,
            createdBy,
          ] = args as [
            string,
            string,
            string,
            string,
            string | null,
            number | null,
            string | null,
            string | null,
            string | null,
            string,
          ];
          counter += 1;
          const row: StoredPatternRow = {
            id,
            game_management_id: gameId,
            pattern_json: JSON.parse(patternJson) as Record<string, unknown>,
            start_date: startDate,
            end_date: endDate,
            max_occurrences: maxOccurrences,
            start_time: startTime,
            end_time: endTime,
            notes,
            created_by: createdBy,
            created_at: `2026-04-20T12:00:00.${String(counter).padStart(3, "0")}Z`,
            deleted_at: null,
            deleted_by: null,
          };
          patterns.push(row);
          return { rows: [row] };
        }
        if (sql.includes("UPDATE")) {
          // soft-delete via UPDATE deleted_at + deleted_by
          const [patternId, gameId, deletedBy] = args as [string, string, string];
          const target = patterns.find(
            (p) => p.id === patternId && p.game_management_id === gameId
          );
          if (!target) return { rows: [] };
          if (target.deleted_at === null) {
            target.deleted_at = `2026-04-21T08:00:00.${String(counter).padStart(3, "0")}Z`;
            target.deleted_by = deletedBy;
          }
          return { rows: [{ ...target }] };
        }
        // SELECT WHERE deleted_at IS NULL
        if (sql.includes("SELECT")) {
          const gameId = String(args[0]);
          const out = patterns.filter(
            (p) => p.game_management_id === gameId && p.deleted_at === null
          );
          return { rows: out };
        }
        return { rows: [] };
      }

      // ── REQ-116: bulk DELETE FROM app_close_day_log by recurring_pattern_id ──
      if (
        sql.includes("DELETE FROM") &&
        sql.includes("recurring_pattern_id = $2")
      ) {
        const gameId = String(args[0]);
        const patternId = String(args[1]);
        let removed = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const r = rows[i]!;
          if (
            r.game_management_id === gameId &&
            r.recurring_pattern_id === patternId
          ) {
            rows.splice(i, 1);
            removed += 1;
          }
        }
        return { rows: [], rowCount: removed } as unknown as {
          rows: unknown[];
        };
      }

      // SELECT bulk by ANY()
      if (sql.includes("= ANY(")) {
        const gameId = String(args[0]);
        const dates = args[1] as string[];
        const out = rows.filter(
          (r) => r.game_management_id === gameId && dates.includes(r.close_date)
        );
        return { rows: out };
      }
      // SELECT single by date
      if (
        sql.includes("SELECT") &&
        sql.includes("FROM") &&
        !sql.includes("ANY(")
      ) {
        const gameId = String(args[0]);
        // listForGame har bare 1 arg; SELECT-by-date har 2.
        if (args.length === 1) {
          const out = rows.filter((r) => r.game_management_id === gameId);
          return { rows: out.slice().sort((a, b) => a.close_date.localeCompare(b.close_date)) };
        }
        const date = String(args[1]);
        const out = rows.filter(
          (r) => r.game_management_id === gameId && r.close_date === date
        );
        return { rows: out.slice(0, 1) };
      }
      if (sql.includes("INSERT")) {
        insertSqls.push(sql);
        const [
          id,
          gameId,
          date,
          closedBy,
          summaryJson,
          startTime,
          endTime,
          notes,
          recurringPatternId,
        ] = args as [
          string,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
        ];
        // Idempotency: simulate UNIQUE-constraint
        const dup = rows.find(
          (r) => r.game_management_id === gameId && r.close_date === date
        );
        if (dup) {
          const e = new Error("duplicate") as Error & { code?: string };
          e.code = "23505";
          throw e;
        }
        counter += 1;
        const row: StoredRow = {
          id,
          game_management_id: gameId,
          close_date: date,
          closed_by: closedBy,
          summary_json: JSON.parse(summaryJson) as Record<string, unknown>,
          closed_at: `2026-04-20T12:00:00.${String(counter).padStart(3, "0")}Z`,
          start_time: startTime,
          end_time: endTime,
          notes,
          recurring_pattern_id: recurringPatternId ?? null,
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (sql.includes("UPDATE")) {
        const gameId = String(args[0]);
        const date = String(args[1]);
        const target = rows.find(
          (r) => r.game_management_id === gameId && r.close_date === date
        );
        if (!target) return { rows: [] };
        // Manuelt parse SET-deler — testen bryr seg om at riktige felter
        // får riktige verdier i (params[2..]).
        const setMatch = sql.match(/SET (.*?)\s+WHERE/);
        if (setMatch && setMatch[1]) {
          const cols = setMatch[1]
            .split(",")
            .map((c) => c.trim().split("=")[0]?.trim());
          for (let i = 0; i < cols.length; i += 1) {
            const col = cols[i];
            const val = args[2 + i] as string | null;
            if (col === "start_time") target.start_time = val;
            if (col === "end_time") target.end_time = val;
            if (col === "notes") target.notes = val;
          }
        }
        return { rows: [{ ...target }] };
      }
      if (sql.includes("DELETE")) {
        const gameId = String(args[0]);
        const date = String(args[1]);
        const idx = rows.findIndex(
          (r) => r.game_management_id === gameId && r.close_date === date
        );
        if (idx < 0) return { rows: [] };
        const removed = rows.splice(idx, 1)[0]!;
        return { rows: [removed] };
      }
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("unexpected");
    },
  };
  return { pool, rows, patterns, insertSqls };
}

test("BIN-700 service: closeMany single → 1 rad, createdDates har den ene datoen", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = await svc.closeMany({
    mode: "single",
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    closedBy: "admin-1",
  });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.createdDates, ["2026-04-20"]);
  assert.deepEqual(result.skippedDates, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.close_date, "2026-04-20");
  assert.equal(rows[0]!.start_time, null);
  assert.equal(rows[0]!.end_time, null);
});

test("BIN-700 service: closeMany consecutive 3 dager bruker legacy-tids-vinduer", async () => {
  // Legacy:10166-10186 — første: start→23:59, mellom: 00:00→23:59, siste: 00:00→end.
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-12-23",
    endDate: "2026-12-25",
    startTime: "18:00",
    endTime: "10:00",
    closedBy: "admin-1",
    notes: "Jul",
  });
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.createdDates, ["2026-12-23", "2026-12-24", "2026-12-25"]);
  assert.equal(rows[0]!.close_date, "2026-12-23");
  assert.equal(rows[0]!.start_time, "18:00");
  assert.equal(rows[0]!.end_time, "23:59");
  assert.equal(rows[1]!.close_date, "2026-12-24");
  assert.equal(rows[1]!.start_time, "00:00");
  assert.equal(rows[1]!.end_time, "23:59");
  assert.equal(rows[2]!.close_date, "2026-12-25");
  assert.equal(rows[2]!.start_time, "00:00");
  assert.equal(rows[2]!.end_time, "10:00");
  assert.equal(rows[0]!.notes, "Jul");
  assert.equal(rows[1]!.notes, "Jul");
  assert.equal(rows[2]!.notes, "Jul");
});

test("BIN-700 service: closeMany consecutive med startDate=endDate gir én rad og bevarer fullt {startTime,endTime}", async () => {
  // Edge case: range med bare én dag — verken første-eller-siste-regelen
  // skal kicke inn; vi skal beholde {startTime, endTime} 1:1.
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-04-20",
    endDate: "2026-04-20",
    startTime: "09:00",
    endTime: "17:00",
    closedBy: "admin-1",
  });
  assert.equal(result.entries.length, 1);
  assert.equal(rows[0]!.start_time, "09:00");
  assert.equal(rows[0]!.end_time, "17:00");
});

test("BIN-700 service: closeMany random med 3 ikke-sammenhengende datoer → 3 rader", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = await svc.closeMany({
    mode: "random",
    gameManagementId: "gm-1",
    closeDates: ["2026-12-25", "2026-04-01", "2026-05-17"],
    closedBy: "admin-1",
  });
  assert.equal(result.entries.length, 3);
  // Sortert ascending i service.
  assert.deepEqual(result.createdDates, ["2026-04-01", "2026-05-17", "2026-12-25"]);
  assert.equal(rows.length, 3);
  // Random uten startTime/endTime → null = "hele dagen"
  for (const r of rows) {
    assert.equal(r.start_time, null);
    assert.equal(r.end_time, null);
  }
});

test("BIN-700 service: closeMany random med per-dato-vinduer", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = await svc.closeMany({
    mode: "random",
    gameManagementId: "gm-1",
    closeDates: [
      { closeDate: "2026-12-25", startTime: "00:00", endTime: "12:00" },
      { closeDate: "2026-04-01", startTime: "10:00", endTime: "14:00" },
      "2026-05-17",
    ],
    startTime: "08:00",
    endTime: "20:00",
    closedBy: "admin-1",
  });
  assert.equal(result.entries.length, 3);
  // Sortert ascending: 04-01, 05-17, 12-25
  assert.equal(rows[0]!.close_date, "2026-04-01");
  assert.equal(rows[0]!.start_time, "10:00");
  assert.equal(rows[0]!.end_time, "14:00");
  assert.equal(rows[1]!.close_date, "2026-05-17");
  // Streng-form bruker default-vindu
  assert.equal(rows[1]!.start_time, "08:00");
  assert.equal(rows[1]!.end_time, "20:00");
  assert.equal(rows[2]!.close_date, "2026-12-25");
  assert.equal(rows[2]!.start_time, "00:00");
  assert.equal(rows[2]!.end_time, "12:00");
});

test("BIN-700 service: closeMany er idempotent — re-run med samme datoer gir 0 nye, alle skipped", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // Første runde: 3 nye
  const first = await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-12-23",
    endDate: "2026-12-25",
    startTime: "00:00",
    endTime: "23:59",
    closedBy: "admin-1",
  });
  assert.equal(first.createdDates.length, 3);
  assert.equal(rows.length, 3);

  // Andre runde: alle eksisterer fra før → skipped
  const second = await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-12-23",
    endDate: "2026-12-25",
    startTime: "00:00",
    endTime: "23:59",
    closedBy: "admin-2",
  });
  assert.deepEqual(second.createdDates, []);
  assert.deepEqual(second.skippedDates, ["2026-12-23", "2026-12-24", "2026-12-25"]);
  assert.equal(second.entries.length, 3, "alle entries returneres uansett");
  assert.equal(rows.length, 3, "ingen nye rader persistert");
});

test("BIN-700 service: closeMany delvis overlapp — eksisterende skipped, nye persistert", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // Forhånds-lukk én dato
  await svc.closeMany({
    mode: "single",
    gameManagementId: "gm-1",
    closeDate: "2026-12-24",
    closedBy: "admin-1",
  });
  // Nå lukk en range som overlapper
  const result = await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-12-23",
    endDate: "2026-12-25",
    startTime: "00:00",
    endTime: "23:59",
    closedBy: "admin-2",
  });
  assert.deepEqual(result.skippedDates, ["2026-12-24"]);
  assert.deepEqual(result.createdDates.sort(), ["2026-12-23", "2026-12-25"]);
  assert.equal(rows.length, 3);
});

test("BIN-700 service: closeMany consecutive avviser endDate < startDate", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "endDate < startDate",
    () =>
      svc.closeMany({
        mode: "consecutive",
        gameManagementId: "gm-1",
        startDate: "2026-04-25",
        endDate: "2026-04-20",
        startTime: "00:00",
        endTime: "23:59",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: closeMany consecutive avviser ekstrem range (>366 dager)", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "year+1 range",
    () =>
      svc.closeMany({
        mode: "consecutive",
        gameManagementId: "gm-1",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        startTime: "00:00",
        endTime: "23:59",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: closeMany random avviser tom liste", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "empty random",
    () =>
      svc.closeMany({
        mode: "random",
        gameManagementId: "gm-1",
        closeDates: [],
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: closeMany random avviser duplisert dato", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "dup random",
    () =>
      svc.closeMany({
        mode: "random",
        gameManagementId: "gm-1",
        closeDates: ["2026-04-20", "2026-04-20"],
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: closeMany random avviser ugyldig HH:MM", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "bad time",
    () =>
      svc.closeMany({
        mode: "random",
        gameManagementId: "gm-1",
        closeDates: ["2026-04-20"],
        startTime: "25:99",
        endTime: "23:59",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: closeMany consecutive uten startTime/endTime kaster", async () => {
  const svc = makeService(throwingPool(), stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "missing times",
    () =>
      svc.closeMany({
        mode: "consecutive",
        gameManagementId: "gm-1",
        startDate: "2026-04-20",
        endDate: "2026-04-22",
        startTime: "" as unknown as string,
        endTime: "" as unknown as string,
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

// ── BIN-700: per-dato updateDate ────────────────────────────────────────

test("BIN-700 service: updateDate endrer kun spesifikk dato, ikke nabodatoer", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-12-23",
    endDate: "2026-12-25",
    startTime: "00:00",
    endTime: "23:59",
    closedBy: "admin-1",
  });
  // Endre 12-24 (mellom-dag)
  const updated = await svc.updateDate({
    gameManagementId: "gm-1",
    closeDate: "2026-12-24",
    startTime: "08:00",
    endTime: "20:00",
    notes: "redusert dag",
    updatedBy: "admin-2",
  });
  assert.equal(updated.startTime, "08:00");
  assert.equal(updated.endTime, "20:00");
  assert.equal(updated.notes, "redusert dag");
  // Verifiser at de andre datoene er uendret
  const r23 = rows.find((r) => r.close_date === "2026-12-23");
  const r25 = rows.find((r) => r.close_date === "2026-12-25");
  assert.equal(r23!.start_time, "00:00");
  assert.equal(r23!.end_time, "23:59");
  assert.equal(r25!.start_time, "00:00");
  assert.equal(r25!.end_time, "23:59");
});

test("BIN-700 service: updateDate på ikke-eksisterende dato → CLOSE_DAY_NOT_FOUND", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "missing close-day",
    () =>
      svc.updateDate({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        startTime: "08:00",
        updatedBy: "admin-1",
      }),
    "CLOSE_DAY_NOT_FOUND"
  );
});

test("BIN-700 service: updateDate uten endringer kaster INVALID_INPUT", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "no changes",
    () =>
      svc.updateDate({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        updatedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: updateDate kan eksplisitt sette tids-vindu til null (=hele dagen)", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await svc.closeMany({
    mode: "single",
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    startTime: "08:00",
    endTime: "20:00",
    closedBy: "admin-1",
  });
  const updated = await svc.updateDate({
    gameManagementId: "gm-1",
    closeDate: "2026-04-20",
    startTime: null,
    endTime: null,
    updatedBy: "admin-2",
  });
  assert.equal(updated.startTime, null);
  assert.equal(updated.endTime, null);
  assert.equal(rows[0]!.start_time, null);
  assert.equal(rows[0]!.end_time, null);
});

// ── BIN-700: per-dato deleteDate ────────────────────────────────────────

test("BIN-700 service: deleteDate fjerner kun spesifikk dato fra range", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-12-23",
    endDate: "2026-12-25",
    startTime: "00:00",
    endTime: "23:59",
    closedBy: "admin-1",
  });
  assert.equal(rows.length, 3);
  const removed = await svc.deleteDate({
    gameManagementId: "gm-1",
    closeDate: "2026-12-24",
    deletedBy: "admin-2",
  });
  assert.equal(removed.closeDate, "2026-12-24");
  assert.equal(rows.length, 2);
  // 12-23 og 12-25 fortsatt persistert
  assert.ok(rows.find((r) => r.close_date === "2026-12-23"));
  assert.ok(rows.find((r) => r.close_date === "2026-12-25"));
  assert.ok(!rows.find((r) => r.close_date === "2026-12-24"));
});

test("BIN-700 service: deleteDate på ikke-eksisterende dato → CLOSE_DAY_NOT_FOUND", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "missing delete",
    () =>
      svc.deleteDate({
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        deletedBy: "admin-1",
      }),
    "CLOSE_DAY_NOT_FOUND"
  );
});

// ── BIN-700: listForGame ────────────────────────────────────────────────

test("BIN-700 service: listForGame returnerer alle rader sortert ascending", async () => {
  const { pool } = makeStorePool();
  // Override bare for denne testen siden makeStorePool ikke håndterer ORDER BY
  const rows: StoredRow[] = [
    {
      id: "cd-3",
      game_management_id: "gm-1",
      close_date: "2026-12-25",
      closed_by: "a",
      summary_json: {},
      closed_at: "2026-04-20T00:00:00.000Z",
      start_time: null,
      end_time: null,
      notes: null,
      recurring_pattern_id: null,
    },
    {
      id: "cd-1",
      game_management_id: "gm-1",
      close_date: "2026-04-01",
      closed_by: "a",
      summary_json: {},
      closed_at: "2026-04-20T00:00:00.000Z",
      start_time: null,
      end_time: null,
      notes: null,
      recurring_pattern_id: null,
    },
    {
      id: "cd-2",
      game_management_id: "gm-1",
      close_date: "2026-05-17",
      closed_by: "a",
      summary_json: {},
      closed_at: "2026-04-20T00:00:00.000Z",
      start_time: null,
      end_time: null,
      notes: null,
      recurring_pattern_id: null,
    },
  ];
  const customPool: StubPool = {
    query: async (sql) => {
      if (sql.includes("ORDER BY close_date ASC")) {
        return {
          rows: [...rows].sort((a, b) => a.close_date.localeCompare(b.close_date)),
        };
      }
      return { rows: [] };
    },
    connect: pool.connect,
  };
  const svc = makeService(customPool, stubGameManagementService({ "gm-1": makeGame() }));
  const list = await svc.listForGame("gm-1");
  assert.deepEqual(
    list.map((e) => e.closeDate),
    ["2026-04-01", "2026-05-17", "2026-12-25"]
  );
});

test("BIN-700 service: closeMany avviser slettet spill", async () => {
  const svc = makeService(
    throwingPool(),
    stubGameManagementService({ "gm-1": makeGame({ deletedAt: "2026-01-01T00:00:00Z" }) })
  );
  await expectDomainError(
    "closeMany on deleted",
    () =>
      svc.closeMany({
        mode: "single",
        gameManagementId: "gm-1",
        closeDate: "2026-04-20",
        closedBy: "admin-1",
      }),
    "GAME_MANAGEMENT_DELETED"
  );
});

test("BIN-700 service: closeMany avviser ugyldig dato (avviser 30. februar)", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "feb 30",
    () =>
      svc.closeMany({
        mode: "single",
        gameManagementId: "gm-1",
        closeDate: "2026-02-30",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-700 service: closeMany consecutive bevarer summary-snapshot per dato", async () => {
  // Verifiser at hver rad får sitt eget summary fra det aktuelle GameManagement
  // — alle bygger på samme kilde (live-tall), ikke et delt referanse-objekt.
  const { pool, rows } = makeStorePool();
  const game = makeGame({ totalSold: 50, totalEarning: 50000 });
  const svc = makeService(pool, stubGameManagementService({ "gm-1": game }));
  await svc.closeMany({
    mode: "consecutive",
    gameManagementId: "gm-1",
    startDate: "2026-04-20",
    endDate: "2026-04-22",
    startTime: "00:00",
    endTime: "23:59",
    closedBy: "admin-1",
  });
  for (const r of rows) {
    const summary = r.summary_json as Record<string, unknown>;
    assert.equal(summary.totalSold, 50);
    assert.equal(summary.totalEarning, 50000);
    assert.equal(summary.gameManagementId, "gm-1");
  }
});

// ── REQ-116: Recurring patterns ──────────────────────────────────────────

/**
 * Hjelpefunksjon: cast result til CloseRecurringResult for tests. Service-
 * laget returnerer en union, men recurring-tests vet hvilken variant kommer.
 */
function asRecurring<T>(result: T): T & {
  pattern: { id: string; pattern: { type: string } };
  expandedCount: number;
} {
  return result as T & {
    pattern: { id: string; pattern: { type: string } };
    expandedCount: number;
  };
}

test("REQ-116 service: weekly-pattern (mandager) expanderer til riktige datoer", async () => {
  const { pool, rows, patterns } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // 2026-04-20 er en mandag. Range 2026-04-20 → 2026-05-11 (3 uker, 4 mandager).
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] }, // monday
      startDate: "2026-04-20",
      endDate: "2026-05-11",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.pattern.pattern.type, "weekly");
  assert.equal(result.expandedCount, 4);
  const dates = rows.map((r) => r.close_date).sort();
  assert.deepEqual(dates, ["2026-04-20", "2026-04-27", "2026-05-04", "2026-05-11"]);
  // Alle child-rader skal peke til pattern
  for (const r of rows) {
    assert.equal(r.recurring_pattern_id, result.pattern.id);
  }
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0]!.deleted_at, null);
});

test("REQ-116 service: weekly-pattern med flere ukedager (tir+tor) expanderer til alle", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // 2026-04-20 = mandag. Tir = 21, tor = 23.
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [2, 4] },
      startDate: "2026-04-20",
      endDate: "2026-04-26",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 2);
  const dates = rows.map((r) => r.close_date).sort();
  assert.deepEqual(dates, ["2026-04-21", "2026-04-23"]);
});

test("REQ-116 service: monthly_dates [15] expanderer 15. hver måned", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_dates", dates: [15] },
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 12);
  const dates = rows.map((r) => r.close_date).sort();
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, "0");
    assert.ok(dates.includes(`2026-${mm}-15`), `mangler 2026-${mm}-15`);
  }
});

test("REQ-116 service: monthly_dates [31] hopper over måneder med <31 dager (feb, apr, jun, sep, nov)", async () => {
  // 2026 har: jan31, feb28, mar31, apr30, mai31, jun30, jul31, aug31,
  // sep30, okt31, nov30, des31 → måneder med 31 dager: 1, 3, 5, 7, 8, 10, 12 (7 datoer).
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_dates", dates: [31] },
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 7);
  const dates = rows.map((r) => r.close_date).sort();
  assert.deepEqual(dates, [
    "2026-01-31",
    "2026-03-31",
    "2026-05-31",
    "2026-07-31",
    "2026-08-31",
    "2026-10-31",
    "2026-12-31",
  ]);
});

test("REQ-116 service: monthly_dates [29] inkluderer feb i skuddår, hopper over i ikke-skuddår", async () => {
  // 2024 = skuddår (har feb 29), 2025 = ikke skuddår (feb 28).
  // For 2024: feb 29 inkluderes. For 2025: feb 29 hoppes over.
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const r1 = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_dates", dates: [29] },
      startDate: "2024-02-01",
      endDate: "2024-02-29",
      closedBy: "admin-1",
    })
  );
  assert.equal(r1.expandedCount, 1, "skuddår → feb 29 inkludert");
  assert.equal(rows[0]!.close_date, "2024-02-29");

  // Reset
  rows.length = 0;
  const r2 = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_dates", dates: [29] },
      startDate: "2025-02-01",
      endDate: "2025-02-28",
      closedBy: "admin-1",
    })
  );
  assert.equal(r2.expandedCount, 0, "ikke-skuddår → feb 29 hoppet over");
});

test("REQ-116 service: monthly_weekday — første mandag i hver måned", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_weekday", week: 1, dayOfWeek: 1 }, // første mandag
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 6);
  const dates = rows.map((r) => r.close_date).sort();
  // Første mandag 2026: jan 5, feb 2, mar 2, apr 6, mai 4, jun 1.
  assert.deepEqual(dates, [
    "2026-01-05",
    "2026-02-02",
    "2026-03-02",
    "2026-04-06",
    "2026-05-04",
    "2026-06-01",
  ]);
});

test("REQ-116 service: monthly_weekday — siste fredag i hver måned", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_weekday", week: "last", dayOfWeek: 5 }, // last friday
      startDate: "2026-01-01",
      endDate: "2026-04-30",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 4);
  const dates = rows.map((r) => r.close_date).sort();
  // Siste fredag 2026: jan 30, feb 27, mar 27, apr 24.
  assert.deepEqual(dates, ["2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"]);
});

test("REQ-116 service: monthly_weekday — fjerde tirsdag (week=4)", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_weekday", week: 4, dayOfWeek: 2 }, // 4th tuesday
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 3);
  const dates = rows.map((r) => r.close_date).sort();
  // Fjerde tirsdag: jan 27, feb 24, mar 24.
  assert.deepEqual(dates, ["2026-01-27", "2026-02-24", "2026-03-24"]);
});

test("REQ-116 service: yearly { month: 12, day: 25 } — 1. juledag årlig", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "yearly", month: 12, day: 25 },
      startDate: "2026-01-01",
      endDate: "2028-12-31",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 3);
  const dates = rows.map((r) => r.close_date).sort();
  assert.deepEqual(dates, ["2026-12-25", "2027-12-25", "2028-12-25"]);
});

test("REQ-116 service: yearly { month: 2, day: 29 } hopper over ikke-skuddår", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // 2024 = skuddår, 2025-2027 = ikke skuddår, 2028 = skuddår
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "yearly", month: 2, day: 29 },
      startDate: "2024-01-01",
      endDate: "2028-12-31",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 2);
  const dates = rows.map((r) => r.close_date).sort();
  assert.deepEqual(dates, ["2024-02-29", "2028-02-29"]);
});

test("REQ-116 service: daily-pattern expanderer alle dager i range", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "daily" },
      startDate: "2026-04-20",
      endDate: "2026-04-26",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 7); // mandag..søndag
});

test("REQ-116 service: maxOccurrences cap'er expansion", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // weekly mandager i 1 år ville gitt ~52 datoer; cap til 5.
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] },
      startDate: "2026-01-05", // mandag
      endDate: "2026-12-31",
      maxOccurrences: 5,
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 5);
  assert.equal(rows.length, 5);
});

test("REQ-116 service: end-date cap'er expansion (selv om maxOccurrences er høyere)", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] }, // monday
      startDate: "2026-01-05", // mandag
      endDate: "2026-01-26", // 3 uker, 4 mandager
      maxOccurrences: 100,
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 4);
});

test("REQ-116 service: pattern lagres selv når expansion gir 0 datoer", async () => {
  // 30. februar finnes ikke → monthly_dates[30] i kun en feb-måned = 0.
  const { pool, rows, patterns } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const result = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "monthly_dates", dates: [30] },
      startDate: "2025-02-01",
      endDate: "2025-02-28",
      closedBy: "admin-1",
    })
  );
  assert.equal(result.expandedCount, 0);
  assert.equal(rows.length, 0, "ingen child-rader");
  assert.equal(patterns.length, 1, "men pattern er fortsatt persistert");
});

test("REQ-116 service: closeMany recurring er idempotent (re-run gir 0 nye)", async () => {
  // To recurring-create på samme spill → andre runde lager nytt pattern,
  // men expansion-datoer som allerede er lukket hopper over (skipped).
  const { pool, rows, patterns } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const first = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] },
      startDate: "2026-04-20",
      endDate: "2026-05-11",
      closedBy: "admin-1",
    })
  );
  assert.equal(first.expandedCount, 4);
  assert.equal(rows.length, 4);

  const second = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] },
      startDate: "2026-04-20",
      endDate: "2026-05-11",
      closedBy: "admin-2",
    })
  );
  assert.equal(second.expandedCount, 4);
  assert.equal(second.createdDates.length, 0, "ingen nye");
  assert.equal(second.skippedDates.length, 4, "alle skipped");
  assert.equal(rows.length, 4, "fortsatt bare 4 rader");
  assert.equal(patterns.length, 2, "men 2 patterns lagret");
});

test("REQ-116 service: avviser ugyldig pattern.type", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "bad pattern type",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        // @ts-expect-error — bevisst ugyldig
        pattern: { type: "fortnight" },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser weekly med tom daysOfWeek-array", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "empty daysOfWeek",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "weekly", daysOfWeek: [] },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser weekly med ugyldig dag (>6)", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "bad weekday",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "weekly", daysOfWeek: [7] },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser monthly_dates med dato 0 eller 32", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "date 0",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "monthly_dates", dates: [0] },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
  await expectDomainError(
    "date 32",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "monthly_dates", dates: [32] },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser monthly_weekday med ugyldig week", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "week 5",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        // @ts-expect-error — bevisst ugyldig
        pattern: { type: "monthly_weekday", week: 5, dayOfWeek: 1 },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser yearly med month=13", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "month 13",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "yearly", month: 13, day: 1 },
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser maxOccurrences over hard cap (1000)", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "max > 1000",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "daily" },
        startDate: "2026-01-01",
        endDate: "2030-01-01",
        maxOccurrences: 5000,
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser endDate < startDate", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "end < start",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "daily" },
        startDate: "2026-04-25",
        endDate: "2026-04-20",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: avviser slettet spill", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(
    pool,
    stubGameManagementService({
      "gm-1": makeGame({ deletedAt: "2026-01-01T00:00:00Z" }),
    })
  );
  await expectDomainError(
    "deleted game",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        pattern: { type: "daily" },
        startDate: "2026-01-01",
        endDate: "2026-01-07",
        closedBy: "admin-1",
      }),
    "GAME_MANAGEMENT_DELETED"
  );
});

test("REQ-116 service: bevarer startTime/endTime/notes på alle child-rader", async () => {
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await svc.closeMany({
    mode: "recurring",
    gameManagementId: "gm-1",
    pattern: { type: "weekly", daysOfWeek: [1] },
    startDate: "2026-04-20",
    endDate: "2026-05-04",
    startTime: "10:00",
    endTime: "14:00",
    notes: "Lunch-pause",
    closedBy: "admin-1",
  });
  for (const r of rows) {
    assert.equal(r.start_time, "10:00");
    assert.equal(r.end_time, "14:00");
    assert.equal(r.notes, "Lunch-pause");
  }
});

// ── REQ-116: listRecurringPatterns + deleteRecurringPattern ────────────

test("REQ-116 service: listRecurringPatterns returnerer kun aktive (deleted_at IS NULL)", async () => {
  const { pool, patterns } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await svc.closeMany({
    mode: "recurring",
    gameManagementId: "gm-1",
    pattern: { type: "weekly", daysOfWeek: [1] },
    startDate: "2026-04-20",
    endDate: "2026-04-27",
    closedBy: "admin-1",
  });
  await svc.closeMany({
    mode: "recurring",
    gameManagementId: "gm-1",
    pattern: { type: "yearly", month: 12, day: 25 },
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    closedBy: "admin-1",
  });
  const list = await svc.listRecurringPatterns("gm-1");
  assert.equal(list.length, 2);
  // soft-delete første
  patterns[0]!.deleted_at = "2026-04-21T08:00:00.000Z";
  const list2 = await svc.listRecurringPatterns("gm-1");
  assert.equal(list2.length, 1);
});

test("REQ-116 service: deleteRecurringPattern soft-deleter pattern + hard-sletter child-rader", async () => {
  const { pool, rows, patterns } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  const created = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] },
      startDate: "2026-04-20",
      endDate: "2026-05-11",
      closedBy: "admin-1",
    })
  );
  assert.equal(rows.length, 4);
  const deleted = await svc.deleteRecurringPattern({
    gameManagementId: "gm-1",
    patternId: created.pattern.id,
    deletedBy: "admin-2",
  });
  assert.equal(deleted.deletedChildCount, 4);
  assert.equal(rows.length, 0, "alle child-rader hard-slettet");
  assert.notEqual(patterns[0]!.deleted_at, null, "pattern soft-deleted");
  assert.equal(patterns[0]!.deleted_by, "admin-2");
});

test("REQ-116 service: deleteRecurringPattern på ikke-eksisterende → CLOSE_DAY_RECURRING_NOT_FOUND", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "missing pattern",
    () =>
      svc.deleteRecurringPattern({
        gameManagementId: "gm-1",
        patternId: "missing",
        deletedBy: "admin-1",
      }),
    "CLOSE_DAY_RECURRING_NOT_FOUND"
  );
});

test("REQ-116 service: deleteRecurringPattern manuell single-rad uten pattern bevares", async () => {
  // Sjekk at en manuell (non-recurring) rad IKKE blir slettet når pattern slettes.
  const { pool, rows } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // Manuell single-rad
  await svc.closeMany({
    mode: "single",
    gameManagementId: "gm-1",
    closeDate: "2026-04-20", // mandag
    closedBy: "admin-1",
  });
  // Nå legg til en weekly-pattern som overlapper
  const created = asRecurring(
    await svc.closeMany({
      mode: "recurring",
      gameManagementId: "gm-1",
      pattern: { type: "weekly", daysOfWeek: [1] },
      startDate: "2026-04-21", // dagen etter, så ingen overlapp på 04-20
      endDate: "2026-05-04",
      closedBy: "admin-1",
    })
  );
  // 04-27 og 05-04 = 2 nye recurring child-rader
  assert.equal(rows.length, 3);
  const manual = rows.find((r) => r.close_date === "2026-04-20");
  assert.ok(manual, "manuell rad eksisterer");
  assert.equal(manual!.recurring_pattern_id, null);

  await svc.deleteRecurringPattern({
    gameManagementId: "gm-1",
    patternId: created.pattern.id,
    deletedBy: "admin-2",
  });
  // Manuell rad skal fortsatt eksistere
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.close_date, "2026-04-20");
  assert.equal(rows[0]!.recurring_pattern_id, null);
});

test("REQ-116 service: avviser tom pattern-input", async () => {
  const { pool } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  await expectDomainError(
    "null pattern",
    () =>
      svc.closeMany({
        mode: "recurring",
        gameManagementId: "gm-1",
        // @ts-expect-error — bevisst ugyldig (null pattern)
        pattern: null,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        closedBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("REQ-116 service: default startDate (i dag) og endDate (+ 366 dager) brukes når ikke spesifisert", async () => {
  const { pool, patterns } = makeStorePool();
  const svc = makeService(pool, stubGameManagementService({ "gm-1": makeGame() }));
  // Ikke spesifiser noen dato — service skal bruke defaults.
  await svc.closeMany({
    mode: "recurring",
    gameManagementId: "gm-1",
    pattern: { type: "yearly", month: 1, day: 1 }, // bare 1 forekomst i 1 år
    closedBy: "admin-1",
  });
  assert.equal(patterns.length, 1);
  // start_date skal være i dag (eller nylig — vi tester at format er korrekt)
  assert.match(patterns[0]!.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(patterns[0]!.end_date!, /^\d{4}-\d{2}-\d{2}$/);
  // end_date = start_date + 366 dager
  const start = Date.parse(`${patterns[0]!.start_date}T00:00:00Z`);
  const end = Date.parse(`${patterns[0]!.end_date}T00:00:00Z`);
  const days = Math.round((end - start) / (24 * 60 * 60 * 1000));
  assert.equal(days, 366);
});
