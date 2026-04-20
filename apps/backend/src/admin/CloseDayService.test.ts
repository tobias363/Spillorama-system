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
